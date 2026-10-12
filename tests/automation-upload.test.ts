import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { DouyinUploadStore, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";
import { QianchuanBrowserManager } from "../src/main/qianchuan-browser-manager";
import { QianchuanVideoLibrary } from "../src/main/qianchuan-video-library";
import { BATCH_SCHEMA_VERSION, DEFAULT_PRESET, QUEUE_SCHEMA_VERSION, createDefaultTemplate, now, type QueueState } from "../src/main/domain";
import { QIANCHUAN_PRODUCTS, type QianchuanProduct } from "../src/shared/qianchuan-account";
import type { PageOwnership, QianchuanUploadSelection, ReadyEvidence, UploadIdentity } from "../src/shared/douyin-upload";
import { uploadProducingExports } from "../src/main/automation-production-upload";
import type { BatchProductionRun } from "../src/shared/batch-production";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { fingerprintFile } from "../src/main/paths";
import type { ArtifactVerifier } from "../src/main/artifact";
import type { FfmpegAdapter } from "../src/main/ffmpeg";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

type PlanReader = NonNullable<ConstructorParameters<typeof DouyinUploadService>[1]["readPlans"]>;

async function fixture(options: { accounts?: (root: string) => QianchuanAccountConfigReader; readPlans?: PlanReader; loadBatch?: (id: string) => Promise<QueueState>; remote?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "automation-upload-")); roots.push(root);
  const output = path.join(root, "exports"), configPath = path.join(root, "accounts.json");
  await mkdir(output);
  await writeFile(configPath, JSON.stringify({ version: 1, accounts: QIANCHUAN_PRODUCTS.map((product, index) => ({
    product, cdpEndpoint: `http://127.0.0.1:${12000 + index}`, advertiserId: String(1000 + index), adId: String(2000 + index),
    ...(options.remote ? { egress: { mode: "remote-browser", group: "one", sshHost: "one", expectedIp: "8.8.8.8", localPort: 19160 } } : {}),
  })) }), { mode: 0o600 });
  const store = new DouyinUploadStore(path.join(root, "private")); await store.load();
  const accounts = options.accounts?.(root) ?? new QianchuanAccountConfigReader(), states = new Map<string, QueueState>();
  const ownership = new Map<string, PageOwnership>(), events: string[] = [], selectedExports: string[] = [];
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
    upload: async (tasks, signal) => { signal.throwIfAborted(); events.push("file-input"); selectedExports.push(...tasks.map(task => task.result.export_task_id)); },
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
    closeAcceptedAutomationPage: async (tasks, pageOwnership, signal, guard) => {
      signal.throwIfAborted(); guard();
      const persisted = JSON.parse(await readFile(path.join(store.root, "state.json"), "utf8")) as { tasks: UploadTaskRecord[] };
      for (const task of tasks) expect(persisted.tasks.find(value => value.result.upload_task_id === task.result.upload_task_id)?.result)
        .toMatchObject({ state: "ACCEPTED", upload_outcome: "ACCEPTED", acceptedEvidence: { pageOwnership } });
      events.push("close-accepted-page");
    },
    stop: async () => { events.push("stop"); },
  };
  const service = new DouyinUploadService(store, {
    loadBatch: options.loadBatch ?? (async id => {
      const state = states.get(id); if (!state) throw new Error("fixture batch missing");
      return structuredClone(state);
    }),
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
  return { root, configPath, accounts, store, service, port, events, batch, states, selectedExports };
}

function readyEvidence(store: DouyinUploadStore, task: UploadTaskRecord, pageOwnership = store.fence(task.result.upload_task_id)!.pageOwnership): ReadyEvidence {
  return { advertiserId: task.authorization.target.advertiserId, adId: task.authorization.target.adId, fileName: task.result.file_name,
    selectedCount: store.tasks().filter(value => value.authorization.pageBatchId === task.authorization.pageBatchId && store.hasMarker(value.result.upload_task_id)).length,
    observedAt: new Date().toISOString(), pageOwnership };
}

async function remoteFixture() {
  const open = new Set<string>(), events: string[] = [];
  vi.spyOn(QianchuanBrowserManager.prototype, "control").mockImplementation(async (id, action) => {
    expect(action).toBe("close"); events.push(`close:${id}`); open.delete(id);
  });
  const f = await fixture({ remote: true, accounts: root => new QianchuanAccountSettings(path.join(root, "private"), async id => {
    open.add(id); events.push(`open:${id}`); expect(open.size).toBe(1); return `http://127.0.0.1:${12000 + Number(id) - 1000}`;
  }, async () => { throw new Error("catalog browser closed"); }) });
  const confirm = f.port.confirmAutomation!;
  f.port.confirmAutomation = async (tasks, ownership, signal) => {
    await confirm(tasks, ownership, signal); events.push(`accepted:${tasks[0].authorization.target.advertiserId}`);
    return tasks.map(task => ({ ...task.result.readyEvidence!, platformVideoId: `video_${task.result.export_task_id}`, attempt: task.result.attempt_count,
      requestSha256: "a".repeat(64), responseSha256: "b".repeat(64), observedAt: now() }));
  };
  const group = async (product: QianchuanProduct, content: string) => {
    const source = await f.batch([content], product), target = await f.service.automationAccount(product);
    return { target, exports: source.identities, selection: { enabled: true as const, accountProduct: product,
      plan: { advertiserId: target.advertiserId, adId: "2222", name: "冻结计划" } } };
  };
  return { ...f, open, remoteEvents: events, group };
}

it("automatically confirms an ordinary production only after every frozen member is READY", async () => {
  const f = await fixture(), source = await f.batch(["ordinary first", "ordinary second"]);
  const confirm = f.port.confirmAutomation!;
  f.port.confirmAutomation = async (tasks, ownership, signal) => {
    await confirm(tasks, ownership, signal);
    return tasks.map(task => ({ ...task.result.readyEvidence!, platformVideoId: `ordinary_${task.result.export_task_id}`,
      attempt: task.result.attempt_count, requestSha256: "a".repeat(64), responseSha256: "b".repeat(64), observedAt: now() }));
  };
  await f.service.beginProduction();
  const authorization = await f.service.preflight(selection, 2);
  await f.service.registerBatch(source.batchIdentity, selection, authorization);
  await f.service.enqueueFinalArtifact(source.identities[0]!); await f.service.runPending();
  expect(f.events).not.toContain("confirm");
  expect(f.store.tasks()[0].result.state).toBe("WAITING_FOR_CONFIRMATION");
  await f.service.committed(source.identities[1]!); await f.service.runPending();
  expect(f.events.filter(event => event === "confirm")).toHaveLength(1);
  expect(f.store.tasks().every(task => task.result.upload_outcome === "ACCEPTED" && f.store.hasMarker(task.result.upload_task_id))).toBe(true);
  await f.service.runPending();
  const restored = new DouyinUploadStore(f.store.root); await restored.load();
  expect(restored.tasks().every(task => task.result.state === "ACCEPTED")).toBe(true);
  expect(f.events.filter(event => event === "confirm")).toHaveLength(1);
});

it("opens a closed remote browser before ordinary current-account production preflight", async () => {
  const open = new Set<string>(), events: string[] = [];
  const endpoint = (id: string) => `http://127.0.0.1:${12000 + Number(id) - 1000}`;
  vi.spyOn(QianchuanBrowserManager.prototype, "control").mockImplementation(async (id, action) => {
    expect(action).toBe("close"); events.push(`close:${id}`); open.delete(id);
  });
  const f = await fixture({ remote: true, accounts: root => new QianchuanAccountSettings(path.join(root, "private"), async id => {
    open.add(id); events.push(`open:${id}`); expect(open.size).toBe(1); return endpoint(id);
  }, async id => {
    events.push(`catalog:${id}`);
    if (!open.has(id)) throw new Error("catalog browser closed");
    return endpoint(id);
  }, async value => ({ displayName: "当前账号", advertiserId: String(Number(new URL(value).port) - 12000 + 1000) })) });
  const target = await f.service.automationAccount("眼贴");
  await f.service.beginProduction();
  expect(open.size).toBe(0);
  const authorization = await f.service.preflight({ enabled: true, accountProduct: target.product,
    plan: { advertiserId: target.advertiserId, adId: "2222", name: "当前计划", accountSource: "current-browser" } }, 1);
  expect(authorization?.target.advertiserId).toBe(target.advertiserId);
  expect(events.filter(event => event === `open:${target.advertiserId}`)).toHaveLength(1);
  expect(events.indexOf(`open:${target.advertiserId}`)).toBeLessThan(events.lastIndexOf(`catalog:${target.advertiserId}`));
  expect(events.at(-1)).toBe(`close:${target.advertiserId}`);
  expect(open.size).toBe(0);
});

it.each([false, true])("prepares local current-account production with an already-open browser: %s", async alreadyOpen => {
  let opened = alreadyOpen;
  const start = vi.fn(), endpoint = "http://127.0.0.1:41001";
  const currentId = alreadyOpen ? "9009" : "1003";
  const control = vi.spyOn(QianchuanBrowserManager.prototype, "control").mockResolvedValue();
  const f = await fixture({ accounts: root => new QianchuanAccountSettings(path.join(root, "private"),
    async () => { throw new Error("must preserve the browser's current subaccount"); },
    async (_id, openIfMissing) => {
      if (!opened) {
        if (!openIfMissing) throw new Error("catalog browser closed");
        start(); opened = true;
      }
      return endpoint;
    }, async () => ({ displayName: "当前本机账号", advertiserId: currentId })) });
  await f.service.beginProduction();
  const before = await readFile((f.accounts as QianchuanAccountSettings).file);
  const selected: QianchuanUploadSelection = { enabled: true, accountProduct: "眼贴",
    plan: { advertiserId: currentId, adId: "2222", name: "当前计划", accountSource: "current-browser" } };
  const authorization = await f.service.preflight(selected, 1);
  expect(authorization?.target).toMatchObject({ advertiserId: currentId, cdpEndpoint: endpoint });
  const source = await f.batch(["local current-account export"]);
  const confirm = f.port.confirmAutomation!;
  f.port.confirmAutomation = async (tasks, ownership, signal) => {
    await confirm(tasks, ownership, signal);
    return tasks.map(task => ({ ...task.result.readyEvidence!, platformVideoId: `local_${task.result.export_task_id}`,
      attempt: task.result.attempt_count, requestSha256: "a".repeat(64), responseSha256: "b".repeat(64), observedAt: now() }));
  };
  await f.service.registerBatch(source.batchIdentity, selected, authorization);
  await f.service.enqueueFinalArtifact(source.identities[0]!); await f.service.runPending();
  expect(f.store.tasks()[0].result.state).toBe("ACCEPTED");
  expect(start).toHaveBeenCalledTimes(alreadyOpen ? 0 : 1);
  expect(opened).toBe(true);
  expect(control).not.toHaveBeenCalled();
  expect(await readFile((f.accounts as QianchuanAccountSettings).file)).toEqual(before);
});

it("serializes ordinary remote preflights, holds incomplete uploads, then closes before the next account", async () => {
  const f = await remoteFixture(), first = await f.batch(["ordinary remote A1", "ordinary remote A2"], "眼贴"), next = await f.batch(["ordinary remote B"], "蝴蝶贴");
  await f.service.beginProduction();
  const selections = [first, next].map(source => ({ enabled: true as const, accountProduct: source.product,
    plan: { advertiserId: String(1000 + QIANCHUAN_PRODUCTS.indexOf(source.product)), adId: "2222", name: "冻结计划" } }));
  const a = await f.service.preflight(selections[0], 2);
  expect(f.open.size).toBe(0);
  const b = await f.service.preflight(selections[1], 1);
  expect(f.open.size).toBe(0);
  await f.service.registerBatch(first.batchIdentity, selections[0], a);
  await f.service.registerBatch(next.batchIdentity, selections[1], b);
  f.remoteEvents.splice(0);
  await f.service.enqueueFinalArtifact(first.identities[0]!); await f.service.runPending();
  await f.service.enqueueFinalArtifact(next.identities[0]!); await f.service.runPending();
  expect(f.open).toEqual(new Set([a!.target.advertiserId]));
  expect(f.selectedExports).toEqual([first.identities[0]!.export_task_id]);
  await f.service.committed(first.identities[1]!); await f.service.runPending();
  expect(f.store.tasks().every(task => task.result.state === "ACCEPTED")).toBe(true);
  expect(f.open.size).toBe(0);
  const accepted = f.remoteEvents.indexOf(`accepted:${a!.target.advertiserId}`);
  const closed = f.remoteEvents.indexOf(`close:${a!.target.advertiserId}`, accepted);
  expect(accepted).toBeGreaterThan(-1); expect(closed).toBeGreaterThan(accepted);
  expect(f.remoteEvents.indexOf(`open:${b!.target.advertiserId}`)).toBeGreaterThan(closed);
  expect(f.events.filter(event => event === "close-accepted-page")).toHaveLength(2);
});

it("does not rotate ordinary accounts or recover READY after an unknown confirmation", async () => {
  const f = await remoteFixture(), sources = [await f.batch(["ordinary unknown"], "眼贴"), await f.batch(["ordinary deferred"], "蝴蝶贴")];
  await f.service.beginProduction();
  for (const source of sources) {
    const selected = { enabled: true as const, accountProduct: source.product,
      plan: { advertiserId: String(1000 + QIANCHUAN_PRODUCTS.indexOf(source.product)), adId: "2222", name: "冻结计划" } };
    const authorization = await f.service.preflight(selected, 1);
    await f.service.registerBatch(source.batchIdentity, selected, authorization);
  }
  f.remoteEvents.splice(0); f.port.confirmAutomation = async () => { f.events.push("unknown-confirm"); };
  for (const source of sources) await f.service.enqueueFinalArtifact(source.identities[0]!);
  await f.service.runPending(); await f.service.runPending();
  const task = f.store.tasks().find(task => task.input.project_id === sources[0].projectId)!;
  expect(task.result).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", retryable: false });
  expect(f.selectedExports).toEqual(sources[0].identities.map(identity => identity.export_task_id));
  expect(f.remoteEvents).not.toContain("open:1000");
  expect(f.events.filter(event => event === "unknown-confirm")).toHaveLength(1);
  await expect(f.service.requestResume(task.result.upload_task_id)).rejects.toThrow();
  expect(f.events).not.toContain("read-only-recovery");
});

it("keeps ordinary confirmation UNKNOWN when stop races a late accepted receipt", async () => {
  const f = await fixture(), source = await f.batch(["ordinary stopped"]);
  let stop: Promise<boolean> | undefined;
  f.port.confirmAutomation = async tasks => {
    stop = f.service.stop();
    return tasks.map(task => ({ ...task.result.readyEvidence!, platformVideoId: "ordinary_late", attempt: task.result.attempt_count,
      requestSha256: "a".repeat(64), responseSha256: "b".repeat(64), observedAt: now() }));
  };
  await f.service.beginProduction();
  const authorization = await f.service.preflight(selection, 1);
  await f.service.registerBatch(source.batchIdentity, selection, authorization);
  await f.service.enqueueFinalArtifact(source.identities[0]!); await f.service.runPending(); await stop;
  expect(stop).toBeDefined();
  const restored = new DouyinUploadStore(f.store.root); await restored.load();
  expect(restored.tasks()[0].result).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED" });
  expect(restored.tasks()[0].result.acceptedEvidence).toBeUndefined();
});

it("does not lose eligible ordinary batches on the same account during confirmation", async () => {
  const f = await remoteFixture(), sources = [await f.batch(["same account first"]), await f.batch(["same account next"])];
  await f.service.beginProduction();
  for (const source of sources) {
    const authorization = await f.service.preflight(selection, 1);
    await f.service.registerBatch(source.batchIdentity, selection, authorization);
    await f.service.enqueueFinalArtifact(source.identities[0]!);
  }
  await f.service.runPending();
  expect(f.store.tasks().every(task => task.result.state === "ACCEPTED")).toBe(true);
  expect(f.events.filter(event => event === "confirm")).toHaveLength(2);
  expect(f.open.size).toBe(0);
});

it("stops ordinary account rotation if closing the accepted page fails", async () => {
  const f = await remoteFixture(), sources = [await f.batch(["accepted cannot close"], "眼贴"), await f.batch(["not sent after close failure"], "蝴蝶贴")];
  await f.service.beginProduction();
  for (const source of sources) {
    const selected = { enabled: true as const, accountProduct: source.product,
      plan: { advertiserId: String(1000 + QIANCHUAN_PRODUCTS.indexOf(source.product)), adId: "2222", name: "冻结计划" } };
    await f.service.registerBatch(source.batchIdentity, selected, await f.service.preflight(selected, 1));
    await f.service.enqueueFinalArtifact(source.identities[0]!);
  }
  f.remoteEvents.splice(0); f.port.closeAcceptedAutomationPage = async () => { throw new Error("fixture close failure"); };
  await f.service.runPending();
  expect(f.store.tasks().find(task => task.input.project_id === sources[0].projectId)!.result.state).toBe("ACCEPTED");
  expect(f.selectedExports).toEqual(sources[0].identities.map(identity => identity.export_task_id));
  expect(f.remoteEvents).not.toContain("open:1000");
  expect(f.open).toEqual(new Set(["1003"]));
});

it("accepts and closes each of five remote accounts before opening the next, without changing fences or closing batches", async () => {
  const f = await remoteFixture(), products = QIANCHUAN_PRODUCTS.slice(0, 5);
  const groups = await Promise.all(products.map((product, i) => f.group(product, `unique remote output ${i}`)));
  await f.service.uploadAutomation(groups, new AbortController().signal);
  expect(f.open.size).toBe(0); expect(f.store.tasks()).toHaveLength(5);
  expect(f.store.tasks().every(task => task.result.upload_outcome === "ACCEPTED" && f.store.hasMarker(task.result.upload_task_id))).toBe(true);
  expect(f.store.closedBatches()).toEqual([]);
  for (const group of groups) {
    const id = group.target.advertiserId, start = f.remoteEvents.indexOf(`open:${id}`), accepted = f.remoteEvents.indexOf(`accepted:${id}`);
    expect(start).toBeLessThan(accepted); expect(f.remoteEvents.indexOf(`close:${id}`, accepted)).toBeGreaterThan(accepted);
  }
  await expect(f.service.controlAccountBrowser({ product: products[0], expectedAdvertiserId: groups[0].target.advertiserId, action: "close" })).rejects.toThrow("待确认");
});

it("keeps the remote browser across accepted chunks, blocks manual opens, then closes once at account completion", async () => {
  const f = await remoteFixture(), first = await f.group("眼贴", "first chunk"), second = await f.group("眼贴", "second chunk");
  const signal = new AbortController().signal;
  await f.service.uploadAutomation([first], signal, true);
  expect(f.events.filter(event => event === "close-accepted-page")).toHaveLength(1);
  expect(f.open).toEqual(new Set([first.target.advertiserId])); expect(f.service.busy).toBe(true);
  const closes = f.remoteEvents.filter(event => event.startsWith("close:")).length;
  await expect(f.service.openAccountBrowser({})).rejects.toThrow("操作正在进行");
  await expect(f.service.listPlans({ product: "蝴蝶贴", expectedAdvertiserId: "1000" })).rejects.toThrow("操作正在进行");
  await f.service.uploadAutomation([second], signal, true);
  expect(f.events.filter(event => event === "close-accepted-page")).toHaveLength(2);
  expect(f.remoteEvents.filter(event => event.startsWith("close:"))).toHaveLength(closes);
  await f.service.finishAutomationAccount(first.target, signal);
  expect(f.open.size).toBe(0); expect(f.service.busy).toBe(false);
  expect(f.store.tasks().every(task => task.result.upload_outcome === "ACCEPTED")).toBe(true);
});

it("keeps an unknown remote upload window and never prepares the next account", async () => {
  const f = await remoteFixture(), first = await f.group("蝴蝶贴", "unknown output"), next = await f.group("眼贴", "never admitted");
  f.port.confirmAutomation = async () => {};
  await expect(f.service.uploadAutomation([first, next], new AbortController().signal)).rejects.toThrow("上传结果未知");
  expect(f.open).toEqual(new Set([first.target.advertiserId])); expect(f.remoteEvents).not.toContain(`open:${next.target.advertiserId}`);
  expect(f.store.tasks()).toHaveLength(1); expect(f.store.tasks()[0].result.upload_outcome).toBe("MAY_HAVE_UPLOADED");
  expect(f.store.hasMarker(f.store.tasks()[0].result.upload_task_id)).toBe(true);
  expect(f.events).not.toContain("close-accepted-page");
});

it("keeps accepted evidence and stops later accounts if the owned accepted page cannot close", async () => {
  const f = await remoteFixture(), first = await f.group("蝴蝶贴", "accepted page close failure"), next = await f.group("眼贴", "not admitted after page close failure");
  f.port.closeAcceptedAutomationPage = async () => { throw new Error("accepted page close failed"); };
  await expect(f.service.uploadAutomation([first, next], new AbortController().signal)).rejects.toThrow("accepted page close failed");
  expect(f.store.tasks()).toHaveLength(1); expect(f.store.tasks()[0].result.upload_outcome).toBe("ACCEPTED");
  expect(f.open).toEqual(new Set([first.target.advertiserId])); expect(f.remoteEvents).not.toContain(`open:${next.target.advertiserId}`);
});

it("stops after an accepted account fails to close and does not admit later accounts", async () => {
  const f = await remoteFixture(), first = await f.group("蝴蝶贴", "accepted before failed close"), next = await f.group("眼贴", "never admitted close");
  vi.spyOn(QianchuanBrowserManager.prototype, "control").mockImplementation(async id => {
    if (f.open.has(id)) throw new Error("normal close failed");
  });
  await expect(f.service.uploadAutomation([first, next], new AbortController().signal)).rejects.toThrow("normal close failed");
  expect(f.remoteEvents).not.toContain(`open:${next.target.advertiserId}`);
  expect(f.store.tasks()).toHaveLength(1); expect(f.store.tasks()[0].result.upload_outcome).toBe("ACCEPTED");
});

it("cleans remote accounts serially and closes outside the settings edit lock", async () => {
  const f = await remoteFixture();
  vi.spyOn(QianchuanVideoLibrary.prototype, "clear").mockImplementation(async target => {
    f.remoteEvents.push(`cleared:${target.advertiserId}`);
    return { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 0, message: "empty library" };
  });
  const accounts = QIANCHUAN_PRODUCTS.slice(0, 2).map((product, i) => ({ product, expectedAdvertiserId: String(1000 + i) }));
  const results = await f.service.clearAutomationVideoLibraries({ confirmation: "DELETE_ALL_VIDEOS", accounts }, new AbortController().signal);
  expect(results.map(result => result.state)).toEqual(["CLEARED", "CLEARED"]); expect(f.open.size).toBe(0);
  const firstCleared = f.remoteEvents.indexOf("cleared:1000"), firstClosed = f.remoteEvents.indexOf("close:1000", firstCleared);
  expect(firstClosed).toBeGreaterThan(firstCleared); expect(firstClosed).toBeLessThan(f.remoteEvents.indexOf("open:1001"));
});

it("retains a blocked cleanup window and does not open a later remote account", async () => {
  const f = await remoteFixture();
  vi.spyOn(QianchuanVideoLibrary.prototype, "clear").mockImplementation(async target => ({ product: target.product, advertiserId: target.advertiserId,
    state: "BLOCKED", deletedCount: 0, message: "unknown deletion" }));
  const results = await f.service.clearAutomationVideoLibraries({ confirmation: "DELETE_ALL_VIDEOS", accounts: QIANCHUAN_PRODUCTS.slice(0, 2).map((product, i) => ({ product, expectedAdvertiserId: String(1000 + i) })) }, new AbortController().signal);
  expect(results).toHaveLength(1); expect(results[0].state).toBe("BLOCKED"); expect(f.open).toEqual(new Set(["1000"]));
  expect(f.remoteEvents).not.toContain("open:1001");
});

const selection: QianchuanUploadSelection = { enabled: true, accountProduct: "眼贴", plan: { advertiserId: "1003", adId: "2222", name: "冻结计划" } };

it("waits for the original queue's completed record to persist before admitting an early upload", async () => {
  let jobs!: JobStore, prematureRead = false, release!: () => void, entered!: () => void;
  const saving = new Promise<void>(resolve => { release = resolve; }), completionSave = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture({ loadBatch: async id => { const state = await jobs.readCanonical(id); if (state.batch.tasks[0].status !== "completed") prematureRead = true; return state; } });
  jobs = new JobStore(path.join(f.root, "jobs")); const save = jobs.save.bind(jobs);
  jobs.save = async state => { if (state.batch.tasks[0].status === "completed") { entered(); await saving; } await save(state); };
  const sourcePath = path.join(f.root, "source.mp4"), samplePath = path.join(f.root, "sample.mp4");
  await writeFile(sourcePath, "source"); await writeFile(samplePath, "encoded");
  const projectId = randomUUID(), recentProjectId = randomUUID();
  const queue = new ExportQueue({ jobStore: jobs, ffmpeg: {} as FfmpegAdapter, fontResolver: { resolve: async () => null },
    artifactVerifier: { verify: async (file: string, taskId: string) => ({ taskId, path: file, sizeBytes: 7, durationMs: 1000, createdAt: now() }) } as ArtifactVerifier });
  const publishing = queue.publishApprovedSample({ projectId, template: createDefaultTemplate(), preset: DEFAULT_PRESET, samplePath, outputDirectory: path.join(f.root, "output"),
    media: { id: randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 6, durationMs: 1000,
      width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: now() } });
  await completionSave;
  const { batch } = queue.snapshot().batches[0];
  expect(batch.tasks[0].status).toBe("completed"); expect((await jobs.readCanonical(batch.id)).batch.tasks[0].status).toBe("verifying");
  const target = await f.service.automationAccount("眼贴"), confirm = f.port.confirmAutomation!;
  const run: BatchProductionRun = { id: randomUUID(), status: "running", createdAt: now(), updatedAt: now(), jobs: [{ id: randomUUID(), recentProjectId, projectId,
    name: "模板", requestedCount: 1, actualCount: 1, productPrice: "", coverEnabled: false, displayMode: "full", status: "exporting",
    taskIds: [batch.tasks[0].id], completedTaskIds: [batch.tasks[0].id], completedCount: 1, failedCount: 0 }] };
  f.port.confirmAutomation = async (tasks, ownership, signal) => {
    await confirm(tasks, ownership, signal); run.status = "finished"; run.jobs[0].status = "completed";
    return tasks.map(task => ({ ...task.result.readyEvidence!, platformVideoId: "committed_video", attempt: task.result.attempt_count,
      requestSha256: "a".repeat(64), responseSha256: "b".repeat(64), observedAt: now() }));
  };
  const uploading = uploadProducingExports({ runId: run.id, bindings: [{ recentProjectId, projectId, requestedCount: 1, selection, target }],
    controller: { get busy() { return run.status === "running"; }, snapshot: () => structuredClone(run), executionSignal: () => new AbortController().signal }, queue,
    upload: (groups, signal) => f.service.uploadAutomation(groups, signal) }, new AbortController().signal).catch(error => error);
  try { await new Promise(resolve => setTimeout(resolve, 200)); }
  finally { release(); }
  await publishing; const result = await uploading;
  expect(prematureRead).toBe(false); expect(result).toHaveLength(1); expect(f.selectedExports).toEqual([batch.tasks[0].id]);
});

it("accepts consecutive incremental subsets from the same original export batch through the original service", async () => {
  const f = await fixture(), source = await f.batch(Array.from({ length: 20 }, (_, index) => `unique output ${index}`));
  const target = await f.service.automationAccount("眼贴"), confirm = f.port.confirmAutomation!, counts: number[] = [];
  const recentProjectId = randomUUID();
  const run: BatchProductionRun = { id: randomUUID(), status: "running", createdAt: now(), updatedAt: now(), jobs: [{ id: randomUUID(), recentProjectId,
    projectId: source.projectId, name: "模板", requestedCount: 20, actualCount: 20, productPrice: "", coverEnabled: false, displayMode: "full",
    status: "exporting", taskIds: source.tasks.map(task => task.id), completedTaskIds: source.tasks.map(task => task.id), completedCount: 20, failedCount: 0 }] };
  f.port.confirmAutomation = async (tasks, ownership, signal) => {
    expect(run.status === "running" || counts.length > 0).toBe(true);
    await confirm(tasks, ownership, signal); counts.push(tasks.length);
    run.status = "finished"; run.jobs[0].status = "completed";
    return tasks.map(task => ({ ...task.result.readyEvidence!, platformVideoId: `video_${task.result.export_task_id}`, attempt: task.result.attempt_count,
      requestSha256: "a".repeat(64), responseSha256: "b".repeat(64), observedAt: now() }));
  };
  const uploaded = await uploadProducingExports({ runId: run.id, bindings: [{ recentProjectId, projectId: source.projectId, requestedCount: 20, selection, target }],
    controller: { get busy() { return run.status === "running"; }, snapshot: () => structuredClone(run), executionSignal: () => new AbortController().signal },
    queue: { snapshot: () => ({ revision: 1, batches: [...f.states.values()] }), waitForPersistence: async signal => signal.throwIfAborted() }, upload: (groups, signal) => f.service.uploadAutomation(groups, signal),
  }, new AbortController().signal);
  expect(counts).toEqual([9, 9, 2]); expect(uploaded).toEqual(source.identities);
  expect(f.store.tasks()).toHaveLength(20); expect(f.store.tasks().every(task => task.result.state === "ACCEPTED")).toBe(true);
  expect(f.selectedExports).toHaveLength(20);
  expect(new Set(f.selectedExports)).toEqual(new Set(source.tasks.map(task => task.id)));
});

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
