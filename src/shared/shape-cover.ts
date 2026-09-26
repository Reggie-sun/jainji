import { z } from "zod";
import { ExportSettingsSchema } from "./export-settings.js";
import { ReviewedRangeSchema, SourceIdentitySchema } from "./source-sticker-knowledge.js";
import { CoverStickerIdSchema } from "./cover-sticker.js";

export const SHAPE_COVER_ALPHA_VERSION = "ffmpeg-bicubic-contain-rgba-v1";
export const MAX_SHAPE_COVER_PIXELS = 16_777_216;
export const MAX_FROZEN_SHAPE_BYTES = MAX_SHAPE_COVER_PIXELS * 4 + 1024 * 1024;
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const Pixel = z.number().int().nonnegative().safe();
const Size = z.object({ width: Pixel.positive(), height: Pixel.positive() }).strict();

export const FrozenShapeCoverBindingSchema = z.object({
  strategy: z.literal("shape-matched-frozen-rgba-v1"),
  verification: z.literal("geometry-only"),
  contentSafety: z.literal("NOT_EVALUATED"),
  intendedTargetId: Id, targetId: Id, segmentId: Id,
  source: SourceIdentitySchema, sourceRevisionId: Id, factsDigest: Digest, maskSha256: Digest,
  range: ReviewedRangeSchema,
  candidateId: CoverStickerIdSchema, candidateAssetFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  outputSettingId: Id, settings: ExportSettingsSchema,
  projection: Size.extend({ scaledWidth: Pixel.positive(), scaledHeight: Pixel.positive(), padLeft: Pixel, padTop: Pixel }).strict(),
  placement: Size.extend({ x: Pixel, y: Pixel }).strict(),
  pixelContractVersion: z.literal(1), rasterVersion: z.literal(SHAPE_COVER_ALPHA_VERSION),
  radiusPx: Pixel.max(64), candidateAlphaSha256: Digest,
  rgbaSha256: Digest, finalAlphaSha256: Digest, pngSha256: Digest,
}).strict();
export const FrozenShapeCoverSchema = FrozenShapeCoverBindingSchema.extend({ bindingSha256: Digest }).superRefine((value, ctx) => {
  const { projection: output, placement } = value;
  if (output.width * output.height > MAX_SHAPE_COVER_PIXELS || output.padLeft + output.scaledWidth > output.width || output.padTop + output.scaledHeight > output.height
    || placement.x + placement.width > output.width || placement.y + placement.height > output.height || value.range.endMs > value.source.durationMs) {
    ctx.addIssue({ code: "custom", message: "Invalid frozen shape raster/range binding" });
  }
});
export type FrozenShapeCover = z.infer<typeof FrozenShapeCoverSchema>;
