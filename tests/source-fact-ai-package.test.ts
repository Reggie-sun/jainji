import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AI_CRITERIA, aiDigest, aiCoverage, assertAIPackage } from "../src/main/source-fact-ai-contract";
import { compareAIQualification } from "../src/main/source-fact-ai-compare";

const recipePath = "../scripts/source-fact-ai-fixtures.mjs";
const recipes = await import(recipePath);
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
// Simulated binding/arithmetic only. Fixed test seeds never enter the private holdout.
function fixture() {
  const fixtures: any[] = [], truths: any[] = [], reviews: any[] = [];
  for (let group = 0; group < 3; group++) for (const scenario of recipes.SCENARIOS) {
    const recipe = recipes.fixtureRecipe(scenario, group, 1729), fixtureId = randomUUID();
    const source = { fingerprint: `sha256:${sha(fixtureId)}`, byteLength: 128, width: recipes.WIDTH, height: recipes.HEIGHT,
      rotation: 0, durationMs: 1000, timeBase: "1/12000", timeOriginPts: 0, interpretationVersion: 1 };
    const body = { schemaVersion: 1, authority: "none", eligible: false, semanticReview: "NOT_EVALUATED", source,
      decode: { profile: "full-decode-rgba-v1", pixelFormat: "rgba", streamIndex: 0, ffmpegFingerprint: `sha256:${sha("simulated-engine")}`,
        ffprobeFingerprint: `sha256:${sha("simulated-probe")}`, inputInterpretation: { pixelFormat: "yuv444p", colorRange: "unknown", colorSpace: "unknown", colorPrimaries: "unknown", colorTransfer: "unknown" } },
      horizon: { startPts: 0, endPts: 12000, frameCount: 12 }, frames: Array.from({ length: 12 }, (_, index) => ({ index, pts: index * 1000, endPts: (index + 1) * 1000,
        byteLength: recipes.WIDTH * recipes.HEIGHT * 4, pixelSha256: sha(recipe.render(index)) })) };
    const census = { ...body, censusDigest: sha(JSON.stringify(body)) };
    fixtures.push({ fixtureId, groupId: recipes.GROUP_CONSTRUCTION[group], sourceKind: "SYNTHETIC_CONTROLLED", sourceFile: `${fixtureId}.mp4`, sourceIdentity: source, censusDigest: census.censusDigest, frameCount: 12 });
    const frames = census.frames.map(f => ({ binding: { ordinal: f.index, pts: f.pts, endPts: f.endPts, byteLength: f.byteLength, pixelSha256: f.pixelSha256 }, ...recipe.truth(f.index) }));
    truths.push({ fixtureId, census, frames, cases: recipe.cases });
    for (const actor of ["A", "B", "joint"]) {
      const ids = new Map<string, string>(), correspondence: any[] = [];
      const declarations = frames.map(f => {
        if (f.state === "TRUTH_AMBIGUOUS") return { ordinal: f.binding.ordinal, type: "UNKNOWN", reason: "simulated ambiguity" };
        if (!f.targets.length) return { ordinal: f.binding.ordinal, type: "EMPTY" };
        return { ordinal: f.binding.ordinal, type: "TARGETS", targets: f.targets.map((t: any) => {
          const id = ids.get(t.id) ?? randomUUID(); ids.set(t.id, id); correspondence.push({ ordinal: f.binding.ordinal, reviewTargetId: id, truthTargetId: t.id });
          return { id, description: t.description, category: t.category, bbox: t.bbox };
        }) };
      });
      reviews.push({ fixtureId, actor, declarations, correspondence });
    }
  }
  const manifest = { schemaVersion: 1, datasetVersion: "simulated-ai-test/v1", truthAuthorId: "simulated-author", truthCreationVersion: "test/v1", truthReviewVersion: "test/v1",
    createdAt: "2026-09-29T00:00:00.000Z", sourceSnapshot: [{ path: "simulated-test-only", sha256: sha("test") }], fixtures };
  const truth = { schemaVersion: 1, datasetVersion: manifest.datasetVersion, truthAuthorId: manifest.truthAuthorId, truthCreationVersion: manifest.truthCreationVersion, truthReviewVersion: manifest.truthReviewVersion, fixtures: truths };
  const p: any = { manifest, truth, datasetDigest: aiDigest(manifest), truthDigest: aiDigest(truth), criteria: AI_CRITERIA, criteriaDigest: aiDigest(AI_CRITERIA), frozenAt: manifest.createdAt,
    usage: "NEVER_EXPOSED_HOLDOUT_CANDIDATE", independence: recipes.GROUP_CONSTRUCTION.map((groupId: string) => ({ groupId, construction: "Simulated distinct structural scene", evidenceDigest: sha(groupId) })) };
  const reseal = () => { p.datasetDigest = aiDigest(p.manifest); p.truthDigest = aiDigest(p.truth); p.criteriaDigest = aiDigest(p.criteria); };
  return { p, reviews, reseal };
}
describe("new AI coverage and three separate actors (simulated only)", () => {
  it("covers 18 scenarios/minima without pooling actors, and cannot issue a formal record", () => {
    const f = fixture(), coverage = aiCoverage(assertAIPackage(f.p));
    expect(coverage).toMatchObject({ groups: 3, frames: 648, sufficient: true, missingScenarios: [] });
    const r: any = compareAIQualification({ package: f.p, reviews: f.reviews });
    expect(r).toMatchObject({ comparisonStatus: "MATCH", qualificationStatus: "INCOMPLETE", qualificationRecord: null, authority: "none", eligible: false });
    expect(r.aggregate.A.metrics.frameCount).toBe(648); expect(r.aggregate.B.metrics.frameCount).toBe(648);
    expect(r.strata.REAL_MEDIA_HUMAN_TRUTH.A).toMatchObject({ evaluation: "NOT_EVALUATED", metrics: { falseEmptyCount: null } });
  });
  it.each(["A", "B", "joint"])("a false EMPTY in %s cannot be offset by other actors or later malformed evidence", actor => {
    const f = fixture(), r = f.reviews.find(r => r.actor === actor && r.declarations.some((d: any) => d.type === "TARGETS"));
    const ordinal = r.declarations.findIndex((d: any) => d.type === "TARGETS"); r.declarations[ordinal] = { ordinal, type: "EMPTY" };
    const result: any = compareAIQualification({ package: f.p, reviews: [...f.reviews, { fixtureId: randomUUID(), actor: "A", declarations: {}, correspondence: {} }] });
    expect(result.qualificationStatus).toBe("NOT_QUALIFIED"); expect(result.aggregate[actor].metrics.falseEmptyCount).toBeNull();
    expect(result.results.at(-1).metrics.falseEmptyCount).toBe(1);
  });
  it("missing B preserves null aggregate metrics instead of reporting evaluated zeros", () => {
    const f = fixture(), r: any = compareAIQualification({ package: f.p, reviews: f.reviews.filter(r => r.actor !== "B") });
    expect(r.comparisonStatus).toBe("INCOMPLETE"); expect(r.aggregate.B).toMatchObject({ evaluation: "NOT_EVALUATED", metrics: { frameCount: null, missedTargetFrames: null } });
  });
  it.each(["actorRoute", "visionValidated", "isolationValidated", "qualificationRecord"])("caller-supplied %s cannot enable formal qualification", field => {
    const f = fixture(); f.p[field] = { qualified: true, provider: "CLAIM_ONLY" };
    const r = compareAIQualification({ package: f.p, reviews: f.reviews });
    expect(r.qualificationStatus).toBe("INCOMPLETE"); expect(r.qualificationRecord).toBeNull();
  });
  it.each(["legacy", "late-criteria", "early-freeze", "borrowed-frame", "missing-scenario"])("rejects preparation defect: %s", fault => {
    const f = fixture();
    if (fault === "legacy") f.p.manifest.datasetVersion = f.p.truth.datasetVersion = "d2q-controlled-3x18x8/v1";
    if (fault === "late-criteria") f.p.criteria = { ...AI_CRITERIA, unnecessaryUnknownPercent: 6 };
    if (fault === "early-freeze") f.p.frozenAt = "2026-09-28T00:00:00.000Z";
    if (fault === "borrowed-frame") f.p.truth.fixtures[0].frames[0].binding.pixelSha256 = sha("borrowed");
    if (fault === "missing-scenario") f.p.truth.fixtures.forEach((t: any) => { t.cases = t.cases.filter((c: any) => c.scenario !== "tiny"); });
    f.reseal(); expect(compareAIQualification({ package: f.p, reviews: f.reviews }).qualificationStatus).toBe("INCOMPLETE");
  });
  it("independent groups have structural geometry changes, moving pixels and visible ambiguous material", () => {
    const backgrounds = [0, 1, 2].map(g => recipes.fixtureRecipe("no-sticker", g, 1729).render(0));
    expect(new Set(backgrounds.map(sha)).size).toBe(3);
    const moving = recipes.fixtureRecipe("moving", 0, 1729); expect(sha(moving.render(0))).not.toBe(sha(moving.render(1)));
    const semantic = recipes.fixtureRecipe("semantic-ambiguous", 1, 1729);
    expect(semantic.truth(4).state).toBe("TRUTH_AMBIGUOUS"); expect(sha(semantic.render(4))).not.toBe(sha(semantic.render(3)));
  });
});
