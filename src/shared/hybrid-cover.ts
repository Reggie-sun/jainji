import { z } from "zod";
import { SourceIdentitySchema } from "./source-sticker-knowledge.js";
import { ExportSettingsSchema } from "./export-settings.js";

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Pixel = z.number().int().nonnegative().safe();
const Size = z.object({ width: Pixel.positive(), height: Pixel.positive() }).strict();

/** Serialized binding is data; only the main-process approved owner grants execution. */
export const HybridCoverBindingSchema = z.object({
  version: z.literal("HybridApprovedCorner/v1"), approvalId: z.string().uuid(),
  corner: z.enum(["TOP_LEFT", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_RIGHT"]),
  bindingDigest: Digest, pngSha256: Digest, qaPacketDigest: Digest,
  source: SourceIdentitySchema, settings: ExportSettingsSchema,
  projection: Size, placement: Size.extend({ x: Pixel, y: Pixel }).strict(),
  range: z.object({ startFrame: Pixel, endFrame: Pixel.positive(), startMs: Pixel, endMs: Pixel.positive() }).strict(),
  coverage: z.object({ oldPixels: Pixel.positive(), uncoveredPixels: z.literal(0), coverageFraction: z.literal(1) }).strict(),
}).strict();
export type HybridCoverBinding = z.infer<typeof HybridCoverBindingSchema>;
