import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { afterEach, expect, it, vi } from "vitest";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { ProjectWorkspaceSchema } from "../src/shared/project-workspace";
import { ProjectStore } from "../src/main/store";
import { RecentProjects } from "../src/main/recent-projects";
import { MaterialNameSchema } from "../src/shared/material-names";
import { createBatchProductionRuntime } from "../src/main/batch-production-runtime";
import { AgentController } from "../src/main/agent-controller";

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function projectSaveFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-project-save-"));
  directories.push(directory);
  const ffmpeg = new FfmpegAdapter("unused", "unused");
  vi.spyOn(ffmpeg, "probe").mockResolvedValue({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360 }], format: { duration: "2" } });
  const service = new ApplicationService(ffmpeg, { resolve: async () => null });
  const sourceFile = path.join(directory, "source.mp4");
  await writeFile(sourceFile, "video");
  const [media] = await service.addMedia([sourceFile]);
  const file = path.join(directory, "original.jianji-project.json");
  const recentProjects = new RecentProjects(path.join(directory, "recent-projects.json"));
  await recentProjects.initialize();
  const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: file }));
  const source = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
  const registration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "registerHandlers");
  if (!registration || !ts.isFunctionDeclaration(registration)) throw new Error("missing IPC registration");
  let save!: (event: unknown, input: unknown) => Promise<unknown>;
  let remove!: (event: unknown, input: unknown) => Promise<unknown>;
  const context = {
    ipcMain: { handle: (name: string, handler: typeof save) => { if (name === "project.save") save = handler; else remove = handler; } },
    service, recentProjects, dialog: { showSaveDialog }, mainWindow: {}, activeRecentProjectId: undefined,
    projectSaveSchema: z.object({ name: MaterialNameSchema.optional(), workspaceDraft: ProjectWorkspaceSchema.optional() }).strict(),
    uuidSchema: z.string().uuid(),
    assertTrustedSender() {}, assertProductionIdle() {}, coverReview: { assertIdle() {} },
    publicState: async () => ({ project: service.currentProject, recentProjects: recentProjects.list() }),
  };
  for (const name of ["project.save", "media.remove"]) {
    const statement = registration.body!.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.arguments[0]?.getText(tree) === JSON.stringify(name));
    if (!statement) throw new Error(`missing ${name} handler`);
    runInNewContext(ts.transpileModule(statement.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  }
  const workspace = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: [media.id], ruleId: "clean", brief: "",
    decorations: { displayTextByMedia: { [media.id]: { enabled: true, x: .4, y: .2 } }, displayMode: "first-5s" },
    exportFormat: "mp4", exportSettings: { resolutionMode: "720p", frameRateMode: "source", quality: "balanced" }, outputDirectoryMode: "automatic" });
  return { service, ffmpeg, file, recentProjects, showSaveDialog, save, remove, workspace };
}

it("updates the original saved project and recent entry for every ordinary save", async () => {
  const f = await projectSaveFixture();
  await f.service.saveProject(f.file, "原素材模板");
  await f.recentProjects.remember(f.file, f.service.currentProject);
  const recentId = f.recentProjects.list()[0].id, projectId = f.service.currentProject.id, templateId = f.service.activeTemplate.id;
  await f.service.loadProject(f.file);
  f.service.setProductPriceDraft("19.9元拍一发二");
  for (const name of ["原素材模板", "更新名称"]) await f.save({}, { name, workspaceDraft: f.workspace });
  expect(f.showSaveDialog).not.toHaveBeenCalled();
  expect(f.service.projectPath).toBe(f.file);
  expect(f.recentProjects.list()).toEqual([{ id: recentId, name: "更新名称", mediaCount: 1, fileName: path.basename(f.file) }]);
  const saved = JSON.parse(await readFile(f.file, "utf8"));
  expect(saved.id).toBe(projectId); expect(saved.templates[0].id).toBe(templateId);
  expect(saved.templates[0].productPriceDraft).toBe("19.9元拍一发二");
  expect(saved.workspaceDraft).toEqual(f.workspace);
  expect(f.service.hasUnsavedChanges).toBe(false);
  const reopened = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  await reopened.loadProject(f.file);
  expect(reopened.currentProject.workspaceDraft).toEqual(f.workspace);
});

