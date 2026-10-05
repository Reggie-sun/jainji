import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { DouyinUploadStore } from "../src/main/douyin-upload-store";
import { QianchuanAccountConfigReader, type FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
import { QIANCHUAN_PRODUCTS } from "../src/shared/qianchuan-account";
import { QianchuanPlanListSchema, type QianchuanPlanOption } from "../src/shared/qianchuan-plan-selection";
import { QianchuanUploadSelectionSchema, uploadFailure } from "../src/shared/douyin-upload";
import { BATCH_SCHEMA_VERSION, QUEUE_SCHEMA_VERSION, DEFAULT_PRESET, createDefaultTemplate, now, type QueueState } from "../src/main/domain";
import { createDefaultProject } from "../src/main/domain";
import { BatchProductionController } from "../src/main/batch-production-controller";
import { ProjectWorkspaceSchema } from "../src/shared/project-workspace";
import { DEFAULT_EXPORT_SETTINGS } from "../src/shared/export-settings";
import { QianchuanPlanReads } from "../src/main/qianchuan-plan-reads";
import { acquireQianchuanPlans } from "../src/renderer/qianchuan-plan-requests";

const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const plan = (adId = "9001"): QianchuanPlanOption => ({ advertiserId: "1000", adId, name: `测试计划 ${adId}` });
const selection = (adId = "9001") => ({ enabled: true as const, accountProduct: "眼贴" as const, plan: plan(adId) });
async function fixture() {
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
  const service = new DouyinUploadService(store, { accounts: new QianchuanAccountConfigReader(), readPlans, loadBatch: async id => structuredClone(states.get(id)!), browser: () => browser, readiness: () => undefined });
  await service.chooseConfig(configPath); await service.configure({ enabled: true });
  const batchId = randomUUID(), projectId = randomUUID(), taskId = randomUUID(), video = path.join(root, "output.mp4");
  await writeFile(video, "fixture artifact");
  const task: QueueState["batch"]["tasks"][number] = { id: taskId, batchId, mediaId: randomUUID(), status: "completed", progress: 1, attempt: 1, attempts: [], createdAt: now(), outputPath: video,
    outputArtifact: { taskId, path: video, sizeBytes: 16, durationMs: 1000, createdAt: now() } };
  states.set(batchId, { schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, updatedAt: now(), batch: { schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId, templateSnapshot: createDefaultTemplate(), mediaIds: [], outputDirectory: root, preset: DEFAULT_PRESET, status: "completed", estimatedBytes: 0, createdAt: now(), tasks: [task] } });
  return { service, store, readPlans, connect, configPath, document, save, batch: { id: batchId, projectId, tasks: [{ id: taskId }] }, identity: { project_id: projectId, batch_id: batchId, export_task_id: taskId } };
}

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
  it.each([true, false])("cross-template admission accepts only the explicit selected plan (matching=%s)", async matching => {
    const f = await fixture(), project = createDefaultProject("眼贴"), mediaId = randomUUID();
    project.mediaItems = [{ id: mediaId, sourcePath: "/fixture/source.mp4", displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 100, durationMs: 1000,
      width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: now() }];
    project.workspaceDraft = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: [mediaId], ruleId: "clean", brief: "", decorations: { mode: "random" }, requestedCount: 1, exportFormat: "mp4", exportSettings: DEFAULT_EXPORT_SETTINGS });
    const authorization = (await f.service.preflight(selection(), 1))!;
    const outputDirectory = vi.fn(async () => { throw new Error("Fixture stops after admission"); });
    const controller = new BatchProductionController(f.store.root, {
      name: () => "眼贴", loadProject: async () => project,
      uploadAccounts: () => [{ product: "眼贴", advertiserId: "1000", adId: "2000", available: true }],
      preflightUpload: async () => matching ? authorization : { ...authorization, target: { ...authorization.target, adId: "9002" } },
      outputDirectory, session: vi.fn(), queue: () => ({ revision: 0, batches: [] }), taskStatuses: () => new Map(), cancelExport: vi.fn(), changed: vi.fn(),
    });
    await controller.start({ entries: [{ recentProjectId: randomUUID(), requestedCount: 1, productPrice: "手动文字", coverEnabled: false, displayMode: "full", mode: "random", douyinUpload: selection() }] });
    await vi.waitFor(() => expect(controller.snapshot()?.status).toBe("finished"));
    if (matching) expect(outputDirectory).toHaveBeenCalledOnce();
    else { expect(outputDirectory).not.toHaveBeenCalled(); expect(controller.snapshot()?.jobs[0]?.error).toContain("计划"); }
  });
});
