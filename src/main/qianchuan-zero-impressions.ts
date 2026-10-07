import { z } from "zod";

export interface ZeroImpressionsWindow { startTime: string; endTime: string; }
export interface ZeroImpressionsRow { id: string; impressions: number; eligible: boolean; }
const hour = 60 * 60 * 1000;
const chinaTime = (time: number) => new Date(time + 8 * hour).toISOString().slice(0, 19).replace("T", " ");

export function createZeroImpressionsWindow(now = Date.now()): ZeroImpressionsWindow {
  const today = chinaTime(now).slice(0, 10);
  const midnight = Date.parse(`${today}T00:00:00+08:00`);
  return { startTime: chinaTime(midnight - 30 * 24 * hour), endTime: chinaTime(midnight - 1000) };
}

const rowSchema = z.object({
  dimensions: z.object({ materialId: z.object({ value: z.string().regex(/^[1-9][0-9]{0,19}$/) }) }),
  metrics: z.object({ productShowCountForRoi2: z.object({ value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), valueStr: z.string().min(1) }) }),
});

/** Eligibility uses the verified period metric only; material age is not a filter. */
export function parseZeroImpressionsRow(input: unknown): ZeroImpressionsRow {
  const value = rowSchema.safeParse(input);
  if (!value.success) throw new Error("素材ID或展示次数缺失，已停止删除。");
  const { dimensions, metrics } = value.data;
  const metric = metrics.productShowCountForRoi2;
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(metric.valueStr) || Number(metric.valueStr.replaceAll(",", "")) !== metric.value) {
    throw new Error("素材展示次数无法核对，已停止删除。");
  }
  return { id: dimensions.materialId.value, impressions: metric.value, eligible: metric.value === 0 };
}
