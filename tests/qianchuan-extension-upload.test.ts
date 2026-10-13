import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { DouyinUploadStore, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";
import { QianchuanBrowserManager } from "../src/main/qianchuan-browser-manager";
import { AutomationBrowserAccounts } from "../src/main/qianchuan-automation-browsers";
import type { ExtensionAccountSession, ExtensionAccountsPort } from "../src/main/qianchuan-extension-accounts";
import type { QianchuanExtensionCatalog } from "../src/main/qianchuan-extension-catalog";
import { BATCH_SCHEMA_VERSION, DEFAULT_PRESET, createDefaultTemplate, now, QUEUE_SCHEMA_VERSION, type QueueState } from "../src/main/domain";
import type { ReadyEvidence, UploadIdentity, QianchuanUploadSelection, PageOwnership } from "../src/shared/douyin-upload";
import { QIANCHUAN_PRODUCTS, type QianchuanProduct } from "../src/shared/qianchuan-account";
import type { QianchuanPlanOption, QianchuanCurrentAccount } from "../src/shared/qianchuan-plan-selection";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";

const roots = new Set<string>();
const selectedProduct: QianchuanProduct = "眼贴";
const savedEndpoint = "http://127.0.0.1:19384";
const runtimeEndpoint = "http://127.0.0.1:29484";
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })));
  roots.clear();
});

