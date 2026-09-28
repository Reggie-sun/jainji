import type { AppState } from "../main/application";
import type { CapabilityStatus } from "../main/ffmpeg";
import type { AgentRun, ConnectionStatus, ChatGPTStatus } from "./agent";
import type { ConnectionLibrary } from "./connections";
import type { DouyinUploadStatus } from "./douyin-upload";
import type { BatchProductionRun } from "./batch-production";

export type DesktopState = AppState & {
  batchProduction?: BatchProductionRun;
  batchProductionWarning?: string;
  capabilities: CapabilityStatus;
  connection: ConnectionStatus;
  visionConnection?: ConnectionStatus;
  reviewerConnection?: ConnectionStatus;
  chatgpt?: ChatGPTStatus;
  connections?: ConnectionLibrary;
  agentRun?: AgentRun;
  douyinUpload?: DouyinUploadStatus;
  sourceKnowledgeRisks?: Record<string, "disputed" | "unknown">;
  recentProjects?: { id: string; name: string; mediaCount: number; fileName: string }[];
  activeRecentProjectId?: string;
  recentProjectsWarning?: string;
};
