import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, screen, shell } from "electron";
import { mkdir, stat, readFile } from "node:fs/promises";
import { FONT_CHOICES, ProductPriceSchema, isUploadedStickerId, type DecorationCatalog } from "../shared/decorations.js";
import path from "node:path";
import { z } from "zod";
import { ApplicationService } from "./application.js";
import { mediaResponse } from "./media-response.js";
import { ArtifactVerifier } from "./artifact.js";
import { DEFAULT_PRESET, EditTemplateSchema, ExportPresetSchema, now, type ExportPreset } from "./domain.js";
import { checkCapabilities, FfmpegAdapter, refreshFontCapabilities, resolveFont, type CapabilityStatus } from "./ffmpeg.js";
import { canonicalPath, fingerprintFile, isPathWithinDirectory, pathExists, pathsEqual } from "./paths.js";
import { ExportQueue, type QueueSnapshot } from "./queue.js";
import { JobStore, ProjectStore } from "./store.js";
import { ModelConnections } from "./model-connections.js";
import { CoverReviewController } from "./cover-review-controller.js";
import { CoverReviewEvidence } from "./cover-review-evidence.js";
import { analyzeCoverCandidates } from "./cover-candidates.js";
import { prepareIndependentReviewMedia } from "./cover-review-input.js";
import { AgentStartSchema, AppendProductionSchema, FrozenAgentStartSchema } from "../shared/agent.js";
import { SelectModelSchema } from "../shared/connections.js";
import { AgentController } from "./agent-controller.js";
import { SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";
import { openSourceStickerKnowledge, type KnowledgeRecoveryFailure } from "./source-sticker-knowledge-startup.js";
import { installDevelopmentQuit } from "./development-lifecycle.js";
import { projectKnowledgeRisks } from "./source-sticker-knowledge-projection.js";
import { ensureBuiltinStickerAssets } from "./builtin-stickers.js";
import type { StickerAssets } from "./builtin-stickers.js";
import { loadBundledStickerAssets } from "./bundled-stickers.js";
import { BUNDLED_STICKERS } from "../shared/bundled-stickers.js";
import { AssetLibrary } from "./asset-library.js";
import { UploadedStickers } from "./uploaded-stickers.js";
import { LIBRARY_FONTS } from "../shared/asset-library.js";
import type { DesktopState } from "../shared/desktop.js";
import { MaterialNameSchema } from "../shared/material-names.js";
import { RecentProjects } from "./recent-projects.js";
import { registerBugFeedbackHandlers } from "./bug-feedback-ipc.js";
import { ProjectWorkspaceSchema } from "../shared/project-workspace.js";
import { createAutomaticOutputDirectory } from "./automatic-output-directory.js";

const pathListSchema = z.array(z.string().min(1).refine((value) => path.isAbsolute(value), "path must be absolute")).min(1).max(1000);
const uuidSchema = z.string().uuid();
const outputDirectorySchema = z.string().refine((value) => path.isAbsolute(value), "path must be absolute");
const exportCreateSchema = z.object({
  mediaIds: z.array(uuidSchema).min(1).max(1000),
  outputDirectory: outputDirectorySchema,
  preset: ExportPresetSchema,
}).strict();
const proofSchema = z.object({ mediaId: uuidSchema }).strict();
const retrySchema = z.object({ taskIds: z.array(uuidSchema).optional() }).strict();
const appendPrefillSchema = z.object({ batchId: uuidSchema }).strict();
const taskSchema = z.object({ taskId: uuidSchema }).strict();
const templateUpdateSchema = z.object({ template: EditTemplateSchema }).strict();
const productPriceDraftSchema = z.object({ projectId: uuidSchema, productPrice: ProductPriceSchema }).strict();
const savedProjectRenameSchema = z.object({ recentId: uuidSchema, name: MaterialNameSchema }).strict();
const projectSaveSchema = z.object({ name: MaterialNameSchema.optional(), workspaceDraft: ProjectWorkspaceSchema.optional() }).strict();
const automaticOutputSchema = z.object({ mediaIds: z.array(uuidSchema).min(1).max(1000), existingDirectory: outputDirectorySchema.optional() }).strict();

let mainWindow: BrowserWindow | undefined;
let service: ApplicationService;
let recentProjects: RecentProjects;
let activeRecentProjectId: string | undefined;
let queue: ExportQueue;
let ffmpeg: FfmpegAdapter;
let capabilities: CapabilityStatus;
let agent: AgentController;
let coverReview: CoverReviewController;
let connections: ModelConnections;
let library: AssetLibrary;
let uploadedStickers: UploadedStickers;
let stickerAssets: StickerAssets;
let stickerMutation = false;
let quitting = false;
let closingPrompt = false;
const approvedOutputDirectories = new Set<string>();

// A single owner protects saved connections and the managed OAuth callback.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show(); mainWindow?.focus();
});

