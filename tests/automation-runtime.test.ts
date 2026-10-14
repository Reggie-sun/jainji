import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AutomationRuntime } from "../src/main/automation-runtime";
import { createDefaultProject, type Project } from "../src/main/domain";
import { fingerprintFile } from "../src/main/paths";
import type { AutomationRequest, AutomationTask } from "../src/shared/automation";
import type { BatchProductionController } from "../src/main/batch-production-controller";
import type { QueueSnapshot } from "../src/main/queue";
import type { QianchuanLibraryResult } from "../src/shared/qianchuan-video-library";
import type { BatchProductionRun } from "../src/shared/batch-production";
import { uploadProducingExports } from "../src/main/automation-production-upload";
import { automationModelBinding, automationModelRoles, type AutomationModelRole } from "../src/main/automation-model-binding";
import { ConnectionStore } from "../src/main/connection-store";
import { ModelConnections } from "../src/main/model-connections";
import { DEFAULT_COVER_STICKER } from "../src/shared/cover-sticker";
import { automationDigest } from "../src/main/automation-files";
import { AutomationScheduler } from "../src/main/automation-scheduler";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "automation-runtime-")); roots.push(root);
  const source = path.join(root, "source.mp4"); await writeFile(source, "fixed-source");
  const project = createDefaultProject("固定模板");
  project.mediaItems = [{ id: crypto.randomUUID(), sourcePath: source, displayName: "source.mp4", fingerprint: await fingerprintFile(source),
    sizeBytes: 12, durationMs: 1000, width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() }];
  const recentId = crypto.randomUUID(), taskId = crypto.randomUUID(), productionRunId = crypto.randomUUID(), exportId = crypto.randomUUID(), batchId = crypto.randomUUID();
  const account = { product: "蝴蝶贴" as const, advertiserId: "123", adId: "456", cdpEndpoint: "http://127.0.0.1:9222", configDigest: "a".repeat(64) };
  const request: AutomationRequest = { name: "制作", time: "12:00", enabled: false, upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION",
    production: { entries: [{ recentProjectId: recentId, requestedCount: 1, productPrice: "", displayMode: "full", coverEnabled: false, mode: "random",
      douyinUpload: { enabled: true, accountProduct: "蝴蝶贴", plan: { advertiserId: "123", adId: "456", name: "固定计划" } } }] } };
  const tasks = new Map<string, AutomationTask>();
  const produce = vi.fn(async (_input: unknown, _projects: ReadonlyMap<string, Project>) => {});
  const dependencies = { loadProject: vi.fn(async () => project), account: vi.fn(async () => account), modelBinding: (_roles: AutomationModelRole[]) => "model", approvedDirectories: new Set<string>(),
    controller: { busy: false, snapshot: () => ({ id: productionRunId, status: "finished", jobs: [{ status: "completed", completedCount: 1, requestedCount: 1, completedTaskIds: [exportId] }] }), cancel: vi.fn() } as unknown as BatchProductionController,
    queue: { snapshot: () => ({ batches: [{ batch: { id: batchId, projectId: project.id, tasks: [{ id: exportId, status: "completed", outputArtifact: { taskId: exportId } }] } }] }) as QueueSnapshot, waitForPersistence: async (signal: AbortSignal) => signal.throwIfAborted() },
    task: (id: string) => tasks.get(id), produce, clear: vi.fn(async (): Promise<QianchuanLibraryResult[]> => [{ product: "蝴蝶贴", advertiserId: "123", state: "CLEARED", deletedCount: 0, message: "清理完成" }]),
    upload: vi.fn(async (_groups: Parameters<ConstructorParameters<typeof AutomationRuntime>[1]["upload"]>[0], _signal: AbortSignal) => {}),
    finishUploadAccount: vi.fn(async () => {}), releaseUploadAccounts: vi.fn(),
  };
  const runtime = new AutomationRuntime(root, dependencies);
  const create = async (input = request) => {
    const id = tasks.size ? crypto.randomUUID() : taskId;
    const prepared = await runtime.prepare(input, id);
    const task: AutomationTask = { id, request: input, ...prepared, createdAt: new Date().toISOString(),
      lastRun: { id: crypto.randomUUID(), day: "2026-10-10", startedAt: new Date().toISOString(), state: "RUNNING", message: "running" } };
    tasks.set(id, task); return task;
  };
  return { root, source, project, request, account, runtime, dependencies, create, tasks, exportId, recentId, productionRunId, batchId };
}

