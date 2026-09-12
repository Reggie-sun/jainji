import type { AppState } from "../main/application";
import type { CapabilityStatus } from "../main/ffmpeg";
import type { AgentRun, ConnectionStatus, ChatGPTStatus } from "./agent";

export type DesktopState = AppState & {
  capabilities: CapabilityStatus;
  connection: ConnectionStatus;
  chatgpt?: ChatGPTStatus;
  agentRun?: AgentRun;
};
