import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BATCH_SCHEMA_VERSION, DEFAULT_PRESET, QUEUE_SCHEMA_VERSION, createDefaultTemplate, now, type QueueState } from "../src/main/domain";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";
import { DouyinUploadStore, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { QIANCHUAN_PRODUCTS, type QianchuanProduct } from "../src/shared/qianchuan-account";
import { uploadFailure, type PageOwnership, type ReadyEvidence, type UploadIdentity } from "../src/shared/douyin-upload";

const roots = new Set<string>();
afterEach(async () => { await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true }))); roots.clear(); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-recovery-")); roots.add(root);
  const outputDirectory = path.join(root, "outputs"); await mkdir(outputDirectory);
  const accountPath = path.join(root, "accounts.json");
  await writeFile(accountPath, JSON.stringify({ version: 1, accounts: QIANCHUAN_PRODUCTS.map((product, index) => ({
    product, cdpEndpoint: `http://127.0.0.1:${13000 + index}`, advertiserId: `${3000 + index}`, adId: `${4000 + index}`,
  })) }), { mode: 0o600 });
  const accounts = new QianchuanAccountConfigReader(), store = new DouyinUploadStore(path.join(root, "private")); await store.load();
  let browserStore = store;
  const states = new Map<string, QueueState>(), groups: string[][] = [], checks: string[] = [];
  const owners = new Map<string, PageOwnership>();
  const evidence = (task: UploadTaskRecord, owner: PageOwnership, count: number): ReadyEvidence => ({
    advertiserId: task.authorization.target.advertiserId, adId: task.authorization.target.adId,
    fileName: task.result.file_name, selectedCount: count, observedAt: now(), pageOwnership: owner,
  });
  const port: UploadBrowserPort = {
    connect: async (_task, signal) => { signal.throwIfAborted(); },
    open: async (tasks, selected, signal) => {
      signal.throwIfAborted(); const batchId = tasks[0]!.authorization.pageBatchId;
      const owner = owners.get(batchId) ?? { targetId: `fixture-${randomUUID()}`, pageBatchId: batchId, modalSessionId: randomUUID() };
      owners.set(batchId, owner); return { pageOwnership: owner, selectedIndex: selected.length + 1 };
    },
    upload: async (tasks, signal) => {
      signal.throwIfAborted();
      for (const task of tasks) expect(browserStore.hasMarker(task.result.upload_task_id)).toBe(true);
      groups.push(tasks.map(task => task.result.upload_task_id));
    },
    ready: async tasks => tasks.map(task => evidence(task, browserStore.fence(task.result.upload_task_id)!.pageOwnership,
      browserStore.tasks().filter(other => other.authorization.pageBatchId === task.authorization.pageBatchId && browserStore.hasMarker(other.result.upload_task_id)).length)),
    readOnlyCheck: async (task, owner, selected) => { checks.push(task.result.upload_task_id); return evidence(task, owner, selected.length); },
    stop: async () => {},
  };
  const dependencies = { loadBatch: async (id: string) => structuredClone(states.get(id)!), accounts, browser: () => port };
  const service = new DouyinUploadService(store, dependencies);
  await service.chooseConfig(accountPath); await service.configure({ enabled: true });
  async function batch(count: number, product: QianchuanProduct = "滴耳康") {
    const projectId = randomUUID(), batchId = randomUUID(), identities: UploadIdentity[] = [];
    const tasks: QueueState["batch"]["tasks"] = [];
    for (let index = 0; index < count; index++) {
      const taskId = randomUUID(), video = path.join(outputDirectory, `${taskId}.mp4`), content = `formal-${batchId}-${index}`;
      await writeFile(video, content);
      tasks.push({ id: taskId, batchId, mediaId: randomUUID(), status: "completed", progress: 1, attempt: 1, createdAt: now(), attempts: [], outputPath: video,
        outputArtifact: { taskId, path: video, sizeBytes: Buffer.byteLength(content), durationMs: 1000, createdAt: now() } });
      identities.push({ project_id: projectId, batch_id: batchId, export_task_id: taskId });
    }
    states.set(batchId, { schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, updatedAt: now(), batch: {
      schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId, templateSnapshot: createDefaultTemplate(), mediaIds: [], outputDirectory,
      preset: DEFAULT_PRESET, status: "completed", estimatedBytes: 0, createdAt: now(), tasks,
    } });
    const selection = { enabled: true as const, accountProduct: product }, authorization = await service.preflight(selection, count);
    await service.registerBatch({ id: batchId, projectId, tasks: tasks.map(task => ({ id: task.id })) }, selection, authorization);
    return { projectId, identities, pageBatchId: authorization!.pageBatchId };
  }
  async function admit(value: Awaited<ReturnType<typeof batch>>, recovery = false) {
    for (const identity of value.identities) await service.enqueueFinalArtifact(identity, recovery);
    return store.tasks().filter(task => task.authorization.pageBatchId === value.pageBatchId);
  }
  async function pause() {
    const blocker = await batch(1, "肥皂"), open = port.open;
    port.open = async () => { throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "原页面不可用。", "人工核查。", true); };
    await admit(blocker); await service.runPending(); port.open = open;
    expect(service.status(blocker.projectId).tasks[0]!.state).toBe("NEEDS_HUMAN");
    return blocker;
  }
  async function mapping(product: QianchuanProduct = "滴耳康", adId = "888888", advertiserId?: string) {
    const data = JSON.parse(await readFile(accountPath, "utf8"));
    const account = data.accounts.find((a: {product: string}) => a.product === product); account.adId = adId; if (advertiserId) account.advertiserId = advertiserId;
    await writeFile(accountPath, JSON.stringify(data), { mode: 0o600 }); await service.refreshAccounts();
  }
  return { root, accounts, store, service, dependencies, port, groups, checks, batch, admit, pause, mapping, useStore: (value: DouyinUploadStore) => { browserStore = value; } };
}

