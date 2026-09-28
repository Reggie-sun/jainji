import { createHash } from "node:crypto";
import { z } from "zod";
import { FullCanvasReviewCommandSchema, FULL_CANVAS_REVIEW_METHOD } from "./source-fact-review-session.js";
import { SourceIdentitySchema } from "../shared/source-sticker-knowledge.js";
import { assertQualificationPackage, QUALIFICATION_CRITERIA, QUALIFICATION_SCENARIOS, QualificationCorrespondenceSchema,
  qualificationDigest, type QualificationPackage } from "./source-fact-qualification-contract.js";

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Count = z.number().int().nonnegative().safe();
const Interval = z.object({ startFrame: Count, endFrame: Count, startPts: z.number().int().safe(), endPts: z.number().int().safe() }).strict();
const ReceiptSchema = z.object({ schemaVersion: z.literal(1), authority: z.literal("none"), eligible: z.literal(false),
  semanticReview: z.literal("RECORDED_NOT_QUALIFIED"), methodQualification: z.literal("NOT_EVALUATED"),
  session: z.object({ sessionId: z.string().uuid(), sourceIdentity: SourceIdentitySchema, censusDigest: Digest, reviewMethodVersion: z.literal(FULL_CANVAS_REVIEW_METHOD),
    frameCount: Count, reviewerId: z.string().trim().min(1).max(160), createdAt: z.string().datetime(), recordedOrdinals: z.array(Count).max(100_000), frozen: z.literal(true) }).strict(),
  decode: z.unknown(), horizon: z.object({ startPts: z.number().int().safe(), endPts: z.number().int().safe(), frameCount: Count }).strict(),
  evidenceId: z.string().uuid(), reviewedAt: z.string().datetime(), results: z.array(z.object({ binding: z.object({ evidenceId: z.string().uuid(), ordinal: Count,
    pts: z.number().int().safe(), endPts: z.number().int().safe(), pixelSha256: Digest, byteLength: Count }).strict(), result: FullCanvasReviewCommandSchema,
    reviewedAt: z.string().datetime(), presentation: z.literal("CLIENT_REPORTED_FULL_CANVAS") }).strict()).max(100_000),
  declaredTargets: z.array(z.unknown()).max(32768), unknownIntervals: z.array(Interval).max(100_000), unverifiedIntervals: z.array(Interval).length(1), receiptDigest: Digest }).strict();
export type QualificationReviewReceipt = z.infer<typeof ReceiptSchema>;
export type QualificationMetrics = { frameCount: number; clearFrameCount: number; targetFrameCount: number; falseEmptyCount: number; missedTargetFrames: number;
  multiTargetMissCount: number; boundaryErrorFrames: number; singleFrameAppearanceMisses: number; bridgedAbsenceIntervals: number; missedUnknown: number;
  unnecessaryUnknownCount: number; unnecessaryUnknownRate: number; targetFrameRecall: number; falsePositiveTargetFrames: number; falsePositiveRate: number; identityMergeErrors: number; identitySplitErrors: number };
const zeroMetrics = (): QualificationMetrics => ({ frameCount: 0, clearFrameCount: 0, targetFrameCount: 0, falseEmptyCount: 0, missedTargetFrames: 0,
  multiTargetMissCount: 0, boundaryErrorFrames: 0, singleFrameAppearanceMisses: 0, bridgedAbsenceIntervals: 0, missedUnknown: 0, unnecessaryUnknownCount: 0,
  unnecessaryUnknownRate: 0, targetFrameRecall: 0, falsePositiveTargetFrames: 0, falsePositiveRate: 0, identityMergeErrors: 0, identitySplitErrors: 0 });

