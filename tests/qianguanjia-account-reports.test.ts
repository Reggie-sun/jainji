import { describe, expect, it } from "vitest";
import type { QianchuanAccountSummary, QianchuanProduct } from "../src/shared/qianchuan-account.js";
import { QianchuanReportSnapshotSchema, QIANCHUAN_REPORT_METRIC_PROVENANCE, type QianchuanReportSnapshot } from "../src/shared/qianchuan-report.js";
import type { QianguanjiaAccountDirectory } from "../src/shared/qianguanjia.js";
import {
  exportQianguanjiaAccountReportsCsv,
  latestAccountReport,
  qianguanjiaReportTargets,
  validateAccountReport,
  type AccountReportRow,
  type AccountReportSnapshot,
  type AccountReportTarget,
} from "../src/shared/qianguanjia-account-reports.js";

const products: QianchuanProduct[] = ["蝴蝶贴", "氨糖膏", "滴耳康", "眼贴", "肥皂", "热敷贴"];
const accounts = (overrides: Partial<QianchuanAccountSummary>[] = []): QianchuanAccountSummary[] => products.map((product, index) => ({
  product,
  productName: `产品${index + 1}`,
  advertiserId: String(1000 + index),
  adId: String(2000 + index),
  available: true,
  ...overrides[index],
}));
const directory = (ids: string[]): QianguanjiaAccountDirectory => ({
  source: "qianguanjia", observedAt: "2026-10-16T01:00:00.000Z",
  accounts: ids.map(advertiserId => ({ advertiserId, name: "平台账户", authStatus: 0, authStatusDesc: "正常" })),
});
const target: AccountReportTarget = {
  key: "眼贴:1003", product: "眼贴", advertiserId: "1003", name: "眼贴专户",
  available: true, supplierListed: false,
};
const metric = (value: string, display = value) => ({ value, display });
const report = (patch: Record<string, unknown> = {}): AccountReportSnapshot => QianchuanReportSnapshotSchema.parse({
  version: 1, id: "b1111111-1111-4111-8111-111111111111", source: "qianchuan-browser",
  product: target.product, advertiserId: target.advertiserId, kind: "report",
  startTime: "2026-10-15 00:00:00", endTime: "2026-10-16 21:20:55",
  asOf: "2026-10-16T13:20:55.000Z", capturedAt: "2026-10-16T13:21:00.000Z", complete: true,
  metricProvenance: QIANCHUAN_REPORT_METRIC_PROVENANCE,
  metrics: {
    stat_cost_for_roi2: metric("1.25", "1.25 元"),
    total_pay_order_count_for_roi2: metric("2", "2 单"),
    total_pay_order_gmv_include_coupon_for_roi2: metric("3.50", "3.50 元"),
    total_prepay_and_pay_order_roi2: metric("4.5", "4.5"),
  },
  ...patch,
}) as AccountReportSnapshot;

