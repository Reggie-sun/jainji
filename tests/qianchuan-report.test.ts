import { expect, it } from "vitest";
import { QIANCHUAN_QUERY_METRICS, type QianchuanQueryMetrics } from "../src/shared/qianchuan-backend.js";
import {
  QianchuanReportSnapshotSchema,
} from "../src/shared/qianchuan-report.js";

const metricProvenance = Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, {
  source: "platform-reported", unit: "unknown", definition: "platform-reported",
}]));
const metrics = Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, { value: "123.4500", display: "¥123.45" }])) as QianchuanQueryMetrics;
const common = {
  version: 1 as const,
  id: "08b94db4-2684-42b0-8a38-2cce443c0778",
  source: "qianchuan-browser" as const,
  product: "眼贴" as const,
  advertiserId: "1879999999999999999",
  startTime: "2026-10-15 00:00:00",
  endTime: "2026-10-15 09:00:00",
  asOf: "2026-10-15T01:00:00.000Z",
  capturedAt: "2026-10-15T01:02:00.000Z",
  complete: true as const,
  metricProvenance,
};

it("accepts complete report snapshots while preserving exact metric keys and raw text", () => {
  const snapshot = QianchuanReportSnapshotSchema.parse({ ...common, kind: "report", metrics });
  if (snapshot.kind !== "report") throw new Error("expected report snapshot");
  expect(Object.keys(snapshot.metrics)).toEqual(QIANCHUAN_QUERY_METRICS);
  expect(snapshot.metrics.stat_cost_for_roi2).toEqual({ value: "123.4500", display: "¥123.45" });
  expect(snapshot.metricProvenance.stat_cost_for_roi2).toEqual({ source: "platform-reported", unit: "unknown", definition: "platform-reported" });
  expect(snapshot.advertiserId).toBe("1879999999999999999");
});

it("accepts material snapshots with exact large IDs and no inferred video association", () => {
  const snapshot = QianchuanReportSnapshotSchema.parse({
    ...common,
    kind: "materials",
    adId: "1878754135410692",
    total: 1,
    rows: [{ materialId: "7696527003390771254", name: "成片.mp4", metrics }],
  });
  if (snapshot.kind !== "materials") throw new Error("expected material snapshot");
  expect(snapshot.rows[0]!.materialId).toBe("7696527003390771254");
  expect(snapshot.rows[0]).not.toHaveProperty("videoId");
  expect(snapshot).not.toHaveProperty("metrics");
});

it("preserves backend scientific numeric text without parsing it into a guessed unit", () => {
  const exact = { ...metrics, stat_cost_for_roi2: { value: "1e-7", display: "0.0000001" } };
  const snapshot = QianchuanReportSnapshotSchema.parse({ ...common, kind: "report", metrics: exact });
  if (snapshot.kind !== "report") throw new Error("expected report snapshot");
  expect(snapshot.metrics.stat_cost_for_roi2).toEqual(exact.stat_cost_for_roi2);
});

it.each([
  ["missing report metric", { ...metrics, stat_cost_for_roi2: undefined }],
  ["guessed numeric metric", { ...metrics, stat_cost_for_roi2: { value: 123.45, display: "123.45" } }],
  ["invalid raw metric", { ...metrics, stat_cost_for_roi2: { value: "1e3", display: "1000" } }],
  ["invalid display metric", { ...metrics, stat_cost_for_roi2: { value: "1", display: "" } }],
  ["control character display", { ...metrics, stat_cost_for_roi2: { value: "1", display: "bad\nvalue" } }],
  ["extra metric key", { ...metrics, guessed_roi: { value: "3", display: "3" } }],
] as const)("rejects %s", (_name, badMetrics) => {
  expect(() => QianchuanReportSnapshotSchema.parse({ ...common, kind: "report", metrics: badMetrics })).toThrow();
});

it.each([
  ["report with plan ID", { ...common, kind: "report", metrics, adId: "1878754135410692" }],
  ["materials with report metrics", { ...common, kind: "materials", adId: "1878754135410692", total: 0, rows: [], metrics }],
  ["materials with duplicate IDs", { ...common, kind: "materials", adId: "1878754135410692", total: 2, rows: [
    { materialId: "7696527003390771254", name: "a", metrics }, { materialId: "7696527003390771254", name: "b", metrics },
  ] }],
  ["snapshot with URL or credentials", { ...common, kind: "report", metrics, url: "https://example.invalid/?token=secret", cookie: "secret" }],
  ["snapshot with non-platform metric provenance", { ...common, kind: "report", metrics, metricProvenance: { ...metricProvenance, stat_cost_for_roi2: { source: "computed", unit: "CNY", definition: "net ROI" } } }],
] as const)("rejects %s", (_name, value) => {
  expect(() => QianchuanReportSnapshotSchema.parse(value)).toThrow();
});
