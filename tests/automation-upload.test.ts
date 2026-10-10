import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { DouyinUploadStore, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";
import { BATCH_SCHEMA_VERSION, DEFAULT_PRESET, QUEUE_SCHEMA_VERSION, createDefaultTemplate, now, type QueueState } from "../src/main/domain";
import { QIANCHUAN_PRODUCTS, type QianchuanProduct } from "../src/shared/qianchuan-account";
import type { PageOwnership, QianchuanUploadSelection, ReadyEvidence, UploadIdentity } from "../src/shared/douyin-upload";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

type PlanReader = NonNullable<ConstructorParameters<typeof DouyinUploadService>[1]["readPlans"]>;

async function fixture(options: { accounts?: (root: string) => QianchuanAccountConfigReader; readPlans?: PlanReader } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "automation-upload-")); roots.push(root);
  const output = path.join(root, "exports"), configPath = path.join(root, "accounts.json");
  await mkdir(output);
  await writeFile(configPath, JSON.stringify({ version: 1, accounts: QIANCHUAN_PRODUCTS.map((product, index) => ({
    product, cdpEndpoint: `http://127.0.0.1:${12000 + index}`, advertiserId: String(1000 + index), adId: String(2000 + index),
  })) }), { mode: 0o600 });
  const store = new DouyinUploadStore(path.join(root, "private")); await store.load();
  const accounts = options.accounts?.(root) ?? new QianchuanAccountConfigReader(), states = new Map<string, QueueState>();
  const ownership = new Map<string, PageOwnership>(), events: string[] = [];
  const port: UploadBrowserPort = {
    connect: async (_task, signal) => { signal.throwIfAborted(); events.push("connect"); },
    open: async (tasks, selected, signal) => {
      signal.throwIfAborted(); const task = tasks[0]!;
      let pageOwnership = ownership.get(task.authorization.pageBatchId);
      if (!pageOwnership) {
        pageOwnership = { targetId: `fixture-${randomUUID()}`, pageBatchId: task.authorization.pageBatchId, modalSessionId: randomUUID() };
        ownership.set(task.authorization.pageBatchId, pageOwnership);
      }
      events.push("open"); return { pageOwnership, selectedIndex: selected.length + 1 };
    },
    upload: async (_tasks, signal) => { signal.throwIfAborted(); events.push("file-input"); },
    ready: async tasks => tasks.map(task => readyEvidence(store, task)),
    pollReady: async tasks => tasks.map(task => readyEvidence(store, task)),
    readOnlyCheck: async (task, pageOwnership) => { events.push("read-only-recovery"); return readyEvidence(store, task, pageOwnership); },
    confirmAutomation: async (tasks, pageOwnership, signal) => {
      signal.throwIfAborted();
      const task = tasks[0]!;
      const intentPath = path.join(store.root, "automation-confirmations", `${task.authorization.pageBatchId}.json`);
      const intent = JSON.parse(await readFile(intentPath, "utf8")) as { pageBatchId: string; expectedCount: number; files: Array<{ fileName: string }>; pageOwnership: PageOwnership };
      expect(intent.pageBatchId).toBe(task.authorization.pageBatchId);
      expect(intent.expectedCount).toBe(tasks.length);
      expect(intent.files.map(file => file.fileName)).toEqual(tasks.map(value => value.result.file_name));
      expect(intent.pageOwnership).toEqual(pageOwnership);
      expect(store.task(task.result.upload_task_id)?.result).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED" });
      const persisted = JSON.parse(await readFile(path.join(store.root, "state.json"), "utf8")) as { tasks: UploadTaskRecord[] };
      expect(persisted.tasks.find(value => value.result.upload_task_id === task.result.upload_task_id)?.result.state).toBe("NEEDS_HUMAN");
      events.push("confirm");
    },
    stop: async () => { events.push("stop"); },
  };
  const service = new DouyinUploadService(store, {
    loadBatch: async id => {
      const state = states.get(id); if (!state) throw new Error("fixture batch missing");
      return structuredClone(state);
    },
    browser: () => port,
    accounts,
    readiness: () => undefined,
    readPlans: options.readPlans ?? (async target => [{ advertiserId: target.advertiserId, adId: "2222", name: "冻结计划" }]),
  });
  await service.chooseConfig(configPath); await service.configure({ enabled: true });

  async function batch(contents: string[], product: QianchuanProduct = "眼贴") {
    const projectId = randomUUID(), batchId = randomUUID(), tasks: QueueState["batch"]["tasks"] = [];
    const identities: UploadIdentity[] = [];
    for (const content of contents) {
      const id = randomUUID(), video = path.join(output, `${id}.mp4`); await writeFile(video, content);
      tasks.push({ id, batchId, mediaId: randomUUID(), status: "completed", progress: 1, attempt: 1, createdAt: now(), attempts: [], outputPath: video,
        outputArtifact: { taskId: id, path: video, sizeBytes: Buffer.byteLength(content), durationMs: 1000, createdAt: now() } });
      identities.push({ project_id: projectId, batch_id: batchId, export_task_id: id });
    }
    const state: QueueState = { schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, updatedAt: now(), batch: {
      schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId, templateSnapshot: createDefaultTemplate(), mediaIds: [], outputDirectory: output,
      preset: DEFAULT_PRESET, status: "completed", estimatedBytes: 0, createdAt: now(), tasks,
    } };
    states.set(batchId, state);
    return { batchId, projectId, tasks, identities, batchIdentity: { id: batchId, projectId, tasks: tasks.map(task => ({ id: task.id })) }, product };
  }
  return { root, configPath, accounts, store, service, port, events, batch };
}

