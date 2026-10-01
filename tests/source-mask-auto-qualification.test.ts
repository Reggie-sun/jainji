import { appendFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTO_CONTOUR_CONFIG, extractAutomaticSourceContours } from "../src/main/source-mask-auto-extraction";
import { evaluateAutoContours, freezeAutoContourEvaluation } from "../src/main/source-mask-auto-qualification";
import { contourEvidence, contourHash, packedTruth, TARGET_A, TARGET_B } from "./helpers/auto-contour-evidence";

let fixture: Awaited<ReturnType<typeof contourEvidence>>;
beforeAll(async () => { fixture = await contourEvidence(); }, 30000);
afterAll(async () => { await fixture?.close(); });

type TruthScope = "CONTROLLED_CONSTRUCTION" | "REAL_MEDIA";
type Motion = "STATIC" | "STATIONARY_ANIMATION" | "MOVING" | "UNKNOWN";

function binding(index: number, evidence = fixture.evidence) {
  const frame = evidence.census.frames[index];
  return { index: frame.index, pts: frame.pts, endPts: frame.endPts, byteLength: frame.byteLength, pixelSha256: frame.pixelSha256 };
}

function truthSet(options: { evidence?: Awaited<ReturnType<typeof contourEvidence>>["evidence"]; pixels?: number[][]; scope?: TruthScope; motionA?: Motion;
  stateA?: "VISIBLE" | "NOT_VISIBLE" | "UNKNOWN"; extraA?: number[]; omitPixelA?: number; omitAFrame?: number; duplicateAFrame?: number; includeB?: boolean } = {}) {
  const evidence = options.evidence ?? fixture.evidence;
  const pixelsByFrame = options.pixels ?? fixture.pixels;
  const a = pixelsByFrame.map((pixels, index) => {
    const state = index === options.omitAFrame ? undefined : options.stateA ?? (pixels.length ? "VISIBLE" as const : "NOT_VISIBLE" as const);
    const points = [...pixels.filter(point => point !== options.omitPixelA), ...(index === pixelsByFrame.length - 1 ? options.extraA ?? [] : [])];
    const visiblePoints = state === "VISIBLE" && points.length === 0 ? pixels : points;
    return { binding: binding(index, evidence), state, mask: state === "VISIBLE" ? packedTruth(visiblePoints) : null,
      reason: state === "UNKNOWN" ? "controlled truth is unresolved" : null,
      motion: options.motionA ?? "STATIONARY_ANIMATION" };
  }).filter(frame => frame.state !== undefined);
  if (options.duplicateAFrame !== undefined) a.push(structuredClone(a[options.duplicateAFrame]!));
  const targets = [{ targetId: TARGET_A, frames: a }];
  if (options.includeB !== false) targets.push({ targetId: TARGET_B, frames: pixelsByFrame.map((_, index) => ({ binding: binding(index, evidence), state: "VISIBLE" as const,
    mask: packedTruth([20 * 32 + 20]), reason: null, motion: "STATIC" as const })) });
  return { scope: options.scope ?? "CONTROLLED_CONSTRUCTION" as const, authorId: "truth-author", reviewerId: "truth-reviewer", targets };
}

async function freeze(truth = truthSet(), config = AUTO_CONTOUR_CONFIG, evidence = fixture.evidence) {
  return freezeAutoContourEvaluation({ evidence, config, truthSet: truth });
}

async function candidate(config = AUTO_CONTOUR_CONFIG, declarations = fixture.declarations, evidence = fixture.evidence) {
  return extractAutomaticSourceContours({ evidence, declarations, config, signal: new AbortController().signal });
}

