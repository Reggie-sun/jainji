import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QUALIFICATION_CRITERIA, QUALIFICATION_SCENARIOS, qualificationDigest, assertQualificationPackage,
  HumanReviewMethodQualificationRecordSchema, type QualificationPackage, type QualificationCorrespondence } from "../src/main/source-fact-qualification-contract";
import { compareHumanReviewQualification, inspectLiveQualificationRecord, qualificationCoverage, type QualificationReviewReceipt } from "../src/main/source-fact-qualification-compare";
import { EMPTY_FRAME_CONFIRMATION, TARGET_SET_CONFIRMATION } from "../src/main/source-fact-review-session";
import type { FullSourceCensus } from "../src/main/source-fact-census";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const frozenAt = "2026-09-28T00:00:00.000Z", runAt = "2026-09-28T01:00:00.000Z";
// Deliberately simulated D1/receipt evidence. It tests comparison arithmetic, never human qualification.
function comparisonFixture() {
  const fixtures: QualificationPackage["manifest"]["fixtures"] = [], truths: QualificationPackage["truth"]["fixtures"] = [];
  const reviews: { fixtureId: string; receipt: QualificationReviewReceipt }[] = [];
  const entries: QualificationCorrespondence["entries"] = [];
  for (const [index, scenario] of QUALIFICATION_SCENARIOS.entries()) {
    const fixtureId = randomUUID(), evidenceId = randomUUID();
    const source = { fingerprint: `sha256:${sha(fixtureId)}`, byteLength: 128, width: 32, height: 32, rotation: 0 as const,
      durationMs: 1000, timeBase: "1/8000", timeOriginPts: 0, interpretationVersion: 1 };
    const body: Omit<FullSourceCensus, "censusDigest"> = { schemaVersion: 1, authority: "none", semanticReview: "NOT_EVALUATED", eligible: false, source,
      decode: { profile: "full-decode-rgba-v1", pixelFormat: "rgba", streamIndex: 0, ffmpegFingerprint: `sha256:${sha("fake-engine")}`, ffprobeFingerprint: `sha256:${sha("fake-probe")}`,
        inputInterpretation: { pixelFormat: "yuv444p", colorRange: "unknown", colorSpace: "unknown", colorPrimaries: "unknown", colorTransfer: "unknown" } },
      horizon: { startPts: 0, endPts: 8000, frameCount: 8 }, frames: Array.from({ length: 8 }, (_, ordinal) => ({ index: ordinal, pts: ordinal * 1000, endPts: (ordinal + 1) * 1000, byteLength: 4096, pixelSha256: sha(`${index}:${ordinal}`) })) };
    const census = { ...body, censusDigest: sha(JSON.stringify(body)) };
    fixtures.push({ fixtureId, groupId: `group-${index % 3}`, sourceKind: "SYNTHETIC_CONTROLLED", sourceFile: `${fixtureId}.mp4`, sourceIdentity: source, censusDigest: census.censusDigest, frameCount: 8 });
    const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
    const truthTargets = (ordinal: number) => {
      let visible: (keyof typeof ids)[] = [];
      if (scenario === "first-frame") visible = ordinal === 0 ? ["a"] : [];
      else if (scenario === "last-frame") visible = ordinal === 7 ? ["a"] : [];
      else if (scenario === "single-frame") visible = ordinal === 3 ? ["a"] : [];
      else if (scenario === "reappearance") visible = [0, 1, 4, 5].includes(ordinal) ? ["a"] : [];
      else if (scenario === "cuts") visible = ordinal < 3 ? ["a"] : ordinal < 5 ? ["b"] : ["c"];
      else if (scenario === "simultaneous") visible = ordinal >= 1 && ordinal <= 6 ? ["a", "b", "c"] : [];
      else if (!["no-sticker", "identity-ambiguous", "semantic-ambiguous"].includes(scenario)) visible = ordinal >= 1 && ordinal <= 6 ? ["a"] : [];
      return visible.map(id => ({ id, description: `independent truth ${id}`, category: scenario === "moving" || scenario === "reappearance" ? "moving" as const : scenario === "animated" ? "animated" as const : "static" as const,
        state: "VISIBLE" as const, bbox: { x: 1, y: 1, width: 4, height: 4 } }));
    };
    const frames: QualificationPackage["truth"]["fixtures"][number]["frames"] = census.frames.map(frame => {
      const binding = { ordinal: frame.index, pts: frame.pts, endPts: frame.endPts, byteLength: frame.byteLength, pixelSha256: frame.pixelSha256 };
      return scenario.endsWith("ambiguous") && [3, 4].includes(frame.index) ? { binding, state: "TRUTH_AMBIGUOUS", ambiguity: scenario === "identity-ambiguous" ? "identity" : "sticker-category", reason: "independent truth genuinely ambiguous" }
        : { binding, state: "KNOWN", targets: truthTargets(frame.index) };
    });
    const cases: QualificationPackage["truth"]["fixtures"][number]["cases"] = [{ caseId: scenario, scenario, startOrdinal: 0, endOrdinal: 8, rationale: "simulated case with explicit frame truth" }];
    if (scenario === "cuts") for (const ordinal of [1, 3, 5]) cases.push({ caseId: `cut-${ordinal}`, scenario, startOrdinal: ordinal, endOrdinal: ordinal + 2, rationale: "separate simulated cut" });
    if (scenario === "reappearance") cases.push({ caseId: "moving-reappearance", scenario: "moving", startOrdinal: 0, endOrdinal: 6, rationale: "moving target with absence" });
    if (scenario.endsWith("ambiguous")) for (const ordinal of [3, 4]) cases.push({ caseId: `ambiguity-${ordinal}`, scenario, startOrdinal: ordinal, endOrdinal: ordinal + 1, rationale: "true ambiguity" });
    truths.push({ fixtureId, census, frames, cases });
    const results: QualificationReviewReceipt["results"] = frames.map(frame => {
      const presentationId = randomUUID();
      const result: QualificationReviewReceipt["results"][number]["result"] = frame.state === "TRUTH_AMBIGUOUS" ? { type: "UNKNOWN", presentationId, reason: "cannot reliably determine" }
        : !frame.targets.length ? { type: "EMPTY", presentationId, confirmation: EMPTY_FRAME_CONFIRMATION }
        : { type: "TARGETS", presentationId, confirmation: TARGET_SET_CONFIRMATION, targets: frame.targets.map(t => ({ id: ids[t.id as keyof typeof ids], label: `reviewer description ${t.id}`, kind: t.category })) };
      if (result.type === "TARGETS") result.targets.forEach(t => entries.push({ fixtureId, ordinal: frame.binding.ordinal, reviewTargetId: t.id, truthTargetId: Object.entries(ids).find(([, id]) => id === t.id)![0] }));
      return { binding: { evidenceId, ...frame.binding }, result, reviewedAt: runAt, presentation: "CLIENT_REPORTED_FULL_CANVAS" };
    });
    reviews.push({ fixtureId, receipt: { schemaVersion: 1, authority: "none", eligible: false, semanticReview: "RECORDED_NOT_QUALIFIED", methodQualification: "NOT_EVALUATED",
      session: { sessionId: randomUUID(), sourceIdentity: source, censusDigest: census.censusDigest, reviewMethodVersion: QUALIFICATION_CRITERIA.methodId, frameCount: 8,
        reviewerId: "simulated-reviewer-not-human", createdAt: runAt, recordedOrdinals: [0,1,2,3,4,5,6,7], frozen: true }, decode: census.decode, horizon: census.horizon,
      evidenceId, reviewedAt: runAt, results, declaredTargets: [], unknownIntervals: [], unverifiedIntervals: [{ startFrame: 0, endFrame: 8, startPts: 0, endPts: 8000 }], receiptDigest: "" } });
  }
  const manifest = { schemaVersion: 1 as const, datasetVersion: "test-only/v1", truthAuthorId: "independent-simulated-author", truthCreationVersion: "test/v1", truthReviewVersion: "test-audit/v1", createdAt: frozenAt,
    sourceSnapshot: [{ path: "test-only-not-live", sha256: sha("test-only") }], fixtures };
  const truth = { schemaVersion: 1 as const, datasetVersion: manifest.datasetVersion, truthAuthorId: manifest.truthAuthorId, truthCreationVersion: manifest.truthCreationVersion, truthReviewVersion: manifest.truthReviewVersion, fixtures: truths };
  const pack: QualificationPackage = { manifest, truth, datasetDigest: qualificationDigest(manifest), truthDigest: qualificationDigest(truth), criteria: QUALIFICATION_CRITERIA,
    criteriaDigest: qualificationDigest(QUALIFICATION_CRITERIA), frozenAt };
  const correspondence: QualificationCorrespondence = { schemaVersion: 1, version: QUALIFICATION_CRITERIA.correspondenceVersion, datasetDigest: pack.datasetDigest,
    truthDigest: pack.truthDigest, reviewReceiptDigest: "", adjudicatorId: manifest.truthAuthorId, entries, unresolved: [] };
  const input = { package: pack, reviews, correspondence };
  const reseal = () => {
    for (const { receipt } of reviews) {
      const targets = new Map(); receipt.unknownIntervals = [];
      for (const [ordinal, frame] of receipt.results.entries()) {
        if (frame.result.type === "TARGETS") frame.result.targets.forEach(t => targets.set(t.id, t));
        if (frame.result.type === "UNKNOWN") {
          const last = receipt.unknownIntervals.at(-1);
          if (last?.endFrame === ordinal) { last.endFrame++; last.endPts = frame.binding.endPts; }
          else receipt.unknownIntervals.push({ startFrame: ordinal, endFrame: ordinal + 1, startPts: frame.binding.pts, endPts: frame.binding.endPts });
        }
      }
      receipt.declaredTargets = [...targets.values()].sort((a, b) => a.id.localeCompare(b.id));
      const { receiptDigest: _, ...body } = receipt; receipt.receiptDigest = sha(JSON.stringify(body));
    }
    correspondence.reviewReceiptDigest = qualificationDigest(reviews.map(r => ({ fixtureId: r.fixtureId, receiptDigest: r.receipt.receiptDigest })).sort((a, b) => a.fixtureId.localeCompare(b.fixtureId)));
  };
  const setUnknown = (fixture: number, ordinal: number) => {
    const record = reviews[fixture].receipt.results[ordinal]; record.result = { type: "UNKNOWN", presentationId: record.result.presentationId, reason: "uncertain" };
    correspondence.entries = correspondence.entries.filter(e => e.fixtureId !== reviews[fixture].fixtureId || e.ordinal !== ordinal);
  };
  reseal(); return { input, reseal, setUnknown };
}