describe("explicit current-plan target authorization", () => {
  it("blocks old frozen target before browser operations when the saved plan changed", async () => {
    const f = await fixture(), batch = await f.batch(12), records = await f.admit(batch); await f.mapping();
    const browser = vi.spyOn(f.dependencies, "browser");
    await expect(f.service.requestResume(records[0]!.result.upload_task_id)).rejects.toThrow(/改传当前计划/);
    expect(f.groups).toEqual([]); expect(f.store.tasks().some(t => f.store.hasMarker(t.result.upload_task_id))).toBe(false);
    expect(f.store.task(records[0]!.result.upload_task_id)).toEqual(records[0]);
    expect(browser).not.toHaveBeenCalled();
  });
  it("retargets only this complete unselected batch without browser actions then explicitly resumes 9/9/2", async () => {
    const f = await fixture(), batch = await f.batch(20), records = await f.admit(batch), other = await f.batch(1); await f.admit(other);
    const untouched = f.store.tasks().find(t => t.input.project_id === other.projectId)!; await f.mapping();
    await f.service.retarget(records[0]!.result.upload_task_id, "888888"); await f.service.runPending();
    expect(f.groups).toEqual([]); expect(f.store.task(untouched.result.upload_task_id)).toEqual(untouched);
    const changed = f.store.tasks().filter(t => t.input.project_id === batch.projectId);
    expect(changed).toHaveLength(20); expect(changed.every(t => t.authorization.target.adId === "888888" && t.result.upload_outcome === "NOT_SELECTED")).toBe(true);
    expect(new Set(changed.map(t => t.authorization.pageBatchId)).size).toBe(1);
    expect(changed[0]!.authorization.pageBatchId).not.toBe(batch.pageBatchId);
    expect(changed.map(t => t.snapshotPath).sort()).toEqual(records.map(t => t.snapshotPath).sort());
    await f.service.resume(changed[0]!.result.upload_task_id);
    expect(f.groups.map(g => g.length)).toEqual([9,9,2]);
    expect(f.service.status(batch.projectId).tasks.every(t => t.adId === "888888" && t.upload_outcome === "READY")).toBe(true);
  });
  it("requires the exact displayed current plan and same advertiser", async () => {
    const f = await fixture(), batch = await f.batch(2), records = await f.admit(batch); await f.mapping();
    const before = await readFile(path.join(f.store.root, "state.json"));
    await expect(f.service.retarget(records[0]!.result.upload_task_id, "777777")).rejects.toThrow(/计划.*变化/);
    await f.mapping("滴耳康", "888888", "999999");
    await expect(f.service.retarget(records[0]!.result.upload_task_id, "888888")).rejects.toThrow(/账号|账户/);
    expect(await readFile(path.join(f.store.root, "state.json"))).toEqual(before); expect(f.groups).toEqual([]);
  });
  it("does not unblock same-account unknown selected history after rebinding", async () => {
    const f = await fixture(), old = await f.batch(1), oldRecords = await f.admit(old);
    const original = oldRecords[0]!;
    original.result.attempt_count = 1; await f.store.saveTask(original);
    await f.store.markSelecting(original.result.upload_task_id, {targetId:"old-tab", pageBatchId:old.pageBatchId,modalSessionId:randomUUID()},1);
    const unknown = f.store.task(original.result.upload_task_id)!; unknown.result.state="NEEDS_HUMAN"; await f.store.saveTask(unknown);
    const batch = await f.batch(2), records = await f.admit(batch); await f.mapping();
    const fencePath=path.join(f.store.root,"selection-fences",`${original.result.upload_task_id}.json`), fence = await readFile(fencePath);
    await f.service.retarget(records[0]!.result.upload_task_id,"888888");
    const changed=f.store.tasks().find(t=>t.input.project_id===batch.projectId)!;
    await expect(f.service.resume(changed.result.upload_task_id)).rejects.toThrow(/未解决/);
    await expect(f.service.retarget(original.result.upload_task_id,"888888")).rejects.toThrow();
    expect(await readFile(fencePath)).toEqual(fence);expect(f.store.task(original.result.upload_task_id)).toEqual(unknown);expect(f.groups).toEqual([]);
  });
  it("a stop during the final configuration check prevents the ledger commit", async () => {
    const f = await fixture(), batch = await f.batch(2), records = await f.admit(batch); await f.mapping();
    const before = await readFile(path.join(f.store.root, "state.json"));
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const freeze = f.accounts.freeze.bind(f.accounts);
    vi.spyOn(f.accounts, "freeze").mockImplementation(async (product, digest) => { enter(); await gate; return freeze(product, digest); });
    const moving = f.service.retarget(records[0]!.result.upload_task_id, "888888");
    const rejected = expect(moving).rejects.toThrow(/已停止/);
    await entered;
    await expect(f.service.resume(records[0]!.result.upload_task_id)).rejects.toThrow(/正在改传/);
    await expect(f.service.cancel(records[0]!.result.upload_task_id)).rejects.toThrow(/正在改传/);
    await f.service.stop(); release(); await rejected;
    expect(await readFile(path.join(f.store.root, "state.json"))).toEqual(before); expect(f.groups).toEqual([]); expect(f.store.unavailable).toBe(false);
  });
  it("rejects retarget while an existing group is still processing", async () => {
    const f = await fixture(), batch = await f.batch(2), records = await f.admit(batch);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; }), ready = f.port.ready;
    f.port.ready = async (tasks, signal) => { enter(); await gate; return ready(tasks, signal); };
    const running = f.service.resume(records[0]!.result.upload_task_id); await entered;
    await expect(f.service.retarget(records[0]!.result.upload_task_id, "888888")).rejects.toThrow(/仍在运行/);
    release(); await running; expect(f.groups.map(g => g.length)).toEqual([2]);
  });
});