protocol.registerSchemesAsPrivileged([
  { scheme: "jianji-review", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: "jianji-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: "jianji-agent-preview", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function currentState(): QueueSnapshot { return queue.snapshot(); }

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("untrusted IPC sender");
  if (quitting) throw new Error("应用正在退出，请等待下次启动。");
}

async function publicState(): Promise<DesktopState> {
  const snapshot = currentState();
  const state = await service.state(snapshot);
  const outputDirectory = state.project.workspaceDraft?.outputDirectory;
  if (outputDirectory) {
    const approved = await canonicalPath(outputDirectory).then((value) => approvedOutputDirectories.has(value)).catch(() => false);
    if (!approved) delete state.project.workspaceDraft!.outputDirectory;
  }
  const sourceKnowledgeRisks = await projectKnowledgeRisks({ ...snapshot, batches: snapshot.batches.filter(({ batch }) => batch.projectId === state.project.id) }, sourceKnowledge);
  return { ...state, sourceKnowledgeRisks, capabilities, connection: agent.provider.status(), visionConnection: connections.visionProvider.status(), reviewerConnection: connections.reviewerProvider.status(), chatgpt: connections.chatgpt.status(), connections: connections.store.snapshot(), agentRun: agent.snapshot(), recentProjects: recentProjects.list(), activeRecentProjectId, recentProjectsWarning: recentProjects.warning };
}

let notifying = false, notificationPending = false;
function notifyState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  notificationPending = true;
  if (notifying) return;
  notifying = true;
  void (async () => {
    try {
      while (notificationPending && mainWindow && !mainWindow.isDestroyed()) {
        notificationPending = false;
        try {
          const state = await publicState();
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("export.subscribe", state);
        } catch { /* Later notifications can retry; never accumulate snapshot readers. */ }
      }
    } finally { notifying = false; }
  })();
}

function publish(snapshot: QueueSnapshot): void {
  void service.syncQueue(snapshot).catch((error) => console.error("queue project sync failed", error));
  notifyState();
}

function registerHandlers(): void {
  const reviewRef = z.object({ id: uuidSchema, revision: z.number().int().nonnegative() }).strict();
  ipcMain.handle("coverReview.create", async (event, input: unknown) => { assertTrustedSender(event); await coverReview.create(z.array(uuidSchema).min(1).max(250).parse(input)); return publicState(); });
  ipcMain.handle("coverReview.edit", async (event, input: unknown) => { assertTrustedSender(event); await coverReview.edit(input); return publicState(); });
  ipcMain.handle("coverReview.analyze", async (event, input: unknown) => { assertTrustedSender(event); connections.assertIdle(); const ref = reviewRef.parse(input); await coverReview.analyze(ref.id, ref.revision); return publicState(); });
  ipcMain.handle("coverReview.review", async (event, input: unknown) => { assertTrustedSender(event); coverReview.assertIdle(); connections.assertIdle(); const ref = reviewRef.extend({ selection: SelectModelSchema, enabled: z.literal(true) }).parse(input); await coverReview.review(ref.id, ref.revision, ref.selection, connections.reviewProvider(ref.selection)); return publicState(); });
  ipcMain.handle("coverReview.prepare", async (event, input: unknown) => { assertTrustedSender(event); connections.assertIdle(); const ref = reviewRef.extend({ input: AgentStartSchema }).parse(input); await coverReview.prepare(ref.id, ref.revision, ref.input, approvedOutputDirectories); return publicState(); });
  ipcMain.handle("coverReview.approve", async (event, input: unknown) => { assertTrustedSender(event); const ref = reviewRef.extend({ input: FrozenAgentStartSchema }).parse(input); await coverReview.approve(ref.id, ref.revision, ref.input, approvedOutputDirectories); return publicState(); });
  ipcMain.handle("coverReview.viewed", async (event, input: unknown) => { assertTrustedSender(event); const ref = reviewRef.extend({ mediaId: uuidSchema, version: z.number().int().positive() }).parse(input); await coverReview.viewed(ref.id, ref.revision, ref.mediaId, ref.version); return publicState(); });
  ipcMain.handle("coverReview.cancel", async (event) => { assertTrustedSender(event); await coverReview.cancel(); return publicState(); });
  registerBugFeedbackHandlers(assertTrustedSender);
  ipcMain.handle("decorations.import", async (event) => {
    assertTrustedSender(event);
    coverReview?.assertIdle(); agent.assertIdle();
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "上传贴纸", properties: ["openFile"],
      filters: [{ name: "静态贴纸图片", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    coverReview?.assertIdle(); agent.assertIdle();
    if (stickerMutation) throw new Error("贴纸正在更新，请稍后重试。");
    stickerMutation = true;
    try {
      const imported = await uploadedStickers.importFile(result.filePaths[0]);
      Object.assign(stickerAssets, { [imported.id]: imported.asset });
      return imported.id;
    } catch { throw new Error("贴纸上传失败，请选择有效的 PNG/JPG 静态图片（10 MB 以内、宽高不超过 4096 像素），并检查磁盘空间。"); }
    finally { stickerMutation = false; }
  });
  ipcMain.handle("decorations.remove", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    const id = z.string().refine(isUploadedStickerId, "只能删除用户上传的贴纸。").parse(input);
    if (stickerMutation) throw new Error("贴纸正在更新，请稍后重试。");
    const asset = stickerAssets[id];
    if (!asset) throw new Error("上传贴纸不存在或已删除。");
    stickerMutation = true;
    // Remove eligibility synchronously before another run can take its snapshot.
    delete (stickerAssets as Record<string, unknown>)[id];
    try { await uploadedStickers.remove(id); }
    catch {
      Object.assign(stickerAssets, { [id]: asset });
      throw new Error("贴纸删除失败，请检查本地素材目录权限后重试。");
    } finally { stickerMutation = false; }
  });
  ipcMain.handle("library.asset", async (event, input: unknown) => {
    assertTrustedSender(event);
    const id = z.string().min(1).max(100).parse(input);
    const preview = await library.preview(id);
    if (LIBRARY_FONTS.some((font) => font.id === id) && !capabilities.fonts) {
      capabilities = await refreshFontCapabilities(capabilities, (family) => library.resolveFont(family));
      notifyState();
    }
    return preview;
  });
  ipcMain.handle("decorations.catalog", async (event): Promise<DecorationCatalog> => {
    assertTrustedSender(event);
    const fonts = await Promise.all(FONT_CHOICES.map(async (font) => await resolveFont(font) ? font : null));
    const entries = [
      ...([{"id":"sparkle","label":"星芒"},{"id":"arrow","label":"箭头"},{"id":"heart","label":"爱心"},{"id":"burst","label":"爆闪"}] as const).map((entry) => ({ ...entry, mimeType: "image/png", animated: false, source: "builtin" as const })),
      ...BUNDLED_STICKERS.map((entry) => ({ ...entry, source: "downloaded" as const })),
    ];
    const stickers = await Promise.all(entries.map(async ({ id, label, mimeType, animated, source }) => {
      const asset = stickerAssets[id];
      if (!asset) throw new Error(`missing bundled sticker: ${id}`);
      return { id, label, animated, source, url: `data:${mimeType};base64,${(await readFile(asset.assetPath)).toString("base64")}` };
    }));
    return { fonts: fonts.filter((font): font is NonNullable<typeof font> => font !== null), stickers: [...stickers, ...await uploadedStickers.catalog()] };
  });
  ipcMain.handle("app.state", async (event) => { assertTrustedSender(event); return publicState(); });
  ipcMain.handle("connection.save", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle(); await connections.save(input); return publicState();
  });
  ipcMain.handle("connection.select", async (event, input: unknown) => { assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle(); await connections.select(uuidSchema.parse(input)); return publicState(); });
  ipcMain.handle("connection.model.select", async (event, input: unknown) => { assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle(); await connections.selectModel(input); return publicState(); });
  ipcMain.handle("connection.vision.select", async (event, input: unknown) => { assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle(); await connections.selectVision(input); return publicState(); });
  ipcMain.handle("connection.reviewer.select", async (event, input: unknown) => { assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle(); await connections.selectReviewer(input); return publicState(); });
  ipcMain.handle("connection.remove", async (event, input: unknown) => { assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle(); await connections.remove(uuidSchema.parse(input)); return publicState(); });
  ipcMain.handle("agent.disconnect", async (event) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle(); await connections.disconnect(); return publicState();
  });
  ipcMain.handle("connection.chatgpt.login", async (event) => { assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle(); await connections.login(); return publicState(); });
  ipcMain.handle("connection.chatgpt.refresh", async (event) => { assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle(); await connections.refreshLogin(); return publicState(); });
  ipcMain.handle("connection.chatgpt.cancel", async (event) => { assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle(); await connections.cancelLogin(); return publicState(); });
  ipcMain.handle("connection.ccswitch.list", async (event) => { assertTrustedSender(event); return connections.listCCSwitch(); });
  ipcMain.handle("connection.ccswitch.import", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    const selected = z.object({ id: z.string().min(1).max(200), appType: z.enum(["claude", "codex"]) }).strict().parse(input);
    await connections.importCCSwitch(selected.id, selected.appType); return publicState();
  });
  ipcMain.handle("agent.test", async (event) => { assertTrustedSender(event); coverReview?.assertIdle(); connections.assertIdle(); await agent.test(); return true; });
  ipcMain.handle("agent.generateBrief", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); connections.assertIdle(); return agent.generateBrief(input);
  });
  ipcMain.handle("agent.start", async (event, input) => {
    assertTrustedSender(event);
    if (!capabilities.ready) throw new Error(capabilities.message ?? "本地导出引擎未就绪。");
    coverReview?.assertIdle(); connections.assertIdle();
    await agent.start(input, approvedOutputDirectories); return publicState();
  });
  ipcMain.handle("agent.cancel", async (event) => { assertTrustedSender(event); await agent.cancel(); return publicState(); });
  ipcMain.handle("media.selectAndProbe", async (event) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "导入原始素材",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "视频", extensions: ["mp4", "mov", "mkv", "webm"] }],
    });
    if (result.canceled) return publicState();
    coverReview?.assertIdle(); agent.assertIdle();
    await service.addMedia(result.filePaths);
    return publicState();
  });
  ipcMain.handle("media.addAndProbe", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    const paths = pathListSchema.parse(input);
    await service.addMedia(paths);
    return publicState();
  });
  ipcMain.handle("media.remove", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    const id = uuidSchema.parse(input);
    service.removeMedia(id);
    return publicState();
  });
  ipcMain.handle("media.selectStickerAsset", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "选择贴纸图片",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const assetPath = result.filePaths[0];
    return { assetPath, assetFingerprint: await fingerprintFile(assetPath) };
  });
  ipcMain.handle("template.update", async (event, input: unknown) => {
    assertTrustedSender(event);
    const { template } = templateUpdateSchema.parse(input);
    service.updateTemplate(template);
    return publicState();
  });
  ipcMain.handle("template.save", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showSaveDialog(mainWindow!, { title: "保存编辑模板", defaultPath: `${service.activeTemplate.name}.jianji-template.json` });
    if (result.canceled || !result.filePath) return null;
    return service.saveTemplate(result.filePath);
  });
  ipcMain.handle("template.load", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, { title: "加载编辑模板", properties: ["openFile"], filters: [{ name: "简辑模板", extensions: ["json"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    await service.loadTemplate(result.filePaths[0]);
    return publicState();
  });
  ipcMain.handle("project.rename", (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    service.renameProject(MaterialNameSchema.parse(input));
  });
  ipcMain.handle("project.productPriceDraft", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    const { projectId, productPrice } = productPriceDraftSchema.parse(input);
    if (service.currentProject.id !== projectId) throw new Error("项目已切换，展示文字未保存。");
    service.setProductPriceDraft(productPrice);
    await service.persistCurrentProject();
    return publicState();
  });
  ipcMain.handle("project.coverSticker", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    service.setCoverSticker(input);
    return publicState();
  });
  ipcMain.handle("project.save", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    const parsed = projectSaveSchema.parse(input ?? {});
    const name = parsed.name ?? service.currentProject.name;
    const fileName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
    const result = await dialog.showSaveDialog(mainWindow!, { title: "保存项目", defaultPath: service.projectPath ?? `${fileName}.jianji-project.json` });
    if (result.canceled || !result.filePath) return null;
    coverReview?.assertIdle(); agent.assertIdle();
    await service.saveProject(result.filePath, name, parsed.workspaceDraft);
    await recentProjects.remember(result.filePath, service.currentProject);
    activeRecentProjectId = await recentProjects.idForPath(result.filePath);
    return publicState();
  });
  ipcMain.handle("project.new", async (event) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    if (service.hasUnsavedChanges) {
      const choice = await dialog.showMessageBox(mainWindow!, {
        type: "question",
        title: "新建项目",
        message: "当前项目有尚未保存的更改。",
        detail: "新建项目后，当前编辑不会自动保留。",
        buttons: ["新建", "取消"],
        defaultId: 1,
        cancelId: 1,
      });
      if (choice.response !== 0) return publicState();
    }
    coverReview?.assertIdle(); agent.assertIdle();
    service.newProject();
    activeRecentProjectId = undefined;
    return publicState();
  });
  ipcMain.handle("project.load", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    let filePath: string;
    if (input !== undefined) filePath = recentProjects.resolve(uuidSchema.parse(input));
    else {
      const result = await dialog.showOpenDialog(mainWindow!, { title: "打开项目", properties: ["openFile"], filters: [{ name: "简辑项目", extensions: ["json"] }] });
      if (result.canceled || !result.filePaths[0]) return null;
      filePath = result.filePaths[0];
    }
    if (service.hasUnsavedChanges && (service.currentProject.mediaItems.length || service.projectPath)) {
      const choice = await dialog.showMessageBox(mainWindow!, {
        type: "question", title: "打开项目", message: "当前项目有尚未保存的更改。",
        detail: "请先取消并保存当前项目，或继续打开并放弃这些更改。",
        buttons: ["继续打开", "取消"], defaultId: 1, cancelId: 1,
      });
      if (choice.response !== 0) return null;
    }
    coverReview?.assertIdle(); agent.assertIdle();
    try { await service.loadProject(filePath); }
    catch (error) {
      if (input === undefined) throw error;
      throw new Error("无法打开该项目，文件可能已移动、删除或损坏。请使用“从项目文件导入”重新选择。", { cause: error });
    }
    await queue.hydrate(service.currentProject.exportBatches);
    await recentProjects.remember(filePath, service.currentProject);
    activeRecentProjectId = await recentProjects.idForPath(filePath);
    return publicState();
  });
  ipcMain.handle("project.saved.rename", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    const { recentId, name } = savedProjectRenameSchema.parse(input);
    const filePath = recentProjects.resolve(recentId);
    const active = service.projectPath ? await pathsEqual(service.projectPath, filePath) : false;
    if (active) {
      if (service.hasUnsavedChanges) throw new Error("当前项目有尚未保存的更改，请先保存后再重命名。");
      await service.saveProject(filePath, name);
      await recentProjects.remember(filePath, service.currentProject);
    } else {
      const store = new ProjectStore(filePath);
      const { project } = await store.load();
      project.name = name;
      project.updatedAt = now();
      await store.save(project);
      await recentProjects.remember(filePath, project);
    }
    return publicState();
  });
  ipcMain.handle("project.saved.remove", async (event, input: unknown) => {
    assertTrustedSender(event); coverReview?.assertIdle(); agent.assertIdle();
    const recentId = uuidSchema.parse(input);
    const entry = recentProjects.list().find((item) => item.id === recentId);
    if (!entry) throw new Error("找不到该项目，请刷新列表后重试。");
    const filePath = recentProjects.resolve(recentId);
    const active = service.projectPath ? await pathsEqual(service.projectPath, filePath) : false;
    const choice = await dialog.showMessageBox(mainWindow!, {
      type: "warning",
      title: "删除项目",
      message: `确定删除“${entry.name}”？`,
      detail: `${active && service.hasUnsavedChanges ? "当前尚未保存的更改也会丢失。" : ""}项目文件将移到系统回收站，原视频不会被删除。`,
      buttons: ["移到回收站", "取消"],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice.response !== 0) return null;
    if (await pathExists(filePath)) await shell.trashItem(filePath);
    const backupPath = `${filePath}.bak`;
    if (await pathExists(backupPath)) await shell.trashItem(backupPath).catch(() => undefined);
    await recentProjects.forget(recentId);
    if (active) { service.newProject(); activeRecentProjectId = undefined; }
    return publicState();
  });
  ipcMain.handle("output.selectDirectory", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, { title: "选择输出目录", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = await canonicalPath(result.filePaths[0]);
    approvedOutputDirectories.add(selected);
    return selected;
  });
  ipcMain.handle("output.createAutomaticDirectory", async (event, input: unknown) => {
    assertTrustedSender(event);
    const { mediaIds, existingDirectory } = automaticOutputSchema.parse(input);
    const media = mediaIds.map((id) => service.getMedia(id));
    if (media.some((item) => !item)) throw new Error("所选素材已变化，请返回素材页重新选择。");
    const created = await createAutomaticOutputDirectory(media.map((item) => item!.sourcePath), new Date(), existingDirectory);
    const selected = await canonicalPath(created);
    approvedOutputDirectories.add(selected);
    return selected;
  });
  ipcMain.handle("proof.render", async (event, input: unknown) => {
    assertTrustedSender(event);
    agent.assertIdle();
    if (!capabilities.ready) throw new Error(capabilities.message ?? "FFmpeg capability is not ready");
    const { mediaId } = proofSchema.parse(input);
    const media = service.getMedia(mediaId);
    if (!media) throw new Error("media not found");
    const proofDirectory = path.join(app.getPath("userData"), "proofs");
    await mkdir(proofDirectory, { recursive: true });
    const batch = await queue.createBatch({ projectId: service.currentProject.id, template: service.activeTemplate, mediaIds: [mediaId], mediaItems: service.currentProject.mediaItems, outputDirectory: proofDirectory, preset: DEFAULT_PRESET });
    void queue.start(batch.id);
    return { taskId: batch.tasks[0].id };
  });
  ipcMain.handle("export.create", async (event, input: unknown) => {
    assertTrustedSender(event);
    agent.assertIdle();
    if (!capabilities.ready) throw new Error(capabilities.message ?? "FFmpeg capability is not ready");
    const parsed = exportCreateSchema.parse(input);
    const preset = parsed.preset as ExportPreset;
    const outputDirectory = await canonicalPath(parsed.outputDirectory);
    if (!approvedOutputDirectories.has(outputDirectory)) throw new Error("请选择由系统对话框授权的输出目录。");
    const batch = await queue.createBatch({ projectId: service.currentProject.id, template: service.activeTemplate, mediaIds: parsed.mediaIds, mediaItems: service.currentProject.mediaItems, outputDirectory, preset });
    void queue.start(batch.id);
    return { batchId: batch.id, taskIds: batch.tasks.map((task) => task.id) };
  });
  ipcMain.handle("export.cancel", async (event, input: unknown) => { assertTrustedSender(event); await queue.cancel(taskSchema.parse(input).taskId); return publicState(); });
  ipcMain.handle("export.cancelAll", async (event) => {
    assertTrustedSender(event);
    if (agent.snapshot()?.status === "running") await agent.cancel();
    await queue.cancelAll(service.currentProject.id);
    return publicState();
  });
  ipcMain.handle("export.retry", async (event, input: unknown) => { assertTrustedSender(event); agent.assertIdle(); await queue.retry(retrySchema.parse(input).taskIds); return publicState(); });
  ipcMain.handle("export.appendPrefill", async (event, input: unknown) => {
    assertTrustedSender(event);
    const { batchId } = appendPrefillSchema.parse(input);
    const prefill = await queue.appendPrefill(batchId, service.currentProject.id);
    if (!prefill) throw new Error("找不到属于当前项目的已完成批次。");
    return prefill;
  });
  ipcMain.handle("export.append", async (event, input: unknown) => {
    assertTrustedSender(event);
    agent.assertIdle();
    if (!capabilities.ready) throw new Error(capabilities.message ?? "FFmpeg capability is not ready");
    const parsed = AppendProductionSchema.parse(input);
    const outputDirectory = await canonicalPath(parsed.outputDirectory);
    if (!approvedOutputDirectories.has(outputDirectory)) throw new Error("请选择由系统对话框授权的输出目录。");
    const stickerPool = Object.entries(stickerAssets)
      .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1]) && entry[0] !== "template" && entry[0] !== "none")
      .map(([id, asset]) => ({ id, assetPath: asset.assetPath, assetFingerprint: asset.assetFingerprint }));
    const batches = await queue.appendFromBatch({ batchId: parsed.batchId, projectId: service.currentProject.id, count: parsed.count, productPrice: parsed.productPrice, outputDirectory }, stickerPool);
    for (const batch of batches) void queue.start(batch.id);
    return { batchIds: batches.map((batch) => batch.id), outputDirectory };
  });
  ipcMain.handle("artifact.open", async (event, input: unknown) => {
    assertTrustedSender(event);
    const taskId = taskSchema.parse(input).taskId;
    const found = findCompletedTask(taskId);
    await verifyArtifact(found.path, taskId);
    const error = await shell.openPath(found.path);
    if (error) throw new Error(error);
    return true;
  });
  ipcMain.handle("artifact.reveal", async (event, input: unknown) => {
    assertTrustedSender(event);
    const taskId = taskSchema.parse(input).taskId;
    const found = findCompletedTask(taskId);
    await verifyArtifact(found.path, taskId);
    shell.showItemInFolder(found.path);
    return true;
  });
}

