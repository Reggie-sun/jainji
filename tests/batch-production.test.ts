import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { BatchProductionStartSchema, batchRequiresDisplayText } from "../src/shared/batch-production";
import { BatchProductionController, type BatchProductionSession } from "../src/main/batch-production-controller";
import { createBatchProductionRuntime } from "../src/main/batch-production-runtime";
import { createDefaultProject, type ExportTask, type Project } from "../src/main/domain";
import { ProjectWorkspaceSchema } from "../src/shared/project-workspace";
import { DEFAULT_COVER_STICKER } from "../src/shared/cover-sticker";
import { DEFAULT_EXPORT_SETTINGS } from "../src/shared/export-settings";
import type { AgentRun, AgentStartInput } from "../src/shared/agent";
import type { QueueSnapshot } from "../src/main/queue";
import { ProjectStore } from "../src/main/store";
import type { QianchuanUploadSelection, UploadAuthorization } from "../src/shared/douyin-upload";
import type { QianchuanAccountSummary } from "../src/shared/qianchuan-account";
import type { TemplateAccountBinding } from "../src/shared/batch-upload";

const entry = () => ({ recentProjectId: crypto.randomUUID(), requestedCount: 5, productPrice: "手动文字", coverEnabled: false, displayMode: "full" as const });
const directories: string[] = [];
const controllers: BatchProductionController[] = [];
vi.setConfig({ testTimeout: 15000 });
const waitFor = (check: () => void) => vi.waitFor(check, { timeout: 5000, interval: 25 });
afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.cancel()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function project(name: string, count = 1): Project {
  const value = createDefaultProject(name);
  value.mediaItems = Array.from({ length: count }, (_, index) => ({ id: crypto.randomUUID(), sourcePath: `/fixture/${name}/素材/${index}.mp4`,
    displayName: `${index}.mp4`, fingerprint: "fixture", sizeBytes: 100, durationMs: 6000, width: 720, height: 1280,
    rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() }));
  value.templates[0].productPriceDraft = "保存的文字";
  value.workspaceDraft = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: value.mediaItems.map(item => item.id),
    ruleId: "clean", brief: "保存的说明", decorations: { mode: "random" }, exportFormat: "mp4", exportSettings: DEFAULT_EXPORT_SETTINGS, requestedCount: 1 });
  return value;
}

