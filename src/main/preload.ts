import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AgentStartInput } from "../shared/agent.js";
import type { SaveConnection } from "../shared/connections.js";
import type { CCSwitchProvider } from "./cc-switch.js";
import type { DesktopState } from "../shared/desktop.js";
import type { DecorationCatalog } from "../shared/decorations.js";
import type { LibraryAssetPreview } from "../shared/asset-library.js";

const api = {
  decorationCatalog: (): Promise<DecorationCatalog> => ipcRenderer.invoke("decorations.catalog"),
  libraryAsset: (id: string): Promise<LibraryAssetPreview> => ipcRenderer.invoke("library.asset", id),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getState: (): Promise<DesktopState> => ipcRenderer.invoke("app.state"),
  saveConnection: (input: SaveConnection): Promise<DesktopState> => ipcRenderer.invoke("connection.save", input),
  selectConnection: (id: string): Promise<DesktopState> => ipcRenderer.invoke("connection.select", id),
  removeConnection: (id: string): Promise<DesktopState> => ipcRenderer.invoke("connection.remove", id),
  loginChatGPT: (): Promise<DesktopState> => ipcRenderer.invoke("connection.chatgpt.login"),
  refreshChatGPT: (): Promise<DesktopState> => ipcRenderer.invoke("connection.chatgpt.refresh"),
  cancelChatGPTLogin: (): Promise<DesktopState> => ipcRenderer.invoke("connection.chatgpt.cancel"),
  listCCSwitch: (): Promise<CCSwitchProvider[]> => ipcRenderer.invoke("connection.ccswitch.list"),
  importCCSwitch: (id: string, appType: "claude" | "codex"): Promise<DesktopState> => ipcRenderer.invoke("connection.ccswitch.import", { id, appType }),
  disconnectAgent: (): Promise<DesktopState> => ipcRenderer.invoke("agent.disconnect"),
  testAgent: (): Promise<boolean> => ipcRenderer.invoke("agent.test"),
  startAgent: (input: AgentStartInput): Promise<DesktopState> => ipcRenderer.invoke("agent.start", input),
  cancelAgent: (): Promise<DesktopState> => ipcRenderer.invoke("agent.cancel"),
  selectAndProbe: (): Promise<DesktopState> => ipcRenderer.invoke("media.selectAndProbe"),
  addAndProbe: (paths: string[]): Promise<DesktopState> => ipcRenderer.invoke("media.addAndProbe", paths),
  removeMedia: (mediaId: string): Promise<DesktopState> => ipcRenderer.invoke("media.remove", mediaId),
  saveProject: (): Promise<DesktopState | null> => ipcRenderer.invoke("project.save"),
  loadProject: (): Promise<DesktopState | null> => ipcRenderer.invoke("project.load"),
  newProject: (): Promise<DesktopState> => ipcRenderer.invoke("project.new"),
  selectOutputDirectory: (): Promise<string | null> => ipcRenderer.invoke("output.selectDirectory"),
  cancelExport: (taskId: string): Promise<DesktopState> => ipcRenderer.invoke("export.cancel", { taskId }),
  retryExport: (taskIds: string[]): Promise<DesktopState> => ipcRenderer.invoke("export.retry", { taskIds }),
  openArtifact: (taskId: string): Promise<boolean> => ipcRenderer.invoke("artifact.open", { taskId }),
  revealArtifact: (taskId: string): Promise<boolean> => ipcRenderer.invoke("artifact.reveal", { taskId }),
  onExportSnapshot: (listener: (state: DesktopState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopState) => listener(state);
    ipcRenderer.on("export.subscribe", handler);
    return () => ipcRenderer.removeListener("export.subscribe", handler);
  },
};

export type DesktopApi = typeof api;
contextBridge.exposeInMainWorld("jianji", api);
