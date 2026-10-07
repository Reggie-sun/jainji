import { expect, it } from "vitest";
import { createZeroImpressionsWindow, parseZeroImpressionsRow } from "../src/main/qianchuan-zero-impressions";
import { QianchuanLibraryClearSchema } from "../src/shared/qianchuan-video-library";

const now = Date.parse("2026-10-07T16:00:00+08:00");
const window = { startTime: "2026-09-30 00:00:00", endTime: "2026-10-06 23:59:59", createdBefore: "2026-10-05 16:00:00" };
const row = (count: unknown = 0, time: unknown = "2026-10-05 16:00:00", display: unknown = "0") => ({
  dimensions: { materialId: { value: "123" }, roi2MaterialUploadTime: { value: time } },
  metrics: { productShowCountForRoi2: { value: count, valueStr: display } },
});
it("admits explicit plan-bound zero-impression cleanup but never combines it with account library clearing", () => {
  const request = { confirmation: "DELETE_PLAN_MATERIALS", planMaterialRule: "ZERO_IMPRESSIONS_7D", accounts: [{ product: "眼贴", expectedAdvertiserId: "1234", expectedAdId: "5678" }] };
  expect(QianchuanLibraryClearSchema.safeParse(request).success).toBe(true);
  for (const confirmation of ["DELETE_ALL_VIDEOS", "DELETE_VIDEOS_AND_PLAN_MATERIALS"]) expect(QianchuanLibraryClearSchema.safeParse({ ...request, confirmation }).success).toBe(false);
  expect(QianchuanLibraryClearSchema.safeParse({ ...request, planMaterialRule: "ZERO_PLAY" }).success).toBe(false);
  expect(QianchuanLibraryClearSchema.safeParse({ ...request, accounts: [{ product: "眼贴", expectedAdvertiserId: "1234" }] }).success).toBe(false);
});
it("admits both selected plan rules but forbids mixing them with the whole video library", () => {
  const request = { confirmation: "DELETE_PLAN_MATERIALS", planMaterialRule: "AUDIT_AND_ZERO_IMPRESSIONS_7D", accounts: [{ product: "眼贴", expectedAdvertiserId: "1234", expectedAdId: "5678" }] };
  expect(QianchuanLibraryClearSchema.safeParse(request).success).toBe(true);
  for (const confirmation of ["DELETE_ALL_VIDEOS", "DELETE_VIDEOS_AND_PLAN_MATERIALS"]) expect(QianchuanLibraryClearSchema.safeParse({ ...request, confirmation }).success).toBe(false);
});
it("freezes seven complete China dates and a precise 48 hour cutoff independently of host timezone", () => {
  expect(createZeroImpressionsWindow(now)).toEqual(window);
  expect(createZeroImpressionsWindow(Date.parse("2027-01-01T00:00:00+08:00"))).toEqual({ startTime: "2026-12-25 00:00:00", endTime: "2026-12-31 23:59:59", createdBefore: "2026-12-30 00:00:00" });
});
it("protects new and nonzero rows and includes exactly the 48 hour boundary without an upper age limit", () => {
  expect(parseZeroImpressionsRow(row(), window).eligible).toBe(true);
  expect(parseZeroImpressionsRow(row(0, "2026-10-05 16:00:01"), window).eligible).toBe(false);
  expect(parseZeroImpressionsRow(row(0, "2025-01-01 00:00:00"), window).eligible).toBe(true);
  expect(parseZeroImpressionsRow(row(1, undefined, "1"), window).eligible).toBe(false);
});
it.each([null, undefined, "0", -1, NaN, 0.5])("rejects missing or ambiguous metric values %s", value => {
  const input = row(); input.metrics.productShowCountForRoi2.value = value;
  expect(() => parseZeroImpressionsRow(input, window)).toThrow();
});
it.each(["-", "", null, "1"])("does not treat an unavailable or inconsistent displayed zero as measured zero: %s", display => {
  expect(() => parseZeroImpressionsRow(row(0, undefined, display), window)).toThrow();
});
it.each(["-", "2026-02-30 00:00:00", "2026-10-05", "2026-10-05 24:00:00", "2026-10-05T16:00:00Z", null])("rejects ambiguous or normalized-invalid creation times %s", time => {
  expect(() => parseZeroImpressionsRow(row(0, time), window)).toThrow();
});
