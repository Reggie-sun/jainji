import { createHash } from "node:crypto";
import { z } from "zod";
import { freezeAI } from "./source-fact-ai-contract.js";
import { assertOwnedReviewEvidence, type FullCanvasReviewEvidence } from "./source-fact-review-evidence.js";
import { AutoContourBindingSchema, AutoContourBitmapSchema, AutoContourConfigSchema, automaticContourStartedAt,
  assertOwnedAutomaticContours, type AutoContourBitmap, type AutoContourBinding, type AutoContourCandidate, type AutoContourConfig } from "./source-mask-auto-extraction.js";
import { decodeSourceMask } from "./shape-cover-pixel-gate.js";
import { sourceKey } from "./source-sticker-knowledge-store.js";

const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const Id = z.string().trim().min(1).max(160);
const RangeSchema = z.object({ startFrame: z.number().int().nonnegative().safe(), endFrame: z.number().int().positive().safe() }).strict();
const TruthFrameSchema = z.object({ binding: AutoContourBindingSchema,
  state: z.enum(["VISIBLE", "NOT_VISIBLE", "UNKNOWN"]), mask: AutoContourBitmapSchema.nullable(), reason: z.string().trim().min(1).max(1000).nullable(),
  motion: z.enum(["STATIC", "STATIONARY_ANIMATION", "MOVING", "UNKNOWN"]) }).strict().superRefine((frame, ctx) => {
    if (frame.state === "VISIBLE" && (!frame.mask || frame.reason !== null)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "VISIBLE truth needs a bitmap and no reason" });
    if (frame.state === "NOT_VISIBLE" && (frame.mask !== null || frame.reason !== null)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "NOT_VISIBLE truth needs a null bitmap and reason" });
    if (frame.state === "UNKNOWN" && (frame.mask !== null || !frame.reason)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "UNKNOWN truth needs a null bitmap and reason" });
  });
const TruthTargetSchema = z.object({ targetId: z.string().uuid(), frames: z.array(TruthFrameSchema).min(1).max(100_000) }).strict();
export const AutoContourTruthSetSchema = z.object({ scope: z.enum(["CONTROLLED_CONSTRUCTION", "REAL_MEDIA"]), authorId: Id, reviewerId: Id,
  targets: z.array(TruthTargetSchema).min(1).max(128) }).strict();
export type AutoContourTruthSet = z.infer<typeof AutoContourTruthSetSchema>;
export interface FreezeAutoContourEvaluationInput {
  evidence: FullCanvasReviewEvidence;
  config: Readonly<AutoContourConfig>;
  range?: { startFrame: number; endFrame: number };
  truthSet: unknown;
}

const FailureSchema = z.object({ code: z.enum(["MISSING_REQUIRED_PIXELS", "MISSING_VISIBLE_FRAME", "MISSING_TARGET_IDENTITY",
  "UNEXPECTED_TARGET_IDENTITY", "MOVING_TARGET_ACCEPTED", "MOTION_CATEGORY_MISMATCH"]), targetId: z.string().uuid(),
frameIndex: z.number().int().nonnegative().safe().nullable(), omittedPixels: z.number().int().nonnegative().safe().nullable() }).strict();
const ResultMetricsSchema = z.object({ visibleFrameDenominator: z.number().int().nonnegative().safe().nullable(),
  missingVisibleFrames: z.number().int().nonnegative().safe().nullable(), pixelDenominator: z.number().int().nonnegative().safe().nullable(),
  omittedPixels: z.number().int().nonnegative().safe().nullable(), overcoveragePixels: z.number().int().nonnegative().safe().nullable(),
  overcoveredFrames: z.number().int().nonnegative().safe().nullable(), truthUnknownFrames: z.number().int().nonnegative().safe().nullable(),
  candidateUnknownFrames: z.number().int().nonnegative().safe().nullable(), unknownMotionTargets: z.number().int().nonnegative().safe().nullable() }).strict();
