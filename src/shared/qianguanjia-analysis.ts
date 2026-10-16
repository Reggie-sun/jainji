import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
});
export const QianguanjiaAnalysisRangeSchema = z.object({ startDate: date, endDate: date }).strict().refine(value => {
  const days = (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86400000;
  return days >= 0 && days < 31;
}, "请选择按顺序排列、最多31天的有效日期。");
export const QianguanjiaAnalysisInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("report"), startDate: date, endDate: date,
    advertiserIds: z.array(z.string().regex(/^[1-9][0-9]{0,19}$/)).min(1).max(100),
    page: z.number().int().min(1).max(500), limit: z.literal(20) }).strict(),
  z.object({ kind: z.literal("plan-report"), startDate: date, endDate: date, page: z.literal(1), limit:z.literal(10) }).strict(),
  z.object({ kind: z.literal("materials"), advertiserId: z.string().regex(/^[1-9][0-9]{0,19}$/),
    page: z.number().int().min(1).max(500), limit: z.literal(20) }).strict(),
]).superRefine((value, ctx) => {
  if (value.kind === "plan-report" && !QianguanjiaAnalysisRangeSchema.safeParse({startDate:value.startDate,endDate:value.endDate}).success) ctx.addIssue({code:"custom",message:"日期范围无效。"});
  if (value.kind === "report" && (!QianguanjiaAnalysisRangeSchema.safeParse({startDate:value.startDate,endDate:value.endDate}).success || new Set(value.advertiserIds).size !== value.advertiserIds.length))
    ctx.addIssue({code:"custom",message:"日期范围或账户集合无效。"});
});
export type QianguanjiaAnalysisInput = z.infer<typeof QianguanjiaAnalysisInputSchema>;
export const QIANGUANJIA_REPORT_FIELDS = ["statCostForRoi2", "totalPayOrderCountForRoi2", "totalPayOrderGmvIncludeCouponForRoi2", "totalPrepayAndPayOrderRoi2"] as const;
export type QianguanjiaReportField = typeof QIANGUANJIA_REPORT_FIELDS[number];
export type QianguanjiaReportMetrics = Record<QianguanjiaReportField, string | null>;
export interface QianguanjiaReportPage {
  source: "qianguanjia"; scope: "supplier-product-account-report"; observedAt: string;
  startDate: string; endDate: string; advertiserIds: string[]; page: number; limit: 20;
  total: number | null; availability: "provided" | "not-provided";
  rows: { advertiserId: string; name: string; date: string; metrics: QianguanjiaReportMetrics }[];
}
export interface QianguanjiaMaterialPage {
  source: "qianguanjia"; scope: "supplier-platform-video-catalog"; observedAt: string;
  advertiserId: string; page: number; limit: 20; total: number | null; availability: "provided" | "not-provided";
  rows: { advertiserId: string; materialId: string; videoId: string; filename: string; signature?: string; durationSeconds: number | null }[];
}

export interface QianguanjiaPlanReportPage {
 source:"qianguanjia";scope:"supplier-plan-ranking";observedAt:string;startDate:string;endDate:string;
 filter:"SMART_BID_CUSTOM";page:1;limit:10;total:null;reportedTotal:number|null;coverage:"current-page-only";availability:"provided"|"not-provided";
 rows:{planId:string;name:string;metrics:QianguanjiaReportMetrics}[];
}
