import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { DouyinUploadStore } from "../src/main/douyin-upload-store";
import { QianchuanAccountConfigReader, type FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";
import { QIANCHUAN_PRODUCTS } from "../src/shared/qianchuan-account";
import { QianchuanPlanListSchema, QianchuanPlanCatalogSchema, QianchuanPlanListRequestSchema, type QianchuanPlanOption } from "../src/shared/qianchuan-plan-selection";
import { QianchuanUploadSelectionSchema, uploadFailure } from "../src/shared/douyin-upload";
import { BATCH_SCHEMA_VERSION, QUEUE_SCHEMA_VERSION, DEFAULT_PRESET, createDefaultTemplate, now, type QueueState } from "../src/main/domain";
import { createDefaultProject } from "../src/main/domain";
import { BatchProductionController } from "../src/main/batch-production-controller";
import { ProjectWorkspaceSchema } from "../src/shared/project-workspace";
import { DEFAULT_EXPORT_SETTINGS } from "../src/shared/export-settings";
import { QianchuanPlanReads } from "../src/main/qianchuan-plan-reads";
import { acquireQianchuanPlans } from "../src/renderer/qianchuan-plan-requests";
import { clearQianchuanAccountPlans } from "../src/main/qianchuan-cleanup-plans";
import { QianchuanSubaccountCatalogSchema, QianchuanSubaccountSwitchRequestSchema } from "../src/shared/qianchuan-subaccounts";
import { QianchuanDisplayCatalogs } from "../src/main/qianchuan-display-catalogs";
import { QianchuanCatalogCache, type CatalogBinding } from "../src/main/qianchuan-catalog-cache";

const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const plan = (adId = "9001"): QianchuanPlanOption => ({ advertiserId: "1000", adId, name: `测试计划 ${adId}` });
const selection = (adId = "9001") => ({ enabled: true as const, accountProduct: "眼贴" as const, plan: plan(adId) });
describe("durable display catalogs", () => {
  it("does not let a delayed display refresh restore plans removed by a newer live read", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qianchuan-reconcile-order-")); roots.push(root);
    const target: FrozenQianchuanAccount = { product: "眼贴", advertiserId: "1000", adId: "2000", cdpEndpoint: "http://127.0.0.1:11000", configDigest: "a".repeat(64) };
    const signal = new AbortController().signal;
    let hold = false, resume!: () => void, reached!: () => void;
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    const display: QianchuanDisplayCatalogs = new QianchuanDisplayCatalogs(root, { configured: async () => {
      if (hold) { hold = false; reached(); await new Promise<void>(resolve => { resume = resolve; }); }
      return target;
    }, plans: async () => { const plans = await display.readPlans(target, signal, false, async () => [plan()]); hold = true; return plans; },
    directory: async () => { throw new Error("unexpected directory"); } });
    const request = { product: "眼贴" as const, expectedAdvertiserId: "1000", displayCache: true as const };
    const older = display.plans({ ...request, refresh: true }, signal);
    await waiting;
    await display.readPlans(target, signal, false, async () => []);
    resume(); await older;
    expect(await display.plans(request, signal)).toMatchObject({ plans: [], cache: { source: "cache" } });
  });
  it.each([false, true])("reconciles deleted plans from live preflight into durable history (current=%s)", async current => {
    const f = await fixture(current ? vi.fn(async () => "7000") : undefined);
    const advertiserId = current ? "7000" : "1000";
    const options = [plan(), plan("9002")].map(item => ({ ...item, advertiserId, ...(current ? { accountSource: "current-browser" as const } : {}) }));
    f.readPlans.mockResolvedValue(options);
    const request = { product: "眼贴", expectedAdvertiserId: "1000", displayCache: true,
      ...(current ? { accountSource: "current-browser", includeAccount: true, expectedCurrentAdvertiserId: advertiserId } : {}) };
    expect(await f.service.listPlans(request)).toMatchObject({ plans: options });
    f.readPlans.mockResolvedValue([options[1]!]);
    await expect(f.service.preflight({ ...selection(), plan: options[0] }, 1)).rejects.toThrow("已失效");
    f.readPlans.mockClear();
    expect(await f.service.listPlans(request)).toMatchObject({ plans: [options[1]], cache: { source: "cache" } });
    expect(f.readPlans).not.toHaveBeenCalled();
    f.readPlans.mockResolvedValue([]);
    await expect(f.service.preflight({ ...selection(), plan: options[1] }, 1)).rejects.toThrow("已失效");
    await f.service.stop();
    const restarted = new DouyinUploadService(f.store, { accounts: f.accounts, readPlans: f.readPlans,
      loadBatch: async () => { throw new Error("unexpected batch"); }, browser: () => { throw new Error("unexpected browser"); } });
    f.readPlans.mockClear(); f.readPlans.mockRejectedValue(new Error("disconnected"));
    try {
      expect(await restarted.listPlans(request)).toMatchObject({ plans: [], cache: { source: "cache" } });
      expect(f.readPlans).not.toHaveBeenCalled();
      expect(f.store.intents()).toEqual([]); expect(f.connect).not.toHaveBeenCalled();
    } finally { await restarted.stop(); }
  });
  it("retains history on failed, cancelled, mismatched or drifted live observations and isolates plan sources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qianchuan-reconcile-")); roots.push(root);
    let configured: FrozenQianchuanAccount = { product: "眼贴", advertiserId: "1000", adId: "2000", cdpEndpoint: "http://127.0.0.1:11000", configDigest: "a".repeat(64) };
    const target = configured, signal = new AbortController().signal;
    const display = new QianchuanDisplayCatalogs(root, { configured: async () => configured,
      plans: async () => { throw new Error("unexpected display live read"); }, directory: async () => { throw new Error("unexpected directory read"); } });
    await display.readPlans(target, signal, false, async () => [plan()]);
    await display.readPlans({ ...target, advertiserId: "7000" }, signal, true, async () => []);
    const request = { product: "眼贴" as const, expectedAdvertiserId: "1000", displayCache: true as const };
    expect(await display.plans(request, signal)).toMatchObject({ plans: [plan()] });
    expect(await display.plans({ ...request, accountSource: "current-browser", expectedCurrentAdvertiserId: "7000" }, signal)).toMatchObject({ plans: [] });
    await expect(display.readPlans(target, signal, false, async () => { throw new Error("disconnected"); })).rejects.toThrow("disconnected");
    await expect(display.readPlans(target, signal, false, async () => [plan(), plan()])).rejects.toThrow();
    await expect(display.readPlans(target, signal, false, async () => [{ ...plan(), advertiserId: "8000" }])).rejects.toThrow("不属于");
    const cancelled = new AbortController();
    await expect(display.readPlans(target, cancelled.signal, false, async () => { cancelled.abort(); return []; })).rejects.toThrow();
    configured = { ...target, configDigest: "b".repeat(64) };
    expect(await display.readPlans(target, signal, false, async () => [])).toEqual([]);
    expect(await display.plans(request, signal)).toMatchObject({ plans: [plan()], cache: { stale: true } });
  });
  it.each(["direct", "local-vps", "remote-browser"])("retains history for %s and marks changed transport config stale", async mode => {
    const root = await mkdtemp(path.join(tmpdir(), "qianchuan-display-")); roots.push(root);
    let target: FrozenQianchuanAccount = { product: "眼贴", advertiserId: "1000", adId: "2000", cdpEndpoint: "http://127.0.0.1:11000", configDigest: "a".repeat(64),
      ...(mode === "direct" ? {} : { egress: { ...(mode === "remote-browser" ? { mode: "remote-browser" as const } : {}), group: "one", sshHost: "fixture", localPort: 1080, expectedIp: "8.8.8.8" } }) };
    const plans = vi.fn(async () => [plan()]);
    const readers = { configured: async () => target, plans, directory: vi.fn(async () => { throw new Error("unexpected directory read"); }) };
    const request = { product: "眼贴" as const, expectedAdvertiserId: "1000", displayCache: true as const };
    expect((await new QianchuanDisplayCatalogs(root, readers).plans(request, new AbortController().signal)).cache).toMatchObject({ source: "live", persisted: true });
    plans.mockClear(); plans.mockRejectedValue(new Error("disconnected"));
    target = { ...target, configDigest: "b".repeat(64), egress: undefined };
    const display = new QianchuanDisplayCatalogs(root, readers);
    expect(await display.plans(request, new AbortController().signal)).toMatchObject({ plans: [plan()], cache: { source: "cache", stale: true } });
    expect(plans).not.toHaveBeenCalled();
    expect(await display.plans({ ...request, refresh: true }, new AbortController().signal)).toMatchObject({ plans: [plan()], cache: { refreshFailed: true } });
    const aborted = new AbortController(); aborted.abort();
    await expect(display.plans(request, aborted.signal)).rejects.toThrow();
    target = { ...target, advertiserId: "8000" };
    await expect(display.plans(request, new AbortController().signal)).rejects.toThrow("已变化");
  });
  it("rejects unsafe, corrupt, cross-identity and oversized disk records, while safe live writes remain usable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qianchuan-cache-files-")); roots.push(root);
    const cache = new QianchuanCatalogCache(root);
    const binding: CatalogBinding = { product: "眼贴", anchor: "1000", kind: "saved-plans", advertiserId: "1000" };
    const put = () => cache.put(binding, "a".repeat(64), { plans: [plan()] }, Date.now());
    expect(await cache.get(binding)).toBeUndefined();
    expect(await readdir(root)).toEqual([]);
    expect(await put()).toBe(true);
    const directory = path.join(root, "catalog-cache"), file = path.join(directory, (await readdir(directory))[0]!);
    const original = await readFile(file);
    await writeFile(file, "broken", { mode: 0o600 }); expect(await cache.get(binding)).toBeUndefined(); expect(await put()).toBe(true);
    const crossed = JSON.parse(original.toString()); crossed.binding.anchor = "8000";
    await writeFile(file, JSON.stringify(crossed)); expect(await cache.get(binding)).toBeUndefined();
    await writeFile(file, Buffer.alloc(4 * 1024 * 1024 + 1)); expect(await cache.get(binding)).toBeUndefined();
    await rm(file); const external = path.join(root, "external.json"); await writeFile(external, original, { mode: 0o600 });
    await symlink(external, file); expect(await cache.get(binding)).toBeUndefined(); expect(await put()).toBe(false);
    expect(await readFile(external)).toEqual(original);
    await rm(file); await put(); await chmod(file, 0o644); expect(await cache.get(binding)).toBeUndefined(); expect(await put()).toBe(false);
    await chmod(file, 0o600); expect(await cache.get({ ...binding, kind: "current-plans" })).toBeUndefined();
    expect(await cache.put(binding, "a".repeat(64), { plans: [{ ...plan(), advertiserId: "8000" }] }, Date.now())).toBe(false);
    expect(await cache.get(binding)).toMatchObject({ data: { plans: [plan()] } });
  });
  it("retains saved-account plans across expiry and service restart without Chrome, but preflight stays live", async () => {
    const f = await fixture();
    const request = { product: "眼贴", expectedAdvertiserId: "1000", displayCache: true };
    expect(await f.service.listPlans(request)).toMatchObject({ plans: [plan(), plan("9002")], cache: { source: "live", persisted: true } });
    await f.service.stop();
    const restarted = new DouyinUploadService(f.store, { accounts: f.accounts, readPlans: f.readPlans, readiness: () => undefined,
      loadBatch: async () => { throw new Error("unexpected batch read"); }, browser: () => { throw new Error("unexpected upload browser"); } });
    f.readPlans.mockClear(); f.readPlans.mockRejectedValue(new Error("Chrome unavailable"));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60_000);
    try {
      expect(await restarted.listPlans(request)).toMatchObject({ plans: [plan(), plan("9002")], cache: { source: "cache", stale: true } });
      expect(f.readPlans).not.toHaveBeenCalled();
      expect(await restarted.listPlans({ ...request, refresh: true })).toMatchObject({ plans: [plan(), plan("9002")], cache: { source: "cache", refreshFailed: true } });
      await expect(restarted.preflight(selection(), 1)).rejects.toThrow("Chrome unavailable");
      expect(f.store.intents()).toEqual([]);
    } finally { clock.mockRestore(); await restarted.stop(); }
  });
  it("restores directory and the exact child's plans without probing the disconnected browser", async () => {
    const account = { advertiserId: "7000", name: "网页子账户" };
    type Subaccounts = NonNullable<ConstructorParameters<typeof QianchuanAccountSettings>[4]>;
    const current = vi.fn(async () => account.advertiserId);
    const read = vi.fn<Subaccounts["read"]>(async () => ({ current: account, accounts: [account] }));
    const f = await fixture(current, undefined, { read, switch: vi.fn<Subaccounts["switch"]>() });
    f.readPlans.mockImplementation(async target => [{ ...plan(), advertiserId: target.advertiserId }]);
    const directory = { product: "眼贴", expectedAdvertiserId: "1000", displayCache: true };
    const request = { ...directory, accountSource: "current-browser", includeAccount: true, expectedCurrentAdvertiserId: "7000" };
    expect(await f.service.listSubaccounts(directory)).toMatchObject({ current: account, cache: { source: "live" } });
    expect(await f.service.listPlans(request)).toMatchObject({ account, cache: { source: "live" } });
    current.mockClear(); current.mockRejectedValue(new Error("Chrome unavailable")); f.readPlans.mockClear();
    expect(await f.service.listSubaccounts(directory)).toMatchObject({ current: account, cache: { source: "cache" } });
    expect(await f.service.listPlans(request)).toMatchObject({ account, cache: { source: "cache" } });
    expect(current).not.toHaveBeenCalled(); expect(f.readPlans).not.toHaveBeenCalled();
    expect(await f.service.listSubaccounts({ ...directory, refresh: true })).toMatchObject({ current: account, cache: { refreshFailed: true } });
    await expect(f.service.listPlans({ ...request, expectedCurrentAdvertiserId: "8000" })).rejects.toThrow();
    await expect(f.service.switchSubaccount({ product: "眼贴", expectedAdvertiserId: "1000", expectedCurrentAdvertiserId: "7000", advertiserId: "7000" })).rejects.toThrow();
    await f.service.stop();
    const restarted = new DouyinUploadService(f.store, { accounts: f.accounts, readPlans: f.readPlans, readiness: () => undefined,
      loadBatch: async () => { throw new Error("unexpected batch read"); }, browser: () => { throw new Error("unexpected upload browser"); } });
    current.mockClear(); f.readPlans.mockClear();
    await restarted.restoreConfig();
    expect(await restarted.listSubaccounts(directory)).toMatchObject({ current: account, cache: { source: "cache" } });
    expect(await restarted.listPlans(request)).toMatchObject({ account, cache: { source: "cache" } });
    await restarted.stop();
    expect(current).not.toHaveBeenCalled();
    expect(f.readPlans.mock.calls.filter(([target]) => target.product === "眼贴")).toEqual([]);
  });
});
it.each(["CLEARED", "BLOCKED"] as const)("continues past historical partial plans and retains later %s state", async later => {
  const target = { product: "眼贴" as const, advertiserId: "1000", adId: "2000", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) };
  const plans = [plan(), plan("9002"), plan("9003")];
  const clearPlan = vi.fn(async (target: FrozenQianchuanAccount) => ({ product: target.product, advertiserId: target.advertiserId,
    state: target.adId === "9001" ? "PARTIAL" as const : later, deletedCount: 1, message: target.adId }));
  const clearLibrary = vi.fn();
  const result = await clearQianchuanAccountPlans(target, { product: target.product, expectedAdvertiserId: target.advertiserId, plans }, "DELETE_VIDEOS_AND_PLAN_MATERIALS", {
    guard: async () => {}, signal: new AbortController().signal, readPlans: async () => plans, clearPlan, clearLibrary,
  });
  expect(clearPlan.mock.calls.map(([target]) => target.adId)).toEqual(later === "BLOCKED" ? ["9001", "9002"] : ["9001", "9002", "9003"]);
  expect(result.state).toBe(later === "BLOCKED" ? "BLOCKED" : "PARTIAL");
  expect(clearLibrary).not.toHaveBeenCalled();
  if (later === "CLEARED") expect(result.message).toContain("本次视频库清空未执行");
});
async function fixture(currentAccount?: ReturnType<typeof vi.fn<(endpoint: string) => Promise<string>>>, existingBrowser?: (advertiserId: string, openLocalIfMissing?: boolean) => Promise<string>, subaccounts?: ConstructorParameters<typeof QianchuanAccountSettings>[4]) {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-plan-selection-")); roots.push(root);
  const configPath = path.join(root, "accounts.json");
  const document = { version: 1, accounts: ["眼贴", ...QIANCHUAN_PRODUCTS.filter(product => product !== "眼贴")].map((product, index) => ({ product, advertiserId: String(1000 + index), adId: String(2000 + index), cdpEndpoint: `http://127.0.0.1:${11000 + index}` })) };
  const save = () => writeFile(configPath, JSON.stringify(document), { mode: 0o600 }); await save();
  const store = new DouyinUploadStore(path.join(root, "private")); await store.load();
  const readPlans = vi.fn(async (_target: FrozenQianchuanAccount, _signal: AbortSignal) => [plan(), plan("9002")]);
  const connect = vi.fn(async () => undefined);
  const browser: UploadBrowserPort = { connect, open: async () => { throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "fixture stops before any file action", "fixture", true); },
    upload: async () => { throw new Error("Unexpected file action"); }, ready: async () => [], pollReady: async () => [], readOnlyCheck: async () => { throw new Error("Unexpected recovery"); }, stop: async () => undefined };
  const states = new Map<string, QueueState>();
  const accounts = currentAccount ? new QianchuanAccountSettings(store.root, async () => "http://127.0.0.1:11000", existingBrowser ?? (async () => "http://127.0.0.1:11000"), async endpoint => ({ advertiserId: await currentAccount(endpoint), name: "网页子账户" }), subaccounts) : new QianchuanAccountConfigReader();
  const service = new DouyinUploadService(store, { accounts, readPlans, loadBatch: async id => structuredClone(states.get(id)!), browser: () => browser, readiness: () => undefined });
  await service.chooseConfig(configPath); await service.configure({ enabled: true });
  if (currentAccount) await service.stop();
  const batchId = randomUUID(), projectId = randomUUID(), taskId = randomUUID(), video = path.join(root, "output.mp4");
  await writeFile(video, "fixture artifact");
  const task: QueueState["batch"]["tasks"][number] = { id: taskId, batchId, mediaId: randomUUID(), status: "completed", progress: 1, attempt: 1, attempts: [], createdAt: now(), outputPath: video,
    outputArtifact: { taskId, path: video, sizeBytes: 16, durationMs: 1000, createdAt: now() } };
  states.set(batchId, { schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, updatedAt: now(), batch: { schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId, templateSnapshot: createDefaultTemplate(), mediaIds: [], outputDirectory: root, preset: DEFAULT_PRESET, status: "completed", estimatedBytes: 0, createdAt: now(), tasks: [task] } });
  return { service, store, readPlans, connect, accounts, configPath, document, save, batch: { id: batchId, projectId, tasks: [{ id: taskId }] }, identity: { project_id: projectId, batch_id: batchId, export_task_id: taskId } };
}