function findCompletedTask(taskId: string): { path: string; outputDirectory: string } {
  for (const state of currentState().batches) {
    const task = state.batch.tasks.find((item) => item.id === taskId);
    if (task?.status === "completed" && task.outputPath) {
      if (!isPathWithinDirectory(state.batch.outputDirectory, task.outputPath)) throw new Error("output artifact is outside the selected directory");
      return { path: task.outputPath, outputDirectory: state.batch.outputDirectory };
    }
  }
  throw new Error("validated output artifact not found");
}

async function verifyArtifact(filePath: string, taskId: string): Promise<void> {
  try { await stat(filePath); await new ArtifactVerifier(ffmpeg).verify(filePath, taskId); }
  catch { throw new Error("artifact_missing: output file is no longer a valid video"); }
}

async function createWindow(): Promise<void> {
  // Center on the primary display: mutter otherwise places the window on the
  // pointer's monitor, and on this dual-monitor setup a window minimized on
  // the secondary display cannot be restored except through the Shell dock.
  const primaryArea = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    x: primaryArea.x + Math.max(0, Math.round((primaryArea.width - 1440) / 2)),
    y: primaryArea.y + Math.max(0, Math.round((primaryArea.height - 920) / 2)),
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f7f8fa",
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist-electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => { event.preventDefault(); });
  const devUrl = process.env.JIANJI_DEV_SERVER_URL;
  if (devUrl) await mainWindow.loadURL(devUrl);
  else await mainWindow.loadFile(path.join(app.getAppPath(), "dist/index.html"));
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    void requestQuit();
  });
  mainWindow.on("closed", () => { mainWindow = undefined; });
}

