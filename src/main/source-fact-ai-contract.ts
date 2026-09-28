import { z } from "zod";
import { createHash } from "node:crypto";
import { qualificationDigest, QualificationManifestSchema, QualificationTruthSchema, QUALIFICATION_SCENARIOS } from "./source-fact-qualification-contract.js";
import { sourceKey } from "./source-sticker-knowledge-store.js";

// Pure artifact digest reuse. No human method/schema/receipt conversion.
export const aiDigest = qualificationDigest;
export const AI_SCENARIOS = QUALIFICATION_SCENARIOS;
export const AI_CRITERIA = Object.freeze({ version: "ai-full-canvas-qualification/v1", methodId: "dual-ai-full-canvas/v1",
  presentation: "ai-full-canvas-lossless-image/v1", reviewSchema: "ai-full-canvas-declaration/v1",
  zeroTolerance: Object.freeze(["falseEmptyCount", "missedTargetFrames", "multiTargetMissCount", "boundaryErrorFrames", "singleFrameAppearanceMisses",
    "bridgedAbsenceIntervals", "missedUnknown", "falsePositiveTargetFrames", "identityMergeErrors", "identitySplitErrors", "categoryMismatchTargetFrames"] as const),
  unnecessaryUnknownPercent: 5, minimumGroups: 3, minimumFrames: 100, minimumClearFrames: 100, minimumEmptyFrames: 10,
  minimumPresentFrames: 20, minimumMultiTargetFrames: 5, minimumSingleFrameCases: 3, minimumCutCases: 3, minimumMotionCases: 3, minimumAmbiguousCases: 3 });
export const AI_INTEGER = z.number().int().nonnegative().safe();
export const AI_DIGEST = z.string().regex(/^[a-f0-9]{64}$/);
export const AITargetSchema = z.object({ id: z.string().uuid(), description: z.string().trim().min(1).max(160), category: z.enum(["static", "moving", "animated"]),
  bbox: z.object({ x: AI_INTEGER, y: AI_INTEGER, width: z.number().int().positive().safe(), height: z.number().int().positive().safe() }).strict() }).strict();
export const AIDeclarationSchema = z.discriminatedUnion("type", [
  z.object({ ordinal: AI_INTEGER, type: z.literal("TARGETS"), targets: z.array(AITargetSchema).min(1).max(128)
    .refine(ts => new Set(ts.map(t => t.id)).size === ts.length, "duplicate target UUID") }).strict(),
  z.object({ ordinal: AI_INTEGER, type: z.literal("EMPTY") }).strict(),
  z.object({ ordinal: AI_INTEGER, type: z.literal("UNKNOWN"), reason: z.string().trim().min(1).max(1000) }).strict(),
]);
export type AIDeclaration = z.infer<typeof AIDeclarationSchema>;
export const AIPackageSchema = z.object({ manifest: QualificationManifestSchema, truth: QualificationTruthSchema,
  datasetDigest: AI_DIGEST, truthDigest: AI_DIGEST, criteria: z.unknown(), criteriaDigest: AI_DIGEST, frozenAt: z.string().datetime(),
  independence: z.array(z.object({ groupId: z.string().min(1), construction: z.string().min(1), evidenceDigest: AI_DIGEST }).strict()).min(3).max(256),
  usage: z.literal("NEVER_EXPOSED_HOLDOUT_CANDIDATE") }).strict();
