import type { AppState } from "../main/application";
import type { CapabilityStatus } from "../main/ffmpeg";
import type { AgentRun, ConnectionStatus, ChatGPTStatus } from "./agent";
import type { ConnectionLibrary } from "./connections";

export type DesktopState = AppState & {
  capabilities: CapabilityStatus;
  connection: ConnectionStatus;
  visionConnection?: ConnectionStatus;
  reviewerConnection?: ConnectionStatus;
  chatgpt?: ChatGPTStatus;
  connections?: ConnectionLibrary;
  agentRun?: AgentRun;
  recentProjects?: { id: string; name: string; mediaCount: number; fileName: string }[];
  activeRecentProjectId?: string;
  recentProjectsWarning?: string;
};