export const AUTO_CONTOUR_EVALUATION_CRITERIA = freezeAI({ version: "auto-contour-pixel-motion-criteria/v1",
  zeroTolerance: ["missingRequiredPixels", "missingVisibleFrames", "movingTargetAccepted", "targetIdentityErrors", "motionCategoryMismatch"],
  excessPixels: "report-only", unknown: "INCOMPLETE-with-null-pixel-metrics", controlledResult: "DEVELOPMENT_MATCH-only",
  realMediaAndCorpus: "NOT_EVALUATED-without-independent-reviewed-corpus" } as const);
const criteriaDigest = hash(JSON.stringify(AUTO_CONTOUR_EVALUATION_CRITERIA));

export interface FrozenAutoContourEvaluation {
  readonly receipt: Readonly<{
    method: "auto-contour-evaluation-freeze/v1"; authority: "none"; eligible: false;
    scope: "CONTROLLED_CONSTRUCTION" | "REAL_MEDIA"; extractorId: string; authorId: string; reviewerId: string;
    sourceKey: string; censusDigest: string; config: Readonly<AutoContourConfig>; configDigest: string;
    range: Readonly<{ startFrame: number; endFrame: number }>; targetIds: readonly string[]; truthDigest: string;
    criteriaVersion: string; criteriaDigest: string; receiptDigest: string;
  }>;
}

export interface AutoContourEvaluationResult {
  readonly method: "auto-contour-evaluation-result/v1";
  readonly status: "DEVELOPMENT_MATCH" | "NOT_QUALIFIED" | "INCOMPLETE";
  readonly authority: "none";
  readonly eligible: false;
  readonly scope: "CONTROLLED_CONSTRUCTION" | "REAL_MEDIA";
  readonly extractorId: string;
  readonly authorId: string;
  readonly reviewerId: string;
  readonly sourceKey: string;
  readonly censusDigest: string;
  readonly configDigest: string;
  readonly evaluationReceiptDigest: string;
  readonly truthDigest: string;
  readonly candidateReceiptDigest: string;
  readonly criteriaDigest: string;
  readonly range: Readonly<{ startFrame: number; endFrame: number }>;
  readonly maskReview: "NOT_EVALUATED";
  readonly motionReview: "NOT_EVALUATED";
  readonly semanticReview: "NOT_EVALUATED";
  readonly metrics: Readonly<z.infer<typeof ResultMetricsSchema>>;
  readonly failures: readonly z.infer<typeof FailureSchema>[];
  readonly reasons: readonly string[];
  readonly resultDigest: string;
}

interface FrozenSnapshot {
  evidence: FullCanvasReviewEvidence;
  sourceKey: string;
  censusDigest: string;
  config: Readonly<AutoContourConfig>;
  configDigest: string;
  range: Readonly<{ startFrame: number; endFrame: number }>;
  truth: Readonly<AutoContourTruthSet>;
  createdAt: bigint;
}
const frozenSnapshots = new WeakMap<FrozenAutoContourEvaluation, FrozenSnapshot>();
function unsafe(reason: string): never { throw Error(`UNSAFE: auto-contour evaluation ${reason}`); }
function incomplete(reason: string): never { throw Error(`INCOMPLETE: auto-contour evaluation ${reason}`); }

function readEvidenceIdentity(evidence: FullCanvasReviewEvidence): { sourceKey: string; censusDigest: string } {
  assertOwnedReviewEvidence(evidence);
  const census = evidence.census;
  return { sourceKey: sourceKey(census.source), censusDigest: census.censusDigest };
}

function canonicalBinding(binding: AutoContourBinding): string { return JSON.stringify(AutoContourBindingSchema.parse(binding)); }

