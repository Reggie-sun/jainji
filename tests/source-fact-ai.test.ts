import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AI_CRITERIA, AIDeclarationSchema, aiDigest } from "../src/main/source-fact-ai-contract";
import { compareAIFrames, buildAIJoint } from "../src/main/source-fact-ai-compare";

// Pure simulated arithmetic. Never model, human or formal qualification evidence.
function sample(clear = 100) {
  const id = randomUUID();
  const truth = Array.from({ length: clear }, (_, ordinal) => ({ ordinal, state: "KNOWN" as const, targets: [] as { id: string; category: "static" | "moving" | "animated" }[] }));
  const declarations: any[] = truth.map(f => ({ ordinal: f.ordinal, type: "EMPTY" }));
  const correspondence: { ordinal: number; reviewTargetId: string; truthTargetId: string | null }[] = [];
  const add = (ordinal: number, truthId = "t", reviewId = id, category = "static") => {
    truth[ordinal].targets.push({ id: truthId, category: "static" });
    declarations[ordinal] = { ordinal, type: "TARGETS", targets: [{ id: reviewId, description: "visible overlay", category, bbox: { x: 1, y: 1, width: 4, height: 4 } }] };
    correspondence.push({ ordinal, reviewTargetId: reviewId, truthTargetId: truthId });
  };
  return { truth, declarations, correspondence, add, id };
}
describe("independent AI declarations and frozen criteria", () => {
  it("has independent method and category gate, canonical digest", () => {
    expect(AI_CRITERIA.methodId).toBe("dual-ai-full-canvas/v1");
    expect(AI_CRITERIA.zeroTolerance).toContain("categoryMismatchTargetFrames");
    expect(aiDigest({ a: 1, b: 2 })).toBe(aiDigest({ b: 2, a: 1 }));
  });
  it.each([{ ordinal: 0, type: "TARGETS", targets: [] }, { ordinal: 0, type: "UNKNOWN", reason: "" },
    { ordinal: 0, type: "EMPTY", qualified: true }, { ordinal: 0, type: "EMPTY", confirmation: "human" }])("rejects implicit or human/caller authority: %j", raw => {
    expect(AIDeclarationSchema.safeParse(raw).success).toBe(false);
  });
});
describe("AI truth arithmetic, not qualification", () => {
  it.each([0, 50, 99])("false EMPTY at %i overrides insufficient coverage and missing correspondence", ordinal => {
    const s = sample(); s.add(ordinal); s.declarations[ordinal] = { ordinal, type: "EMPTY" };
    const r = compareAIFrames(s.truth, s.declarations, []);
    expect(r.status).toBe("NOT_QUALIFIED"); expect(r.metrics.falseEmptyCount).toBe(1);
    expect(r.metrics.targetFrameRecall).toBeNull(); expect(r.metricsComplete).toBe(false);
  });
  it("UNKNOWN cannot hide a clear target or single appearance", () => {
    const s = sample(); s.add(50); s.declarations[50] = { ordinal: 50, type: "UNKNOWN", reason: "uncertain" };
    const r = compareAIFrames(s.truth, s.declarations, []);
    expect(r.metrics).toMatchObject({ missedTargetFrames: 1, singleFrameAppearanceMisses: 1, boundaryErrorFrames: 1 });
    expect(r.status).toBe("NOT_QUALIFIED");
  });
  it("correct identity with wrong category fails", () => {
    const s = sample(); s.add(50, "t", s.id, "animated");
    expect(compareAIFrames(s.truth, s.declarations, s.correspondence).metrics.categoryMismatchTargetFrames).toBe(1);
  });
  it.each([5, 6])("5%% boundary: %i clear unknowns", n => {
    const s = sample(); for (let ordinal = 0; ordinal < n; ordinal++) s.declarations[ordinal] = { ordinal, type: "UNKNOWN", reason: "uncertain" };
    expect(compareAIFrames(s.truth, s.declarations, []).status).toBe(n === 5 ? "MATCH" : "NOT_QUALIFIED");
  });
  it("99 clear frames cannot pass usability", () => {
    const s = sample(99); expect(compareAIFrames(s.truth, s.declarations, []).status).toBe("INCOMPLETE");
  });
  it("missing input has null metrics and cannot become zero errors", () => {
    const s = sample(); s.declarations.pop(); const r = compareAIFrames(s.truth, s.declarations, []);
    expect(r.status).toBe("INCOMPLETE"); expect(r.metrics.falseEmptyCount).toBeNull();
  });
  it("partial concurrent set fails multi-target recall", () => {
    const s = sample(); s.add(50); s.truth[50].targets.push({ id: "second", category: "static" });
    const r = compareAIFrames(s.truth, s.declarations, s.correspondence);
    expect(r.metrics).toMatchObject({ multiTargetMissCount: 1, missedTargetFrames: 1 });
  });
  it("identity split and merge are independent from per-frame recall", () => {
    const s = sample(), second = randomUUID(); s.add(0, "t", s.id); s.add(1, "t", second);
    expect(compareAIFrames(s.truth, s.declarations, s.correspondence).metrics.identitySplitErrors).toBe(1);
    s.truth[1].targets[0].id = "other"; s.declarations[1].targets[0].id = s.id;
    s.correspondence[1] = { ordinal: 1, reviewTargetId: s.id, truthTargetId: "other" };
    expect(compareAIFrames(s.truth, s.declarations, s.correspondence).metrics.identityMergeErrors).toBe(1);
  });
  it("absence bridging and false positives use exact ordinals and declared pairs", () => {
    const s = sample(); s.add(0); s.add(3);
    for (const ordinal of [1, 2]) {
      s.declarations[ordinal] = { ...structuredClone(s.declarations[0]), ordinal };
      s.correspondence.push({ ordinal, reviewTargetId: s.id, truthTargetId: "t" });
    }
    const r = compareAIFrames(s.truth, s.declarations, s.correspondence);
    expect(r.metrics).toMatchObject({ bridgedAbsenceIntervals: 1, boundaryErrorFrames: 2, falsePositiveTargetFrames: 2, declaredTargetFrameCount: 4, falsePositiveRate: 0.5 });
  });
  it("truth ambiguity may only be UNKNOWN", () => {
    const s = sample(); const truth: any[] = s.truth; truth[0] = { ordinal: 0, state: "TRUTH_AMBIGUOUS" };
    expect(compareAIFrames(truth, s.declarations, []).metrics.missedUnknown).toBe(1);
  });
  it("unresolved or duplicated correspondence cannot be silently accepted", () => {
    const s = sample(); s.add(0);
    expect(compareAIFrames(s.truth, s.declarations, []).status).toBe("INCOMPLETE");
    expect(compareAIFrames(s.truth, s.declarations, [...s.correspondence, ...s.correspondence]).status).toBe("INCOMPLETE");
  });
  it("joint agreement does not supply truth and requires explicit identity mapping", () => {
    const s = sample(); s.add(0); const b = structuredClone(s.declarations); b[0].targets[0].id = randomUUID();
    expect(buildAIJoint(s.declarations, b, []).declarations[0].type).toBe("UNKNOWN");
    expect(buildAIJoint(s.declarations, b, [{ ordinal: 0, a: s.id, b: b[0].targets[0].id }]).declarations[0].type).toBe("TARGETS");
    s.declarations[0] = { ordinal: 0, type: "EMPTY" }; b[0] = { ordinal: 0, type: "EMPTY" };
    const joint = buildAIJoint(s.declarations, b, []);
    expect(joint.declarations[0].type).toBe("EMPTY");
    expect(compareAIFrames(s.truth, joint.declarations, []).status).toBe("NOT_QUALIFIED");
  });
});
