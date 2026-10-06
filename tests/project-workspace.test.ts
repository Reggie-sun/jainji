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

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function projectSaveFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-project-save-"));
  directories.push(directory);
  const ffmpeg = new FfmpegAdapter("unused", "unused");
  vi.spyOn(ffmpeg, "probe").mockResolvedValue({ streams: [{ codec_type: "video", width: 640, height: 360 }], format: { duration: "2" } });
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
  const statement = registration.body!.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.arguments[0]?.getText(tree) === '"project.save"');
  if (!statement) throw new Error("missing project.save handler");
  let save!: (event: unknown, input: unknown) => Promise<unknown>;
  runInNewContext(ts.transpileModule(statement.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    ipcMain: { handle: (_name: string, handler: typeof save) => { save = handler; } },
    service, recentProjects, dialog: { showSaveDialog }, mainWindow: {}, activeRecentProjectId: undefined,
    projectSaveSchema: z.object({ name: MaterialNameSchema.optional(), workspaceDraft: ProjectWorkspaceSchema.optional() }).strict(),
    assertTrustedSender() {}, assertProductionIdle() {}, coverReview: { assertIdle() {} },
    publicState: async () => ({ project: service.currentProject, recentProjects: recentProjects.list() }),
  });
  const workspace = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: [media.id], ruleId: "clean", brief: "",
    decorations: { displayTextByMedia: { [media.id]: { enabled: true, x: .4, y: .2 } }, displayMode: "first-5s" },
    exportFormat: "mp4", exportSettings: { resolutionMode: "720p", frameRateMode: "source", quality: "balanced" }, outputDirectoryMode: "automatic" });
  return { service, file, recentProjects, showSaveDialog, save, workspace };
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
