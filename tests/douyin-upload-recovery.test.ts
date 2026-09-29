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
  return { root, accounts, store, service, dependencies, port, groups, checks, batch, admit, pause, useStore: (value: DouyinUploadStore) => { browserStore = value; } };
}

describe("explicit Qianchuan batch recovery", () => {
  it("resumes twenty outputs admitted while paused in 9/9/2 groups and leaves other accounts and batches untouched", async () => {
    const f = await fixture(), blocker = await f.pause(), target = await f.batch(20);
    const sameAccount = await f.batch(2), otherAccount = await f.batch(2, "氨糖膏");
    const records = await f.admit(target); await f.admit(sameAccount); await f.admit(otherAccount);
    await f.service.runPending(); expect(f.groups).toEqual([]);
    await f.service.resume(records[0]!.result.upload_task_id);
    expect(f.groups.map(group => group.length)).toEqual([9, 9, 2]);
    expect(f.service.status(target.projectId).tasks.every(task => task.state === "WAITING_FOR_CONFIRMATION")).toBe(true);
    for (const project of [sameAccount, otherAccount]) expect(f.service.status(project.projectId).tasks.every(task => task.state === "PENDING" && task.upload_outcome === "NOT_SELECTED")).toBe(true);
    expect(f.service.status(blocker.projectId).tasks[0]!.state).toBe("NEEDS_HUMAN");
    expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(20);
    const lateOther = await f.batch(1, "氨糖膏"); await f.service.committed(lateOther.identities[0]!); await f.service.runPending();
    expect(f.groups.map(group => group.length)).toEqual([9, 9, 2]);
  });

  it("does not advance while the whole first group is processing or its READY saves are incomplete", async () => {
    const f = await fixture(); await f.pause(); const target = await f.batch(12), records = await f.admit(target);
    let releaseReady!: () => void, releaseSave!: () => void;
    const readyGate = new Promise<void>(resolve => { releaseReady = resolve; }), saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const ready = f.port.ready, save = f.store.saveTask.bind(f.store); let saving = false;
    f.port.ready = async (tasks, signal) => { if (f.groups.length === 1) await readyGate; return ready(tasks, signal); };
    f.store.saveTask = async task => {
      if (task.result.upload_task_id === records[4]!.result.upload_task_id && task.result.state === "WAITING_FOR_CONFIRMATION") { saving = true; await saveGate; }
      await save(task);
    };
    const resumed = f.service.resume(records[0]!.result.upload_task_id);
    try {
      await vi.waitFor(() => expect(f.groups[0]).toHaveLength(9)); expect(f.groups).toHaveLength(1);
      expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(9);
      releaseReady(); await vi.waitFor(() => expect(saving).toBe(true));
      expect(f.groups).toHaveLength(1); expect(f.service.status(target.projectId).tasks.filter(task => task.state === "WAITING_FOR_CONFIRMATION")).toHaveLength(4);
      releaseSave(); await resumed; expect(f.groups.map(group => group.length)).toEqual([9, 3]);
    } finally { releaseReady(); releaseSave(); await resumed; }
  });

  it("one explicit continue restores all members of a group that failed before any selection fence", async () => {
    const f = await fixture(), target = await f.batch(12), records = await f.admit(target), open = f.port.open;
    f.port.open = async () => { throw uploadFailure("CAPACITY_INSUFFICIENT", "page", "容量不足。", "人工处理容量。", true); };
    await f.service.runPending(); expect(f.service.status(target.projectId).tasks.filter(task => task.state === "NEEDS_HUMAN")).toHaveLength(9);
    f.port.open = open; await f.service.resume(records[0]!.result.upload_task_id);
    expect(f.groups.map(group => group.length)).toEqual([9, 3]);
    expect(f.service.status(target.projectId).tasks.every(task => task.upload_outcome === "READY")).toBe(true);
  });

  it("an UNKNOWN group blocks remaining files; only original-page checks can resolve it and do not authorize new selections", async () => {
    const f = await fixture(), target = await f.batch(12), records = await f.admit(target), upload = f.port.upload;
    f.port.upload = async (tasks, signal) => { await upload(tasks, signal); throw new Error("disconnected after file action"); };
    await f.service.runPending(); const selected = records.slice(0, 9);
    const fenceFiles = await Promise.all(selected.map(task => readFile(path.join(f.store.root, "selection-fences", `${task.result.upload_task_id}.json`))));
    await expect(f.service.resume(records[9]!.result.upload_task_id)).rejects.toThrow("未解决");
    expect(f.groups.map(group => group.length)).toEqual([9]);
    await f.service.resume(records[0]!.result.upload_task_id);
    expect(f.checks).toHaveLength(9); expect(f.groups.map(group => group.length)).toEqual([9]);
    expect(f.service.status(target.projectId).tasks.filter(task => task.state === "PENDING")).toHaveLength(3);
    for (let index = 0; index < selected.length; index++) expect(await readFile(path.join(f.store.root, "selection-fences", `${selected[index]!.result.upload_task_id}.json`))).toEqual(fenceFiles[index]);
    f.port.upload = upload; await f.service.resume(records[9]!.result.upload_task_id);
    expect(f.groups.map(group => group.length)).toEqual([9, 3]);
  });

  it("restart performs no browser work until explicit continue then recovers only that persisted batch", async () => {
    const f = await fixture(); await f.pause(); const target = await f.batch(12), records = await f.admit(target), other = await f.batch(2); await f.admit(other);
    const reopened = new DouyinUploadStore(f.store.root); await reopened.load();
    f.useStore(reopened);
    const recovered = new DouyinUploadService(reopened, f.dependencies);
    await recovered.reconcile(); await recovered.runPending(); expect(f.groups).toEqual([]);
    await recovered.resume(records[0]!.result.upload_task_id);
    expect(f.groups.map(group => group.length)).toEqual([9, 3]);
    expect(recovered.status(target.projectId).tasks.every(task => task.upload_outcome === "READY")).toBe(true);
    expect(recovered.status(other.projectId).tasks.every(task => task.state === "PENDING")).toBe(true);
  });

  it("late committed outputs in the explicitly resumed batch continue and cancelled siblings stay cancelled", async () => {
    const f = await fixture(); await f.pause(); const target = await f.batch(4);
    const first = await f.service.enqueueFinalArtifact(target.identities[0]!);
    await f.service.committed(target.identities[1]!); const cancelled = f.store.tasks().find(task => task.input.export_task_id === target.identities[1]!.export_task_id)!;
    await f.service.cancel(cancelled.result.upload_task_id);
    await f.service.resume(first!.result.upload_task_id);
    await f.service.committed(target.identities[2]!); await f.service.committed(target.identities[3]!); await f.service.runPending();
    const results = f.service.status(target.projectId).tasks;
    expect(results.filter(task => task.upload_outcome === "READY")).toHaveLength(3);
    expect(results.find(task => task.upload_task_id === cancelled.result.upload_task_id)!.state).toBe("CANCELLED");
    expect(f.store.hasMarker(cancelled.result.upload_task_id)).toBe(false);
  });

  it("preserves the original-page diagnostic and every fence when a read-only recovery fails", async () => {
    const f = await fixture(), target = await f.batch(2), records = await f.admit(target);
    f.port.ready = async () => { throw new Error("lost after selection"); }; await f.service.runPending();
    const before = await Promise.all(records.map(task => readFile(path.join(f.store.root, "selection-fences", `${task.result.upload_task_id}.json`))));
    f.port.readOnlyCheck = async () => { throw uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "无法恢复原批次 tab。", "人工处理；不能新开页面重传。", true); };
    await f.service.resume(records[0]!.result.upload_task_id);
    for (const task of f.service.status(target.projectId).tasks) expect(task).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", failure: { code: "UPLOAD_OUTCOME_UNKNOWN", message: expect.stringContaining("原批次 tab"), next_action: expect.stringContaining("不能新开页面重传") } });
    for (let index = 0; index < records.length; index++) expect(await readFile(path.join(f.store.root, "selection-fences", `${records[index]!.result.upload_task_id}.json`))).toEqual(before[index]);
    expect(f.groups.map(group => group.length)).toEqual([2]);
  });

  it("checks the original READY page before remaining files and reports a lost page without opening a replacement", async () => {
    const f = await fixture(), target = await f.batch(3), first = await f.service.enqueueFinalArtifact(target.identities[0]!);
    await f.service.runPending(); await f.service.stop();
    const remaining = await f.admit(target, true), open = vi.spyOn(f.port, "open"); open.mockClear();
    f.port.readOnlyCheck = async () => { throw uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "原上传弹窗已丢失。", "人工核查；不能新开弹窗重传。", true); };
    await f.service.resume(remaining[1]!.result.upload_task_id);
    expect(open).not.toHaveBeenCalled(); expect(f.groups.map(group => group.length)).toEqual([1]);
    expect(f.store.task(first!.result.upload_task_id)!.result).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", failure: { message: expect.stringContaining("原上传弹窗已丢失") } });
    expect(f.store.task(remaining[1]!.result.upload_task_id)!.result).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "NOT_SELECTED", failure: { message: expect.stringContaining("剩余成片尚未选文件") } });
    expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(1);
  });

  it("keeps one runner while explicit continuation is still saving its batch eligibility", async () => {
    const f = await fixture(); await f.pause(); const target = await f.batch(12), records = await f.admit(target);
    const save = f.store.saveTask.bind(f.store); let entered = false, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.store.saveTask = async task => { if (task.result.upload_task_id === records[1]!.result.upload_task_id && task.result.state === "PENDING") { entered = true; await gate; } await save(task); };
    const resumed = f.service.resume(records[0]!.result.upload_task_id);
    try {
      await vi.waitFor(() => expect(entered).toBe(true)); await f.service.runPending(); expect(f.groups).toEqual([]);
      release(); await resumed; expect(f.groups.map(group => group.length)).toEqual([9, 3]);
    } finally { release(); await resumed; }
  });

  it("a stop during continuation preparation cannot leave late eligibility for a later production batch", async () => {
    const f = await fixture(); await f.pause(); const target = await f.batch(3), records = await f.admit(target);
    const save = f.store.saveTask.bind(f.store); let entered = false, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.store.saveTask = async task => { if (task.result.upload_task_id === records[1]!.result.upload_task_id && task.result.state === "PENDING") { entered = true; await gate; } await save(task); };
    const resumed = f.service.resume(records[0]!.result.upload_task_id);
    try {
      await vi.waitFor(() => expect(entered).toBe(true)); await f.service.stop(); release(); await resumed;
      const fresh = await f.batch(1, "氨糖膏"); await f.service.committed(fresh.identities[0]!); await f.service.runPending();
      expect(f.groups).toHaveLength(1); expect(f.service.status(fresh.projectId).tasks[0]!.upload_outcome).toBe("READY");
      expect(f.service.status(target.projectId).tasks.every(task => task.upload_outcome === "NOT_SELECTED")).toBe(true);
    } finally { release(); await resumed; }
  });

  it.each([1, 2])("preserves cancellation of item %i during continuation preparation until that item is explicitly resumed", async cancelledIndex => {
    const f = await fixture(); await f.pause(); const target = await f.batch(3), records = await f.admit(target);
    const save = f.store.saveTask.bind(f.store); let entered = false, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.store.saveTask = async task => { if (task.result.upload_task_id === records[1]!.result.upload_task_id && task.result.state === "PENDING") { entered = true; await gate; } await save(task); };
    const cancelledId = records[cancelledIndex]!.result.upload_task_id, resumed = f.service.resume(records[0]!.result.upload_task_id);
    try {
      await vi.waitFor(() => expect(entered).toBe(true)); await f.service.cancel(cancelledId);
      expect(f.store.task(cancelledId)!.result.state).toBe("CANCELLED");
      release(); await resumed;
      expect(f.store.task(cancelledId)!.result).toMatchObject({ state: "CANCELLED", upload_outcome: "NOT_SELECTED" });
      expect(f.store.hasMarker(cancelledId)).toBe(false); expect(f.groups.flat()).not.toContain(cancelledId);
      expect(f.groups.map(group => group.length)).toEqual([2]);
      await f.service.resume(cancelledId);
      expect(f.store.task(cancelledId)!.result.upload_outcome).toBe("READY");
      expect(f.groups.map(group => group.length)).toEqual([2, 1]);
    } finally { release(); await resumed; }
  });

  it("keeps a pending item cancelled when the preceding original-page check fails", async () => {
    const f = await fixture(), target = await f.batch(2);
    await f.service.enqueueFinalArtifact(target.identities[0]!); await f.service.runPending(); await f.service.stop();
    const records = await f.admit(target, true), cancelledId = records[1]!.result.upload_task_id;
    let entered = false, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    f.port.readOnlyCheck = async () => { entered = true; await gate; throw uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "原弹窗丢失。", "人工核查。", true); };
    const resumed = f.service.resume(cancelledId);
    try {
      await vi.waitFor(() => expect(entered).toBe(true)); await f.service.cancel(cancelledId); release(); await resumed;
      expect(f.store.task(cancelledId)!.result).toMatchObject({ state: "CANCELLED", upload_outcome: "NOT_SELECTED" });
      expect(f.store.hasMarker(cancelledId)).toBe(false); expect(f.groups.map(group => group.length)).toEqual([1]);
    } finally { release(); await resumed; }
  });
});