function readyEvidence(store: DouyinUploadStore, task: UploadTaskRecord, pageOwnership = store.fence(task.result.upload_task_id)!.pageOwnership): ReadyEvidence {
  return { advertiserId: task.authorization.target.advertiserId, adId: task.authorization.target.adId, fileName: task.result.file_name,
    selectedCount: store.tasks().filter(value => value.authorization.pageBatchId === task.authorization.pageBatchId && store.hasMarker(value.result.upload_task_id)).length,
    observedAt: new Date().toISOString(), pageOwnership };
}

const selection: QianchuanUploadSelection = { enabled: true, accountProduct: "眼贴", plan: { advertiserId: "1003", adId: "2222", name: "冻结计划" } };

it("shares live acceptance with same-target duplicate groups without selecting or confirming twice", async () => {
  const f = await fixture(), first = await f.batch(["identical scheduled output"]), second = await f.batch(["identical scheduled output"]);
  const target = await f.service.automationAccount("眼贴"), confirm = f.port.confirmAutomation!;
  f.port.confirmAutomation = async (tasks, ownership, signal) => {
    await confirm(tasks, ownership, signal);
    return tasks.map(task => ({ ...task.result.readyEvidence!, platformVideoId: "shared_video", attempt: task.result.attempt_count,
      requestSha256: "a".repeat(64), responseSha256: "b".repeat(64), observedAt: new Date().toISOString() }));
  };
  await f.service.uploadAutomation([first, second].map(source => ({ selection, target, exports: source.identities })), new AbortController().signal);
  expect(f.store.unavailable).toBe(false);
  expect(f.store.tasks().map(task => task.result.upload_outcome)).toEqual(["ACCEPTED", "ACCEPTED"]);
  expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
  expect(f.events.filter(event => event === "confirm")).toHaveLength(1);
  const alias = f.store.tasks().find(task => task.result.duplicate_of)!;
  expect(f.store.hasMarker(alias.result.upload_task_id)).toBe(false);
  const restored = new DouyinUploadStore(f.store.root); await restored.load();
  expect(restored.unavailable).toBe(false); expect(restored.tasks()).toEqual(f.store.tasks());
  const later = await f.batch(["identical scheduled output"]);
  await f.service.uploadAutomation([{ selection, target, exports: later.identities }], new AbortController().signal);
  expect(f.store.tasks().every(task => task.result.upload_outcome === "ACCEPTED")).toBe(true);
  expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
  expect(f.events.filter(event => event === "confirm")).toHaveLength(1);
});