/** Parse and freeze controlled pixel/motion truth before the extractor starts. */
export async function freezeAutoContourEvaluation(input: FreezeAutoContourEvaluationInput): Promise<FrozenAutoContourEvaluation> {
  assertOwnedReviewEvidence(input.evidence);
  const config = freezeAI(AutoContourConfigSchema.parse(input.config));
  const truth = AutoContourTruthSetSchema.parse(input.truthSet);
  const evidence = input.evidence;
  const identity = readEvidenceIdentity(evidence);
  const range = RangeSchema.parse(input.range ?? { startFrame: 0, endFrame: evidence.census.horizon.frameCount });
  if (range.endFrame <= range.startFrame || range.endFrame > evidence.census.horizon.frameCount) incomplete("requested range is outside the canonical census");
  const configDigest = hash(JSON.stringify(config));
  const extractorId = `${config.version}:${config.method}`;
  if (new Set([extractorId, truth.authorId, truth.reviewerId]).size !== 3) incomplete("extractor, truth author and reviewer identities must be distinct");
  if (new Set(truth.targets.map(target => target.targetId)).size !== truth.targets.length) incomplete("duplicate truth target identity");
  const expectedLength = range.endFrame - range.startFrame;
  for (const target of truth.targets) {
    if (new Set(target.frames.map(frame => frame.binding.index)).size !== target.frames.length) incomplete("duplicate truth frame");
    if (target.frames.length !== expectedLength) incomplete("missing truth frame");
    for (let offset = 0; offset < expectedLength; offset++) {
      const ordinal = range.startFrame + offset, frame = target.frames[offset]!;
      const canonical = evidence.census.frames[ordinal];
      if (!canonical || frame.binding.index !== ordinal || canonicalBinding(frame.binding) !== canonicalBinding(canonical)) incomplete("truth frame binding differs from canonical source clock or pixels");
      if (frame.state === "VISIBLE" && !decodeSourceMask({ ...frame.mask!, kind: "static-binary-v1" }, evidence.census.source)) incomplete("truth bitmap is invalid on the original source grid");
    }
  }
  const sortedTruth = freezeAI({ ...truth, targets: [...truth.targets].sort((a, b) => a.targetId.localeCompare(b.targetId)) });
  const truthBytes = Buffer.byteLength(JSON.stringify(sortedTruth));
  if (truthBytes > 64 * 1024 ** 2) incomplete("frozen truth exceeds the 64 MiB development receipt limit");
  await evidence.verifyFresh();
  const createdAt = process.hrtime.bigint();
  const truthDigest = hash(JSON.stringify(sortedTruth));
  const rangeSnapshot = freezeAI({ ...range });
  const body = { method: "auto-contour-evaluation-freeze/v1" as const, authority: "none" as const, eligible: false as const,
    scope: sortedTruth.scope, extractorId, authorId: sortedTruth.authorId, reviewerId: sortedTruth.reviewerId,
    sourceKey: identity.sourceKey, censusDigest: identity.censusDigest, config, configDigest, range: rangeSnapshot,
    targetIds: sortedTruth.targets.map(target => target.targetId), truthDigest,
    criteriaVersion: AUTO_CONTOUR_EVALUATION_CRITERIA.version, criteriaDigest };
  const receipt = freezeAI({ ...body, receiptDigest: hash(JSON.stringify(body)) });
  const frozen: FrozenAutoContourEvaluation = Object.freeze({ receipt });
  frozenSnapshots.set(frozen, { evidence, sourceKey: identity.sourceKey, censusDigest: identity.censusDigest, config, configDigest,
    range: rangeSnapshot, truth: sortedTruth, createdAt });
  return frozen;
}

