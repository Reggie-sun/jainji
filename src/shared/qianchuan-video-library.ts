import { z } from "zod";
import { QianchuanProductSchema } from "./qianchuan-account.js";
import { QianchuanPlanListSchema, QianchuanPlanOptionSchema } from "./qianchuan-plan-selection.js";

export const QianchuanLibraryAccountSchema = z.object({
  product: QianchuanProductSchema,
  expectedAdvertiserId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  expectedAdId: z.string().regex(/^[1-9][0-9]{0,19}$/).optional(),
}).strict();
export const QianchuanLibraryClearSchema = z.object({
  confirmation: z.enum(["DELETE_ALL_VIDEOS", "DELETE_PLAN_MATERIALS", "DELETE_VIDEOS_AND_PLAN_MATERIALS"]),
  planMaterialRule: z.enum(["ZERO_IMPRESSIONS_7D", "AUDIT_AND_ZERO_IMPRESSIONS_7D"]).optional(),
  accounts: z.array(QianchuanLibraryAccountSchema.extend({ plan: QianchuanPlanOptionSchema.optional(), plans: QianchuanPlanListSchema.refine(plans => plans.length > 0, "请至少选择一个清理计划。").optional() })
    .refine(value => !value.plan || value.plan.advertiserId === value.expectedAdvertiserId && value.plan.adId === value.expectedAdId, "所选清理计划与账号或计划 ID 不一致。")
    .refine(value => !value.plans || !value.plan && !value.expectedAdId && value.plans.every(plan => plan.advertiserId === value.expectedAdvertiserId), "清理计划集合与账号不一致或含混用的单计划字段。")).min(1).max(6),
}).strict().refine(value => new Set(value.accounts.map(account => account.product)).size === value.accounts.length &&
  new Set(value.accounts.map(account => account.expectedAdvertiserId)).size === value.accounts.length, "删除账号不能重复。")
  .refine(value => value.confirmation === "DELETE_ALL_VIDEOS" || value.accounts.every(account => account.expectedAdId || account.plans), "清理计划素材必须明确绑定当前计划 ID。")
  .refine(value => value.confirmation !== "DELETE_ALL_VIDEOS" || value.accounts.every(account => !account.plan && !account.plans), "视频库清空作用于整个账号，不能限定计划。")
  .refine(value => !value.planMaterialRule || value.confirmation !== "DELETE_ALL_VIDEOS", "计划素材规则必须与计划清理一起使用，不能用于仅清空视频库。");
export type QianchuanLibraryClear = z.infer<typeof QianchuanLibraryClearSchema>;
export interface QianchuanLibraryResult {
  product: z.infer<typeof QianchuanProductSchema>;
  advertiserId: string;
  state: "CLEARED" | "BLOCKED";
  deletedCount: number;
  message: string;
}

export const PLAN_MATERIAL_STATUSES = ["审核不通过", "生态审核不通过", "审核通过可优化"] as const;
export type PlanMaterialStatus = typeof PLAN_MATERIAL_STATUSES[number];
export function matchesPlanMaterialStatus(text: string, status: PlanMaterialStatus): boolean {
  const parts = text.trim().split(/\s+/);
  return status === "审核通过可优化" ? parts[0] === "审核通过" && parts.includes("可优化") : parts[0] === status;
}

export const VIDEO_LIBRARY_ROUTE = "/tools/creative-management/video-library";
export function videoLibraryUrl(advertiserId: string): string {
  if (!/^[1-9][0-9]{0,19}$/.test(advertiserId)) throw new Error("无效的千川账号。");
  return `https://qianchuan.jinritemai.com${VIDEO_LIBRARY_ROUTE}?aavid=${advertiserId}`;
}
