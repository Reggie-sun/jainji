import { z } from "zod";
import { freezeAI } from "./source-fact-ai-contract.js";
import { discoveryHash as hash } from "./source-fact-discovery-evidence.js";
import { AutoContourBindingSchema, AutoContourBitmapSchema } from "./source-mask-auto-extraction.js";
import { decodeSourceMask } from "./shape-cover-pixel-gate.js";
import { STATIC_MASK_CONFIG, readStaticMaskCandidate, type StaticMaskCandidate } from "./source-mask-static-extraction.js";
import { assertStaticTargetEvidence, assertConfirmedStaticTarget, staticIncomplete, STATIC_MASK_LIMITS, type StaticTargetEvidence } from "./source-mask-static-target.js";

const truthSchema = z.object({ scope: z.enum(["CONTROLLED_CONSTRUCTION", "REAL_MEDIA"]), authorId: z.string().trim().min(1).max(160),
  reviewerId: z.string().trim().min(1).max(160), origin: z.literal("INDEPENDENT_REQUIRED_PIXELS_NOT_EXTRACTOR_MASK"),
  frames: z.array(z.object({ binding: AutoContourBindingSchema, requiredPixels: AutoContourBitmapSchema,
    motion: z.enum(["STATIC", "MOVING", "UNKNOWN"]) }).strict()).min(1).max(100_000) }).strict();
export type StaticPixelTruthInput = z.infer<typeof truthSchema>;
export interface FrozenStaticPixelTruth { readonly receipt: Readonly<{ method: "static-independent-pixel-freeze/v1"; authority: "none"; eligible: false;
  evidenceDigest: string; confirmationDigest: string; configDigest: string; truthDigest: string; scope: StaticPixelTruthInput["scope"]; frameCount: number }> }
const truths = new WeakMap<FrozenStaticPixelTruth, { evidence: StaticTargetEvidence; truth: StaticPixelTruthInput; createdAt: bigint }>();

/** Engineering truth is frozen before extraction, full-range and source/ROI bound; real review is not invented. */
export async function freezeStaticPixelTruth(evidence: StaticTargetEvidence, raw: StaticPixelTruthInput): Promise<FrozenStaticPixelTruth> {
  assertStaticTargetEvidence(evidence);
  if (Buffer.byteLength(JSON.stringify(raw)) > STATIC_MASK_LIMITS.receiptBytes) staticIncomplete("truth byte budget exceeded");
  const truth = truthSchema.parse(raw), range = evidence.target.receipt.range, source = evidence.clock;
  if (truth.authorId === truth.reviewerId || truth.frames.length !== range.endFrame - range.startFrame) staticIncomplete("truth independence or full range missing");
  for (const [offset, frame] of truth.frames.entries()) {
    const original = source.frames[range.startFrame + offset], b = frame.binding;
    if (b.index !== original.index || b.pts !== original.pts || b.endPts !== original.endPts
      || b.byteLength !== evidence.roi.width * evidence.roi.height * 4) staticIncomplete("truth clock or ROI mismatch");
    const mask = decodeSourceMask({ ...frame.requiredPixels, kind: "static-binary-v1" }, assertConfirmedStaticTarget(evidence.target).receipt.source);
    if (!mask) staticIncomplete("invalid required pixels");
  }
  await evidence.verifyFresh();
  const frozen = freezeAI({ receipt: { method: "static-independent-pixel-freeze/v1" as const, authority: "none" as const, eligible: false as const,
    evidenceDigest: evidence.evidenceDigest, confirmationDigest: evidence.target.receipt.confirmationDigest, configDigest: hash(JSON.stringify(STATIC_MASK_CONFIG)),
    truthDigest: hash(JSON.stringify(truth)), scope: truth.scope, frameCount: truth.frames.length } });
  truths.set(frozen, { evidence, truth: freezeAI(truth), createdAt: process.hrtime.bigint() }); return frozen;
}

/** Zero miss is measured against separate required pixels, never against the candidate's own mask. */
export async function qualifyStaticMask(candidate: StaticMaskCandidate, frozen: FrozenStaticPixelTruth | null, signal: AbortSignal) {
  const owner = readStaticMaskCandidate(candidate), evidence = owner.evidence, receipt = candidate.receipt;
  signal.throwIfAborted(); await evidence.verifyFresh(); signal.throwIfAborted();
  const snapshot = frozen ? truths.get(frozen) : undefined;
  if (frozen && (!snapshot || snapshot.evidence !== evidence || snapshot.createdAt >= owner.started
    || frozen.receipt.configDigest !== receipt.configDigest)) staticIncomplete("unowned, late or mismatched truth freeze");
  const base = { method: "static-independent-pixel-result/v1", authority: "none" as const, eligible: false as const,
    candidateDigest: receipt.receiptDigest, confirmationDigest: receipt.confirmationDigest, range: receipt.range, truthDigest: frozen?.receipt.truthDigest ?? null };
  if (!snapshot || snapshot.truth.scope === "REAL_MEDIA") return freezeAI({ ...base, status: "INCOMPLETE", metrics: {
    requiredPixels: null, missedRequiredPixels: null, excessPixels: null, comparedFrames: null },
    reasons: [snapshot ? "REAL_MEDIA_TRUTH_NOT_INDEPENDENTLY_REVIEWED" : "INDEPENDENT_REQUIRED_PIXEL_TRUTH_MISSING"] });
  const source = assertConfirmedStaticTarget(evidence.target).receipt.source;
  const raster = receipt.mask ? decodeSourceMask({ ...receipt.mask, kind: "static-binary-v1" }, source) : null;
  let requiredPixels = 0, missedRequiredPixels = 0, excessPixels = 0, comparedFrames = 0, motionMismatch = false;
  await evidence.streamRange((_rgba, binding) => {
    signal.throwIfAborted(); const frame = snapshot.truth.frames[comparedFrames], original = receipt.frames[comparedFrames];
    if (JSON.stringify(binding) !== JSON.stringify(original) || JSON.stringify(binding) !== JSON.stringify(frame.binding)) staticIncomplete("independent original pixel binding mismatch");
    const required = decodeSourceMask({ ...frame.requiredPixels, kind: "static-binary-v1" }, source)!;
    if (frame.motion !== "STATIC") motionMismatch = true;
    for (let p = 0; p < required.length; p++) {
      if (required[p]) { requiredPixels++; if (!raster?.[p]) missedRequiredPixels++; }
      else if (raster?.[p]) excessPixels++;
    }
    comparedFrames++;
  }, signal);
  signal.throwIfAborted(); await evidence.verifyFresh(); signal.throwIfAborted();
  return freezeAI({ ...base, status: missedRequiredPixels || motionMismatch || receipt.status === "INCOMPLETE" ? "NOT_QUALIFIED" : "DEVELOPMENT_MATCH",
    metrics: { requiredPixels, missedRequiredPixels, excessPixels, comparedFrames }, reasons: [
      ...(missedRequiredPixels ? ["MISSING_REQUIRED_PIXELS"] : []), ...(motionMismatch ? ["STATIC_MOTION_TRUTH_MISMATCH"] : []),
      ...(receipt.status === "INCOMPLETE" ? ["FULL_TARGET_RANGE_NOT_ACCEPTED"] : []), "CONTROLLED_CONSTRUCTION_ONLY_NO_REAL_HOLDOUT_QUALIFICATION"] });
}
