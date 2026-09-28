import { z } from "zod";
import { MAX_AGENT_OUTPUTS } from "./agent.js";
import type { AgentItem } from "./agent.js";
import type { ExportTask } from "../main/domain.js";
import { RequiredProductPriceSchema } from "./decorations.js";
import { QianchuanUploadSelectionSchema, type DouyinUploadStatus } from "./douyin-upload.js";
import { QianchuanProductSchema } from "./qianchuan-account.js";

export const BatchProductionEntrySchema = z.object({
  recentProjectId: z.string().uuid(),
  requestedCount: z.number().int().min(1).max(MAX_AGENT_OUTPUTS),
  productPrice: RequiredProductPriceSchema,
  coverEnabled: z.boolean(),
  displayMode: z.enum(["full", "first-5s"]),
  mode: z.enum(["manual", "agent", "random"]).optional(),
  outputDirectory: z.string().min(1).max(4096).optional(),
  douyinUpload: QianchuanUploadSelectionSchema.optional(),
}).strict();
export type BatchProductionEntry = z.infer<typeof BatchProductionEntrySchema>;

export const BatchProductionStartSchema = z.object({
  entries: z.array(BatchProductionEntrySchema).min(1).max(MAX_AGENT_OUTPUTS),
}).strict().refine(({ entries }) => new Set(entries.map(({ recentProjectId }) => recentProjectId)).size === entries.length, "每个模板只能选择一次。");
export type BatchProductionStart = z.infer<typeof BatchProductionStartSchema>;

export interface BatchProjectOption {
  recentProjectId: string;
  name: string;
  sourceCount: number;
  requestedCount: number;
  productPrice: string;
  coverEnabled: boolean;
  displayMode: "full" | "first-5s";
  mode: "manual" | "agent" | "random";
  coverMode?: "manual" | "agent" | "assisted";
  error?: string;
}

export const BatchProductionJobSchema = z.object({
  id: z.string().uuid(),
  recentProjectId: z.string().uuid(),
  name: z.string(),
  projectId: z.string().uuid().optional(),
  requestedCount: z.number().int().positive(),
  actualCount: z.number().int().nonnegative(),
  productPrice: RequiredProductPriceSchema,
  coverEnabled: z.boolean(),
  displayMode: z.enum(["full", "first-5s"]),
  mode: z.enum(["manual", "agent", "random"]).optional(),
  accountProduct: QianchuanProductSchema.optional(),
  status: z.enum(["queued", "preparing", "producing", "exporting", "completed", "failed", "cancelled", "interrupted"]),
  taskIds: z.array(z.string().uuid()).max(MAX_AGENT_OUTPUTS),
  completedTaskIds: z.array(z.string().uuid()).max(MAX_AGENT_OUTPUTS).optional(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  outputDirectory: z.string().optional(),
  error: z.string().optional(),
}).strict();
export type BatchProductionJob = z.infer<typeof BatchProductionJobSchema>;

export const BatchProductionRunSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["running", "cancelling", "finished", "cancelled", "interrupted"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  jobs: z.array(BatchProductionJobSchema).min(1).max(MAX_AGENT_OUTPUTS),
  error: z.string().optional(),
}).strict();
export type BatchProductionRun = z.infer<typeof BatchProductionRunSchema>;

export const BatchProductionDetailRequestSchema = z.object({ runId: z.string().uuid(), jobId: z.string().uuid() }).strict();
export type BatchProductionDetailRequest = z.infer<typeof BatchProductionDetailRequestSchema>;
export interface BatchProductionDetail {
  runId: string;
  job: BatchProductionJob;
  usesModel?: boolean;
  items: AgentItem[];
  tasks: ExportTask[];
  upload?: Pick<DouyinUploadStatus, "message" | "tasks">;
}
