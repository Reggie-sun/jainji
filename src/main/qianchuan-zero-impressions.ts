import { z } from "zod";

export interface ZeroImpressionsWindow { startTime: string; endTime: string; createdBefore: string; }
export interface ZeroImpressionsRow { id: string; impressions: number; createdAt: string; eligible: boolean; }
const hour = 60 * 60 * 1000;
const chinaTime = (time: number) => new Date(time + 8 * hour).toISOString().slice(0, 19).replace("T", " ");

export function createZeroImpressionsWindow(now = Date.now()): ZeroImpressionsWindow {
  const today = chinaTime(now).slice(0, 10);
  const midnight = Date.parse(`${today}T00:00:00+08:00`);
  return { startTime: chinaTime(midnight - 15 * 24 * hour), endTime: chinaTime(midnight - 1000), createdBefore: chinaTime(now - 15 * 24 * hour) };
}

function parseChinaTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) throw new Error("素材创建时间无法核对，已停止删除。");
  const time = Date.parse(value.replace(" ", "T") + "+08:00");
  if (!Number.isFinite(time) || chinaTime(time) !== value) throw new Error("素材创建时间无法核对，已停止删除。");
  return time;
}

const rowSchema = z.object({
  dimensions: z.object({ materialId: z.object({ value: z.string().regex(/^[1-9][0-9]{0,19}$/) }), roi2MaterialUploadTime: z.object({ value: z.string() }) }),
  metrics: z.object({ productShowCountForRoi2: z.object({ value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), valueStr: z.string().min(1) }) }),
});

/** Plan creation time is the first addition to this plan, not the video-library upload date. */
export function parseZeroImpressionsRow(input: unknown, window: ZeroImpressionsWindow): ZeroImpressionsRow {
  const value = rowSchema.safeParse(input);
  if (!value.success) throw new Error("素材ID、展示次数或创建时间缺失，已停止删除。");
  const { dimensions, metrics } = value.data;
  const metric = metrics.productShowCountForRoi2;
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(metric.valueStr) || Number(metric.valueStr.replaceAll(",", "")) !== metric.value) {
    throw new Error("素材展示次数无法核对，已停止删除。");
  }
  const createdAt = dimensions.roi2MaterialUploadTime.value;
  const oldEnough = parseChinaTime(createdAt) <= parseChinaTime(window.createdBefore);
  return { id: dimensions.materialId.value, impressions: metric.value, createdAt, eligible: metric.value === 0 && oldEnough };
}
