import { z } from "zod";
import { isStickerId } from "./decorations.js";

const UploadedCoverStickerIdSchema = z.string().regex(/^uploaded-[a-f0-9]{64}$/, "请选择自己上传的贴纸");
export const CoverStickerIdSchema = z.string().refine((id) => isStickerId(id) && id !== "none" && id !== "template", "覆盖贴纸不可用");
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
export const MAX_MANUAL_COVERS = 64;
export const CoverRegionSchema = z.object({
  id: z.string().uuid(),
  rectangle: CoverRectangleSchema,
  stickerId: UploadedCoverStickerIdSchema.optional(),
  tracks: z.record(z.string().uuid(), CoverTrackSchema).optional(),
}).strict();
export type CoverRegion = z.infer<typeof CoverRegionSchema>;
export const CoverStickerSchema = z.object({
  enabled: z.boolean(),
  // Deprecated: the unified-cover pool is derived from all uploaded stickers at production time.
  // Kept so legacy project files keep parsing; production code no longer reads it.
  stickerIds: z.array(UploadedCoverStickerIdSchema).max(50),
  rectangle: CoverRectangleSchema,
  tracks: z.record(z.string().uuid(), CoverTrackSchema).optional(),
  trackingMode: z.enum(["manual", "agent", "assisted"]).optional(),
  regions: z.array(CoverRegionSchema).max(MAX_MANUAL_COVERS).optional(),
  mediaRegions: z.record(z.string().uuid(), z.array(CoverRegionSchema).max(MAX_MANUAL_COVERS)).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && (value.trackingMode ?? "manual") === "manual" && !value.mediaRegions && value.regions?.length === 0) ctx.addIssue({ code: "custom", path: ["regions"], message: "请至少添加一个覆盖框" });
  if (value.regions && new Set(value.regions.map((region) => region.id)).size !== value.regions.length) ctx.addIssue({ code: "custom", path: ["regions"], message: "覆盖框编号不得重复" });
  for (const [mediaId, regions] of Object.entries(value.mediaRegions ?? {})) {
    if (new Set(regions.map((region) => region.id)).size !== regions.length) ctx.addIssue({ code: "custom", path: ["mediaRegions", mediaId], message: "覆盖框编号不得重复" });
  }
  if (new Set(value.stickerIds).size !== value.stickerIds.length) ctx.addIssue({ code: "custom", path: ["stickerIds"], message: "覆盖候选不得重复" });
});
export type CoverSticker = z.infer<typeof CoverStickerSchema>;
export type CoverRectangle = z.infer<typeof CoverRectangleSchema>;
export type CoverKeyframe = z.infer<typeof CoverKeyframeSchema>;
export type CoverTrack = z.infer<typeof CoverTrackSchema>;

export const DEFAULT_COVER_RECTANGLE: CoverRectangle = { x: 0.35, y: 0.4, width: 0.3, height: 0.2 };

// Old projects have a single rectangle; explicit regions become the sole manual layout.
// That legacy box only counts when it carries user signal (keyframe tracks or a non-default
// position): every saved project persists the factory-default rectangle even when the user
// never configured manual cover, and that vestigial value must not turn into a white cover.
export function hasLegacyCoverBox(settings: CoverSticker): boolean {
  if (Object.keys(settings.tracks ?? {}).length) return true;
  const { x, y, width, height } = settings.rectangle;
  return x !== DEFAULT_COVER_RECTANGLE.x || y !== DEFAULT_COVER_RECTANGLE.y || width !== DEFAULT_COVER_RECTANGLE.width || height !== DEFAULT_COVER_RECTANGLE.height;
}

export function manualCoverRegions(settings: CoverSticker, mediaId?: string): CoverRegion[] {
  if (mediaId && settings.mediaRegions?.[mediaId]) return settings.mediaRegions[mediaId];
  return settings.regions ?? (hasLegacyCoverBox(settings) ? [{ id: "00000000-0000-4000-8000-000000000001", rectangle: settings.rectangle, tracks: settings.tracks }] : []);
}

export function coverSettingsMediaIssue(settings: CoverSticker | undefined, media: readonly { id: string; durationMs: number }[]): string | undefined {
  for (const region of settings ? manualCoverRegions(settings) : []) {
    const issue = coverTrackMediaIssue(region.tracks, media);
    if (issue) return issue;
  }
  for (const [mediaId, regions] of Object.entries(settings?.mediaRegions ?? {})) {
    const source = media.find((item) => item.id === mediaId);
    if (!source) return "覆盖框对应的素材不存在，请重新设置。";
    for (const region of regions) {
      const issue = coverTrackMediaIssue(region.tracks, [source]);
      if (issue) return issue;
    }
  }
}

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
export const DEFAULT_COVER_STICKER: CoverSticker = { enabled: false, stickerIds: [], rectangle: { ...DEFAULT_COVER_RECTANGLE }, trackingMode: "agent" };