export type AIPackage = z.infer<typeof AIPackageSchema>;
export function freezeAI<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freezeAI(child); Object.freeze(value); }
  return value;
}
export function assertAIPackage(raw: unknown): AIPackage {
  const p = AIPackageSchema.parse(raw);
  if (p.manifest.datasetVersion === "d2q-controlled-3x18x8/v1" || aiDigest(p.criteria) !== aiDigest(AI_CRITERIA)
    || p.criteriaDigest !== aiDigest(AI_CRITERIA) || p.datasetDigest !== aiDigest(p.manifest) || p.truthDigest !== aiDigest(p.truth)
    || Date.parse(p.frozenAt) < Date.parse(p.manifest.createdAt) || p.manifest.datasetVersion !== p.truth.datasetVersion
    || p.manifest.truthAuthorId !== p.truth.truthAuthorId || p.manifest.truthCreationVersion !== p.truth.truthCreationVersion
    || p.manifest.truthReviewVersion !== p.truth.truthReviewVersion || p.manifest.fixtures.length !== p.truth.fixtures.length
    || new Set(p.manifest.fixtures.map(f => f.fixtureId)).size !== p.manifest.fixtures.length
    || new Set(p.independence.map(g => g.groupId)).size !== p.independence.length) throw Error("INCOMPLETE: AI package freeze/identity");
  const seen = new Set<string>();
  for (const f of p.manifest.fixtures) {
    if (!p.independence.some(g => g.groupId === f.groupId)) throw Error("INCOMPLETE: missing group independence evidence");
    const items = p.truth.fixtures.filter(t => t.fixtureId === f.fixtureId);
    if (items.length !== 1) throw Error("INCOMPLETE: duplicate/missing truth fixture");
    const t = items[0], c = t.census, { censusDigest, ...body } = c;
    if (censusDigest !== f.censusDigest || censusDigest !== createHash("sha256").update(JSON.stringify(body)).digest("hex")
      || sourceKey(c.source) !== sourceKey(f.sourceIdentity) || c.schemaVersion !== 1 || c.authority !== "none" || c.eligible !== false
      || c.semanticReview !== "NOT_EVALUATED" || c.decode.profile !== "full-decode-rgba-v1" || c.decode.pixelFormat !== "rgba"
      || c.frames.length !== f.frameCount || c.horizon.frameCount !== f.frameCount || t.frames.length !== f.frameCount) throw Error("INCOMPLETE: canonical census binding");
    const identities = new Map<string, string>();
    t.frames.forEach((frame, i) => {
      const original = c.frames[i], key = `${sourceKey(c.source)}:${censusDigest}:${i}`;
      if (seen.has(key)) throw Error("INCOMPLETE: repeated source frame identity"); seen.add(key);
      if (original.index !== i || frame.binding.ordinal !== i || aiDigest(frame.binding) !== aiDigest({ ordinal: i, pts: original.pts,
        endPts: original.endPts, byteLength: original.byteLength, pixelSha256: original.pixelSha256 })
        || original.byteLength !== c.source.width * c.source.height * 4 || original.endPts <= original.pts
        || original.pts !== (i ? c.frames[i - 1].endPts : c.horizon.startPts)
        || (i === f.frameCount - 1 && original.endPts !== c.horizon.endPts)) throw Error("INCOMPLETE: truth frame binding");
      if (frame.state === "KNOWN") {
        if (new Set(frame.targets.map(t => t.id)).size !== frame.targets.length) throw Error("INCOMPLETE: duplicate truth target");
        for (const target of frame.targets) {
          if (target.bbox.x + target.bbox.width > c.source.width || target.bbox.y + target.bbox.height > c.source.height) throw Error("INCOMPLETE: truth bbox");
          const identity = aiDigest({ description: target.description, category: target.category });
          if (identities.has(target.id) && identities.get(target.id) !== identity) throw Error("INCOMPLETE: truth identity changed");
          identities.set(target.id, identity);
        }
      }
    });
    if (new Set(t.cases.map(c => c.caseId)).size !== t.cases.length || t.cases.some(c => c.endOrdinal <= c.startOrdinal || c.endOrdinal > f.frameCount)) throw Error("INCOMPLETE: case anchors");
  }
  return p;
}
export function aiCoverage(p: AIPackage) {
  let frames = 0, clear = 0, empty = 0, present = 0, multi = 0, single = 0;
  const cuts = new Set<string>(), motion = new Set<string>(), ambiguous = new Set<string>(), scenarios = new Set<string>();
  for (const f of p.truth.fixtures) {
    const activity = new Map<string, Set<number>>();
    for (const [i, t] of f.frames.entries()) {
      frames++; if (t.state !== "KNOWN") continue; clear++; t.targets.length ? present++ : empty++; if (t.targets.length > 1) multi++;
      for (const target of t.targets) { const a = activity.get(target.id) ?? new Set(); a.add(i); activity.set(target.id, a); }
    }
    for (const a of activity.values()) for (const i of a) if (!a.has(i - 1) && !a.has(i + 1)) single++;
    for (const c of f.cases) {
      scenarios.add(c.scenario); const key = `${f.fixtureId}:${c.startOrdinal}:${c.endOrdinal}`;
      if (c.scenario === "cuts" && c.endOrdinal - c.startOrdinal === 2) cuts.add(key);
      if ((c.scenario === "moving" || c.scenario === "animated") && f.frames.slice(c.startOrdinal, c.endOrdinal).some(t => t.state === "KNOWN" && t.targets.some(x => x.category === c.scenario))) motion.add(key);
      if (c.scenario.endsWith("ambiguous") && c.endOrdinal - c.startOrdinal === 1 && f.frames[c.startOrdinal].state === "TRUTH_AMBIGUOUS") ambiguous.add(key);
    }
  }
  const groups = new Set(p.manifest.fixtures.map(f => f.groupId)).size;
  const missingScenarios = AI_SCENARIOS.filter(s => !scenarios.has(s));
  return { groups, frames, clear, empty, present, multi, single, cuts: cuts.size, motion: motion.size, ambiguous: ambiguous.size, missingScenarios,
    sufficient: groups >= 3 && frames >= 100 && clear >= 100 && empty >= 10 && present >= 20 && multi >= 5 && single >= 3 && cuts.size >= 3 && motion.size >= 3 && ambiguous.size >= 3 && !missingScenarios.length };
}