describe("current browser subaccount", () => {
  const currentPlan = (advertiserId = "7000", adId = "9001") => ({ ...plan(adId), advertiserId, accountSource: "current-browser" as const });
  it("requires a complete unique named child catalog and explicit current identity", () => {
    const account = {advertiserId:"7000",name:"网页子账户"};
    expect(QianchuanSubaccountCatalogSchema.safeParse({current:account,accounts:[account,account]}).success).toBe(false);
    expect(QianchuanSubaccountCatalogSchema.safeParse({current:account,accounts:[{...account,advertiserId:"8000"}]}).success).toBe(false);
    expect(QianchuanSubaccountSwitchRequestSchema.safeParse({product:"眼贴",expectedAdvertiserId:"1000",advertiserId:"8000"}).success).toBe(false);
  });
  it.each([false, true])("switches only a new draft and preserves old frozen tasks; uncertain=%s", async uncertain => {
    let currentId = "7000";
    const named = (advertiserId: string) => ({advertiserId,name:"网页子账户"});
    type Subaccounts = NonNullable<ConstructorParameters<typeof QianchuanAccountSettings>[4]>;
    const read = vi.fn<Subaccounts["read"]>(async (_endpoint, _signal, _excluded, guard) => {await guard(); return {current:named(currentId),accounts:[named("7000"),named("8000")]};});
    const switchChild = vi.fn<Subaccounts["switch"]>(async (_endpoint, expected, selected, _signal, _excluded, guard) => {await guard(); if(currentId!==expected)throw new Error("changed");currentId=selected;return named(selected);});
    const f = await fixture(vi.fn(async()=>currentId), undefined, {read,switch:switchChild});
    f.readPlans.mockImplementation(async target => [{...plan(),advertiserId:target.advertiserId}]);
    const selected = {...selection(),plan:currentPlan()}, authorization = (await f.service.preflight(selected,1))!;
    await f.service.registerBatches([f.batch],selected,authorization); await f.service.enqueueFinalArtifact(f.identity); await f.service.stop();
    if(uncertain){const task=f.store.tasks()[0]!;task.result.attempt_count=1;await f.store.saveTask(task);await f.store.markSelecting(task.result.upload_task_id,{targetId:"old-task-tab",pageBatchId:task.authorization.pageBatchId,modalSessionId:randomUUID()},1);}
    const before={tasks:f.store.tasks(),intents:f.store.intents(),config:await readFile((f.accounts as QianchuanAccountSettings).file)};
    const request={product:"眼贴",expectedAdvertiserId:"1000",expectedCurrentAdvertiserId:"7000",advertiserId:"8000"};
    expect(await f.service.listSubaccounts({product:"眼贴",expectedAdvertiserId:"1000"})).toMatchObject({current:named("7000")});
    if(uncertain){await expect(f.service.switchSubaccount(request)).rejects.toThrow("结果未知");expect(switchChild).not.toHaveBeenCalled();}
    else {
      expect(await f.service.switchSubaccount(request)).toEqual(named("8000"));
      expect(await f.service.listPlans({product:"眼贴",expectedAdvertiserId:"1000",accountSource:"current-browser",includeAccount:true})).toEqual({account:named("8000"),plans:[currentPlan("8000")]});
      await expect(f.service.switchSubaccount(request)).rejects.toThrow("已变化");expect(switchChild).toHaveBeenCalledOnce();
    }
    expect(f.store.tasks()).toEqual(before.tasks);expect(f.store.intents()).toEqual(before.intents);
    expect(await readFile((f.accounts as QianchuanAccountSettings).file)).toEqual(before.config);expect(f.connect).not.toHaveBeenCalled();
  });
  it("reads all mounted selectors without rejecting other directory reads as busy", async () => {
    const account = {advertiserId:"7000",name:"网页子账户"};
    type Subaccounts = NonNullable<ConstructorParameters<typeof QianchuanAccountSettings>[4]>;
    const read = vi.fn<Subaccounts["read"]>(async (_endpoint, _signal, _excluded, guard) => { await guard(); return {current:account,accounts:[account]}; });
    const f = await fixture(vi.fn(async()=>account.advertiserId),undefined,{read,switch:vi.fn<Subaccounts["switch"]>()});
    const request = {product:"眼贴",expectedAdvertiserId:"1000"};
    const results = await Promise.all(Array.from({length:3},()=>f.service.listSubaccounts(request)));
    expect(results.map(value=>value.current)).toEqual([account,account,account]);
    expect(read).toHaveBeenCalledOnce();
    results[0]!.accounts[0]!.name = "consumer edit";
    expect(results[1]!.accounts[0]!.name).toBe(account.name);
    await f.service.listSubaccounts(request); expect(read).toHaveBeenCalledOnce();
    await f.service.listSubaccounts({...request,refresh:true}); expect(read).toHaveBeenCalledTimes(2);
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("reuses only a fresh directory for the same live child, and rejects failed live checks instead of falling back", async () => {
    let currentId = "7000", time = 1000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => time);
    const named = (advertiserId: string) => ({advertiserId,name:"网页子账户"});
    type Subaccounts = NonNullable<ConstructorParameters<typeof QianchuanAccountSettings>[4]>;
    const current = vi.fn(async () => currentId);
    const read = vi.fn<Subaccounts["read"]>(async () => ({current:named(currentId),accounts:[named("7000"),named("8000")]}));
    try {
      const f = await fixture(current,undefined,{read,switch:vi.fn<Subaccounts["switch"]>()});
      const request = {product:"眼贴",expectedAdvertiserId:"1000"};
      await f.service.listSubaccounts(request);
      current.mockClear();
      const cached = await f.service.listSubaccounts(request);
      expect(current).toHaveBeenCalledTimes(2); expect(read).toHaveBeenCalledOnce();
      cached.accounts[0]!.name = "consumer edit";
      expect((await f.service.listSubaccounts(request)).accounts[0]!.name).toBe("网页子账户");
      currentId = "8000";
      expect((await f.service.listSubaccounts(request)).current.advertiserId).toBe("8000");
      expect(read).toHaveBeenCalledTimes(2);
      time += 5 * 60_000;
      await f.service.listSubaccounts(request); expect(read).toHaveBeenCalledTimes(3);
      current.mockRejectedValueOnce(new Error("Chrome closed"));
      await expect(f.service.listSubaccounts(request)).rejects.toThrow("Chrome closed");
      await f.service.listSubaccounts(request); expect(read).toHaveBeenCalledTimes(4);
      read.mockRejectedValueOnce(new Error("directory unavailable"));
      await expect(f.service.listSubaccounts({...request,refresh:true})).rejects.toThrow("directory unavailable");
      await f.service.listSubaccounts(request); expect(read).toHaveBeenCalledTimes(6);
    } finally { clock.mockRestore(); }
  });
  it("reads the child directory while another plan read is still pending", async () => {
    const account = {advertiserId:"7000",name:"网页子账户"};
    type Subaccounts = NonNullable<ConstructorParameters<typeof QianchuanAccountSettings>[4]>;
    const read = vi.fn<Subaccounts["read"]>(async (_endpoint, _signal, _excluded, guard) => { await guard(); return {current:account,accounts:[account]}; });
    const f = await fixture(vi.fn(async()=>account.advertiserId),undefined,{read,switch:vi.fn<Subaccounts["switch"]>()});
    let release!:()=>void, started!:()=>void;
    const held = new Promise<void>(resolve=>{release=resolve;}), entered = new Promise<void>(resolve=>{started=resolve;});
    f.readPlans.mockImplementationOnce(async()=>{started();await held;return [currentPlan()];});
    const plans = f.service.listPlans({product:"眼贴",expectedAdvertiserId:"1000",accountSource:"current-browser",includeAccount:true});
    await entered;
    try { expect(await f.service.listSubaccounts({product:"眼贴",expectedAdvertiserId:"1000"})).toMatchObject({current:account}); }
    finally { release(); await plans; }
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("reads different account directories without rejecting concurrent selectors", async () => {
    const account = {advertiserId:"7000",name:"网页子账户"};
    type Subaccounts = NonNullable<ConstructorParameters<typeof QianchuanAccountSettings>[4]>;
    const read = vi.fn<Subaccounts["read"]>(async (_endpoint, _signal, _excluded, guard) => {
      await new Promise(resolve=>setTimeout(resolve,20)); await guard(); return {current:account,accounts:[account]};
    });
    const f = await fixture(vi.fn(async()=>account.advertiserId),undefined,{read,switch:vi.fn<Subaccounts["switch"]>()});
    const results = await Promise.all(f.document.accounts.slice(0,3).map(({product,advertiserId})=>f.service.listSubaccounts({product,expectedAdvertiserId:advertiserId})));
    expect(results.map(value=>value.current)).toEqual([account,account,account]);
    expect(read).toHaveBeenCalledTimes(3); expect(f.connect).not.toHaveBeenCalled();
  });
  it("invalidates an in-flight directory on stop and allows a fresh explicit read", async () => {
    const account = {advertiserId:"7000",name:"网页子账户"};
    type Subaccounts = NonNullable<ConstructorParameters<typeof QianchuanAccountSettings>[4]>;
    let release!:()=>void;
    const read = vi.fn<Subaccounts["read"]>(async (_endpoint, _signal, _excluded, guard) => {
      await new Promise<void>(resolve=>{release=resolve;}); await guard(); return {current:account,accounts:[account]};
    });
    const switchChild = vi.fn<Subaccounts["switch"]>();
    const f = await fixture(vi.fn(async()=>account.advertiserId),undefined,{read,switch:switchChild});
    const request = {product:"眼贴",expectedAdvertiserId:"1000"};
    const pending = f.service.listSubaccounts(request), rejected = expect(pending).rejects.toThrow("尚未空闲");
    await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce());
    await expect(f.service.switchSubaccount({...request,expectedCurrentAdvertiserId:"7000",advertiserId:"8000"})).rejects.toThrow("尚未空闲");
    expect(switchChild).not.toHaveBeenCalled();
    await f.service.stop(); release(); await rejected;
    read.mockImplementation(async (_endpoint, _signal, _excluded, guard)=>{await guard();return {current:account,accounts:[account]};});
    expect(await f.service.listSubaccounts(request)).toMatchObject({current:account});
    expect(f.store.intents()).toHaveLength(0); expect(f.connect).not.toHaveBeenCalled();
  });
  it("protects an unknown old child in the shared browser after its current child changes", async () => {
    let currentId="9000";
    type Subaccounts=NonNullable<ConstructorParameters<typeof QianchuanAccountSettings>[4]>;
    const switchChild=vi.fn<Subaccounts["switch"]>();
    const f=await fixture(vi.fn(async()=>currentId),undefined,{read:vi.fn<Subaccounts["read"]>(),switch:switchChild});
    f.readPlans.mockImplementation(async target=>[{...plan(),advertiserId:target.advertiserId}]);
    const selected={...selection(),plan:currentPlan("9000")},authorization=(await f.service.preflight(selected,1))!;
    await f.service.registerBatches([f.batch],selected,authorization);await f.service.enqueueFinalArtifact(f.identity);await f.service.stop();
    const task=f.store.tasks()[0]!;task.result.attempt_count=1;await f.store.saveTask(task);await f.store.markSelecting(task.result.upload_task_id,{targetId:"old-child-tab",pageBatchId:task.authorization.pageBatchId,modalSessionId:randomUUID()},1);
    currentId="7000";
    const before=f.store.tasks();
    await expect(f.service.switchSubaccount({product:"眼贴",expectedAdvertiserId:"1000",expectedCurrentAdvertiserId:"7000",advertiserId:"8000"})).rejects.toThrow("结果未知");
    expect(switchChild).not.toHaveBeenCalled();expect(f.store.tasks()).toEqual(before);
  });
  it.each([false, true])("loads foreground plans with an already-open local browser: %s", async alreadyOpen => {
    let opened = alreadyOpen;
    const start = vi.fn(), currentId = alreadyOpen ? "7000" : "1000";
    const existing = vi.fn(async (_id: string, openIfMissing?: boolean) => {
      if (!opened) {
        if (!openIfMissing) throw new Error("local browser closed");
        start(); opened = true;
      }
      return "http://127.0.0.1:11000";
    });
    const f = await fixture(vi.fn(async () => currentId), existing);
    expect(start).not.toHaveBeenCalled();
    expect(existing.mock.calls.every(([, allowed]) => !allowed)).toBe(true);
    const before = await readFile((f.accounts as QianchuanAccountSettings).file);
    f.readPlans.mockImplementation(async target => [{ ...plan(), advertiserId: target.advertiserId }]);
    const request = { product: "眼贴", expectedAdvertiserId: "1000", accountSource: "current-browser", includeAccount: true };
    expect(await f.service.listPlans(request)).toEqual({ account: { advertiserId: currentId, name: "网页子账户" }, plans: [currentPlan(currentId)] });
    expect(await f.service.listPlans({ ...request, refresh: true })).toEqual({ account: { advertiserId: currentId, name: "网页子账户" }, plans: [currentPlan(currentId)] });
    expect(start).toHaveBeenCalledTimes(alreadyOpen ? 0 : 1);
    expect(opened).toBe(true);
    expect(await readFile((f.accounts as QianchuanAccountSettings).file)).toEqual(before);
    expect(f.store.intents()).toHaveLength(0); expect(f.connect).not.toHaveBeenCalled();
  });
  it("opens a closed local browser for the foreground saved-account catalog", async () => {
    let opened = false;
    const start = vi.fn();
    const f = await fixture(vi.fn(async () => "1000"), async (_id, openIfMissing) => {
      if (!opened) {
        if (!openIfMissing) throw new Error("local browser closed");
        start(); opened = true;
      }
      return "http://127.0.0.1:11000";
    });
    expect(start).not.toHaveBeenCalled();
    expect(await f.service.listPlans({ product: "眼贴", expectedAdvertiserId: "1000" })).toEqual([plan(), plan("9002")]);
    expect(start).toHaveBeenCalledOnce(); expect(f.connect).not.toHaveBeenCalled();
  });
  it("keeps restore and mismatched or remote foreground requests from starting local Chrome", async () => {
    const start = vi.fn();
    const f = await fixture(vi.fn(async () => "1000"), async (_id, openIfMissing) => {
      if (!openIfMissing) throw new Error("local browser closed");
      start(); return "http://127.0.0.1:11000";
    });
    await f.service.restoreConfig(); await vi.waitFor(() => expect(f.service.busy).toBe(false));
    expect(start).not.toHaveBeenCalled();
    const request = { product: "眼贴", expectedAdvertiserId: "1000", accountSource: "current-browser" };
    await expect(f.service.listPlans({ ...request, expectedAdvertiserId: "9999" })).rejects.toThrow("广告账户已变化");
    const target = await f.accounts.preflight("眼贴");
    vi.spyOn(f.accounts, "preflight").mockResolvedValue({ ...target, egress: { mode: "remote-browser", group: "one", sshHost: "one", localPort: 19160, expectedIp: "8.8.8.8" } });
    await expect(f.service.listPlans(request)).rejects.toThrow("local browser closed");
    expect(start).not.toHaveBeenCalled(); expect(f.connect).not.toHaveBeenCalled();
  });
  it("cancels plan reading during local startup without uploading or retrying", async () => {
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; }), start = vi.fn();
    const f = await fixture(vi.fn(async () => "1000"), async (_id, openIfMissing) => {
      if (!openIfMissing) throw new Error("local browser closed");
      start(); await ready; return "http://127.0.0.1:11000";
    });
    const requestId = randomUUID(); f.readPlans.mockClear();
    const pending = f.service.listPlans({ product: "眼贴", expectedAdvertiserId: "1000", accountSource: "current-browser", requestId }, 11);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    f.service.cancelPlanRead({ requestId }, 11); release(); await rejected;
    expect(f.service.busy).toBe(false); expect(start).toHaveBeenCalledOnce();
    expect(f.readPlans).not.toHaveBeenCalled(); expect(f.connect).not.toHaveBeenCalled();
    expect(f.store.intents()).toHaveLength(0);
  });
  it("does not reopen a local browser that disappears during a foreground catalog read", async () => {
    let opened = false;
    const start = vi.fn();
    const f = await fixture(vi.fn(async () => "1000"), async (_id, openIfMissing) => {
      if (!opened) {
        if (!openIfMissing) throw new Error("local browser closed");
        start(); opened = true;
      }
      return "http://127.0.0.1:11000";
    });
    f.readPlans.mockImplementation(async () => { opened = false; return [plan()]; });
    await expect(f.service.listPlans({ product: "眼贴", expectedAdvertiserId: "1000", accountSource: "current-browser" })).rejects.toThrow("local browser closed");
    expect(start).toHaveBeenCalledOnce(); expect(opened).toBe(false);
    expect(f.store.intents()).toHaveLength(0); expect(f.connect).not.toHaveBeenCalled();
  });
  it("rejects catalogs whose account identity disagrees with their plans", () => {
    expect(QianchuanPlanCatalogSchema.safeParse({ account: { advertiserId: "8000", name: "其他账户" }, plans: [currentPlan()] }).success).toBe(false);
    expect(QianchuanPlanCatalogSchema.safeParse({ account: { advertiserId: "1000" }, plans: [plan()] }).success).toBe(false);
    expect(QianchuanPlanListRequestSchema.safeParse({ product: "眼贴", expectedAdvertiserId: "1000", includeAccount: true }).success).toBe(false);
  });
  it("returns the verified child name and ID even when its catalog is empty", async () => {
    const f = await fixture(vi.fn(async () => "7000"));
    f.readPlans.mockResolvedValue([]);
    expect(await f.service.listPlans({ product: "眼贴", expectedAdvertiserId: "1000", accountSource: "current-browser", includeAccount: true })).toEqual({ account: { advertiserId: "7000", name: "网页子账户" }, plans: [] });
    expect(f.store.intents()).toHaveLength(0);
  });
  it("reads the current child through the saved anchor, without changing the mapping or creating intents", async () => {
    const current = vi.fn(async () => "7000"), f = await fixture(current);
    const before = await readFile((f.accounts as QianchuanAccountSettings).file);
    f.readPlans.mockImplementation(async target => [{ ...plan(), advertiserId: target.advertiserId }]);
    const request = { product: "眼贴", expectedAdvertiserId: "1000", accountSource: "current-browser" };
    expect(await f.service.listPlans(request)).toEqual([currentPlan()]);
    expect(f.readPlans.mock.calls.at(-1)![0].advertiserId).toBe("7000");
    current.mockResolvedValue("8000");
    expect(await f.service.listPlans(request)).toEqual([currentPlan("8000")]);
    expect(await readFile((f.accounts as QianchuanAccountSettings).file)).toEqual(before);
    expect(f.store.intents()).toHaveLength(0); expect(f.connect).not.toHaveBeenCalled();
    await expect(f.service.listPlans({ ...request, expectedAdvertiserId: "9999" })).rejects.toThrow("广告账户已变化");
  });
  it("binds authorization, intent and browser connection to the explicit child plan", async () => {
    const current = vi.fn(async () => "7000"), f = await fixture(current);
    f.readPlans.mockImplementation(async target => [{ ...plan(), advertiserId: target.advertiserId }]);
    const selected = { ...selection(), plan: currentPlan() };
    const authorization = (await f.service.preflight(selected, 1))!;
    expect(authorization.target).toMatchObject({ advertiserId: "7000", adId: "9001", cdpEndpoint: "http://127.0.0.1:11000" });
    await f.service.registerBatches([f.batch], selected, authorization);
    expect(f.store.intents()[0]!.authorization.target.advertiserId).toBe("7000");
    await f.service.enqueueFinalArtifact(f.identity); await f.service.runPending();
    expect(f.connect).toHaveBeenCalledOnce();
    expect((f.connect.mock.calls[0] as unknown as [any])[0].authorization.target.advertiserId).toBe("7000");
    expect(f.store.tasks()[0]!.authorization.target.advertiserId).toBe("7000");
  });
  it("rejects a saved anchor change between the initial check and the current catalog preparation", async () => {
    const f = await fixture(vi.fn(async () => "7000")), accounts = f.accounts as QianchuanAccountSettings;
    const preflight = accounts.preflight.bind(accounts);
    vi.spyOn(accounts, "preflight").mockImplementationOnce(async product => {
      const target = await preflight(product), mapping = JSON.parse(await readFile(accounts.file, "utf8"));
      mapping.accounts.find((account: { product: string }) => account.product === product).advertiserId = "9999";
      await writeFile(accounts.file, JSON.stringify(mapping));
      return target;
    });
    f.readPlans.mockClear();
    f.readPlans.mockImplementation(async target => [{ ...plan(), advertiserId: target.advertiserId }]);
    await expect(f.service.listPlans({ product: "眼贴", expectedAdvertiserId: "1000", accountSource: "current-browser" })).rejects.toThrow("广告账户已变化");
    expect(f.readPlans).not.toHaveBeenCalled(); expect(f.store.intents()).toHaveLength(0);
  });
  it("rejects a stale child selection, drift during the catalog and forged authorization", async () => {
    const current = vi.fn(async () => "7000"), f = await fixture(current);
    f.readPlans.mockImplementation(async target => [{ ...plan(), advertiserId: target.advertiserId }]);
    const selected = { ...selection(), plan: currentPlan() };
    await expect(f.service.preflight({ ...selected, plan: currentPlan("8000") }, 1)).rejects.toThrow("不属于");
    f.readPlans.mockImplementationOnce(async target => { current.mockResolvedValue("8000"); return [{ ...plan(), advertiserId: target.advertiserId }]; });
    await expect(f.service.preflight(selected, 1)).rejects.toThrow("已变化");
    current.mockResolvedValue("7000");
    const authorization = (await f.service.preflight(selected, 1))!;
    await expect(f.service.registerBatches([f.batch], selected, { ...authorization, expectedCount: 2 })).rejects.toThrow("授权已变化");
    expect(f.store.intents()).toHaveLength(0); expect(f.connect).not.toHaveBeenCalled();
  });
  it("blocks a later child switch before any browser upload action, preserving the frozen target", async () => {
    const current = vi.fn(async () => "7000"), f = await fixture(current);
    f.readPlans.mockImplementation(async target => [{ ...plan(), advertiserId: target.advertiserId }]);
    const selected = { ...selection(), plan: currentPlan() }, authorization = (await f.service.preflight(selected, 1))!;
    await f.service.registerBatches([f.batch], selected, authorization); await f.service.enqueueFinalArtifact(f.identity);
    current.mockResolvedValue("8000"); await f.service.runPending();
    expect(f.connect).not.toHaveBeenCalled(); expect(f.store.tasks()[0]!.authorization.target).toEqual(authorization.target);
    expect(f.store.tasks()[0]!.result.failure?.code).toBe("INPUT_CONFLICT");
  });
});