function candidateReceiptMatches(snapshot: FrozenSnapshot, candidate: AutoContourCandidate): void {
  const receipt = candidate.receipt;
  const { receiptDigest, ...body } = receipt;
  if (receipt.method !== "auto-source-contour-candidate/v1" || receipt.authority !== "none" || receipt.eligible !== false
    || receiptDigest !== hash(JSON.stringify(body))) incomplete("candidate receipt digest or authority fields are invalid");
  if (sourceKey(receipt.source) !== snapshot.sourceKey) incomplete("candidate source identity mismatch");
  if (receipt.censusDigest !== snapshot.censusDigest || receipt.censusDigest !== snapshot.evidence.census.censusDigest) incomplete("candidate census mismatch");
  if (receipt.configDigest !== snapshot.configDigest || JSON.stringify(receipt.config) !== JSON.stringify(snapshot.config)) incomplete("candidate configuration mismatch");
  if (receipt.range.startFrame !== snapshot.range.startFrame || receipt.range.endFrame !== snapshot.range.endFrame) incomplete("candidate range mismatch");
  if (receipt.targets.length > 128 || new Set(receipt.targets.map(target => target.targetId)).size !== receipt.targets.length) incomplete("candidate has duplicate target identities");
  const census = snapshot.evidence.census;
  for (const target of receipt.targets) {
    if (target.frames.length !== snapshot.range.endFrame - snapshot.range.startFrame) incomplete("candidate frame count differs from frozen range");
    for (let offset = 0; offset < target.frames.length; offset++) {
      const frame = target.frames[offset]!, ordinal = snapshot.range.startFrame + offset;
      const canonical = census.frames[ordinal];
      if (frame.targetId !== target.targetId || frame.binding.index !== ordinal || !canonical
        || canonicalBinding(frame.binding) !== canonicalBinding(canonical) || frame.configDigest !== snapshot.configDigest
        || frame.extractorVersion !== snapshot.config.version) incomplete("candidate frame binding differs from frozen source or config");
      if (frame.state === "VISIBLE" && (!frame.mask || !decodeSourceMask({ ...frame.mask, kind: "static-binary-v1" }, census.source))) incomplete("candidate bitmap is invalid on the original source grid");
      if (frame.state !== "VISIBLE" && frame.mask !== null) incomplete("candidate null-state frame contains pixels");
    }
  }
}

function maskIntersection(left: Uint8Array, right: Uint8Array, size: { width: number; height: number },
  leftBox: AutoContourBitmap["bbox"], rightBox: AutoContourBitmap["bbox"]): number {
  const x0 = Math.max(leftBox.x, rightBox.x), y0 = Math.max(leftBox.y, rightBox.y);
  const x1 = Math.min(leftBox.x + leftBox.width, rightBox.x + rightBox.width);
  const y1 = Math.min(leftBox.y + leftBox.height, rightBox.y + rightBox.height);
  let intersection = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) intersection += left[y * size.width + x]! & right[y * size.width + x]!;
  return intersection;
}

