import { expect, it } from "vitest";
import { exportQianchuanReportCsv } from "../src/shared/qianchuan-report-export";
import { QIANCHUAN_REPORT_METRIC_PROVENANCE, type QianchuanReportSnapshot } from "../src/shared/qianchuan-report";
import { QIANCHUAN_QUERY_METRICS } from "../src/shared/qianchuan-backend";
const snapshot: QianchuanReportSnapshot = { version: 1, id: "b1111111-1111-4111-8111-111111111111", source: "qianchuan-browser", product: "眼贴",
  advertiserId: "1879999999999999999", adId: "1878754135410692", kind: "materials", startTime: "2026-10-15 00:00:00", endTime: "2026-10-15 09:00:00",
  asOf: "2026-10-15T01:00:00Z", capturedAt: "2026-10-15T01:00:05Z", complete: true, metricProvenance: QIANCHUAN_REPORT_METRIC_PROVENANCE, total: 1,
  rows: [{ materialId: "7696527003390771254", videoId: "video_1", name: '=HYPERLINK("untrusted")',
    metrics: Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, { value: "12345678901234567890.01", display: "平台显示" }])) as any }] };
it("exports exact IDs and raw decimals once per material and metric without estimating ROI", () => {
  const csv = exportQianchuanReportCsv(snapshot);
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv.split("\r\n")).toHaveLength(6);
  expect(csv).toContain('"1879999999999999999"'); expect(csv).toContain('"12345678901234567890.01"');
  expect(csv).toContain('"unknown"'); expect(csv).toContain('"total_prepay_and_pay_order_roi2"');
  expect(csv).not.toContain("undefined");
});
it("quotes embedded punctuation and neutralizes platform-controlled spreadsheet formulas", () => {
  const csv = exportQianchuanReportCsv(snapshot);
  expect(csv).toContain('"\'=HYPERLINK(""untrusted"")"');
});
it("rejects incomplete or duplicate material rows and extra credential fields", () => {
  expect(() => exportQianchuanReportCsv({ ...snapshot, total: 2 })).toThrow();
  expect(() => exportQianchuanReportCsv({ ...snapshot, total: 2, rows: [...snapshot.rows, ...snapshot.rows] })).toThrow();
  expect(() => exportQianchuanReportCsv({ ...snapshot, cookie: "sensitive" } as any)).toThrow();
});
