import { expect, it } from "vitest";
import { QIANCHUAN_QUERY_METRICS, type QianchuanQueryMetrics } from "../src/shared/qianchuan-backend.js";
import type { QianchuanReportSnapshot } from "../src/shared/qianchuan-report.js";
import { compareQianchuanSnapshots, haveComparableSnapshotScope, subtractDecimalExact } from "../src/shared/qianguanjia-view.js";

const metrics = (cost = "10.00", orders = "2", gmv = "30.00", roi = "3.0"): QianchuanQueryMetrics => Object.fromEntries(
  QIANCHUAN_QUERY_METRICS.map((key, index) => [key, { value: [cost, orders, gmv, roi][index]!, display: [cost, orders, gmv, roi][index]! }]),
) as QianchuanQueryMetrics;
const base = {
  version: 1 as const, id: "08b94db4-2684-42b0-8a38-2cce443c0778", source: "qianchuan-browser" as const,
  product: "眼贴" as const, advertiserId: "1879999999999999999", startTime: "2026-10-15 00:00:00", endTime: "2026-10-15 23:59:59",
  asOf: "2026-10-16T01:00:00.000Z", capturedAt: "2026-10-16T01:02:00.000Z", complete: true as const,
  metricProvenance: Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, { source: "platform-reported" as const, unit: "unknown" as const, definition: "platform-reported" as const }])),
};
function report(values = metrics(), overrides: Partial<typeof base> = {}): QianchuanReportSnapshot {
  return { ...base, ...overrides, kind: "report", metrics: values } as QianchuanReportSnapshot;
}
function materials(adId: string, rows: { materialId: string; name: string; metrics: QianchuanQueryMetrics }[], overrides: Partial<typeof base> = {}): QianchuanReportSnapshot {
  return { ...base, ...overrides, kind: "materials", adId, rows, total: rows.length } as QianchuanReportSnapshot;
}

it.each([
  ["10.0002", "2e-4", "10"],
  ["1e3", "0.0000001", "999.9999999"],
  ["-1.25e-3", "2.5e-4", "-0.0015"],
  ["18799999999999999999", "1", "18799999999999999998"],
  ["1.00", "1", "0"],
])("subtracts exact decimals %s - %s", (left, right, expected) => {
  expect(subtractDecimalExact(left, right)).toBe(expected);
});

it("returns no delta for invalid decimal text", () => {
  expect(subtractDecimalExact("not-a-number", "1")).toBeNull();
  expect(subtractDecimalExact("1e1001", "0")).toBeNull();
});

it("compares same-account report snapshots field by field without summing ROI", () => {
  const left = report(metrics("12.34", "4", "98.76", "7.5"));
  const right = report(metrics("10.00", "3", "88.76", "5.0"), { id: "1b9c1f1c-67bb-4da6-9b8f-aa3d2a7c9901", startTime: "2026-10-08 00:00:00", endTime: "2026-10-08 23:59:59" });
  expect(haveComparableSnapshotScope(left, right)).toBe(true);
  expect(compareQianchuanSnapshots(left, right)).toEqual({ kind: "report", metricDeltas: {
    stat_cost_for_roi2: "2.34", total_pay_order_count_for_roi2: "1", total_pay_order_gmv_include_coupon_for_roi2: "10", total_prepay_and_pay_order_roi2: "2.5",
  } });
});

it("matches material rows only by exact material ID and exposes unmatched counts", () => {
  const left = materials("1878754135410692", [
    { materialId: "7696527003390771254", name: "旧名称.mp4", metrics: metrics("12.5") },
    { materialId: "7696527003390771255", name: "仅左侧.mp4", metrics: metrics() },
  ]);
  const right = materials("1878754135410692", [
    { materialId: "7696527003390771254", name: "重命名.mp4", metrics: metrics("10") },
    { materialId: "7696527003390771256", name: "仅右侧.mp4", metrics: metrics() },
  ], { id: "1b9c1f1c-67bb-4da6-9b8f-aa3d2a7c9901" });
  expect(compareQianchuanSnapshots(left, right)).toEqual({ kind: "materials", matchedRows: [
    { materialId: "7696527003390771254", name: "旧名称.mp4", metricDeltas: {
      stat_cost_for_roi2: "2.5", total_pay_order_count_for_roi2: "0", total_pay_order_gmv_include_coupon_for_roi2: "0", total_prepay_and_pay_order_roi2: "0",
    } },
  ], unmatchedLeft: 1, unmatchedRight: 1 });
});

it("refuses comparisons across account, plan, or report-kind scopes", () => {
  const reportSnapshot = report();
  expect(compareQianchuanSnapshots(reportSnapshot, report(metrics(), { advertiserId: "1879999999999999998" }))).toBeNull();
  expect(compareQianchuanSnapshots(reportSnapshot, materials("1878754135410692", []))).toBeNull();
  expect(compareQianchuanSnapshots(materials("1878754135410692", []), materials("1878754135410693", []))).toBeNull();
});