describe("frozen D2Q criteria", () => {
  it("keeps every semantic gate at zero and usability at five percent", () => {
    expect(QUALIFICATION_CRITERIA).toMatchObject({ criteriaVersion: "human-full-canvas-qualification/v1", unnecessaryUnknownPercent: 5,
      minimumClearFrames: 100, minimumFrames: 100, minimumGroups: 3 });
    expect(Object.isFrozen(QUALIFICATION_CRITERIA)).toBe(true);
    expect(qualificationDigest({ a: 1, b: 2 })).toBe(qualificationDigest({ b: 2, a: 1 }));
  });
  it("incomplete input cannot obtain a qualified record", () => {
    const result = compareHumanReviewQualification({});
    expect(result.qualificationStatus).toBe("INCOMPLETE");
    expect(result.authority).toBe("none");
    expect(result.qualificationRecord).toBeNull();
  });
  it("live inspection detects the first bound false EMPTY before a full receipt can exist", () => {
    const { input } = comparisonFixture(); const item = input.reviews[3], frame = item.receipt.results[3];
    const command = { type: "EMPTY", presentationId: frame.result.presentationId, confirmation: EMPTY_FRAME_CONFIRMATION };
    const raw = { binding: frame.binding, result: command };
    expect(inspectLiveQualificationRecord(input.package, item.fixtureId, raw).falseEmpty).toBe(true);
    expect(() => inspectLiveQualificationRecord(input.package, item.fixtureId, { ...raw, binding: { ...raw.binding, ordinal: 2 } })).toThrow();
    expect(() => inspectLiveQualificationRecord(input.package, item.fixtureId, { ...raw, qualified: true })).toThrow();
  });
});

