import { QianchuanBackendQuerySchema, type QianchuanBackendQuery, type QianchuanBackendResult } from "../shared/qianchuan-backend";

export type QianchuanEffectSnapshot = Extract<QianchuanBackendResult, { kind: "materials" }>;
type Input = { product: string; expectedAdvertiserId: string; adId: string; startDate: string; endDate: string; asOf: string };

/** Bounded observations over the existing query owner. No upload, mutation, retries or durable jobs. */
export async function collectMaterialEffects(input: Input, read: (query: QianchuanBackendQuery) => Promise<QianchuanBackendResult>, signal: AbortSignal): Promise<QianchuanEffectSnapshot> {
  let first: QianchuanEffectSnapshot | undefined;
  const rows: QianchuanEffectSnapshot["rows"] = [], ids = new Set<string>();
  const expectedStart = `${input.startDate} 00:00:00`;
  const expectedEnd = [`${input.endDate} 23:59:59`, new Date(Date.parse(input.asOf) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ")].sort()[0];
  for (let offset = 0; offset < 2000; offset += 100) {
    signal.throwIfAborted();
    const query = QianchuanBackendQuerySchema.parse({ ...input, kind: "materials", offset, limit: 100, requestId: crypto.randomUUID() });
    const next = await read(query);
    signal.throwIfAborted();
    if (next.kind !== "materials" || next.advertiserId !== input.expectedAdvertiserId || next.adId !== input.adId || next.offset !== offset || next.limit !== 100 ||
      next.startTime !== expectedStart || next.endTime !== expectedEnd ||
      !Number.isSafeInteger(next.total) || next.total < 0 || next.total > 2000 || next.rows.length !== Math.min(100, Math.max(0, next.total - offset))) throw new Error("无法核对完整素材目录或超出2000条采集上限。");
    if (first && (next.total !== first.total || next.startTime !== first.startTime || next.endTime !== first.endTime)) throw new Error("素材目录或统计范围已变化，请重新采集。");
    first ??= next;
    for (const row of next.rows) {
      if (!/^[1-9]\d{0,19}$/.test(row.materialId) || ids.has(row.materialId)) throw new Error("素材身份重复或无效。");
      ids.add(row.materialId); rows.push(row);
    }
    if (rows.length === first.total) return { ...first, rows };
  }
  throw new Error("素材采集未完成。");
}