let sourceKnowledge: SourceStickerKnowledgeStore | undefined;
function recoveryFailureDetail(reason: KnowledgeRecoveryFailure): string {
  if (reason === "future_schema") return "检测到更高版本的知识库格式。请使用相同或更新版本打开；旧知识库保持不变。";
  if (reason === "integrity") return "知识库格式或目录结构无法安全读取，旧知识库保持不变。";
  if (reason === "locked") return "恢复时知识库所有权发生变化。请关闭其他简辑实例后重试。";
  return "旧知识库保持不变。请检查磁盘空间和目录权限后重试。";
}
async function bootstrap(): Promise<void> {
  await app.whenReady();
  const userData = app.getPath("userData");
  await mkdir(userData, { recursive: true });
  // Failure disables only new automatic analysis, never frozen jobs or manual editing.
  sourceKnowledge = await openSourceStickerKnowledge(userData, {
    confirmRecovery: async () => {
      try {
        const choice = await dialog.showMessageBox({
          type: "warning",
          title: "源贴纸知识库需要恢复",
          message: "上次退出没有完整释放源贴纸知识库。",
          detail: "安全重建会保留最近一份旧知识库作为恢复副本，并新建空知识库；不会复用状态不确定的事实。已有导出、项目和手动模式不受影响，新自动制作会重新识别源贴纸。",
          buttons: ["安全重建", "暂不恢复"],
          defaultId: 0,
          cancelId: 1,
        });
        return choice.response === 0;
      } catch { return false; }
    },
    reportRecoveryFailure: async (reason) => {
      await dialog.showMessageBox({
        type: "error",
        title: "源贴纸知识库恢复失败",
        message: "未能安全重建源贴纸知识库，自动制作仍保持停止。",
        detail: recoveryFailureDetail(reason),
        buttons: ["知道了"],
      });
    },
  });
  recentProjects = new RecentProjects(path.join(userData, "recent-projects.json"));
  await recentProjects.initialize([process.cwd(), app.getPath("documents")]);
  protocol.handle("jianji-media", async (request) => {
    const id = decodeURIComponent(new URL(request.url).hostname);
    const media = service?.getMedia(id);
    if (!media || media.probeStatus !== "ready") return new Response("Not found", { status: 404 });
    return mediaResponse(media.sourcePath, request);
  });
  library = new AssetLibrary(path.join(userData, "asset-library"), fetch, undefined, undefined,
    app.isPackaged ? path.join(process.resourcesPath, "sticker-library") : path.join(app.getAppPath(), "resources", "sticker-library"));
  const fontResolver = { resolve: (family: string) => library.resolveFont(family) };
  const checked = await checkCapabilities(userData, fontResolver.resolve);
  capabilities = checked.status;
  ffmpeg = checked.adapter ?? new FfmpegAdapter(process.env.JIANJI_FFMPEG_PATH || "ffmpeg", process.env.JIANJI_FFPROBE_PATH || "ffprobe");
  service = new ApplicationService(ffmpeg, fontResolver);
  queue = new ExportQueue({
    jobStore: new JobStore(path.join(userData, "jobs")),
    ffmpeg,
    videoEncoder: capabilities.videoEncoder,
    executionLimits: capabilities.executionLimits,
    fontResolver,
    onSnapshot: publish,
  });
  queue.setMediaLookup((id) => service.getMedia(id));
  const builtins = await ensureBuiltinStickerAssets(path.join(userData, "agent-stickers"));
  const bundledDirectory = app.isPackaged
    ? path.join(process.resourcesPath, "stickers", "downloaded")
    : path.join(app.getAppPath(), "resources", "stickers", "downloaded");
  uploadedStickers = new UploadedStickers(path.join(userData, "uploaded-stickers"), (bytes) => {
    const image = nativeImage.createFromBuffer(bytes);
    const { width, height } = image.getSize();
    if (image.isEmpty() || width > 4096 || height > 4096) throw new Error("无效或过大的图片。");
    return image.toPNG();
  });
  stickerAssets = { ...builtins, ...await loadBundledStickerAssets(bundledDirectory), ...await uploadedStickers.load() };
  connections = new ModelConnections(userData, app.getAppPath(), (url) => shell.openExternal(url), notifyState);
  await connections.store.load();
  agent = new AgentController(service, queue, ffmpeg, notifyState, stickerAssets, library, connections.provider, connections.visionProvider, connections.reviewerProvider, sourceKnowledge);
  protocol.handle("jianji-agent-preview", async (request) => {
    try {
      const url = new URL(request.url);
      const itemId = url.pathname.slice(1);
      const file = await agent.previewPath(uuidSchema.parse(url.hostname), uuidSchema.parse(itemId));
      return await mediaResponse(file, request);
    } catch { return new Response("Preview unavailable", { status: 404 }); }
  });
  const reviewRoot = path.join(userData, "cover-review");
  coverReview = new CoverReviewController(service, agent, queue, {
    root: reviewRoot,
    extract: (media, draft, signal) => new CoverReviewEvidence(path.join(reviewRoot, draft.projectId), ffmpeg).extract(media, draft.id, draft.revision, signal),
    verify: (projectId, evidence) => new CoverReviewEvidence(path.join(reviewRoot, projectId), ffmpeg).verify(evidence),
    images: (projectId, evidence, signal) => new CoverReviewEvidence(path.join(reviewRoot, projectId), ffmpeg).images(evidence, signal),
    reviewMedia: (draft, signal) => prepareIndependentReviewMedia(new CoverReviewEvidence(path.join(reviewRoot, draft.projectId), ffmpeg), draft, signal),
    discardEvidence: (projectId, evidence, retained) => new CoverReviewEvidence(path.join(reviewRoot, projectId), ffmpeg).discardUnreferenced(evidence, retained),
    analyze: (media, images, signal, request) => analyzeCoverCandidates(media, images, (images, previous, signal) => agent.visionProvider.detectCovers(images, previous, signal), signal, request),
    changed: notifyState,
  });
  protocol.handle("jianji-review", async (request) => {
    try {
      const url = new URL(request.url);
      const [revision, mediaId, version] = url.pathname.slice(1).split("/");
      const file = await coverReview.previewPath(uuidSchema.parse(url.hostname), z.coerce.number().int().nonnegative().parse(revision), uuidSchema.parse(mediaId), z.coerce.number().int().positive().parse(version));
      return await mediaResponse(file, request);
    } catch { return new Response("Preview unavailable", { status: 404 }); }
  });
  registerHandlers();
  // Show the window before replaying job history; with large histories recover()
  // can take minutes and the app must not look like it failed to launch.
  const windowReady = createWindow();
  // Replay history in the background so it blocks neither the window nor a
  // graceful quit; recover() publishes a snapshot when done.
  void queue.recover().catch((error) => console.error("queue recover failed", error));
  await windowReady;
  void connections.restore();
}