it("persists platform acceptance only for the live attempt, survives restart and never resubmits", async () => {
  const f = await fixture(), source = await f.batch(["accepted output one", "accepted output two"]), target = await f.service.automationAccount("眼贴");
  const confirm = f.port.confirmAutomation!;
  f.port.confirmAutomation = async (tasks, ownership, signal) => {
    await confirm(tasks, ownership, signal);
    return tasks.map((task, index) => ({ ...task.result.readyEvidence!, platformVideoId: `video_${index}`, attempt: task.result.attempt_count,
      requestSha256: "a".repeat(64), responseSha256: "b".repeat(64), observedAt: new Date().toISOString() }));
  };
  await f.service.uploadAutomation([{ selection, target, exports: source.identities }], new AbortController().signal);
  expect(f.store.tasks().map(task => task.result.upload_outcome)).toEqual(["ACCEPTED", "ACCEPTED"]);
  const restored = new DouyinUploadStore(f.store.root); await restored.load();
  expect(restored.tasks()).toEqual(f.store.tasks());
  const task = restored.tasks()[0]!;
  expect(() => restored.beginAutomationAcceptance(restored.tasks())).toThrow();
  await expect(restored.acceptAutomation({}, [task.result.acceptedEvidence!])).rejects.toThrow();
  await expect(f.service.requestResume(task.result.upload_task_id)).rejects.toThrow();
  await f.service.cancel(task.result.upload_task_id);
  expect(f.store.task(task.result.upload_task_id)?.result.upload_outcome).toBe("ACCEPTED");
  await expect(f.service.uploadAutomation([{ selection, target, exports: source.identities }], new AbortController().signal)).rejects.toThrow();
  expect(f.events.filter(event => event === "confirm")).toHaveLength(1);
  const selectedBeforeDuplicate = f.events.filter(event => event === "file-input").length;
  const duplicate = await f.batch(["accepted output one"]), authorization = await f.service.preflight(selection, 1);
  await f.service.registerBatch(duplicate.batchIdentity, selection, authorization);
  await f.service.enqueueFinalArtifact(duplicate.identities[0]!); await f.service.runPending();
  const alias = f.store.tasks().find(value => value.input.export_task_id === duplicate.identities[0]!.export_task_id)!;
  expect(alias.result.upload_outcome).toBe("ACCEPTED");
  expect(alias.result.duplicate_of).toBeTruthy(); expect(f.store.hasMarker(alias.result.upload_task_id)).toBe(false);
  expect(f.events.filter(event => event === "file-input")).toHaveLength(selectedBeforeDuplicate);
});

it("rejects a mismatched receipt and keeps the historical unknown barrier immutable", async () => {
  const f = await fixture(), source = await f.batch(["wrong receipt output"]), target = await f.service.automationAccount("眼贴");
  f.port.confirmAutomation = async tasks => tasks.map(task => ({ ...task.result.readyEvidence!, adId: "9999", platformVideoId: "video_wrong",
    attempt: task.result.attempt_count, requestSha256: "a".repeat(64), responseSha256: "b".repeat(64), observedAt: new Date().toISOString() }));
  await expect(f.service.uploadAutomation([{ selection, target, exports: source.identities }], new AbortController().signal)).rejects.toThrow();
  const task = f.store.tasks()[0]!;
  expect(task.result.upload_outcome).toBe("MAY_HAVE_UPLOADED");
  expect(() => f.store.beginAutomationAcceptance([task])).toThrow();
  const forged = { ...task, result: { ...task.result, state: "ACCEPTED" as const, upload_outcome: "ACCEPTED" as const } };
  await expect(f.store.saveTask(forged)).rejects.toThrow("active confirmation capability");
  expect(f.store.task(task.result.upload_task_id)).toEqual(task);
});

it("does not accept a late successful response after cancellation", async () => {
  const f = await fixture(), source = await f.batch(["cancel confirmation"]), target = await f.service.automationAccount("眼贴"), abort = new AbortController();
  f.port.confirmAutomation = async tasks => {
    abort.abort();
    return tasks.map(task => ({ ...task.result.readyEvidence!, platformVideoId: "late_video", attempt: task.result.attempt_count,
      requestSha256: "a".repeat(64), responseSha256: "b".repeat(64), observedAt: new Date().toISOString() }));
  };
  await expect(f.service.uploadAutomation([{ selection, target, exports: source.identities }], abort.signal)).rejects.toThrow();
  const restored = new DouyinUploadStore(f.store.root); await restored.load();
  expect(restored.tasks()[0]!.result).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED" });
  expect(restored.tasks()[0]!.result.acceptedEvidence).toBeUndefined();
});

it("confirms only the complete new automation batch once and preserves unknown platform outcome", async () => {
  const f = await fixture(), source = await f.batch(["new scheduled output"]), target = await f.service.automationAccount("眼贴");
  await expect(f.service.uploadAutomation([{ selection, target, exports: source.identities }], new AbortController().signal)).rejects.toMatchObject({ failure: { code: "UPLOAD_OUTCOME_UNKNOWN" } });
  const records = f.store.tasks();
  expect(records).toHaveLength(1);
  expect(records[0]!.authorization.target.adId).toBe("2222");
  expect(records[0]!.result).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED" });
  expect(f.events).toContain("confirm");
  expect(f.events.filter(event => event === "confirm")).toHaveLength(1);
  const record = records[0]!;
  await unlink(path.join(f.store.root, "automation-confirmations", `${record.authorization.pageBatchId}.json`));
  await expect(f.service.requestResume(record.result.upload_task_id)).rejects.toThrow("一次性人工核查屏障");
  expect(f.events).not.toContain("read-only-recovery");
  await expect(f.service.uploadAutomation([{ selection, target, exports: source.identities }], new AbortController().signal)).rejects.toThrow();
  expect(f.events.filter(event => event === "confirm")).toHaveLength(1);
});