it("persists a media removal through IPC without an extra save, preserving order, settings and source files", async () => {
  const f = await projectSaveFixture();
  const first = f.service.currentProject.mediaItems[0];
  const second = { ...first, id: crypto.randomUUID(), displayName: "second.mp4" };
  const third = { ...first, id: crypto.randomUUID(), displayName: "third.mp4" };
  f.service.currentProject.mediaItems.push(second, third);
  const workspace = ProjectWorkspaceSchema.parse({ ...f.workspace, selectedMediaIds: [third.id, first.id, second.id, first.id], requestedCount: 100 });
  await f.service.saveProject(f.file, "素材筛选", workspace);
  await f.recentProjects.remember(f.file, f.service.currentProject);
  const recentId = f.recentProjects.list()[0].id;
  const source = await readFile(first.sourcePath);
  await f.remove({}, first.id);
  expect(f.service.currentProject.workspaceDraft).toEqual({ ...workspace, selectedMediaIds: [third.id, second.id] });
  const saved = await new ProjectStore(f.file).readSnapshot();
  expect(saved.workspaceDraft).toEqual({ ...workspace, selectedMediaIds: [third.id, second.id] });
  expect(saved.mediaItems.map(item => item.id)).toEqual([second.id, third.id]);
  expect(f.recentProjects.list()).toMatchObject([{ id: recentId, mediaCount: 2 }]);
  expect(f.showSaveDialog).not.toHaveBeenCalled();
  expect(await readFile(first.sourcePath)).toEqual(source);
});

it("rejects a media removal IPC when its saved project cannot be persisted", async () => {
  const f = await projectSaveFixture();
  await f.service.saveProject(f.file, "素材模板", f.workspace);
  await f.recentProjects.remember(f.file, f.service.currentProject);
  const before = await readFile(f.file, "utf8"), entries = f.recentProjects.list();
  vi.spyOn(ProjectStore.prototype, "save").mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(f.remove({}, f.workspace.selectedMediaIds[0])).rejects.toThrow("disk unavailable");
  expect(await readFile(f.file, "utf8")).toBe(before);
  expect(f.recentProjects.list()).toEqual(entries);
  expect(f.service.hasUnsavedChanges).toBe(true);
});

it("allows media removal in a new unsaved project without opening a save dialog", async () => {
  const f = await projectSaveFixture();
  await f.remove({}, f.workspace.selectedMediaIds[0]);
  expect(f.service.currentProject.mediaItems).toEqual([]);
  expect(f.service.projectPath).toBeUndefined();
  expect(f.recentProjects.list()).toEqual([]);
  expect(f.showSaveDialog).not.toHaveBeenCalled();
});

