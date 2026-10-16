import { expect, it, vi } from "vitest";
import { QIANCHUAN_QUERY_METRICS, type QianchuanBackendQuery, type QianchuanBackendResult, type QianchuanQueryMetrics } from "../src/shared/qianchuan-backend.js";
import { captureQianchuanReport } from "../src/main/qianchuan-report-capture.js";

const fixedNow = new Date("2026-10-15T01:00:00.000Z");
const input = { product: "眼贴", expectedAdvertiserId: "1879999999999999999", requestId: "08b94db4-2684-42b0-8a38-2cce443c0778", kind: "materials" as const,
  adId: "1878754135410692", startDate: "2026-10-15", endDate: "2026-10-15" };
const reportInput = { product: input.product, expectedAdvertiserId: input.expectedAdvertiserId, requestId: input.requestId,
  kind: "report" as const, startDate: input.startDate, endDate: input.endDate };
const metrics = Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, { value: "123.4500", display: "¥123.45" }])) as QianchuanQueryMetrics;
function page(query: QianchuanBackendQuery, total = 229): QianchuanBackendResult {
  if (query.kind !== "materials") throw new Error("expected material query");
  const current = new Date(Date.parse(query.asOf ?? fixedNow.toISOString()) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
  return { kind: "materials", advertiserId: query.expectedAdvertiserId, observedAt: fixedNow.toISOString(), adId: query.adId,
    startTime: `${query.startDate} 00:00:00`, endTime: [`${query.endDate} 23:59:59`, current].sort()[0]!, offset: query.offset, limit: query.limit, total,
    rows: Array.from({ length: Math.min(query.limit, Math.max(0, total - query.offset)) }, (_, i) => ({
      materialId: String(7696527003390771254n + BigInt(query.offset + i)), videoId: `video-${query.offset + i}`, name: "same.mp4", metrics,
    })) };
}
function report(query: QianchuanBackendQuery): QianchuanBackendResult {
  if (query.kind !== "report") throw new Error("expected report query");
  const current = new Date(Date.parse(query.asOf ?? fixedNow.toISOString()) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
  return { kind: "report", advertiserId: query.expectedAdvertiserId, observedAt: fixedNow.toISOString(),
    startTime: `${query.startDate} 00:00:00`, endTime: [`${query.endDate} 23:59:59`, current].sort()[0]!, metrics };
}

it("captures a report with an exact frozen window and platform metric provenance", async () => {
  const calls: QianchuanBackendQuery[] = [];
  const result = await captureQianchuanReport(reportInput, async query => { calls.push(query); return report(query); }, new AbortController().signal, fixedNow);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ kind: "report", asOf: fixedNow.toISOString(), requestId: input.requestId });
  expect(result).toMatchObject({ kind: "report", complete: true, startTime: "2026-10-15 00:00:00", endTime: "2026-10-15 09:00:00", asOf: fixedNow.toISOString(), metrics: { stat_cost_for_roi2: { value: "123.4500", display: "¥123.45" } }, metricProvenance: { stat_cost_for_roi2: { source: "platform-reported", unit: "unknown", definition: "platform-reported" } } });
  expect(result).not.toHaveProperty("adId");
});

it("collects all pages with one frozen query identity and preserves large string IDs", async () => {
  const calls: QianchuanBackendQuery[] = [];
  const result = await captureQianchuanReport(input, async query => { calls.push(query); return page(query); }, new AbortController().signal, fixedNow);
  expect(result.kind).toBe("materials");
  if (result.kind !== "materials") throw new Error("expected material snapshot");
  expect(result.rows).toHaveLength(229);
  expect(result.rows[0]!.materialId).toBe("7696527003390771254");
  expect(calls.map(query => query.kind === "materials" ? query.offset : -1)).toEqual([0, 100, 200]);
  expect(calls.every(query => query.kind === "materials" && query.asOf === fixedNow.toISOString() && query.requestId === input.requestId)).toBe(true);
});
it('carries existing-only browser access through every material page without persisting runtime control',async()=>{
 const calls:QianchuanBackendQuery[]=[];
 const result=await captureQianchuanReport({...input,browserAccess:'existing-only'},async q=>{calls.push(q);return page(q);},new AbortController().signal,fixedNow);
 expect(calls).toHaveLength(3);expect(calls.every(q=>q.browserAccess==='existing-only')).toBe(true);
 expect(result).not.toHaveProperty('browserAccess');
});
it('retains existing-only access for account report and rejects unsupported control before reading',async()=>{
 const calls:QianchuanBackendQuery[]=[];
 await captureQianchuanReport({...reportInput,browserAccess:'existing-only'},async q=>{calls.push(q);return report(q);},new AbortController().signal,fixedNow);
 expect(calls[0]!.browserAccess).toBe('existing-only');
 let read=0;await expect(captureQianchuanReport({...input,browserAccess:'launch'},async q=>{read++;return page(q);},new AbortController().signal,fixedNow)).rejects.toThrow();expect(read).toBe(0);
});

