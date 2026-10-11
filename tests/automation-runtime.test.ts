import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
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
  const dependencies = { loadProject: vi.fn(async () => project), account: vi.fn(async () => account), modelBinding: () => "model", approvedDirectories: new Set<string>(),
    controller: { busy: false, snapshot: () => ({ id: productionRunId, status: "finished", jobs: [{ status: "completed", completedCount: 1, requestedCount: 1, completedTaskIds: [exportId] }] }), cancel: vi.fn() } as unknown as BatchProductionController,
    queue: { snapshot: () => ({ batches: [{ batch: { id: batchId, projectId: project.id, tasks: [{ id: exportId, status: "completed", outputArtifact: { taskId: exportId } }] } }] }) as QueueSnapshot, waitForPersistence: async (signal: AbortSignal) => signal.throwIfAborted() },
    task: (id: string) => tasks.get(id), produce, clear: vi.fn(async (): Promise<QianchuanLibraryResult[]> => [{ product: "蝴蝶贴", advertiserId: "123", state: "CLEARED", deletedCount: 0, message: "清理完成" }]),
    upload: vi.fn(async (_groups: Parameters<ConstructorParameters<typeof AutomationRuntime>[1]["upload"]>[0], _signal: AbortSignal) => {}),
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
it("binds the model for default automatic cover even when an old template has no cover settings", async () => {
  const f = await fixture(); delete f.project.coverSticker;
  const task = await f.create({ ...f.request, production: { entries: f.request.production!.entries.map(entry => ({ ...entry, coverEnabled: true })) } });
  f.dependencies.modelBinding = () => "changed-model";
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("模型连接已变化");
  expect(f.dependencies.produce).not.toHaveBeenCalled();
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
