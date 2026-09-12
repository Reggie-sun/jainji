import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { mkdir, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { z } from "zod";
import { ApplicationService } from "./application.js";
import { ArtifactVerifier } from "./artifact.js";
import { DEFAULT_PRESET, EditTemplateSchema, ExportPresetSchema, type ExportPreset } from "./domain.js";
import { checkCapabilities, FfmpegAdapter, resolveFont, type CapabilityStatus } from "./ffmpeg.js";
import { canonicalPath, fingerprintFile, isPathWithinDirectory } from "./paths.js";
import { ExportQueue, type QueueSnapshot } from "./queue.js";
import { JobStore } from "./store.js";
import { LayoutAgentInputSchema } from "./layout-agent.js";

const pathListSchema = z.array(z.string().min(1).refine((value) => path.isAbsolute(value), "path must be absolute")).min(1).max(1000);
const uuidSchema = z.string().uuid();
const outputDirectorySchema = z.string().startsWith("/");
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
let queue: ExportQueue;
let ffmpeg: FfmpegAdapter;
let capabilities: CapabilityStatus;
let quitting = false;
let closingPrompt = false;
const approvedOutputDirectories = new Set<string>();

protocol.registerSchemesAsPrivileged([
  { scheme: "jianji-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function currentState(): QueueSnapshot { return queue.snapshot(); }

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("untrusted IPC sender");
}

async function publicState() {
  return { ...(await service.state(currentState())), capabilities };
}

function publish(snapshot: QueueSnapshot): void {
  void service.syncQueue(snapshot).catch((error) => console.error("queue project sync failed", error));
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void publicState().then((state) => mainWindow?.webContents.send("export.subscribe", state));
}

function registerHandlers(): void {
  ipcMain.handle("app.state", async (event) => { assertTrustedSender(event); return publicState(); });
  ipcMain.handle("media.selectAndProbe", async (event) => {
    assertTrustedSender(event);
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
    assertTrustedSender(event);
    const paths = pathListSchema.parse(input);
    await service.addMedia(paths);
    return publicState();
  });
  ipcMain.handle("media.remove", async (event, input: unknown) => {
    assertTrustedSender(event);
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
  ipcMain.handle("agent.applyLayout", async (event, input: unknown) => {
    assertTrustedSender(event);
    service.applyLayoutAgent(LayoutAgentInputSchema.parse(input));
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
  ipcMain.handle("project.save", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showSaveDialog(mainWindow!, { title: "保存项目", defaultPath: `${service.currentProject.name}.jianji-project.json` });
    if (result.canceled || !result.filePath) return null;
    await service.saveProject(result.filePath);
    return publicState();
  });
  ipcMain.handle("project.new", async (event) => {
    assertTrustedSender(event);
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
  ipcMain.handle("project.load", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, { title: "打开项目", properties: ["openFile"], filters: [{ name: "简辑项目", extensions: ["json"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    await service.loadProject(result.filePaths[0]);
    await queue.hydrate(service.currentProject.exportBatches);
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
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist-electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
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
  protocol.handle("jianji-media", async (request) => {
    const id = decodeURIComponent(new URL(request.url).hostname);
    const media = service?.getMedia(id);
    if (!media || media.probeStatus !== "ready") return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(media.sourcePath).toString());
  });
  const checked = await checkCapabilities(userData);
  capabilities = checked.status;
  ffmpeg = checked.adapter ?? new FfmpegAdapter(process.env.JIANJI_FFMPEG_PATH || "ffmpeg", process.env.JIANJI_FFPROBE_PATH || "ffprobe");
  service = new ApplicationService(ffmpeg, { resolve: resolveFont });
  queue = new ExportQueue({
    jobStore: new JobStore(path.join(userData, "jobs")),
    ffmpeg,
    fontResolver: { resolve: resolveFont },
    onSnapshot: publish,
  });
  queue.setMediaLookup((id) => service.getMedia(id));
  await queue.recover();
  registerHandlers();
  await createWindow();
}

function requestQuit(): void {
  if (quitting || closingPrompt) return;
  if (!queue) { quitting = true; app.exit(0); return; }
  if (!service?.hasUnsavedChanges || !mainWindow) {
    quitting = true;
    void queue.shutdown().finally(() => app.exit(0));
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
    }
    quitting = true;
    await queue.shutdown();
    app.exit(0);
  })().catch((error) => { console.error("graceful shutdown failed", error); closingPrompt = false; });
}

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  requestQuit();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
void bootstrap().catch((error) => { console.error(error); app.quit(); });
