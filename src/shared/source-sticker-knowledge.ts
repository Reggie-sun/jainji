import { z } from "zod";
import { CoverRectangleSchema, CoverTrackSchema, interpolateCoverRectangle } from "./cover-sticker.js";
import { MAX_AUTOMATIC_COVER_TRACKS } from "./automatic-cover.js";
import type { KnowledgeLookupReason, KnowledgeOutcome } from "./source-sticker-knowledge-audit.js";

export const KNOWLEDGE_SCHEMA_VERSION = 1;
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Ms = z.number().int().nonnegative().safe();
const Time = z.string().datetime({ offset: true });
const TimeBase = z.string().regex(/^[1-9][0-9]*\/[1-9][0-9]*$/).refine((value) => value.split("/").every((part) => Number.isSafeInteger(Number(part))));

/** Exact interpretation equality is required in v1; no implicit compatibility mapping. */
export const SourceIdentitySchema = z.object({
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/), byteLength: z.number().int().positive().safe(),
  width: z.number().int().positive(), height: z.number().int().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  durationMs: Ms.refine((value) => value > 0), timeBase: TimeBase,
  timeOriginPts: z.number().int().safe(), interpretationVersion: z.number().int().positive(),
}).strict();
export const ReviewedRangeSchema = z.object({ startMs: Ms, endMs: Ms }).strict().refine((range) => range.endMs > range.startMs, "Empty reviewed range");
const Ranges = z.array(ReviewedRangeSchema).min(1).max(1024).superRefine((ranges, ctx) => {
  if (ranges.some((range, i) => i > 0 && range.startMs < ranges[i - 1].endMs)) ctx.addIssue({ code: "custom", message: "Ranges must be sorted and non-overlapping" });
});
export type ReviewedRange = z.infer<typeof ReviewedRangeSchema>;

export function coversRanges(available: readonly ReviewedRange[], required: readonly ReviewedRange[]): boolean {
  return required.length > 0 && required.every((range) => {
    let end = range.startMs;
    for (const part of available) {
      if (part.startMs > end) break;
      if (part.endMs > end) end = part.endMs;
      if (end >= range.endMs) return true;
    }
    return false;
  });
}

