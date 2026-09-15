import { z } from "zod";

export const CoverStickerIdSchema = z.string().regex(/^uploaded-[a-f0-9]{64}$/, "请选择自己上传的贴纸");
export const CoverRectangleSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().gt(0).max(1),
  height: z.number().finite().gt(0).max(1),
}).strict().refine((rect) => rect.x + rect.width <= 1 + 1e-9 && rect.y + rect.height <= 1 + 1e-9, "覆盖框必须完整位于画面内");
export const CoverKeyframeSchema = z.object({
  timeMs: z.number().int().nonnegative(),
  rectangle: CoverRectangleSchema,
}).strict();
export const CoverTrackSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  keyframes: z.array(CoverKeyframeSchema).min(1).max(50),
}).strict().superRefine((track, ctx) => {
  if (track.endMs <= track.startMs) ctx.addIssue({ code: "custom", message: "覆盖结束时间必须晚于开始时间" });
  const first = track.keyframes[0]?.rectangle;
  track.keyframes.forEach((frame, index) => {
    if (index > 0 && frame.timeMs <= track.keyframes[index - 1].timeMs) ctx.addIssue({ code: "custom", path: ["keyframes", index, "timeMs"], message: "关键帧时间必须递增且不能重复" });
    if (first) {
      const a = frame.rectangle.width * first.height, b = frame.rectangle.height * first.width;
      if (Math.abs(a - b) > 1e-6 * Math.max(a, b)) ctx.addIssue({ code: "custom", path: ["keyframes", index, "rectangle"], message: "轨迹缩放必须保持覆盖框比例" });
    }
  });
});
export const CoverStickerSchema = z.object({
  enabled: z.boolean(),
  stickerIds: z.array(CoverStickerIdSchema).max(50),
  rectangle: CoverRectangleSchema,
  tracks: z.record(z.string().uuid(), CoverTrackSchema).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && !value.stickerIds.length) ctx.addIssue({ code: "custom", path: ["stickerIds"], message: "请至少选择一张自己的贴纸" });
  if (new Set(value.stickerIds).size !== value.stickerIds.length) ctx.addIssue({ code: "custom", path: ["stickerIds"], message: "覆盖候选不得重复" });
});
export type CoverSticker = z.infer<typeof CoverStickerSchema>;
export type CoverRectangle = z.infer<typeof CoverRectangleSchema>;
export type CoverKeyframe = z.infer<typeof CoverKeyframeSchema>;
export type CoverTrack = z.infer<typeof CoverTrackSchema>;

export function coverTrackMediaIssue(tracks: CoverSticker["tracks"], media: readonly { id: string; durationMs: number }[]): string | undefined {
  for (const [id, track] of Object.entries(tracks ?? {})) {
    const source = media.find((item) => item.id === id);
    if (!source) return "覆盖轨迹对应的素材不存在，请重新设置。";
    if (track.endMs > source.durationMs || track.keyframes.some((frame) => frame.timeMs > source.durationMs)) return "覆盖轨迹时间超出素材时长，请调整关键帧和出现时段。";
  }
}

// Hold the nearest endpoint outside the keyed range; visibility is a separate interval.
export function interpolateCoverRectangle(keyframes: readonly CoverKeyframe[], timeMs: number): CoverRectangle {
  const next = keyframes.findIndex((frame) => frame.timeMs > timeMs);
  if (next === 0) return { ...keyframes[0].rectangle };
  if (next === -1) return { ...keyframes[keyframes.length - 1].rectangle };
  const a = keyframes[next - 1], b = keyframes[next];
  const amount = (timeMs - a.timeMs) / (b.timeMs - a.timeMs);
  return Object.fromEntries((["x", "y", "width", "height"] as const).map((key) => [key, a.rectangle[key] + (b.rectangle[key] - a.rectangle[key]) * amount])) as CoverRectangle;
}
export const DEFAULT_COVER_STICKER: CoverSticker = { enabled: false, stickerIds: [], rectangle: { x: 0.35, y: 0.4, width: 0.3, height: 0.2 } };