describe("automatic contour truth comparison", { timeout: 60000 }, () => {
  it("freezes controlled truth before extraction and reports exact original-grid agreement as development-only", async () => {
    const frozen = await freeze();
    const alteredTruth = await freeze(truthSet({ omitPixelA: 5 * 32 + 5 }));
    const extracted = await candidate();
    const [result, altered] = await Promise.all([evaluateAutoContours(frozen, extracted), evaluateAutoContours(alteredTruth, extracted)]);
    expect(result).toMatchObject({ status: "DEVELOPMENT_MATCH", authority: "none", eligible: false,
      evaluationReceiptDigest: frozen.receipt.receiptDigest, truthDigest: frozen.receipt.truthDigest,
      candidateReceiptDigest: extracted.receipt.receiptDigest, criteriaDigest: frozen.receipt.criteriaDigest,
      maskReview: "NOT_EVALUATED", motionReview: "NOT_EVALUATED", semanticReview: "NOT_EVALUATED" });
    expect(result.metrics).toMatchObject({ visibleFrameDenominator: 11, missingVisibleFrames: 0, pixelDenominator: 33,
      omittedPixels: 0, overcoveragePixels: 0, truthUnknownFrames: 0, candidateUnknownFrames: 0, unknownMotionTargets: 0 });
    expect(result.failures).toEqual([]);
    const { resultDigest, ...resultBody } = result;
    expect(resultDigest).toBe(contourHash(JSON.stringify(resultBody)));
    expect(altered.truthDigest).not.toBe(result.truthDigest);
    expect(altered.evaluationReceiptDigest).not.toBe(result.evaluationReceiptDigest);
    expect(altered.candidateReceiptDigest).toBe(result.candidateReceiptDigest);
    expect(altered.resultDigest).not.toBe(result.resultDigest);
  });

  it("fails on one required tip pixel or one required visible frame", async () => {
    const edgeTruth = truthSet({ extraA: [6 * 32 + 9] });
    const frameTruth = truthSet({ stateA: "VISIBLE", pixels: fixture.pixels.map((pixels, index) => index === 2 ? [5 * 32 + 5, 6 * 32 + 4,
      6 * 32 + 5, 6 * 32 + 6, 7 * 32 + 5] : pixels) });
    const [edgeFrozen, frameFrozen] = await Promise.all([freeze(edgeTruth), freeze(frameTruth)]);
    const extracted = await candidate();
    const [edge, frame] = await Promise.all([evaluateAutoContours(edgeFrozen, extracted), evaluateAutoContours(frameFrozen, extracted)]);
    expect(edge).toMatchObject({ status: "NOT_QUALIFIED" });
    expect(edge.metrics).toMatchObject({ pixelDenominator: 34, omittedPixels: 1 });
    expect(edge.failures).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_PIXELS", targetId: TARGET_A, frameIndex: 5 }));
    expect(frame).toMatchObject({ status: "NOT_QUALIFIED" });
    expect(frame.failures).toContainEqual(expect.objectContaining({ code: "MISSING_VISIBLE_FRAME", targetId: TARGET_A, frameIndex: 2 }));
  });

  it("rejects an omitted target identity even when another target remains complete", async () => {
    const frozen = await freeze();
    const onlyB = fixture.declarations.map(value => ({ ...value, declaration: { ...value.declaration,
      targets: value.declaration.type === "TARGETS" ? value.declaration.targets.filter(target => target.id === TARGET_B) : [] } }));
    const extracted = await candidate(AUTO_CONTOUR_CONFIG, onlyB);
    const result = await evaluateAutoContours(frozen, extracted);
    expect(result.status).toBe("NOT_QUALIFIED");
    expect(result.failures).toContainEqual(expect.objectContaining({ code: "MISSING_TARGET_IDENTITY", targetId: TARGET_A }));
    expect(result.metrics).toMatchObject({ visibleFrameDenominator: 11, missingVisibleFrames: 5, pixelDenominator: 33 });
  });

  it("reports excess pixels and frames as overcoverage without a safety or naturalness claim", async () => {
    const frozen = await freeze(truthSet({ omitPixelA: 5 * 32 + 5 }));
    const extracted = await candidate();
    const result = await evaluateAutoContours(frozen, extracted);
    expect(result.status).toBe("DEVELOPMENT_MATCH");
    expect(result.metrics.overcoveragePixels).toBe(5);
    expect(result).toMatchObject({ maskReview: "NOT_EVALUATED", motionReview: "NOT_EVALUATED", semanticReview: "NOT_EVALUATED" });
  });

  it("compares a second extractor method only against its own frozen config", async () => {
    const method = { ...AUTO_CONTOUR_CONFIG, method: "temporal-stable-exterior-difference/v1" as const };
    const frozen = await freeze(truthSet(), method);
    const extracted = await candidate(method);
    const result = await evaluateAutoContours(frozen, extracted);
    expect(result).toMatchObject({ status: "INCOMPLETE", configDigest: frozen.receipt.configDigest,
      metrics: { truthUnknownFrames: 0, candidateUnknownFrames: 6, pixelDenominator: null, omittedPixels: null } });
  });

  it("rejects a moving target with a usable candidate and leaves unknown truth or masks incomplete", async () => {
    const [movingFrozen, unknownTruthFrozen, unknownMotionFrozen] = await Promise.all([freeze(truthSet({ motionA: "MOVING" })),
      freeze(truthSet({ stateA: "UNKNOWN" })), freeze(truthSet({ motionA: "UNKNOWN" }))]);
    const extracted = await candidate();
    const [moving, unknownTruth, unknownMotion] = await Promise.all([evaluateAutoContours(movingFrozen, extracted),
      evaluateAutoContours(unknownTruthFrozen, extracted), evaluateAutoContours(unknownMotionFrozen, extracted)]);
    expect(moving.status).toBe("NOT_QUALIFIED");
    expect(moving.failures).toContainEqual(expect.objectContaining({ code: "MOVING_TARGET_ACCEPTED", targetId: TARGET_A }));
    expect(unknownTruth).toMatchObject({ status: "INCOMPLETE", metrics: { truthUnknownFrames: 6, candidateUnknownFrames: 0,
      pixelDenominator: null, omittedPixels: null, overcoveragePixels: null } });
    expect(unknownMotion).toMatchObject({ status: "INCOMPLETE", metrics: { truthUnknownFrames: 0, candidateUnknownFrames: 0,
      unknownMotionTargets: 1, pixelDenominator: 33, omittedPixels: 0 } });

    const ambiguous = await contourEvidence("ambiguous");
    try {
      const [ambiguousFrozen, bothUnknownFrozen] = await Promise.all([
        freeze(truthSet({ evidence: ambiguous.evidence, pixels: ambiguous.pixels }), AUTO_CONTOUR_CONFIG, ambiguous.evidence),
        freeze(truthSet({ stateA: "UNKNOWN", evidence: ambiguous.evidence, pixels: ambiguous.pixels }), AUTO_CONTOUR_CONFIG, ambiguous.evidence),
      ]);
      const ambiguousCandidate = await candidate(AUTO_CONTOUR_CONFIG, ambiguous.declarations, ambiguous.evidence);
      const result = await evaluateAutoContours(ambiguousFrozen, ambiguousCandidate);
      expect(result).toMatchObject({ status: "INCOMPLETE", metrics: { truthUnknownFrames: 0, candidateUnknownFrames: 5,
        pixelDenominator: null, omittedPixels: null, overcoveragePixels: null } });
      const bothUnknown = await evaluateAutoContours(bothUnknownFrozen, ambiguousCandidate);
      expect(bothUnknown).toMatchObject({ status: "INCOMPLETE", metrics: { truthUnknownFrames: 6, candidateUnknownFrames: 5,
        pixelDenominator: null, omittedPixels: null } });
    } finally { await ambiguous.close(); }
  });

  it("keeps unreviewed real-media truth NOT_EVALUATED and never upgrades a single source to corpus qualification", async () => {
    const frozen = await freeze(truthSet({ scope: "REAL_MEDIA", motionA: "MOVING", extraA: [6 * 32 + 9] }));
    const extracted = await candidate();
    const result = await evaluateAutoContours(frozen, extracted);
    expect(result).toMatchObject({ status: "INCOMPLETE", authority: "none", eligible: false,
      metrics: { visibleFrameDenominator: null, pixelDenominator: null, omittedPixels: null, overcoveragePixels: null,
        truthUnknownFrames: null, candidateUnknownFrames: null, unknownMotionTargets: null }, failures: [],
      reasons: expect.arrayContaining(["REAL_MEDIA_TRUTH_NOT_INDEPENDENTLY_REVIEWED", "CORPUS_AC09_NOT_EVALUATED"]) });
  });

  it("rejects unowned clones, late freezes, config/source mismatches and duplicate or unbound truth frames", async () => {
    const lateCandidate = await candidate();
    const lateFreeze = await freeze();
    await expect(evaluateAutoContours(lateFreeze, lateCandidate)).rejects.toThrow(/INCOMPLETE.*frozen after extraction began/i);

    const frozen = await freeze();
    const mismatched = await freeze(truthSet(), { ...AUTO_CONTOUR_CONFIG, method: "temporal-stable-exterior-difference/v1" });
    const extracted = await candidate();
    await expect(evaluateAutoContours(JSON.parse(JSON.stringify(frozen)), extracted)).rejects.toThrow(/UNSAFE.*not process-owned/i);
    await expect(evaluateAutoContours(frozen, JSON.parse(JSON.stringify(extracted)))).rejects.toThrow(/UNSAFE.*not owned/i);

    await expect(evaluateAutoContours(mismatched, extracted)).rejects.toThrow(/INCOMPLETE.*configuration mismatch/i);

    const duplicate = truthSet({ duplicateAFrame: 0 });
    await expect(freeze(duplicate)).rejects.toThrow(/INCOMPLETE.*duplicate truth frame/i);
    const missing = truthSet({ omitAFrame: 2 });
    await expect(freeze(missing)).rejects.toThrow(/INCOMPLETE.*missing truth frame/i);
    const malformed = truthSet();
    malformed.targets[0]!.frames[0]!.binding.pixelSha256 = "0".repeat(64);
    await expect(freeze(malformed)).rejects.toThrow(/INCOMPLETE.*frame binding/i);
    const collidingActor = truthSet();
    collidingActor.authorId = "auto-contour-extractor-development/v1:per-frame-exterior-difference/v1";
    await expect(freeze(collidingActor)).rejects.toThrow(/INCOMPLETE.*identities must be distinct/i);
    const authorityClaim = Object.assign(truthSet(), { authority: "qualified" });
    await expect(freeze(authorityClaim)).rejects.toThrow();

    const other = await contourEvidence("static");
    try {
      const otherCandidate = await candidate(AUTO_CONTOUR_CONFIG, other.declarations, other.evidence);
      await expect(evaluateAutoContours(frozen, otherCandidate)).rejects.toThrow(/INCOMPLETE.*source or evidence mismatch/i);
    } finally { await other.close(); }
  });

  it("rejects closed evidence and source changes after freezing", async () => {
    const changed = await contourEvidence();
    try {
      const frozen = await freeze(truthSet({ evidence: changed.evidence, pixels: changed.pixels }), AUTO_CONTOUR_CONFIG, changed.evidence);
      const extracted = await candidate(AUTO_CONTOUR_CONFIG, changed.declarations, changed.evidence);
      await appendFile(changed.sourcePath, Buffer.from([0]));
      await expect(evaluateAutoContours(frozen, extracted)).rejects.toThrow(/UNSAFE/);
    } finally { await changed.close(); }

    const closed = await contourEvidence();
    try {
      const frozen = await freeze(truthSet({ evidence: closed.evidence, pixels: closed.pixels }), AUTO_CONTOUR_CONFIG, closed.evidence);
      const extracted = await candidate(AUTO_CONTOUR_CONFIG, closed.declarations, closed.evidence);
      await closed.evidence.close();
      await expect(evaluateAutoContours(frozen, extracted)).rejects.toThrow(/UNSAFE.*not owned or has been closed/i);
    } finally { await closed.close(); }
  });
});
