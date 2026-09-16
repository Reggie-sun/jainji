import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, shell } from "electron";
import { mkdir, stat, readFile } from "node:fs/promises";
import { FONT_CHOICES, isUploadedStickerId, type DecorationCatalog } from "../shared/decorations.js";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { z } from "zod";
import { ApplicationService } from "./application.js";
import { ArtifactVerifier } from "./artifact.js";
import { DEFAULT_PRESET, EditTemplateSchema, ExportPresetSchema, type ExportPreset } from "./domain.js";
import { checkCapabilities, FfmpegAdapter, refreshFontCapabilities, resolveFont, type CapabilityStatus } from "./ffmpeg.js";
import { canonicalPath, fingerprintFile, isPathWithinDirectory } from "./paths.js";
import { ExportQueue, type QueueSnapshot } from "./queue.js";
import { JobStore } from "./store.js";
import { ModelConnections } from "./model-connections.js";
import { AgentController } from "./agent-controller.js";
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
const taskSchema = z.object({ taskId: uuidSchema }).strict();
const templateUpdateSchema = z.object({ template: EditTemplateSchema }).strict();

let mainWindow: BrowserWindow | undefined;
let service: ApplicationService;
let recentProjects: RecentProjects;
let queue: ExportQueue;
let ffmpeg: FfmpegAdapter;
let capabilities: CapabilityStatus;
let agent: AgentController;
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
  { scheme: "jianji-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function currentState(): QueueSnapshot { return queue.snapshot(); }

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("untrusted IPC sender");
}

async function publicState(): Promise<DesktopState> {
  return { ...(await service.state(currentState())), capabilities, connection: agent.provider.status(), visionConnection: connections.visionProvider.status(), chatgpt: connections.chatgpt.status(), connections: connections.store.snapshot(), agentRun: agent.snapshot(), recentProjects: recentProjects.list(), recentProjectsWarning: recentProjects.warning };
}

function notifyState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void publicState().then((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("export.subscribe", state);
  }).catch(() => undefined);
}

function publish(snapshot: QueueSnapshot): void {
  void service.syncQueue(snapshot).catch((error) => console.error("queue project sync failed", error));
  notifyState();
}

