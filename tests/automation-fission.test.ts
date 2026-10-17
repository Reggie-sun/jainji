import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { AutomationRuntime } from "../src/main/automation-runtime";
import { AutomationScheduler } from "../src/main/automation-scheduler";
import { AutomationRequestSchema, type AutomationRequest, type AutomationTask } from "../src/shared/automation";
import { createDefaultProject } from "../src/main/domain";
import { fingerprintFile } from "../src/main/paths";

const roots: string[] = [], schedulers: AutomationScheduler[] = [];
afterEach(async () => { await Promise.all(schedulers.splice(0).map(s => s.stop())); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture(upload = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "automation-fission-")); roots.push(root);
  const source = path.join(root, "source.mp4"); await writeFile(source, "frozen video");
  const project = createDefaultProject("裂变素材");
  const mediaId = crypto.randomUUID();
  project.mediaItems = [{ id: mediaId, sourcePath: source, displayName: "source.mp4", fingerprint: await fingerprintFile(source), sizeBytes: 12,
    durationMs: 1000, width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() }];
  const selection = { enabled: true as const, accountProduct: "眼贴" as const, plan: { advertiserId: "123", adId: "456", name: "固定计划" } };
  const request = { name: "每日裂变", time: "12:00", enabled: true, upload, confirmation: "AUTHORIZE_FIXED_AUTOMATION",
    fission: { projectId: project.id, mediaIds: [mediaId], total: 2, douyinUpload: selection } } as unknown as AutomationRequest;
  const exports = [0, 1].map(() => ({ project_id: project.id, batch_id: crypto.randomUUID(), export_task_id: crypto.randomUUID() }));
  const account = { product: "眼贴" as const, advertiserId: "123", adId: "456", cdpEndpoint: "http://127.0.0.1:9222", configDigest: "a".repeat(64) };
  const dependencies = { loadProject: vi.fn(), account: vi.fn(async () => account), modelBinding: vi.fn(() => { throw Error("no models"); }),
    approvedDirectories: new Set<string>(), controller: {} as any, queue: {} as any, task: () => undefined, produce: vi.fn(), clear: vi.fn(),
    upload: vi.fn(async (_groups: unknown, _signal: AbortSignal) => {}), finishUploadAccount: vi.fn(), releaseUploadAccounts: vi.fn(),
    fission: { loadProject: vi.fn(async () => structuredClone(project)), execute: vi.fn(async (_request: unknown, _project: unknown, _signal: AbortSignal) => exports) } };
  const runtime = new AutomationRuntime(root, dependencies);
  const create = async (input = request): Promise<AutomationTask> => {
    const id = crypto.randomUUID();
    return { id, request: input, ...await runtime.prepare(input, id), createdAt: new Date().toISOString(),
      lastRun: { id: crypto.randomUUID(), day: "2026-10-18", startedAt: new Date().toISOString(), state: "RUNNING", message: "running" } };
  };
  return { root, source, project, mediaId, request, exports, account, dependencies, runtime, create };
}

it("accepts a bounded fission schedule and refuses mixed production or missing upload targets", async () => {
  const f = await fixture();
  expect(AutomationRequestSchema.safeParse(f.request).success).toBe(true);
  const fission = (f.request as any).fission;
  for (const invalid of [
    { ...f.request, fission: { ...fission, total: 251 } },
    { ...f.request, fission: { ...fission, mediaIds: [f.mediaId, f.mediaId] } },
    { ...f.request, upload: true, fission: { ...fission, douyinUpload: undefined } },
    { ...f.request, fission: { ...fission, projectId: "wrong" } },
    { ...f.request, production: { entries: [{ recentProjectId: crypto.randomUUID(), requestedCount: 1, productPrice: "", displayMode: "full", coverEnabled: false, mode: "random" }] } },
  ]) expect(AutomationRequestSchema.safeParse(invalid).success).toBe(false);
});

it("freezes selected fission media independently of the current project and needs no model", async () => {
  const f = await fixture(), task = await f.create();
  f.project.mediaItems = []; f.project.name = "later project";
  const result = await f.runtime.execute(task, new AbortController().signal);
  expect(result.exports).toEqual(f.exports);
  expect(f.dependencies.fission.execute.mock.calls[0].slice(0, 2)).toMatchObject([{ projectId: task.request.fission!.projectId, total: 2 }, { name: "裂变素材", mediaItems: [{ id: f.mediaId }] }]);
  expect(f.dependencies.fission.execute.mock.calls[0][0]).not.toHaveProperty("douyinUpload");
  expect(f.dependencies.modelBinding).not.toHaveBeenCalled();
  expect(f.dependencies.upload).not.toHaveBeenCalled();
  expect(f.dependencies.produce).not.toHaveBeenCalled();
});

it("blocks changed frozen source files before exports or uploads", async () => {
  const f = await fixture(true), task = await f.create(); await writeFile(f.source, "changed video");
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("源素材已变化");
  expect(f.dependencies.fission.execute).not.toHaveBeenCalled(); expect(f.dependencies.upload).not.toHaveBeenCalled();
});

