import { z } from "zod";

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const CandidateId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const VisionRiskSchema = z.enum([
  "PRODUCT_PRINT_RISK", "PERSON_OCCLUSION_RISK", "COMPLEX_GROUPING",
  "TEMPORAL_INCONSISTENCY", "ALGORITHM_CONFLICT", "UNDETECTED_OVERLAY_SUSPECTED", "UNCERTAIN",
]);
const Explanation = z.string().trim().min(1).max(400);
const ComponentDecisionSchema = z.object({
  candidateId: CandidateId,
  decision: z.enum(["CONFIRM", "REJECT", "UNKNOWN"]),
  class: z.enum(["OVERLAY_STICKER", "OVERLAY_LOGO", "SUBTITLE", "PRODUCT_PRINT", "BACKGROUND_GRAPHIC", "PERSON", "OTHER", "UNKNOWN"]),
  temporalState: z.enum(["STABLE", "MOVED", "DISAPPEARED", "CHANGED", "UNCERTAIN"]),
  riskFlags: z.array(VisionRiskSchema).max(7),
  shortReason: Explanation,
  confidence: z.number().finite().min(0).max(1).optional(),
}).strict();
export const CandidateDecisionSchema = z.object({
  packetDigest: Digest,
  decisions: z.array(ComponentDecisionSchema).min(1).max(3),
  groups: z.array(z.object({
    candidateIds: z.array(CandidateId).min(1).max(3),
    sameLogicalOverlay: z.union([z.boolean(), z.literal("UNCERTAIN")]),
  }).strict()).max(3),
  undetectedOverlaySuspected: z.boolean(),
  crossBatchGroupingSuspected: z.boolean().optional(), // Required by H2; optional for historical H1 responses.
}).strict();
const Check = z.enum(["PASS", "FAIL", "UNKNOWN"]);
export const PreviewDecisionSchema = z.object({
  packetDigest: Digest,
  oldOverlayResidual: Check,
  unintendedOcclusion: Check,
  unnaturalPlacement: Check,
  temporalMismatch: Check,
  riskFlags: z.array(VisionRiskSchema).max(7),
  shortReason: Explanation,
  confidence: z.number().finite().min(0).max(1).optional(),
}).strict();
export type CandidateDecision = z.infer<typeof CandidateDecisionSchema>;
export type PreviewDecision = z.infer<typeof PreviewDecisionSchema>;
const previewChecks = ["oldOverlayResidual", "unintendedOcclusion", "unnaturalPlacement", "temporalMismatch"] as const;
type PreviewCheck = typeof previewChecks[number];
const previewRiskChecks: Partial<Record<PreviewDecision["riskFlags"][number], PreviewCheck>> = {
  PERSON_OCCLUSION_RISK: "unintendedOcclusion",
  TEMPORAL_INCONSISTENCY: "temporalMismatch",
  UNDETECTED_OVERLAY_SUSPECTED: "oldOverlayResidual",
};
export interface PreviewReviewConsistency {
  version: "hybrid-preview-review-consistency/v1";
  status: "CONSISTENT" | "INCONSISTENT";
  contradictions: { riskFlag: PreviewDecision["riskFlags"][number]; check: PreviewCheck; verdict: "PASS" }[];
}

/** Structured contradictions only; prose and unmapped risks are never guessed or removed. */
export function previewReviewConsistency(result: PreviewDecision): PreviewReviewConsistency {
  const contradictions: PreviewReviewConsistency["contradictions"] = [];
  for (const riskFlag of result.riskFlags) {
    const check = previewRiskChecks[riskFlag];
    if (check && result[check] === "PASS") contradictions.push({ riskFlag, check, verdict: "PASS" });
  }
  return { version: "hybrid-preview-review-consistency/v1", status: contradictions.length ? "INCONSISTENT" : "CONSISTENT", contradictions };
}

function json(text: string): unknown {
  if (text.length > 16_384) throw new Error("VISION_RESPONSE_TOO_LARGE");
  return JSON.parse(text);
}

export function parseCandidateDecision(text: string, packetDigest: string, candidateIds: readonly string[]): CandidateDecision {
  const result = CandidateDecisionSchema.parse(json(text));
  if (result.packetDigest !== packetDigest) throw new Error("VISION_PACKET_MISMATCH");
  const expected = new Set(candidateIds);
  const seen = new Set(result.decisions.map(item => item.candidateId));
  if (expected.size !== candidateIds.length || seen.size !== result.decisions.length ||
      seen.size !== expected.size || [...seen].some(id => !expected.has(id))) throw new Error("VISION_CANDIDATE_MISMATCH");
  const confirmed = new Set(result.decisions.filter(item => item.decision === "CONFIRM").map(item => item.candidateId));
  if (result.decisions.some(item => item.decision === "CONFIRM" && !["OVERLAY_STICKER", "OVERLAY_LOGO"].includes(item.class))) {
    throw new Error("VISION_CONFIRM_CLASS_MISMATCH");
  }
  const grouped = result.groups.flatMap(group => group.candidateIds);
  if (grouped.length !== confirmed.size || new Set(grouped).size !== grouped.length || grouped.some(id => !confirmed.has(id))) {
    throw new Error("VISION_GROUP_MISMATCH");
  }
  return result;
}

export function parsePreviewDecision(text: string, packetDigest: string): PreviewDecision {
  const result = PreviewDecisionSchema.parse(json(text));
  if (result.packetDigest !== packetDigest) throw new Error("VISION_PACKET_MISMATCH");
  return result;
}

export function previewVerdict(result: PreviewDecision): "PASS" | "UNSAFE" {
  return previewChecks.every(check => result[check] === "PASS") && result.riskFlags.length === 0 ? "PASS" : "UNSAFE";
}

export function resolvePreviewReviews(minimax: PreviewDecision, sol?: PreviewDecision): "PASS" | "UNSAFE" {
  const consistency = previewReviewConsistency(minimax);
  if (!sol) return previewVerdict(minimax);
  if (sol.packetDigest !== minimax.packetDigest || previewVerdict(sol) !== "PASS") return "UNSAFE";
  // A contradiction invalidates the review as a whole, never genuine FAIL/UNKNOWN evidence.
  if (previewChecks.some(check => minimax[check] !== "PASS")) return "UNSAFE";
  return consistency.status === "INCONSISTENT" ? "PASS" : previewVerdict(minimax);
}