async function streamingFixture(count = 1) {
  const f = await fixture();
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  const run: BatchProductionRun = { id: f.productionRunId, status: "running", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), jobs: [{
    id: crypto.randomUUID(), recentProjectId: f.recentId, projectId: f.project.id, name: f.project.name, requestedCount: count, actualCount: count,
    productPrice: "", coverEnabled: false, displayMode: "full", status: "exporting", taskIds: ids, completedTaskIds: [], completedCount: 0, failedCount: 0,
  }] };
  const completed = new Set<string>();
  const complete = (values: string[]) => {
    values.forEach(id => completed.add(id)); run.jobs[0].completedTaskIds = [...completed]; run.jobs[0].completedCount = completed.size;
  };
  const finish = () => { run.status = "finished"; run.jobs[0].status = "completed"; };
  f.dependencies.controller = { get busy() { return run.status === "running"; }, snapshot: () => structuredClone(run), executionSignal: () => new AbortController().signal,
    cancel: vi.fn(async () => { run.status = "cancelled"; }) } as unknown as BatchProductionController;
  f.dependencies.queue.snapshot = () => ({ batches: [{ batch: { id: f.batchId, projectId: f.project.id, tasks: ids.map(id => ({ id, batchId: f.batchId,
    status: completed.has(id) ? "completed" : "running", ...(completed.has(id) ? { outputArtifact: { taskId: id } } : {}) })) } }] }) as QueueSnapshot;
  const task = await f.create({ ...f.request, upload: true, production: { entries: f.request.production!.entries.map(entry => ({ ...entry, requestedCount: count })) } });
  return { ...f, run, ids, complete, finish, task };
}

it("uploads the first verified export while production continues, then drains later exports without repeats", async () => {
  const f = await streamingFixture(3); f.complete([f.ids[0]]);
  let release!: () => void; const uploading = new Promise<void>(resolve => { release = resolve; });
  const busyAtUpload: boolean[] = [];
  f.dependencies.upload.mockImplementation(async () => { busyAtUpload.push(f.dependencies.controller.busy); if (busyAtUpload.length === 1) await uploading; });
  const execution = f.runtime.execute(f.task, new AbortController().signal);
  let early = true;
  try { await vi.waitFor(() => expect(f.dependencies.upload).toHaveBeenCalledTimes(1), { timeout: 750 }); }
  catch { early = false; }
  finally { f.complete(f.ids); f.finish(); release(); }
  const result = await execution;
  expect(early).toBe(true);
  expect(busyAtUpload[0]).toBe(true);
  expect(f.dependencies.upload.mock.calls.flatMap(call => (call[0] as { exports: { export_task_id: string }[] }[]).flatMap(group => group.exports.map(value => value.export_task_id)))).toEqual(f.ids);
  expect(result.exports).toHaveLength(3);
});

it("sends at most nine ready exports per call and includes the final short group", async () => {
  const f = await streamingFixture(20); f.complete(f.ids); f.finish();
  const result = await f.runtime.execute(f.task, new AbortController().signal);
  expect(f.dependencies.upload.mock.calls.map(call => (call[0] as { exports: unknown[] }[])[0].exports.length)).toEqual([9, 9, 2]);
  expect(result.exports).toHaveLength(20);
});

it("holds a remote account until its remaining exports finish, then closes before advancing through five accounts", async () => {
  const f = await streamingFixture(2);
  const products = ["蝴蝶贴", "氨糖膏", "滴耳康", "眼贴", "肥皂"] as const;
  const route = { mode: "remote-browser" as const, group: "one", sshHost: "one", localPort: 19160, expectedIp: "8.8.8.8" };
  const bindings = products.map((product, i) => ({ recentProjectId: i ? crypto.randomUUID() : f.recentId,
    projectId: i ? crypto.randomUUID() : f.project.id, requestedCount: i ? 1 : 2,
    target: { ...f.account, product, advertiserId: String(1000 + i), egress: route },
    selection: { enabled: true as const, accountProduct: product, plan: { advertiserId: String(1000 + i), adId: "456", name: "计划" } } }));
  const batchIds = bindings.map((_, i) => i ? crypto.randomUUID() : f.batchId);
  bindings.slice(1).forEach(binding => f.run.jobs.push({ ...f.run.jobs[0], id: crypto.randomUUID(), recentProjectId: binding.recentProjectId,
    projectId: binding.projectId, requestedCount: 1, actualCount: 1, taskIds: [crypto.randomUUID()], completedTaskIds: [], completedCount: 1, status: "completed" }));
  f.run.jobs.slice(1).forEach(job => { job.completedTaskIds = [...job.taskIds]; }); f.complete([f.ids[0]]);
  f.dependencies.queue.snapshot = () => ({ batches: f.run.jobs.map((job, i) => ({ batch: { id: batchIds[i], projectId: bindings[i].projectId,
    tasks: job.completedTaskIds!.map(id => ({ id, batchId: batchIds[i], status: "completed", outputArtifact: { taskId: id } })) } })) }) as QueueSnapshot;
  const events: string[] = [];
  const uploading = uploadProducingExports({ runId: f.run.id, bindings, controller: f.dependencies.controller, queue: f.dependencies.queue,
    upload: async groups => { events.push(`upload:${groups[0].target.advertiserId}`); }, finishAccount: async target => { events.push(`close:${target.advertiserId}`); } }, new AbortController().signal);
  await vi.waitFor(() => expect(events).toEqual(["upload:1000"]));
  await new Promise(resolve => setTimeout(resolve, 300)); expect(events).toEqual(["upload:1000"]);
  f.complete(f.ids); f.finish();
  expect(await uploading).toHaveLength(6);
  expect(events).toEqual(["upload:1000", "upload:1000", "close:1000", ...bindings.slice(1).flatMap(b => [`upload:${b.target.advertiserId}`, `close:${b.target.advertiserId}`])]);
});