async function fixture(options: { allComplete?: boolean; startThrows?: boolean; holding?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-batch-test-")); directories.push(root);
  const entries = [{ ...entry(), requestedCount: 1 }, { ...entry(), requestedCount: 1, displayMode: "first-5s" as const }];
  const projects = [project("蝴蝶贴"), project("氨糖膏")];
  const events: string[] = [];
  const tasks: ExportTask[] = [];
  const starts: AgentStartInput[] = [];
  const frozen: Project[] = [];
  const queue = () => ({ revision: 0, batches: projects.map(project => ({ batch: { projectId: project.id,
    tasks: tasks.filter(task => project.mediaItems.some(media => media.id === task.mediaId)) } })) } as unknown as QueueSnapshot);
  const dependencies = {
    name: (id: string) => projects[entries.findIndex(entry => entry.recentProjectId === id)].name,
    loadProject: vi.fn(async (id: string) => { events.push(`load:${id}`); return projects[entries.findIndex(entry => entry.recentProjectId === id)]; }),
    outputDirectory: vi.fn(async (value: Project) => `/output/${value.name}`),
    queue,
    taskStatuses: () => new Map(tasks.map(task => [task.id, task.status])),
    cancelExport: vi.fn(async (id: string) => { const task = tasks.find(task => task.id === id)!; if (task.status === "running") task.status = "cancelled"; }),
    changed: vi.fn(),
    uploadBinding: vi.fn(async (_recentProjectId: string, _projectId: string): Promise<TemplateAccountBinding | undefined> => undefined),
    uploadAccounts: vi.fn((_projectId: string): QianchuanAccountSummary[] => [
      { product: "蝴蝶贴", advertiserId: "123456", adId: "987654", available: true },
      { product: "氨糖膏", advertiserId: "223456", adId: "887654", available: true },
    ]),
    preflightUpload: vi.fn(async (selection: QianchuanUploadSelection, count: number): Promise<UploadAuthorization> => {
      const account = dependencies.uploadAccounts("").find(account => account.product === selection.accountProduct)!;
      return { target: { product: selection.accountProduct, cdpEndpoint: "http://127.0.0.1:9222", advertiserId: account.advertiserId,
        adId: account.adId, configDigest: "a".repeat(64) }, pageBatchId: crypto.randomUUID(), expectedCount: count };
    }),
    uploadStatus: vi.fn((_projectId: string, _taskIds: string[]) => ({ message: "fixture upload", tasks: [] })),
    cancelUploads: vi.fn(async (_projectId: string, _taskIds: string[]) => undefined),
    session: vi.fn(async (file: string, _authorization?: UploadAuthorization): Promise<BatchProductionSession> => {
      const value = await new ProjectStore(file).readSnapshot(); frozen.push(value);
      let run: AgentRun | undefined;
      let busy = false;
      return {
        get busy() { return busy; },
        snapshot: () => run,
        start: async input => {
          starts.push(input); events.push(`start:${value.name}`);
          busy = Boolean(options.holding && starts.length === 1);
          const status = options.allComplete || starts.length > 1 ? "completed" : "running";
          const items = Array.from({ length: input.requestedCount ?? input.mediaIds.length * (input.multiplier ?? 1) }, (_, index) => {
            const id = crypto.randomUUID(); tasks.push({ id, status, mediaId: input.mediaIds[index % input.mediaIds.length], progress: 0.37 } as ExportTask);
            return { id: crypto.randomUUID(), mediaId: input.mediaIds[index % input.mediaIds.length], version: Math.floor(index / input.mediaIds.length) + 1, name: value.name, taskId: id, status: "exporting" as const };
          });
          run = { id: crypto.randomUUID(), projectId: value.id, ruleId: "clean", status: busy ? "running" : "finished", items };
          if (options.startThrows && starts.length === 1) throw new Error("fixture preparation failed after enqueue");
        },
        cancel: async () => { busy = false; if (run) run.status = "cancelled"; for (const item of run?.items ?? []) await dependencies.cancelExport(item.taskId!); },
        persist: vi.fn(async () => {
          if (run) { value.latestProduction = { id: run.id, items: run.items }; await new ProjectStore(file).save(value); }
        }),
      };
    }),
  };
  const controller = new BatchProductionController(root, dependencies); controllers.push(controller);
  return { root, controller, dependencies, entries, projects, tasks, starts, frozen, events };
}

describe("cross-template batch admission", () => {
  it("freezes shared explicit bindings for differently named templates before next-batch edits", async () => {
    const f = await fixture({ allComplete: true });
    f.projects[0].name = "新眼贴模板"; f.projects[1].name = "眼贴2";
    let product: "蝴蝶贴" | "氨糖膏" = "蝴蝶贴";
    f.dependencies.uploadBinding.mockImplementation(async (recentProjectId, projectId) => ({ recentProjectId, projectId, accountProduct: product,
      advertiserId: product === "蝴蝶贴" ? "123456" : "223456" }));
    const session = f.dependencies.session.getMockImplementation()!;
    f.dependencies.session.mockImplementation(async (file, authorization) => {
      product = "氨糖膏"; // All entries must already have their original authorization.
      return session(file, authorization);
    });
    await f.controller.start({ entries: f.entries.map(entry => ({ ...entry, douyinUpload: { enabled: true, accountProduct: "蝴蝶贴" } })) });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs.every(job => job.status === "completed")).toBe(true);
    expect(f.dependencies.session.mock.calls.map(call => call[1]?.target.advertiserId)).toEqual(["123456", "123456"]);
    expect(f.starts.map(request => request.douyinUpload?.accountProduct)).toEqual(["蝴蝶贴", "蝴蝶贴"]);
  });
  it.each(["binding", "advertiser", "plan"])("rejects explicit %s drift during preflight", async change => {
    const f = await fixture({ allComplete: true });
    let binding = { recentProjectId: f.entries[0].recentProjectId, projectId: f.projects[0].id, accountProduct: "蝴蝶贴" as const, advertiserId: "123456" };
    f.dependencies.uploadBinding.mockImplementation(async () => binding);
    const preflight = f.dependencies.preflightUpload.getMockImplementation()!;
    f.dependencies.preflightUpload.mockImplementation(async (selection, count) => {
      const authorization = await preflight(selection, count);
      if (change === "binding") binding = { ...binding, advertiserId: "333456" };
      else f.dependencies.uploadAccounts.mockReturnValue([{ product: "蝴蝶贴", advertiserId: change === "advertiser" ? "333456" : "123456",
        adId: change === "plan" ? "333654" : "987654", available: true }]);
      return authorization;
    });
    await f.controller.start({ entries: [{ ...f.entries[0], douyinUpload: { enabled: true, accountProduct: "蝴蝶贴" } }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs[0].error).toContain("预检期间已变化");
    expect(f.dependencies.session).not.toHaveBeenCalled(); expect(f.dependencies.outputDirectory).not.toHaveBeenCalled();
  });
  it("checks the actual project identity and strict renderer selection before saving a binding", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-template-binding-")); directories.push(root);
    const value = project("自定义模板"), file = path.join(root, "saved.json");
    await new ProjectStore(file).save(value);
    const recentProjectId = crypto.randomUUID();
    const saveTemplateAccount = vi.fn(async (binding: TemplateAccountBinding) => binding);
    const runtime = createBatchProductionRuntime({ root, registry: { list: () => [{ id: recentProjectId, name: value.name }],
      resolve: (id: string) => { if (id !== recentProjectId) throw new Error("unknown"); return file; } },
      upload: { templateAccount: async () => undefined, saveTemplateAccount }, changed: () => undefined } as unknown as Parameters<typeof createBatchProductionRuntime>[0]);
    const selection = { recentProjectId, expectedProjectId: value.id, accountProduct: "蝴蝶贴", expectedAdvertiserId: "123456" };
    await expect(runtime.saveUploadAccount(selection)).resolves.toEqual({ recentProjectId, projectId: value.id, accountProduct: "蝴蝶贴", advertiserId: "123456" });
    expect((await runtime.listProjects())[0].projectId).toBe(value.id);
    for (const invalid of [{ ...selection, expectedProjectId: crypto.randomUUID() }, { ...selection, recentProjectId: crypto.randomUUID() },
      { ...selection, cdpEndpoint: "http://127.0.0.1:1" }, { ...selection, projectId: value.id }]) await expect(runtime.saveUploadAccount(invalid)).rejects.toThrow();
    expect(saveTemplateAccount).toHaveBeenCalledTimes(1);
  });
  it.each(["name", "target"])("rejects an account %s change during preflight before production", async change => {
    const f = await fixture({ allComplete: true });
    const preflight = f.dependencies.preflightUpload.getMockImplementation()!;
    f.dependencies.preflightUpload.mockImplementation(async (selection, count) => {
      if (change === "target") f.dependencies.uploadAccounts.mockReturnValue([{ product: "蝴蝶贴", advertiserId: "333333", adId: "444444", available: true }]);
      const authorization = await preflight(selection, count);
      if (change === "name") f.dependencies.uploadAccounts.mockReturnValue([{ product: "蝴蝶贴", productName: "其他商品", advertiserId: "123456", adId: "987654", available: true }]);
      return authorization;
    });
    await f.controller.start({ entries: [{ ...f.entries[0], douyinUpload: { enabled: true, accountProduct: "蝴蝶贴" } }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs[0].error).toContain("预检期间已变化");
    expect(f.dependencies.session).not.toHaveBeenCalled(); expect(f.dependencies.outputDirectory).not.toHaveBeenCalled();
  });

  it("binds a renamed display name to its stable account slot before production", async () => {
    const f = await fixture({ allComplete: true });
    f.projects[0].name = "晚安油";
    f.dependencies.uploadAccounts.mockReturnValue([{ product: "眼贴", productName: "晚安油", advertiserId: "123456", adId: "987654", available: true }]);
    const selection = { enabled: true as const, accountProduct: "眼贴" as const };
    await f.controller.start({ entries: [{ ...f.entries[0], douyinUpload: selection }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.starts[0].douyinUpload).toEqual(selection);
    expect(f.controller.snapshot()?.jobs[0]).toMatchObject({ name: "晚安油", accountProduct: "眼贴", status: "completed" });
  });

  it("lets separate templates with the same product name use the same matched account", async () => {
    const f = await fixture({ allComplete: true });
    f.projects[1].name = f.projects[0].name;
    const selection = { enabled: true as const, accountProduct: "蝴蝶贴" as const };
    await f.controller.start({ entries: f.entries.map(row => ({ ...row, douyinUpload: selection })) });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.starts.map(request => request.douyinUpload)).toEqual([selection, selection]);
    expect(f.controller.snapshot()?.jobs.every(job => job.status === "completed")).toBe(true);
  });

  it("projects saved per-media text switches in the same selection order used for production", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-batch-options-")); directories.push(root);
    const value = project("无文字模板", 2);
    const [first, second] = value.mediaItems;
    value.templates[0].productPriceDraft = "";
    value.workspaceDraft!.selectedMediaIds = [second.id, first.id, second.id];
    value.workspaceDraft!.decorations.displayText = { enabled: false, x: 0.5, y: 0.13 };
    value.workspaceDraft!.decorations.displayTextByMedia = { [first.id]: { enabled: true, x: 0.2, y: 0.4 } };
    const file = path.join(root, "saved.json"); await new ProjectStore(file).save(value);
    const recentProjectId = crypto.randomUUID();
    const runtime = createBatchProductionRuntime({ root, registry: { list: () => [{ id: recentProjectId, name: value.name }], resolve: () => file },
      changed: () => undefined } as unknown as Parameters<typeof createBatchProductionRuntime>[0]);
    const [option] = await runtime.listProjects();
    expect(option).toMatchObject({ sourceCount: 2, productPrice: "", displayTextRequiredByMedia: [false, true] });
    expect(batchRequiresDisplayText({ ...option, requestedCount: 1 })).toBe(false);
    expect(batchRequiresDisplayText({ ...option, requestedCount: 2 })).toBe(true);
    expect(batchRequiresDisplayText({ requestedCount: 1 })).toBe(true);
  });

  it("accepts only an explicit product selection and rejects forged upload authority", () => {
    const row = entry();
    expect(BatchProductionStartSchema.safeParse({ entries: [{ ...row, douyinUpload: { enabled: true, accountProduct: "蝴蝶贴" } }] }).success).toBe(true);
    for (const douyinUpload of [{ enabled: true }, { enabled: true, caption: "legacy" },
      { enabled: true, accountProduct: "unknown" }, { enabled: true, accountProduct: "蝴蝶贴", advertiserId: "123456" }]) {
      expect(BatchProductionStartSchema.safeParse({ entries: [{ ...row, douyinUpload }] }).success).toBe(false);
    }
  });

  it("preflights every selected account before production and keeps authorization out of saved projects", async () => {
    const f = await fixture({ allComplete: true });
    const selections = ["蝴蝶贴", "氨糖膏"].map(accountProduct => ({ enabled: true as const, accountProduct })) as QianchuanUploadSelection[];
    const start = f.dependencies.session.getMockImplementation()!;
    f.dependencies.session.mockImplementation(async (file, authorization) => {
      expect(f.dependencies.preflightUpload).toHaveBeenCalledTimes(2);
      return start(file, authorization);
    });
    const run = await f.controller.start({ entries: f.entries.map((row, index) => ({ ...row, douyinUpload: selections[index] })) });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.starts.map(request => request.douyinUpload)).toEqual(selections);
    expect(f.dependencies.preflightUpload.mock.calls.map(call => call[1])).toEqual([1, 1]);
    const authorizations = f.dependencies.session.mock.calls.map(call => call[1]);
    expect(authorizations[0]!.pageBatchId).not.toBe(authorizations[1]!.pageBatchId);
    expect(f.controller.snapshot()?.jobs.map(job => job.accountProduct)).toEqual(["蝴蝶贴", "氨糖膏"]);
    for (const job of run.jobs) {
      const saved = await readFile(path.join(f.root, run.id, `${job.id}.json`), "utf8");
      expect(saved).not.toContain("douyinUpload"); expect(saved).not.toContain("pageBatchId"); expect(saved).not.toContain("cdpEndpoint");
    }
  });

  it("rejects saved Agent cover in local random before creating a session or upload authorization", async () => {
    const f = await fixture({ allComplete: true });
    f.projects[0].coverSticker = { ...DEFAULT_COVER_STICKER, enabled: true, trackingMode: "agent" };
    await f.controller.start({ entries: [{ ...f.entries[0], mode: "random", coverEnabled: true,
      douyinUpload: { enabled: true, accountProduct: "蝴蝶贴" } }, f.entries[1]] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    const [blocked, completed] = f.controller.snapshot()!.jobs;
    expect(blocked).toMatchObject({ status: "failed", taskIds: [], error: expect.stringContaining("本地随机不会调用模型") });
    expect(completed.status).toBe("completed");
    expect(f.dependencies.preflightUpload).not.toHaveBeenCalled();
    expect(f.dependencies.session).toHaveBeenCalledTimes(1);
    expect(f.projects[0].coverSticker.trackingMode).toBe("agent");
  });

  it("leaves ordinary export-only batches without upload preflight", async () => {
    const f = await fixture({ allComplete: true });
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.dependencies.preflightUpload).not.toHaveBeenCalled();
    expect(f.starts.every(request => !request.douyinUpload)).toBe(true);
  });

  it.each(["preflight", "format"])("rejects upload %s failure before producing that item", async boundary => {
    const f = await fixture({ allComplete: true });
    if (boundary === "preflight") f.dependencies.preflightUpload.mockRejectedValueOnce(new Error("fixture missing account"));
    else f.projects[0].workspaceDraft!.exportFormat = "mov";
    await f.controller.start({ entries: [{ ...f.entries[0], douyinUpload: { enabled: true, accountProduct: "蝴蝶贴" } }, f.entries[1]] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["failed", "completed"]);
    expect(f.starts).toHaveLength(1); expect(f.starts[0].douyinUpload).toBeUndefined();
  });

  it("projects uploads using only the chosen job's project and task IDs", async () => {
    const f = await fixture({ allComplete: true });
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    const detail = await f.controller.details({ runId: run.id, jobId: run.jobs[0].id });
    expect(f.dependencies.uploadStatus).toHaveBeenCalledWith(f.projects[0].id, [f.tasks[0].id]);
    expect(detail.upload).toEqual({ message: "fixture upload", tasks: [] });
  });

  it("wires restored job details to captured read-only uploads instead of current-production status", async () => {
    const f = await fixture({ allComplete: true });
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    const saved = f.controller.snapshot()!;
    const root = path.join(f.root, "batch-production"); await mkdir(path.join(root, run.id), { recursive: true });
    await writeFile(path.join(root, "latest.json"), JSON.stringify(saved));
    for (const job of saved.jobs) await copyFile(path.join(f.root, run.id, `${job.id}.json`), path.join(root, run.id, `${job.id}.json`));
    const capturedStatus = vi.fn(() => ({ message: "此前制作的上传记录", historical: true, accounts: [], tasks: [] }));
    const status = vi.fn(() => { throw new Error("Current upload status is not a captured-job view"); });
    const runtime = createBatchProductionRuntime({ root: f.root, queue: { snapshot: f.dependencies.queue, taskStatuses: f.dependencies.taskStatuses },
      upload: { capturedStatus, status }, changed: () => {} } as unknown as Parameters<typeof createBatchProductionRuntime>[0]);
    await runtime.controller.restore();
    const detail = await runtime.controller.details({ runId: run.id, jobId: saved.jobs[0].id });
    expect(capturedStatus).toHaveBeenCalledWith(f.projects[0].id, [f.tasks[0].id]);
    expect(detail.upload).toMatchObject({ historical: true, message: "此前制作的上传记录" }); expect(status).not.toHaveBeenCalled();
  });

  it("cancels only the selected job's upload tasks while preserving the other job", async () => {
    const f = await fixture();
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.jobs[0].status).toBe("exporting"));
    await f.controller.cancelJob({ runId: run.id, jobId: run.jobs[0].id });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.dependencies.cancelUploads.mock.calls.every(([projectId, ids]) => projectId === f.projects[0].id && ids.length === 1 && ids[0] === f.tasks[0].id)).toBe(true);
    expect(f.dependencies.cancelUploads).toHaveBeenCalled();
  });

  it.each(["random", "manual", "agent"] as const)("freezes the explicitly chosen %s mode without changing saved templates", async mode => {
    const f = await fixture({ allComplete: true });
    f.projects[0].workspaceDraft!.decorations.mode = "agent";
    const saved = structuredClone(f.projects[0]);
    await f.controller.start({ entries: [{ ...f.entries[0], mode }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.starts[0].decorations?.mode).toBe(mode);
    expect(f.controller.snapshot()?.jobs[0].mode).toBe(mode);
    expect(f.projects[0]).toEqual(saved);
  });

  it("rejects unsupported modes before creating any production session", async () => {
    const f = await fixture();
    await expect(f.controller.start({ entries: [{ ...f.entries[0], mode: "fast" }] })).rejects.toThrow();
    expect(f.dependencies.session).not.toHaveBeenCalled();
  });

  it("observes the active job and waiting job without switching projects or starting sessions", async () => {
    const f = await fixture({ holding: true });
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.tasks).toHaveLength(1));
    const first = await f.controller.details({ runId: run.id, jobId: run.jobs[0].id });
    expect(first.items).toHaveLength(1);
    expect(first.tasks).toHaveLength(1);
    expect(first.tasks[0].progress).toBe(0.37);
    const waiting = await f.controller.details({ runId: run.id, jobId: run.jobs[1].id });
    expect(waiting.items).toEqual([]); expect(waiting.tasks).toEqual([]);
    expect(f.dependencies.session).toHaveBeenCalledTimes(1);
    expect(f.dependencies.loadProject).toHaveBeenCalledTimes(2);
  });

  it("limits completed and restored details to this job's own tasks, excluding project history", async () => {
    const f = await fixture({ allComplete: true });
    f.projects[0].latestProduction = { id: crypto.randomUUID(), items: [{ id: crypto.randomUUID(), mediaId: f.projects[0].mediaItems[0].id,
      name: "旧批作品", version: 1, status: "failed" }] };
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    f.tasks.push({ id: crypto.randomUUID(), mediaId: f.projects[0].mediaItems[0].id, status: "completed" } as ExportTask);
    for (const controller of [f.controller, new BatchProductionController(f.root, f.dependencies)]) {
      if (controller !== f.controller) await controller.restore();
      const detail = await controller.details({ runId: run.id, jobId: run.jobs[0].id });
      expect(detail.items.map(item => item.name)).toEqual(["蝴蝶贴"]);
      expect(detail.tasks.map(task => task.id)).toEqual([f.tasks[0].id]);
    }
    expect(f.dependencies.session).toHaveBeenCalledTimes(2);
  });

  it("rejects foreign or stale detail identifiers", async () => {
    const f = await fixture({ allComplete: true });
    const run = await f.controller.start({ entries: f.entries });
    await expect(f.controller.details({ runId: run.id, jobId: crypto.randomUUID() })).rejects.toThrow("重新选择");
    await expect(f.controller.details({ runId: crypto.randomUUID(), jobId: run.jobs[0].id })).rejects.toThrow("重新选择");
    await expect(f.controller.details({ runId: "../latest", jobId: run.jobs[0].id })).rejects.toThrow();
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    await waitFor(() => expect(f.controller.busy).toBe(false));
    await f.controller.start({ entries: f.entries });
    await expect(f.controller.details({ runId: run.id, jobId: run.jobs[0].id })).rejects.toThrow("重新选择");
  });

  it("counts and waits for exports without reading full queue snapshots", async () => {
    const f = await fixture();
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.jobs[0].status).toBe("exporting"));
    const queueReads = vi.spyOn(f.dependencies, "queue");
    expect(f.controller.snapshot()?.jobs[0]).toMatchObject({ completedCount: 0, failedCount: 0 });
    f.controller.wake();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(queueReads).not.toHaveBeenCalled();
    queueReads.mockRestore();
  });
  it("accepts blank batch drafts and still requires unique saved project references", () => {
    const row = entry();
    expect(BatchProductionStartSchema.parse({ entries: [{ ...row, productPrice: " " }] }).entries[0].productPrice).toBe("");
    expect(BatchProductionStartSchema.safeParse({ entries: [row, row] }).success).toBe(false);
    expect(BatchProductionStartSchema.parse({ entries: [row, entry()] }).entries).toHaveLength(2);
    expect(BatchProductionController).toBeDefined();
  });

  it("rejects blank text for an enabled saved template before upload preflight or production", async () => {
    const f = await fixture({ allComplete: true });
    await f.controller.start({ entries: [{ ...f.entries[0], productPrice: " ", douyinUpload: { enabled: true, accountProduct: "肥皂" } }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs[0]).toMatchObject({ status: "failed", completedCount: 0 });
    expect(f.controller.snapshot()?.jobs[0].error).toContain("请手动填写");
    expect(f.dependencies.session).not.toHaveBeenCalled(); expect(f.dependencies.preflightUpload).not.toHaveBeenCalled();
    expect(f.dependencies.outputDirectory).not.toHaveBeenCalled();
  });

  it("inherits disabled display text, exports a blank-price batch and restores its completed record", async () => {
    const f = await fixture({ allComplete: true });
    f.projects[0].workspaceDraft!.decorations.displayText = { enabled: false, x: 0.4, y: 0.2 };
    f.projects[0].templates[0].productPriceDraft = "";
    const original = structuredClone(f.projects[0]);
    await f.controller.start({ entries: [{ ...f.entries[0], productPrice: "" }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs[0]).toMatchObject({ status: "completed", completedCount: 1, productPrice: "" });
    expect(f.starts[0].decorations).toMatchObject({ displayText: { enabled: false, x: 0.4, y: 0.2 } });
    expect(f.starts[0].decorations?.productPrice).toBeUndefined();
    expect(f.projects[0]).toEqual(original);
    await f.controller.restore();
    expect(f.controller.warning).toBeUndefined();
    expect(f.controller.snapshot()?.jobs[0].status).toBe("completed");
  });

  it.each([1, 2])("uses only the first %i selected sources when checking per-media text", async requestedCount => {
    const f = await fixture({ allComplete: true });
    f.projects[0] = project("蝴蝶贴", 2);
    const [first, second] = f.projects[0].mediaItems;
    f.projects[0].workspaceDraft!.decorations.displayText = { enabled: true, x: 0.5, y: 0.13 };
    f.projects[0].workspaceDraft!.decorations.displayTextByMedia = {
      [first.id]: { enabled: false, x: 0.2, y: 0.3 }, [second.id]: { enabled: true, x: 0.6, y: 0.4 },
    };
    await f.controller.start({ entries: [{ ...f.entries[0], requestedCount, productPrice: "" }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs[0].status).toBe(requestedCount === 1 ? "completed" : "failed");
    expect(f.starts).toHaveLength(requestedCount === 1 ? 1 : 0);
  });

  it("freezes every template and waits for actual verified export completion before the next product", async () => {
    const f = await fixture(); const originals = structuredClone(f.projects);
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.jobs[0].status).toBe("exporting"));
    expect(f.starts).toHaveLength(1);
    expect(f.events.slice(0, 2)).toEqual(f.entries.map(entry => `load:${entry.recentProjectId}`));
    f.projects[1].workspaceDraft!.brief = "生产开始后的编辑";
    f.tasks[0].status = "verifying"; f.controller.wake();
    await new Promise(resolve => setTimeout(resolve, 50)); expect(f.starts).toHaveLength(1);
    f.tasks[0].status = "completed"; f.controller.wake();
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.starts).toHaveLength(2); expect(f.starts[1].brief).toBe(originals[1].workspaceDraft!.brief);
    expect(f.starts.map(input => input.decorations?.displayMode)).toEqual(["full", "first-5s"]);
    expect(f.starts.map(input => input.decorations?.productPrice)).toEqual(["手动文字", "手动文字"]);
    expect(f.projects[0]).toEqual(originals[0]);
    expect(f.frozen[0].templates[0].productPriceDraft).toBe("手动文字");
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["completed", "completed"]);
  });

  it("records a failed export and continues the next product without retry", async () => {
    const f = await fixture();
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.tasks).toHaveLength(1));
    f.tasks[0].status = "failed"; f.controller.wake();
    f.tasks[0].errorMessage = "fixture encoder unavailable";
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["failed", "completed"]);
    expect(f.starts).toHaveLength(2);
    expect(f.controller.snapshot()?.jobs[0].failedCount).toBe(1);
    expect(f.controller.snapshot()?.jobs[0].error).toBe("fixture encoder unavailable");
  });

  it("continues after unreadable templates and never mutates saved cover configuration", async () => {
    const f = await fixture({ allComplete: true });
    f.dependencies.loadProject.mockRejectedValueOnce(new Error("fixture missing project"));
    const saved = structuredClone(f.projects[1]);
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["failed", "completed"]);
    expect(f.starts).toHaveLength(1); expect(f.projects[1]).toEqual(saved);
  });

  it("stops the current export and cancels all following products", async () => {
    const f = await fixture({ holding: true });
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.starts).toHaveLength(1));
    await f.controller.cancel();
    expect(f.controller.snapshot()?.status).toBe("cancelled");
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["cancelled", "cancelled"]);
    expect(f.tasks[0].status).toBe("cancelled"); expect(f.starts).toHaveLength(1);
  });

  it.each([false, true])("cancels only the active product and continues after its tasks drain (preparing runner: %s)", async holding => {
    const f = await fixture({ holding });
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.tasks).toHaveLength(1));
    await f.controller.cancelJob({ runId: run.id, jobId: run.jobs[0].id });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.tasks.map(task => task.status)).toEqual(["cancelled", "completed"]);
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["cancelled", "completed"]);
  });

  it("skips a cancelled waiting product without cancelling the active export", async () => {
    const f = await fixture();
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.jobs[0].status).toBe("exporting"));
    await f.controller.cancelJob({ runId: run.id, jobId: run.jobs[1].id });
    expect(f.tasks[0].status).toBe("running");
    expect(f.dependencies.cancelExport).not.toHaveBeenCalled();
    f.tasks[0].status = "completed"; f.controller.wake();
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.starts).toHaveLength(1);
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["completed", "cancelled"]);
  });

  it("rejects stale or malformed cancellation references before stopping any work", async () => {
    const f = await fixture();
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.tasks).toHaveLength(1));
    for (const input of [{ runId: crypto.randomUUID(), jobId: run.jobs[0].id },
      { runId: run.id, jobId: crypto.randomUUID() }, { runId: run.id, jobId: "../job" },
      { runId: run.id, jobId: run.jobs[0].id, all: true }]) {
      await expect(f.controller.cancelJob(input)).rejects.toThrow();
    }
    expect(f.dependencies.cancelExport).not.toHaveBeenCalled();
    expect(f.tasks[0].status).toBe("running");
  });

  it.each(["outputDirectory", "session"] as const)("cancels during %s preparation before starting the runner", async boundary => {
    const f = await fixture({ allComplete: true });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = f.dependencies[boundary].getMockImplementation()!;
    if (boundary === "outputDirectory") f.dependencies.outputDirectory.mockImplementationOnce(async (...args) => {
      await gate; return (original as typeof f.dependencies.outputDirectory)(...args);
    });
    else f.dependencies.session.mockImplementationOnce(async (...args) => {
      await gate; return (original as typeof f.dependencies.session)(...args);
    });
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.dependencies[boundary]).toHaveBeenCalledTimes(1));
    const cancellation = f.controller.cancelJob({ runId: run.id, jobId: run.jobs[0].id });
    release(); await cancellation;
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.events.filter(event => event.startsWith("start:"))).toEqual(["start:氨糖膏"]);
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["cancelled", "completed"]);
  });

  it("keeps a cancellation made while a template is still being frozen", async () => {
    const f = await fixture({ allComplete: true });
    let reject!: (error: Error) => void;
    f.dependencies.loadProject.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.dependencies.loadProject).toHaveBeenCalledTimes(1));
    await f.controller.cancelJob({ runId: run.id, jobId: run.jobs[0].id });
    reject(new Error("late read failure"));
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["cancelled", "completed"]);
    expect(f.controller.snapshot()?.jobs[0].error).toBeUndefined();
    expect(f.starts).toHaveLength(1);
  });

  it("waits for cancellation to drain, preserves completed artifacts and does not cancel unrelated task IDs", async () => {
    const f = await fixture();
    const run = await f.controller.start({ entries: [{ ...f.entries[0], requestedCount: 2 }, f.entries[1]] });
    await waitFor(() => expect(f.controller.snapshot()?.jobs[0].status).toBe("exporting"));
    f.tasks[0].status = "completed";
    f.tasks[1].status = "verifying";
    const unrelated = { id: crypto.randomUUID(), status: "running" } as ExportTask;
    f.tasks.push(unrelated);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.dependencies.cancelExport.mockImplementation(async id => {
      const task = f.tasks.find(task => task.id === id)!;
      if (["running", "verifying"].includes(task.status)) { task.status = "cancelling"; await gate; task.status = "cancelled"; }
    });
    let settled = false;
    const cancellation = f.controller.cancelJob({ runId: run.id, jobId: run.jobs[0].id }).then(() => { settled = true; });
    const repeat = f.controller.cancelJob({ runId: run.id, jobId: run.jobs[0].id });
    await waitFor(() => expect(f.tasks[1].status).toBe("cancelling"));
    expect(f.starts).toHaveLength(1); expect(settled).toBe(false);
    release(); await Promise.all([cancellation, repeat]);
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.tasks[0].status).toBe("completed"); expect(unrelated.status).toBe("running");
    expect(f.controller.snapshot()?.jobs[0].completedTaskIds).toEqual([f.tasks[0].id]);
    expect(f.dependencies.cancelExport.mock.calls.flat()).not.toContain(unrelated.id);
    f.dependencies.cancelExport.mockClear();
    await f.controller.cancelJob({ runId: run.id, jobId: run.jobs[0].id });
    await f.controller.cancelJob({ runId: run.id, jobId: run.jobs[1].id });
    expect(f.dependencies.cancelExport).not.toHaveBeenCalled();
  });

  it("whole batch cancellation wins over a concurrent single-product cancellation", async () => {
    const f = await fixture({ holding: true });
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.tasks).toHaveLength(1));
    await Promise.all([f.controller.cancelJob({ runId: run.id, jobId: run.jobs[0].id }), f.controller.cancel()]);
    expect(f.controller.snapshot()?.status).toBe("cancelled");
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["cancelled", "cancelled"]);
    expect(f.starts).toHaveLength(1);
  });

  it("captures and drains partial tasks created while start is settling, cancelling the session only once", async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = f.dependencies.session.getMockImplementation()!;
    const cancelling = vi.fn();
    const starting = vi.fn();
    f.dependencies.session.mockImplementationOnce(async file => {
      const session = await original(file);
      const start = session.start, cancel = session.cancel;
      session.start = async input => { starting(); await gate; await start(input); };
      session.cancel = async () => { cancelling(); await gate; await cancel(); };
      return session;
    });
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(starting).toHaveBeenCalledTimes(1));
    const cancelled = f.controller.cancelJob({ runId: run.id, jobId: run.jobs[0].id });
    await waitFor(() => expect(cancelling).toHaveBeenCalledTimes(1));
    release(); await cancelled;
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(cancelling).toHaveBeenCalledTimes(1);
    expect(f.tasks.map(task => task.status)).toEqual(["cancelled", "completed"]);
    expect(f.controller.snapshot()?.jobs[0].taskIds).toEqual([f.tasks[0].id]);
  });

  it("drains a partial enqueue when preparation fails before continuing", async () => {
    const f = await fixture({ startThrows: true });
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.tasks[0].status).toBe("cancelled");
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["failed", "completed"]);
    expect(f.controller.snapshot()?.jobs[0].error).toContain("after enqueue");
  });

  it("uses exact per-project quantity and rejects assisted cover without bypassing approval", async () => {
    const f = await fixture({ allComplete: true });
    f.projects[0] = project("蝴蝶贴", 2);
    f.projects[1].coverSticker = { ...DEFAULT_COVER_STICKER, trackingMode: "assisted" };
    await f.controller.start({ entries: [{ ...f.entries[0], requestedCount: 3 }, { ...f.entries[1], coverEnabled: true }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.starts[0].requestedCount).toBe(3);
    expect(f.starts[0].multiplier).toBeUndefined();
    expect(f.controller.snapshot()?.jobs[0].actualCount).toBe(3);
    expect(f.controller.snapshot()?.jobs[0].completedCount).toBe(3);
    expect(f.controller.snapshot()?.jobs[1].error).toContain("人工批准");
    expect(f.starts).toHaveLength(1);
  });

  it.each([100, 250, 5])("makes exactly %i outputs from 33 sources", async requestedCount => {
    const f = await fixture({ allComplete: true });
    f.projects[0] = project("蝴蝶贴", 33);
    await f.controller.start({ entries: [{ ...f.entries[0], requestedCount }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    const job = f.controller.snapshot()!.jobs[0];
    expect(job.status).toBe("completed");
    expect(job.actualCount).toBe(requestedCount);
    expect(job.completedCount).toBe(requestedCount);
    expect(f.starts[0].mediaIds).toHaveLength(Math.min(33, requestedCount));
    expect(f.tasks).toHaveLength(requestedCount);
  });

  it("rejects a second batch and active unrelated exports", async () => {
    const f = await fixture();
    await f.controller.start({ entries: f.entries });
    await expect(f.controller.start({ entries: f.entries })).rejects.toThrow("批量制作正在进行");
    await f.controller.cancel();
    f.tasks.push({ id: crypto.randomUUID(), status: "queued" } as ExportTask);
    await expect(f.controller.start({ entries: f.entries })).rejects.toThrow("当前导出");
  });

  it("marks recovered runs interrupted without starting models or exports", async () => {
    const f = await fixture();
    const run = await f.controller.start({ entries: f.entries }); await f.controller.cancel();
    run.status = "running";
    await writeFile(path.join(f.root, "latest.json"), JSON.stringify(run));
    const restore = new BatchProductionController(f.root, f.dependencies);
    const calls = f.dependencies.session.mock.calls.length;
    await restore.restore();
    expect(restore.snapshot()?.status).toBe("interrupted"); expect(restore.busy).toBe(false);
    expect(restore.snapshot()?.jobs.every(job => job.status === "interrupted")).toBe(true);
    expect(f.dependencies.session).toHaveBeenCalledTimes(calls);
    expect(JSON.parse(await readFile(path.join(f.root, "latest.json"), "utf8")).status).toBe("interrupted");
  });

  it("keeps corrupt batch state intact and blocks only the batch entry", async () => {
    const f = await fixture(); const file = path.join(f.root, "latest.json");
    await writeFile(file, "{invalid"); await f.controller.restore();
    expect(f.controller.warning).toContain("无法恢复"); expect(f.controller.busy).toBe(false);
    await expect(f.controller.start({ entries: f.entries })).rejects.toThrow("暂停批量入口");
    expect(await readFile(file, "utf8")).toBe("{invalid");
    expect(f.dependencies.session).not.toHaveBeenCalled();
  });

  it("stops the whole batch when task custody cannot be confirmed", async () => {
    const f = await fixture();
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.jobs[0].status).toBe("exporting"));
    f.tasks.splice(0); f.controller.wake();
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("interrupted"));
    expect(f.starts).toHaveLength(1);
    expect(f.controller.snapshot()?.error).toContain("无法确认");
  });

  it("does not erase source state or start production when initial persistence fails", async () => {
    const f = await fixture(); const blocked = path.join(f.root, "not-a-directory");
    await writeFile(blocked, "fixture");
    const controller = new BatchProductionController(blocked, f.dependencies);
    await expect(controller.start({ entries: f.entries })).rejects.toThrow();
    await waitFor(() => expect(controller.busy).toBe(false));
    expect(f.dependencies.session).not.toHaveBeenCalled();
    expect(await readFile(blocked, "utf8")).toBe("fixture");
  });

  it("reads saved project snapshots without rewriting, backup recovery or quarantine", async () => {
    const f = await fixture(); const file = path.join(f.root, "original.json");
    const bytes = JSON.stringify(f.projects[0]); await writeFile(file, bytes);
    expect((await new ProjectStore(file).readSnapshot()).name).toBe("蝴蝶贴");
    expect(await readFile(file, "utf8")).toBe(bytes);
    await writeFile(`${file}.bak`, bytes); await writeFile(file, "{broken");
    await expect(new ProjectStore(file).readSnapshot()).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{broken");
    expect(await readFile(`${file}.bak`, "utf8")).toBe(bytes);
  });
});

// Regression: ISSUE-003 — selecting a template opened the Qianchuan catalog.
// Report: .agent/harness/runs/20261005-qa/batch-plan-report.md
describe("batch automatic plan preparation", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] });
  }, 30000);
  afterAll(async () => { await browser?.close(); });
  async function panel(): Promise<Page> {
    const page = await browser.newPage();
    await page.route("http://127.0.0.1:3000/batch-plan-intent", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("http://127.0.0.1:3000/batch-plan-intent");
    const script = buildSync({ stdin: { contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { BatchProductionPanel } from "./src/renderer/BatchProductionPanel";
      const accounts = [{product:"眼贴", productName:"蝴蝶贴", advertiserId:"1000", adId:"2000", available:true},
        {product:"肥皂", productName:"最新眼贴", advertiserId:"1001", adId:"2001", available:true}];
      const projects = ["蝴蝶贴", "最新眼贴"].map((name, i) => ({recentProjectId: "00000000-0000-4000-8000-00000000000" + (i + 1),
        projectId: "10000000-0000-4000-8000-00000000000" + (i + 1), name, sourceCount: i ? 10 : 15, requestedCount: 1,
        productPrice: "手动文字", coverEnabled:false, displayMode:"full", mode:"random", displayTextRequiredByMedia:[false]}));
      window.catalogRequests = []; window.cancelledRequests = []; window.batchStarts = [];
      window.jianji = {batchProductionProjects: async () => projects,
        saveBatchUploadAccount: async input => ({recentProjectId:input.recentProjectId, projectId:input.expectedProjectId,
          accountProduct:input.accountProduct, advertiserId:input.expectedAdvertiserId}),
        listQianchuanPlans: input => new Promise((resolve, reject) => window.catalogRequests.push({input, resolve, reject})),
        cancelQianchuanPlans: async input => {window.cancelledRequests.push(input);
          window.catalogRequests.find(request => request.input.requestId === input.requestId)?.reject(new Error("已取消"));},
        startBatchProduction: async input => {window.batchStarts.push(input); return state;}};
      const state = {recentProjects:[], queue:{batches:[]}, capabilities:{ready:true}, douyinUpload:{config:{enabled:true}, accounts}};
      function Fixture() {
        const [visible, setVisible] = useState(true);
        return <><button onClick={() => setVisible(value => !value)}>切换页面</button>
          <BatchProductionPanel state={state} visible={visible} onState={() => {}} /></>;
      }
      createRoot(document.getElementById("root")).render(<React.StrictMode><Fixture/></React.StrictMode>);
    `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" } }).outputFiles[0]!.text;
    await page.addScriptTag({ content: script });
    await page.getByRole("checkbox", { name: "选择模板 蝴蝶贴", exact: true }).waitFor();
    return page;
  }
  const requests = (page: Page) => page.evaluate(() => (window as any).catalogRequests.length);
  const row = (page: Page) => page.locator('[aria-label="蝴蝶贴制作设置"]');
  async function choose(page: Page, advertiserId = "1000") {
    await page.evaluate(advertiserId => {
      const request = (window as any).catalogRequests.filter((request: any) => request.input.expectedAdvertiserId === advertiserId).at(-1);
      request.resolve(["9001", "9002"].map(adId => ({ advertiserId: request.input.expectedAdvertiserId, adId, name: "计划 " + adId })));
    }, advertiserId);
    await row(page).getByLabel("上传计划", { exact: true }).selectOption("9002");
  }
  it("requests prepared plans before any click and does not reread when templates are checked", async () => {
    const page = await panel();
    try {
      expect(await page.getByLabel("上传计划", { exact: true }).count()).toBe(2);
      expect(await page.getByRole("button", { name: "读取上传计划", exact: true }).count()).toBe(0);
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      for (const name of ["蝴蝶贴", "最新眼贴"]) await page.getByRole("checkbox", { name: `选择模板 ${name}`, exact: true }).check();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await requests(page)).toBe(2);
      expect(await row(page).getByRole("checkbox", { name: "蝴蝶贴开启千川上传", exact: true }).isChecked()).toBe(true);
      await choose(page);
      await page.evaluate(() => (window as any).catalogRequests[1].resolve([{advertiserId:"1001",adId:"9001",name:"计划 9001"}]));
      await page.getByRole("button", { name: "刷新模板", exact: true }).click();
      await page.getByRole("button", { name: "切换页面", exact: true }).click();
      await page.getByRole("button", { name: "切换页面", exact: true }).click();
      const checkbox = page.getByRole("checkbox", { name: "选择模板 蝴蝶贴", exact: true });
      await checkbox.uncheck(); await checkbox.check();
      expect(await page.getByLabel("上传计划", { exact: true }).count()).toBe(2);
      await page.waitForFunction(() => (window as any).catalogRequests.length === 3);
      expect(await row(page).getByLabel("上传计划", { exact: true }).inputValue()).toBe("9002");
    } finally { await page.close(); }
  });
  it("preserves explicit choices across reselection and refreshes only on request", async () => {
    const page = await panel();
    try {
      const checkbox = page.getByRole("checkbox", { name: "选择模板 蝴蝶贴", exact: true });
      const plan = row(page).getByLabel("上传计划", { exact: true });
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      expect(await page.getByRole("button", { name: "开始批量制作", exact: true }).isDisabled()).toBe(true);
      await choose(page);
      await checkbox.check();
      await page.getByRole("button", { name: "开始批量制作", exact: true }).click({ trial: true });
      await checkbox.uncheck(); await checkbox.check();
      await row(page).getByLabel("上传计划", { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('[aria-label="蝴蝶贴制作设置"] [aria-label="上传计划"]')?.value === "9002");
      expect(await row(page).getByLabel("上传计划", { exact: true }).inputValue()).toBe("9002");
      expect(await requests(page)).toBe(2);
      await page.getByRole("button", { name: "开始批量制作", exact: true }).click();
      expect(await page.evaluate(() => (window as any).batchStarts[0].entries[0].douyinUpload)).toEqual({ enabled: true, accountProduct: "眼贴", plan: { advertiserId: "1000", adId: "9002", name: "计划 9002" } });
      await row(page).getByRole("button", { name: "刷新计划", exact: true }).click();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 3);
      expect(await page.evaluate(() => (window as any).catalogRequests[2].input.refresh)).toBe(true);
      await checkbox.uncheck();
      expect(await plan.count()).toBe(1);
      expect(await page.evaluate(() => (window as any).cancelledRequests.length)).toBe(0);
      const upload = row(page).getByRole("checkbox", { name: "蝴蝶贴开启千川上传", exact: true });
      await upload.uncheck();
      await page.waitForFunction(() => (window as any).cancelledRequests.length === 1);
      await upload.check();
      await plan.waitFor();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 4);
    } finally { await page.close(); }
  });
  it("shares the new account read and clears the old choice when switching accounts", async () => {
    const page = await panel();
    try {
      const plan = row(page).getByLabel("上传计划", { exact: true });
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      await choose(page);
      await row(page).getByLabel("蝴蝶贴上传账号", { exact: true }).selectOption("肥皂");
      await plan.waitFor();
      expect(await requests(page)).toBe(2);
      expect(await plan.inputValue()).toBe("");
      expect(await page.evaluate(() => (window as any).catalogRequests[1].input.expectedAdvertiserId)).toBe("1001");
      await choose(page, "1001");
      expect(await row(page).getByLabel("上传计划", { exact: true }).inputValue()).toBe("9002");
    } finally { await page.close(); }
  });
  it("shows read failures and cancels a pending refresh when leaving the panel", async () => {
    const page = await panel();
    try {
      const plan = row(page).getByLabel("上传计划", { exact: true });
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      await page.evaluate(() => (window as any).catalogRequests[0].reject(new Error("Chrome 登录已失效")));
      await row(page).getByRole("alert").getByText("Chrome 登录已失效", { exact: true }).waitFor();
      expect(await plan.isDisabled()).toBe(true);
      await row(page).getByRole("button", { name: "刷新计划", exact: true }).click();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 3);
      await page.getByRole("button", { name: "切换页面", exact: true }).click();
      await page.waitForFunction(() => (window as any).cancelledRequests.length === 2);
      await page.getByRole("button", { name: "切换页面", exact: true }).click();
      await plan.waitFor();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 5);
      expect(await plan.isDisabled()).toBe(true);
    } finally { await page.close(); }
  });
});