it("starts a fresh batch from an IPC-updated saved template without reading removed source media", async () => {
  const f = await projectSaveFixture();
  const removed = f.service.currentProject.mediaItems[0];
  const files = ["second.mp4", "third.mp4"].map(name => path.join(path.dirname(f.file), name));
  await Promise.all(files.map(file => writeFile(file, file)));
  const [second, third] = await f.service.addMedia(files);
  expect([removed, second, third].map(item => ({ status: item.probeStatus, error: item.errorMessage }))).toEqual([
    { status: "ready", error: undefined }, { status: "ready", error: undefined }, { status: "ready", error: undefined },
  ]);
  await f.service.saveProject(f.file, "批量素材", { ...f.workspace, selectedMediaIds: [removed.id, third.id, second.id], requestedCount: 5 });
  await f.recentProjects.remember(f.file, f.service.currentProject);
  await f.remove({}, removed.id);
  vi.mocked(f.ffmpeg.probe).mockClear();
  // Stop at the canonical production entry: no model, queue submission or upload is authorized by this fixture.
  const start = vi.spyOn(AgentController.prototype, "start").mockRejectedValue(new Error("fixture admission captured"));
  const runtime = createBatchProductionRuntime({ root: path.dirname(f.file), registry: f.recentProjects, ffmpeg: f.ffmpeg,
    fontResolver: { resolve: async () => null }, queue: { snapshot: () => ({ revision: 0, batches: [] }), taskStatuses: () => new Map() },
    library: {}, stickers: {}, connections: {}, approvedDirectories: new Set([path.dirname(f.file)]), changed() {},
  } as unknown as Parameters<typeof createBatchProductionRuntime>[0]);
  const [option] = await runtime.listProjects();
  expect(option).toMatchObject({ sourceCount: 2, requestedCount: 5 });
  try {
    await runtime.controller.start({ entries: [{ recentProjectId: option.recentProjectId, requestedCount: 5,
      productPrice: "用户填写文字", coverEnabled: false, displayMode: "full", outputDirectory: path.dirname(f.file) }] });
    await vi.waitFor(() => expect(runtime.controller.busy).toBe(false));
    expect(runtime.controller.snapshot()?.jobs[0].error).toBe("fixture admission captured");
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][0]).toMatchObject({ mediaIds: [third.id, second.id], requestedCount: 5 });
    expect(vi.mocked(f.ffmpeg.probe).mock.calls.map(([file]) => file)).toEqual(files);
    expect(await readFile(removed.sourcePath, "utf8")).toBe("video");
  } finally { await runtime.controller.cancel(); }
});

it("asks for a file only on first save of a new material project and preserves cancellation", async () => {
  const f = await projectSaveFixture();
  f.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: "" });
  expect(await f.save({}, { name: "新素材模板", workspaceDraft: f.workspace })).toBeNull();
  expect(f.service.projectPath).toBeUndefined(); expect(f.recentProjects.list()).toEqual([]);
  await f.save({}, { name: "新素材模板", workspaceDraft: f.workspace });
  await f.save({}, { name: "新素材模板", workspaceDraft: f.workspace });
  expect(f.showSaveDialog).toHaveBeenCalledTimes(2);
  expect(f.recentProjects.list()).toHaveLength(1);
});

it("does not create an empty project entry or save a different project after the dialog", async () => {
  const f = await projectSaveFixture();
  f.showSaveDialog.mockImplementationOnce(async () => { f.service.newProject(); return { canceled: false, filePath: f.file }; });
  await expect(f.save({}, { workspaceDraft: f.workspace })).rejects.toThrow("项目已切换");
  expect(f.recentProjects.list()).toEqual([]); expect(f.service.projectPath).toBeUndefined();
  await expect(f.save({}, {})).rejects.toThrow("导入素材");
  expect(f.showSaveDialog).toHaveBeenCalledTimes(1);
});

it("reports a failed write without adding a recent entry or losing the original save path", async () => {
  const f = await projectSaveFixture();
  await f.service.saveProject(f.file, "原素材模板");
  await f.recentProjects.remember(f.file, f.service.currentProject);
  const before = await readFile(f.file, "utf8"), entries = f.recentProjects.list();
  f.service.setProductPriceDraft("新价格");
  vi.spyOn(ProjectStore.prototype, "save").mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(f.save({}, { workspaceDraft: f.workspace })).rejects.toThrow("disk unavailable");
  expect(f.service.projectPath).toBe(f.file); expect(f.service.hasUnsavedChanges).toBe(true);
  expect(f.recentProjects.list()).toEqual(entries); expect(await readFile(f.file, "utf8")).toBe(before);
  expect(f.showSaveDialog).not.toHaveBeenCalled();
});

