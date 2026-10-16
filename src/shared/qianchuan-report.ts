import { z } from "zod";
import { QianchuanProductSchema } from "./qianchuan-account.js";
import { QIANCHUAN_QUERY_METRICS, type QianchuanQueryMetric } from "./qianchuan-backend.js";

const accountId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, "请选择有效日期。");
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).refine(value => {
  const time = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19).replace("T", " ") === value;
}, "统计窗口无效。");
const safeText = (max: number) => z.string().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const decimalValue = /^-?\d+(?:\.\d+)?$/;
const metricValue = z.string().max(127).refine(value => {
  if (decimalValue.test(value)) return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && Math.abs(numeric) <= Number.MAX_SAFE_INTEGER && String(numeric) === value;
});
const MetricCellSchema = z.object({ value: metricValue, display: safeText(128) }).strict();
const metricShape = Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, MetricCellSchema])) as {
  [K in QianchuanQueryMetric]: typeof MetricCellSchema;
};
export const QianchuanReportMetricsSchema = z.object(metricShape).strict();

const MetricProvenanceEntrySchema = z.object({
  source: z.literal("platform-reported"),
  unit: z.literal("unknown"),
  definition: z.literal("platform-reported"),
}).strict();
const metricProvenanceShape = Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, MetricProvenanceEntrySchema])) as {
  [K in QianchuanQueryMetric]: typeof MetricProvenanceEntrySchema;
};
export const QianchuanReportMetricProvenanceSchema = z.object(metricProvenanceShape).strict();
export type QianchuanReportMetricProvenance = z.infer<typeof QianchuanReportMetricProvenanceSchema>;

export const QianchuanReportMaterialSchema = z.object({
  materialId: accountId,
  videoId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional(),
  name: safeText(255),
  metrics: QianchuanReportMetricsSchema,
}).strict();

const captureBase = {
  product: QianchuanProductSchema,
  expectedAdvertiserId: accountId,
  browserAccess: z.literal("existing-only").optional(),
  requestId: uuid,
  startDate: date,
  endDate: date,
};
export const QianchuanReportCaptureSchema = z.discriminatedUnion("kind", [
  z.object({ ...captureBase, kind: z.literal("report") }).strict(),
  z.object({ ...captureBase, kind: z.literal("materials"), adId: accountId }).strict(),
]).superRefine((value, ctx) => {
  const days = (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86400000;
  if (days < 0 || days >= 31) ctx.addIssue({ code: "custom", message: "查询起止日期须按顺序，范围最多 31 天。" });
});
export type QianchuanReportCapture = z.infer<typeof QianchuanReportCaptureSchema>;

export const QianchuanReportListSchema = z.object({ product: QianchuanProductSchema, expectedAdvertiserId: accountId }).strict();
export type QianchuanReportList = z.infer<typeof QianchuanReportListSchema>;

const snapshotBase = {
  version: z.literal(1),
  id: uuid,
  source: z.literal("qianchuan-browser"),
  product: QianchuanProductSchema,
  advertiserId: accountId,
  startTime: localDateTime,
  endTime: localDateTime,
  asOf: z.string().datetime(),
  capturedAt: z.string().datetime(),
  complete: z.literal(true),
  metricProvenance: QianchuanReportMetricProvenanceSchema,
};
export const QianchuanReportSnapshotSchema = z.discriminatedUnion("kind", [
  z.object({ ...snapshotBase, kind: z.literal("report"), metrics: QianchuanReportMetricsSchema }).strict(),
  z.object({ ...snapshotBase, kind: z.literal("materials"), adId: accountId, rows: z.array(QianchuanReportMaterialSchema).max(2000), total: z.number().int().min(0).max(2000) }).strict(),
]).superRefine((snapshot, ctx) => {
  if (snapshot.kind !== "materials") return;
  if (snapshot.rows.length !== snapshot.total) ctx.addIssue({ code: "custom", message: "素材快照不完整。" });
  if (new Set(snapshot.rows.map(row => row.materialId)).size !== snapshot.rows.length) ctx.addIssue({ code: "custom", message: "素材快照包含重复 ID。" });
});
export type QianchuanReportSnapshot = z.infer<typeof QianchuanReportSnapshotSchema>;

export const QIANCHUAN_REPORT_METRIC_PROVENANCE: QianchuanReportMetricProvenance =
  QianchuanReportMetricProvenanceSchema.parse(Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, {
    source: "platform-reported", unit: "unknown", definition: "platform-reported",
  }])));