/** Compare one immutable development truth package with the exact owned extractor candidate. */
export async function evaluateAutoContours(frozen: FrozenAutoContourEvaluation, candidate: AutoContourCandidate): Promise<AutoContourEvaluationResult> {
  const snapshot = frozenSnapshots.get(frozen);
  if (!snapshot) unsafe("frozen evaluation is not process-owned");
  const evidence = assertOwnedAutomaticContours(candidate);
  assertOwnedReviewEvidence(snapshot.evidence);
  if (evidence !== snapshot.evidence) incomplete("candidate source or evidence mismatch");
  if (automaticContourStartedAt(candidate) < snapshot.createdAt) incomplete("frozen after extraction began");
  candidateReceiptMatches(snapshot, candidate);
  await snapshot.evidence.verifyFresh();

  const base = { method: "auto-contour-evaluation-result/v1" as const, authority: "none" as const, eligible: false as const,
    scope: frozen.receipt.scope, extractorId: frozen.receipt.extractorId, authorId: frozen.receipt.authorId, reviewerId: frozen.receipt.reviewerId,
    sourceKey: frozen.receipt.sourceKey, censusDigest: frozen.receipt.censusDigest, configDigest: frozen.receipt.configDigest,
    range: frozen.receipt.range, evaluationReceiptDigest: frozen.receipt.receiptDigest, truthDigest: frozen.receipt.truthDigest,
    candidateReceiptDigest: candidate.receipt.receiptDigest, criteriaDigest: frozen.receipt.criteriaDigest,
    maskReview: "NOT_EVALUATED" as const, motionReview: "NOT_EVALUATED" as const, semanticReview: "NOT_EVALUATED" as const };
  if (snapshot.truth.scope === "REAL_MEDIA") {
    await snapshot.evidence.verifyFresh();
    const body = { ...base, status: "INCOMPLETE" as const,
      metrics: { visibleFrameDenominator: null, missingVisibleFrames: null, pixelDenominator: null, omittedPixels: null, overcoveragePixels: null,
        overcoveredFrames: null, truthUnknownFrames: null, candidateUnknownFrames: null, unknownMotionTargets: null },
      failures: [], reasons: ["CORPUS_AC09_NOT_EVALUATED", "REAL_MEDIA_TRUTH_NOT_INDEPENDENTLY_REVIEWED"] };
    return freezeAI({ ...body, resultDigest: hash(JSON.stringify(body)) });
  }

  const candidateTargets = new Map(candidate.receipt.targets.map(target => [target.targetId, target]));
  const truthTargets = snapshot.truth.targets;
  const failures: z.infer<typeof FailureSchema>[] = [];
  const reasons: string[] = [];
  const expectedIds = new Set(truthTargets.map(target => target.targetId));
  const failureKeys = new Set<string>();
  const fail = (failure: z.infer<typeof FailureSchema>) => {
    const key = `${failure.code}:${failure.targetId}:${failure.frameIndex ?? "*"}`;
    if (!failureKeys.has(key)) { failureKeys.add(key); failures.push(failure); }
  };
  let visibleFrameDenominator = 0, missingVisibleFrames = 0, pixelDenominator = 0, omittedPixels = 0, overcoveragePixels = 0, overcoveredFrames = 0;
  let truthUnknownFrames = 0, candidateUnknownFrames = 0, unknownMotionTargets = 0, maskMetricsIncomplete = false, overallIncomplete = false;

  for (const target of truthTargets) {
    const candidateTarget = candidateTargets.get(target.targetId);
    if (!candidateTarget) fail({ code: "MISSING_TARGET_IDENTITY", targetId: target.targetId, frameIndex: null, omittedPixels: null });
    const knownMotions = new Set(target.frames.map(frame => frame.motion).filter(motion => motion !== "UNKNOWN"));
    const hasUnknownMotion = target.frames.some(frame => frame.motion === "UNKNOWN");
    if (hasUnknownMotion) { unknownMotionTargets++; overallIncomplete = true; }
    if (knownMotions.size > 1) { reasons.push(`CONTRADICTORY_MOTION_TRUTH:${target.targetId}`); overallIncomplete = true; }
    const knownMotion = knownMotions.size === 1 ? [...knownMotions][0]! : null;
    if (knownMotion === "MOVING" && candidateTarget?.frames.some(frame => frame.state === "VISIBLE" && frame.mask !== null)) {
      fail({ code: "MOVING_TARGET_ACCEPTED", targetId: target.targetId, frameIndex: null, omittedPixels: null });
    }
    const expectedCategory = knownMotion === "STATIC" ? "static" : knownMotion === "STATIONARY_ANIMATION" ? "animated" : null;
    if (expectedCategory && candidateTarget && candidateTarget.category !== expectedCategory) {
      fail({ code: "MOTION_CATEGORY_MISMATCH", targetId: target.targetId, frameIndex: null, omittedPixels: null });
    }
    for (let offset = 0; offset < target.frames.length; offset++) {
      const truth = target.frames[offset]!, candidateFrame = candidateTarget?.frames[offset];
      const truthUnknown = truth.state === "UNKNOWN", candidateUnknown = candidateFrame?.state === "UNKNOWN";
      if (truthUnknown) truthUnknownFrames++;
      if (candidateUnknown) candidateUnknownFrames++;
      if (truthUnknown || candidateUnknown) { maskMetricsIncomplete = true; overallIncomplete = true; continue; }
      if (truth.state === "NOT_VISIBLE") {
        if (candidateFrame?.state === "VISIBLE" && candidateFrame.mask) {
          decodeSourceMask({ ...candidateFrame.mask, kind: "static-binary-v1" }, snapshot.evidence.census.source)!;
          const extra = candidateFrame.mask.markedPixels;
          overcoveragePixels += extra;
          if (extra) overcoveredFrames++;
        }
        continue;
      }

      const truthMask = decodeSourceMask({ ...truth.mask!, kind: "static-binary-v1" }, snapshot.evidence.census.source)!;
      const truthPixels = truth.mask!.markedPixels;
      visibleFrameDenominator++;
      pixelDenominator += truthPixels;
      if (!candidateFrame || candidateFrame.state !== "VISIBLE" || !candidateFrame.mask) {
        missingVisibleFrames++;
        omittedPixels += truthPixels;
        fail({ code: "MISSING_VISIBLE_FRAME", targetId: target.targetId, frameIndex: truth.binding.index, omittedPixels: truthPixels });
        continue;
      }
      const candidateMask = decodeSourceMask({ ...candidateFrame.mask, kind: "static-binary-v1" }, snapshot.evidence.census.source)!;
      const overlap = maskIntersection(truthMask, candidateMask, snapshot.evidence.census.source, truth.mask!.bbox, candidateFrame.mask.bbox);
      const missed = truthPixels - overlap, extra = candidateFrame.mask.markedPixels - overlap;
      omittedPixels += missed;
      overcoveragePixels += extra;
      if (extra) overcoveredFrames++;
      if (missed) fail({ code: "MISSING_REQUIRED_PIXELS", targetId: target.targetId, frameIndex: truth.binding.index, omittedPixels: missed });
    }
  }
  for (const target of candidate.receipt.targets) if (!expectedIds.has(target.targetId)) {
    fail({ code: "UNEXPECTED_TARGET_IDENTITY", targetId: target.targetId, frameIndex: null, omittedPixels: null });
    maskMetricsIncomplete = true;
    overallIncomplete = true;
  }

  if (reasons.some(reason => reason.startsWith("CONTRADICTORY_MOTION_TRUTH"))) reasons.push("MOTION_TRUTH_NOT_EVALUATED");
  const metrics = ResultMetricsSchema.parse({ visibleFrameDenominator: maskMetricsIncomplete ? null : visibleFrameDenominator,
    missingVisibleFrames: maskMetricsIncomplete ? null : missingVisibleFrames, pixelDenominator: maskMetricsIncomplete ? null : pixelDenominator,
    omittedPixels: maskMetricsIncomplete ? null : omittedPixels, overcoveragePixels: maskMetricsIncomplete ? null : overcoveragePixels,
    overcoveredFrames: maskMetricsIncomplete ? null : overcoveredFrames, truthUnknownFrames, candidateUnknownFrames, unknownMotionTargets });
  const status: AutoContourEvaluationResult["status"] = failures.length ? "NOT_QUALIFIED" : overallIncomplete ? "INCOMPLETE" : "DEVELOPMENT_MATCH";
  await snapshot.evidence.verifyFresh();
  const body = { ...base, status, metrics,
    failures: failures.sort((a, b) => a.targetId.localeCompare(b.targetId) || (a.frameIndex ?? -1) - (b.frameIndex ?? -1) || a.code.localeCompare(b.code)),
    reasons: [...new Set(reasons)].sort() };
  return freezeAI({ ...body, resultDigest: hash(JSON.stringify(body)) });
}