/** Parent-side check of a command already accepted by the canonical live D2 session. No success authority. */
export function inspectLiveQualificationRecord(pack: QualificationPackage, fixtureId: string, raw: unknown) {
  const record = z.object({ binding: z.object({ evidenceId: z.string().uuid(), ordinal: Count, pts: z.number().int().safe(), endPts: z.number().int().safe(),
    pixelSha256: Digest, byteLength: Count }).strict(), result: FullCanvasReviewCommandSchema }).strict().parse(raw);
  const { evidenceId: _, ...binding } = record.binding;
  const truth = pack.truth.fixtures.find(f => f.fixtureId === fixtureId)?.frames[binding.ordinal];
  if (!truth || qualificationDigest(binding) !== qualificationDigest(truth.binding)) throw new Error("UNSAFE: live D1 record binding");
  return { record, falseEmpty: record.result.type === "EMPTY" && truth.state === "KNOWN" && truth.targets.length > 0 };
}

export function validateQualificationReceipt(raw: unknown, pack: QualificationPackage, fixtureId: string): QualificationReviewReceipt {
  if (!raw || typeof raw !== "object") throw new Error("review receipt absent");
  const { receiptDigest, ...body } = raw as Record<string, unknown>;
  if (createHash("sha256").update(JSON.stringify(body)).digest("hex") !== receiptDigest) throw new Error("D2 receipt digest mismatch");
  const receipt = ReceiptSchema.parse(raw);
  const fixture = pack.manifest.fixtures.find(f => f.fixtureId === fixtureId);
  const truth = pack.truth.fixtures.find(f => f.fixtureId === fixtureId);
  if (!fixture || !truth || receipt.session.censusDigest !== fixture.censusDigest || qualificationDigest(receipt.session.sourceIdentity) !== qualificationDigest(fixture.sourceIdentity)
    || qualificationDigest(receipt.decode) !== qualificationDigest(truth.census.decode) || qualificationDigest(receipt.horizon) !== qualificationDigest(truth.census.horizon)
    || receipt.session.frameCount !== fixture.frameCount || receipt.results.length !== fixture.frameCount
    || Date.parse(receipt.session.createdAt) < Date.parse(pack.frozenAt) || Date.parse(receipt.reviewedAt) < Date.parse(receipt.session.createdAt)
    || qualificationDigest(receipt.session.recordedOrdinals) !== qualificationDigest(truth.frames.map(f => f.binding.ordinal))) throw new Error("D2 receipt source, census, freeze or ordinal binding");
  const tokens = new Set<string>(); const targets = new Map<string, unknown>(); const unknown: z.infer<typeof Interval>[] = [];
  receipt.results.forEach((record, ordinal) => {
    const { evidenceId, ...binding } = record.binding;
    if (evidenceId !== receipt.evidenceId || qualificationDigest(binding) !== qualificationDigest(truth.frames[ordinal].binding)
      || tokens.has(record.result.presentationId) || Date.parse(record.reviewedAt) < Date.parse(receipt.session.createdAt)
      || Date.parse(record.reviewedAt) > Date.parse(receipt.reviewedAt)) throw new Error("D2 presentation or frame binding");
    tokens.add(record.result.presentationId);
    if (record.result.type === "TARGETS") {
      if (new Set(record.result.targets.map(t => t.id)).size !== record.result.targets.length) throw new Error("D2 duplicate target");
      for (const target of record.result.targets) {
        if (targets.has(target.id) && qualificationDigest(targets.get(target.id)) !== qualificationDigest(target)) throw new Error("D2 inconsistent target declaration");
        targets.set(target.id, target);
      }
    } else if (record.result.type === "UNKNOWN") {
      const last = unknown.at(-1);
      if (last?.endFrame === ordinal) { last.endFrame++; last.endPts = binding.endPts; }
      else unknown.push({ startFrame: ordinal, endFrame: ordinal + 1, startPts: binding.pts, endPts: binding.endPts });
    }
  });
  if (qualificationDigest(receipt.declaredTargets) !== qualificationDigest([...targets.values()].sort((a, b) => (a as { id: string }).id.localeCompare((b as { id: string }).id)))
    || qualificationDigest(receipt.unknownIntervals) !== qualificationDigest(unknown)
    || qualificationDigest(receipt.unverifiedIntervals) !== qualificationDigest([{ startFrame: 0, endFrame: fixture.frameCount,
      startPts: truth.census.horizon.startPts, endPts: truth.census.horizon.endPts }])) throw new Error("D2 owner-computed target/complement binding");
  return receipt;
}

