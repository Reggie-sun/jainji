import { z } from "zod";

const request = { requestId: z.string().uuid() };
export const QianguanjiaQuerySchema = z.discriminatedUnion("kind", [
  z.object({ ...request, kind: z.literal("discover") }).strict(),
  z.object({ ...request, kind: z.literal("accounts"), sessionId: z.string().uuid() }).strict(),
  z.object({ ...request, kind: z.literal("home"), sessionId: z.string().uuid() }).strict(),
]);
export const QianguanjiaCancelSchema = z.object(request).strict();
export type QianguanjiaQuery = z.infer<typeof QianguanjiaQuerySchema>;
export interface QianguanjiaSessionOption { sessionId: string; label: string }
export interface QianguanjiaAccountDirectory {
  source: "qianguanjia"; observedAt: string;
  accounts: { advertiserId: string; name: string; authStatus: number; authStatusDesc: string }[];
}
export interface QianguanjiaHomeMetrics {
  statCost: string; totalPayOrderGmvIncludeCouponForRoi2: string;
  totalPayOrderCountForRoi2: string; totalPrepayAndPayOrderRoi2: string;
}
export interface QianguanjiaHomeSummary {
  source: "qianguanjia"; scope: "supplier-home-aggregate"; observedAt: string; date: string;
  groups: Record<"ALL" | "LIVE_PROM_GOODS" | "VIDEO_PROM_GOODS", { current: QianguanjiaHomeMetrics; comparison: QianguanjiaHomeMetrics }>;
}
export type QianguanjiaResult = { requestId: string } & (
  { kind: "discover"; sessions: QianguanjiaSessionOption[]; unavailableBrowsers: number } |
  { kind: "accounts"; sessionId: string; data: QianguanjiaAccountDirectory } |
  { kind: "home"; sessionId: string; data: QianguanjiaHomeSummary }
);
export interface QianguanjiaDesktopApi {
  queryQianguanjia(input: QianguanjiaQuery): Promise<QianguanjiaResult>;
  cancelQianguanjiaQuery(input: { requestId: string }): Promise<void>;
  disconnectQianguanjia(): Promise<void>;
}
