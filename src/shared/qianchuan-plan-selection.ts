import { z } from "zod";
import { QianchuanProductSchema } from "./qianchuan-account.js";

const id = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const QianchuanPlanOptionSchema = z.object({
  advertiserId: id, adId: id,
  name: z.string().trim().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/),
}).strict();
export type QianchuanPlanOption = z.infer<typeof QianchuanPlanOptionSchema>;
export const QianchuanPlanListRequestSchema = z.object({ product: QianchuanProductSchema, expectedAdvertiserId: id, requestId: z.string().uuid().optional(), refresh: z.boolean().optional() }).strict();
export const QianchuanPlanCancelSchema = z.object({ requestId: z.string().uuid() }).strict();
export type QianchuanPlanCancel = z.infer<typeof QianchuanPlanCancelSchema>;
export type QianchuanPlanListRequest = z.infer<typeof QianchuanPlanListRequestSchema>;
export const QianchuanPlanListSchema = z.array(QianchuanPlanOptionSchema).max(1000).superRefine((plans, ctx) => {
  if (new Set(plans.map(plan => plan.adId)).size !== plans.length || new Set(plans.map(plan => plan.advertiserId)).size > 1) {
    ctx.addIssue({ code: "custom", message: "计划列表身份无法唯一确认。" });
  }
});
