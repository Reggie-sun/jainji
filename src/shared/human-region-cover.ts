import { z } from "zod";
import { CoverRectangleSchema } from "./cover-sticker.js";
import { SourceIdentitySchema } from "./source-sticker-knowledge.js";
import { ExportSettingsSchema } from "./export-settings.js";

const Pixel = z.number().int().nonnegative().safe();
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Size = z.object({ width: Pixel.positive(), height: Pixel.positive() }).strict();
export const HumanPixelBoxSchema = Size.extend({ x: Pixel, y: Pixel }).strict();
/** User intent and frozen pixels, never automatic source alpha or an H4 approval. */
export const HumanRegionBindingSchema = z.object({
  kind: z.literal("human-region-v1"), projectId: z.string().uuid(), draftId: z.string().uuid(), revision: Pixel,
  admission: z.literal("manual-production-v1").optional(),
  mediaId: z.string().uuid(), segmentId: z.string().uuid(), identityId: z.string().uuid(),
  source: SourceIdentitySchema, settings: ExportSettingsSchema, container: z.enum(["mp4", "mov", "mkv"]),
  rectangle: CoverRectangleSchema, target: HumanPixelBoxSchema,
  projection: Size.extend({ scaledWidth: Pixel.positive(), scaledHeight: Pixel.positive(), padLeft: Pixel, padTop: Pixel }).strict(),
  placement: Size.extend({ x: z.number().int().safe(), y: z.number().int().safe() }).strict(), visualBounds: HumanPixelBoxSchema,
  range: z.object({ startMs: Pixel, endMs: Pixel.positive() }).strict(),
  artwork: z.object({ id: z.string().min(1), assetPath: z.string().min(1), assetFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
  pngSha256: Digest, rgbaSha256: Digest, bindingDigest: Digest,
}).strict().superRefine((value, ctx) => {
  if (value.range.endMs <= value.range.startMs || value.range.endMs > value.source.durationMs) ctx.addIssue({ code: "custom", message: "人工覆盖时段无效" });
  if (value.projection.width * value.projection.height > 16_777_216) ctx.addIssue({ code: "custom", message: "人工覆盖输出尺寸超限" });
  for (const box of [value.target, value.visualBounds]) if (box.x + box.width > value.projection.width || box.y + box.height > value.projection.height) ctx.addIssue({ code: "custom", message: "人工覆盖像素范围越界" });
});
export type HumanRegionBinding = z.infer<typeof HumanRegionBindingSchema>;
export type HumanPixelBox = z.infer<typeof HumanPixelBoxSchema>;