it("keeps a 12-file current-child VPS batch on its saved browser anchor through every 9-file group", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-extension-upload-")); roots.add(root);
  const outputDirectory = path.join(root, "formal-output"); await mkdir(outputDirectory);
  const selectedIndex = QIANCHUAN_PRODUCTS.indexOf(selectedProduct);
  const anchorAdvertiserId = String(8_700_000_000_000_000_000n + BigInt(selectedIndex));
  const childAdvertiserId = String(8_800_000_000_000_000_000n + BigInt(selectedIndex));
  const anchorAdId = String(8_900_000_000_000_000_000n + BigInt(selectedIndex));
  const childAdId = String(8_910_000_000_000_000_000n + BigInt(selectedIndex));
  const egress = { mode: "remote-browser" as const, group: "extension-upload-fixture", sshHost: "extension-upload-vps", expectedIp: "8.8.8.8", localPort: 19_384 };
  const configPath = path.join(root, "accounts.json");
  const config = {
    version: 1,
    accounts: QIANCHUAN_PRODUCTS.map((product, index) => ({
      product, advertiserId: product === selectedProduct ? anchorAdvertiserId : String(8_720_000_000_000_000_000n + BigInt(index)),
      adId: product === selectedProduct ? anchorAdId : String(8_920_000_000_000_000_000n + BigInt(index)),
      cdpEndpoint: product === selectedProduct ? savedEndpoint : `http://127.0.0.1:${20_000 + index}`,
      ...(product === selectedProduct ? { egress } : {}),
    })),
  };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });

  const plan: QianchuanPlanOption = { advertiserId: childAdvertiserId, adId: childAdId, name: "当前网页子账户计划", accountSource: "current-browser" };
  const currentAccount: QianchuanCurrentAccount & { name: string } = { advertiserId: childAdvertiserId, name: "当前网页子账户" };
  let uploadEndpointVerified = true;
  const current: ExtensionAccountsPort["current"] = async (target: FrozenQianchuanAccount, signal: AbortSignal): Promise<ExtensionAccountSession> => {
    signal.throwIfAborted();
    return {
      identity: `fixture-extension:${selectedProduct}:${childAdvertiserId}`,
      endpoint: runtimeEndpoint,
      snapshot: { tabId: 11, documentId: "f237e19e-cc37-48b2-a54c-c757fb95a61c", account: currentAccount, gfversion: "fixture" },
      catalog: {} as QianchuanExtensionCatalog,
      uploadEndpointVerified,
    } as ExtensionAccountSession;
  };
  const extensionPlans = vi.fn(async (session: ExtensionAccountSession, signal: AbortSignal, guard: () => Promise<void>) => {
    signal.throwIfAborted(); await guard();
    expect(session.snapshot.account.advertiserId).toBe(childAdvertiserId);
    return [plan];
  });
  const legacyCurrentAccount = vi.fn(async () => { throw new Error("legacy CDP current-account reader used"); });
  const legacySubaccounts = {
    read: vi.fn(async () => { throw new Error("legacy CDP child-account reader used"); }),
    switch: vi.fn(async () => { throw new Error("legacy CDP child-account switch used"); }),
  };
  const discoverSaved = vi.fn(async () => savedEndpoint);
  const settings = new QianchuanAccountSettings(root, discoverSaved, discoverSaved, legacyCurrentAccount, legacySubaccounts, {
    current,
    accounts: async () => { throw new Error("subaccount directory not needed by upload preflight"); },
    switch: async () => { throw new Error("subaccount switch not requested by upload preflight"); },
    plans: extensionPlans,
  });
  vi.spyOn(QianchuanBrowserManager.prototype, "assertClosed").mockResolvedValue();

  const store = new DouyinUploadStore(path.join(root, "private")); await store.load();
  const queueStates = new Map<string, QueueState>();
  const legacyPlanReaderIds: string[] = [];
  const storeBackedAccounts = settings;
  const planReader = vi.fn(async (target: FrozenQianchuanAccount) => {
    legacyPlanReaderIds.push(target.advertiserId);
    return [];
  });
  const pageOwnershipByBatch = new Map<string, PageOwnership>();
  const groupSizes: number[] = [];
  const uploadEvents: string[] = [];
  let service!: DouyinUploadService;
  const browser: UploadBrowserPort = {
    connect: async (_task, signal) => { signal.throwIfAborted(); uploadEvents.push("connect"); },
    open: async (tasks, selected, signal) => {
      signal.throwIfAborted();
      expect(tasks.length).toBeGreaterThan(0); expect(tasks.length).toBeLessThanOrEqual(9);
      const batchId = tasks[0]!.authorization.pageBatchId;
      let ownership = pageOwnershipByBatch.get(batchId);
      if (!ownership) { ownership = { targetId: "fixture-original-vps-tab", pageBatchId: batchId, modalSessionId: randomUUID() }; pageOwnershipByBatch.set(batchId, ownership); }
      groupSizes.push(tasks.length); uploadEvents.push("open");
      return { pageOwnership: ownership, selectedIndex: selected.length + 1 };
    },
    upload: async (tasks, signal) => {
      signal.throwIfAborted();
      expect(tasks.every(task => store.hasMarker(task.result.upload_task_id))).toBe(true);
      expect(tasks.every(task => task.authorization.target.advertiserId === childAdvertiserId)).toBe(true);
      uploadEvents.push("file-input");
    },
    ready: async (tasks, signal) => {
      signal.throwIfAborted();
      return makeReadyEvidence(tasks, store);
    },
    pollReady: async (tasks, signal) => {
      signal.throwIfAborted();
      return makeReadyEvidence(tasks, store);
    },
    readOnlyCheck: async (task, ownership, _selected, signal) => {
      signal.throwIfAborted(); return evidenceFor(task, ownership, store.tasks().filter(value => value.authorization.pageBatchId === task.authorization.pageBatchId && store.hasMarker(value.result.upload_task_id)).length);
    },
    stop: async () => { uploadEvents.push("stop"); },
  };
  service = new DouyinUploadService(store, {
    loadBatch: async id => {
      const state = queueStates.get(id); if (!state) throw new Error("fixture batch missing"); return structuredClone(state);
    },
    browser: () => browser,
    accounts: storeBackedAccounts,
    readPlans: planReader,
    readiness: () => undefined,
  });
  const coordinatorPrepare = vi.spyOn(AutomationBrowserAccounts.prototype, "prepare");

  await service.chooseConfig(configPath);
  await service.configure({ enabled: true });
  await service.beginProduction();
  const selection: QianchuanUploadSelection = { enabled: true, accountProduct: selectedProduct, plan };
  uploadEndpointVerified = false;
  const catalog = await service.listPlans({ product: selectedProduct, expectedAdvertiserId: anchorAdvertiserId, accountSource: "current-browser", includeAccount: true, refresh: true });
  if (Array.isArray(catalog)) throw new Error("fixture expected current-browser catalog");
  expect(catalog.account.advertiserId).toBe(childAdvertiserId);
  expect(catalog.plans).toEqual([plan]);
  expect(extensionPlans).toHaveBeenCalled();

  await expect(service.preflight(selection, 12)).rejects.toThrow(/Chrome 的上传连接/);
  expect(coordinatorPrepare).not.toHaveBeenCalled();
  expect(uploadEvents).not.toContain("file-input");
  expect(store.tasks()).toHaveLength(0);
  uploadEndpointVerified = true;

  const authorization = await service.preflight(selection, 12);
  expect(authorization).toMatchObject({ target: { advertiserId: childAdvertiserId, adId: childAdId, cdpEndpoint: runtimeEndpoint, egress } });
  const batch = await createBatch(queueStates, outputDirectory, Array.from({ length: 12 }, (_, index) => `future fixture video ${index}`));
  await service.registerBatch(batch.identity, selection, authorization!);
  for (const identity of batch.identities) await service.enqueueFinalArtifact(identity);

  await service.runPending();

  expect(groupSizes).toEqual([9, 3]);
  expect(uploadEvents.filter(event => event === "file-input")).toHaveLength(2);
  expect(store.tasks()).toHaveLength(12);
  const readyTasks = store.tasks();
  expect(readyTasks.every(task => task.result.state === "WAITING_FOR_CONFIRMATION" && task.result.upload_outcome === "READY" && task.result.readyEvidence)).toBe(true);
  expect(readyTasks.every(task => task.result.readyEvidence!.selectedCount === (store.fence(task.result.upload_task_id)!.selectedIndex <= 9 ? 9 : 12))).toBe(true);
  expect(store.tasks().every(task => store.hasMarker(task.result.upload_task_id))).toBe(true);
  expect(coordinatorPrepare).toHaveBeenCalledOnce();
  expect(coordinatorPrepare.mock.calls[0]![0]).toMatchObject({ advertiserId: anchorAdvertiserId, cdpEndpoint: savedEndpoint, egress });
  expect(legacyCurrentAccount).not.toHaveBeenCalled();
  expect(legacySubaccounts.read).not.toHaveBeenCalled();
  expect(legacySubaccounts.switch).not.toHaveBeenCalled();
  expect(extensionPlans).toHaveBeenCalled();
  expect(legacyPlanReaderIds).not.toContain(childAdvertiserId);
  expect(uploadEvents).not.toContain("confirm");
});