const frameFields = {
  id: Id, digest: Digest, byteLength: z.number().int().positive().max(8 * 1024 * 1024),
  pts: z.number().int().safe(), timeMs: z.number().finite().nonnegative(),
  width: z.number().int().positive(), height: z.number().int().positive(),
};
export const SourceFrameEvidenceSchema = z.object({
  ...frameFields, kind: z.literal("source"),
  crop: z.object({ sourceEvidenceId: Id, rectangle: CoverRectangleSchema }).strict().optional(),
}).strict();
const PreviewFrameEvidenceSchema = z.object({
  ...frameFields, kind: z.literal("preview"), sourceEvidenceId: Id, candidateId: Id,
  timeBase: TimeBase, timeOriginPts: z.number().int().safe(),
  factsDigest: Digest, templateDigest: Digest, outputSettingsDigest: Digest,
}).strict();
const SourceMaskReviewArtifactSchema = z.object({
  id: Id, kind: z.literal("source-mask-review"), artifact: z.enum(["probe-report", "contact-sheet", "review-receipt"]),
  digest: Digest, byteLength: z.number().int().positive().max(8 * 1024 * 1024),
}).strict();
export const KnowledgeEvidenceSchema = z.discriminatedUnion("kind", [SourceFrameEvidenceSchema, PreviewFrameEvidenceSchema, SourceMaskReviewArtifactSchema]);
export const SourcePixelMaskSchema = z.object({
  kind: z.literal("static-binary-v1"),
  bbox: z.object({ x: Ms, y: Ms, width: z.number().int().positive().max(512), height: z.number().int().positive().max(512) }).strict(),
  encoding: z.literal("bitpack-lsb-row-major-v1"),
  dataBase64: z.string().min(4).max(43692).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  sha256: Digest, markedPixels: z.number().int().positive().max(262144),
  creation: z.object({ method: Id, version: z.number().int().positive() }).strict(),
  review: z.object({ method: Id, version: z.number().int().positive(), reviewer: Id, at: Time }).strict(),
  evidenceIds: z.array(Id).min(2).max(512),
}).strict().superRefine((mask, ctx) => {
  const pixels = mask.bbox.width * mask.bbox.height;
  const bytes = Math.ceil(pixels / 8), padding = "=".repeat((3 - bytes % 3) % 3);
  if (pixels > 262144 || mask.markedPixels > pixels || mask.dataBase64.length !== 4 * Math.ceil(bytes / 3)
    || !mask.dataBase64.endsWith(padding) || (!padding && mask.dataBase64.endsWith("="))) ctx.addIssue({ code: "custom", message: "Invalid bounded source mask payload" });
  if (new Set(mask.evidenceIds).size !== mask.evidenceIds.length) ctx.addIssue({ code: "custom", message: "Duplicate source mask evidence" });
});
export const SourceFactsSchema = z.object({
  reviewedRanges: Ranges,
  targets: z.array(z.object({
    id: Id, segments: z.array(z.object({ id: Id, track: CoverTrackSchema, evidenceIds: z.array(Id).min(1).max(2048), interpolation: z.literal("linear"), mask: SourcePixelMaskSchema.optional() }).strict()).min(1).max(MAX_AUTOMATIC_COVER_TRACKS),
  }).strict()).max(MAX_AUTOMATIC_COVER_TRACKS),
  exclusions: z.array(z.object({ kind: z.enum(["subtitle", "product", "person"]), reason: z.string().min(1).max(500), evidenceIds: z.array(Id).min(1).max(2048) }).strict()).max(256),
  observations: z.array(z.object({ evidenceId: Id, targetId: Id.optional(), presence: z.enum(["PRESENT", "ABSENT", "UNKNOWN"]), rectangle: CoverRectangleSchema.optional() }).strict()).min(1).max(8192),
  samplingStrategy: z.string().min(1).max(120),
}).strict();
export const KnowledgeStateSchema = z.enum(["candidate", "reviewed", "disputed", "superseded", "unusable"]);
export const KnowledgeCandidateSchema = z.object({
  schemaVersion: z.literal(KNOWLEDGE_SCHEMA_VERSION), id: Id, state: z.literal("candidate"),
  source: SourceIdentitySchema, baseRevisionId: Id.nullable(), runId: Id, requiredRanges: Ranges,
  facts: SourceFactsSchema, evidence: z.array(KnowledgeEvidenceSchema).min(1).max(4096),
  resolvedDisputeIds: z.array(Id).max(1024),
  changes: z.array(z.object({ targetId: Id.optional(), ranges: Ranges, reason: z.string().min(1).max(1000), evidenceIds: z.array(Id).min(1).max(2048) }).strict()).max(1024),
  provenance: z.object({ executor: z.string().min(1).max(160), supervisor: z.string().min(1).max(160), contractVersion: z.number().int().positive(), requests: z.number().int().nonnegative(), at: Time }).strict(),
}).strict().superRefine((candidate, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const { facts, source, evidence } = candidate;
  const originals = new Map(evidence.filter((e) => e.kind === "source").map((e) => [e.id, e]));
  const inRange = (time: number) => facts.reviewedRanges.some((range) => time >= range.startMs && time < range.endMs);
  const refsValid = (ids: string[]) => ids.every((id) => originals.has(id));
  if (new Set(evidence.map((e) => e.id)).size !== evidence.length || new Set(facts.targets.map((t) => t.id)).size !== facts.targets.length) issue("Duplicate evidence or target identity");
  if (!coversRanges(facts.reviewedRanges, candidate.requiredRanges) || [...facts.reviewedRanges, ...candidate.requiredRanges].some((r) => r.endMs > source.durationMs)) issue("Invalid or insufficient reviewed ranges");
  if (!originals.size || evidence.some((e) => e.kind !== "source-mask-review" && e.timeMs >= source.durationMs)) issue("Missing original evidence or invalid source time");
  const [numerator, denominator] = source.timeBase.split("/").map(Number);
  for (const frame of originals.values()) {
    const expectedMs = (frame.pts - source.timeOriginPts) * numerator / denominator * 1000;
    if (!Number.isFinite(expectedMs) || Math.abs(expectedMs - frame.timeMs) > 1) issue("Source PTS does not match the source timeline");
    if (frame.crop) {
      const parent = originals.get(frame.crop.sourceEvidenceId);
      if (!parent || parent.crop || parent.pts !== frame.pts || parent.timeMs !== frame.timeMs) issue("Invalid crop-to-source mapping");
    }
    const width = source.width * (frame.crop?.rectangle.width ?? 1), height = source.height * (frame.crop?.rectangle.height ?? 1);
    if (Math.abs(frame.width * height - frame.height * width) > Math.max(width, height)) issue("Evidence must preserve source/crop aspect ratio");
  }
  for (const range of facts.reviewedRanges) {
    if (!facts.observations.some((o) => { const frame = originals.get(o.evidenceId); return frame && !frame.crop && frame.timeMs >= range.startMs && frame.timeMs < range.endMs; })) issue("Every reviewed range needs observed full-frame evidence");
  }
  for (const observation of facts.observations) {
    const frame = originals.get(observation.evidenceId);
    if (!frame || !inRange(frame.timeMs)) issue("Observation requires original evidence inside reviewed ranges");
    if (observation.targetId && !facts.targets.some((t) => t.id === observation.targetId)) issue("Unknown observation target");
    if (observation.presence === "PRESENT" && (!observation.targetId || !observation.rectangle)) issue("Present observations require identity and geometry");
    if (observation.presence !== "PRESENT" && observation.rectangle) issue("Absent or unknown observations cannot carry geometry");
    if (observation.presence === "PRESENT" && frame && observation.rectangle) {
      const segment = facts.targets.find((target) => target.id === observation.targetId)?.segments.find(({ track }) => frame.timeMs >= track.startMs && frame.timeMs < track.endMs);
      if (!segment) issue("Present observation lies outside its target segments");
      else if (segment.track.keyframes.length) {
        // Observations are final source facts, not unreviewed detector proposals. Permit
        // floating-point rounding only; source safety expansion belongs to rendering.
        const expected = interpolateCoverRectangle(segment.track.keyframes, frame.timeMs);
        if ((["x", "y", "width", "height"] as const).some((key) => Math.abs(expected[key] - observation.rectangle![key]) > 1e-6)) issue("Observed source geometry contradicts its track");
      }
    }
  }
  const segments = facts.targets.flatMap((target) => target.segments);
  if (segments.length > MAX_AUTOMATIC_COVER_TRACKS || new Set(segments.map((s) => s.id)).size !== segments.length) issue("Invalid segment count or duplicate identity");
  for (const target of facts.targets) {
    for (const [index, segment] of target.segments.entries()) {
      const track = segment.track;
      if (segment.mask) {
        const { bbox, evidenceIds } = segment.mask;
        const frames = evidenceIds.map((id) => originals.get(id));
        const rectangle = track.keyframes[0]?.rectangle;
        if (track.keyframes.length !== 1 || bbox.x + bbox.width > source.width || bbox.y + bbox.height > source.height
          || !rectangle || bbox.x < rectangle.x * source.width - 1 || bbox.y < rectangle.y * source.height - 1
          || bbox.x + bbox.width > (rectangle.x + rectangle.width) * source.width + 1
          || bbox.y + bbox.height > (rectangle.y + rectangle.height) * source.height + 1) issue("Static mask geometry is outside its source track");
        if (frames.some((frame, i) => !frame || frame.crop || frame.width !== source.width || frame.height !== source.height
          || !segment.evidenceIds.includes(evidenceIds[i]) || frame.timeMs < track.startMs || frame.timeMs >= track.endMs)
          || new Set(frames.map((frame) => frame?.pts)).size < 2
          || Math.max(...frames.map((frame) => frame?.timeMs ?? 0)) - Math.min(...frames.map((frame) => frame?.timeMs ?? 0)) < 1000) issue("Static mask needs distinct original frame evidence across time");
      }
      if (!refsValid(segment.evidenceIds) || !coversRanges(facts.reviewedRanges, [track]) || track.keyframes.some((f) => f.timeMs < track.startMs || f.timeMs > track.endMs)) issue("Track outside reviewed evidence/ranges");
      if (index > 0 && track.startMs < target.segments[index - 1].track.endMs) issue("Target segments overlap or are unordered");
      if (!facts.observations.some((o) => o.targetId === target.id && o.presence === "PRESENT" && segment.evidenceIds.includes(o.evidenceId) && originals.has(o.evidenceId) && originals.get(o.evidenceId)!.timeMs >= track.startMs && originals.get(o.evidenceId)!.timeMs < track.endMs)) issue("Segment lacks a present observation inside its interval");
      if (facts.observations.some((o) => (!o.targetId || o.targetId === target.id) && o.presence !== "PRESENT" && originals.has(o.evidenceId) && originals.get(o.evidenceId)!.timeMs >= track.startMs && originals.get(o.evidenceId)!.timeMs < track.endMs)) issue("Cannot interpolate across absent or unknown presence");
    }
  }
  if (facts.exclusions.some((e) => !refsValid(e.evidenceIds) || e.evidenceIds.some((id) => !inRange(originals.get(id)!.timeMs)))
    || candidate.changes.some((change) => !refsValid(change.evidenceIds) || !coversRanges(facts.reviewedRanges, change.ranges) || change.ranges.some((r) => !change.evidenceIds.some((id) => originals.has(id) && originals.get(id)!.timeMs >= r.startMs && originals.get(id)!.timeMs < r.endMs)))) issue("Missing change/exclusion evidence in its reviewed interval");
  for (const frame of evidence) if (frame.kind === "preview") {
    const [num, den] = frame.timeBase.split("/").map(Number);
    if (Math.abs((frame.pts - frame.timeOriginPts) * num / den * 1000 - frame.timeMs) > 1) issue("Preview PTS does not match its timeline");
    // Matches the existing evidence owner's absolute ceiling; M2 also checks the local frame interval.
    if (!originals.has(frame.sourceEvidenceId) || frame.candidateId !== candidate.id || Math.abs(frame.timeMs - originals.get(frame.sourceEvidenceId)!.timeMs) > 250) issue("Preview must pair with this candidate's source frame");
  }
});

