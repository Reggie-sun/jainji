import { expect, it } from "vitest";
import { collectMaterialEffects } from "../src/renderer/qianchuan-effect-read";
import type { QianchuanBackendQuery, QianchuanBackendResult } from "../src/shared/qianchuan-backend";
const input = { product: "眼贴", expectedAdvertiserId: "1879999999999999999", adId: "1878754135410692", startDate: "2026-10-15", endDate: "2026-10-15", asOf: "2026-10-15T01:00:00Z" };
const controller = () => new AbortController();
function page(query: QianchuanBackendQuery, total = 229): QianchuanBackendResult {
  if (query.kind !== "materials") throw new Error();
  return { kind: "materials", advertiserId: query.expectedAdvertiserId, adId: query.adId, observedAt: input.asOf,
    startTime: "2026-10-15 00:00:00", endTime: "2026-10-15 09:00:00", offset: query.offset, limit: query.limit, total,
    rows: Array.from({ length: Math.min(query.limit, Math.max(0, total - query.offset)) }, (_, i) => ({ materialId: String(7696527003390771254n + BigInt(query.offset + i)), videoId: `video-${query.offset + i}`, name: "same.mp4", metrics: {} as any })) };
}
it("collects all pages with a single frozen cutoff and exact material IDs", async () => {
  const calls: QianchuanBackendQuery[] = [];
  const result = await collectMaterialEffects(input, async q => { calls.push(q); return page(q); }, controller().signal);
  expect(result.rows).toHaveLength(229); expect(result.rows[0]!.materialId).toBe("7696527003390771254");
  expect(calls.map(q => q.kind === "materials" && q.offset)).toEqual([0, 100, 200]);
  expect(calls.every(q => q.kind !== "plan" && q.asOf === input.asOf)).toBe(true);
});
it.each(["identity", "total", "time", "duplicate", "limit"])("rejects %s drift without publishing a partial snapshot", async mode => {
  let calls = 0;
  await expect(collectMaterialEffects(input, async q => {
    const r = page(q); if (r.kind !== "materials") throw new Error();
    if (++calls === 2) {
      if (mode === "identity") r.advertiserId = "999";
      if (mode === "total") r.total++;
      if (mode === "time") r.endTime = "2026-10-15 10:00:00";
      if (mode === "duplicate") r.rows[0]!.materialId = "7696527003390771254";
      if (mode === "limit") r.total = 2001;
    }
    return r;
  }, controller().signal)).rejects.toThrow(); expect(calls).toBe(2);
});
it("cancelled in-flight observation never starts the next page", async () => {
  const c = controller(); let calls = 0;
  await expect(collectMaterialEffects(input, async q => { calls++; c.abort(); return page(q); }, c.signal)).rejects.toThrow();
  expect(calls).toBe(1);
});
it("represents a verified empty filter without inferring upload results", async () => {
  const result = await collectMaterialEffects(input, async q => page(q, 0), controller().signal);
  expect(result.total).toBe(0); expect(result.rows).toEqual([]);
});
