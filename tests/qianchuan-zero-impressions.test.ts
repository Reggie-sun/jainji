import { expect, it } from "vitest";
import { createZeroImpressionsWindow, parseZeroImpressionsRow } from "../src/main/qianchuan-zero-impressions";
import { QianchuanLibraryClearSchema } from "../src/shared/qianchuan-video-library";

const now = Date.parse("2026-10-08T16:00:00+08:00");
const window = { startTime: "2026-09-23 00:00:00", endTime: "2026-10-07 23:59:59" };
const row = (count: unknown = 0, time: unknown = "2026-10-05 16:00:00", display: unknown = "0") => ({
  dimensions: { materialId: { value: "123" }, roi2MaterialUploadTime: { value: time } },
  metrics: { productShowCountForRoi2: { value: count, valueStr: display } },
});
it("admits plan-bound zero-impression cleanup with independently selected library clearing", () => {
  const request = { confirmation: "DELETE_PLAN_MATERIALS", planMaterialRule: "ZERO_IMPRESSIONS_15D", accounts: [{ product: "眼贴", expectedAdvertiserId: "1234", expectedAdId: "5678" }] };
  expect(QianchuanLibraryClearSchema.safeParse(request).success).toBe(true);
  expect(QianchuanLibraryClearSchema.safeParse({ ...request, confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS" }).success).toBe(true);
  expect(QianchuanLibraryClearSchema.safeParse({ ...request, confirmation: "DELETE_ALL_VIDEOS" }).success).toBe(false);
  expect(QianchuanLibraryClearSchema.safeParse({ ...request, confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1234" }] }).success).toBe(false);
  expect(QianchuanLibraryClearSchema.safeParse({ ...request, planMaterialRule: "ZERO_PLAY" }).success).toBe(false);
  expect(QianchuanLibraryClearSchema.safeParse({ ...request, accounts: [{ product: "眼贴", expectedAdvertiserId: "1234" }] }).success).toBe(false);
});
it("admits both plan rules with independently selected library clearing", () => {
  const request = { confirmation: "DELETE_PLAN_MATERIALS", planMaterialRule: "AUDIT_AND_ZERO_IMPRESSIONS_15D", accounts: [{ product: "眼贴", expectedAdvertiserId: "1234", expectedAdId: "5678" }] };
  expect(QianchuanLibraryClearSchema.safeParse(request).success).toBe(true);
  expect(QianchuanLibraryClearSchema.safeParse({ ...request, confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS" }).success).toBe(true);
  expect(QianchuanLibraryClearSchema.safeParse({ ...request, confirmation: "DELETE_ALL_VIDEOS" }).success).toBe(false);
  expect(QianchuanLibraryClearSchema.safeParse({ ...request, confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1234" }] }).success).toBe(false);
});
it("freezes fifteen complete China dates independently of host timezone", () => {
  expect(createZeroImpressionsWindow(now)).toEqual(window);
  expect(createZeroImpressionsWindow(Date.parse("2027-01-01T00:00:00+08:00"))).toEqual({ startTime: "2026-12-17 00:00:00", endTime: "2026-12-31 23:59:59" });
  expect(createZeroImpressionsWindow(Date.parse("2024-03-01T00:00:00+08:00"))).toEqual({ startTime: "2024-02-15 00:00:00", endTime: "2024-02-29 23:59:59" });
});
it("deletes recent zero-impression rows regardless of age but preserves nonzero rows", () => {
  expect(parseZeroImpressionsRow(row()).eligible).toBe(true);
  expect(parseZeroImpressionsRow(row(0, "2026-10-08 15:59:59")).eligible).toBe(true);
  expect(parseZeroImpressionsRow(row(0, "2025-01-01 00:00:00")).eligible).toBe(true);
  expect(parseZeroImpressionsRow(row(1, undefined, "1")).eligible).toBe(false);
});
it.each([null, undefined, "0", -1, NaN, 0.5])("rejects missing or ambiguous metric values %s", value => {
  const input = row(); input.metrics.productShowCountForRoi2.value = value;
  expect(() => parseZeroImpressionsRow(input)).toThrow();
});
it.each(["-", "", null, "1"])("does not treat an unavailable or inconsistent displayed zero as measured zero: %s", display => {
  expect(() => parseZeroImpressionsRow(row(0, undefined, display))).toThrow();
});
it.each(["-", "2026-02-30 00:00:00", "2026-10-05", "2026-10-05 24:00:00", "2026-10-05T16:00:00Z", null])("ignores unused creation times %s", time => {
  expect(parseZeroImpressionsRow(row(0, time)).eligible).toBe(true);
});

it("accepts zero impressions without creation time and rejects legacy seven-day and thirty-day authorization", () => {
  expect(parseZeroImpressionsRow({ dimensions: { materialId: { value: "123" } }, metrics: row().metrics }).eligible).toBe(true);
  for (const planMaterialRule of ["ZERO_IMPRESSIONS_7D", "AUDIT_AND_ZERO_IMPRESSIONS_7D", "ZERO_IMPRESSIONS_30D", "AUDIT_AND_ZERO_IMPRESSIONS_30D"]) expect(QianchuanLibraryClearSchema.safeParse({ confirmation: "DELETE_PLAN_MATERIALS", planMaterialRule, accounts: [{ product: "眼贴", expectedAdvertiserId: "1234", expectedAdId: "5678" }] }).success).toBe(false);
});
