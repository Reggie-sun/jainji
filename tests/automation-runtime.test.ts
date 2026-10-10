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
    queue: { snapshot: () => ({ batches: [{ batch: { id: batchId, projectId: project.id, tasks: [{ id: exportId, status: "completed", outputArtifact: { taskId: exportId } }] } }] }) as QueueSnapshot },
    task: (id: string) => tasks.get(id), produce, clear: vi.fn(async (): Promise<QianchuanLibraryResult[]> => [{ product: "蝴蝶贴", advertiserId: "123", state: "CLEARED", deletedCount: 0, message: "清理完成" }]),
    upload: vi.fn(async () => {}),
  };
  const runtime = new AutomationRuntime(root, dependencies);
  const create = async (input = request) => {
    const id = tasks.size ? crypto.randomUUID() : taskId;
    const prepared = await runtime.prepare(input, id);
    const task: AutomationTask = { id, request: input, ...prepared, createdAt: new Date().toISOString(),
      lastRun: { id: crypto.randomUUID(), day: "2026-10-10", startedAt: new Date().toISOString(), state: "RUNNING", message: "running" } };
    tasks.set(id, task); return task;
  };
  return { root, source, project, request, account, runtime, dependencies, create, tasks, exportId };
}
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
