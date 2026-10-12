import { z } from "zod";
import { QianchuanProductSchema } from "./qianchuan-account.js";

const id = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const QianchuanPlanOptionSchema = z.object({
  advertiserId: id, adId: id,
  name: z.string().trim().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/),
  productNames: z.array(z.string().trim().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/)).min(1).max(50).optional(),
  accountSource: z.literal("current-browser").optional(),
}).strict();
export type QianchuanPlanOption = z.infer<typeof QianchuanPlanOptionSchema>;
export const QianchuanPlanListRequestSchema = z.object({ product: QianchuanProductSchema, expectedAdvertiserId: id, requestId: z.string().uuid().optional(), refresh: z.boolean().optional(), accountSource: z.literal("current-browser").optional(), includeAccount: z.literal(true).optional() }).strict().refine(value => !value.includeAccount || value.accountSource === "current-browser", "网页账户信息只适用于当前网页读取。");
export const QianchuanPlanCancelSchema = z.object({ requestId: z.string().uuid() }).strict();
export type QianchuanPlanCancel = z.infer<typeof QianchuanPlanCancelSchema>;
export type QianchuanPlanListRequest = z.infer<typeof QianchuanPlanListRequestSchema>;
export const QianchuanPlanListSchema = z.array(QianchuanPlanOptionSchema).max(1000).superRefine((plans, ctx) => {
  if (new Set(plans.map(plan => plan.adId)).size !== plans.length || new Set(plans.map(plan => plan.advertiserId)).size > 1) {
    ctx.addIssue({ code: "custom", message: "计划列表身份无法唯一确认。" });
  }
});
export const QianchuanCurrentAccountSchema = z.object({
  advertiserId: id,
  name: z.string().trim().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/).optional(),
}).strict();
export type QianchuanCurrentAccount = z.infer<typeof QianchuanCurrentAccountSchema>;
export const QianchuanPlanCatalogSchema = z.object({ account: QianchuanCurrentAccountSchema, plans: QianchuanPlanListSchema }).strict().refine(value => value.plans.every(plan => plan.advertiserId === value.account.advertiserId && plan.accountSource === "current-browser"), "计划列表与网页账户不匹配。");
export type QianchuanPlanCatalog = z.infer<typeof QianchuanPlanCatalogSchema>;
export type QianchuanPlanListResult = QianchuanPlanOption[] | QianchuanPlanCatalog;