describe("explicit upload plan selection", () => {
  it("scopes cancellation to the initiating IPC sender and stops its active reader", async () => {
    const f = await fixture(), requestId = randomUUID();
    let observed!: AbortSignal;
    f.readPlans.mockImplementation(async (_target, signal) => {
      observed = signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const work = f.service.listPlans({ product: "眼贴", expectedAdvertiserId: "1000", requestId }, 11);
    const rejection = expect(work).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(f.readPlans).toHaveBeenCalledOnce());
    f.service.cancelPlanRead({ requestId }, 12); expect(observed.aborted).toBe(false);
    f.service.cancelPlanRead({ requestId }, 11); await rejection;
    expect(observed.aborted).toBe(true); expect(f.service.busy).toBe(false);
    expect(f.store.intents()).toHaveLength(0); expect(f.connect).not.toHaveBeenCalled();
  });
  it("shares selector leases through StrictMode replay and cancels only the last released lease", async () => {
    vi.useFakeTimers();
    let resolve!: (plans: QianchuanPlanOption[]) => void;
    const list = vi.fn(() => new Promise<QianchuanPlanOption[]>(done => { resolve = done; }));
    const cancel = vi.fn(async () => undefined);
    vi.stubGlobal("window", { jianji: { listQianchuanPlans: list, cancelQianchuanPlans: cancel } });
    const input = { product: "眼贴" as const, expectedAdvertiserId: "1000" };
    const strictFirst = acquireQianchuanPlans(input); strictFirst.release();
    const strictSecond = acquireQianchuanPlans(input), otherRow = acquireQianchuanPlans(input);
    await vi.runAllTimersAsync(); expect(list).toHaveBeenCalledOnce(); expect(cancel).not.toHaveBeenCalled();
    strictSecond.release(); await vi.runAllTimersAsync(); expect(cancel).not.toHaveBeenCalled();
    otherRow.release(); await vi.runAllTimersAsync(); expect(cancel).toHaveBeenCalledOnce();
    resolve([plan()]); await strictFirst.promise;
    const refreshed = acquireQianchuanPlans(input); expect(list).toHaveBeenCalledTimes(2);
    resolve([plan()]); await refreshed.promise; refreshed.release();
  });
  it("cancels one subscriber without aborting another subscriber's shared read", async () => {
    const f = await fixture(), target = (await f.service.preflight({ enabled: true, accountProduct: "眼贴" }, 1))!.target;
    let release!: () => void, observed!: AbortSignal;
    const read = vi.fn(async (_target, signal: AbortSignal) => { observed = signal; await new Promise<void>(resolve => { release = resolve; }); return [plan()]; });
    const reads = new QianchuanPlanReads(read), cancelled = new AbortController();
    const first = reads.request(target, cancelled.signal), second = reads.request(target);
    const rejection = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    cancelled.abort(); await rejection;
    expect(observed.aborted).toBe(false);
    release(); expect(await second).toEqual([plan()]);
  });
  it("skips all-cancelled queued reads without opening the next account", async () => {
    const f = await fixture(), target = (await f.service.preflight({ enabled: true, accountProduct: "眼贴" }, 1))!.target;
    let release!: () => void;
    const read = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve; }); return [plan()]; });
    const reads = new QianchuanPlanReads(read), cancelled = new AbortController();
    const first = reads.request(target), queued = reads.request({ ...target, configDigest: "other-config" }, cancelled.signal);
    const rejection = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    cancelled.abort(); await rejection; release(); await first;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(read).toHaveBeenCalledOnce();
  });
  it("waits for owned-tab cleanup on final active cancellation and rejects late success", async () => {
    const f = await fixture(), target = (await f.service.preflight({ enabled: true, accountProduct: "眼贴" }, 1))!.target;
    let cleanup!: () => void, observed!: AbortSignal;
    const read = vi.fn(async (_target, signal: AbortSignal) => { observed = signal; await new Promise<void>(resolve => { cleanup = resolve; }); return [plan()]; });
    const reads = new QianchuanPlanReads(read), cancelled = new AbortController();
    const pending = reads.request(target, cancelled.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    let settled = false; void pending.catch(() => { settled = true; });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    cancelled.abort(); expect(observed.aborted).toBe(true);
    await Promise.resolve(); expect(settled).toBe(false);
    cleanup(); await rejection;
  });
  it("shares display reads and forces a new read for explicit refresh", async () => {
    const f = await fixture();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    f.readPlans.mockImplementation(async () => { await held; return [plan()]; });
    const request = { product: "眼贴", expectedAdvertiserId: "1000" };
    const first = f.service.listPlans(request), second = f.service.listPlans(request);
    await vi.waitFor(() => expect(f.readPlans).toHaveBeenCalledOnce());
    release();
    expect(await first).toEqual([plan()]); expect(await second).toEqual([plan()]);
    expect(f.readPlans).toHaveBeenCalledOnce();
    await f.service.listPlans(request);
    expect(f.readPlans).toHaveBeenCalledOnce();
    await f.service.listPlans({ ...request, refresh: true });
    expect(f.readPlans).toHaveBeenCalledTimes(2);
  });
  it("drains an active startup read and skips queued accounts when stopped", async () => {
    const f = await fixture();
    let cleanup!: () => void, observed!: AbortSignal;
    const read = vi.fn(async (target: FrozenQianchuanAccount, signal: AbortSignal) => {
      observed = signal;
      await new Promise<void>(resolve => { cleanup = resolve; });
      return [{ ...plan(), advertiserId: target.advertiserId }];
    });
    const service = new DouyinUploadService(f.store, { accounts: new QianchuanAccountConfigReader(), readPlans: read, loadBatch: async () => { throw new Error("no export"); }, browser: () => { throw new Error("no upload"); } });
    await service.restoreConfig();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    let settled = false;
    const stop = service.stop().then(result => { settled = true; return result; });
    expect(observed.aborted).toBe(true);
    await Promise.resolve(); expect(settled).toBe(false);
    cleanup(); expect(await stop).toBe(true);
    expect(service.busy).toBe(false); expect(read).toHaveBeenCalledOnce();
    read.mockResolvedValue([plan()]);
    expect(await service.listPlans({ product: "眼贴", expectedAdvertiserId: "1000" })).toEqual([plan()]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(f.store.intents()).toHaveLength(0);
  });
  it("prepares account catalogs on restore before a selector requests them", async () => {
    const f = await fixture();
    const read = vi.fn(async (target: FrozenQianchuanAccount) => [{ ...plan(), advertiserId: target.advertiserId }]);
    const accounts = new QianchuanAccountConfigReader(), prepare = vi.spyOn(accounts, "prepareCatalog");
    const service = new DouyinUploadService(f.store, { accounts, readPlans: read, loadBatch: async () => { throw new Error("no export"); }, browser: () => { throw new Error("no upload"); } });
    await service.restoreConfig();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(6));
    await vi.waitFor(() => expect(service.busy).toBe(false));
    expect(await service.listPlans({ product: "眼贴", expectedAdvertiserId: "1000" })).toEqual([plan()]);
    expect(read).toHaveBeenCalledTimes(6);
    expect(prepare).toHaveBeenCalledTimes(6);
    await service.listPlans({ product: "眼贴", expectedAdvertiserId: "1000", refresh: true });
    expect(read).toHaveBeenCalledTimes(7);
    expect(prepare).toHaveBeenCalledTimes(7);
    await expect(service.preflight(selection(), 1)).resolves.toBeDefined();
    expect(read).toHaveBeenCalledTimes(8);
  });
  it("expires display catalogs and isolates config, endpoint and advertiser identities", async () => {
    const f = await fixture(), target = (await f.service.preflight({ enabled: true, accountProduct: "眼贴" }, 1))!.target;
    let time = 0;
    const read = vi.fn(async (value: FrozenQianchuanAccount) => [{ ...plan(), advertiserId: value.advertiserId }]);
    const reads = new QianchuanPlanReads(read, () => time);
    const first = await reads.catalog(target);
    first[0]!.name = "changed by consumer";
    expect((await reads.catalog(target))[0]!.name).toBe(plan().name);
    expect(read).toHaveBeenCalledOnce();
    await reads.request(target); expect(read).toHaveBeenCalledTimes(2);
    time = 5 * 60_000;
    await reads.catalog(target); expect(read).toHaveBeenCalledTimes(3);
    for (const changed of [{ ...target, configDigest: "changed" }, { ...target, cdpEndpoint: "http://127.0.0.1:12000" }, { ...target, advertiserId: "1001" }]) await reads.catalog(changed);
    expect(read).toHaveBeenCalledTimes(6);
    read.mockRejectedValueOnce(new Error("refresh failed"));
    await expect(reads.catalog(target, undefined, true)).rejects.toThrow("refresh failed");
    await reads.catalog(target); expect(read).toHaveBeenCalledTimes(8);
  });
  it("keeps legacy selection compatible while rejecting duplicate or cross-advertiser catalogs", async () => {
    expect(QianchuanUploadSelectionSchema.parse({ enabled: true, accountProduct: "眼贴" }).plan).toBeUndefined();
    expect(QianchuanPlanListSchema.safeParse([plan(), plan()]).success).toBe(false);
    expect(QianchuanPlanListSchema.safeParse([plan(), { ...plan("9002"), advertiserId: "1001" }]).success).toBe(false);
    const f = await fixture(); const authorization = await f.service.preflight({ enabled: true, accountProduct: "眼贴" }, 1);
    expect(authorization?.target.adId).toBe("2000"); expect(f.readPlans).not.toHaveBeenCalled();
  });
  it("reads only the expected account and rejects settings drift during catalog read", async () => {
    const f = await fixture();
    await expect(f.service.listPlans({ product: "眼贴", expectedAdvertiserId: "1001" })).rejects.toThrow("广告账户已变化");
    expect(f.readPlans).not.toHaveBeenCalled();
    expect(await f.service.listPlans({ product: "眼贴", expectedAdvertiserId: "1000" })).toEqual([plan(), plan("9002")]);
    f.readPlans.mockImplementation(async () => { f.document.accounts[0]!.adId = "3000"; await f.save(); return [plan()]; });
    await expect(f.service.preflight(selection(), 1)).rejects.toThrow(); expect(f.store.intents()).toHaveLength(0);
  });
  it("rejects a foreign or vanished plan before registering any intent", async () => {
    const f = await fixture();
    await expect(f.service.preflight({ ...selection(), plan: { ...plan(), advertiserId: "1001" } }, 1)).rejects.toThrow("不属于");
    expect(f.readPlans).not.toHaveBeenCalled();
    f.readPlans.mockResolvedValue([]);
    await expect(f.service.preflight(selection(), 1)).rejects.toThrow("已失效");
    f.readPlans.mockResolvedValue([{ ...plan(), advertiserId: "1001" }]);
    await expect(f.service.preflight(selection(), 1)).rejects.toThrow("不属于");
    expect(f.store.intents()).toHaveLength(0); expect(f.connect).not.toHaveBeenCalled();
  });
  it("freezes independent plans for the same account without changing the saved default", async () => {
    const f = await fixture(), original = await readFile(f.configPath, "utf8");
    const first = (await f.service.preflight(selection(), 1))!, second = (await f.service.preflight(selection("9002"), 1))!;
    expect(first.target.adId).toBe("9001"); expect(second.target.adId).toBe("9002");
    expect(first.target.configDigest).toBe(second.target.configDigest);
    await f.service.registerBatch(f.batch, selection("9002"), first);
    expect(f.store.intents()).toHaveLength(0);
    await f.service.registerBatch(f.batch, selection(), first);
    expect(f.store.intents()[0]!.selection.plan?.adId).toBe("9001");
    expect(await readFile(f.configPath, "utf8")).toBe(original);
  });
  it("uses the frozen explicit plan when the saved default changes before file selection", async () => {
    const f = await fixture(), authorization = (await f.service.preflight(selection(), 1))!;
    await f.service.registerBatch(f.batch, selection(), authorization);
    await f.service.enqueueFinalArtifact(f.identity);
    f.document.accounts[0]!.adId = "3000"; await f.save();
    await f.service.runPending();
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.store.tasks()[0]!.authorization.target.adId).toBe("9001");
    expect(f.store.tasks()[0]!.result.upload_outcome).toBe("NOT_SELECTED");
    expect(f.store.hasMarker(f.store.tasks()[0]!.result.upload_task_id)).toBe(false);
  });
  it("still blocks an advertiser change and preserves the original frozen plan", async () => {
    const f = await fixture(), authorization = (await f.service.preflight(selection(), 1))!;
    await f.service.registerBatch(f.batch, selection(), authorization); await f.service.enqueueFinalArtifact(f.identity);
    f.document.accounts[0]!.advertiserId = "3000"; await f.save(); await f.service.runPending();
    expect(f.connect).not.toHaveBeenCalled(); expect(f.store.tasks()[0]!.result.failure?.code).toBe("INPUT_CONFLICT");
    expect(f.store.tasks()[0]!.authorization.target).toEqual(authorization.target);
  });
  it("updates explicit plan identity on the existing unfenced retarget path and survives reload", async () => {
    const f = await fixture(), authorization = (await f.service.preflight(selection(), 1))!;
    await f.service.registerBatch(f.batch, selection(), authorization); await f.service.enqueueFinalArtifact(f.identity);
    const task = f.store.tasks()[0]!;
    await f.store.retargetBatch(task.result.upload_task_id, { ...authorization, pageBatchId: randomUUID(), target: { ...authorization.target, adId: "9002" } });
    const restored = new DouyinUploadStore(f.store.root); await restored.load();
    expect(restored.unavailable).toBe(false); expect(restored.intents()[0]!.selection.plan?.adId).toBe("9002");
    expect(restored.tasks()[0]!.authorization.target.adId).toBe("9002");
  });
  it.each([[true, false], [false, false], [true, true], [false, true]])("cross-template admission accepts only the explicit selected plan (matching=%s, child=%s)", async (matching, child) => {
    const f = await fixture(child ? vi.fn(async () => "7000") : undefined), project = createDefaultProject("眼贴"), mediaId = randomUUID();
    f.readPlans.mockImplementation(async target => [{ ...plan(), advertiserId: target.advertiserId }]);
    const selected = child ? { ...selection(), plan: { ...plan(), advertiserId: "7000", accountSource: "current-browser" as const } } : selection();
    project.mediaItems = [{ id: mediaId, sourcePath: "/fixture/source.mp4", displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 100, durationMs: 1000,
      width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: now() }];
    project.workspaceDraft = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: [mediaId], ruleId: "clean", brief: "", decorations: { mode: "random" }, requestedCount: 1, exportFormat: "mp4", exportSettings: DEFAULT_EXPORT_SETTINGS });
    const authorization = (await f.service.preflight(selected, 1))!;
    const outputDirectory = vi.fn(async () => { throw new Error("Fixture stops after admission"); });
    const controller = new BatchProductionController(f.store.root, {
      name: () => "眼贴", loadProject: async () => project,
      uploadAccounts: () => [{ product: "眼贴", advertiserId: "1000", adId: "2000", available: true }],
      preflightUpload: async () => matching ? authorization : { ...authorization, target: { ...authorization.target, adId: "9002" } },
      outputDirectory, session: vi.fn(), queue: () => ({ revision: 0, batches: [] }), taskStatuses: () => new Map(), cancelExport: vi.fn(), changed: vi.fn(),
    });
    await controller.start({ entries: [{ recentProjectId: randomUUID(), requestedCount: 1, productPrice: "手动文字", coverEnabled: false, displayMode: "full", mode: "random", douyinUpload: selected }] });
    await vi.waitFor(() => expect(controller.snapshot()?.status).toBe("finished"));
    if (matching) expect(outputDirectory).toHaveBeenCalledOnce();
    else { expect(outputDirectory).not.toHaveBeenCalled(); expect(controller.snapshot()?.jobs[0]?.error).toContain("计划"); }
  });
});
