import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DouyinUploadStore, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";
import { BATCH_SCHEMA_VERSION, DEFAULT_PRESET, QUEUE_SCHEMA_VERSION, createDefaultTemplate, now, type QueueState } from "../src/main/domain";
import { QIANCHUAN_PRODUCTS, type QianchuanProduct } from "../src/shared/qianchuan-account";
import type { PageOwnership, ReadyEvidence, UploadAuthorization, UploadIdentity, QianchuanUploadSelection } from "../src/shared/douyin-upload";

const selection = (accountProduct: QianchuanProduct): QianchuanUploadSelection => ({ enabled: true, accountProduct });
const temporaryRoots = new Set<string>();
afterEach(async () => {
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

async function fixture() {
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
    browser: () => port,
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
      expect(previous.every(id => f.store.task(id)!.result.state === "WAITING_FOR_CONFIRMATION")).toBe(true);
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

  it("does not select the next group until all nine are ready and all nine READY saves finish", async () => {
    const f = await groupedFixture();
    let releaseReady!: () => void;
    const gate = new Promise<void>(resolve => { releaseReady = resolve; });
    const ready = f.port.ready;
    f.port.ready = async (tasks, signal) => { if (f.groups.length === 1) await gate; return ready(tasks, signal); };
    let releaseSave!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const saveTask = f.store.saveTask.bind(f.store);
    let blockedSave = false;
    f.store.saveTask = async task => {
      if (task.result.state === "WAITING_FOR_CONFIRMATION" && task.result.readyEvidence?.selectedCount === 9 && f.store.fence(task.result.upload_task_id)?.selectedIndex === 9) { blockedSave = true; await saveGate; }
      await saveTask(task);
    };
    const running = f.service.runPending();
    await vi.waitFor(() => expect(f.groups.map(group => group.length)).toEqual([9]));
    expect(f.store.tasks().filter(task => task.result.upload_outcome === "READY")).toHaveLength(0);
    releaseReady();
    await vi.waitFor(() => expect(blockedSave).toBe(true));
    expect(f.groups.map(group => group.length)).toEqual([9]);
    releaseSave(); await running;
    expect(f.groups.map(group => group.length)).toEqual([9, 9, 3]);
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
    const saveTask = f.store.saveTask.bind(f.store);
    let savingReady = false;
    f.store.saveTask = async task => {
      if (task.result.upload_task_id === first!.result.upload_task_id && task.result.state === "WAITING_FOR_CONFIRMATION") {
        savingReady = true;
        await saveGate;
      }
      await saveTask(task);
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
    const mark = f.store.markSelecting.bind(f.store); let calls = 0;
    f.store.markSelecting = async (...args) => { if (++calls === position) throw new Error("injected group fence failure"); await mark(...args); };
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
      connect: async () => {}, open: async () => { throw new Error("replacement page forbidden"); }, upload: async () => { throw new Error("reselection forbidden"); }, ready: async () => { throw new Error("new ready action forbidden"); }, stop: async () => {},
      readOnlyCheck: async (task, owner, selected) => { expect(owner).toEqual(f.owner); expect(selected).toHaveLength(9); checks.push(task.result.upload_task_id); return evidenceFor(task, owner, 9); },
    }) });
    await recovery.reconcile(); await recovery.runPending(); expect(checks).toEqual([]);
    await recovery.resume(unknownTasks[0]!.result.upload_task_id);
    expect(checks).toHaveLength(9);
    expect(reopened.tasks().filter(task => task.result.state === "WAITING_FOR_CONFIRMATION")).toHaveLength(9);
    expect(reopened.tasks().filter(task => task.result.state === "PENDING")).toHaveLength(12);
  });

  it("a fifth READY save failure preserves the first four READY records and all nine fences without advancing", async () => {
    const f = await groupedFixture();
    const saveTask = f.store.saveTask.bind(f.store); let readySaves = 0;
    f.store.saveTask = async task => {
      if (task.result.state === "WAITING_FOR_CONFIRMATION" && ++readySaves === 5) throw new Error("injected fifth READY save failure");
      await saveTask(task);
    };
    await f.service.runPending();
    expect(f.groups.map(group => group.length)).toEqual([9]);
    expect(f.store.tasks().filter(task => task.result.state === "WAITING_FOR_CONFIRMATION")).toHaveLength(4);
    expect(f.store.tasks().filter(task => task.result.state === "NEEDS_HUMAN")).toHaveLength(5);
    expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(9);
    const reopened = new DouyinUploadStore(f.store.root); await reopened.load();
    expect(reopened.tasks().filter(task => task.result.state === "NEEDS_HUMAN")).toHaveLength(5);
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
    const originalSave = f.store.saveTask.bind(f.store);
    let failReadySave = true;
    f.store.saveTask = async task => {
      if (task.result.state === "WAITING_FOR_CONFIRMATION" && failReadySave) {
        failReadySave = false;
        throw new Error("injected durable READY save failure");
      }
      return originalSave(task);
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
    expect(f.store.tasks()[0]?.result.state).toBe(mode === "cancel" ? "CANCELLED" : "FAILED_TERMINAL");
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

  it("keeps a prior project's late completion pending after stop and a new batch authorization", async () => {
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

    await f.service.stop();

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

    const oldRecord = f.store.tasks().find(task => task.input.export_task_id === oldBatch.identities[0]!.export_task_id);
    expect(oldRecord?.result.state).toBe("PENDING");
    expect(oldRecord?.result.upload_outcome).toBe("NOT_SELECTED");
    expect(f.events).toEqual(afterNewBatch);
    expect(f.events.filter(event => event === "connect")).toHaveLength(1);
    expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
  });
});