it("does not upload to the next remote account when closing the completed account fails", async () => {
  const f = await streamingFixture(); f.complete(f.ids); f.finish();
  const target = { ...f.account, egress: { mode: "remote-browser" as const, group: "one", sshHost: "one", localPort: 19160, expectedIp: "8.8.8.8" } };
  const upload = vi.fn(async () => {}), finishAccount = vi.fn(async () => { throw new Error("close failed"); });
  await expect(uploadProducingExports({ runId: f.run.id, bindings: [{ recentProjectId: f.recentId, projectId: f.project.id, requestedCount: 1,
    target, selection: f.request.production!.entries[0].douyinUpload! }], controller: f.dependencies.controller, queue: f.dependencies.queue, upload, finishAccount }, new AbortController().signal)).rejects.toThrow("close failed");
  expect(upload).toHaveBeenCalledTimes(1); expect(finishAccount).toHaveBeenCalledTimes(1);
});

it("uploads successful exports from a normally failed production job but does not complete the automation", async () => {
  const f = await streamingFixture(2); f.complete([f.ids[0]]); f.finish(); f.run.jobs[0].status = "failed"; f.run.jobs[0].failedCount = 1;
  await expect(f.runtime.execute(f.task, new AbortController().signal)).rejects.toThrow("制作或导出未全部成功");
  expect(f.dependencies.upload).toHaveBeenCalledTimes(1);
  expect((f.dependencies.upload.mock.calls[0][0] as { exports: unknown[] }[])[0].exports).toHaveLength(1);
});

it("stops after an unknown upload outcome and never replays that occurrence after restart", async () => {
  const f = await streamingFixture(12); f.complete(f.ids);
  f.dependencies.upload.mockRejectedValue(new Error("上传结果未知"));
  const execution = f.runtime.execute(f.task, new AbortController().signal).catch(error => error);
  let early = true;
  try { await vi.waitFor(() => expect(f.dependencies.upload).toHaveBeenCalledTimes(1), { timeout: 750 }); }
  catch { early = false; }
  finally { f.finish(); }
  expect((await execution).message).toBe("上传结果未知"); expect(early).toBe(true);
  expect(f.dependencies.controller.cancel).toHaveBeenCalled();
  const restored = new AutomationRuntime(f.root, f.dependencies);
  await expect(restored.execute(f.task, new AbortController().signal)).rejects.toThrow("禁止自动重传");
  expect(f.dependencies.upload).toHaveBeenCalledTimes(1); expect(f.dependencies.produce).toHaveBeenCalledTimes(1);
});

it("rejects a completed export belonging to a different project before upload", async () => {
  const f = await streamingFixture(); f.complete(f.ids); f.finish();
  const snapshot = f.dependencies.queue.snapshot(); snapshot.batches[0].batch.projectId = crypto.randomUUID();
  f.dependencies.queue.snapshot = () => snapshot;
  await expect(f.runtime.execute(f.task, new AbortController().signal)).rejects.toThrow("归属");
  expect(f.dependencies.upload).not.toHaveBeenCalled();
});

it("does not cancel a replacement production run when the original run identity changes", async () => {
  const f = await streamingFixture(2); f.complete(f.ids); f.finish();
  f.dependencies.upload.mockImplementation(async () => { f.run.id = crypto.randomUUID(); f.run.status = "running"; });
  await expect(f.runtime.execute(f.task, new AbortController().signal)).rejects.toThrow("制作运行");
  expect(f.dependencies.upload).toHaveBeenCalledTimes(1);
  expect(f.dependencies.controller.cancel).not.toHaveBeenCalled();
});

it("cancels while waiting for later exports without uploading them", async () => {
  const f = await streamingFixture(2); f.complete([f.ids[0]]);
  const abort = new AbortController();
  f.dependencies.upload.mockImplementation(async () => { f.complete(f.ids); abort.abort(); });
  await expect(f.runtime.execute(f.task, abort.signal)).rejects.toThrow();
  expect(f.dependencies.upload).toHaveBeenCalledTimes(1); expect(f.dependencies.controller.cancel).toHaveBeenCalledTimes(1);
});