export const KnowledgePublicationProofSchema = z.object({
  candidateId: Id, factsDigest: Digest, sourceReviewed: z.literal(true), previewPassed: z.literal(true),
  unresolvedIssueIds: z.array(Id).max(0), sourceEvidenceIds: z.array(Id).min(1).max(4096), previewEvidenceIds: z.array(Id).min(1).max(4096),
}).strict();
/** Source-only admission never claims that a cover preview or content safety passed. */
export const SourceMaskAdmissionProofSchema = z.object({
  mode: z.literal("source-mask-only-v1"), candidateId: Id, factsDigest: Digest,
  sourceReviewed: z.literal(true), maskReview: z.literal("PASS"),
  sourceEvidenceIds: z.array(Id).min(2).max(512),
  probeSha256: Digest, contactSheetSha256: Digest, reviewReceiptSha256: Digest,
  reviewedFrameRange: z.object({ start: Ms, endExclusive: Ms }).strict().refine(value => value.endExclusive > value.start),
}).strict();
export const KnowledgeRevisionProofSchema = z.union([KnowledgePublicationProofSchema, SourceMaskAdmissionProofSchema]);
export const KnowledgeDisputeSchema = z.object({
  schemaVersion: z.literal(KNOWLEDGE_SCHEMA_VERSION), id: Id, revisionId: Id, ranges: Ranges,
  kind: z.enum(["missing_target", "incomplete_boundary", "wrong_semantics", "duplicate_identity", "uncertain_presence"]),
  targetId: Id.optional(), reason: z.string().min(1).max(1000), evidence: z.array(SourceFrameEvidenceSchema).min(1).max(256), at: Time,
}).strict();
export type SourceIdentity = z.infer<typeof SourceIdentitySchema>;
export type SourceFacts = z.infer<typeof SourceFactsSchema>;
/** Safe per-version progress projection; evidence bytes and local paths remain in the main process. */
export interface SourceKnowledgeProgress {
  phase: "checking" | "recognizing" | "reusing" | "correcting" | "reviewed" | "not-saved" | "blocked";
  origin?: "cold" | "warm" | "refresh" | "run";
  reason?: string;
  sourceKey?: string;
  revisionId?: string;
  reviewedRanges?: ReviewedRange[];
  recognitionRequests: number;
  previewRequests: number;
  revisions: number;
  renders: number;
  elapsedMs: number;
  executor?: string;
  supervisor?: string;
  lookupReason?: KnowledgeLookupReason;
  executorRequests?: number;
  recognitionSupervisorRequests?: number;
  modelVerdict?: "passed" | "not-passed" | "not-evaluated";
  sourceIssueReported?: boolean;
  factsDigest?: string;
  templateDigest?: string;
  previewEvidenceDigests?: string[];
  previewActions?: KnowledgeOutcome["previewActions"];
  failureStage?: KnowledgeOutcome["failureStage"];
}
/** Compare the actual piecewise source geometry in a problem's scope, not redundant
 * keyframe encodings, evidence labels or sampling metadata. */