it.each(["identity", "kind", "window", "total", "offset", "limit", "missing", "duplicate", "metric"])("rejects %s drift without returning partial rows", async defect => {
  let calls = 0;
  await expect(captureQianchuanReport(input, async query => {
    const result = page(query);
    if (result.kind !== "materials") throw new Error();
    if (++calls === 2) {
      if (defect === "identity") result.advertiserId = "999";
      if (defect === "kind") (result as { kind: "materials" | "report" }).kind = "report";
      if (defect === "window") result.endTime = "2026-10-15 10:00:00";
      if (defect === "total") result.total++;
      if (defect === "offset") result.offset = 0;
      if (defect === "limit") result.limit = 50;
      if (defect === "missing") result.rows.pop();
      if (defect === "duplicate") result.rows[0]!.materialId = "7696527003390771254";
      if (defect === "metric") result.rows[0]!.metrics = { ...metrics, stat_cost_for_roi2: { value: "1e3", display: "1000" } } as typeof metrics;
    }
    return result;
  }, new AbortController().signal, fixedNow)).rejects.toThrow();
  expect(calls).toBe(2);
});

it("accepts the 2000 row ceiling and refuses 2001 before paging further", async () => {
  let calls = 0;
  const result = await captureQianchuanReport(input, async query => { calls++; return page(query, 2000); }, new AbortController().signal, fixedNow);
  expect(result.kind).toBe("materials");
  expect(calls).toBe(20);
  calls = 0;
  await expect(captureQianchuanReport(input, async query => { calls++; return page(query, 2001); }, new AbortController().signal, fixedNow)).rejects.toThrow();
  expect(calls).toBe(1);
});

it("rejects stale cancellation and never accepts a late response", async () => {
  const controller = new AbortController();
  let finish!: (value: QianchuanBackendResult) => void;
  let calls = 0;
  const pending = captureQianchuanReport(input, async query => {
    calls++;
    const result = new Promise<QianchuanBackendResult>(resolve => { finish = resolve; });
    controller.abort();
    return result;
  }, controller.signal, fixedNow);
  await expect(pending).rejects.toThrow();
  finish(page({ ...input, ...{ offset: 0, limit: 100, kind: "materials", asOf: fixedNow.toISOString() } } as QianchuanBackendQuery));
  expect(calls).toBe(1);
});

it("enforces the 180 second deadline for an in-flight backend read", async () => {
  vi.useFakeTimers();
  try {
    const pending = captureQianchuanReport(reportInput, async () => new Promise<QianchuanBackendResult>(resolve => {
      setTimeout(() => resolve(report({ ...reportInput, asOf: fixedNow.toISOString() } as QianchuanBackendQuery)), 181_000);
    }), new AbortController().signal, fixedNow);
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(180_001);
    await rejected;
  } finally { vi.useRealTimers(); }
});

it("rejects date windows outside the existing 31 day boundary before reading", async () => {
  let calls = 0;
  await expect(captureQianchuanReport({ ...input, startDate: "2026-09-14" }, async query => { calls++; return page(query); }, new AbortController().signal, fixedNow)).rejects.toThrow();
  expect(calls).toBe(0);
});

it("accepts a 31 calendar day window", async () => {
  const result = await captureQianchuanReport({ ...input, startDate: "2026-09-15" }, async query => page(query, 0), new AbortController().signal, fixedNow);
  expect(result.startTime).toBe("2026-09-15 00:00:00");
  expect(result.endTime).toBe("2026-10-15 09:00:00");
});