describe("qianguanjia cross-account saved reports", () => {
  it("keeps every configured account when the supplier directory overlaps only one", () => {
    const configured = accounts([{ available: false, adId: "" }]);
    const targets = qianguanjiaReportTargets(configured, directory(["1000"]));

    expect(targets).toHaveLength(6);
    expect(targets.filter(item => item.supplierListed)).toHaveLength(1);
    expect(targets.filter(item => item.supplierListed === false)).toHaveLength(5);
    expect(targets[0]).toMatchObject({ advertiserId: "1000", available: false, supplierListed: true });
    expect(targets[0]?.blockedReason).toBeTruthy();
    expect(qianguanjiaReportTargets(configured).every(item => item.supplierListed === undefined)).toBe(true);
  });

  it("ignores empty saved IDs but rejects malformed IDs and duplicate slots or advertisers", () => {
    expect(qianguanjiaReportTargets([{ product: "眼贴", advertiserId: "", adId: "", available: false }])).toEqual([]);
    expect(() => qianguanjiaReportTargets([{ product: "眼贴", advertiserId: "01", adId: "2", available: true }])).toThrow();
    expect(() => qianguanjiaReportTargets([
      { product: "眼贴", advertiserId: "123", adId: "2", available: true },
      { product: "眼贴", advertiserId: "124", adId: "3", available: true },
    ])).toThrow();
    expect(() => qianguanjiaReportTargets([
      { product: "眼贴", advertiserId: "123", adId: "2", available: true },
      { product: "肥皂", advertiserId: "123", adId: "3", available: true },
    ])).toThrow();
  });

  it("validates exact identity and the full date window clipped to Beijing as-of time", () => {
    expect(validateAccountReport(report(), target, "2026-10-15", "2026-10-16").endTime).toBe("2026-10-16 21:20:55");
    expect(() => validateAccountReport(report({ advertiserId: "1999" }), target, "2026-10-15", "2026-10-16")).toThrow();
    expect(() => validateAccountReport(report({ product: "肥皂" }), target, "2026-10-15", "2026-10-16")).toThrow();
    expect(() => validateAccountReport(report({ endTime: "2026-10-16 20:20:55" }), target, "2026-10-15", "2026-10-16")).toThrow();
    expect(() => validateAccountReport(report(), target, "2026-10-15", "2026-10-14")).toThrow();
    expect(() => validateAccountReport(report(), target, "2026-09-01", "2026-10-16")).toThrow();
  });

  it("rejects an earlier-day intraday snapshot when requested through a later day", () => {
    const old = report({
      id: "c1111111-1111-4111-8111-111111111111",
      startTime: "2026-10-14 00:00:00", endTime: "2026-10-15 20:00:00",
      asOf: "2026-10-15T12:00:00.000Z", capturedAt: "2026-10-15T12:01:00.000Z",
    });
    expect(() => validateAccountReport(old, target, "2026-10-14", "2026-10-16")).toThrow();
    expect(latestAccountReport([old], target, "2026-10-14", "2026-10-16")).toBeUndefined();
  });

  it("selects the latest matching account report, ignores material and wrong-date snapshots", () => {
    const earlier = report({ id: "d1111111-1111-4111-8111-111111111111", capturedAt: "2026-10-16T12:00:00.000Z" });
    const later = report({ id: "e1111111-1111-4111-8111-111111111111", capturedAt: "2026-10-16T13:30:00.000Z" });
    const wrongDate = report({
      id: "f1111111-1111-4111-8111-111111111111",
      startTime: "2026-10-14 00:00:00", endTime: "2026-10-16 20:00:00",
      asOf: "2026-10-16T12:00:00.000Z", capturedAt: "2026-10-16T14:00:00.000Z",
    });
    const { metrics: _metrics, ...earlierBase } = earlier;
    const materials = QianchuanReportSnapshotSchema.parse({
      ...earlierBase, id: "a1111111-1111-4111-8111-111111111111", kind: "materials",
      adId: "2003", rows: [], total: 0,
    }) as QianchuanReportSnapshot;
    expect(latestAccountReport([wrongDate, materials, earlier, later], target, "2026-10-15", "2026-10-16")?.id).toBe(later.id);
    expect(() => latestAccountReport([earlier, { malformed: true }], target, "2026-10-15", "2026-10-16")).toThrow();
    expect(() => latestAccountReport([earlier, report({ advertiserId: "1004" })], target, "2026-10-15", "2026-10-16")).toThrow();
  });

  it("exports one account row per target, preserves failures as blanks, and formula-protects platform display", () => {
    const safe = report({ metrics: {
      stat_cost_for_roi2: metric("1.25", "=HYPERLINK(\"x\")"),
      total_pay_order_count_for_roi2: metric("2", "2 单"),
      total_pay_order_gmv_include_coupon_for_roi2: metric("3.50", "3.50 元"),
      total_prepay_and_pay_order_roi2: metric("4.5", "4.5"),
    } });
    const failedTarget = { ...target, key: "滴耳康:2003", product: "滴耳康" as const, advertiserId: "2003", available: false };
    const missingTarget = { ...target, key: "肥皂:2004", product: "肥皂" as const, advertiserId: "2004" };
    const rows: AccountReportRow[] = [
      { target, status: "complete", snapshot: safe },
      { target: failedTarget, status: "failed", note: "local path must not be exported" },
      { target: missingTarget, status: "missing" },
    ];
    const csv = exportQianguanjiaAccountReportsCsv(rows, "2026-10-15", "2026-10-16");
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("2026-10-15 00:00:00");
    expect(lines[1]).toContain("2026-10-16 21:20:55");
    expect(lines[1]).toContain("2026-10-16T13:20:55.000Z");
    expect(lines[1]).toContain("2026-10-16T13:21:00.000Z");
    expect(lines[1]).toContain("\"'=HYPERLINK");
    expect(lines[2]).toContain('"failed"');
    expect(lines[2]).not.toContain("local path");
    expect(lines[2]).not.toContain('"0"');
    expect(lines[2].endsWith('""')).toBe(true);
    expect(lines[3]).toContain('"missing"');
    expect(lines[3]).not.toContain('"0"');
    expect(lines[3].endsWith('""')).toBe(true);
  });

  it("rejects duplicate account identities and snapshots that do not match the selected period", () => {
    expect(() => exportQianguanjiaAccountReportsCsv([
      { target, status: "missing" },
      { target: { ...target, name: "alias" }, status: "missing" },
    ], "2026-10-15", "2026-10-16")).toThrow();
    expect(() => exportQianguanjiaAccountReportsCsv([
      { target, status: "complete", snapshot: report({ endTime: "2026-10-16 20:20:55" }) },
    ], "2026-10-15", "2026-10-16")).toThrow();
    expect(() => exportQianguanjiaAccountReportsCsv([
      { target, status: "missing" },
      { target: { ...target, key: "蝴蝶贴:1003", product: "蝴蝶贴" }, status: "missing" },
    ], "2026-10-15", "2026-10-16")).toThrow();
  });
});