it("does not admit an early upload when its original job is cancelled during queue persistence", async () => {
  const f = await streamingFixture(); f.complete(f.ids);
  const jobAbort = new AbortController();
  f.dependencies.controller.executionSignal = () => jobAbort.signal;
  f.dependencies.queue.waitForPersistence = vi.fn(async signal => { jobAbort.abort(); signal.throwIfAborted(); });
  await expect(f.runtime.execute(f.task, new AbortController().signal)).rejects.toThrow();
  expect(f.dependencies.queue.waitForPersistence).toHaveBeenCalledTimes(1);
  expect(f.dependencies.upload).not.toHaveBeenCalled();
  expect(f.dependencies.controller.cancel).toHaveBeenCalledTimes(1);
});

it("ignores historical queue exports and respects a cancelled job", async () => {
  const f = await streamingFixture(2); f.complete(f.ids); f.finish(); f.run.jobs[0].status = "cancelled";
  await expect(f.runtime.execute(f.task, new AbortController().signal)).rejects.toThrow("制作或导出未全部成功");
  expect(f.dependencies.upload).not.toHaveBeenCalled();
  f.run.jobs[0].status = "completed";
  const task = await f.create(f.task.request);
  const snapshot = f.dependencies.queue.snapshot(), old = structuredClone(snapshot.batches[0]);
  old.batch.id = crypto.randomUUID(); old.batch.tasks = [{ ...old.batch.tasks[0], id: crypto.randomUUID(), batchId: old.batch.id }]; snapshot.batches.push(old);
  f.dependencies.queue.snapshot = () => snapshot;
  const result = await f.runtime.execute(task, new AbortController().signal);
  expect(result.exports).toHaveLength(2);
  expect(f.dependencies.upload.mock.calls.flatMap(([groups]) => groups.flatMap(group => group.exports.map(value => value.export_task_id)))).toEqual(f.ids);
});
it("uses the saved project snapshot even when the editor or saved template later changes", async () => {
  const f = await fixture(), task = await f.create(); f.project.name = "changed";
  const result = await f.runtime.execute(task, new AbortController().signal);
  expect([...f.dependencies.produce.mock.calls[0][1].values()][0].name).toBe("固定模板");
  expect(f.dependencies.produce.mock.calls[0][0]).toEqual({ entries: [expect.not.objectContaining({ douyinUpload: expect.anything() })] });
  expect(result.exports?.[0].export_task_id).toBe(f.exportId); expect(f.dependencies.upload).not.toHaveBeenCalled();
});
it("blocks account drift and source replacement before cleanup or production", async () => {
  const f = await fixture(), task = await f.create(); f.account.advertiserId = "999";
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("账号");
  f.account.advertiserId = "123"; await writeFile(f.source, "new source");
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("源素材已变化");
  expect(f.dependencies.produce).not.toHaveBeenCalled(); expect(f.dependencies.clear).not.toHaveBeenCalled();
});
it("stops a chain after partial cleanup", async () => {
  const f = await fixture(); const task = await f.create({ ...f.request, upload: true, cleanup: { confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123", expectedAdId: "456" }] } });
  f.dependencies.clear.mockResolvedValue([{ product: "蝴蝶贴", advertiserId: "123", state: "PARTIAL", deletedCount: 2, message: "历史未知" }]);
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("后续步骤已停止");
  expect(f.dependencies.produce).not.toHaveBeenCalled(); expect(f.dependencies.upload).not.toHaveBeenCalled();
});
it("executes both cleanup scopes as one existing service request and stops after an unknown result", async () => {
  const f = await fixture();
  const cleanup = { confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS" as const, planMaterialRule: "AUDIT_AND_ZERO_IMPRESSIONS_15D" as const,
    accounts: [{ product: "蝴蝶贴" as const, expectedAdvertiserId: "123", plans: [{ advertiserId: "123", adId: "456", name: "固定计划" }] }] };
  const task = await f.create({ ...f.request, production: undefined, cleanup });
  await f.runtime.execute(task, new AbortController().signal);
  expect(f.dependencies.clear).toHaveBeenCalledTimes(1);
  expect(f.dependencies.clear).toHaveBeenCalledWith(cleanup, expect.any(AbortSignal));
  f.dependencies.clear.mockResolvedValue([{ product: "蝴蝶贴", advertiserId: "123", state: "BLOCKED", deletedCount: 0, message: "结果未知" }]);
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("结果未知");
  expect(f.dependencies.produce).not.toHaveBeenCalled(); expect(f.dependencies.upload).not.toHaveBeenCalled();
});
it("consumes completed source-run exports once across different upload schedules and after restart", async () => {
  const f = await fixture(), source = await f.create();
  source.lastRun = { ...source.lastRun!, ...await f.runtime.execute(source, new AbortController().signal), state: "COMPLETED" };
  const input: AutomationRequest = { ...f.request, production: undefined, upload: true, uploadFrom: source.id };
  const first = await f.create(input), second = await f.create(input);
  await f.runtime.execute(first, new AbortController().signal);
  const restored = new AutomationRuntime(f.root, f.dependencies);
  await expect(restored.execute(second, new AbortController().signal)).rejects.toThrow("禁止自动重传");
  expect(f.dependencies.upload).toHaveBeenCalledTimes(1);
});
it("rejects tampered fixed actions and cancellation before effects", async () => {
  const f = await fixture(), task = await f.create();
  await expect(f.runtime.execute({ ...task, request: { ...task.request, upload: true } }, new AbortController().signal)).rejects.toThrow("不一致");
  const abort = new AbortController(); abort.abort();
  await expect(f.runtime.execute(task, abort.signal)).rejects.toThrow();
  expect(f.dependencies.produce).not.toHaveBeenCalled();
});
it("uses current models for default automatic cover even when an old template has no cover settings", async () => {
  const f = await fixture(); delete f.project.coverSticker;
  const task = await f.create({ ...f.request, production: { entries: f.request.production!.entries.map(entry => ({ ...entry, coverEnabled: true })) } });
  f.dependencies.modelBinding = () => "changed-model";
  await expect(f.runtime.execute(task, new AbortController().signal)).resolves.toMatchObject({ productionRunId: f.productionRunId });
  expect(f.dependencies.produce).toHaveBeenCalledOnce();
});
it("reads current models without rewriting the frozen task or requiring an explicit refresh", async () => {
  const f = await fixture();
  const task = await f.create({ ...f.request, production: { entries: f.request.production!.entries.map(entry => ({ ...entry, mode: "agent" })) } });
  const original = await readFile(path.join(f.root, "recipes", `${task.id}.json`), "utf8");
  f.dependencies.modelBinding = () => "changed-model";
  await expect(f.runtime.configure(task)).resolves.toBeUndefined();
  expect(await f.runtime.configurationIssue(task)).toBeUndefined();
  expect(await readFile(path.join(f.root, "recipes", `${task.id}.json`), "utf8")).toBe(original);
  expect(JSON.parse(original).modelBinding).toBeUndefined();
  expect(f.dependencies.loadProject).toHaveBeenCalledTimes(1);
  expect(f.dependencies.produce).not.toHaveBeenCalled(); expect(f.dependencies.clear).not.toHaveBeenCalled(); expect(f.dependencies.upload).not.toHaveBeenCalled();
  const restored = new AutomationRuntime(f.root, f.dependencies);
  await expect(restored.execute(task, new AbortController().signal)).resolves.toMatchObject({ productionRunId: f.productionRunId });
});
it("refuses configuration when frozen material or account has changed", async () => {
  const f = await fixture(), task = await f.create();
  f.account.configDigest = "b".repeat(64);
  await expect(f.runtime.configure(task)).rejects.toThrow("账号");
  f.account.configDigest = "a".repeat(64); await writeFile(f.source, "different-source");
  await expect(f.runtime.configure(task)).rejects.toThrow("源素材");
  expect(f.dependencies.produce).not.toHaveBeenCalled(); expect(f.dependencies.upload).not.toHaveBeenCalled();
});
it("reads legacy recipe pointers and model fields while retaining recipe integrity checks", async () => {
  const f = await fixture(); const task = await f.create({ ...f.request, production: { entries: f.request.production!.entries.map(entry => ({ ...entry, mode: "agent" })) } });
  const file = path.join(f.root, "recipes", `${task.id}.json`), recipe = JSON.parse(await readFile(file, "utf8"));
  recipe.modelBinding = "legacy-model"; delete recipe.modelRoles;
  const recipeId = crypto.randomUUID(), legacyFile = path.join(f.root, "recipes", `${recipeId}.json`);
  await writeFile(legacyFile, JSON.stringify(recipe), { mode: 0o600 }); task.binding = automationDigest(recipe); task.recipeId = recipeId;
  f.dependencies.modelBinding = roles => roles ? "scoped" : "legacy-changed";
  await expect(f.runtime.configure(task)).resolves.toBeUndefined();
  await expect(f.runtime.execute(task, new AbortController().signal)).resolves.toMatchObject({ productionRunId: f.productionRunId });
  recipe.modelBinding = "tampered"; await writeFile(legacyFile, JSON.stringify(recipe));
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("固定配置不一致");
  expect(task.lastRun?.state).toBe("RUNNING");
});
it("uses current models through save, restart and scheduled production without changing task binding", async () => {
  const f = await fixture(); let now = new Date(2026, 9, 12, 18, 7);
  const dependencies = { prepare: f.runtime.prepare.bind(f.runtime), configure: f.runtime.configure.bind(f.runtime),
    configurationIssue: f.runtime.configurationIssue.bind(f.runtime), execute: f.runtime.execute.bind(f.runtime), busy: () => false, changed: () => {}, now: () => now };
  const scheduler = new AutomationScheduler(f.root, dependencies); await scheduler.load();
  const task = (await scheduler.create({ ...f.request, enabled: true, time: "18:08", production: { entries: f.request.production!.entries.map(entry => ({ ...entry, mode: "agent" })) } })).tasks[0];
  f.dependencies.modelBinding = () => "changed-model"; await scheduler.refreshConfiguration();
  expect(scheduler.snapshot().tasks[0].configurationIssue).toBeUndefined();
  await scheduler.configure({ id: task.id, enabled: true, time: "18:10" });
  expect(scheduler.task(task.id)?.binding).toBe(task.binding);
  const restored = new AutomationScheduler(f.root, dependencies); await restored.load(); restored.start();
  try {
    now = new Date(2026, 9, 12, 18, 9); await restored.tick(); expect(f.dependencies.produce).not.toHaveBeenCalled();
    now = new Date(2026, 9, 12, 18, 10); await restored.tick(); await restored.tick();
    expect(restored.task(task.id)?.lastRun?.state).toBe("COMPLETED"); expect(f.dependencies.produce).toHaveBeenCalledTimes(1);
    expect(f.dependencies.upload).not.toHaveBeenCalled();
  } finally { await restored.stop(); }
});
it("blocks missing current models before any cleanup and clears the observation after configuration recovers", async () => {
  const f = await fixture(), task = await f.create({ ...f.request,
    cleanup: { confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123", expectedAdId: "456" }] },
    production: { entries: f.request.production!.entries.map(entry => ({ ...entry, mode: "agent" })) } });
  f.dependencies.modelBinding = () => { throw new Error("请先在模型与 API 中配置视觉识别模型。"); };
  expect(await f.runtime.configurationIssue(task)).toContain("视觉识别模型");
  await expect(f.runtime.configure(task)).rejects.toThrow("视觉识别模型");
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("视觉识别模型");
  expect(f.dependencies.clear).not.toHaveBeenCalled(); expect(f.dependencies.produce).not.toHaveBeenCalled();
  f.dependencies.modelBinding = () => "recovered-model";
  expect(await f.runtime.configurationIssue(task)).toBeUndefined();
});
it("pins current models for one execution and refuses drift during cleanup", async () => {
  const f = await fixture(), task = await f.create({ ...f.request,
    cleanup: { confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123", expectedAdId: "456" }] },
    production: { entries: f.request.production!.entries.map(entry => ({ ...entry, mode: "agent" })) } });
  f.dependencies.modelBinding = () => "current-model";
  f.dependencies.clear.mockImplementation(async () => {
    f.dependencies.modelBinding = () => "changed-during-run";
    return [{ product: "蝴蝶贴", advertiserId: "123", state: "CLEARED", deletedCount: 0, message: "完成" }];
  });
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("模型配置已在本次执行中变化");
  expect(f.dependencies.clear).toHaveBeenCalledOnce(); expect(f.dependencies.produce).not.toHaveBeenCalled();
});
it("does not require models when independently uploading already completed source exports", async () => {
  const f = await fixture(), source = await f.create({ ...f.request,
    production: { entries: f.request.production!.entries.map(entry => ({ ...entry, mode: "agent" })) } });
  Object.assign(source.lastRun!, await f.runtime.execute(source, new AbortController().signal), { state: "COMPLETED" });
  f.dependencies.modelBinding = () => { throw new Error("模型未配置"); };
  const task = await f.create({ ...f.request, production: undefined, upload: true, uploadFrom: source.id });
  expect(await f.runtime.configurationIssue(task)).toBeUndefined();
  await expect(f.runtime.configure(task)).resolves.toBeUndefined();
  await expect(f.runtime.execute(task, new AbortController().signal)).resolves.toMatchObject({ productionRunId: f.productionRunId });
  expect(f.dependencies.upload).toHaveBeenCalledOnce(); expect(f.dependencies.produce).toHaveBeenCalledOnce();
});
it.each([
  { mode: "random", cover: false, tracking: "agent", roles: [] },
  { mode: "manual", cover: true, tracking: "manual", roles: [] },
  { mode: "agent", cover: false, tracking: "agent", roles: ["creative", "reviewer", "vision"] },
  { mode: "random", cover: true, tracking: "agent", roles: ["creative", "reviewer", "vision"] },
  { mode: "agent", cover: true, tracking: "manual", roles: ["creative"] },
  { mode: "random", cover: true, tracking: "agent", hybrid: true, roles: ["hybrid"] },
  { mode: "random", cover: false, tracking: "agent", hybrid: true, roles: [] },
  { mode: "random", cover: true, tracking: "agent", artwork: true, roles: [] },
  { mode: "agent", cover: true, tracking: "agent", artwork: true, roles: ["creative"] },
] as const)("matches production role dependencies: %j", async scenario => {
  const f = await fixture();
  f.project.coverSticker = { ...DEFAULT_COVER_STICKER, trackingMode: scenario.tracking,
    ...("hybrid" in scenario ? { coverStrategy: "shape-matched-static-v1" as const } : {}) };
  const request = { ...f.request, production: { entries: f.request.production!.entries.map(entry => ({ ...entry, mode: scenario.mode,
    coverEnabled: scenario.cover, ...("artwork" in scenario ? { coverMethod: "real-artwork" as const } : {}) })) } };
  expect(automationModelRoles(request, [{ recentProjectId: f.recentId, project: f.project }])).toEqual(scenario.roles);
});
it("ignores names and unused connections but binds effective role inputs without exposing keys", async () => {
  const f = await fixture(), store = new ConnectionStore(path.join(f.root, "connections")); await store.load();
  const input = { name: "创作", baseUrl: "https://fixture.example/v1", model: "fixture-model", apiKey: "private-fixture-key", protocol: "responses" as const };
  const first = await store.save(input); await store.select(first);
  await store.selectVision({ connectionId: first, model: "vision-model" }); await store.selectReviewer({ connectionId: first, model: "review-model" });
  const configured = { status: () => ({ configured: true }) };
  const connections = { store, assertConfigurationIdle: () => {}, provider: configured, visionProvider: configured, reviewerProvider: configured } as unknown as ModelConnections;
  const roles: AutomationModelRole[] = ["creative", "reviewer", "vision"], binding = automationModelBinding(connections, roles);
  const unused = await store.save({ ...input, name: "未使用", model: "unused" });
  await store.save({ ...input, id: first, name: "只改名称" });
  await store.saveChatGPTModel("dormant-model", "high");
  expect(automationModelBinding(connections, roles)).toBe(binding);
  await store.save({ ...input, id: unused, apiKey: "other-key", baseUrl: "https://other.example/v1", model: "other-model" });
  expect(automationModelBinding(connections, roles)).toBe(binding);
  await store.selectReviewer({ connectionId: first, model: "changed-reviewer" });
  expect(automationModelBinding(connections, roles)).not.toBe(binding);
  f.dependencies.modelBinding = selected => automationModelBinding(connections, selected);
  const task = await f.create({ ...f.request, production: { entries: f.request.production!.entries.map(entry => ({ ...entry, mode: "agent" })) } });
  const recipe = await readFile(path.join(f.root, "recipes", `${task.id}.json`), "utf8");
  expect(recipe).not.toContain("private-fixture-key"); expect(recipe).not.toContain("apiKey");
  const before = automationModelBinding(connections, roles);
  await store.save({ ...input, id: first, apiKey: "rotated-key" });
  expect(automationModelBinding(connections, roles)).not.toBe(before);
  await expect(f.runtime.configure(task)).resolves.toBeUndefined();
});
it("keeps an API task binding readable while an unused ChatGPT connection is logging in", async () => {
  const f = await fixture(), store = new ConnectionStore(path.join(f.root, "connections")); await store.load();
  const profile = await store.save({ name: "使用中", baseUrl: "https://fixture.example/v1", model: "fixture-model", apiKey: "fake-key" });
  await store.select(profile);
  const state = { status: "logged-in" };
  const connections = { store, provider: { status: () => ({ configured: true }) }, chatgpt: { status: () => state },
    assertIdle: ModelConnections.prototype.assertIdle, assertConfigurationIdle: ModelConnections.prototype.assertConfigurationIdle } as unknown as ModelConnections;
  const before = automationModelBinding(connections, ["creative"]);
  state.status = "logging-in";
  expect(() => connections.assertIdle()).toThrow("连接正在处理中");
  expect(automationModelBinding(connections, ["creative"])).toBe(before);
});
it("blocks a task binding while its API configuration save is still pending", async () => {
  const f = await fixture(), connections = new ModelConnections(f.root, process.cwd(), async () => {}, () => {});
  await connections.restore();
  const input = { name: "使用中", baseUrl: "https://fixture.example/v1", model: "fixture-model", apiKey: "fake-key" };
  await connections.save(input);
  const id = connections.store.snapshot().profiles[0].id;
  await connections.select(id);
  const before = automationModelBinding(connections, ["creative"]);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const save = connections.store.save.bind(connections.store);
  vi.spyOn(connections.store, "save").mockImplementation(async value => { await gate; return save(value); });
  const saving = connections.save({ ...input, id, apiKey: "changed-key" });
  try {
    expect(() => automationModelBinding(connections, ["creative"])).toThrow("连接正在处理中");
    release(); await saving;
    expect(automationModelBinding(connections, ["creative"])).not.toBe(before);
  } finally { release(); await saving; await connections.dispose(); }
});
it.each(["baseUrl", "model", "reasoningEffort", "protocol", "authHeader"] as const)("binds changes to an active API %s", async field => {
  const f = await fixture(), store = new ConnectionStore(path.join(f.root, "connections")); await store.load();
  const input = { name: "使用中", baseUrl: "https://fixture.example/v1", model: "fixture-model", apiKey: "fake-key" };
  const profile = await store.save(input); await store.select(profile);
  const connections = { store, assertConfigurationIdle: () => {}, provider: { status: () => ({ configured: true }) } } as unknown as ModelConnections;
  const before = automationModelBinding(connections, ["creative"]);
  const changes = { baseUrl: "https://other.example/v1", model: "other-model", reasoningEffort: "high", protocol: "responses", authHeader: "x-api-key" };
  await store.save({ ...input, id: profile, [field]: changes[field] });
  expect(automationModelBinding(connections, ["creative"])).not.toBe(before);
});
it("binds ChatGPT account and model choices only for an active ChatGPT role", async () => {
  const f = await fixture(), store = new ConnectionStore(path.join(f.root, "connections")); await store.load();
  await store.select("chatgpt"); await store.saveChatGPTModel("gpt-6.1-sol", "high");
  const state = { email: "fixture@example.com", model: "gpt-6.1-sol", reasoningEffort: "high" };
  const connections = { store, assertConfigurationIdle: () => {}, provider: { status: () => ({ configured: true }) },
    chatgpt: { status: () => state, assertModel: vi.fn() } } as unknown as ModelConnections;
  const before = automationModelBinding(connections, ["creative"]); state.email = "different@example.com";
  expect(automationModelBinding(connections, ["creative"])).not.toBe(before);
  const next = automationModelBinding(connections, ["creative"]); await store.saveChatGPTModel("gpt-6-luna", "medium");
  expect(automationModelBinding(connections, ["creative"])).not.toBe(next);
});
it("uses canonical Hybrid routes rather than unrelated creative or visual role settings, without requests", async () => {
  const f = await fixture(), store = new ConnectionStore(path.join(f.root, "connections")); await store.load();
  const minimax = await store.save({ name: "Hybrid", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M3", protocol: "responses", apiKey: "fake-key" });
  const models = ["gpt-6-luna", "gpt-6.1-sol"].map(model => ({ model, defaultReasoningEffort: "high" }));
  const complete = vi.fn(), state = { email: "fixture@example.com", models };
  const connections = { store, assertConfigurationIdle: () => {}, chatgpt: { status: () => state, assertModel: (model: string) => { if (!models.some(value => value.model === model)) throw Error("unavailable"); } },
    reviewProvider: () => ({ completeStructuredVision: complete }) } as unknown as ModelConnections;
  const before = automationModelBinding(connections, ["hybrid"]);
  const other = await store.save({ name: "其他", baseUrl: "https://fixture.example/v1", model: "other-model", apiKey: "fake-key" });
  await store.select(other); await store.selectVision({ connectionId: other, model: "unused-vision" });
  await store.saveChatGPTModel("gpt-6-luna", "medium");
  expect(automationModelBinding(connections, ["hybrid"])).toBe(before);
  await store.save({ id: minimax, name: "改名称", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M3", protocol: "responses", apiKey: "fake-key" });
  expect(automationModelBinding(connections, ["hybrid"])).toBe(before);
  state.email = "changed@example.com"; expect(automationModelBinding(connections, ["hybrid"])).not.toBe(before);
  expect(complete).not.toHaveBeenCalled();
});
it("rejects replacement of a frozen output directory by a symbolic link before cleanup", async () => {
  const f = await fixture(), output = path.join(f.root, "output"), elsewhere = path.join(f.root, "elsewhere");
  await mkdir(output); await mkdir(elsewhere); f.dependencies.approvedDirectories.add(output);
  const task = await f.create({ ...f.request, production: { entries: f.request.production!.entries.map(entry => ({ ...entry, outputDirectory: output })) },
    cleanup: { confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123", expectedAdId: "456" }] } });
  await rename(output, `${output}-old`); await symlink(elsewhere, output);
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("成片目录");
  expect(f.dependencies.clear).not.toHaveBeenCalled(); expect(f.dependencies.produce).not.toHaveBeenCalled();
});
