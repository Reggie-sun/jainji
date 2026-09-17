import { z } from "zod";
import { ConnectionInputSchema } from "./agent.js";

export const DEFAULT_QWEN_CONNECTION = {
  name: "团队 Qwen（RTX 5090）",
  baseUrl: "https://qwen.reggie-sun.ccwu.cc/v1",
  model: "Qwen/Qwen3-VL-8B-Instruct",
  protocol: "chat-completions" as const,
  authHeader: "bearer" as const,
};

export const SaveConnectionSchema = ConnectionInputSchema.extend({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  apiKey: ConnectionInputSchema.shape.apiKey.optional(),
}).strict();
export type SaveConnection = z.infer<typeof SaveConnectionSchema>;
export const SelectModelSchema = z.object({
  connectionId: z.union([z.literal("chatgpt"), z.string().uuid()]),
  model: ConnectionInputSchema.shape.model,
  reasoningEffort: ConnectionInputSchema.shape.reasoningEffort,
}).strict();
export type SelectModel = z.infer<typeof SelectModelSchema>;
export interface SavedConnection {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  protocol: "chat-completions" | "responses" | "anthropic";
  authHeader: "bearer" | "x-api-key";
}
export interface ConnectionLibrary {
  profiles: SavedConnection[];
  selected: string | null;
  vision?: SelectModel | null;
  reviewer?: SelectModel | null;
  chatgptModel?: string;
  chatgptReasoningEffort?: string;
  error?: string;
}
