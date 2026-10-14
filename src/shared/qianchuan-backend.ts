import { z } from "zod";
import { QianchuanProductSchema } from "./qianchuan-account.js";

export const QIANCHUAN_QUERY_METRICS = [
  "stat_cost_for_roi2", "total_pay_order_count_for_roi2",
  "total_pay_order_gmv_include_coupon_for_roi2", "total_prepay_and_pay_order_roi2",
] as const;
export type QianchuanQueryMetric = typeof QIANCHUAN_QUERY_METRICS[number];
const id = z.string().regex(/^[1-9][0-9]{0,19}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, "请选择有效日期。");
const account = { product: QianchuanProductSchema, expectedAdvertiserId: id, requestId: z.string().uuid() };
const period = { startDate: date, endDate: date, asOf: z.string().datetime().optional() };
export const QianchuanBackendQuerySchema = z.discriminatedUnion("kind", [
  z.object({ ...account, kind: z.literal("plan"), adId: id }).strict(),
  z.object({ ...account, ...period, kind: z.literal("materials"), adId: id,
    offset: z.number().int().min(0).max(19900).default(0), limit: z.number().int().min(1).max(100).default(100),
  }).strict(),
  z.object({ ...account, ...period, kind: z.literal("report") }).strict(),
]).superRefine((value, ctx) => {
  if (value.kind === "plan") return;
  const days = (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86400000;
  if (days < 0 || days >= 31) ctx.addIssue({ code: "custom", message: "查询起止日期须按顺序，范围最多 31 天。" });
  if (value.kind === "materials" && value.offset % value.limit) ctx.addIssue({ code: "custom", message: "分页起点必须为每页数量的整数倍。" });
});
export type QianchuanBackendQuery = z.infer<typeof QianchuanBackendQuerySchema>;
export const QianchuanBackendCancelSchema = z.object({ requestId: z.string().uuid() }).strict();
export type QianchuanBackendCancel = z.infer<typeof QianchuanBackendCancelSchema>;

export interface QianchuanQueryMetricValue { value: string; display: string; }
export type QianchuanQueryMetrics = Record<QianchuanQueryMetric, QianchuanQueryMetricValue>;
interface QueryIdentity { advertiserId: string; observedAt: string; }
export type QianchuanBackendResult =
  | (QueryIdentity & { kind: "plan"; adId: string; name: string; budget: string; roiGoal: string; products: { id: string; name: string }[] })
  | (QueryIdentity & { kind: "materials"; adId: string; startTime: string; endTime: string; offset: number; limit: number; total: number;
      rows: { materialId: string; videoId?: string; name: string; metrics: QianchuanQueryMetrics }[] })
  | (QueryIdentity & { kind: "report"; startTime: string; endTime: string; metrics: QianchuanQueryMetrics });