export function sourceGeometryChanged(before: SourceFacts, after: SourceFacts, ranges: readonly ReviewedRange[], targetId?: string): boolean {
  return geometryChanged(before, after, ranges, targetId, true);
}
/** Fresh labels and interpolation beyond the last observed frame are not counterevidence. */
export function sourceObservationsChanged(before: SourceFacts, after: SourceFacts, times: readonly number[]): boolean {
  return geometryChanged(before, after, [], undefined, false, times);
}
function geometryChanged(before: SourceFacts, after: SourceFacts, ranges: readonly ReviewedRange[], targetId: string | undefined, matchIds: boolean, observedTimes?: readonly number[]): boolean {
  const targets = (facts: SourceFacts) => facts.targets.filter((target) => !targetId || target.id === targetId);
  const times = new Set(ranges.flatMap((range) => [range.startMs, range.endMs]));
  for (const facts of [before, after]) for (const target of targets(facts)) for (const { track } of target.segments) {
    for (const time of [track.startMs, track.endMs, ...track.keyframes.map((frame) => frame.timeMs)]) if (ranges.some((range) => time >= range.startMs && time <= range.endMs)) times.add(time);
  }
  const points = [...times].sort((a, b) => a - b);
  const samples = [...points, ...points.slice(1).map((point, i) => (point + points[i]) / 2)].filter((time) => ranges.some((range) => time >= range.startMs && time < range.endMs));
  const at = (facts: SourceFacts, time: number) => new Map(targets(facts).flatMap((target) => {
    const segment = target.segments.find(({ track }) => time >= track.startMs && time < track.endMs);
    return segment ? [[target.id, { rectangle: interpolateCoverRectangle(segment.track.keyframes, time), mask: segment.mask }] as const] : [];
  }));
  return (observedTimes ?? samples).some((time) => {
    const a = at(before, time), b = at(after, time);
    if (a.size !== b.size) return true;
    return [...a].some(([id, value]) => {
      const matched = [...b].find(([other, next]) => (!matchIds || other === id)
        && (["x", "y", "width", "height"] as const).every(key => Math.abs(value.rectangle[key] - next.rectangle[key]) <= 1e-9)
        && (!matchIds || (value.mask?.sha256 === next.mask?.sha256
          && (["x", "y", "width", "height"] as const).every(key => value.mask?.bbox[key] === next.mask?.bbox[key]))));
      if (!matched) return true;
      b.delete(matched[0]); return false;
    });
  });
}
export type KnowledgeEvidence = z.infer<typeof KnowledgeEvidenceSchema>;
export type SourcePixelMask = z.infer<typeof SourcePixelMaskSchema>;
export type KnowledgeCandidate = z.infer<typeof KnowledgeCandidateSchema>;
export type KnowledgePublicationProof = z.infer<typeof KnowledgePublicationProofSchema>;
export type SourceMaskAdmissionProof = z.infer<typeof SourceMaskAdmissionProofSchema>;
export type KnowledgeDispute = z.infer<typeof KnowledgeDisputeSchema>;
export interface KnowledgeRevision {
  id: string;
  sourceKey: string;
  state: "reviewed" | "disputed" | "superseded";
  verification: "sampled" | "source-mask-only";
  factsDigest: string;
  candidate: KnowledgeCandidate;
  proof: KnowledgePublicationProof | SourceMaskAdmissionProof;
}