export function qualificationCoverage(pack: QualificationPackage) {
  let clear = 0, empty = 0, present = 0, multi = 0, single = 0, cuts = 0, motion = 0, ambiguous = 0;
  const scenarios = new Set<string>();
  for (const fixture of pack.truth.fixtures) {
    for (const frame of fixture.frames) {
      if (frame.state === "KNOWN") { clear++; if (!frame.targets.length) empty++; else present++; if (frame.targets.length > 1) multi++; }
    }
    const activity = new Map<string, Set<number>>();
    for (const frame of fixture.frames) if (frame.state === "KNOWN") for (const target of frame.targets) {
      const active = activity.get(target.id) ?? new Set<number>(); active.add(frame.binding.ordinal); activity.set(target.id, active);
    }
    for (const ordinals of activity.values()) for (const ordinal of ordinals) if (!ordinals.has(ordinal - 1) && !ordinals.has(ordinal + 1)) single++;
    for (const item of fixture.cases) {
      scenarios.add(item.scenario);
      if (item.scenario === "cuts" && item.endOrdinal - item.startOrdinal === 2) cuts++;
      if (item.scenario === "moving" || item.scenario === "animated") {
        if (fixture.frames.slice(item.startOrdinal, item.endOrdinal).some(f => f.state === "KNOWN" && f.targets.some(t => t.category === item.scenario))) motion++;
      }
      if ((item.scenario === "identity-ambiguous" || item.scenario === "semantic-ambiguous")
        && item.endOrdinal - item.startOrdinal === 1 && fixture.frames[item.startOrdinal].state === "TRUTH_AMBIGUOUS") ambiguous++;
    }
  }
  const criteria = pack.criteria;
  const counts = { groups: new Set(pack.manifest.fixtures.map(f => f.groupId)).size, frames: pack.truth.fixtures.reduce((n, f) => n + f.frames.length, 0), clear, empty, present, multi, single, cuts, motion, ambiguous };
  const sufficient = counts.groups >= criteria.minimumGroups && counts.frames >= criteria.minimumFrames && clear >= criteria.minimumClearFrames
    && empty >= criteria.minimumEmptyFrames && present >= criteria.minimumPresentFrames && multi >= criteria.minimumMultiTargetFrames
    && single >= criteria.minimumSingleFrameCases && cuts >= criteria.minimumCutCases && motion >= criteria.minimumMotionCases && ambiguous >= criteria.minimumAmbiguousCases
    && QUALIFICATION_SCENARIOS.every(s => scenarios.has(s));
  return { ...counts, sufficient, missingScenarios: QUALIFICATION_SCENARIOS.filter(s => !scenarios.has(s)) };
}