it("stores a resumable workspace without duplicating the manual display text", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-workspace-"));
  directories.push(directory);
  const source = path.join(directory, "source.mp4");
  const projectFile = path.join(directory, "project.json");
  await writeFile(source, "video");
  const ffmpeg = new FfmpegAdapter("unused", "unused");
  vi.spyOn(ffmpeg, "probe").mockResolvedValue({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360 }], format: { duration: "2" } });
  const service = new ApplicationService(ffmpeg, { resolve: async () => null });
  const [media] = await service.addMedia([source]);
  service.setProductPriceDraft("19.9元2支");
  const workspace = ProjectWorkspaceSchema.parse({
    step: "templates",
    selectedMediaIds: [media.id],
    ruleId: "ocean-blue",
    brief: "突出清爽感",
    decorations: { mode: "manual", productPrice: "不应重复保存", priceStyle: "ice", sticker: "heart", fontFamily: "Noto Sans CJK SC" },
    requestedCount: 10,
    exportFormat: "mov",
    exportSettings: { resolutionMode: "1080p", frameRateMode: "30", quality: "high" },
    outputDirectoryMode: "manual",
    outputDirectory: directory,
  });

  await service.saveProject(projectFile, "做到一半的项目", workspace);
  const saved = JSON.parse(await readFile(projectFile, "utf8"));
  expect(saved.workspaceDraft).toEqual(workspace);
  expect(saved.workspaceDraft.decorations.productPrice).toBeUndefined();
  expect(saved.templates[0].productPriceDraft).toBe("19.9元2支");

  const reopened = new ApplicationService(ffmpeg, { resolve: async () => null });
  await reopened.loadProject(projectFile);
  expect(reopened.currentProject.workspaceDraft).toEqual(workspace);
  expect(reopened.view({ revision: 0, batches: [] }).project.workspaceDraft).toEqual(workspace);
});

it("persists a changed production mode without reopening the save dialog", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-mode-"));
  directories.push(directory);
  const file = path.join(directory, "project.json");
  const service = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  service.setProductPriceDraft("手动文字");
  const workspace = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: [], ruleId: "clean", brief: "",
    decorations: { mode: "agent" }, exportFormat: "mp4", exportSettings: { resolutionMode: "720p", frameRateMode: "source", quality: "balanced" }, outputDirectoryMode: "automatic" });
  await service.saveProject(file, "模式测试", workspace);
  await service.setWorkspaceDraft(service.currentProject.id, ProjectWorkspaceSchema.parse({ ...workspace, decorations: { mode: "random" } }));
  const reopened = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  await reopened.loadProject(file);
  expect(reopened.currentProject.workspaceDraft?.decorations.mode).toBe("random");
  expect(reopened.activeTemplate.productPriceDraft).toBe("手动文字");
  expect(reopened.currentProject.workspaceDraft?.decorations).not.toHaveProperty("productPrice");
  const before = structuredClone(service.currentProject.workspaceDraft);
  await expect(service.setWorkspaceDraft(crypto.randomUUID(), workspace)).rejects.toThrow("项目已切换");
  expect(service.currentProject.workspaceDraft).toEqual(before);
  vi.spyOn(ProjectStore.prototype, "save").mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(service.setWorkspaceDraft(service.currentProject.id, workspace)).rejects.toThrow("disk unavailable");
});

it("retains the frozen model-use flag after reopening a failed production", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-mode-history-"));
  directories.push(directory);
  const file = path.join(directory, "project.json");
  const service = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  await service.saveProject(file);
  await service.rememberLatestProduction({ id: crypto.randomUUID(), projectId: service.currentProject.id, ruleId: "clean", status: "finished", usesModel: false,
    items: [{ id: crypto.randomUUID(), mediaId: crypto.randomUUID(), version: 1, name: "本地失败", status: "failed", error: "fixture" }] });
  const reopened = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  await reopened.loadProject(file);
  expect(reopened.currentProject.latestProduction?.usesModel).toBe(false);
});
