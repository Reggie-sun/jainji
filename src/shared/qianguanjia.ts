import { z } from "zod";
import { QianguanjiaAnalysisInputSchema, type QianguanjiaReportPage, type QianguanjiaMaterialPage, type QianguanjiaPlanReportPage } from "./qianguanjia-analysis.js";
import type { QianchuanUploadTaskStatus } from "./douyin-upload.js";

const request = { requestId: z.string().uuid() };
const basicQueries = z.discriminatedUnion("kind", [
  z.object({ ...request, kind: z.literal("discover") }).strict(),
  z.object({ ...request, kind: z.literal("accounts"), sessionId: z.string().uuid() }).strict(),
  z.object({ ...request, kind: z.literal("home"), sessionId: z.string().uuid() }).strict(),
]);
export const QianguanjiaQuerySchema = z.union([basicQueries, z.object({ ...request, kind:z.literal("local-materials") }).strict(),
  z.object({ ...request, sessionId:z.string().uuid(), kind:z.literal("report"), startDate:z.string(), endDate:z.string(), advertiserIds:z.array(z.string()), page:z.number(),limit:z.literal(20) }).strict(),
  z.object({ ...request,sessionId:z.string().uuid(),kind:z.literal("plan-report"),startDate:z.string(),endDate:z.string(),page:z.literal(1),limit:z.literal(10) }).strict(),
  z.object({ ...request, sessionId:z.string().uuid(), kind:z.literal("materials"), advertiserId:z.string(),page:z.number(),limit:z.literal(20) }).strict(),
]).superRefine((value,ctx)=>{
  if(value.kind !== "report" && value.kind !== "materials" && value.kind !== "plan-report") return;
  const {requestId:_requestId,sessionId:_sessionId,...input}=value;
  if(!QianguanjiaAnalysisInputSchema.safeParse(input).success)ctx.addIssue({code:"custom",message:"千管家分析参数无效。"});
});
export const QianguanjiaCancelSchema = z.object(request).strict();
export type QianguanjiaQuery = z.infer<typeof QianguanjiaQuerySchema>;
export interface QianguanjiaSessionOption { sessionId: string; label: string }
export interface QianguanjiaAccountDirectory {
  source: "qianguanjia"; observedAt: string;
  accounts: { advertiserId: string; name: string; authStatus: number; authStatusDesc: string }[];
}
export interface QianguanjiaHomeMetrics {
  statCost: string | null; totalPayOrderGmvIncludeCouponForRoi2: string | null;
  totalPayOrderCountForRoi2: string | null; totalPrepayAndPayOrderRoi2: string | null;
}
export interface QianguanjiaHomeSummary {
  source: "qianguanjia"; scope: "supplier-home-aggregate"; observedAt: string; date: string;
  availability?: "provided" | "not-provided";
  groups: Record<"ALL" | "LIVE_PROM_GOODS" | "VIDEO_PROM_GOODS", { current: QianguanjiaHomeMetrics; comparison: QianguanjiaHomeMetrics }>;
}
export type QianguanjiaResult = { requestId: string } & (
  { kind: "discover"; sessions: QianguanjiaSessionOption[]; unavailableBrowsers: number } |
  { kind: "accounts"; sessionId: string; data: QianguanjiaAccountDirectory } |
  { kind: "home"; sessionId: string; data: QianguanjiaHomeSummary } |
  { kind:"report";sessionId:string;data:QianguanjiaReportPage } |
  { kind:"materials";sessionId:string;data:QianguanjiaMaterialPage } |
  { kind:"plan-report";sessionId:string;data:QianguanjiaPlanReportPage } |
  { kind:"local-materials";observedAt:string;tasks:QianchuanUploadTaskStatus[] }
);
export interface QianguanjiaDesktopApi {
  queryQianguanjia(input: QianguanjiaQuery): Promise<QianguanjiaResult>;
  cancelQianguanjiaQuery(input: { requestId: string }): Promise<void>;
  disconnectQianguanjia(): Promise<void>;
}
