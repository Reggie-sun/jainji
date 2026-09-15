import { z } from "zod";
import { CoverRectangleSchema } from "./cover-sticker.js";

export const COVER_SAMPLE_INTERVAL_MS = 250;
export const COVER_DETECTION_WINDOW = 8;
export const MAX_AUTOMATIC_COVER_TRACKS = 64;
export const DetectedCoverFrameSchema = z.object({
  timeMs: z.number().int().nonnegative(),
  targets: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,24}$/),
    rectangle: CoverRectangleSchema,
  }).strict()).max(16),
}).strict().superRefine((frame, ctx) => {
  if (new Set(frame.targets.map((target) => target.id)).size !== frame.targets.length) ctx.addIssue({ code: "custom", message: "同一帧的贴纸目标编号不能重复" });
});
export const CoverDetectionResponseSchema = z.object({
  status: z.enum(["ok", "uncertain"]),
  frames: z.array(DetectedCoverFrameSchema).min(1).max(COVER_DETECTION_WINDOW),
}).strict();
export type DetectedCoverFrame = z.infer<typeof DetectedCoverFrameSchema>;
export interface CoverDetectionImage { timeMs: number; url: string }