it("keeps ordinary manual upload at READY without calling the automation confirmation port", async () => {
  const f = await fixture(), source = await f.batch(["manual output"]), authorization = await f.service.preflight(selection, source.identities.length);
  await f.service.registerBatch(source.batchIdentity, selection, authorization);
  await f.service.enqueueFinalArtifact(source.identities[0]!);
  await f.service.runPending();
  expect(f.store.tasks()[0]!.result).toMatchObject({ state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY" });
  expect(f.events).not.toContain("confirm");
});

it("does no scheduled upload work when cancellation is already requested", async () => {
  const f = await fixture(), source = await f.batch(["cancelled output"]), target = await f.service.automationAccount("眼贴"), abort = new AbortController();
  abort.abort();
  await expect(f.service.uploadAutomation([{ selection, target, exports: source.identities }], abort.signal)).rejects.toThrow();
  expect(f.store.tasks()).toHaveLength(0);
  expect(f.events).not.toContain("file-input");
  expect(f.events).not.toContain("confirm");
});

it("cancels and drains account-plan preload before deciding automation upload is busy", async () => {
  let firstStarted!: () => void, secondStarted!: () => void;
  const firstRead = new Promise<void>(resolve => { firstStarted = resolve; }), secondRead = new Promise<void>(resolve => { secondStarted = resolve; });
  const signals: AbortSignal[] = [];
  let calls = 0;
  const readPlans: PlanReader = async (_target, signal) => {
    calls++; signals.push(signal);
    if (calls === 1 || calls === 2) {
      (calls === 1 ? firstStarted : secondStarted)();
      await new Promise<void>(resolve => {
        if (signal.aborted) { resolve(); return; }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
    return [];
  };
  const endpoint = "http://127.0.0.1:12999";
  const f = await fixture({ accounts: root => new QianchuanAccountSettings(root, async () => endpoint, async () => endpoint), readPlans });
  await f.service.chooseConfig(path.join(f.root, "accounts.json"));
  await firstRead;
  await f.service.configure({ enabled: true });
  await secondRead;
  const source = await f.batch(["account catalog remains read-only"]), target = await f.service.automationAccount("眼贴");
  await expect(f.service.uploadAutomation([{ selection: { ...selection, plan: { advertiserId: "1003", adId: "9999", name: "不存在的计划" } }, target, exports: source.identities }], new AbortController().signal))
    .rejects.toThrow("所选计划已失效");
  expect(signals.slice(0, 2).every(signal => signal.aborted)).toBe(true);
  expect(f.store.tasks()).toHaveLength(0);
  expect(f.events).not.toContain("connect");
  expect(f.events).not.toContain("file-input");
  expect(f.events).not.toContain("confirm");
  expect(f.service.busy).toBe(false);
});

it("keeps the frozen automation account on configured endpoint after catalog preparation resolves a runtime endpoint", async () => {
  const configuredEndpoint = "http://127.0.0.1:12003", runtimeEndpoint = "http://127.0.0.1:12999";
  const f = await fixture({ accounts: root => new QianchuanAccountSettings(root, async () => runtimeEndpoint, async () => runtimeEndpoint) });
  const target = await f.service.automationAccount("眼贴");
  const prepared = await (f.accounts as QianchuanAccountSettings).prepareCatalog("眼贴");

  expect(target.cdpEndpoint).toBe(configuredEndpoint);
  expect(prepared.cdpEndpoint).toBe(runtimeEndpoint);
  expect((await f.service.automationAccount("眼贴")).cdpEndpoint).toBe(configuredEndpoint);

  const source = await f.batch(["runtime endpoint resolution does not change frozen config"]);
  await expect(f.service.uploadAutomation([{
    selection: { ...selection, plan: { ...selection.plan!, adId: "9999", name: "已失效计划" } }, target, exports: source.identities,
  }], new AbortController().signal)).rejects.toThrow("所选计划已失效");
  expect(f.store.tasks()).toHaveLength(0);
  expect(f.events).not.toContain("connect");
  expect(f.events).not.toContain("file-input");
  expect(f.events).not.toContain("confirm");
});
