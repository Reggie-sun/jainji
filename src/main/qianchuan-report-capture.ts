import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { QianchuanBackendQuerySchema, type QianchuanBackendQuery, type QianchuanBackendResult } from "../shared/qianchuan-backend.js";
import { collectMaterialEffects } from "../shared/qianchuan-effect-read.js";
import {
  QianchuanReportCaptureSchema,
  QianchuanReportMaterialSchema,
  QianchuanReportMetricsSchema,
  QianchuanReportSnapshotSchema,
  QIANCHUAN_REPORT_METRIC_PROVENANCE,
  type QianchuanReportCapture,
  type QianchuanReportSnapshot,
} from "../shared/qianchuan-report.js";

const MAX_ROWS = 2000;
const MAX_CAPTURE_MS = 180_000;
const id = z.string().regex(/^[1-9][0-9]{0,19}$/);
const observedAt = z.string().datetime();
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
const ReportResultSchema = z.object({
  kind: z.literal("report"), advertiserId: id, observedAt,
  startTime: localDateTime, endTime: localDateTime, metrics: QianchuanReportMetricsSchema,
}).strict();
const MaterialPageResultSchema = z.object({
  kind: z.literal("materials"), advertiserId: id, observedAt, adId: id,
  startTime: localDateTime, endTime: localDateTime,
  offset: z.number().int().min(0), limit: z.number().int().min(1), total: z.number().int().min(0),
  rows: z.array(QianchuanReportMaterialSchema),
}).strict();
type ReadBackend = (query: QianchuanBackendQuery) => Promise<QianchuanBackendResult>;

function expectedWindow(input: QianchuanReportCapture, asOf: string): { startTime: string; endTime: string } {
  const startTime = `${input.startDate} 00:00:00`;
  const current = new Date(Date.parse(asOf) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
  const endTime = [`${input.endDate} 23:59:59`, current].sort()[0]!;
  if (endTime < startTime) throw new Error("千川查询日期尚未开始，请选择当前或历史日期。");
  return { startTime, endTime };
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("千川报表采集已取消。");
  error.name = "AbortError";
  return error;
}

function readWithinBudget<T>(work: Promise<T>, signal: AbortSignal, remainingMs: number): Promise<T> {
  signal.throwIfAborted();
  if (remainingMs <= 0) return Promise.reject(new Error("千川报表采集超过 180 秒上限。"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => finish(() => reject(abortError(signal)));
    const timer = setTimeout(() => finish(() => reject(new Error("千川报表采集超过 180 秒上限。"))), remainingMs);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    work.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

/** Captures one complete, bounded report using only the existing fixed read query owner. */
export async function captureQianchuanReport(
  rawInput: unknown,
  read: ReadBackend,
  signal: AbortSignal,
  now: Date = new Date(),
): Promise<QianchuanReportSnapshot> {
  const input = QianchuanReportCaptureSchema.parse(rawInput);
  if (!Number.isFinite(now.getTime())) throw new Error("千川报表采集时间无效。");
  signal.throwIfAborted();
  const started = performance.now();
  const deadline = started + MAX_CAPTURE_MS;
  const asOf = now.toISOString();
  const window = expectedWindow(input, asOf);

  const request = async (query: QianchuanBackendQuery): Promise<QianchuanBackendResult> => {
    signal.throwIfAborted();
    const remaining = deadline - performance.now();
    const work = Promise.resolve().then(() => {
      signal.throwIfAborted();
      if (performance.now() > deadline) throw new Error("千川报表采集超过 180 秒上限。");
      return read(query);
    });
    const result = await readWithinBudget(work, signal, remaining);
    signal.throwIfAborted();
    if (performance.now() > deadline) throw new Error("千川报表采集超过 180 秒上限。");
    return result;
  };

  if (input.kind === "report") {
    const query = QianchuanBackendQuerySchema.parse({ ...input, kind: "report", asOf });
    const result = ReportResultSchema.parse(await request(query));
    if (result.advertiserId !== input.expectedAdvertiserId || result.startTime !== window.startTime || result.endTime !== window.endTime) {
      throw new Error("无法核对千川账户报表身份或统计窗口。");
    }
    signal.throwIfAborted();
    return QianchuanReportSnapshotSchema.parse({
      version: 1, id: randomUUID(), source: "qianchuan-browser", product: input.product,
      advertiserId: input.expectedAdvertiserId, kind: "report", ...window, asOf,
      capturedAt: new Date().toISOString(), complete: true, metrics: result.metrics,
      metricProvenance: QIANCHUAN_REPORT_METRIC_PROVENANCE,
    });
  }

  const materialInput = {
    product: input.product, expectedAdvertiserId: input.expectedAdvertiserId, adId: input.adId,
    startDate: input.startDate, endDate: input.endDate, asOf,
    ...(input.browserAccess ? { browserAccess: input.browserAccess } : {}),
  };
  const collected = await readWithinBudget(Promise.resolve().then(() => collectMaterialEffects(
    materialInput,
    async query => MaterialPageResultSchema.parse(await request(QianchuanBackendQuerySchema.parse({ ...query, requestId: input.requestId, asOf }))),
    signal,
  )), signal, deadline - performance.now());
  signal.throwIfAborted();
  if (performance.now() > deadline) throw new Error("千川报表采集超过 180 秒上限。");
  if (collected.advertiserId !== input.expectedAdvertiserId || collected.adId !== input.adId ||
    collected.startTime !== window.startTime || collected.endTime !== window.endTime ||
    !Number.isSafeInteger(collected.total) || collected.total < 0 || collected.total > MAX_ROWS || collected.rows.length !== collected.total) {
    throw new Error("无法核对完整素材目录、身份或统计窗口。");
  }
  return QianchuanReportSnapshotSchema.parse({
    version: 1, id: randomUUID(), source: "qianchuan-browser", product: input.product,
    advertiserId: input.expectedAdvertiserId, kind: "materials", adId: input.adId,
    ...window, asOf, capturedAt: new Date().toISOString(), complete: true,
    rows: collected.rows, total: collected.total, metricProvenance: QIANCHUAN_REPORT_METRIC_PROVENANCE,
  });
}
