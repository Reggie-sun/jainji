import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DouyinUploadStore, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";
import { QianchuanBrowserManager } from "../src/main/qianchuan-browser-manager";
import { QianchuanVideoLibrary } from "../src/main/qianchuan-video-library";
import { QianchuanPlanMaterials } from "../src/main/qianchuan-plan-materials";
import { BATCH_SCHEMA_VERSION, DEFAULT_PRESET, QUEUE_SCHEMA_VERSION, createDefaultTemplate, now, type QueueState } from "../src/main/domain";
import { QIANCHUAN_PRODUCTS, type QianchuanProduct } from "../src/shared/qianchuan-account";
import type { PageOwnership, ReadyEvidence, UploadAuthorization, UploadIdentity, QianchuanUploadSelection } from "../src/shared/douyin-upload";
import { uploadFailure } from "../src/shared/douyin-upload";

const selection = (accountProduct: QianchuanProduct): QianchuanUploadSelection => ({ enabled: true, accountProduct });
const temporaryRoots = new Set<string>();
beforeEach(() => {
  vi.spyOn(QianchuanBrowserManager.prototype, "prepareExisting").mockRejectedValue(new Error("Fixture account browser is closed"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all([...temporaryRoots].map(root => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

function accountDocument() {
  return {
    version: 1,
    accounts: QIANCHUAN_PRODUCTS.map((product, index) => ({
      product,
      cdpEndpoint: `http://127.0.0.1:${11000 + index}`,
      advertiserId: String(1000 + index),
      adId: String(2000 + index),
    })),
  };
}

async function fixture(browser?: () => UploadBrowserPort) {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-service-"));
  temporaryRoots.add(root);
  const outputDirectory = path.join(root, "formal-output");
  await mkdir(outputDirectory);
  const configPath = path.join(root, "accounts.json");
  await writeFile(configPath, JSON.stringify(accountDocument()), { mode: 0o600 });

  const store = new DouyinUploadStore(path.join(root, "private"));
  await store.load();
  const accounts = new QianchuanAccountConfigReader();
  const states = new Map<string, QueueState>();
  const events: string[] = [];
  const ownershipByBatch = new Map<string, PageOwnership>();
  const port: UploadBrowserPort = {
    connect: async (_task, signal) => { signal.throwIfAborted(); events.push("connect"); },
    open: async (tasks, selectedFiles, signal) => {
      const task = tasks[0]!;
      signal.throwIfAborted(); events.push("open");
      let ownership = ownershipByBatch.get(task.authorization.pageBatchId);
      if (!ownership) {
        ownership = { targetId: `fixture-${randomUUID()}`, pageBatchId: task.authorization.pageBatchId, modalSessionId: randomUUID() };
        ownershipByBatch.set(task.authorization.pageBatchId, ownership);
      }
      return { pageOwnership: ownership, selectedIndex: selectedFiles.length + 1 };
    },
    upload: async (tasks, signal) => {
      signal.throwIfAborted();
      for (const task of tasks) {
      const fencePath = path.join(store.root, "selection-fences", `${task.result.upload_task_id}.json`);
      const fence = JSON.parse(await readFile(fencePath, "utf8")) as { upload_task_id: string; artifact_sha256: string; pageOwnership: PageOwnership };
      expect(fence.upload_task_id).toBe(task.result.upload_task_id);
      expect(fence.artifact_sha256).toBe(task.input.artifact_sha256);
      expect(fence.pageOwnership.pageBatchId).toBe(task.authorization.pageBatchId);
      expect((await stat(fencePath)).mode & 0o777).toBe(0o600);
      expect(store.hasMarker(task.result.upload_task_id)).toBe(true);
      expect(await readFile(task.snapshotPath, "utf8")).toBe(await readFile(task.input.video_path, "utf8"));
      }
      events.push("file-input");
    },
    ready: async tasks => {
      events.push("ready");
      return tasks.map(task => {
        const ownership = store.fence(task.result.upload_task_id)!.pageOwnership;
        const count = store.tasks().filter(other => other.authorization.pageBatchId === task.authorization.pageBatchId && store.hasMarker(other.result.upload_task_id)).length;
        return evidenceFor(task, ownership, count);
      });
    },
    pollReady: async (tasks, signal) => port.ready(tasks, signal),
    readOnlyCheck: async (task, ownership, files) => {
      events.push("readonly");
      expect(files.some(file => file.fileName === task.result.file_name && file.index === store.fence(task.result.upload_task_id)!.selectedIndex)).toBe(true);
      return evidenceFor(task, ownership, store.fence(task.result.upload_task_id)!.selectedIndex);
    },
    stop: async () => { events.push("stop"); },
  };
  const service = new DouyinUploadService(store, {
    loadBatch: async id => {
      const state = states.get(id);
      if (!state) throw new Error("fixture batch missing");
      return structuredClone(state);
    },
    browser: browser ?? (() => port),
    accounts,
    readiness: () => undefined,
  });

  async function authorize() {
    await service.chooseConfig(configPath);
    await service.configure({ enabled: true });
  }

  async function createBatch(contents: string[], options: {
    product?: QianchuanProduct;
    completed?: boolean;
    formalArtifact?: boolean;
  } = {}) {
    const product = options.product ?? "眼贴";
    const projectId = randomUUID();
    const batchId = randomUUID();
    const tasks: QueueState["batch"]["tasks"] = [];
    const identities: UploadIdentity[] = [];
    for (const content of contents) {
      const taskId = randomUUID();
      const video = path.join(outputDirectory, `${taskId}.mp4`);
      await writeFile(video, content);
      const task: QueueState["batch"]["tasks"][number] = {
        id: taskId, batchId, mediaId: randomUUID(), status: options.completed === false ? "failed" : "completed",
        progress: options.completed === false ? 0 : 1, attempt: 1, createdAt: now(), attempts: [], outputPath: video,
        ...(options.formalArtifact === false ? {} : { outputArtifact: { taskId, path: video, sizeBytes: Buffer.byteLength(content), durationMs: 1000, createdAt: now() } }),
      };
      tasks.push(task);
      identities.push({ project_id: projectId, batch_id: batchId, export_task_id: taskId });
    }
    const batch: QueueState["batch"] = {
      schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId, templateSnapshot: createDefaultTemplate(), mediaIds: [],
      outputDirectory, preset: DEFAULT_PRESET, status: "completed", estimatedBytes: 0, createdAt: now(), tasks,
    };
    states.set(batchId, { schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, batch, updatedAt: now() });
    const batchIdentity = { id: batchId, projectId, tasks: tasks.map(task => ({ id: task.id })) };
    return { projectId, batchId, batchIdentity, identities, tasks, product };
  }

  async function register(batch: Awaited<ReturnType<typeof createBatch>>, product = batch.product): Promise<UploadAuthorization> {
    const selected = selection(product);
    const authorization = await service.preflight(selected, batch.identities.length);
    if (!authorization) throw new Error("fixture selection unexpectedly disabled");
    await service.registerBatch(batch.batchIdentity, selected, authorization);
    return authorization;
  }

  return { root, configPath, outputDirectory, store, accounts, states, events, ownershipByBatch, port, service, authorize, createBatch, register };
}

function evidenceFor(task: UploadTaskRecord, pageOwnership: PageOwnership, selectedCount: number): ReadyEvidence {
  return {
    advertiserId: task.authorization.target.advertiserId,
    adId: task.authorization.target.adId,
    fileName: task.result.file_name,
    selectedCount,
    observedAt: new Date().toISOString(),
    pageOwnership,
  };
}

describe("Qianchuan upload service", () => {
  it("uses one fresh ledger snapshot for each status without exposing or caching mutable records", async () => {
    const f = await fixture(); await f.authorize();
    const current = await f.createBatch(["current"]), other = await f.createBatch(["other"]);
    for (const batch of [current, other]) { await f.register(batch); await f.service.enqueueFinalArtifact(batch.identities[0]!); }
    const records = vi.spyOn(f.store, "tasks");
    const first = f.service.status(current.projectId);
    expect(records).toHaveBeenCalledTimes(1);
    expect(first.tasks).toHaveLength(1);
    expect(first.tasks[0].project_id).toBe(current.projectId);
    const taskId = first.tasks[0].upload_task_id, fileName = first.tasks[0].file_name;
    first.tasks[0].file_name = "caller mutation"; first.batches![0].taskIds.length = 0;
    const task = f.store.task(taskId)!;
    await f.store.saveTask({ ...task, result: { ...task.result, state: "CANCELLED", retryable: false } });
    records.mockClear();
    const next = f.service.status(current.projectId);
    expect(records).toHaveBeenCalledTimes(1);
    expect(next.tasks[0]).toMatchObject({ state: "CANCELLED", file_name: fileName });
    expect(next.batches![0].taskIds).toEqual([taskId]);
    expect(f.events).toEqual([]);
  });

  it("reuses the status snapshot for a pause caused by UNKNOWN in another project", async () => {
    const f = await fixture(); await f.authorize();
    const old = await f.createBatch(["old unknown"]); await f.register(old);
    f.port.ready = async () => { throw new Error("fixture unknown page"); };
    await f.service.enqueueFinalArtifact(old.identities[0]!); await f.service.runPending();
    const current = await f.createBatch(["current pending"]); await f.register(current);
    await f.service.enqueueFinalArtifact(current.identities[0]!);
    const before = [...f.events], records = vi.spyOn(f.store, "tasks");
    const status = f.service.status(current.projectId);
    expect(records).toHaveBeenCalledTimes(1);
    expect(status.ready).toBe(false);
    expect(status.message).toContain(old.projectId);
    expect(status.message).toContain("结果未知的文件禁止重传");
    expect(status.tasks).toHaveLength(1);
    expect(status.tasks[0].upload_outcome).toBe("NOT_SELECTED");
    expect(f.events).toEqual(before);
  });

  it("stays busy through queued artifact admission and returns idle after rejection", async () => {
    const f = await fixture(); await f.authorize();
    const batch = await f.createBatch(["busy admission"]); await f.register(batch);
    expect(f.service.busy).toBe(false);
    const first = f.service.enqueueFinalArtifact(batch.identities[0]!);
    const second = f.service.enqueueFinalArtifact(batch.identities[0]!);
    const admissionBusy = f.service.busy;
    await Promise.all([first, second]);
    expect(admissionBusy).toBe(true);
    expect(f.service.busy).toBe(false);
    const run = f.service.runPending();
    expect(f.service.busy).toBe(true);
    await run;
    expect(f.service.busy).toBe(false);
    const invalid = f.service.enqueueFinalArtifact({ ...batch.identities[0]!, export_task_id: "invalid" });
    expect(f.service.busy).toBe(true);
    await expect(invalid).rejects.toThrow();
    expect(f.service.busy).toBe(false);
  });
  it("isolates old UNKNOWN while preserving its result and fence, then stops on current UNKNOWN", async () => {
    const f = await fixture(); await f.authorize();
    const old = await f.createBatch(["old unknown"]); await f.register(old);
    f.port.ready = async () => { throw new Error("unknown original page"); };
    await f.service.enqueueFinalArtifact(old.identities[0]!); await f.service.runPending();
    const original = f.store.tasks()[0]!, fence = f.store.fence(original.result.upload_task_id);
    expect(original.result.upload_outcome).toBe("MAY_HAVE_UPLOADED");
    await f.service.beginProduction();
    const current = await f.createBatch(["new unknown", "later unselected"]); await f.register(current);
    await f.service.enqueueFinalArtifact(current.identities[0]!); await f.service.runPending();
    await f.service.enqueueFinalArtifact(current.identities[1]!); await f.service.runPending();
    expect(f.service.status(current.projectId).tasks.map(task => task.upload_outcome)).toEqual(["MAY_HAVE_UPLOADED", "NOT_SELECTED"]);
    expect(f.events.filter(event => event === "file-input")).toHaveLength(2);
    expect(f.store.task(original.result.upload_task_id)).toEqual(original);
    expect(f.store.fence(original.result.upload_task_id)).toEqual(fence);
    expect(f.service.status(old.projectId).tasks).toEqual([]);
    await expect(f.service.requestResume(original.result.upload_task_id)).rejects.toThrow("不属于本次制作");
  });

  it("admits multiple accounts and queue chunks into one production and clears historical pause", async () => {
    const f = await fixture(); await f.authorize();
    const old = await f.createBatch(["old failed"]); await f.register(old);
    f.port.ready = async () => { throw new Error("old unknown"); };
    await f.service.enqueueFinalArtifact(old.identities[0]!); await f.service.runPending();
    const ready = async (tasks: UploadTaskRecord[]) => tasks.map(task => evidenceFor(task, f.store.fence(task.result.upload_task_id)!.pageOwnership, f.store.tasks().filter(other => other.authorization.pageBatchId === task.authorization.pageBatchId && f.store.hasMarker(other.result.upload_task_id)).length));
    f.port.ready = ready;
    await f.service.beginProduction();
    const a = await f.createBatch(["a first"]), b = await f.createBatch(["b new"], { product: "肥皂" }), chunk = await f.createBatch(["a second"]);
    chunk.batchIdentity.projectId = a.projectId; chunk.identities[0]!.project_id = a.projectId; f.states.get(chunk.batchId)!.batch.projectId = a.projectId;
    const authorization = await f.service.preflight(selection("眼贴"), 2);
    await f.service.registerBatch(a.batchIdentity, selection("眼贴"), authorization);
    await f.service.registerBatch(chunk.batchIdentity, selection("眼贴"), authorization);
    await f.register(b);
    for (const identity of [...a.identities, ...chunk.identities, ...b.identities]) await f.service.enqueueFinalArtifact(identity);
    await f.service.runPending();
    expect(f.service.status(a.projectId).tasks).toHaveLength(2);
    expect(f.service.status(b.projectId).tasks[0]!.upload_outcome).toBe("READY");
    expect(f.service.status(a.projectId).tasks.every(task => task.upload_outcome === "READY")).toBe(true);
    expect(f.events.filter(event => event === "file-input")).toHaveLength(3);
  });

  it("keeps historical same-target UNKNOWN bytes fenced across production boundaries", async () => {
    const f = await fixture(); await f.authorize();
    const old = await f.createBatch(["same bytes"]); await f.register(old);
    f.port.ready = async () => { throw new Error("old unknown"); };
    await f.service.enqueueFinalArtifact(old.identities[0]!); await f.service.runPending();
    const original = f.store.tasks()[0]!;
    await f.service.beginProduction(); const before = [...f.events];
    const current = await f.createBatch(["same bytes"]); await f.register(current);
    await f.service.enqueueFinalArtifact(current.identities[0]!); await f.service.runPending();
    expect(f.service.status(current.projectId).tasks[0]).toMatchObject({ duplicate_of: original.result.upload_task_id, upload_outcome: "MAY_HAVE_UPLOADED" });
    expect(f.events).toEqual(before);
    expect(f.store.task(original.result.upload_task_id)).toEqual(original);
  });

  it("refuses a new production if stopping a prior browser fails", async () => {
    const f = await fixture(); await f.authorize();
    const old = await f.createBatch(["ready old"]); await f.register(old);
    await f.service.enqueueFinalArtifact(old.identities[0]!); await f.service.runPending();
    f.port.stop = async () => { throw new Error("detach failed"); };
    await expect(f.service.beginProduction()).rejects.toThrow("未能安全停止");
    f.port.stop = async () => {};
    await expect(f.service.beginProduction()).rejects.toThrow("未能安全停止");
    expect(f.service.status(old.projectId).ready).toBe(false);
  });

  it("keeps failed detach fenced when enabling uploads and continuing pending members", async () => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const batch = await f.createBatch(["ready anchor", "pending later"]); await f.register(batch);
    await f.service.enqueueFinalArtifact(batch.identities[0]!); await f.service.runPending();
    const pending = await f.service.enqueueFinalArtifact(batch.identities[1]!);
    f.port.stop = async () => { throw new Error("detach failed"); };
    await expect(f.service.beginProduction()).rejects.toThrow("未能安全停止");
    await f.service.configure({ enabled: true }); const before = [...f.events];
    await expect(f.service.requestResume(pending!.result.upload_task_id)).rejects.toThrow("未能安全停止");
    await f.service.runPending(); expect(f.events).toEqual(before);
    expect(f.service.status(batch.projectId).ready).toBe(false);
    expect(f.store.hasMarker(pending!.result.upload_task_id)).toBe(false);
  });

  it("clears admission errors from a prior production without retrying its media", async () => {
    const f = await fixture(); await f.authorize();
    const old = await f.createBatch(["old failed admission"], { completed: false }); await f.register(old);
    await f.service.committed(old.identities[0]!);
    expect(f.service.status(old.projectId).ready).toBe(false);
    await f.service.beginProduction();
    const current = await f.createBatch(["new valid admission"]); await f.register(current);
    expect(f.service.status(current.projectId).ready).toBe(true);
    await f.service.enqueueFinalArtifact(current.identities[0]!); await f.service.runPending();
    expect(f.service.status(current.projectId).tasks[0]!.upload_outcome).toBe("READY");
    expect(f.store.tasks()).toHaveLength(1);
  });

  it("rejects continuation racing an automatic runner whose detach fails during target preflight", async () => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const batch = await f.createBatch(["automatic first", "manual second"]); await f.register(batch);
    const first = await f.service.enqueueFinalArtifact(batch.identities[0]!);
    const second = await f.service.enqueueFinalArtifact(batch.identities[1]!);
    let releaseAuto!: () => void, releaseResume!: () => void, calls = 0;
    const autoGate = new Promise<void>(resolve => { releaseAuto = resolve; });
    const resumeGate = new Promise<void>(resolve => { releaseResume = resolve; });
    const preflight = f.accounts.preflight.bind(f.accounts);
    vi.spyOn(f.accounts, "preflight").mockImplementation(async product => { calls++; if (calls === 1) await autoGate; else if (calls === 2) await resumeGate; return preflight(product); });
    f.port.open = async () => { throw new Error("page failed"); };
    f.port.stop = async () => { throw new Error("detach failed"); };
    const running = f.service.runPending(); await vi.waitFor(() => expect(calls).toBe(1));
    const continuation = f.service.requestResume(second!.result.upload_task_id).then(() => "accepted", () => "rejected");
    await new Promise(resolve => setTimeout(resolve, 10)); releaseAuto(); await running;
    const before = [...f.events]; releaseResume();
    expect(await continuation).toBe("rejected"); expect(f.events).toEqual(before);
    expect(f.store.hasMarker(first!.result.upload_task_id)).toBe(false);
  });

  it.each(["failure", "cancel"])("does not forget failed detach after %s removes the browser session", async mode => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const batch = await f.createBatch(["selected uncertain"]); await f.register(batch);
    let release!: () => void, waiting = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.port.ready = async () => { waiting = true; if (mode === "cancel") await gate; throw new Error("cannot observe ready"); };
    f.port.stop = async () => { throw new Error("detach failed"); };
    const task = await f.service.enqueueFinalArtifact(batch.identities[0]!);
    const running = f.service.runPending();
    if (mode === "cancel") { await vi.waitFor(() => expect(waiting).toBe(true)); await f.service.cancel(task!.result.upload_task_id); release(); }
    await running; const before = [...f.events];
    await expect(f.service.beginProduction()).rejects.toThrow("未能安全停止");
    await expect(f.service.preflight(selection("眼贴"), 1)).rejects.toThrow("未能安全停止");
    expect(f.events).toEqual(before); expect(f.store.tasks()[0]!.result.upload_outcome).toBe("MAY_HAVE_UPLOADED");
  });

  it("does not scan old media on startup and rejects preflight that crosses the production boundary", async () => {
    const f = await fixture(); await f.authorize();
    const old = await f.createBatch(["old never admitted"]); await f.register(old);
    const restarted = new DouyinUploadService(f.store, { accounts: f.accounts, browser: vi.fn(), loadBatch: vi.fn(() => { throw new Error("must not read old queue"); }) });
    await restarted.restoreConfig(); await restarted.beginProduction(); await restarted.reconcile();
    expect(restarted.status(old.projectId).tasks).toEqual([]); expect(f.store.tasks()).toEqual([]);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const preflight = f.accounts.preflight.bind(f.accounts);
    vi.spyOn(f.accounts, "preflight").mockImplementationOnce(async product => { await gate; return preflight(product); });
    const stale = restarted.preflight(selection("眼贴"), 1);
    const rejection = expect(stale).rejects.toThrow("上传控制已变化");
    await restarted.beginProduction(); release(); await rejection;
    await restarted.registerBatch(old.batchIdentity, selection("眼贴"), f.store.intents()[0]!.authorization);
    await restarted.committed(old.identities[0]!); expect(f.store.tasks()).toEqual([]);
  });

  it("scopes batch-production cancellation to exact project/task IDs, including late admission", async () => {
    const f = await fixture(); await f.authorize();
    const cancelled = await f.createBatch(["cancelled-late"]);
    const other = await f.createBatch(["unrelated-ready"]);
    await f.register(cancelled); await f.register(other);
    await f.service.cancelExports(cancelled.projectId, [...cancelled.identities, ...other.identities].map(item => item.export_task_id));
    await f.service.committed(cancelled.identities[0]);
    await f.service.committed(other.identities[0]); await f.service.runPending();
    expect(f.service.status(cancelled.projectId).tasks[0].state).toBe("CANCELLED");
    expect(f.service.status(other.projectId).tasks[0].state).toBe("WAITING_FOR_CONFIRMATION");
    expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(1);
  });

  it("removes cancelled eligibility before a delayed formal admission can become runnable", async () => {
    const f = await fixture(); await f.authorize(); const batch = await f.createBatch(["delayed"]); await f.register(batch);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const create = f.store.saveTask.bind(f.store);
    vi.spyOn(f.store, "saveTask").mockImplementationOnce(async task => { await gate; return create(task); });
    const committed = f.service.committed(batch.identities[0]);
    await vi.waitFor(() => expect(f.store.saveTask).toHaveBeenCalled());
    const cancel = f.service.cancelExports(batch.projectId, batch.identities.map(item => item.export_task_id));
    release(); await Promise.all([committed, cancel]); await f.service.runPending();
    expect(f.service.status(batch.projectId).tasks[0].state).toBe("CANCELLED"); expect(f.events).toEqual([]);
  });

  it("retains ready evidence and permanent fences when its production job is cancelled", async () => {
    const f = await fixture(); await f.authorize(); const batch = await f.createBatch(["already-ready"]); await f.register(batch);
    await f.service.committed(batch.identities[0]); await f.service.runPending();
    const before = f.store.tasks()[0]; const calls = [...f.events];
    await f.service.cancelExports(batch.projectId, batch.identities.map(item => item.export_task_id));
    expect(f.store.tasks()[0]).toEqual(before); expect(f.events).toEqual(calls);
    expect(f.store.hasMarker(before.result.upload_task_id)).toBe(true);
  });

  async function nativeFixture(discover: (id: string) => Promise<string> = async () => "http://127.0.0.1:9225", readPlans?: NonNullable<ConstructorParameters<typeof DouyinUploadService>[1]>["readPlans"]) {
    const f = await fixture();
    const service = new DouyinUploadService(f.store, { accounts: new QianchuanAccountSettings(f.store.root, discover), loadBatch: async id => structuredClone(f.states.get(id)!), browser: () => f.port, readiness: () => undefined, readPlans });
    await service.restoreConfig(); return { ...f, service };
  }
  it("clears each requested saved account through the library owner without changing upload records", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath);
    const before = f.store.tasks();
    const clear = vi.spyOn(QianchuanVideoLibrary.prototype, "clear").mockImplementation(async (target, guard) => {
      await guard();
      return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 20, message: "empty" };
    });
    const results = await f.service.clearVideoLibraries({ confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1003" }, { product: "肥皂", expectedAdvertiserId: "1004" }] });
    expect(results.map(result => result.advertiserId)).toEqual(["1003", "1004"]);
    expect(clear).toHaveBeenCalledTimes(2); expect(f.store.tasks()).toEqual(before); expect(f.events).toEqual([]);
    await expect(f.service.clearVideoLibraries({ confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: "眼贴", expectedAdvertiserId: "9999" }] })).rejects.toThrow("已变化");
    expect(clear).toHaveBeenCalledTimes(2);
  });
  it("clears independent accounts concurrently while retaining the shared operation until all finish", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath);
    let release!: () => void, entered!: () => void, count = 0;
    const hold = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(QianchuanVideoLibrary.prototype, "clear").mockImplementation(async (target, guard) => {
      if (++count === 2) entered();
      await hold; await guard();
      return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 20, message: "empty" };
    });
    const work = f.service.clearVideoLibraries({ confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1003" }, { product: "肥皂", expectedAdvertiserId: "1004" }] });
    try { await started; expect(f.service.busy).toBe(true); }
    finally { release(); }
    expect((await work).map(result => result.advertiserId)).toEqual(["1003", "1004"]);
    expect(f.service.busy).toBe(false);
  });
  it("runs only the explicitly requested plan cleanup and stops combined cleanup when its scope is blocked", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath);
    const events: string[] = [];
    const plans = vi.spyOn(QianchuanPlanMaterials.prototype, "clear").mockImplementation(async (target, guard) => {
      await guard(); events.push("plan");
      return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 3, message: "plan empty" };
    });
    const library = vi.spyOn(QianchuanVideoLibrary.prototype, "clear").mockImplementation(async target => {
      events.push("library"); return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 8, message: "empty" };
    });
    const accounts = [{ product: "眼贴", expectedAdvertiserId: "1003", expectedAdId: "2003" }];
    expect((await f.service.clearVideoLibraries({ confirmation: "DELETE_PLAN_MATERIALS", accounts }))[0].deletedCount).toBe(3);
    expect(library).not.toHaveBeenCalled();
    await f.service.clearVideoLibraries({ confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", accounts });
    expect(events).toEqual(["plan", "plan", "library"]);
    plans.mockImplementationOnce(async target => ({ product: target.product, advertiserId: target.advertiserId, state: "BLOCKED", deletedCount: 0, message: "unknown" }));
    expect((await f.service.clearVideoLibraries({ confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", accounts }))[0].state).toBe("BLOCKED");
    expect(library).toHaveBeenCalledTimes(1); expect(f.events).toEqual([]);
  });
  it("cleans an explicitly chosen non-default plan only after a fresh catalog check without saving the choice", async () => {
    const readPlans = vi.fn(async () => [{ advertiserId: "1003", adId: "9002", name: "另一个计划" }]);
    const f = await nativeFixture(undefined, readPlans); await f.service.chooseConfig(f.configPath);
    const mapping = path.join(f.store.root, "accounts", "mapping.json"), before = await readFile(mapping);
    const materials = vi.spyOn(QianchuanPlanMaterials.prototype, "clear").mockImplementation(async (target, guard) => {
      await guard(); return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 3, message: "empty" };
    });
    const library = vi.spyOn(QianchuanVideoLibrary.prototype, "clear");
    const account = { product: "眼贴", expectedAdvertiserId: "1003", expectedAdId: "9002", plan: { advertiserId: "1003", adId: "9002", name: "另一个计划" } };
    expect((await f.service.clearVideoLibraries({ confirmation: "DELETE_PLAN_MATERIALS", accounts: [account] }))[0].state).toBe("CLEARED");
    expect(materials.mock.calls[0][0]).toMatchObject({ advertiserId: "1003", adId: "9002" });
    expect(readPlans).toHaveBeenCalledTimes(1); expect(library).not.toHaveBeenCalled();
    expect(await readFile(mapping)).toEqual(before);
    readPlans.mockResolvedValueOnce([]);
    const blocked = await f.service.clearVideoLibraries({ confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", accounts: [account] });
    expect(blocked[0]).toMatchObject({ state: "BLOCKED", deletedCount: 0 });
    expect(blocked[0].message).toContain("计划已失效");
    expect(readPlans).toHaveBeenCalledTimes(2); expect(materials).toHaveBeenCalledTimes(1); expect(library).not.toHaveBeenCalled();
    readPlans.mockResolvedValueOnce([{ advertiserId: "9999", adId: "9002", name: "错误账号" }]);
    expect((await f.service.clearVideoLibraries({ confirmation: "DELETE_PLAN_MATERIALS", accounts: [account] }))[0].state).toBe("BLOCKED");
    expect(materials).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "ZERO_IMPRESSIONS_15D", "AUDIT_AND_ZERO_IMPRESSIONS_15D"])("revalidates all selected plans before serial cleanup and clears the library once after all plans: %s", async planMaterialRule => {
    const plans = ["9001", "9002", "9003"].map(adId => ({ advertiserId: "1003", adId, name: `计划 ${adId}` }));
    const readPlans = vi.fn(async () => plans);
    const f = await nativeFixture(undefined, readPlans); await f.service.chooseConfig(f.configPath);
    const mapping = path.join(f.store.root, "accounts", "mapping.json"), before = await readFile(mapping);
    const events: string[] = []; let active = 0;
    const materials = vi.spyOn(QianchuanPlanMaterials.prototype, "clear").mockImplementation(async (target, guard) => {
      expect(active++).toBe(0); await guard(); events.push(target.adId); await Promise.resolve(); active--;
      return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 3, message: "empty" };
    });
    const library = vi.spyOn(QianchuanVideoLibrary.prototype, "clear").mockImplementation(async target => {
      expect(active).toBe(0); events.push("library");
      return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 8, message: "library empty" };
    });
    const input = { confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", planMaterialRule, accounts: [{ product: "眼贴", expectedAdvertiserId: "1003", plans: plans.slice(0, 2) }] };
    expect((await f.service.clearVideoLibraries(input))[0]).toMatchObject({ state: "CLEARED", deletedCount: 14 });
    expect(events).toEqual(["9001", "9002", "library"]); expect(readPlans).toHaveBeenCalledTimes(1);
    expect(library).toHaveBeenCalledTimes(1); expect(await readFile(mapping)).toEqual(before);
    expect(materials.mock.calls.map(call => call[3])).toEqual([planMaterialRule, planMaterialRule]);
    readPlans.mockResolvedValueOnce([plans[0]]);
    expect((await f.service.clearVideoLibraries(input))[0]).toMatchObject({ state: "BLOCKED", deletedCount: 0 });
    expect(materials).toHaveBeenCalledTimes(2); expect(library).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "ZERO_IMPRESSIONS_15D", "AUDIT_AND_ZERO_IMPRESSIONS_15D"])("retains confirmed progress and stops remaining plans and combined library cleanup on a blocked plan: %s", async planMaterialRule => {
    const plans = ["9001", "9002", "9003"].map(adId => ({ advertiserId: "1003", adId, name: `计划 ${adId}` }));
    const f = await nativeFixture(undefined, async () => plans); await f.service.chooseConfig(f.configPath);
    const materials = vi.spyOn(QianchuanPlanMaterials.prototype, "clear").mockImplementation(async (target, guard) => {
      await guard(); return { product: target.product, advertiserId: target.advertiserId,
        state: target.adId === "9002" ? "BLOCKED" : "CLEARED", deletedCount: target.adId === "9002" ? 1 : 3,
        message: target.adId === "9002" ? "unknown confirmation" : "empty" };
    });
    const library = vi.spyOn(QianchuanVideoLibrary.prototype, "clear");
    const result = (await f.service.clearVideoLibraries({ confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", planMaterialRule, accounts: [{ product: "眼贴", expectedAdvertiserId: "1003", plans }] }))[0];
    expect(result).toMatchObject({ state: "BLOCKED", deletedCount: 4 });
    expect(result.message).toContain("9002"); expect(result.message).toContain("unknown confirmation");
    expect(materials.mock.calls.map(call => call[0].adId)).toEqual(["9001", "9002"]); expect(library).not.toHaveBeenCalled();
  });
  it("holds production and account edits until an aborted plan cleanup drains", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath);
    let entered!: () => void, release!: () => void, signal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(QianchuanPlanMaterials.prototype, "clear").mockImplementation(async (target, guard, parentSignal) => {
      signal = parentSignal; entered(); await hold; await guard();
      return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 0, message: "empty" };
    });
    const work = f.service.clearVideoLibraries({ confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1003", expectedAdId: "2003" }] });
    await started; let stopped = false;
    const stopping = f.service.stop().then(value => { stopped = true; return value; });
    try {
      await expect(f.service.beginProduction()).rejects.toThrow();
      await expect(f.service.saveAccount({ product: "眼贴", planUrl: "https://qianchuan.jinritemai.com/uni-prom?aavid=1003&adId=999" })).rejects.toThrow();
      expect(signal?.aborted).toBe(true); expect(stopped).toBe(false);
    } finally { release(); }
    expect(await stopping).toBe(true); expect((await work)[0].state).toBe("BLOCKED"); expect(f.service.busy).toBe(false);
  });
  it("excludes new production, account edits and browser controls while library deletion is active", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath);
    let release!: () => void, entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(QianchuanVideoLibrary.prototype, "clear").mockImplementation(async (target, guard) => {
      entered(); await pending; await guard();
      return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 0, message: "empty" };
    });
    const run = f.service.clearVideoLibraries({ confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1003" }] });
    await started;
    try {
      await expect(f.service.beginProduction()).rejects.toThrow("账号浏览器操作");
      await expect(f.service.saveAccount({ product: "眼贴", planUrl: "https://qianchuan.jinritemai.com/uni-prom?aavid=1003&adId=2003" })).rejects.toThrow("账号浏览器操作");
      await expect(f.service.controlAccountBrowser({ product: "眼贴", expectedAdvertiserId: "1003", action: "restart" })).rejects.toThrow("仍在运行");
      await expect(f.service.preflight(selection("眼贴"), 1)).rejects.toThrow("账号浏览器操作");
    } finally { release(); }
    expect((await run)[0].state).toBe("CLEARED"); expect(f.service.busy).toBe(false);
  });
  it("reports the actual account connection rejection without starting library deletion", async () => {
    const f = await nativeFixture(async () => { throw new Error("原账号浏览器进程不唯一"); });
    await f.service.chooseConfig(f.configPath);
    const clear = vi.spyOn(QianchuanVideoLibrary.prototype, "clear");
    const results = await f.service.clearVideoLibraries({ confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1003" }] });
    expect(results[0]).toMatchObject({ state: "BLOCKED", deletedCount: 0, message: "原账号浏览器进程不唯一" });
    expect(clear).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
  });
  it("aborts library transport and drains an in-flight account guard before stop returns", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath);
    const original = QianchuanAccountConfigReader.prototype.freeze;
    let armed = false, entered!: () => void, release!: () => void, signal: AbortSignal | undefined, confirmations = 0, stopped = false;
    const waiting = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(QianchuanAccountConfigReader.prototype, "freeze").mockImplementation(async function (this: QianchuanAccountConfigReader, ...args) {
      if (armed) { entered(); await hold; }
      return original.apply(this, args);
    });
    vi.spyOn(QianchuanVideoLibrary.prototype, "clear").mockImplementation(async (target, guard, parentSignal) => {
      signal = parentSignal; armed = true; await guard(); confirmations++;
      return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 1, message: "empty" };
    });
    const work = f.service.clearVideoLibraries({ confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1003" }] });
    await waiting;
    const stopping = f.service.stop().then(result => { stopped = true; return result; });
    try { await Promise.resolve(); expect(signal?.aborted).toBe(true); expect(stopped).toBe(false); }
    finally { release(); }
    expect(await stopping).toBe(true); expect(confirmations).toBe(0);
    expect((await work)[0].state).toBe("BLOCKED"); expect(f.service.busy).toBe(false);
  });
  it("rejects actual proof and retry IPC handlers before queue side effects during deletion", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath);
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(QianchuanVideoLibrary.prototype, "clear").mockImplementation(async (target, guard) => {
      entered(); await hold; await guard(); return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 0, message: "empty" };
    });
    const work = f.service.clearVideoLibraries({ confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1003" }] });
    await waiting;
    const { default: ts } = await import("typescript"), { runInNewContext } = await import("node:vm"), { z } = await import("zod");
    const source = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
    const tree = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
    const registration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "registerHandlers")!;
    const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
    const queue = { retry: vi.fn(async () => {}), createBatch: vi.fn(async () => ({ id: "batch", tasks: [{ id: "task" }] })), start: vi.fn() }, createDirectory = vi.fn(async () => {});
    runInNewContext(ts.transpileModule(registration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + "\nregisterHandlers();", {
      ipcMain: { handle: (name: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => handlers.set(name, handler) },
      z, uuidSchema: z.string().uuid(), UploadIdSchema: z.string(), registerBugFeedbackHandlers() {}, registerDecorationAssetHandlers() {}, assertTrustedSender() {}, assertProductionIdle() {},
      mainWindow: {}, stickerAssets: {}, uploadedStickers: {}, uploadedFrames: {},
      capabilities: { ready: true }, proofSchema: z.object({ mediaId: z.string().uuid() }), retrySchema: z.object({ taskIds: z.array(z.string().uuid()) }),
      douyinUpload: f.service, queue, service: { currentProject: { id: randomUUID(), mediaItems: [] }, activeTemplate: {}, getMedia: () => ({}) },
      app: { getPath: () => f.store.root }, path, mkdir: createDirectory, DEFAULT_PRESET, publicState: async () => ({}),
    });
    try {
      await expect(handlers.get("proof.render")!({}, { mediaId: randomUUID() })).rejects.toThrow("账号浏览器操作");
      await expect(handlers.get("export.retry")!({}, { taskIds: [randomUUID()] })).rejects.toThrow("账号浏览器操作");
      expect(queue.retry).not.toHaveBeenCalled(); expect(queue.createBatch).not.toHaveBeenCalled(); expect(queue.start).not.toHaveBeenCalled(); expect(createDirectory).not.toHaveBeenCalled();
    } finally { release(); await work; }
    await expect(handlers.get("proof.render")!({}, { mediaId: randomUUID() })).resolves.toEqual({ taskId: "task" });
    await expect(handlers.get("export.retry")!({}, { taskIds: [randomUUID()] })).resolves.toEqual({});
    expect(queue.createBatch).toHaveBeenCalledTimes(1); expect(queue.start).toHaveBeenCalledTimes(1); expect(queue.retry).toHaveBeenCalledTimes(1);
    expect(f.service.busy).toBe(false);
  });
  it.each(["http://127.0.0.1:9225", "ws://127.0.0.1:9225/devtools/browser/original", undefined])("protects another advertiser's old fenced upload in the same original process (%s)", async endpoint => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath); await f.service.configure({ enabled: true });
    const batch = await f.createBatch(["legacy advertiser draft"]), authorization = await f.service.preflight(selection("眼贴"), 1);
    await f.service.registerBatch(batch.batchIdentity, selection("眼贴"), authorization);
    await f.service.enqueueFinalArtifact(batch.identities[0]!); await f.service.runPending();
    const records = f.store.tasks(), fence = f.store.fence(records[0].result.upload_task_id);
    await f.service.saveAccount({ product: "眼贴", planUrl: "https://qianchuan.jinritemai.com/uni-prom?aavid=7777&adId=8888" });
    const shutdown = vi.fn();
    const control = vi.spyOn(QianchuanBrowserManager.prototype, "control").mockImplementation(async (_id, _action, ...extra: unknown[]) => {
      (extra[0] as ((browser: { endpoint?: string; profile: string }) => void) | undefined)?.({ endpoint, profile: "/original/shared" });
      shutdown();
    });
    const input = { product: "眼贴", expectedAdvertiserId: "7777", action: "close" };
    await expect(f.service.controlAccountBrowser(input)).rejects.toThrow("待确认或结果未知");
    expect(shutdown).not.toHaveBeenCalled(); expect(f.store.tasks()).toEqual(records); expect(f.store.fence(records[0].result.upload_task_id)).toEqual(fence);
    control.mockImplementation(async (_id, _action, ...extra: unknown[]) => {
      (extra[0] as ((browser: { endpoint: string; profile: string }) => void) | undefined)?.({ endpoint: "http://127.0.0.1:9226", profile: "/original/separate" });
      shutdown();
    });
    await f.service.controlAccountBrowser(input); expect(shutdown).toHaveBeenCalledTimes(1);
  });
  it("protects READY and UNKNOWN original-account windows across a new production boundary, without changing fences", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath); await f.service.configure({ enabled: true });
    const control = vi.spyOn(QianchuanBrowserManager.prototype, "control").mockResolvedValue();
    const batch = await f.createBatch(["protected browser bytes"]), authorization = await f.service.preflight(selection("眼贴"), 1);
    await f.service.registerBatch(batch.batchIdentity, selection("眼贴"), authorization);
    await f.service.enqueueFinalArtifact(batch.identities[0]!); await f.service.runPending();
    const before = f.store.tasks(), fence = f.store.fence(before[0].result.upload_task_id);
    const input = { product: "眼贴", expectedAdvertiserId: "1003", action: "close" };
    await expect(f.service.controlAccountBrowser(input)).rejects.toThrow("待确认或结果未知");
    await f.service.beginProduction(); expect(f.service.status(batch.projectId).tasks).toEqual([]);
    await expect(f.service.controlAccountBrowser({ ...input, action: "restart" })).rejects.toThrow("待确认或结果未知");
    expect(control).not.toHaveBeenCalled(); expect(f.store.tasks()).toEqual(before); expect(f.store.fence(before[0].result.upload_task_id)).toEqual(fence);
    const unknown = { ...before[0], result: { ...before[0].result, state: "NEEDS_HUMAN" as const, upload_outcome: "MAY_HAVE_UPLOADED" as const, readyEvidence: undefined } };
    await f.store.saveTask(unknown);
    await expect(f.service.controlAccountBrowser(input)).rejects.toThrow("待确认或结果未知");
    expect(control).not.toHaveBeenCalled(); expect(f.store.fence(before[0].result.upload_task_id)).toEqual(fence);
    await f.service.controlAccountBrowser({ product: "肥皂", expectedAdvertiserId: "1004", action: "close" });
    expect(control).toHaveBeenCalledWith("1004", "close", expect.any(Function));
  });
  it("refuses browser controls while an account is preparing or producing unadmitted exports", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath); await f.service.configure({ enabled: true });
    const control = vi.spyOn(QianchuanBrowserManager.prototype, "control").mockResolvedValue();
    const prepare = QianchuanAccountSettings.prototype.prepare;
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(QianchuanAccountSettings.prototype, "prepare").mockImplementation(async function (this: QianchuanAccountSettings, product) { await wait; return prepare.call(this, product); });
    const preflight = f.service.preflight(selection("眼贴"), 1);
    await expect(f.service.controlAccountBrowser({ product: "眼贴", expectedAdvertiserId: "1003", action: "restart" })).rejects.toThrow("仍在运行");
    release(); const authorization = await preflight;
    const batch = await f.createBatch(["export awaiting notification"]);
    await f.service.registerBatch(batch.batchIdentity, selection("眼贴"), authorization);
    await expect(f.service.controlAccountBrowser({ product: "眼贴", expectedAdvertiserId: "1003", action: "restart" })).rejects.toThrow("制作中");
    expect(control).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
  });
  it("protects the export admission gap after preflight and releases it after failure", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath); await f.service.configure({ enabled: true });
    const control = vi.spyOn(QianchuanBrowserManager.prototype, "control").mockResolvedValue();
    let release!: () => void;
    const pathCheck = new Promise<void>(resolve => { release = resolve; });
    const preflightDone = vi.fn();
    const work = f.service.withExportAdmission(async () => {
      await f.service.beginProduction();
      await f.service.preflight(selection("眼贴"), 1);
      preflightDone();
      await pathCheck;
      throw new Error("output directory refused");
    });
    const failed = expect(work).rejects.toThrow("output directory refused");
    await vi.waitFor(() => expect(preflightDone).toHaveBeenCalledTimes(1));
    await expect(f.service.controlAccountBrowser({ product: "眼贴", expectedAdvertiserId: "1003", action: "restart" })).rejects.toThrow("仍在运行");
    expect(control).not.toHaveBeenCalled(); expect(f.store.intents()).toEqual([]);
    release(); await failed;
    await f.service.controlAccountBrowser({ product: "眼贴", expectedAdvertiserId: "1003", action: "close" });
    expect(control).toHaveBeenCalledTimes(1);
  });
  it("holds the upload control during browser shutdown and permits explicit close after local batch closure", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath); await f.service.configure({ enabled: true });
    const batch = await f.createBatch(["locally closed browser bytes"]), authorization = await f.service.preflight(selection("眼贴"), 1);
    await f.service.registerBatch(batch.batchIdentity, selection("眼贴"), authorization);
    await f.service.enqueueFinalArtifact(batch.identities[0]!); await f.service.runPending();
    await f.service.closeBatch(f.store.tasks()[0].result.upload_task_id);
    const records = f.store.tasks(), fence = f.store.fence(records[0].result.upload_task_id), events = [...f.events];
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const control = vi.spyOn(QianchuanBrowserManager.prototype, "control").mockImplementation(async () => { await wait; });
    const work = f.service.controlAccountBrowser({ product: "眼贴", expectedAdvertiserId: "1003", action: "close" });
    await vi.waitFor(() => expect(control).toHaveBeenCalledTimes(1));
    expect(f.service.busy).toBe(true);
    const admit = vi.fn();
    await expect(f.service.withExportAdmission(admit)).rejects.toThrow("浏览器操作");
    expect(admit).not.toHaveBeenCalled();
    await expect(f.service.preflight(selection("眼贴"), 1)).rejects.toThrow("浏览器操作");
    await expect(f.service.beginProduction()).rejects.toThrow("浏览器操作");
    await expect(f.service.resume(records[0].result.upload_task_id)).rejects.toThrow("浏览器操作");
    await expect(f.service.controlAccountBrowser({ product: "肥皂", expectedAdvertiserId: "1004", action: "restart" })).rejects.toThrow("仍在运行");
    await f.service.runPending(); expect(f.events).toEqual(events);
    release(); await work;
    expect(f.service.busy).toBe(false); expect(f.store.tasks()).toEqual(records); expect(f.store.fence(records[0].result.upload_task_id)).toEqual(fence);
  });
  it("imports into app settings and restores without enabling upload, browser operations or an external dependency", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath);
    expect(f.store.config.accountConfigPath).not.toBe(f.configPath); expect(f.service.status("unused").accounts).toHaveLength(6);
    await rm(f.configPath);
    const reloaded = new DouyinUploadStore(f.store.root); await reloaded.load();
    const service = new DouyinUploadService(reloaded, { loadBatch: async id => f.states.get(id)!, browser: () => f.port });
    await service.restoreConfig(); expect(service.status("unused").accounts).toHaveLength(6);
    expect(reloaded.config.enabled).toBe(false); expect(reloaded.tasks()).toEqual([]); expect(reloaded.intents()).toEqual([]); expect(f.events).toEqual([]);
  });
  it("sets up an account from a link while requiring explicit global and per-batch enablement", async () => {
    const f = await nativeFixture();
    await f.service.saveAccount({ product: "眼贴", planUrl: "https://qianchuan.jinritemai.com/uni-prom?aavid=9007199254740993&adId=9007199254740995" });
    await expect(f.service.preflight(selection("眼贴"), 1)).rejects.toThrow("启用千川上传");
    await f.service.configure({ enabled: true }); expect(await f.service.preflight(undefined, 1)).toBeUndefined();
    expect((await f.service.preflight(selection("眼贴"), 1))?.target).toMatchObject({ advertiserId: "9007199254740993", adId: "9007199254740995", cdpEndpoint: "http://127.0.0.1:9225" });
    expect(f.events).toEqual([]); expect(f.store.tasks()).toEqual([]);
  });
  it("keeps the frozen identity but blocks selection until explicit retarget after settings change", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath); await f.service.configure({ enabled: true });
    const batch = await f.createBatch(["native settings frozen bytes"]);
    const authorization = await f.service.preflight(selection("眼贴"), 1);
    await f.service.registerBatch(batch.batchIdentity, selection("眼贴"), authorization);
    await f.service.saveAccount({ product: "眼贴", planUrl: "https://qianchuan.jinritemai.com/uni-prom?aavid=1003&adId=9999" });
    expect(f.store.intents()[0].authorization.target.adId).toBe("2003");
    expect((await f.service.preflight(selection("眼贴"), 1))?.target.adId).toBe("9999");
    await f.service.enqueueFinalArtifact(batch.identities[0]!); await f.service.runPending();
    expect(f.service.status(batch.projectId).tasks[0]).toMatchObject({ adId: "2003", state: "NEEDS_HUMAN", upload_outcome: "NOT_SELECTED", failure: { code: "INPUT_CONFLICT" } });
    expect(f.events).toEqual([]);
    expect(f.store.hasMarker(f.service.status(batch.projectId).tasks[0]!.upload_task_id)).toBe(false);
  });
  it("keeps frozen authorization and fences across a settings rename, restart and same-byte new batch", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath); await f.service.configure({ enabled: true });
    const planUrl = "https://qianchuan.jinritemai.com/uni-prom?aavid=1003&adId=2003";
    await f.service.saveAccount({ product: "眼贴", productName: "首轮产品", planUrl });
    const batch = await f.createBatch(["name-stable bytes"]), authorization = await f.service.preflight(selection("眼贴"), 1);
    await f.service.registerBatch(batch.batchIdentity, selection("眼贴"), authorization);
    await f.service.enqueueFinalArtifact(batch.identities[0]!); await f.service.runPending();
    const old = structuredClone(f.store.tasks()[0]!), intents = structuredClone(f.store.intents()), calls = [...f.events];
    const fencePath = path.join(f.store.root, "selection-fences", `${old.result.upload_task_id}.json`), fence = await readFile(fencePath);
    await f.service.saveAccount({ product: "眼贴", productName: "后续产品", planUrl });
    expect(f.store.tasks()[0]).toEqual(old); expect(f.store.intents()).toEqual(intents); expect(await readFile(fencePath)).toEqual(fence);
    expect((await f.service.preflight(selection("眼贴"), 1))?.target).toMatchObject({ productName: "后续产品", cdpEndpoint: old.authorization.target.cdpEndpoint, advertiserId: "1003", adId: "2003" });
    const reopened = new DouyinUploadStore(f.store.root); await reopened.load();
    const restored = new DouyinUploadService(reopened, { accounts: new QianchuanAccountSettings(f.store.root, async () => "http://127.0.0.1:9225"), loadBatch: async id => structuredClone(f.states.get(id)!), browser: () => f.port, readiness: () => undefined });
    await restored.restoreConfig();
    expect(reopened.task(old.result.upload_task_id)).toEqual(old); expect(reopened.intents()).toEqual(intents);
    expect(restored.status(batch.projectId).accounts.find(account => account.product === "眼贴")?.productName).toBe("后续产品");
    expect(f.events).toEqual(calls); expect(await readFile(fencePath)).toEqual(fence);
    const next = await f.createBatch(["name-stable bytes"]), nextAuthorization = await restored.preflight(selection("眼贴"), 1);
    await restored.registerBatch(next.batchIdentity, selection("眼贴"), nextAuthorization);
    await restored.enqueueFinalArtifact(next.identities[0]!); await restored.runPending();
    expect(restored.status(next.projectId).tasks[0]).toMatchObject({ duplicate_of: old.result.upload_task_id, upload_outcome: "READY" });
    expect(f.events).toEqual(calls); expect(reopened.task(old.result.upload_task_id)).toEqual(old);
  });
  it("rejects changed mapping between preflight and admission without saving intents or opening browsers", async () => {
    const f = await nativeFixture(); await f.service.chooseConfig(f.configPath); await f.service.configure({ enabled: true });
    const batch = await f.createBatch(["changed native mapping"]), authorization = await f.service.preflight(selection("眼贴"), 1);
    await f.service.saveAccount({ product: "眼贴", planUrl: "https://qianchuan.jinritemai.com/uni-prom?aavid=1003&adId=9999" });
    await f.service.registerBatch(batch.batchIdentity, selection("眼贴"), authorization);
    expect(f.store.intents()).toEqual([]); expect(f.events).toEqual([]);
  });

  async function groupedFixture(contents = Array.from({ length: 21 }, (_, index) => `grouped formal bytes ${index}`), options: { processingTimeout?: number } = {}) {
    const f = await fixture();
    await f.authorize();
    if (options.processingTimeout) await f.service.configure({ enabled: true, timeouts: { processing: options.processingTimeout } });
    const batch = await f.createBatch(contents);
    await f.register(batch);
    for (const identity of batch.identities) await f.service.enqueueFinalArtifact(identity);
    const groups: string[][] = [];
    const owner: PageOwnership = { targetId: "grouped-tab", pageBatchId: f.store.tasks()[0]!.authorization.pageBatchId, modalSessionId: randomUUID() };
    f.port.open = async (_tasks: UploadTaskRecord[], selected) => ({ pageOwnership: owner, selectedIndex: selected.length + 1 });
    f.port.upload = async (tasks: UploadTaskRecord[], signal) => {
      signal.throwIfAborted();
      expect(tasks.length).toBeGreaterThan(0); expect(tasks.length).toBeLessThanOrEqual(9);
      for (const task of tasks) {
        const fence = JSON.parse(await readFile(path.join(f.store.root, "selection-fences", `${task.result.upload_task_id}.json`), "utf8"));
        expect(fence.pageOwnership).toEqual(owner);
        expect(fence.artifact_sha256).toBe(task.input.artifact_sha256);
        expect(await readFile(task.snapshotPath)).toEqual(await readFile(task.input.video_path));
      }
      const previous = groups.flat();
      expect(previous.every(id => ["WAITING_UPLOAD_COMPLETE", "WAITING_FOR_CONFIRMATION"].includes(f.store.task(id)!.result.state))).toBe(true);
      groups.push(tasks.map(task => task.result.upload_task_id));
    };
    f.port.ready = async (tasks: UploadTaskRecord[]) => tasks.map(task => evidenceFor(task, owner, groups.flat().length));
    return { ...f, batch, groups, owner };
  }

  it("selects 21 admitted outputs in 9+9+3 groups with every permanent fence durable before each delivery", async () => {
    const f = await groupedFixture();
    await f.service.runPending();
    expect(f.groups.map(group => group.length)).toEqual([9, 9, 3]);
    expect(f.store.tasks().every(task => task.result.state === "WAITING_FOR_CONFIRMATION")).toBe(true);
    expect(f.store.tasks().map(task => f.store.fence(task.result.upload_task_id)!.selectedIndex).sort((a, b) => a - b)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(new Set(f.store.tasks().map(task => task.result.readyEvidence!.pageOwnership.targetId))).toEqual(new Set(["grouped-tab"]));
  });

  it("continues selecting 9+9+3 while processing and saves READY only after the whole list finishes", async () => {
    const f = await groupedFixture();
    let completed = false;
    f.port.pollReady = async (tasks, signal) => completed ? f.port.ready(tasks, signal) : undefined;
    let releaseSave!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const saveTasks = f.store.saveTasks.bind(f.store);
    let blockedSave = false;
    f.store.saveTasks = async tasks => {
      if (tasks.every(task => task.result.state === "WAITING_FOR_CONFIRMATION" && task.result.readyEvidence?.selectedCount === 21)) { blockedSave = true; await saveGate; }
      await saveTasks(tasks);
    };
    const running = f.service.runPending();
    try {
      await vi.waitFor(() => expect(f.groups.map(group => group.length)).toEqual([9, 9, 3]), { timeout: 3000 });
      expect(f.store.tasks().filter(task => task.result.upload_outcome === "READY")).toHaveLength(0);
      completed = true;
      await vi.waitFor(() => expect(blockedSave).toBe(true), { timeout: 3000 });
      expect(f.store.tasks().filter(task => task.result.upload_outcome === "READY")).toHaveLength(0);
    } finally { completed = true; releaseSave(); await running; }
    expect(f.groups.map(group => group.length)).toEqual([9, 9, 3]);
    expect(f.store.tasks().every(task => task.result.readyEvidence?.selectedCount === 21)).toBe(true);
  }, 15_000);

  it("adds newly completed exports to the same page while previous files are processing", async () => {
    const f = await fixture(); await f.authorize();
    const batch = await f.createBatch(["initial", "later one", "later two"]); await f.register(batch);
    await f.service.enqueueFinalArtifact(batch.identities[0]!);
    let completed = false;
    f.port.pollReady = async (tasks, signal) => completed ? f.port.ready(tasks, signal) : undefined;
    const running = f.service.runPending();
    try {
      await vi.waitFor(() => expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(1));
      await f.service.committed(batch.identities[1]!); await f.service.committed(batch.identities[2]!);
      await vi.waitFor(() => expect(f.store.tasks().filter(task => task.result.state === "WAITING_UPLOAD_COMPLETE")).toHaveLength(3));
      expect(f.store.tasks().filter(task => task.result.upload_outcome === "READY")).toHaveLength(0);
      expect(new Set(f.store.tasks().map(task => f.store.fence(task.result.upload_task_id)!.pageOwnership.targetId)).size).toBe(1);
    } finally { completed = true; await running; }
    expect(f.store.tasks().every(task => task.result.readyEvidence?.selectedCount === 3)).toBe(true);
  });

  it("starts with one available output and streams up to nine without stopping at cumulative ten", async () => {
    const f = await fixture(); await f.authorize();
    const batch = await f.createBatch(Array.from({ length: 21 }, (_, index) => `streamed ${index}`)); await f.register(batch);
    const groups: number[] = [];
    const open = f.port.open;
    f.port.open = async (tasks, selected, signal) => {
      if (selected.length === 10) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "Fixture entrance disabled at ten", "Inspect original page", true);
      return open(tasks, selected, signal);
    };
    const upload = f.port.upload;
    f.port.upload = async (tasks, signal) => { await upload(tasks, signal); groups.push(tasks.length); };
    let completed = false;
    f.port.pollReady = async (tasks, signal) => completed ? f.port.ready(tasks, signal) : undefined;
    await f.service.enqueueFinalArtifact(batch.identities[0]!);
    const running = f.service.runPending();
    try {
      await vi.waitFor(() => expect(groups).toEqual([1]));
      for (const identity of batch.identities.slice(1, 10)) await f.service.committed(identity);
      await vi.waitFor(() => expect(groups.reduce((sum, count) => sum + count, 0)).toBe(9), { timeout: 3000 });
      for (const identity of batch.identities.slice(10)) await f.service.committed(identity);
      await vi.waitFor(() => expect(groups.reduce((sum, count) => sum + count, 0)).toBe(21), { timeout: 3000 });
      expect(groups.every(count => count >= 1 && count <= 9)).toBe(true);
      let selected = 0;
      expect(groups.map(count => selected += count)).not.toContain(10);
      expect(f.store.tasks().filter(task => task.result.upload_outcome === "READY")).toHaveLength(0);
      completed = true;
      await running;
      expect(f.store.tasks().every(task => task.result.readyEvidence?.selectedCount === 21)).toBe(true);
    } finally { await f.service.stop(); await running; }
  }, 15_000);

  it("uploads six available outputs immediately and appends three while the first six are still processing", async () => {
    const f = await fixture(); await f.authorize();
    const batch = await f.createBatch(Array.from({ length: 11 }, (_, index) => `status ${index}`)); await f.register(batch);
    for (const identity of batch.identities.slice(0, 6)) await f.service.enqueueFinalArtifact(identity);
    let completed = false;
    const groups: number[] = [], upload = f.port.upload;
    f.port.upload = async (tasks, signal) => { await upload(tasks, signal); groups.push(tasks.length); };
    f.port.pollReady = async (tasks, signal) => completed ? f.port.ready(tasks, signal) : undefined;
    const running = f.service.runPending();
    try {
      await vi.waitFor(() => expect(groups).toEqual([6]));
      expect(f.service.status(batch.projectId).message).not.toContain("等待本批更多成片");
      expect(f.store.tasks().every(task => task.result.upload_outcome === "MAY_HAVE_UPLOADED")).toBe(true);
      for (const identity of batch.identities.slice(6, 9)) await f.service.committed(identity);
      await vi.waitFor(() => expect(groups.slice(1).reduce((sum, count) => sum + count, 0)).toBe(3), { timeout: 2000 });
      expect(f.store.tasks().filter(task => task.result.upload_outcome === "READY")).toHaveLength(0);
      completed = true;
      await running;
      expect(f.service.status(batch.projectId).tasks.filter(task => task.upload_outcome === "READY")).toHaveLength(9);
    } finally { completed = true; await f.service.stop(); await running; }
  });

  it("persists group phases with 13 ledger commits for 21 files in 9+9+3 groups", async () => {
    const f = await groupedFixture();
    f.port.pollReady = async (tasks, signal) => tasks.length === 21 ? f.port.ready(tasks, signal) : undefined;
    const commit = vi.spyOn(f.store as unknown as { commit: (data: unknown) => Promise<void> }, "commit");
    await f.service.runPending();
    expect(f.groups.map(group => group.length)).toEqual([9, 9, 3]);
    expect(f.store.tasks().every(task => task.result.upload_outcome === "READY")).toBe(true);
    expect(commit).toHaveBeenCalledTimes(13);
  });

  it.each(["failed", "cancelled", "interrupted"] as const)("flushes a final partial group after an unadmitted export becomes %s", async status => {
    const f = await fixture(); await f.authorize();
    const batch = await f.createBatch(Array.from({ length: 11 }, (_, index) => `tail ${index}`)); await f.register(batch);
    f.states.get(batch.batchId)!.batch.tasks[10]!.status = "queued";
    for (const identity of batch.identities.slice(0, 9)) await f.service.enqueueFinalArtifact(identity);
    const groups: number[] = [], upload = f.port.upload;
    f.port.upload = async (tasks, signal) => { await upload(tasks, signal); groups.push(tasks.length); };
    await f.service.runPending();
    await f.service.enqueueFinalArtifact(batch.identities[9]!);
    const running = f.service.runPending();
    try {
      await new Promise(resolve => setTimeout(resolve, 120));
      expect(groups).toEqual([9]);
      expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(9);
      f.states.get(batch.batchId)!.batch.tasks[10]!.status = status;
      await running;
      expect(groups).toEqual([9, 1]);
      expect(f.store.tasks().every(task => task.result.upload_outcome === "READY")).toBe(true);
    } finally { await f.service.stop(); await running; }
  });

  it.each(["stop", "cancel exports", "timeout"] as const)("keeps the held tenth file unselected after %s", async action => {
    const f = await fixture(); await f.authorize();
    await f.service.configure({ enabled: true, timeouts: { processing: 350 } });
    const batch = await f.createBatch(Array.from({ length: 11 }, (_, index) => `held ${index}`)); await f.register(batch);
    for (const identity of batch.identities.slice(0, 9)) await f.service.enqueueFinalArtifact(identity);
    await f.service.runPending(); f.events.length = 0;
    await f.service.enqueueFinalArtifact(batch.identities[9]!);
    const running = f.service.runPending();
    await new Promise(resolve => setTimeout(resolve, 120));
    if (action === "stop") expect(await f.service.stop()).toBe(true);
    if (action === "cancel exports") await f.service.cancelExports(batch.projectId, [batch.identities[9]!.export_task_id]);
    await running;
    const task = f.store.tasks().find(task => task.input.export_task_id === batch.identities[9]!.export_task_id)!;
    expect(f.store.hasMarker(task.result.upload_task_id)).toBe(false);
    expect(task.result.upload_outcome).toBe("NOT_SELECTED");
    expect(f.events.filter(event => event !== "stop")).toEqual([]);
    expect(task.result.failure?.code).toBe(action === "timeout" ? "TIMEOUT" : "STOPPED");
    expect(f.service.busy).toBe(false);
  });

  it("safely continues a never-selected tenth after its wait times out without reselecting the first nine", async () => {
    const f = await fixture(); await f.authorize();
    await f.service.configure({ enabled: true, timeouts: { processing: 350 } });
    const batch = await f.createBatch(Array.from({ length: 11 }, (_, index) => `continue held ${index}`)); await f.register(batch);
    const groups: number[] = [], upload = f.port.upload;
    f.port.upload = async (tasks, signal) => { groups.push(tasks.length); await upload(tasks, signal); };
    f.port.readOnlyCheck = async (task, owner, files, signal) => { signal.throwIfAborted(); f.events.push("readonly"); return evidenceFor(task, owner, files.length); };
    for (const identity of batch.identities.slice(0, 9)) await f.service.enqueueFinalArtifact(identity);
    await f.service.runPending();
    const fences = f.store.tasks().map(task => f.store.fence(task.result.upload_task_id));
    const held = await f.service.enqueueFinalArtifact(batch.identities[9]!);
    await f.service.runPending();
    expect(f.store.task(held!.result.upload_task_id)?.result).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "NOT_SELECTED", failure: { code: "TIMEOUT", requires_human: true } });
    expect(f.store.hasMarker(held!.result.upload_task_id)).toBe(false);
    await f.service.committed(batch.identities[10]!);
    expect(groups).toEqual([9]);
    await f.service.resume(held!.result.upload_task_id);
    expect(groups).toEqual([9, 2]);
    expect(f.store.tasks().every(task => task.result.upload_outcome === "READY")).toBe(true);
    for (const fence of fences) expect(f.store.fence(fence!.upload_task_id)).toEqual(fence);
  });

  it("uploads a short group before later frozen queue chunks are registered", async () => {
    const f = await fixture(); await f.authorize();
    const first = await f.createBatch(["chunk first", "chunk second", "chunk third"]);
    const authorization = await f.service.preflight(selection(first.product), 12);
    await f.service.registerBatch(first.batchIdentity, selection(first.product), authorization);
    for (const identity of first.identities) await f.service.enqueueFinalArtifact(identity);
    const groups: number[] = [], upload = f.port.upload;
    f.port.upload = async (tasks, signal) => { await upload(tasks, signal); groups.push(tasks.length); };
    let completed = false;
    f.port.pollReady = async (tasks, signal) => completed ? f.port.ready(tasks, signal) : undefined;
    const running = f.service.runPending();
    try {
      await vi.waitFor(() => expect(groups).toEqual([3]));
      const chunk = await f.createBatch(Array.from({ length: 9 }, (_, index) => `later chunk ${index}`));
      chunk.batchIdentity.projectId = first.projectId; f.states.get(chunk.batchId)!.batch.projectId = first.projectId;
      for (const identity of chunk.identities) identity.project_id = first.projectId;
      await f.service.registerBatch(chunk.batchIdentity, selection(first.product), authorization);
      for (const identity of chunk.identities) await f.service.committed(identity);
      await vi.waitFor(() => expect(groups.reduce((sum, count) => sum + count, 0)).toBe(12), { timeout: 3000 });
      completed = true;
      await running;
      expect(groups.every(count => count <= 9)).toBe(true);
      expect(new Set(f.store.tasks().map(task => f.store.fence(task.result.upload_task_id)!.pageOwnership.targetId)).size).toBe(1);
    } finally { completed = true; await f.service.stop(); await running; }
  });

  it("does not flush a tail while its final artifact admission is still in progress", async () => {
    const f = await fixture(); await f.authorize();
    const batch = await f.createBatch(Array.from({ length: 11 }, (_, index) => `admission ${index}`)); await f.register(batch);
    for (const identity of batch.identities.slice(0, 9)) await f.service.enqueueFinalArtifact(identity);
    const groups: number[] = [], upload = f.port.upload;
    f.port.upload = async (tasks, signal) => { await upload(tasks, signal); groups.push(tasks.length); };
    await f.service.runPending();
    await f.service.enqueueFinalArtifact(batch.identities[9]!);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), save = f.store.saveTask.bind(f.store);
    f.store.saveTask = async task => { await save(task); if (task.input.export_task_id === batch.identities[10]!.export_task_id && task.result.state === "PENDING") await gate; };
    const admission = f.service.enqueueFinalArtifact(batch.identities[10]!), running = f.service.runPending();
    try {
      await vi.waitFor(() => expect(f.store.tasks()).toHaveLength(11));
      expect(groups).toEqual([9]);
      release(); await admission; await running;
      expect(groups).toEqual([9, 2]);
      expect(f.store.tasks().every(task => task.result.upload_outcome === "READY")).toBe(true);
    } finally { release(); await admission; await f.service.stop(); await running; }
  });

  it("keeps observing the original page while waiting for the next partial group", async () => {
    const f = await fixture(); await f.authorize();
    const batch = await f.createBatch(Array.from({ length: 11 }, (_, index) => `observe ${index}`)); await f.register(batch);
    for (const identity of batch.identities.slice(0, 9)) await f.service.enqueueFinalArtifact(identity);
    let observations = 0, failed = false;
    f.port.pollReady = async () => { observations++; if (failed) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "Original row failed", "Inspect original page", true); return undefined; };
    const running = f.service.runPending();
    try {
      await vi.waitFor(() => expect(observations).toBeGreaterThan(0));
      await f.service.committed(batch.identities[9]!);
      const before = observations;
      await vi.waitFor(() => expect(observations).toBeGreaterThan(before + 1), { timeout: 2000 });
      failed = true;
      await running;
      expect(f.store.tasks().filter(task => task.result.upload_outcome === "MAY_HAVE_UPLOADED")).toHaveLength(9);
      const held = f.store.tasks().find(task => task.input.export_task_id === batch.identities[9]!.export_task_id)!;
      expect(f.store.hasMarker(held.result.upload_task_id)).toBe(false);
      expect(held.result.failure?.code).toBe("PAGE_CONTRACT_CHANGED");
    } finally { await f.service.stop(); await running; }
  });

  it.each(["page-loss", "timeout", "invalid-evidence", "save-failure"] as const)("checkpoints an observed ready window safely before %s while the tenth waits", async outcome => {
    const f = await fixture(); await f.authorize();
    await f.service.configure({ enabled: true, timeouts: { processing: 3000 } });
    const batch = await f.createBatch(Array.from({ length: 11 }, (_, index) => `checkpoint ${index}`)); await f.register(batch);
    for (const identity of batch.identities.slice(0, 10)) await f.service.enqueueFinalArtifact(identity);
    let observations = 0, completed = false, lost = false, readySaves = 0;
    f.port.pollReady = async (tasks, signal) => {
      observations++;
      if (lost) throw uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "Original modal disappeared", "Inspect original page", true);
      if (!completed) return undefined;
      const evidence = await f.port.ready(tasks, signal);
      if (outcome === "invalid-evidence") evidence[0]!.selectedCount++;
      return evidence;
    };
    const save = f.store.saveTasks.bind(f.store);
    f.store.saveTasks = async tasks => {
      if (tasks.some(task => task.result.upload_outcome === "READY")) {
        readySaves++;
        if (outcome === "save-failure") throw new Error("checkpoint save failed");
      }
      await save(tasks);
    };
    const running = f.service.runPending();
    try {
      await vi.waitFor(() => expect(observations).toBeGreaterThanOrEqual(3));
      const fences = f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id)).map(task => f.store.fence(task.result.upload_task_id));
      expect(fences).toHaveLength(9);
      completed = true;
      const valid = outcome === "page-loss" || outcome === "timeout";
      if (valid) {
        await vi.waitFor(() => expect(f.store.tasks().filter(task => task.result.upload_outcome === "READY")).toHaveLength(9));
        const before = observations;
        await vi.waitFor(() => expect(observations).toBeGreaterThan(before));
        expect(readySaves).toBe(1);
        if (outcome === "page-loss") lost = true;
      }
      await running;
      expect(f.store.tasks().filter(task => task.result.upload_outcome === "READY")).toHaveLength(valid ? 9 : 0);
      expect(f.store.tasks().filter(task => task.result.upload_outcome === "MAY_HAVE_UPLOADED")).toHaveLength(valid ? 0 : 9);
      const held = f.store.tasks().find(task => task.input.export_task_id === batch.identities[9]!.export_task_id)!;
      expect(held.result.upload_outcome).toBe("NOT_SELECTED");
      expect(f.store.hasMarker(held.result.upload_task_id)).toBe(false);
      for (const fence of fences) expect(f.store.fence(fence!.upload_task_id)).toEqual(fence);
      expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
      const reopened = new DouyinUploadStore(f.store.root); await reopened.load();
      expect(reopened.tasks().filter(task => task.result.upload_outcome === "READY")).toHaveLength(valid ? 9 : 0);
    } finally { await f.service.stop(); await running; }
  }, 10_000);

  it("spaces idle whole-list observations and still cancels during that wait", async () => {
    const f = await groupedFixture(["idle upload"]), observations: number[] = [];
    f.port.pollReady = async () => { observations.push(performance.now()); return undefined; };
    const running = f.service.runPending();
    try {
      await vi.waitFor(() => expect(observations.length).toBeGreaterThanOrEqual(2));
      expect(observations[1]! - observations[0]!).toBeGreaterThanOrEqual(400);
    } finally { await f.service.stop(); await running; }
    expect(f.groups.map(group => group.length)).toEqual([1]);
    expect(f.store.tasks()[0]!.result.upload_outcome).toBe("MAY_HAVE_UPLOADED");
  });

  it.each(["cancel", "timeout"] as const)("preserves every in-flight group's fence after %s and recovers only by reading the original page", async action => {
    const f = await groupedFixture(undefined, { processingTimeout: 4000 });
    f.port.pollReady = async () => undefined;
    const running = f.service.runPending();
    await vi.waitFor(() => expect(f.groups.map(group => group.length)).toEqual([9, 9, 3]), { timeout: 3000 });
    if (action === "cancel") await f.service.cancel(f.groups[1]![0]!);
    await running;
    expect(f.store.tasks().filter(task => task.result.upload_outcome === "MAY_HAVE_UPLOADED")).toHaveLength(21);
    expect(f.store.tasks().every(task => f.store.hasMarker(task.result.upload_task_id))).toBe(true);
    const reopened = new DouyinUploadStore(f.store.root); await reopened.load();
    const checked: string[] = [];
    const recovery = new DouyinUploadService(reopened, { accounts: f.accounts, loadBatch: async id => f.states.get(id)!, browser: () => ({
      connect: async () => {}, open: async () => { throw new Error("new page forbidden"); }, upload: async () => { throw new Error("reselection forbidden"); }, ready: async () => { throw new Error("new ready action forbidden"); }, pollReady: async () => { throw new Error("new poll forbidden"); }, stop: async () => {},
      readOnlyCheck: async (task, owner, selected) => { expect(owner).toEqual(f.owner); expect(selected).toHaveLength(21); checked.push(task.result.upload_task_id); return evidenceFor(task, owner, 21); },
    }) });
    await recovery.restoreConfig(); await recovery.reconcile(); await recovery.runPending();
    expect(checked).toEqual([]);
    await recovery.resume(f.groups[1]![0]!);
    expect(checked).toHaveLength(21);
    expect(reopened.tasks().every(task => task.result.upload_outcome === "READY")).toBe(true);
    expect(f.groups.map(group => group.length)).toEqual([9, 9, 3]);
  }, 15_000);

  it("preserves all 21 fences and no partial READY when the atomic final completion save fails", async () => {
    const f = await groupedFixture();
    f.port.pollReady = async (tasks, signal) => tasks.length === 21 ? f.port.ready(tasks, signal) : undefined;
    const save = f.store.saveTasks.bind(f.store);
    f.store.saveTasks = async tasks => {
      if (tasks.some(task => task.result.state === "WAITING_FOR_CONFIRMATION")) throw new Error("injected final save failure");
      await save(tasks);
    };
    await f.service.runPending();
    expect(f.groups.map(group => group.length)).toEqual([9, 9, 3]);
    expect(f.store.tasks().filter(task => task.result.upload_outcome === "READY")).toHaveLength(0);
    expect(f.store.tasks().filter(task => task.result.upload_outcome === "MAY_HAVE_UPLOADED")).toHaveLength(21);
    expect(f.store.tasks().every(task => f.store.hasMarker(task.result.upload_task_id))).toBe(true);
  });

  it("deduplicates identical target bytes within a group before writing selection fences", async () => {
    const f = await groupedFixture(["same", "same", "different"]);
    await f.service.runPending();
    expect(f.groups.map(group => group.length)).toEqual([2]);
    expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(2);
    expect(f.store.tasks().filter(task => task.result.duplicate_of)).toHaveLength(1);
    expect(f.store.tasks().every(task => task.result.state === "WAITING_FOR_CONFIRMATION")).toBe(true);
  });

  it("keeps newly completed exports pending until an explicit resume is READY and durably saved", async () => {
    const f = await fixture();
    await f.authorize();
    const batch = await f.createBatch(["resumed formal output", "later formal output one", "later formal output two"]);
    await f.register(batch);
    const first = await f.service.enqueueFinalArtifact(batch.identities[0]!, true);
    expect(first).toBeDefined();
    const open = vi.spyOn(f.port, "open");
    let releaseReady!: () => void;
    const readyGate = new Promise<void>(resolve => { releaseReady = resolve; });
    const ready = f.port.ready;
    f.port.ready = async (tasks, signal) => {
      if (tasks[0]!.result.upload_task_id === first!.result.upload_task_id) await readyGate;
      return ready(tasks, signal);
    };
    let releaseSave!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const saveTasks = f.store.saveTasks.bind(f.store);
    let savingReady = false;
    f.store.saveTasks = async tasks => {
      if (tasks.some(task => task.result.upload_task_id === first!.result.upload_task_id && task.result.state === "WAITING_FOR_CONFIRMATION")) {
        savingReady = true;
        await saveGate;
      }
      await saveTasks(tasks);
    };
    const resumed = f.service.resume(first!.result.upload_task_id);
    try {
      await vi.waitFor(() => expect(f.store.task(first!.result.upload_task_id)!.result.state).toBe("WAITING_UPLOAD_COMPLETE"));
      await f.service.committed(batch.identities[1]!);
      await f.service.committed(batch.identities[2]!);
      await f.service.runPending();
      expect(open).toHaveBeenCalledTimes(1);
      expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(1);
      releaseReady();
      await vi.waitFor(() => expect(savingReady).toBe(true));
      expect(open).toHaveBeenCalledTimes(1);
      expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(1);
      releaseSave();
      await resumed;
      expect(open.mock.calls.map(([tasks]) => tasks.length)).toEqual([1, 2]);
      expect(f.store.tasks().every(task => task.result.state === "WAITING_FOR_CONFIRMATION")).toBe(true);
      expect(f.store.tasks().map(task => f.store.fence(task.result.upload_task_id)!.selectedIndex).sort()).toEqual([1, 2, 3]);
    } finally {
      releaseReady(); releaseSave();
      await resumed;
      await f.service.runPending();
    }
  });

  it.each([1, 5, 9])("a failure saving fence %i prevents the entire group delivery and preserves every earlier fence", async position => {
    const f = await groupedFixture();
    const mark = f.store.markSelecting.bind(f.store);
    f.store.markSelecting = async (ids, owner, index) => {
      const group = typeof ids === "string" ? [ids] : ids;
      for (const [offset, id] of group.entries()) { if (offset + 1 === position) throw new Error("injected group fence failure"); await mark(id, owner, index + offset); }
    };
    await f.service.runPending();
    expect(f.groups).toEqual([]);
    expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(position - 1);
    expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id)).every(task => task.result.state === "NEEDS_HUMAN" && !task.result.retryable)).toBe(true);
    await f.service.runPending(); expect(f.groups).toEqual([]);
  });

  it("a group disconnect fences every member, pauses later work and allows only original-page read-only recovery", async () => {
    const f = await groupedFixture();
    const upload = f.port.upload;
    f.port.upload = async (tasks, signal) => { await upload(tasks, signal); throw new Error("lost after grouped delivery"); };
    await f.service.runPending();
    expect(f.groups.map(group => group.length)).toEqual([9]);
    const unknownTasks = f.store.tasks().filter(task => task.result.state === "NEEDS_HUMAN");
    expect(unknownTasks).toHaveLength(9);
    expect(f.store.tasks().filter(task => task.result.state === "PENDING")).toHaveLength(12);
    const reopened = new DouyinUploadStore(f.store.root); await reopened.load();
    const checks: string[] = [];
    const recovery = new DouyinUploadService(reopened, { loadBatch: async id => f.states.get(id)!, accounts: f.accounts, browser: () => ({
      connect: async () => {}, open: async () => { throw new Error("replacement page forbidden"); }, upload: async () => { throw new Error("reselection forbidden"); }, ready: async () => { throw new Error("new ready action forbidden"); }, pollReady: async () => { throw new Error("new poll forbidden"); }, stop: async () => {},
      readOnlyCheck: async (task, owner, selected) => { expect(owner).toEqual(f.owner); expect(selected).toHaveLength(9); checks.push(task.result.upload_task_id); return evidenceFor(task, owner, 9); },
    }) });
    await recovery.reconcile(); await recovery.runPending(); expect(checks).toEqual([]);
    await recovery.resume(unknownTasks[0]!.result.upload_task_id);
    expect(checks).toHaveLength(9);
    expect(reopened.tasks().filter(task => task.result.state === "WAITING_FOR_CONFIRMATION")).toHaveLength(9);
    expect(reopened.tasks().filter(task => task.result.state === "PENDING")).toHaveLength(12);
  });

  it("an atomic READY save failure preserves all nine fences without advancing", async () => {
    const f = await groupedFixture();
    const saveTasks = f.store.saveTasks.bind(f.store);
    f.store.saveTasks = async tasks => {
      if (tasks.some(task => task.result.state === "WAITING_FOR_CONFIRMATION")) throw new Error("injected atomic READY save failure");
      await saveTasks(tasks);
    };
    await f.service.runPending();
    expect(f.groups.map(group => group.length)).toEqual([9]);
    expect(f.store.tasks().filter(task => task.result.state === "WAITING_FOR_CONFIRMATION")).toHaveLength(0);
    expect(f.store.tasks().filter(task => task.result.state === "NEEDS_HUMAN")).toHaveLength(9);
    expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(9);
    const reopened = new DouyinUploadStore(f.store.root); await reopened.load();
    expect(reopened.tasks().filter(task => task.result.state === "NEEDS_HUMAN")).toHaveLength(9);
    await f.service.runPending(); expect(f.groups.map(group => group.length)).toEqual([9]);
  });

  it.each(["timeout", "cancel"] as const)("%s during group processing leaves all nine uncertain and later tasks unselected", async mode => {
    const f = await groupedFixture(undefined, { processingTimeout: mode === "timeout" ? 20 : undefined });
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.port.ready = async () => { started(); await gate; return []; };
    const running = f.service.runPending(); await entered;
    if (mode === "cancel") await f.service.cancel(f.groups[0]![4]!);
    else await running;
    release(); await running;
    expect(f.groups.map(group => group.length)).toEqual([9]);
    expect(f.store.tasks().filter(task => task.result.state === "NEEDS_HUMAN")).toHaveLength(9);
    expect(f.store.tasks().filter(task => task.result.state === "PENDING")).toHaveLength(12);
    expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(9);
  });

  it("freezes one explicitly selected product and rejects account-file changes before intent admission", async () => {
    const f = await fixture();
    await f.authorize();
    const batch = await f.createBatch(["formal mp4 bytes"]);
    const selected = selection("眼贴");
    const authorization = await f.service.preflight(selected, 1);
    expect(authorization?.target).toMatchObject({ product: "眼贴", advertiserId: "1003", adId: "2003" });
    expect(authorization?.expectedCount).toBe(1);

    const changed = accountDocument();
    changed.accounts[3]!.adId = "987654";
    await writeFile(f.configPath, JSON.stringify(changed));
    await f.service.registerBatch(batch.batchIdentity, selected, authorization);

    expect(f.store.intents()).toHaveLength(0);
    expect(f.store.tasks()).toHaveLength(0);
    expect(f.service.status(batch.projectId).message).toContain("配置已变化");
    expect(f.events).toEqual([]);
  });

  it("accepts only a saved completed formal MP4, snapshots its exact bytes and persists a fence before file selection", async () => {
    const f = await fixture();
    await f.authorize();
    const preview = await f.createBatch(["preview bytes"], { formalArtifact: false });
    const previewAuthorization = await f.service.preflight(selection("眼贴"), 1);
    await f.service.registerBatch(preview.batchIdentity, selection("眼贴"), previewAuthorization);
    await expect(f.service.enqueueFinalArtifact(preview.identities[0]!)).rejects.toMatchObject({ failure: { code: "EXPORT_NOT_COMMITTED" } });

    const failed = await f.createBatch(["failed bytes"], { completed: false });
    const failedAuthorization = await f.service.preflight(selection("眼贴"), 1);
    await f.service.registerBatch(failed.batchIdentity, selection("眼贴"), failedAuthorization);
    await expect(f.service.enqueueFinalArtifact(failed.identities[0]!)).rejects.toMatchObject({ failure: { code: "EXPORT_NOT_COMMITTED" } });

    const batch = await f.createBatch(["formal mp4 bytes"]);
    const authorization = await f.service.preflight(selection("眼贴"), 1);
    await f.service.registerBatch(batch.batchIdentity, selection("眼贴"), authorization);
    const record = await f.service.enqueueFinalArtifact(batch.identities[0]!);
    expect(record).toBeDefined();
    expect(record?.result.file_name).toBe(path.basename(batch.tasks[0]!.outputPath!));
    expect(record?.input.artifact_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.snapshotPath).toContain(path.join("private", "snapshots"));
    expect(record?.input.video_path).toBe(batch.tasks[0]!.outputPath);

    await f.service.runPending();
    const ready = f.service.status(batch.projectId).tasks;
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY", file_name: record?.result.file_name });
    expect(ready[0]?.readyEvidence).toMatchObject({ advertiserId: "1003", adId: "2003", fileName: record?.result.file_name, selectedCount: 1 });
    expect(f.events).toEqual(["connect", "open", "file-input", "ready"]);
    expect("publish" in f.port).toBe(false);
    expect(f.store.hasMarker(record!.result.upload_task_id)).toBe(true);
  });

  it("deduplicates the same bytes only for the same existing account and plan", async () => {
    const f = await fixture();
    await f.authorize();
    const first = await f.createBatch(["identical formal bytes"], { product: "眼贴" });
    const second = await f.createBatch(["identical formal bytes"], { product: "眼贴" });
    for (const batch of [first, second]) await f.register(batch);
    await Promise.all([f.service.enqueueFinalArtifact(first.identities[0]!), f.service.enqueueFinalArtifact(second.identities[0]!) ]);
    await f.service.runPending();

    const firstResult = f.service.status(first.projectId).tasks[0]!;
    const secondResult = f.service.status(second.projectId).tasks[0]!;
    expect(firstResult.state).toBe("WAITING_FOR_CONFIRMATION");
    expect(secondResult).toMatchObject({ state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY", duplicate_of: firstResult.upload_task_id });
    expect(secondResult.readyEvidence).toEqual(firstResult.readyEvidence);
    expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
  });

  it("does not reuse same-byte readiness across different selected accounts", async () => {
    const f = await fixture();
    await f.authorize();
    const first = await f.createBatch(["identical formal bytes"], { product: "眼贴" });
    const second = await f.createBatch(["identical formal bytes"], { product: "肥皂" });
    await f.register(first);
    await f.register(second);
    await f.service.enqueueFinalArtifact(first.identities[0]!);
    await f.service.enqueueFinalArtifact(second.identities[0]!);
    await f.service.runPending();

    const results = [...f.service.status(first.projectId).tasks, ...f.service.status(second.projectId).tasks];
    expect(results).toHaveLength(2);
    expect(results.map(result => result.state)).toEqual(["WAITING_FOR_CONFIRMATION", "WAITING_FOR_CONFIRMATION"]);
    expect(results.map(result => result.advertiserId)).toEqual(["1003", "1004"]);
    expect(results.every(result => result.duplicate_of === undefined)).toBe(true);
    expect(f.events.filter(event => event === "file-input")).toHaveLength(2);
  });

  it("restores an uncertain selection without upload and permits only a read-only check on the original page owner", async () => {
    const f = await fixture();
    await f.authorize();
    const batch = await f.createBatch(["upload may have started"]);
    await f.register(batch);
    await f.service.enqueueFinalArtifact(batch.identities[0]!);
    const originalOwnership = { targetId: "original-tab", pageBatchId: randomUUID(), modalSessionId: randomUUID() };
    const task = f.store.tasks()[0]!;
    const ownership = { ...originalOwnership, pageBatchId: task.authorization.pageBatchId };
    f.port.open = async () => ({ pageOwnership: ownership, selectedIndex: 1 });
    f.port.upload = async () => {
      expect(f.store.hasMarker(task.result.upload_task_id)).toBe(true);
      throw new Error("connection lost after file chooser");
    };
    await f.service.runPending();
    expect(f.service.status(batch.projectId).tasks[0]).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", retryable: false });

    const reopenedStore = new DouyinUploadStore(f.store.root);
    await reopenedStore.load();
    const recoveryEvents: string[] = [];
    const recoveryOwnership: PageOwnership[] = [];
    const readOnlyPort: UploadBrowserPort = {
      connect: async () => { recoveryEvents.push("connect"); },
      open: async () => { recoveryEvents.push("open-forbidden"); throw new Error("must not reopen"); },
      upload: async () => { recoveryEvents.push("upload-forbidden"); throw new Error("must not reselect"); },
      ready: async () => { recoveryEvents.push("ready-forbidden"); throw new Error("must use readonly check"); },
      pollReady: async () => { throw new Error("must use readonly check"); },
      readOnlyCheck: async (recoveredTask, pageOwnership, files) => {
        recoveryEvents.push("readonly"); recoveryOwnership.push(pageOwnership);
        expect(files).toContainEqual(expect.objectContaining({ fileName: recoveredTask.result.file_name, index: 1 }));
        return evidenceFor(recoveredTask, pageOwnership, 1);
      },
      stop: async () => { recoveryEvents.push("stop"); },
    };
    const recovered = new DouyinUploadService(reopenedStore, {
      loadBatch: async id => structuredClone(f.states.get(id)!), browser: () => readOnlyPort,
      accounts: f.accounts, readiness: () => undefined,
    });
    await recovered.reconcile();
    await recovered.runPending();
    expect(recoveryEvents).toEqual([]);
    await recovered.resume(task.result.upload_task_id);
    expect(recoveryEvents).toEqual(["connect", "readonly"]);
    expect(recoveryOwnership).toEqual([ownership]);
    expect(recovered.status(batch.projectId).tasks[0]).toMatchObject({ state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY" });
  });

  it("treats a failed durable READY save as unknown and recovers only by checking the original page", async () => {
    const f = await fixture();
    await f.authorize();
    const batch = await f.createBatch(["ready evidence bytes"]);
    await f.register(batch);
    const record = await f.service.enqueueFinalArtifact(batch.identities[0]!);
    const originalSave = f.store.saveTasks.bind(f.store);
    let failReadySave = true;
    f.store.saveTasks = async tasks => {
      if (tasks.some(task => task.result.state === "WAITING_FOR_CONFIRMATION") && failReadySave) {
        failReadySave = false;
        throw new Error("injected durable READY save failure");
      }
      return originalSave(tasks);
    };
    await f.service.runPending();

    expect(f.store.hasMarker(record!.result.upload_task_id)).toBe(true);
    expect(f.service.status(batch.projectId).tasks[0]).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", retryable: false });
    expect(f.events.filter(event => event === "file-input")).toHaveLength(1);

    const reopenedStore = new DouyinUploadStore(f.store.root);
    await reopenedStore.load();
    const recoveryEvents: string[] = [];
    const recoveredOwnership: PageOwnership[] = [];
    const readOnlyPort: UploadBrowserPort = {
      connect: async () => { recoveryEvents.push("connect"); },
      open: async () => { recoveryEvents.push("open-forbidden"); throw new Error("must not open a replacement modal"); },
      upload: async () => { recoveryEvents.push("upload-forbidden"); throw new Error("must not select the file again"); },
      ready: async () => { recoveryEvents.push("ready-forbidden"); throw new Error("recovery must be read-only"); },
      pollReady: async () => { throw new Error("recovery must be read-only"); },
      readOnlyCheck: async (task, ownership, files) => {
        recoveryEvents.push("readonly"); recoveredOwnership.push(ownership);
        expect(files).toContainEqual(expect.objectContaining({ fileName: task.result.file_name, index: 1 }));
        return evidenceFor(task, ownership, 1);
      },
      stop: async () => { recoveryEvents.push("stop"); },
    };
    const recovered = new DouyinUploadService(reopenedStore, {
      loadBatch: async id => structuredClone(f.states.get(id)!), browser: () => readOnlyPort,
      accounts: f.accounts, readiness: () => undefined,
    });
    await recovered.resume(record!.result.upload_task_id);
    expect(recoveryEvents).toEqual(["connect", "readonly"]);
    expect(recoveredOwnership).toEqual([f.store.fence(record!.result.upload_task_id)!.pageOwnership]);
    expect(recovered.status(batch.projectId).tasks[0]).toMatchObject({ state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY" });
    expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
  });

  it.each(["cancel", "timeout"] as const)("a %s while opening the page leaves a late result unable to select a file", async mode => {
    const f = await fixture();
    await f.authorize();
    if (mode === "timeout") await f.service.configure({ enabled: true, timeouts: { navigation: 20 } });
    const batch = await f.createBatch([`${mode} before fence`]);
    await f.register(batch);
    const record = await f.service.enqueueFinalArtifact(batch.identities[0]!);

    let releaseOpen!: () => void;
    let openStarted!: () => void;
    let lateOpenCompleted = false;
    const delayed = new Promise<void>(resolve => { releaseOpen = resolve; });
    const started = new Promise<void>(resolve => { openStarted = resolve; });
    const owner: PageOwnership = { targetId: `late-${mode}`, pageBatchId: record!.authorization.pageBatchId, modalSessionId: randomUUID() };
    f.port.open = async (_task, _files, _signal) => {
      openStarted();
      await delayed;
      lateOpenCompleted = true;
      return { pageOwnership: owner, selectedIndex: 1 };
    };
    const running = f.service.runPending();
    await started;
    if (mode === "cancel") await f.service.cancel(record!.result.upload_task_id);
    else await running;
    releaseOpen();
    await delayed;
    await running;
    await vi.waitFor(() => expect(lateOpenCompleted).toBe(true));

    expect(f.store.hasMarker(record!.result.upload_task_id)).toBe(false);
    expect(f.store.task(record!.result.upload_task_id)?.result.upload_outcome).toBe("NOT_SELECTED");
    expect(f.events).not.toContain("file-input");
    expect(f.store.tasks()[0]?.result.state).toBe(mode === "cancel" ? "CANCELLED" : "FAILED_RETRYABLE");
    const status = f.service.status(batch.projectId);
    expect(status.message).toContain("1 条需处理");
    expect(status.message).toContain(mode === "cancel" ? "已停止 1 条" : "3 次");
    expect(status.message).toContain(status.tasks[0]!.failure!.message);
    if (mode === "timeout") expect(status.tasks[0]).toMatchObject({ retryable: true, retry_count: 2 });
  });

  it("disabling during a delayed operation aborts it and prevents a late selection or the next batch action", async () => {
    const f = await fixture();
    await f.authorize();
    const batch = await f.createBatch(Array.from({ length: 10 }, (_, index) => `disable group bytes ${index}`));
    const authorization = await f.service.preflight(selection("眼贴"), 10);
    await f.service.registerBatch(batch.batchIdentity, selection("眼贴"), authorization);
    for (const identity of batch.identities) await f.service.enqueueFinalArtifact(identity);

    let releaseUpload!: () => void;
    let startedUpload!: () => void;
    const uploadStarted = new Promise<void>(resolve => { startedUpload = resolve; });
    const lateUpload = new Promise<void>(resolve => { releaseUpload = resolve; });
    let delayedSignal: AbortSignal | undefined;
    let delayedTaskId: string | undefined;
    let lateSelection = false;
    f.port.upload = async (tasks, signal) => {
      const task = tasks[0]!;
      delayedSignal = signal;
      delayedTaskId = task.result.upload_task_id;
      expect(f.store.hasMarker(delayedTaskId)).toBe(true);
      startedUpload();
      await lateUpload;
      if (signal.aborted) { f.events.push("late-aborted"); return; }
      lateSelection = true;
      f.events.push("file-input");
    };
    const running = f.service.runPending();
    await uploadStarted;
    const disabling = f.service.configure({ enabled: false });
    await disabling;
    expect(delayedSignal?.aborted).toBe(true);
    releaseUpload();
    await lateUpload;
    await running;

    expect(lateSelection).toBe(false);
    expect(f.events).toContain("late-aborted");
    expect(f.events.filter(event => event === "connect")).toHaveLength(1);
    expect(f.events.filter(event => event === "file-input")).toHaveLength(0);
    expect(f.store.hasMarker(delayedTaskId!)).toBe(true);
    const interrupted = f.store.task(delayedTaskId!)!;
    const untouched = f.store.tasks().find(task => !f.store.hasMarker(task.result.upload_task_id))!;
    expect(interrupted.result.state).toBe("NEEDS_HUMAN");
    expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(9);
    expect(untouched.result.state).toBe("PENDING");
    expect(f.store.hasMarker(untouched.result.upload_task_id)).toBe(false);
  });

  it("blocks disabled or unconfigured preflight and never auto-connects during restore or reconciliation", async () => {
    const f = await fixture();
    const batch = await f.createBatch(["formal bytes"]);
    expect(f.store.config.enabled).toBe(false);
    await expect(f.service.preflight(selection("眼贴"), 1)).rejects.toThrow("请先启用千川上传并授权账号配置");
    await f.service.restoreConfig();
    await f.service.reconcile();
    await f.service.runPending();
    expect(f.events).toEqual([]);
    expect(await f.service.enqueueFinalArtifact(batch.identities[0]!)).toBeUndefined();
  });

  it("keeps private paths out of status and rejects renderer-supplied configuration paths", async () => {
    const f = await fixture();
    await expect(f.service.configure({ enabled: true, accountConfigPath: f.configPath })).rejects.toThrow();
    await f.authorize();
    const status = f.service.status(randomUUID());
    expect(status.configSelected).toBe(true);
    expect(status.config).not.toHaveProperty("accountConfigPath");
    expect(JSON.stringify(status)).not.toContain(f.configPath);
  });

  it("does not wake restored pending work for a new completion and serializes two manual resumes", async () => {
    const f = await fixture();
    await f.authorize();
    const oldBatch = await f.createBatch(["restored pending bytes"]);
    await f.register(oldBatch);
    const oldRecord = await f.service.enqueueFinalArtifact(oldBatch.identities[0]!);

    const reopenedStore = new DouyinUploadStore(f.store.root);
    await reopenedStore.load();
    const events: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const observe = async (event: string) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>(resolve => setImmediate(resolve));
      active--;
      events.push(event);
    };
    const owners = new Map<string, PageOwnership>();
    const recoveredPort: UploadBrowserPort = {
      connect: async () => observe("connect"),
      open: async (tasks, selected) => {
        const task = tasks[0]!;
        await observe("open");
        const ownership = owners.get(task.authorization.pageBatchId) ?? { targetId: "recovered-tab", pageBatchId: task.authorization.pageBatchId, modalSessionId: randomUUID() };
        owners.set(task.authorization.pageBatchId, ownership);
        return { pageOwnership: ownership, selectedIndex: selected.length + 1 };
      },
      upload: async tasks => {
        await observe("file-input");
        for (const task of tasks) expect(reopenedStore.hasMarker(task.result.upload_task_id)).toBe(true);
      },
      ready: async tasks => {
        await observe("ready");
        return tasks.map(task => {
          const fence = reopenedStore.fence(task.result.upload_task_id)!;
          return evidenceFor(task, fence.pageOwnership, fence.selectedIndex);
        });
      },
      pollReady: async (tasks, signal) => recoveredPort.ready(tasks, signal),
      readOnlyCheck: async (task, ownership) => {
        await observe("readonly");
        return evidenceFor(task, ownership, reopenedStore.fence(task.result.upload_task_id)!.selectedIndex);
      },
      stop: async () => { await observe("stop"); },
    };
    const recovered = new DouyinUploadService(reopenedStore, {
      loadBatch: async id => structuredClone(f.states.get(id)!), browser: () => recoveredPort,
      accounts: new QianchuanAccountConfigReader(), readiness: () => undefined,
    });
    await recovered.restoreConfig();
    await recovered.reconcile();
    await recovered.runPending();
    expect(events).toEqual([]);
    expect(reopenedStore.task(oldRecord!.result.upload_task_id)?.result.state).toBe("PENDING");

    const newBatch = await f.createBatch(["newly completed bytes"]);
    const newAuthorization = await recovered.preflight(selection("眼贴"), 1);
    await recovered.registerBatch(newBatch.batchIdentity, selection("眼贴"), newAuthorization);
    const newRecord = await recovered.enqueueFinalArtifact(newBatch.identities[0]!);
    await recovered.runPending();
    expect(newRecord).toBeDefined();
    expect(reopenedStore.task(oldRecord!.result.upload_task_id)?.result.state).toBe("PENDING");
    expect(events.filter(event => event === "file-input")).toHaveLength(1);

    await Promise.all([recovered.resume(oldRecord!.result.upload_task_id), recovered.resume(oldRecord!.result.upload_task_id)]);
    expect(events.filter(event => event === "file-input")).toHaveLength(2);
    expect(events.filter(event => event === "readonly")).toHaveLength(1);
    expect(maximumActive).toBe(1);
    expect(reopenedStore.task(oldRecord!.result.upload_task_id)?.result.state).toBe("WAITING_FOR_CONFIRMATION");
  });

  it("reconnects unselected files with fresh ports and selects the group only once", async () => {
    let f!: Awaited<ReturnType<typeof fixture>>;
    const ports: UploadBrowserPort[] = [], stopped = new Set<UploadBrowserPort>();
    f = await fixture(() => {
      const port: UploadBrowserPort = { ...f.port, connect: async () => {
        expect(stopped.has(port)).toBe(false);
        if (ports.length < 3) throw uploadFailure("CDP_UNAVAILABLE", "browser", "fixture offline", "check Chrome", false, true);
      }, stop: async () => { stopped.add(port); } };
      ports.push(port); return port;
    });
    await f.authorize(); await f.service.beginProduction();
    const batch = await f.createBatch(["first bytes", "second bytes"]); await f.register(batch);
    for (const id of batch.identities) await f.service.enqueueFinalArtifact(id);
    await f.service.runPending();
    expect(ports).toHaveLength(3); expect(stopped.size).toBe(2);
    expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
    expect(f.service.status(batch.projectId).tasks.every(task => task.upload_outcome === "READY" && task.retry_count === 2 && task.attempt_count === 1)).toBe(true);
  });

  it("reconnects preparation timeouts before any fence and sends files only once", async () => {
    let f!: Awaited<ReturnType<typeof fixture>>;
    let opens = 0, stops = 0;
    f = await fixture(() => ({ ...f.port, open: async (tasks, selected, signal) => {
      expect(tasks.every(task => !f.store.hasMarker(task.result.upload_task_id))).toBe(true);
      if (++opens < 3) throw uploadFailure("TIMEOUT", "browser", "chooser timed out before files", "reconnect", false, true);
      return f.port.open(tasks, selected, signal);
    }, stop: async () => { stops++; } }));
    await f.authorize(); await f.service.beginProduction();
    const batch = await f.createBatch(["preparation retry"]); await f.register(batch);
    await f.service.enqueueFinalArtifact(batch.identities[0]); await f.service.runPending();
    expect(opens).toBe(3); expect(stops).toBeGreaterThanOrEqual(2);
    expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
    expect(f.service.status(batch.projectId).tasks[0]).toMatchObject({ upload_outcome: "READY", retry_count: 2 });
  });

  it("does not retry a file action timeout once the durable fence exists", async () => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const upload = vi.fn(async () => { throw uploadFailure("TIMEOUT", "browser", "file action outcome unknown", "inspect", false, true); });
    f.port.upload = upload;
    const batch = await f.createBatch(["uncertain file"]); await f.register(batch);
    await f.service.enqueueFinalArtifact(batch.identities[0]); await f.service.runPending();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(f.service.status(batch.projectId).tasks[0]).toMatchObject({ upload_outcome: "MAY_HAVE_UPLOADED", retry_count: 0 });
  });

  it.each(["CDP_UNAVAILABLE", "TIMEOUT"] as const)("exhausts three %s connection attempts and only continues after an explicit request", async code => {
    const f = await fixture(); await f.authorize(); await f.service.configure({ enabled: true, timeouts: { connect: 20 } }); await f.service.beginProduction();
    const blocked = await f.createBatch(Array.from({ length: 10 }, (_, index) => `offline bytes ${index}`)), other = await f.createBatch(["online bytes"], { product: "热敷贴" });
    const connect = f.port.connect;
    const attempts: string[] = [];
    f.port.connect = async (task, signal) => {
      attempts.push(task.input.project_id);
      if (task.input.project_id === blocked.projectId) {
        if (code === "TIMEOUT") await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
        throw uploadFailure("CDP_UNAVAILABLE", "browser", "fixture offline", "check Chrome", false, true);
      }
      await connect(task, signal);
    };
    for (const batch of [blocked, other]) { await f.register(batch); for (const identity of batch.identities) await f.service.enqueueFinalArtifact(identity); }
    await f.service.runPending(); await f.service.runPending();
    expect(attempts.filter(id => id === blocked.projectId)).toHaveLength(3);
    const task = f.service.status(blocked.projectId).tasks.find(task => task.state !== "PENDING")!;
    expect(task).toMatchObject({ state: "FAILED_RETRYABLE", upload_outcome: "NOT_SELECTED", retry_count: 2, failure: { code, retryable: true, message: expect.stringContaining("3 次") } });
    const status = f.service.status(blocked.projectId);
    expect(status.ready).toBe(false); expect(status.message).toContain("9 条需处理"); expect(status.message).toContain("3 次");
    expect(status.message).not.toContain("存在 0 条需人工核查");
    expect(status.tasks.filter(task => task.state === "FAILED_RETRYABLE")).toHaveLength(9);
    expect(status.tasks.filter(task => task.state === "PENDING")).toHaveLength(1);
    expect(f.store.hasMarker(task.upload_task_id)).toBe(false);
    expect(f.service.status(other.projectId).tasks[0]!.upload_outcome).toBe("READY");
    f.port.connect = connect;
    await f.service.runPending();
    expect(f.service.status(blocked.projectId).tasks.some(task => task.upload_outcome !== "NOT_SELECTED")).toBe(false);
    await f.service.resume(task.upload_task_id);
    expect(f.service.status(blocked.projectId).tasks.every(task => task.upload_outcome === "READY")).toBe(true);
  });

  it("cancels during reconnect backoff without a late reconnect or file selection", async () => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const batch = await f.createBatch(["cancel backoff"]); await f.register(batch); await f.service.enqueueFinalArtifact(batch.identities[0]!);
    const connect = vi.fn(async () => { throw uploadFailure("CDP_UNAVAILABLE", "browser", "fixture offline", "check Chrome", false, true); });
    f.port.connect = connect;
    const work = f.service.runPending();
    try {
      await vi.waitFor(() => expect(f.service.status(batch.projectId).tasks[0]?.failure?.message).toContain("自动重连"));
    } finally { await f.service.cancel(f.service.status(batch.projectId).tasks[0]!.upload_task_id); await work; }
    expect(connect).toHaveBeenCalledTimes(1);
    expect(f.service.status(batch.projectId).tasks[0]).toMatchObject({ state: "CANCELLED", upload_outcome: "NOT_SELECTED", retry_count: 0 });
    expect(f.events).not.toContain("file-input");
  });

  it("reconnects a timed-out pre-selection connection only after stopping its port", async () => {
    const f = await fixture(); await f.authorize(); await f.service.configure({ enabled: true, timeouts: { connect: 20 } }); await f.service.beginProduction();
    const batch = await f.createBatch(["connection timeout"]); await f.register(batch); await f.service.enqueueFinalArtifact(batch.identities[0]!);
    let calls = 0, stopCompleted = false;
    f.port.stop = async () => { stopCompleted = true; };
    f.port.connect = async (_task, signal) => {
      if (++calls === 1) await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      else expect(stopCompleted).toBe(true);
    };
    await f.service.runPending();
    expect(calls).toBe(2); expect(f.service.status(batch.projectId).tasks[0]).toMatchObject({ upload_outcome: "READY", retry_count: 1 });
  });

  it.each(["ACCOUNT_UNCONFIRMED", "PAGE_CONTRACT_UNVERIFIED"] as const)("does not retry %s from connect", async code => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const batch = await f.createBatch([code]); await f.register(batch); await f.service.enqueueFinalArtifact(batch.identities[0]!);
    const connect = vi.fn(async () => { throw uploadFailure(code, code === "ACCOUNT_UNCONFIRMED" ? "account" : "page", "fixture rejected", "check target", true); }); f.port.connect = connect;
    await f.service.runPending();
    expect(connect).toHaveBeenCalledTimes(1); expect(f.service.status(batch.projectId).tasks[0]).toMatchObject({ state: "NEEDS_HUMAN", retry_count: 0 });
    expect(f.events).not.toContain("file-input");
  });

  it("rechecks the frozen target after backoff and refuses a changed plan", async () => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const batch = await f.createBatch(["target drift"]); await f.register(batch); await f.service.enqueueFinalArtifact(batch.identities[0]!);
    const connect = vi.fn(async () => { throw uploadFailure("CDP_UNAVAILABLE", "browser", "fixture offline", "check Chrome", false, true); }); f.port.connect = connect;
    const work = f.service.runPending();
    try {
      await vi.waitFor(() => expect(f.service.status(batch.projectId).tasks[0]?.failure?.message).toContain("自动重连"));
      const document = accountDocument(); document.accounts.find(account => account.product === batch.product)!.adId = "999999";
      await writeFile(f.configPath, JSON.stringify(document), { mode: 0o600 }); await work;
      expect(f.service.status(batch.projectId).tasks[0]).toMatchObject({ retry_count: 0, failure: { code: "INPUT_CONFLICT" } });
    } finally { await f.service.cancel(f.service.status(batch.projectId).tasks[0]!.upload_task_id); await work; }
    expect(connect).toHaveBeenCalledTimes(1);
    expect(f.events).not.toContain("file-input");
  });

  it("never reconnects after a failed detach and latches the global stop guard", async () => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const batch = await f.createBatch(["failed detach"]); await f.register(batch); await f.service.enqueueFinalArtifact(batch.identities[0]!);
    const connect = vi.fn(async () => { throw uploadFailure("CDP_UNAVAILABLE", "browser", "fixture offline", "check Chrome", false, true); });
    f.port.connect = connect; f.port.stop = async () => { throw new Error("fixture detach failed"); };
    await f.service.runPending(); await f.service.runPending();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(f.service.status(batch.projectId)).toMatchObject({ ready: false, message: expect.stringContaining("未能安全停止") });
    expect(f.events).not.toContain("file-input");
  });

  it.each(["open", "ready"] as const)("retries %s only before any file selection", async phase => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const batch = await f.createBatch([`failure at ${phase}`]); await f.register(batch); await f.service.enqueueFinalArtifact(batch.identities[0]!);
    f.port[phase] = async () => { throw uploadFailure("CDP_UNAVAILABLE", "browser", "fixture later error", "check page", false, true); };
    await f.service.runPending(); await f.service.runPending();
    expect(f.events.filter(event => event === "connect")).toHaveLength(phase === "open" ? 3 : 1);
    expect(f.service.status(batch.projectId).tasks[0]).toMatchObject({ upload_outcome: phase === "ready" ? "MAY_HAVE_UPLOADED" : "NOT_SELECTED", retry_count: phase === "open" ? 2 : 0 });
  });

  it("does not automatically reconnect a fenced read-only recovery", async () => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const batch = await f.createBatch(["unknown bytes"]); await f.register(batch); await f.service.enqueueFinalArtifact(batch.identities[0]!);
    f.port.ready = async () => { throw new Error("fixture unknown"); }; await f.service.runPending();
    const task = f.service.status(batch.projectId).tasks[0]!, fence = await readFile(path.join(f.store.root, "selection-fences", `${task.upload_task_id}.json`));
    const connect = vi.fn(async () => { throw uploadFailure("CDP_UNAVAILABLE", "browser", "fixture offline", "check Chrome", false, true); }); f.port.connect = connect;
    await f.service.resume(task.upload_task_id);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(f.service.status(batch.projectId).tasks[0]).toMatchObject({ upload_outcome: "MAY_HAVE_UPLOADED", retry_count: 0, retryable: false });
    expect(await readFile(path.join(f.store.root, "selection-fences", `${task.upload_task_id}.json`))).toEqual(fence);
    expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
  });

  it("isolates an unknown group to its account while other current accounts finish nine-file groups", async () => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const blocked = await f.createBatch(Array.from({ length: 10 }, (_, i) => `blocked-${i}`));
    const sameAccount = await f.createBatch(["same-account-other-project"]);
    const other = await f.createBatch(Array.from({ length: 10 }, (_, i) => `other-${i}`), { product: "热敷贴" });
    for (const batch of [blocked, sameAccount, other]) {
      await f.register(batch);
      for (const identity of batch.identities) await f.service.enqueueFinalArtifact(identity);
    }
    const originalReady = f.port.ready;
    const groups: string[][] = [];
    f.port.ready = async (tasks, signal) => {
      groups.push(tasks.map(task => task.input.export_task_id));
      if (tasks[0]!.input.project_id === blocked.projectId) throw uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "fixture unknown", "check original page", true);
      return originalReady(tasks, signal);
    };
    await f.service.runPending();
    expect(groups.map(group => group.length)).toEqual([9, 9, 1]);
    expect(groups.slice(1).flat()).toEqual(other.identities.map(identity => identity.export_task_id));
    expect(f.service.status(other.projectId)).toMatchObject({ ready: true, message: "成片就绪即上传，每次最多 9 条；处理中继续追加，停在确定前。" });
    expect(f.service.status(other.projectId).tasks.every(task => task.upload_outcome === "READY")).toBe(true);
    expect(f.service.status(blocked.projectId).ready).toBe(false);
    expect(f.service.status(blocked.projectId).tasks.filter(task => task.upload_outcome === "MAY_HAVE_UPLOADED")).toHaveLength(9);
    expect(f.service.status(sameAccount.projectId).tasks[0]).toMatchObject({ state: "PENDING", upload_outcome: "NOT_SELECTED", attempt_count: 0 });
    const unknown = f.store.tasks().find(task => task.result.upload_outcome === "MAY_HAVE_UPLOADED")!;
    const fencePath = path.join(f.store.root, "selection-fences", `${unknown.result.upload_task_id}.json`);
    const fence = await readFile(fencePath), result = structuredClone(unknown.result);
    await f.service.runPending();
    expect(groups.map(group => group.length)).toEqual([9, 9, 1]);
    expect(await readFile(fencePath)).toEqual(fence); expect(f.store.task(unknown.result.upload_task_id)!.result).toEqual(result);
    await expect(f.service.resume(f.service.status(sameAccount.projectId).tasks[0]!.upload_task_id)).rejects.toThrow("未解决");
  });

  it("uploads a later completed artifact for a different account after an account pause", async () => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const blocked = await f.createBatch(["unknown"], { product: "眼贴" }); await f.register(blocked);
    await f.service.enqueueFinalArtifact(blocked.identities[0]!);
    const originalReady = f.port.ready;
    f.port.ready = async (tasks, signal) => {
      if (tasks[0]!.input.project_id === blocked.projectId) throw new Error("fixture modal lost");
      return originalReady(tasks, signal);
    };
    await f.service.runPending();
    const other = await f.createBatch(["late artifact"], { product: "热敷贴" }); await f.register(other);
    await f.service.committed(other.identities[0]!);
    await vi.waitFor(() => expect(f.service.status(other.projectId).tasks[0]?.upload_outcome).toBe("READY"));
    expect(f.service.status(blocked.projectId).tasks[0]!.upload_outcome).toBe("MAY_HAVE_UPLOADED");
  });

  it("drains a cancelled group before scheduling a different account without waiting for that account", async () => {
    const f = await fixture(); await f.authorize(); await f.service.beginProduction();
    const cancelled = await f.createBatch(["cancelled bytes"]);
    const other = await f.createBatch(["unrelated account bytes"], { product: "热敷贴" });
    for (const batch of [cancelled, other]) {
      await f.register(batch); await f.service.enqueueFinalArtifact(batch.identities[0]!);
    }
    let firstStarted = false, release!: () => void;
    const holdOther = new Promise<void>(resolve => { release = resolve; });
    const ready = f.port.ready;
    f.port.ready = async (tasks, signal) => {
      if (tasks[0]!.input.project_id === cancelled.projectId) { firstStarted = true; await new Promise(() => {}); }
      else await holdOther;
      return ready(tasks, signal);
    };
    const work = f.service.runPending();
    await vi.waitFor(() => expect(firstStarted).toBe(true));
    const id = f.service.status(cancelled.projectId).tasks[0]!.upload_task_id;
    const cancellation = f.service.cancel(id);
    try {
      expect(await Promise.race([cancellation.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 500))])).toBe(true);
    } finally { release(); await cancellation; await work; await f.service.runPending(); }
    expect(f.service.status(other.projectId).tasks[0]!.upload_outcome).toBe("READY");
    expect(f.service.status(cancelled.projectId).tasks[0]!.upload_outcome).toBe("MAY_HAVE_UPLOADED");
  });

  it("clears a legacy global pause after explicitly discarding its only unselected blocker", async () => {
    const f = await fixture(); await f.authorize();
    const batch = await f.createBatch(["unselected blocker"]); await f.register(batch);
    await f.service.enqueueFinalArtifact(batch.identities[0]!);
    f.port.open = async () => { throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "fixture unavailable", "check page", true); };
    await f.service.runPending();
    const task = f.service.status(batch.projectId).tasks[0]!;
    expect(task).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "NOT_SELECTED" });
    await f.service.discard(task.upload_task_id);
    expect(f.service.status(batch.projectId).ready).toBe(true);
  });

  it("ignores prior production callbacks and registration after beginning a fresh production", async () => {
    const f = await fixture();
    await f.authorize();

    const oldBatch = await f.createBatch(["old project final bytes"], { product: "眼贴" });
    const oldState = f.states.get(oldBatch.batchId)!;
    const oldExport = oldState.batch.tasks[0]!;
    oldExport.status = "running";
    oldExport.outputArtifact = undefined;
    const oldSelection = selection("眼贴");
    const oldAuthorization = await f.service.preflight(oldSelection, 1);
    await f.service.registerBatch(oldBatch.batchIdentity, oldSelection, oldAuthorization);
    expect(f.store.intents()).toHaveLength(1);
    expect(f.store.tasks()).toHaveLength(0);

    await f.service.beginProduction();

    const newBatch = await f.createBatch(["new project final bytes"], { product: "肥皂" });
    const newSelection = selection("肥皂");
    const newAuthorization = await f.service.preflight(newSelection, 1);
    await f.service.registerBatch(newBatch.batchIdentity, newSelection, newAuthorization);
    await f.service.enqueueFinalArtifact(newBatch.identities[0]!);
    await f.service.runPending();
    expect(f.service.status(newBatch.projectId).tasks[0]?.state).toBe("WAITING_FOR_CONFIRMATION");
    expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
    const afterNewBatch = [...f.events];

    oldExport.status = "completed";
    oldExport.progress = 1;
    oldExport.outputArtifact = { taskId: oldExport.id, path: oldExport.outputPath!, sizeBytes: Buffer.byteLength("old project final bytes"), durationMs: 1000, createdAt: now() };
    await f.service.committed(oldBatch.identities[0]!);

    await f.service.registerBatch(oldBatch.batchIdentity, oldSelection, oldAuthorization);
    await f.service.committed(oldBatch.identities[0]!);

    const oldRecord = f.store.tasks().find(task => task.input.export_task_id === oldBatch.identities[0]!.export_task_id);
    expect(oldRecord).toBeUndefined();
    expect(f.service.status(oldBatch.projectId).tasks).toEqual([]);
    expect(f.events).toEqual(afterNewBatch);
    expect(f.events.filter(event => event === "connect")).toHaveLength(1);
    expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
  });
});