async function createBatch(states: Map<string, QueueState>, outputDirectory: string, contents: string[]) {
  const productProjectId = randomUUID(), batchId = randomUUID(), tasks: QueueState["batch"]["tasks"] = [], identities: UploadIdentity[] = [];
  for (const content of contents) {
    const taskId = randomUUID(), video = path.join(outputDirectory, `${taskId}.mp4`); await writeFile(video, content);
    tasks.push({ id: taskId, batchId, mediaId: randomUUID(), status: "completed", progress: 1, attempt: 1, createdAt: now(), attempts: [], outputPath: video,
      outputArtifact: { taskId, path: video, sizeBytes: Buffer.byteLength(content), durationMs: 1000, createdAt: now() } });
    identities.push({ project_id: productProjectId, batch_id: batchId, export_task_id: taskId });
  }
  const batch: QueueState["batch"] = { schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId: productProjectId, templateSnapshot: createDefaultTemplate(), mediaIds: [],
    outputDirectory, preset: DEFAULT_PRESET, status: "completed", estimatedBytes: 0, createdAt: now(), tasks };
  states.set(batchId, { schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, batch, updatedAt: now() });
  return { identity: { id: batchId, projectId: productProjectId, tasks: tasks.map(task => ({ id: task.id })) }, identities };
}

function evidenceFor(task: UploadTaskRecord, pageOwnership: PageOwnership, selectedCount: number): ReadyEvidence {
  return { advertiserId: task.authorization.target.advertiserId, adId: task.authorization.target.adId, fileName: task.result.file_name,
    selectedCount, observedAt: new Date().toISOString(), pageOwnership };
}

async function makeReadyEvidence(tasks: UploadTaskRecord[], store: DouyinUploadStore): Promise<ReadyEvidence[]> {
  const first = tasks[0]!, ownership = store.fence(first.result.upload_task_id)?.pageOwnership;
  if (!ownership) throw new Error("fixture upload has no durable selection fence");
  const selectedCount = store.tasks().filter(task => task.authorization.pageBatchId === first.authorization.pageBatchId && store.hasMarker(task.result.upload_task_id)).length;
  return tasks.map(task => evidenceFor(task, ownership, selectedCount));
}