// Stderr writes during shutdown can synchronously throw EPIPE/EBADF when the
// Electron parent's pipe or socket was closed earlier (orphaned dev instance,
// terminal closed mid-quit, smoke harness exited before Electron). The cleanup
// chain must keep running; non-stderr failures still surface normally.
function safeLog(...args: unknown[]): void {
  try { console.error(...args); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPIPE" && code !== "EBADF") throw error;
  }
}

async function shutdownServices(): Promise<void> {
  const shutdownStart = Date.now();
  const mark = (stage: string) => safeLog(`[shutdown] ${stage} done +${Date.now() - shutdownStart}ms`);
  try { await coverReview?.shutdown(); mark("coverReview"); }
  finally {
    try { await agent?.cancel(); mark("agent"); }
    finally {
      try { await sourceKnowledge?.close(); mark("sourceKnowledge"); }
      finally { try { await connections?.dispose(); mark("connections"); } finally { await queue?.shutdown(); mark("queue"); } }
    }
  }
}

async function requestQuit(): Promise<void> {
  if (quitting || closingPrompt) return;
  if (!queue) { quitting = true; try { await shutdownServices(); } finally { app.exit(0); } return; }
  if (!service?.hasUnsavedChanges || !mainWindow) {
    quitting = true;
    try { await shutdownServices(); } finally { app.exit(0); }
    return;
  }
  closingPrompt = true;
  // Development instances restart through make frontend (dev-stop -> SIGTERM ->
  // jianji-dev-quit). A modal prompt would block the unattended restart loop,
  // so persist to the existing project file and exit; projects never saved to
  // a file still prompt so they cannot be discarded silently. Packaged builds
  // keep the interactive prompt.
  if (process.env.JIANJI_DEV_SERVER_URL && service.projectPath) {
    try {
      const projectPath = service.projectPath;
      await service.saveProject(projectPath);
      await recentProjects.remember(projectPath, service.currentProject);
      quitting = true;
      try { await shutdownServices(); } finally { app.exit(0); }
      return;
    } catch (error) {
      safeLog("development auto-save failed; falling back to the save prompt", error);
    }
  }
  // The quit prompt is modal to the window: if the window is minimized the
  // dialog is invisible and the graceful-quit chain would deadlock.
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  void (async () => {
    const choice = await dialog.showMessageBox(mainWindow!, {
      type: "question",
      title: "保存项目更改？",
      message: "项目有尚未保存的更改。",
      detail: "导出队列状态会继续安全保存；保存项目可保留本次编辑。",
      buttons: ["保存并退出", "不保存", "取消"],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice.response === 2) { closingPrompt = false; return; }
    if (choice.response === 0) {
      let projectPath = service.projectPath;
      if (!projectPath) {
        const result = await dialog.showSaveDialog(mainWindow!, { title: "保存项目", defaultPath: `${service.currentProject.name}.jianji-project.json` });
        if (result.canceled || !result.filePath) { closingPrompt = false; return; }
        projectPath = result.filePath;
      }
      await service.saveProject(projectPath);
      await recentProjects.remember(projectPath, service.currentProject);
    }
    quitting = true;
    await shutdownServices();
    app.exit(0);
  })().catch((error) => { safeLog("graceful shutdown failed", error); closingPrompt = false; });
}

app.on("before-quit", (event) => {
  event.preventDefault();
  if (quitting) return;
  void requestQuit();
});
// A bare SIGTERM (orphaned dev instance, systemd, kill) gets the same graceful
// save/close flow as a window close, so the knowledge store lock is released.
const bootStart = Date.now();
process.on("SIGTERM", () => { safeLog(`[shutdown] sigterm received +${Date.now() - bootStart}ms after boot`); void requestQuit(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
const startup = bootstrap();
installDevelopmentQuit(process, startup, () => app.quit());
void startup.catch((error) => { console.error(error); app.quit(); });