function registerHandlers(): void {
  registerBugFeedbackHandlers(assertTrustedSender);
  ipcMain.handle("decorations.import", async (event) => {
    assertTrustedSender(event);
    agent.assertIdle();
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "上传贴纸", properties: ["openFile"],
      filters: [{ name: "静态贴纸图片", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    agent.assertIdle();
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
    assertTrustedSender(event); agent.assertIdle();
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
    assertTrustedSender(event); agent.assertIdle(); await connections.save(input); return publicState();
  });
  ipcMain.handle("connection.select", async (event, input: unknown) => { assertTrustedSender(event); agent.assertIdle(); await connections.select(uuidSchema.parse(input)); return publicState(); });
  ipcMain.handle("connection.model.select", async (event, input: unknown) => { assertTrustedSender(event); agent.assertIdle(); await connections.selectModel(input); return publicState(); });
  ipcMain.handle("connection.vision.select", async (event, input: unknown) => { assertTrustedSender(event); agent.assertIdle(); await connections.selectVision(input); return publicState(); });
  ipcMain.handle("connection.remove", async (event, input: unknown) => { assertTrustedSender(event); agent.assertIdle(); await connections.remove(uuidSchema.parse(input)); return publicState(); });
  ipcMain.handle("agent.disconnect", async (event) => {
    assertTrustedSender(event); agent.assertIdle(); await connections.disconnect(); return publicState();
  });
  ipcMain.handle("connection.chatgpt.login", async (event) => { assertTrustedSender(event); agent.assertIdle(); await connections.login(); return publicState(); });
  ipcMain.handle("connection.chatgpt.refresh", async (event) => { assertTrustedSender(event); agent.assertIdle(); await connections.refreshLogin(); return publicState(); });
  ipcMain.handle("connection.chatgpt.cancel", async (event) => { assertTrustedSender(event); agent.assertIdle(); await connections.cancelLogin(); return publicState(); });
  ipcMain.handle("connection.ccswitch.list", async (event) => { assertTrustedSender(event); return connections.listCCSwitch(); });
  ipcMain.handle("connection.ccswitch.import", async (event, input: unknown) => {
    assertTrustedSender(event); agent.assertIdle();
    const selected = z.object({ id: z.string().min(1).max(200), appType: z.enum(["claude", "codex"]) }).strict().parse(input);
    await connections.importCCSwitch(selected.id, selected.appType); return publicState();
  });
  ipcMain.handle("agent.test", async (event) => { assertTrustedSender(event); connections.assertIdle(); await agent.test(); return true; });
  ipcMain.handle("agent.generateBrief", async (event, input: unknown) => {
    assertTrustedSender(event); connections.assertIdle(); return agent.generateBrief(input);
  });
  ipcMain.handle("agent.start", async (event, input) => {
    assertTrustedSender(event);
    if (!capabilities.ready) throw new Error(capabilities.message ?? "本地导出引擎未就绪。");
    connections.assertIdle();
    await agent.start(input, approvedOutputDirectories); return publicState();
  });
  ipcMain.handle("agent.cancel", async (event) => { assertTrustedSender(event); await agent.cancel(); return publicState(); });
  ipcMain.handle("media.selectAndProbe", async (event) => {
    assertTrustedSender(event); agent.assertIdle();
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "导入原始素材",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "视频", extensions: ["mp4", "mov", "mkv", "webm"] }],
    });
    if (result.canceled) return publicState();
    await service.addMedia(result.filePaths);
    return publicState();
  });
  ipcMain.handle("media.addAndProbe", async (event, input: unknown) => {
    assertTrustedSender(event); agent.assertIdle();
    const paths = pathListSchema.parse(input);
    await service.addMedia(paths);
    return publicState();
  });
  ipcMain.handle("media.remove", async (event, input: unknown) => {
    assertTrustedSender(event); agent.assertIdle();
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
    assertTrustedSender(event); agent.assertIdle();
    service.renameProject(MaterialNameSchema.parse(input));
  });
  ipcMain.handle("project.coverSticker", async (event, input: unknown) => {
    assertTrustedSender(event); agent.assertIdle();
    service.setCoverSticker(input);
    return publicState();
  });
  ipcMain.handle("project.save", async (event, input: unknown) => {
    assertTrustedSender(event); agent.assertIdle();
    const name = input === undefined ? service.currentProject.name : MaterialNameSchema.parse(input);
    const fileName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
    const result = await dialog.showSaveDialog(mainWindow!, { title: "保存项目与素材集", defaultPath: service.projectPath ?? `${fileName}.jianji-project.json` });
    if (result.canceled || !result.filePath) return null;
    agent.assertIdle();
    await service.saveProject(result.filePath, name);
    await recentProjects.remember(result.filePath, service.currentProject);
    return publicState();
  });
  ipcMain.handle("project.new", async (event) => {
    assertTrustedSender(event); agent.assertIdle();
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
    service.newProject();
    return publicState();
  });
  ipcMain.handle("project.load", async (event, input: unknown) => {
    assertTrustedSender(event); agent.assertIdle();
    let filePath: string;
    if (input !== undefined) filePath = recentProjects.resolve(uuidSchema.parse(input));
    else {
      const result = await dialog.showOpenDialog(mainWindow!, { title: "打开项目", properties: ["openFile"], filters: [{ name: "简辑项目", extensions: ["json"] }] });
      if (result.canceled || !result.filePaths[0]) return null;
      filePath = result.filePaths[0];
    }
    if (service.hasUnsavedChanges && (service.currentProject.mediaItems.length || service.projectPath)) {
      const choice = await dialog.showMessageBox(mainWindow!, {
        type: "question", title: "打开素材集", message: "当前项目有尚未保存的更改。",
        detail: "请先取消并保存当前素材集，或继续打开并放弃这些更改。",
        buttons: ["继续打开", "取消"], defaultId: 1, cancelId: 1,
      });
      if (choice.response !== 0) return null;
    }
    agent.assertIdle();
    try { await service.loadProject(filePath); }
    catch (error) {
      if (input === undefined) throw error;
      throw new Error("无法打开该素材集，文件可能已移动、删除或损坏。请使用“打开其他素材集”重新选择。", { cause: error });
    }
    await queue.hydrate(service.currentProject.exportBatches);
    await recentProjects.remember(filePath, service.currentProject);
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
  ipcMain.handle("proof.render", async (event, input: unknown) => {
    assertTrustedSender(event);
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
  ipcMain.handle("export.retry", async (event, input: unknown) => { assertTrustedSender(event); await queue.retry(retrySchema.parse(input).taskIds); return publicState(); });
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
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
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
    requestQuit();
  });
  mainWindow.on("closed", () => { mainWindow = undefined; });
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  const userData = app.getPath("userData");
  await mkdir(userData, { recursive: true });
  recentProjects = new RecentProjects(path.join(userData, "recent-projects.json"));
  await recentProjects.initialize([process.cwd(), app.getPath("documents")]);
  protocol.handle("jianji-media", async (request) => {
    const id = decodeURIComponent(new URL(request.url).hostname);
    const media = service?.getMedia(id);
    if (!media || media.probeStatus !== "ready") return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(media.sourcePath).toString());
  });
  library = new AssetLibrary(path.join(userData, "asset-library"));
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
  agent = new AgentController(service, queue, ffmpeg, notifyState, stickerAssets, library, connections.provider, connections.visionProvider);
  await queue.recover();
  registerHandlers();
  await createWindow();
  void connections.restore();
}

function requestQuit(): void {
  if (quitting || closingPrompt) return;
  if (!queue) { quitting = true; app.exit(0); return; }
  if (!service?.hasUnsavedChanges || !mainWindow) {
    quitting = true;
    void agent.cancel().then(async () => { await connections.dispose(); await queue.shutdown(); }).finally(() => app.exit(0));
    return;
  }
  closingPrompt = true;
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
    await agent.cancel();
    await connections.dispose();
    await queue.shutdown();
    app.exit(0);
  })().catch((error) => { console.error("graceful shutdown failed", error); closingPrompt = false; });
}

app.on("before-quit", (event) => {
  event.preventDefault();
  if (quitting) return;
  requestQuit();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
void bootstrap().catch((error) => { console.error(error); app.quit(); });
