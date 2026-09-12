import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { EditTemplate, ExportPreset } from "./domain.js";
import type { AppState } from "./application.js";
import type { LayoutAgentInput } from "./layout-agent.js";

const api = {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getState: (): Promise<AppState & { capabilities: unknown }> => ipcRenderer.invoke("app.state"),
  selectAndProbe: (): Promise<AppState & { capabilities: unknown }> => ipcRenderer.invoke("media.selectAndProbe"),
  addAndProbe: (paths: string[]): Promise<AppState & { capabilities: unknown }> => ipcRenderer.invoke("media.addAndProbe", paths),
  removeMedia: (mediaId: string): Promise<AppState & { capabilities: unknown }> => ipcRenderer.invoke("media.remove", mediaId),
  selectStickerAsset: (): Promise<{ assetPath: string; assetFingerprint: string } | null> => ipcRenderer.invoke("media.selectStickerAsset"),
  updateTemplate: (template: EditTemplate): Promise<AppState & { capabilities: unknown }> => ipcRenderer.invoke("template.update", { template }),
  applyLayoutAgent: (input: LayoutAgentInput): Promise<AppState & { capabilities: unknown }> => ipcRenderer.invoke("agent.applyLayout", input),
  saveTemplate: (): Promise<EditTemplate | null> => ipcRenderer.invoke("template.save"),
  loadTemplate: (): Promise<AppState & { capabilities: unknown } | null> => ipcRenderer.invoke("template.load"),
  saveProject: (): Promise<AppState & { capabilities: unknown } | null> => ipcRenderer.invoke("project.save"),
  loadProject: (): Promise<AppState & { capabilities: unknown } | null> => ipcRenderer.invoke("project.load"),
  newProject: (): Promise<AppState & { capabilities: unknown }> => ipcRenderer.invoke("project.new"),
  selectOutputDirectory: (): Promise<string | null> => ipcRenderer.invoke("output.selectDirectory"),
  renderProof: (mediaId: string): Promise<{ taskId: string }> => ipcRenderer.invoke("proof.render", { mediaId }),
  createExport: (input: { mediaIds: string[]; outputDirectory: string; preset: ExportPreset }): Promise<{ batchId: string; taskIds: string[] }> => ipcRenderer.invoke("export.create", input),
  cancelExport: (taskId: string): Promise<AppState & { capabilities: unknown }> => ipcRenderer.invoke("export.cancel", { taskId }),
  retryExport: (taskIds?: string[]): Promise<AppState & { capabilities: unknown }> => ipcRenderer.invoke("export.retry", { taskIds }),
  openArtifact: (taskId: string): Promise<boolean> => ipcRenderer.invoke("artifact.open", { taskId }),
  revealArtifact: (taskId: string): Promise<boolean> => ipcRenderer.invoke("artifact.reveal", { taskId }),
  onExportSnapshot: (listener: (state: AppState & { capabilities: unknown }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppState & { capabilities: unknown }) => listener(state);
    ipcRenderer.on("export.subscribe", handler);
    return () => ipcRenderer.removeListener("export.subscribe", handler);
  },
};

contextBridge.exposeInMainWorld("jianji", api);
