import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BATCH_SCHEMA_VERSION, DEFAULT_PRESET, QUEUE_SCHEMA_VERSION, createDefaultTemplate, now, type QueueState } from "../src/main/domain";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";
import { assertAutomationBrowserSafe } from "../src/main/qianchuan-automation-browsers";
import { DouyinUploadStore, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { QIANCHUAN_PRODUCTS, type QianchuanProduct } from "../src/shared/qianchuan-account";
import { uploadFailure, type PageOwnership, type ReadyEvidence, type UploadIdentity } from "../src/shared/douyin-upload";

const roots = new Set<string>();
afterEach(async () => { await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true }))); roots.clear(); });

async function fixture(remote = false, currentBrowser = false) {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-recovery-")); roots.add(root);
  const outputDirectory = path.join(root, "outputs"); await mkdir(outputDirectory);
  const accountPath = path.join(root, "accounts.json");
  await writeFile(accountPath, JSON.stringify({ version: 1, accounts: QIANCHUAN_PRODUCTS.map((product, index) => ({
    product, cdpEndpoint: `http://127.0.0.1:${13000 + index}`, advertiserId: `${3000 + index}`, adId: `${4000 + index}`,
    ...(remote && product === "滴耳康" ? { egress: { mode: "remote-browser", group: "fixture", sshHost: "fixture-one", localPort: 19381, expectedIp: "203.0.113.11" } } : {}),
  })) }), { mode: 0o600 });
  const store = new DouyinUploadStore(path.join(root, "private")); await store.load();
  const accounts = remote || currentBrowser ? new QianchuanAccountSettings(store.root, async id => `http://127.0.0.1:${10000 + Number(id)}`,
    async id => `http://127.0.0.1:${10000 + Number(id)}`, async () => ({ advertiserId: "3000", name: "Fixture account" })) : new QianchuanAccountConfigReader();
  if (accounts instanceof QianchuanAccountSettings) vi.spyOn(accounts, "controlBrowser").mockImplementation(async (_input, guard) => { guard((await accounts.preflight("滴耳康")).advertiserId); });
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
    pollReady: async (tasks, signal) => port.ready(tasks, signal),
    readOnlyCheck: async (task, owner, selected) => { checks.push(task.result.upload_task_id); return evidence(task, owner, selected.length); },
    stop: async () => {},
  };
  const dependencies = { loadBatch: async (id: string) => structuredClone(states.get(id)!), accounts, browser: () => port,
    readPlans: async () => currentBrowser ? [{ advertiserId: "3000", adId: "4000", name: "Fixture plan", accountSource: "current-browser" as const }] : [] };
  const service = new DouyinUploadService(store, dependencies);
  await service.chooseConfig(accountPath); await service.configure({ enabled: true });
  async function batch(count: number, product: QianchuanProduct = "滴耳康", expectedCount = count) {
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
    const selection = { enabled: true as const, accountProduct: product,
      ...(currentBrowser ? { plan: { advertiserId: "3000", adId: "4000", name: "Fixture plan", accountSource: "current-browser" as const } } : {}) }, authorization = await service.preflight(selection, expectedCount);
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
  async function manuallySubmitted(remote = false, currentBrowser = false) {
    const f = await fixture(remote, currentBrowser), target = await f.batch(5, "滴耳康", 7);
    for (const identity of target.identities.slice(0, 2)) await f.service.enqueueFinalArtifact(identity);
    await f.service.runPending(); await f.service.stop();
    const records = await f.admit(target, true), selected = records.filter(task => f.store.hasMarker(task.result.upload_task_id));
    const remaining = records.filter(task => !f.store.hasMarker(task.result.upload_task_id));
    const request = { projectId: target.projectId, uploadTaskId: remaining[0]!.result.upload_task_id,
      expectedPageBatchId: target.pageBatchId, expectedUnselectedCount: 3,
      submittedTaskIds: selected.map(task => task.result.upload_task_id), confirmation: "CONTINUE_UNSELECTED" as const };
    const reopened = new DouyinUploadStore(f.store.root); await reopened.load(); f.useStore(reopened);
    const recovered = new DouyinUploadService(reopened, f.dependencies); await recovered.beginProduction();
    f.port.confirmAutomation = async tasks => tasks.map(task => ({ ...task.result.readyEvidence!, platformVideoId: `video-${task.result.upload_task_id}`,
      attempt: task.result.attempt_count, requestSha256: "a".repeat(64), responseSha256: "b".repeat(64) }));
    const closed: string[] = [];
    if (remote) f.port.closeAcceptedAutomationPage = async (tasks, ownership, _signal, guard) => {
      guard();
      expect(tasks.map(task => task.result.upload_task_id).sort()).toEqual(remaining.map(task => task.result.upload_task_id).sort());
      expect(tasks.every(task => task.result.state === "ACCEPTED")).toBe(true);
      expect(ownership.pageBatchId).not.toBe(target.pageBatchId);
      closed.push(ownership.pageBatchId);
    };
    return { ...f, target, records, selected, remaining, request, reopened, recovered, closed };
  }

  it.each([false, true])("continues only never-selected files after manual submission and restart, preserving the submitted records and fences (remote: %s)", async remote => {
    const f = await manuallySubmitted(remote), before = f.selected.map(task => f.reopened.task(task.result.upload_task_id));
    const prepare = vi.spyOn(f.accounts, "prepare");
    const close = f.accounts instanceof QianchuanAccountSettings ? vi.mocked(f.accounts.controlBrowser) : undefined;
    close?.mockClear();
    const protectedBrowser = () => assertAutomationBrowserSafe(f.reopened, f.selected[0]!.authorization.target.advertiserId, new Set<string>(), new Set<string>(), new Set<string>());
    expect(protectedBrowser).toThrow("未关闭或切换浏览器");
    const fences = await Promise.all(f.selected.map(task => readFile(path.join(f.store.root, "selection-fences", `${task.result.upload_task_id}.json`))));
    await f.recovered.resume(f.request.uploadTaskId, undefined, undefined, f.request);
    expect(prepare).not.toHaveBeenCalled();
    expect(close?.mock.calls ?? []).toEqual([]);
    expect(protectedBrowser).toThrow("未关闭或切换浏览器");
    expect(f.groups.map(group => group.length)).toEqual([2, 3]);
    expect(f.checks).toEqual([]);
    const moved = f.remaining.map(task => f.reopened.task(task.result.upload_task_id)!);
    expect(f.closed).toEqual(remote ? [moved[0]!.authorization.pageBatchId] : []);
    expect(new Set(moved.map(task => task.authorization.pageBatchId)).size).toBe(1);
    expect(moved[0]!.authorization.pageBatchId).not.toBe(f.target.pageBatchId);
    for (let i = 0; i < moved.length; i++) {
      expect(moved[i]!.authorization).toEqual({ ...f.remaining[i]!.authorization, pageBatchId: moved[0]!.authorization.pageBatchId, expectedCount: 3 });
      expect(moved[i]!.snapshotPath).toBe(f.remaining[i]!.snapshotPath);
      expect(moved[i]!.input).toEqual(f.remaining[i]!.input);
      expect(moved[i]!.result.state).toBe("ACCEPTED");
    }
    for (let i = 0; i < f.selected.length; i++) {
      expect(f.reopened.task(f.selected[i]!.result.upload_task_id)).toEqual(before[i]);
      expect(await readFile(path.join(f.store.root, "selection-fences", `${f.selected[i]!.result.upload_task_id}.json`))).toEqual(fences[i]);
      expect(f.groups.flat().filter(id => id === f.selected[i]!.result.upload_task_id)).toHaveLength(1);
    }
    const archive = JSON.parse(await readFile(path.join(f.store.root, "retarget-history", `${f.target.pageBatchId}.json`), "utf8"));
    expect(archive.action).toBe("continue-unselected"); expect(archive.tasks).toHaveLength(5);
    expect(archive.submittedTaskIds.sort()).toEqual([...f.request.submittedTaskIds].sort());
    const restart = new DouyinUploadStore(f.store.root); await restart.load(); expect(restart.unavailable).toBe(false);
    expect(restart.tasks()).toEqual(f.reopened.tasks());
    await expect(f.recovered.resume(f.request.uploadTaskId, undefined, undefined, f.request)).rejects.toThrow();
    expect(f.groups.map(group => group.length)).toEqual([2, 3]);
  });

  it.each(["partial", "restarted-child"])("reads the protected account page only for explicit historical upload identity, preserving catalog exclusions (%s)", async mode => {
    const f = await manuallySubmitted(false, true);
    if (!(f.accounts instanceof QianchuanAccountSettings)) throw new Error("Expected current-browser fixture");
    const protectedId = f.reopened.fence(f.selected[0]!.result.upload_task_id)!.pageOwnership.targetId;
    const selectedBefore = f.selected.map(task => structuredClone(f.reopened.task(task.result.upload_task_id)));
    const fences = await Promise.all(f.selected.map(task => readFile(path.join(f.store.root, "selection-fences", `${task.result.upload_task_id}.json`))));
    const original = f.accounts.prepareCurrentCatalog.bind(f.accounts);
    const catalog = vi.spyOn(f.accounts, "prepareCurrentCatalog").mockImplementation(async (product, signal, excluded, openLocal) => {
      // Live reproduction: the original protected upload page is the sole account page.
      if (excluded?.has(protectedId)) throw new Error("The sole protected account page was excluded");
      return original(product, signal, excluded, openLocal);
    });
    const admitted = vi.fn();
    if (mode === "partial") await f.recovered.resume(f.request.uploadTaskId, admitted, undefined, f.request);
    else {
      const moved = await f.reopened.continueUnselectedBatch(f.request, { ...f.remaining[0]!.authorization, pageBatchId: randomUUID(), expectedCount: 3 });
      await f.recovered.resume(moved[0]!.result.upload_task_id, admitted, moved[0]!.authorization.pageBatchId);
    }
    expect(admitted).toHaveBeenCalledOnce();
    expect(f.groups.map(group => group.length)).toEqual([2, 3]);
    for (let i = 0; i < f.selected.length; i++) {
      expect(f.reopened.task(f.selected[i]!.result.upload_task_id)).toEqual(selectedBefore[i]);
      expect(await readFile(path.join(f.store.root, "selection-fences", `${f.selected[i]!.result.upload_task_id}.json`))).toEqual(fences[i]);
    }
    expect(f.remaining.every(task => f.reopened.task(task.result.upload_task_id)!.result.state === "ACCEPTED")).toBe(true);
    expect(() => assertAutomationBrowserSafe(f.reopened, "3000", new Set(), new Set(), new Set())).toThrow("未关闭或切换浏览器");
    catalog.mockClear();
    const configured = await f.accounts.preflight("滴耳康");
    await expect(f.recovered.listPlans({ product: "滴耳康", expectedAdvertiserId: configured.advertiserId, accountSource: "current-browser", includeAccount: true, refresh: true })).rejects.toThrow("protected account page was excluded");
    await expect(f.recovered.preflight({ enabled: true, accountProduct: "滴耳康", plan: { advertiserId: "3000", adId: "4000", name: "Fixture plan", accountSource: "current-browser" } }, 1)).rejects.toThrow("protected account page was excluded");
    expect(catalog.mock.calls.some(call => call[2]?.has(protectedId))).toBe(true);
  });

  it("rejects a changed browser account after migration without granting a file action", async () => {
    const f = await manuallySubmitted(false, true);
    if (!(f.accounts instanceof QianchuanAccountSettings)) throw new Error("Expected current-browser fixture");
    const original = f.accounts.prepareCurrentCatalog.bind(f.accounts); let reads = 0;
    vi.spyOn(f.accounts, "prepareCurrentCatalog").mockImplementation(async (...args) => {
      const current = await original(...args);
      return ++reads >= 3 ? { ...current, target: { ...current.target, advertiserId: "9999" } } : current;
    });
    const admitted = vi.fn();
    await expect(f.recovered.resume(f.request.uploadTaskId, admitted, undefined, f.request)).rejects.toThrow("网页当前子账户");
    expect(admitted).not.toHaveBeenCalled(); expect(f.groups.map(group => group.length)).toEqual([2]);
    for (const selected of f.selected) expect(f.reopened.task(selected.result.upload_task_id)).toEqual(selected);
    for (const remaining of f.remaining) {
      const moved = f.reopened.task(remaining.result.upload_task_id)!;
      expect(moved.authorization.pageBatchId).not.toBe(f.target.pageBatchId);
      expect(moved.result.upload_outcome).toBe("NOT_SELECTED"); expect(f.reopened.hasMarker(moved.result.upload_task_id)).toBe(false);
    }
  });

  it.each(["missing", "extra", "unknown", "cancelled", "count", "project", "target", "snapshot"])("rejects %s continuation without changing the ledger or selecting another file", async kind => {
    const f = await manuallySubmitted();
    if (kind === "unknown") {
      const task = f.reopened.task(f.selected[0]!.result.upload_task_id)!;
      task.result = { ...task.result, state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", readyEvidence: undefined };
      await f.reopened.saveTask(task);
    }
    if (kind === "cancelled") {
      const task = f.reopened.task(f.remaining[1]!.result.upload_task_id)!;
      task.result.state = "CANCELLED"; await f.reopened.saveTask(task);
    }
    if (kind === "missing") f.request.submittedTaskIds.pop();
    if (kind === "extra") f.request.submittedTaskIds.push(f.remaining[1]!.result.upload_task_id);
    if (kind === "count") f.request.expectedUnselectedCount = 2;
    if (kind === "project") f.request.projectId = randomUUID();
    if (kind === "target") vi.spyOn(f.accounts, "freeze").mockRejectedValue(new Error("changed frozen account"));
    if (kind === "snapshot") { await import("node:fs/promises").then(fs => fs.chmod(f.remaining[1]!.snapshotPath, 0o600)); await writeFile(f.remaining[1]!.snapshotPath, "tampered"); }
    const before = await readFile(path.join(f.store.root, "state.json"));
    await expect(f.recovered.resume(f.request.uploadTaskId, undefined, undefined, f.request)).rejects.toThrow();
    expect(await readFile(path.join(f.store.root, "state.json"))).toEqual(before);
    expect(f.groups.map(group => group.length)).toEqual([2]);
  });

  it("the store refuses to move the remaining files to a different frozen plan", async () => {
    const f = await manuallySubmitted(), before = await readFile(path.join(f.store.root, "state.json"));
    await expect(f.reopened.continueUnselectedBatch(f.request, { ...f.remaining[0]!.authorization, pageBatchId: randomUUID(), expectedCount: 3,
      target: { ...f.remaining[0]!.authorization.target, adId: "999999" } })).rejects.toThrow();
    expect(await readFile(path.join(f.store.root, "state.json"))).toEqual(before);
    expect(f.groups.map(group => group.length)).toEqual([2]);
  });

  it("a stop after durable migration leaves a recoverable unselected child and selects no files", async () => {
    const f = await manuallySubmitted(), move = f.reopened.continueUnselectedBatch.bind(f.reopened);
    let entered = false, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.reopened, "continueUnselectedBatch").mockImplementation(async (...args) => { const result = await move(...args); entered = true; await gate; return result; });
    const resumed = f.recovered.resume(f.request.uploadTaskId, undefined, undefined, f.request);
    const result = resumed.catch(error => error);
    try {
      await vi.waitFor(() => expect(entered).toBe(true)); await f.recovered.stop(); release();
      expect(await result).toBeInstanceOf(Error); expect(f.groups.map(group => group.length)).toEqual([2]);
      const first = f.reopened.task(f.request.uploadTaskId)!;
      expect(first.authorization.pageBatchId).not.toBe(f.target.pageBatchId);
      expect(first.result.upload_outcome).toBe("NOT_SELECTED");
      const restart = new DouyinUploadStore(f.store.root); await restart.load(); expect(restart.unavailable).toBe(false);
      vi.restoreAllMocks(); await f.recovered.resume(f.request.uploadTaskId, undefined, first.authorization.pageBatchId);
      expect(f.groups.map(group => group.length)).toEqual([2, 3]);
    } finally { release(); await result; }
  });

  it("an archive write failure leaves every original member and fence intact", async () => {
    const f = await manuallySubmitted(), before = await readFile(path.join(f.store.root, "state.json"));
    await writeFile(path.join(f.store.root, "retarget-history"), "blocked directory");
    await expect(f.recovered.resume(f.request.uploadTaskId, undefined, undefined, f.request)).rejects.toThrow();
    expect(await readFile(path.join(f.store.root, "state.json"))).toEqual(before);
    expect(f.reopened.unavailable).toBe(true); expect(f.groups.map(group => group.length)).toEqual([2]);
  });

  it("reuses the durable proposal after interruption between archive sync and ledger commit", async () => {
    const f = await manuallySubmitted(), before = await readFile(path.join(f.store.root, "state.json"));
    const proposal = { ...f.remaining[0]!.authorization, pageBatchId: randomUUID(), expectedCount: 3 };
    vi.spyOn(f.reopened as unknown as { commit(value: unknown): Promise<void> }, "commit").mockRejectedValueOnce(new Error("simulated process exit before ledger commit"));
    await expect(f.reopened.continueUnselectedBatch(f.request, proposal)).rejects.toThrow("simulated process exit");
    const archivePath = path.join(f.store.root, "retarget-history", `${f.target.pageBatchId}.json`), archive = await readFile(archivePath);
    expect(await readFile(path.join(f.store.root, "state.json"))).toEqual(before);
    const restart = new DouyinUploadStore(f.store.root); await restart.load();
    const moved = await restart.continueUnselectedBatch(f.request, { ...proposal, pageBatchId: randomUUID() });
    expect(restart.unavailable).toBe(false); expect(moved).toHaveLength(3);
    expect(moved.every(task => JSON.stringify(task.authorization) === JSON.stringify(proposal))).toBe(true);
    expect(await readFile(archivePath)).toEqual(archive);
    for (const selected of f.selected) expect(restart.task(selected.result.upload_task_id)).toEqual(selected);
    const reloaded = new DouyinUploadStore(f.store.root); await reloaded.load(); expect(reloaded.tasks()).toEqual(restart.tasks());
    expect(f.groups.map(group => group.length)).toEqual([2]);
  });

  it("resumes through the service using the archived child identity after an interrupted migration", async () => {
    const f = await manuallySubmitted(), proposal = { ...f.remaining[0]!.authorization, pageBatchId: randomUUID(), expectedCount: 3 };
    vi.spyOn(f.reopened as unknown as { commit(value: unknown): Promise<void> }, "commit").mockRejectedValueOnce(new Error("simulated process exit"));
    await expect(f.reopened.continueUnselectedBatch(f.request, proposal)).rejects.toThrow("simulated process exit");
    const restart = new DouyinUploadStore(f.store.root); await restart.load(); f.useStore(restart);
    const recovered = new DouyinUploadService(restart, f.dependencies); await recovered.beginProduction();
    await recovered.resume(f.request.uploadTaskId, undefined, undefined, f.request);
    expect(f.groups.map(group => group.length)).toEqual([2, 3]);
    for (const task of f.remaining) {
      expect(restart.task(task.result.upload_task_id)!.authorization).toEqual(proposal);
      expect(restart.task(task.result.upload_task_id)!.result.state).toBe("ACCEPTED");
    }
    for (const selected of f.selected) expect(restart.task(selected.result.upload_task_id)).toEqual(selected);
  });

  it.each(["preimage", "declaration", "target", "destination"])("rejects a mismatching archived %s without modifying the ledger or selecting files", async kind => {
    const f = await manuallySubmitted(), proposal = { ...f.remaining[0]!.authorization, pageBatchId: randomUUID(), expectedCount: 3 };
    vi.spyOn(f.reopened as unknown as { commit(value: unknown): Promise<void> }, "commit").mockRejectedValueOnce(new Error("simulated process exit"));
    await expect(f.reopened.continueUnselectedBatch(f.request, proposal)).rejects.toThrow("simulated process exit");
    const archivePath = path.join(f.store.root, "retarget-history", `${f.target.pageBatchId}.json`), archive = JSON.parse(await readFile(archivePath, "utf8"));
    if (kind === "preimage") archive.tasks[0].result.timestamp = "2026-01-01T00:00:00.000Z";
    if (kind === "declaration") archive.submittedTaskIds.pop();
    if (kind === "target") archive.newAuthorization.target.adId = "999999";
    if (kind === "destination") archive.newAuthorization.pageBatchId = f.target.pageBatchId;
    const bytes = `${JSON.stringify(archive, null, 2)}\n`; await writeFile(archivePath, bytes);
    const before = await readFile(path.join(f.store.root, "state.json")), restart = new DouyinUploadStore(f.store.root); await restart.load();
    await expect(restart.continueUnselectedBatch(f.request, { ...proposal, pageBatchId: randomUUID() })).rejects.toThrow("接续归档");
    expect(restart.unavailable).toBe(true); expect(await readFile(archivePath, "utf8")).toBe(bytes);
    expect(await readFile(path.join(f.store.root, "state.json"))).toEqual(before);
    for (const selected of f.selected) expect(restart.task(selected.result.upload_task_id)).toEqual(selected);
    expect(f.groups.map(group => group.length)).toEqual([2]);
  });

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

  it("keeps continuation serialized until the current READY transaction is durable", async () => {
    const f = await fixture(); await f.pause(); const target = await f.batch(12), records = await f.admit(target);
    let releaseReady!: () => void, releaseSave!: () => void;
    const readyGate = new Promise<void>(resolve => { releaseReady = resolve; }), saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const ready = f.port.ready, save = f.store.saveTasks.bind(f.store); let saving = false;
    f.port.ready = async (tasks, signal) => { if (f.groups.length === 1) await readyGate; return ready(tasks, signal); };
    f.store.saveTasks = async tasks => {
      if (tasks.some(task => task.result.upload_task_id === records[4]!.result.upload_task_id && task.result.state === "WAITING_FOR_CONFIRMATION")) { saving = true; await saveGate; }
      await save(tasks);
    };
    const resumed = f.service.resume(records[0]!.result.upload_task_id);
    try {
      await vi.waitFor(() => expect(f.groups[0]).toHaveLength(9)); expect(f.groups).toHaveLength(1);
      expect(f.store.tasks().filter(task => f.store.hasMarker(task.result.upload_task_id))).toHaveLength(9);
      releaseReady(); await vi.waitFor(() => expect(saving).toBe(true));
      expect(f.groups).toHaveLength(1); expect(f.service.status(target.projectId).tasks.filter(task => task.state === "WAITING_FOR_CONFIRMATION")).toHaveLength(0);
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
