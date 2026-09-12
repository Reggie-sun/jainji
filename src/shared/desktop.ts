import type { AppState } from "../main/application";
import type { CapabilityStatus } from "../main/ffmpeg";
import type { AgentRun, ConnectionStatus } from "./agent";

export type DesktopState = AppState & {
  capabilities: CapabilityStatus;
  connection: ConnectionStatus;
  agentRun?: AgentRun;
};