describe("independent truth comparison (automated evidence only)", () => {
  it("validates all 18 scenes and calculates a match without qualifying a human or changing receipts", () => {
    const { input } = comparisonFixture(); const before = JSON.stringify(input);
    expect(qualificationCoverage(assertQualificationPackage(input.package))).toMatchObject({ sufficient: true, frames: 144, clear: 140 });
    const result = compareHumanReviewQualification(input);
    expect(result).toMatchObject({ comparisonStatus: "QUALIFIED", qualificationStatus: "INCOMPLETE", qualificationRecord: null, metricsComplete: true,
      metrics: { targetFrameRecall: 1, missedTargetFrames: 0, missedUnknown: 0, identityMergeErrors: 0, identitySplitErrors: 0 } });
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each([0,3,7])("one false EMPTY at ordinal %i is immediately fatal, regardless of coverage/mapping or later successes", ordinal => {
    const { input, reseal } = comparisonFixture(); const frame = input.reviews[7].receipt.results[ordinal];
    // Extend the same simulated moving identity to an endpoint to test fatal detection there.
    const truth = input.package.truth.fixtures[7].frames[ordinal];
    if (truth.state === "KNOWN" && !truth.targets.length) truth.targets = [{ id: "a", description: "independent truth a", category: "moving", state: "VISIBLE", bbox: { x: 1, y: 1, width: 4, height: 4 } }];
    input.package.truthDigest = qualificationDigest(input.package.truth);
    frame.result = { type: "EMPTY", presentationId: frame.result.presentationId, confirmation: EMPTY_FRAME_CONFIRMATION };
    reseal(); input.reviews = [input.reviews[7]]; input.correspondence.entries = [];
    const result = compareHumanReviewQualification(input);
    expect(result).toMatchObject({ comparisonStatus: "NOT_QUALIFIED", qualificationStatus: "NOT_QUALIFIED", metricsComplete: false, metrics: { falseEmptyCount: 1 } });
    expect(result.failures[0]).toContain(`:${ordinal}`);
  });
  it("counts a missing simultaneous target even if another target was correctly seen", () => {
    const { input, reseal } = comparisonFixture(); const frame = input.reviews[2].receipt.results[3];
    if (frame.result.type !== "TARGETS") throw Error("fixture");
    const removed = frame.result.targets.pop()!;
    input.correspondence.entries = input.correspondence.entries.filter(e => !(e.fixtureId === input.reviews[2].fixtureId && e.ordinal === 3 && e.reviewTargetId === removed.id));
    reseal(); const result = compareHumanReviewQualification(input);
    expect(result.comparisonStatus).toBe("NOT_QUALIFIED");
    expect(result.metrics).toMatchObject({ missedTargetFrames: 1, multiTargetMissCount: 1, boundaryErrorFrames: 1, falseEmptyCount: 0 });
  });
  it.each([3,4,5])("an UNKNOWN replacing a clear single/first/last-frame target cannot satisfy exhaustive recall: fixture %i", fixture => {
    const { input, reseal, setUnknown } = comparisonFixture(); setUnknown(fixture, fixture === 4 ? 0 : fixture === 5 ? 7 : 3); reseal();
    const result = compareHumanReviewQualification(input);
    expect(result.metrics).toMatchObject({ missedTargetFrames: 1, singleFrameAppearanceMisses: 1, boundaryErrorFrames: 1, unnecessaryUnknownCount: 1 });
    expect(result.qualificationStatus).toBe("NOT_QUALIFIED");
  });
  it.each([7,8,10,11,12,13,14,15])("does not overlook a moving/animated/central/tiny/edge/low-contrast/fine/confounded target: fixture %i", fixture => {
    const { input, reseal, setUnknown } = comparisonFixture(); setUnknown(fixture, 2); reseal();
    const result = compareHumanReviewQualification(input);
    expect(result.metrics).toMatchObject({ missedTargetFrames: 1, boundaryErrorFrames: 1, falseEmptyCount: 0 });
    expect(result.comparisonStatus).toBe("NOT_QUALIFIED");
  });
  it("rejects bridging an absence, including every ordinal rather than approximate timing", () => {
    const { input, reseal } = comparisonFixture(); const receipt = input.reviews[9].receipt;
    const reference = receipt.results[0].result; if (reference.type !== "TARGETS") throw Error("fixture");
    for (const ordinal of [2,3]) {
      receipt.results[ordinal].result = { ...reference, presentationId: receipt.results[ordinal].result.presentationId };
      input.correspondence.entries.push({ fixtureId: input.reviews[9].fixtureId, ordinal, reviewTargetId: reference.targets[0].id, truthTargetId: "a" });
    }
    reseal(); const result = compareHumanReviewQualification(input);
    expect(result.metrics).toMatchObject({ bridgedAbsenceIntervals: 1, boundaryErrorFrames: 2, falsePositiveTargetFrames: 2 });
    expect(result.comparisonStatus).toBe("NOT_QUALIFIED");
  });
  it.each(["EMPTY", "TARGETS"] as const)("truth ambiguity requires UNKNOWN, not %s", type => {
    const { input, reseal } = comparisonFixture(); const frame = input.reviews[16].receipt.results[3];
    if (type === "EMPTY") frame.result = { type, presentationId: frame.result.presentationId, confirmation: EMPTY_FRAME_CONFIRMATION };
    else {
      const id = randomUUID(); frame.result = { type, presentationId: frame.result.presentationId, confirmation: TARGET_SET_CONFIRMATION, targets: [{ id, label: "guessed", kind: "unresolved" }] };
      input.correspondence.entries.push({ fixtureId: input.reviews[16].fixtureId, ordinal: 3, reviewTargetId: id, truthTargetId: null });
    }
    reseal(); const result = compareHumanReviewQualification(input); expect(result.metrics.missedUnknown).toBe(1); expect(result.comparisonStatus).toBe("NOT_QUALIFIED");
  });
  it.each([7,8])("five percent is frozen: %i unnecessary UNKNOWN over 140 clear frames", count => {
    const { input, reseal, setUnknown } = comparisonFixture(); for (let ordinal = 0; ordinal < count; ordinal++) setUnknown(0, ordinal); reseal();
    const result = compareHumanReviewQualification(input);
    expect(result.metrics.unnecessaryUnknownRate).toBe(count / 140);
    expect(result.comparisonStatus).toBe(count === 7 ? "QUALIFIED" : "NOT_QUALIFIED");
    expect(result.qualificationRecord).toBeNull();
  });
  it("does not judge a usability rate when the clear-frame sample is insufficient", () => {
    const { input, reseal, setUnknown } = comparisonFixture();
    for (let fixture = 0; fixture < 6; fixture++) for (let ordinal = 0; ordinal < 8; ordinal++) {
      const binding = input.package.truth.fixtures[fixture].frames[ordinal].binding;
      input.package.truth.fixtures[fixture].frames[ordinal] = { binding, state: "TRUTH_AMBIGUOUS", ambiguity: "sticker-category", reason: "test-only ambiguous sample" };
      setUnknown(fixture, ordinal);
    }
    for (const ordinal of [0,1,2,5,6,7]) setUnknown(16, ordinal);
    input.package.truthDigest = qualificationDigest(input.package.truth); input.correspondence.truthDigest = input.package.truthDigest;
    reseal(); const result = compareHumanReviewQualification(input);
    expect(result.metrics.clearFrameCount).toBe(92); expect(result.metrics.unnecessaryUnknownRate).toBeGreaterThan(0.05);
    expect(result.comparisonStatus).toBe("INCOMPLETE"); expect(result.failures).toContain("DATASET_COVERAGE_INSUFFICIENT");
  });
  it("counts a non-sticker false positive and uses declared target-frames as the precision denominator", () => {
    const { input, reseal } = comparisonFixture(); const frame = input.reviews[0].receipt.results[0], id = randomUUID();
    frame.result = { type: "TARGETS", presentationId: frame.result.presentationId, confirmation: TARGET_SET_CONFIRMATION, targets: [{ id, label: "字幕误认为旧贴纸", kind: "static" }] };
    input.correspondence.entries.push({ fixtureId: input.reviews[0].fixtureId, ordinal: 0, reviewTargetId: id, truthTargetId: null }); reseal();
    const result = compareHumanReviewQualification(input); expect(result.metrics.falsePositiveTargetFrames).toBe(1); expect(result.metrics.falsePositiveRate).toBeGreaterThan(0); expect(result.comparisonStatus).toBe("NOT_QUALIFIED");
  });
  it("detects identity split without losing per-frame target coverage", () => {
    const { input, reseal } = comparisonFixture(); const receipt = input.reviews[1].receipt, id = randomUUID();
    for (const ordinal of [4,5,6]) {
      const frame = receipt.results[ordinal]; if (frame.result.type !== "TARGETS") throw Error("fixture");
      frame.result.targets[0].id = id;
      input.correspondence.entries.find(e => e.fixtureId === input.reviews[1].fixtureId && e.ordinal === ordinal)!.reviewTargetId = id;
    }
    reseal(); const result = compareHumanReviewQualification(input); expect(result.metrics).toMatchObject({ identitySplitErrors: 1, missedTargetFrames: 0 }); expect(result.comparisonStatus).toBe("NOT_QUALIFIED");
  });
  it("detects two sequential distinct targets incorrectly merged under one UUID", () => {
    const { input, reseal } = comparisonFixture(); const receipt = input.reviews[6].receipt;
    const first = receipt.results[0].result; if (first.type !== "TARGETS") throw Error("fixture");
    for (const ordinal of [3,4]) {
      receipt.results[ordinal].result = { ...structuredClone(first), presentationId: receipt.results[ordinal].result.presentationId };
      input.correspondence.entries.find(e => e.fixtureId === input.reviews[6].fixtureId && e.ordinal === ordinal)!.reviewTargetId = first.targets[0].id;
    }
    reseal(); const result = compareHumanReviewQualification(input); expect(result.metrics).toMatchObject({ identityMergeErrors: 1, missedTargetFrames: 0 }); expect(result.comparisonStatus).toBe("NOT_QUALIFIED");
  });
  it.each(["truth-author", "criteria", "pre-freeze", "digest", "frame-binding", "missing-frame", "presentation-token", "unadjudicated", "ambiguous-match", "mapping-author", "unknown-field", "coverage"])("fails closed for %s", fault => {
    const { input, reseal } = comparisonFixture();
    if (fault === "truth-author") input.reviews.forEach(r => { r.receipt.session.reviewerId = input.package.manifest.truthAuthorId; });
    if (fault === "criteria") input.package.criteria = { ...QUALIFICATION_CRITERIA, unnecessaryUnknownPercent: 6 } as unknown as typeof QUALIFICATION_CRITERIA;
    if (fault === "pre-freeze") input.reviews[0].receipt.session.createdAt = "2026-09-27T23:59:59.000Z";
    if (fault === "frame-binding") input.reviews[0].receipt.results[0].binding.pixelSha256 = sha("wrong bytes");
    if (fault === "missing-frame") input.reviews[0].receipt.results.pop();
    if (fault === "presentation-token") input.reviews[0].receipt.results[1].result.presentationId = input.reviews[0].receipt.results[0].result.presentationId;
    if (fault === "unadjudicated") input.correspondence.entries.pop();
    if (fault === "ambiguous-match") input.correspondence.unresolved.push({ fixtureId: input.reviews[0].fixtureId, ordinal: 0, reason: "cannot uniquely associate identity" });
    if (fault === "mapping-author") input.correspondence.adjudicatorId = input.reviews[0].receipt.session.reviewerId;
    if (fault === "unknown-field") Object.assign(input, { qualified: true });
    if (fault === "coverage") { input.package.manifest.fixtures.forEach(f => { f.groupId = "one-group"; }); input.package.datasetDigest = qualificationDigest(input.package.manifest); input.correspondence.datasetDigest = input.package.datasetDigest; }
    reseal(); if (fault === "digest") input.reviews[0].receipt.receiptDigest = sha("forged");
    const result = compareHumanReviewQualification(input); expect(result.qualificationStatus).toBe("INCOMPLETE"); expect(result.qualificationRecord).toBeNull();
  });
  it("schema validation does not provide an issuer or let an arbitrary caller create authority", () => {
    expect(HumanReviewMethodQualificationRecordSchema.safeParse({ qualified: true, authority: "source-admission" }).success).toBe(false);
    const { input } = comparisonFixture(); const first = compareHumanReviewQualification(input), second = compareHumanReviewQualification(input);
    expect(first.comparisonDigest).toBe(second.comparisonDigest); expect(first.qualificationRecord).toBeNull();
  });
});