/** Offline diagnostics only. A JSON receipt, matching metrics or forged human flag cannot qualify anyone. */
export function compareHumanReviewQualification(raw: unknown) {
  const metrics = zeroMetrics(); const failures: string[] = []; let metricsComplete = false;
  const finish = (comparisonStatus: "QUALIFIED" | "NOT_QUALIFIED" | "INCOMPLETE") => {
    const body = { schemaVersion: 1 as const, authority: "none" as const, evidenceClass: "OFFLINE_COMPARISON_NOT_HUMAN_QUALIFICATION" as const,
      comparisonStatus, qualificationStatus: comparisonStatus === "NOT_QUALIFIED" ? "NOT_QUALIFIED" as const : "INCOMPLETE" as const,
      qualificationRecord: null, metrics: Object.freeze({ ...metrics }), metricsComplete,
      unevaluatedMetrics: Object.freeze(metricsComplete ? [] : Object.keys(metrics).filter(key => key !== "falseEmptyCount")), failures: Object.freeze([...failures]) };
    return Object.freeze({ ...body, comparisonDigest: qualificationDigest(body) });
  };
  try {
    const input = z.object({ package: z.unknown(), reviews: z.array(z.object({ fixtureId: z.string().uuid(), receipt: z.unknown() }).strict()).max(256),
      correspondence: z.unknown() }).strict().parse(raw);
    const pack = assertQualificationPackage(input.package);
    const reviews = new Map<string, QualificationReviewReceipt>();
    for (const item of input.reviews) {
      if (reviews.has(item.fixtureId)) throw new Error("duplicate review fixture");
      const receipt = validateQualificationReceipt(item.receipt, pack, item.fixtureId); reviews.set(item.fixtureId, receipt);
      if (receipt.session.reviewerId === pack.manifest.truthAuthorId) throw new Error("truth author equals reviewer");
      // Fatal, monotonic decision, before any coverage/mapping checks or averaging. Do not inspect later semantic results.
      const truth = pack.truth.fixtures.find(f => f.fixtureId === item.fixtureId)!;
      for (const [ordinal, record] of receipt.results.entries()) if (record.result.type === "EMPTY" && truth.frames[ordinal].state === "KNOWN"
        && (truth.frames[ordinal] as Extract<typeof truth.frames[number], { state: "KNOWN" }>).targets.length) {
        metrics.falseEmptyCount = 1; failures.push(`FALSE_EMPTY:${item.fixtureId}:${ordinal}`); return finish("NOT_QUALIFIED");
      }
      const missedUnknown = receipt.results.filter((record, ordinal) => truth.frames[ordinal].state === "TRUTH_AMBIGUOUS" && record.result.type !== "UNKNOWN").length;
      if (missedUnknown) { metrics.missedUnknown = missedUnknown; failures.push("missedUnknown"); return finish("NOT_QUALIFIED"); }
    }
    if (reviews.size !== pack.manifest.fixtures.length || new Set([...reviews.values()].map(r => r.session.reviewerId)).size !== 1) throw new Error("human run incomplete or mixed reviewers");
    const reviewDigest = qualificationDigest(input.reviews.map(r => ({ fixtureId: r.fixtureId, receiptDigest: reviews.get(r.fixtureId)!.receiptDigest })).sort((a, b) => a.fixtureId.localeCompare(b.fixtureId)));
    const mapping = QualificationCorrespondenceSchema.parse(input.correspondence);
    if (mapping.datasetDigest !== pack.datasetDigest || mapping.truthDigest !== pack.truthDigest || mapping.reviewReceiptDigest !== reviewDigest
      || mapping.adjudicatorId !== pack.manifest.truthAuthorId || mapping.unresolved.length) throw new Error("independent correspondence absent, unresolved or stale");
    const correspondence = new Map<string, string | null>();
    const truthByFixture = new Map(pack.truth.fixtures.map(f => [f.fixtureId, f]));
    const truthIdentities = new Map(pack.truth.fixtures.map(f => [f.fixtureId, new Set(f.frames.flatMap(frame => frame.state === "KNOWN" ? frame.targets.map(t => t.id) : []))]));
    for (const entry of mapping.entries) {
      const key = `${entry.fixtureId}:${entry.ordinal}:${entry.reviewTargetId}`;
      const review = reviews.get(entry.fixtureId)?.results[entry.ordinal]?.result;
      const truth = truthByFixture.get(entry.fixtureId)?.frames[entry.ordinal];
      if (correspondence.has(key) || review?.type !== "TARGETS" || !review.targets.some(t => t.id === entry.reviewTargetId)
        || !truth || (entry.truthTargetId !== null && !truthIdentities.get(entry.fixtureId)?.has(entry.truthTargetId))) throw new Error("correspondence unknown/duplicate declaration or target");
      correspondence.set(key, entry.truthTargetId);
    }
    let declaredPairs = 0;
    for (const fixture of pack.truth.fixtures) {
      const receipt = reviews.get(fixture.fixtureId)!;
      const truthActivity = new Map<string, Set<number>>(), reviewActivity = new Map<string, Set<number>>();
      const reviewToTruth = new Map<string, Set<string>>(), truthToReview = new Map<string, Set<string>>();
      for (const [ordinal, frame] of fixture.frames.entries()) {
        metrics.frameCount++;
        const review = receipt.results[ordinal].result;
        if (frame.state === "TRUTH_AMBIGUOUS") { if (review.type !== "UNKNOWN") metrics.missedUnknown++; }
        else {
          metrics.clearFrameCount++; metrics.targetFrameCount += frame.targets.length;
          for (const target of frame.targets) { const active = truthActivity.get(target.id) ?? new Set(); active.add(ordinal); truthActivity.set(target.id, active); }
          if (review.type === "UNKNOWN") metrics.unnecessaryUnknownCount++;
        }
        const matched = new Set<string>();
        if (review.type === "TARGETS") for (const target of review.targets) {
          declaredPairs++;
          const key = `${fixture.fixtureId}:${ordinal}:${target.id}`;
          if (!correspondence.has(key)) throw new Error("unadjudicated review target");
          const targetId = correspondence.get(key);
          if (targetId === null) { metrics.falsePositiveTargetFrames++; continue; }
          if (frame.state === "TRUTH_AMBIGUOUS") continue;
          if (!frame.targets.some(t => t.id === targetId) || matched.has(targetId!)) metrics.falsePositiveTargetFrames++;
          matched.add(targetId!);
          const active = reviewActivity.get(targetId!) ?? new Set(); active.add(ordinal); reviewActivity.set(targetId!, active);
          const truthIds = reviewToTruth.get(target.id) ?? new Set(); truthIds.add(targetId!); reviewToTruth.set(target.id, truthIds);
          const reviewIds = truthToReview.get(targetId!) ?? new Set(); reviewIds.add(target.id); truthToReview.set(targetId!, reviewIds);
        }
        if (frame.state === "KNOWN") {
          const missed = frame.targets.filter(t => !matched.has(t.id)).length;
          metrics.missedTargetFrames += missed;
          if (frame.targets.length >= 2 && missed > 0) metrics.multiTargetMissCount++;
        }
      }
      for (const identities of reviewToTruth.values()) if (identities.size > 1) metrics.identityMergeErrors += identities.size - 1;
      for (const identities of truthToReview.values()) if (identities.size > 1) metrics.identitySplitErrors += identities.size - 1;
      for (const targetId of new Set([...truthActivity.keys(), ...reviewActivity.keys()])) {
        const actual = truthActivity.get(targetId) ?? new Set<number>(), declared = reviewActivity.get(targetId) ?? new Set<number>();
        for (const ordinal of new Set([...actual, ...declared])) if (actual.has(ordinal) !== declared.has(ordinal)) metrics.boundaryErrorFrames++;
        for (const ordinal of actual) if (!actual.has(ordinal - 1) && !actual.has(ordinal + 1) && !declared.has(ordinal)) metrics.singleFrameAppearanceMisses++;
        const active = [...actual].sort((a, b) => a - b);
        for (let i = 1; i < active.length; i++) if (active[i] > active[i - 1] + 1) {
          const gap = Array.from({ length: active[i] - active[i - 1] - 1 }, (_, k) => active[i - 1] + k + 1);
          if (declared.has(active[i - 1]) && declared.has(active[i]) && gap.every(f => declared.has(f))) metrics.bridgedAbsenceIntervals++;
        }
      }
    }
    metrics.unnecessaryUnknownRate = metrics.clearFrameCount ? metrics.unnecessaryUnknownCount / metrics.clearFrameCount : 0;
    metrics.targetFrameRecall = metrics.targetFrameCount ? (metrics.targetFrameCount - metrics.missedTargetFrames) / metrics.targetFrameCount : 1;
    metrics.falsePositiveRate = declaredPairs ? metrics.falsePositiveTargetFrames / declaredPairs : 0;
    metricsComplete = true;
    for (const gate of QUALIFICATION_CRITERIA.zeroTolerance) if (metrics[gate] > 0) failures.push(gate);
    if (failures.length) return finish("NOT_QUALIFIED");
    if (!qualificationCoverage(pack).sufficient) { failures.push("DATASET_COVERAGE_INSUFFICIENT"); return finish("INCOMPLETE"); }
    if (metrics.unnecessaryUnknownCount * 100 > metrics.clearFrameCount * pack.criteria.unnecessaryUnknownPercent) { failures.push("unnecessaryUnknownRate"); return finish("NOT_QUALIFIED"); }
    return finish("QUALIFIED");
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "qualification evidence unavailable"); return finish("INCOMPLETE");
  }
}
