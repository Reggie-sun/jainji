import { z } from "zod";
import { CoverRectangleSchema } from "./cover-sticker.js";

// Temporary, run-local observation only. Never include this in a persisted schema.
export const MAX_COVER_DIAGNOSTIC_EVENTS = 192;
export const MAX_COVER_DIAGNOSTIC_BYTES = 131072;
const time = z.number().finite().nonnegative();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const request = z.object({ timeMs: time, crop: CoverRectangleSchema.optional() }).strict();
const tracks = z.object({ digest, entries: z.array(z.object({ target: digest, digest }).strict()).max(64) }).strict();
export const CoverDiagnosticEventSchema = z.object({
  phase: z.enum(["item", "proposal", "preview"]),
  stage: z.enum(["lifecycle", "validation", "sample", "inspect", "queue-wait", "full-render", "artifact-verify", "source-evidence", "paired-evidence", "proposal-provider", "review-provider"]),
  turn: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
  startedMs: time, finishedMs: time.optional(), durationMs: time.optional(),
  outcome: z.enum(["running", "ok", "failed", "cancelled"]),
  action: z.enum(["propose", "reuse", "inspect", "revise", "pass", "stop", "invalid"]).optional(),
  reason: z.enum(["accepted", "invalid-response", "invalid-tracks", "invalid-revision", "time-range", "no-visible-change", "protected-field", "unresolved-revision", "corner-correction", "budget-exhausted", "provider-stop", "stage-failed", "cancelled"]).optional(),
  tracks: tracks.optional(), previousTracks: tracks.optional(),
  requests: z.array(request).max(40).optional(), priorInspections: z.array(request).max(40).optional(),
  evidence: z.array(z.object({ requestedTimeMs: time, timeMs: time, previewTimeMs: time.optional(),
    crop: CoverRectangleSchema.optional(), previewCrop: CoverRectangleSchema.optional() }).strict()).max(40).optional(),
}).strict();
export const CoverDiagnosticsSchema = z.object({ schemaVersion: z.literal(1),
  events: z.array(CoverDiagnosticEventSchema).max(MAX_COVER_DIAGNOSTIC_EVENTS),
  droppedEvents: z.number().int().nonnegative(),
}).strict();
export type CoverDiagnosticEvent = z.infer<typeof CoverDiagnosticEventSchema>;
export type CoverDiagnosticStage = CoverDiagnosticEvent["stage"];
export type CoverDiagnosticReason = NonNullable<CoverDiagnosticEvent["reason"]>;
export type CoverDiagnosticState = z.infer<typeof CoverDiagnosticsSchema>;
