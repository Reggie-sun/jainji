import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AgentStartInput, AppendProductionInput, AppendProductionPrefill, GenerateBriefInput } from "../shared/agent.js";
import type { SaveConnection, SelectModel } from "../shared/connections.js";
import type { CCSwitchProvider } from "./cc-switch.js";
import type { DesktopState } from "../shared/desktop.js";
import type { DecorationCatalog } from "../shared/decorations.js";
import type { CoverSticker } from "../shared/cover-sticker.js";
import type { LibraryAssetPreview } from "../shared/asset-library.js";
import type { BugFeedback, FeedbackHistoryEntry, FeedbackReceipt } from "../shared/bug-feedback.js";
import type { CoverReviewCommand } from "./cover-review-session.js";
import type { ProjectWorkspace } from "../shared/project-workspace.js";
import type { DouyinUploadStatus, UploadSuccess } from "../shared/douyin-upload.js";
import type { QianchuanAccountSetup, QianchuanBrowserControl } from "../shared/qianchuan-account.js";
import type { QianchuanPlanListRequest, QianchuanPlanCancel, QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";
import type { QianchuanLibraryClear, QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";
import type { QianchuanLibraryScheduleSettings, QianchuanLibraryScheduleStatus } from "../shared/qianchuan-video-library-schedule.js";
import type { BatchProductionStart, BatchProjectOption, BatchProductionDetail, BatchProductionDetailRequest } from "../shared/batch-production.js";
import type { TemplateAccountBinding, TemplateAccountSelection } from "../shared/batch-upload.js";

const api = {
  batchProductionProjects: (): Promise<BatchProjectOption[]> => ipcRenderer.invoke("batchProduction.projects"),
  saveBatchUploadAccount: (input: TemplateAccountSelection): Promise<TemplateAccountBinding> => ipcRenderer.invoke("batchProduction.saveUploadAccount", input),
  batchProductionDetails: (input: BatchProductionDetailRequest): Promise<BatchProductionDetail> => ipcRenderer.invoke("batchProduction.details", input),
  startBatchProduction: (input: BatchProductionStart): Promise<DesktopState> => ipcRenderer.invoke("batchProduction.start", input),
  cancelBatchProduction: (): Promise<DesktopState> => ipcRenderer.invoke("batchProduction.cancel"),
  cancelBatchProductionJob: (input: BatchProductionDetailRequest): Promise<DesktopState> => ipcRenderer.invoke("batchProduction.cancelJob", input),
  createCoverReview: (mediaIds: string[]): Promise<DesktopState> => ipcRenderer.invoke("coverReview.create", mediaIds),
  editCoverReview: (command: CoverReviewCommand): Promise<DesktopState> => ipcRenderer.invoke("coverReview.edit", command),
  analyzeCoverReview: (id: string, revision: number): Promise<DesktopState> => ipcRenderer.invoke("coverReview.analyze", { id, revision }),
  reviewCoverReview: (id: string, revision: number, selection: import("../shared/connections.js").SelectModel): Promise<DesktopState> => ipcRenderer.invoke("coverReview.review", { id, revision, selection, enabled: true }),
  prepareCoverReview: (id: string, revision: number, input: AgentStartInput): Promise<DesktopState> => ipcRenderer.invoke("coverReview.prepare", { id, revision, input }),
  approveCoverReview: (id: string, revision: number, input: AgentStartInput): Promise<DesktopState> => ipcRenderer.invoke("coverReview.approve", { id, revision, input }),
  viewCoverReview: (id: string, revision: number, mediaId: string, version: number): Promise<DesktopState> => ipcRenderer.invoke("coverReview.viewed", { id, revision, mediaId, version }),
  cancelCoverReview: (): Promise<DesktopState> => ipcRenderer.invoke("coverReview.cancel"),
  submitFeedback: (input: BugFeedback): Promise<FeedbackReceipt> => ipcRenderer.invoke("feedback.submit", input),
  feedbackHistory: (): Promise<FeedbackHistoryEntry[]> => ipcRenderer.invoke("feedback.history"),
  resumeFeedback: (feedbackId: string): Promise<FeedbackReceipt> => ipcRenderer.invoke("feedback.resume", feedbackId),
  openFeedback: (feedbackId: string): Promise<boolean> => ipcRenderer.invoke("feedback.open", feedbackId),
  openFeedbackRepository: (): Promise<boolean> => ipcRenderer.invoke("feedback.repository"),
  revealFeedbackScreenshot: (feedbackId: string): Promise<boolean> => ipcRenderer.invoke("feedback.screenshot", feedbackId),
  decorationCatalog: (): Promise<DecorationCatalog> => ipcRenderer.invoke("decorations.catalog"),
  importSticker: (): Promise<string | null> => ipcRenderer.invoke("decorations.import"),
  importFrame: (): Promise<string | null> => ipcRenderer.invoke("frames.import"),
  removeFrame: (id: string): Promise<void> => ipcRenderer.invoke("frames.remove", id),
  removeSticker: (id: string): Promise<void> => ipcRenderer.invoke("decorations.remove", id),
  libraryAsset: (id: string): Promise<LibraryAssetPreview> => ipcRenderer.invoke("library.asset", id),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getState: (): Promise<DesktopState> => ipcRenderer.invoke("app.state"),
  saveConnection: (input: SaveConnection): Promise<DesktopState> => ipcRenderer.invoke("connection.save", input),
  selectConnection: (id: string): Promise<DesktopState> => ipcRenderer.invoke("connection.select", id),
  selectModel: (input: SelectModel): Promise<DesktopState> => ipcRenderer.invoke("connection.model.select", input),
  selectVisionConnection: (input: SelectModel | null): Promise<DesktopState> => ipcRenderer.invoke("connection.vision.select", input),
  selectReviewerConnection: (input: SelectModel | null): Promise<DesktopState> => ipcRenderer.invoke("connection.reviewer.select", input),
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
  setProductPriceDraft: (projectId: string, productPrice: string): Promise<DesktopState> => ipcRenderer.invoke("project.productPriceDraft", { projectId, productPrice }),
  setWorkspaceDraft: (projectId: string, workspaceDraft: ProjectWorkspace): Promise<DesktopState> => ipcRenderer.invoke("project.workspaceDraft", { projectId, workspaceDraft }),
  setCoverSticker: (input: CoverSticker): Promise<DesktopState> => ipcRenderer.invoke("project.coverSticker", input),
  saveProject: (name?: string, workspaceDraft?: ProjectWorkspace): Promise<DesktopState | null> => ipcRenderer.invoke("project.save", { name, workspaceDraft }),
  loadProject: (recentId?: string): Promise<DesktopState | null> => ipcRenderer.invoke("project.load", recentId),
  renameSavedProject: (recentId: string, name: string): Promise<DesktopState> => ipcRenderer.invoke("project.saved.rename", { recentId, name }),
  removeSavedProject: (recentId: string): Promise<DesktopState | null> => ipcRenderer.invoke("project.saved.remove", recentId),
  newProject: (): Promise<DesktopState> => ipcRenderer.invoke("project.new"),
  selectOutputDirectory: (): Promise<string | null> => ipcRenderer.invoke("output.selectDirectory"),
  createAutomaticOutputDirectory: (mediaIds: string[], existingDirectory?: string): Promise<string> => ipcRenderer.invoke("output.createAutomaticDirectory", { mediaIds, ...(existingDirectory ? { existingDirectory } : {}) }),
  cancelExport: (taskId: string): Promise<DesktopState> => ipcRenderer.invoke("export.cancel", { taskId }),
  cancelAllExports: (): Promise<DesktopState> => ipcRenderer.invoke("export.cancelAll"),
  retryExport: (taskIds: string[]): Promise<DesktopState> => ipcRenderer.invoke("export.retry", { taskIds }),
  appendProductionPrefill: (batchId: string): Promise<AppendProductionPrefill> => ipcRenderer.invoke("export.appendPrefill", { batchId }),
  appendProduction: (input: AppendProductionInput): Promise<{ batchIds: string[]; outputDirectory: string }> => ipcRenderer.invoke("export.append", input),
  saveDouyinUploadConfig: (input: DouyinUploadStatus["config"]): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.configure", input),
  selectQianchuanAccountConfig: (): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.selectConfig"),
  saveQianchuanAccount: (input: QianchuanAccountSetup): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.saveAccount", input),
  listQianchuanPlans: (input: QianchuanPlanListRequest): Promise<QianchuanPlanOption[]> => ipcRenderer.invoke("douyinUpload.listPlans", input),
  cancelQianchuanPlans: (input: QianchuanPlanCancel): Promise<void> => ipcRenderer.invoke("douyinUpload.cancelPlans", input),
  openQianchuanAccountBrowser: (input: QianchuanAccountSetup): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.openAccountBrowser", input),
  controlQianchuanAccountBrowser: (input: QianchuanBrowserControl): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.controlAccountBrowser", input),
  clearQianchuanVideoLibraries: (input: QianchuanLibraryClear): Promise<QianchuanLibraryResult[]> => ipcRenderer.invoke("douyinUpload.clearVideoLibraries", input),
  getQianchuanVideoLibrarySchedule: (): Promise<QianchuanLibraryScheduleStatus> => ipcRenderer.invoke("videoLibrarySchedule.get"),
  saveQianchuanVideoLibrarySchedule: (input: QianchuanLibraryScheduleSettings): Promise<QianchuanLibraryScheduleStatus> => ipcRenderer.invoke("videoLibrarySchedule.save", input),
  onQianchuanVideoLibrarySchedule: (listener: (status: QianchuanLibraryScheduleStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: QianchuanLibraryScheduleStatus) => listener(status);
    ipcRenderer.on("videoLibrarySchedule.changed", handler);
    return () => ipcRenderer.removeListener("videoLibrarySchedule.changed", handler);
  },
  refreshQianchuanAccounts: (): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.refreshAccounts"),
  resumeDouyinUpload: (projectId: string, uploadTaskId: string): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.resume", { projectId, uploadTaskId }),
  retargetDouyinUpload: (projectId: string, uploadTaskId: string, expectedAdId: string): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.retarget", { projectId, uploadTaskId, expectedAdId }),
  stopDouyinUpload: (projectId: string, uploadTaskId: string): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.stop", { projectId, uploadTaskId }),
  discardDouyinUploadBatch: (projectId: string, uploadTaskId: string): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.discard", { projectId, uploadTaskId }),
  closeDouyinUploadBatch: (projectId: string, uploadTaskId: string): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.closeBatch", { projectId, uploadTaskId }),
  reviseDouyinUploadCaption: (projectId: string, uploadTaskId: string, caption: string): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.caption", { projectId, uploadTaskId, caption }),
  confirmDouyinUpload: (projectId: string, uploadTaskId: string, success: UploadSuccess): Promise<DesktopState> => ipcRenderer.invoke("douyinUpload.confirm", { projectId, uploadTaskId, success }),
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
