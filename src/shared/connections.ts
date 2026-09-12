import { z } from "zod";
import { ConnectionInputSchema } from "./agent.js";

export const SaveConnectionSchema = ConnectionInputSchema.extend({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  apiKey: ConnectionInputSchema.shape.apiKey.optional(),
}).strict();
export type SaveConnection = z.infer<typeof SaveConnectionSchema>;
export interface SavedConnection {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: "chat-completions" | "responses" | "anthropic";
  authHeader: "bearer" | "x-api-key";
}
export interface ConnectionLibrary {
  profiles: SavedConnection[];
  selected: string | null;
  error?: string;
}