it("requires a native-authorized manual directory and freezes the saved account", async () => {
  const f = await fixture(true), outputDirectory = path.join(f.root, "output"); await mkdir(outputDirectory);
  const request = { ...f.request, fission: { ...f.request.fission!, outputDirectory } };
  await expect(f.create(request)).rejects.toThrow("系统对话框");
  f.dependencies.approvedDirectories.add(outputDirectory); const task = await f.create(request);
  f.account.configDigest = "b".repeat(64);
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("账号");
  expect(f.dependencies.fission.execute).not.toHaveBeenCalled();
});

it("uploads only the complete new fission result through the original uploader after persisting its claim", async () => {
  const f = await fixture(true), task = await f.create();
  f.dependencies.upload.mockImplementation(async () => {
    const claim = JSON.parse(await readFile(path.join(f.root, "upload-claims", `${task.lastRun!.id}.json`), "utf8"));
    expect(claim.streaming).toBe(true);
  });
  const result = await f.runtime.execute(task, new AbortController().signal);
  expect(result.exports).toEqual(f.exports);
  expect(f.dependencies.upload.mock.calls[0][0]).toMatchObject([{ selection: f.request.fission!.douyinUpload, target: f.account, exports: f.exports }]);
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("禁止自动重传");
  expect(f.dependencies.upload).toHaveBeenCalledTimes(1);
});

it.each(["short", "duplicate", "foreign"])("rejects %s fission results without starting upload", async reason => {
  const f = await fixture(true), task = await f.create();
  f.dependencies.fission.execute.mockResolvedValue(reason === "short" ? f.exports.slice(0, 1) : reason === "duplicate" ? [f.exports[0], f.exports[0]] : f.exports.map(e => ({ ...e, project_id: crypto.randomUUID() })));
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("裂变成片");
  expect(f.dependencies.upload).not.toHaveBeenCalled();
});

it("runs a saved fission schedule once at its daily time and preserves it across restart", async () => {
  const f = await fixture(); let now = new Date(2026, 9, 18, 11, 59);
  const deps = { prepare: (r: AutomationRequest, id: string) => f.runtime.prepare(r, id), configure: (t: AutomationTask) => f.runtime.configure(t),
    configurationIssue: (t: AutomationTask) => f.runtime.configurationIssue(t), execute: (t: AutomationTask, s: AbortSignal) => f.runtime.execute(t, s), busy: () => false, changed: () => {}, now: () => now };
  const scheduler = new AutomationScheduler(f.root, deps); schedulers.push(scheduler); await scheduler.load(); scheduler.start();
  const task = (await scheduler.create(f.request)).tasks[0]; await scheduler.tick(); expect(f.dependencies.fission.execute).not.toHaveBeenCalled();
  now = new Date(2026, 9, 18, 12); await scheduler.tick();
  expect(scheduler.task(task.id)?.lastRun?.state).toBe("COMPLETED"); expect(f.dependencies.fission.execute).toHaveBeenCalledTimes(1);
  await scheduler.stop(); const restored = new AutomationScheduler(f.root, deps); schedulers.push(restored); await restored.load(); restored.start();
  await restored.tick(); expect(f.dependencies.fission.execute).toHaveBeenCalledTimes(1);
});


it("rejects edited fission scope instead of executing an altered saved task", async () => {
  const f = await fixture(), task = await f.create(); task.request.fission!.total = 3;
  await expect(f.runtime.execute(task, new AbortController().signal)).rejects.toThrow("固定配置不一致");
  expect(f.dependencies.fission.execute).not.toHaveBeenCalled();
});

it("stops before upload when cancellation arrives with the completed exports", async () => {
  const f = await fixture(true), task = await f.create(), control = new AbortController();
  f.dependencies.fission.execute.mockImplementation(async () => { control.abort(); return f.exports; });
  await expect(f.runtime.execute(task, control.signal)).rejects.toThrow();
  expect(f.dependencies.upload).not.toHaveBeenCalled(); expect(f.dependencies.releaseUploadAccounts).toHaveBeenCalledTimes(1);
});

it("saves large fixed source selections without overflowing the human-readable directory summary", async () => {
  const f = await fixture();
  const prototype = f.project.mediaItems[0];
  const media = [];
  for (let index = 0; index < 100; index++) {
    const sourcePath = path.join(f.root, `${"long-source-name-".repeat(7)}${index}.mp4`);
    await writeFile(sourcePath, "frozen video");
    media.push({ ...prototype, id: crypto.randomUUID(), sourcePath });
  }
  f.project.mediaItems = media;
  const task = await f.create({ ...f.request, fission: { ...f.request.fission!, mediaIds: media.map(m => m.id), total: 100 } });
  expect(task.summary).toContain("100 条源素材 / 100 条成片");
  expect(task.summary).toContain(f.root);
  expect(task.summary.length).toBeLessThan(8000);
});
