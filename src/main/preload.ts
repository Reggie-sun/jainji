import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AgentStartInput, GenerateBriefInput } from "../shared/agent.js";
import type { SaveConnection, SelectModel } from "../shared/connections.js";
import type { CCSwitchProvider } from "./cc-switch.js";
import type { DesktopState } from "../shared/desktop.js";
import type { DecorationCatalog } from "../shared/decorations.js";
import type { LibraryAssetPreview } from "../shared/asset-library.js";
import type { BugFeedback, FeedbackHistoryEntry, FeedbackReceipt } from "../shared/bug-feedback.js";

const api = {
  submitFeedback: (input: BugFeedback): Promise<FeedbackReceipt> => ipcRenderer.invoke("feedback.submit", input),
  feedbackHistory: (): Promise<FeedbackHistoryEntry[]> => ipcRenderer.invoke("feedback.history"),
  resumeFeedback: (feedbackId: string): Promise<FeedbackReceipt> => ipcRenderer.invoke("feedback.resume", feedbackId),
  openFeedback: (feedbackId: string): Promise<boolean> => ipcRenderer.invoke("feedback.open", feedbackId),
  openFeedbackRepository: (): Promise<boolean> => ipcRenderer.invoke("feedback.repository"),
  revealFeedbackScreenshot: (feedbackId: string): Promise<boolean> => ipcRenderer.invoke("feedback.screenshot", feedbackId),
  decorationCatalog: (): Promise<DecorationCatalog> => ipcRenderer.invoke("decorations.catalog"),
  importSticker: (): Promise<string | null> => ipcRenderer.invoke("decorations.import"),
  libraryAsset: (id: string): Promise<LibraryAssetPreview> => ipcRenderer.invoke("library.asset", id),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getState: (): Promise<DesktopState> => ipcRenderer.invoke("app.state"),
  saveConnection: (input: SaveConnection): Promise<DesktopState> => ipcRenderer.invoke("connection.save", input),
  selectConnection: (id: string): Promise<DesktopState> => ipcRenderer.invoke("connection.select", id),
  selectModel: (input: SelectModel): Promise<DesktopState> => ipcRenderer.invoke("connection.model.select", input),
  removeConnection: (id: string): Promise<DesktopState> => ipcRenderer.invoke("connection.remove", id),
  loginChatGPT: (): Promise<DesktopState> => ipcRenderer.invoke("connection.chatgpt.login"),
  refreshChatGPT: (): Promise<DesktopState> => ipcRenderer.invoke("connection.chatgpt.refresh"),
  cancelChatGPTLogin: (): Promise<DesktopState> => ipcRenderer.invoke("connection.chatgpt.cancel"),
  listCCSwitch: (): Promise<CCSwitchProvider[]> => ipcRenderer.invoke("connection.ccswitch.list"),
  importCCSwitch: (id: string, appType: "claude" | "codex"): Promise<DesktopState> => ipcRenderer.invoke("connection.ccswitch.import", { id, appType }),
  disconnectAgent: (): Promise<DesktopState> => ipcRenderer.invoke("agent.disconnect"),
  testAgent: (): Promise<boolean> => ipcRenderer.invoke("agent.test"),
  generateBrief: (input: GenerateBriefInput): Promise<string> => ipcRenderer.invoke("agent.generateBrief", input),
  startAgent: (input: AgentStartInput): Promise<DesktopState> => ipcRenderer.invoke("agent.start", input),
  cancelAgent: (): Promise<DesktopState> => ipcRenderer.invoke("agent.cancel"),
  selectAndProbe: (): Promise<DesktopState> => ipcRenderer.invoke("media.selectAndProbe"),
  addAndProbe: (paths: string[]): Promise<DesktopState> => ipcRenderer.invoke("media.addAndProbe", paths),
  removeMedia: (mediaId: string): Promise<DesktopState> => ipcRenderer.invoke("media.remove", mediaId),
  renameProject: (name: string): Promise<void> => ipcRenderer.invoke("project.rename", name),
  saveProject: (name?: string): Promise<DesktopState | null> => ipcRenderer.invoke("project.save", name),
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
