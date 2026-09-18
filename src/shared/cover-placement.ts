import { z } from "zod";
import { CoverTrackSchema } from "./cover-sticker.js";
import { SourceIdentitySchema } from "./source-sticker-knowledge.js";

export const PlacementTargetIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);

export const CoverPlacementSchema = z.object({
  schemaVersion: z.literal(1),
  source: SourceIdentitySchema,
  tracks: z.array(z.object({ targetId: PlacementTargetIdSchema, track: CoverTrackSchema }).strict()).max(64),
}).strict().superRefine((placement, ctx) => {
  for (const [index, { track }] of placement.tracks.entries()) {
    if (track.endMs > placement.source.durationMs) ctx.addIssue({ code: "custom", path: ["tracks", index, "track", "endMs"], message: "Track exceeds source duration" });
    for (const [frameIndex, frame] of track.keyframes.entries()) {
      if (frame.timeMs < track.startMs || frame.timeMs > track.endMs || frame.timeMs > placement.source.durationMs) {
        ctx.addIssue({ code: "custom", path: ["tracks", index, "track", "keyframes", frameIndex, "timeMs"], message: "Keyframe is outside its track or source duration" });
      }
    }
  }
  for (let index = 0; index < placement.tracks.length; index++) for (let prior = 0; prior < index; prior++) {
    const current = placement.tracks[index], previous = placement.tracks[prior];
    if (current.targetId === previous.targetId && current.track.startMs < previous.track.endMs && previous.track.startMs < current.track.endMs) {
      ctx.addIssue({ code: "custom", path: ["tracks", index], message: "Tracks for the same target cannot overlap" });
    }
  }
});

export type CoverPlacement = z.infer<typeof CoverPlacementSchema>;
