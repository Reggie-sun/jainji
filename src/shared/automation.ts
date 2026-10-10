import { z } from "zod";
import { BatchProductionStartSchema } from "./batch-production.js";
import { QianchuanLibraryClearSchema } from "./qianchuan-video-library.js";
import { UploadIdentitySchema } from "./douyin-upload.js";

export const AutomationRequestSchema = z.object({
  name: z.string().trim().min(1, "请填写任务名称。").max(80, "任务名称最多 80 个字。"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "请选择有效的每日执行时间。"),
  enabled: z.boolean(),
  cleanup: QianchuanLibraryClearSchema.refine(value => value.confirmation === "DELETE_PLAN_MATERIALS", "定时任务只清理所选计划素材。").optional(),
  production: BatchProductionStartSchema.optional(),
  upload: z.boolean(),
  uploadFrom: z.string().uuid().optional(),
  confirmation: z.literal("AUTHORIZE_FIXED_AUTOMATION", { errorMap: () => ({ message: "请确认以上固定执行范围并勾选授权。" }) }),
}).strict().superRefine((value, context) => {
  if (value.production && value.production.entries.reduce((sum, entry) => sum + entry.requestedCount, 0) > 2500) {
    context.addIssue({ code: "custom", message: "单个定时任务最多制作 2500 条，请拆分任务。" });
  }
  if (!value.cleanup && !value.production && !value.upload || value.upload && !value.production && !value.uploadFrom ||
    value.uploadFrom && (value.production || !value.upload) || value.production && value.upload && value.production.entries.some(entry => !entry.douyinUpload?.plan)) {
    context.addIssue({ code: "custom", message: "请选择清理、制作或上传；自动上传须绑定制作任务和明确计划。" });
  }
});
export type AutomationRequest = z.infer<typeof AutomationRequestSchema>;
export const AutomationRunSchema = z.object({
  id: z.string().uuid(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startedAt: z.string().datetime(), finishedAt: z.string().datetime().optional(),
  state: z.enum(["RUNNING", "COMPLETED", "BLOCKED", "SKIPPED"]),
  message: z.string().max(2000), productionRunId: z.string().uuid().optional(),
  exports: z.array(UploadIdentitySchema).max(2500).optional(),
}).strict();
export type AutomationRun = z.infer<typeof AutomationRunSchema>;
export const AutomationTaskSchema = z.object({
  id: z.string().uuid(), request: AutomationRequestSchema, binding: z.string().regex(/^[a-f0-9]{64}$/),
  summary: z.string().max(8000), createdAt: z.string().datetime(), lastRun: AutomationRunSchema.optional(),
}).strict();
export type AutomationTask = z.infer<typeof AutomationTaskSchema>;
export interface AutomationStatus {
  tasks: (AutomationTask & { nextRunAt?: string })[];
  timeZone: string; running: boolean; error?: string;
}
