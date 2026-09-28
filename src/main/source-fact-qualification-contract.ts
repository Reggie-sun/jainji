import { createHash } from "node:crypto";
import { z } from "zod";
import { SourceIdentitySchema } from "../shared/source-sticker-knowledge.js";
import { FULL_CANVAS_REVIEW_METHOD } from "./source-fact-review-session.js";
import type { FullSourceCensus } from "./source-fact-census.js";

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Id = z.string().trim().min(1).max(160);
const Count = z.number().int().nonnegative().safe();
export const QUALIFICATION_SCENARIOS = ["no-sticker", "static", "simultaneous", "single-frame", "first-frame", "last-frame", "cuts",
  "moving", "animated", "reappearance", "central", "tiny", "edge", "low-contrast", "fine-transparent-edge", "confusers", "identity-ambiguous", "semantic-ambiguous"] as const;
export const QUALIFICATION_CRITERIA = Object.freeze({ schemaVersion: 1, criteriaVersion: "human-full-canvas-qualification/v1",
  methodId: FULL_CANVAS_REVIEW_METHOD, presentationVersion: "d2-original-size-canvas/v1", reviewSchemaVersion: 1,
  correspondenceVersion: "independent-post-receipt-frame-correspondence/v1", zeroTolerance: Object.freeze([
    "falseEmptyCount", "missedTargetFrames", "multiTargetMissCount", "boundaryErrorFrames", "singleFrameAppearanceMisses", "bridgedAbsenceIntervals",
    "missedUnknown", "falsePositiveTargetFrames", "identityMergeErrors", "identitySplitErrors"] as const), unnecessaryUnknownPercent: 5,
  minimumGroups: 3, minimumFrames: 100, minimumClearFrames: 100, minimumEmptyFrames: 10, minimumPresentFrames: 20,
  minimumMultiTargetFrames: 5, minimumSingleFrameCases: 3, minimumCutCases: 3, minimumMotionCases: 3, minimumAmbiguousCases: 3 });

/** Stable key order is for qualification artifacts only. D1/D2 keep their own existing digest rule. */
export function qualificationDigest(value: unknown): string {
  function canonical(item: unknown): string {
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (item && typeof item === "object") return `{${Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
    return JSON.stringify(item);
  }
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export const QualificationFrameBindingSchema = z.object({ ordinal: Count, pts: z.number().int().safe(), endPts: z.number().int().safe(),
  pixelSha256: Digest, byteLength: z.number().int().positive().max(64 * 1024 ** 2) }).strict().refine(f => f.endPts > f.pts);
const TruthTarget = z.object({ id: Id, description: Id, category: z.enum(["static", "moving", "animated"]), state: z.literal("VISIBLE"),
  // Truth-only correspondence evidence, never shown to the reviewer and never a mask proof.
  bbox: z.object({ x: Count, y: Count, width: z.number().int().positive(), height: z.number().int().positive() }).strict() }).strict();
export const QualificationTruthFrameSchema = z.discriminatedUnion("state", [
  z.object({ binding: QualificationFrameBindingSchema, state: z.literal("KNOWN"), targets: z.array(TruthTarget).max(128) }).strict(),
  z.object({ binding: QualificationFrameBindingSchema, state: z.literal("TRUTH_AMBIGUOUS"), reason: z.string().min(1).max(1000),
    ambiguity: z.enum(["identity", "sticker-category"]) }).strict(),
]);
export const QualificationManifestSchema = z.object({ schemaVersion: z.literal(1), datasetVersion: Id, truthAuthorId: Id, truthCreationVersion: Id, truthReviewVersion: Id,
  createdAt: z.string().datetime(), sourceSnapshot: z.array(z.object({ path: Id, sha256: Digest }).strict()).min(1).max(16),
  fixtures: z.array(z.object({ fixtureId: z.string().uuid(), groupId: Id, sourceKind: z.enum(["SYNTHETIC_CONTROLLED", "REAL_MEDIA_HUMAN_TRUTH"]),
    sourceFile: z.string().regex(/^[a-f0-9-]{36}\.mp4$/), sourceIdentity: SourceIdentitySchema, censusDigest: Digest,
    frameCount: z.number().int().min(1).max(100_000) }).strict()).min(1).max(256) }).strict();
export const QualificationTruthSchema = z.object({ schemaVersion: z.literal(1), datasetVersion: Id, truthAuthorId: Id, truthCreationVersion: Id, truthReviewVersion: Id,
  fixtures: z.array(z.object({ fixtureId: z.string().uuid(), census: z.custom<FullSourceCensus>(value => !!value && typeof value === "object"),
    frames: z.array(QualificationTruthFrameSchema).min(1).max(100_000),
    cases: z.array(z.object({ caseId: Id, scenario: z.enum(QUALIFICATION_SCENARIOS), startOrdinal: Count, endOrdinal: Count,
      rationale: z.string().min(1).max(1000) }).strict()).min(1).max(128) }).strict()).min(1).max(256) }).strict();
export const QualificationPackageSchema = z.object({ manifest: QualificationManifestSchema, truth: QualificationTruthSchema,
  datasetDigest: Digest, truthDigest: Digest, criteria: z.custom<typeof QUALIFICATION_CRITERIA>(value => qualificationDigest(value) === qualificationDigest(QUALIFICATION_CRITERIA)),
  criteriaDigest: Digest, frozenAt: z.string().datetime() }).strict();
export const QualificationCorrespondenceSchema = z.object({ schemaVersion: z.literal(1), version: z.literal(QUALIFICATION_CRITERIA.correspondenceVersion),
  datasetDigest: Digest, truthDigest: Digest, reviewReceiptDigest: Digest, adjudicatorId: Id,
  entries: z.array(z.object({ fixtureId: z.string().uuid(), ordinal: Count, reviewTargetId: z.string().uuid(), truthTargetId: Id.nullable() }).strict()).max(200_000),
  unresolved: z.array(z.object({ fixtureId: z.string().uuid(), ordinal: Count, reason: z.string().min(1).max(1000) }).strict()).max(100_000) }).strict();
export type QualificationPackage = z.infer<typeof QualificationPackageSchema>;
export type QualificationTruthFrame = z.infer<typeof QualificationTruthFrameSchema>;
export type QualificationCorrespondence = z.infer<typeof QualificationCorrespondenceSchema>;

export function assertQualificationPackage(raw: unknown): QualificationPackage {
  const pack = QualificationPackageSchema.parse(raw);
  if (qualificationDigest(pack.manifest) !== pack.datasetDigest || qualificationDigest(pack.truth) !== pack.truthDigest
    || qualificationDigest(pack.criteria) !== pack.criteriaDigest || pack.manifest.datasetVersion !== pack.truth.datasetVersion
    || pack.manifest.truthAuthorId !== pack.truth.truthAuthorId || pack.manifest.truthCreationVersion !== pack.truth.truthCreationVersion || pack.manifest.truthReviewVersion !== pack.truth.truthReviewVersion
    || pack.manifest.fixtures.length !== pack.truth.fixtures.length || Date.parse(pack.frozenAt) < Date.parse(pack.manifest.createdAt)
    || new Set(pack.manifest.fixtures.map(f => f.fixtureId)).size !== pack.manifest.fixtures.length) throw new Error("UNSAFE: qualification package binding");
  for (const fixture of pack.manifest.fixtures) {
    const truth = pack.truth.fixtures.filter(f => f.fixtureId === fixture.fixtureId);
    if (truth.length !== 1) throw new Error("UNSAFE: qualification truth fixture identity");
    const { census, frames, cases } = truth[0];
    const { censusDigest, ...body } = census;
    if (censusDigest !== fixture.censusDigest || createHash("sha256").update(JSON.stringify(body)).digest("hex") !== censusDigest
      || qualificationDigest(SourceIdentitySchema.parse(census.source)) !== qualificationDigest(fixture.sourceIdentity)
      || census.schemaVersion !== 1 || census.authority !== "none" || census.eligible !== false || census.semanticReview !== "NOT_EVALUATED"
      || census.decode.profile !== "full-decode-rgba-v1" || census.decode.pixelFormat !== "rgba" || census.frames.length !== fixture.frameCount
      || census.horizon.frameCount !== fixture.frameCount || frames.length !== fixture.frameCount) throw new Error("UNSAFE: qualification D1 census binding");
    const identities = new Map<string, string>();
    frames.forEach((frame, ordinal) => {
      const original = census.frames[ordinal];
      if (!original || original.index !== ordinal || qualificationDigest(frame.binding) !== qualificationDigest({ ordinal, pts: original.pts,
        endPts: original.endPts, pixelSha256: original.pixelSha256, byteLength: original.byteLength })
        || frame.binding.byteLength !== fixture.sourceIdentity.width * fixture.sourceIdentity.height * 4
        || (ordinal === 0 ? original.pts !== census.horizon.startPts : census.frames[ordinal - 1].endPts !== original.pts)
        || (ordinal === frames.length - 1 && original.endPts !== census.horizon.endPts)) throw new Error("UNSAFE: qualification truth frame binding");
      if (frame.state === "KNOWN" && (new Set(frame.targets.map(t => t.id)).size !== frame.targets.length
        || frame.targets.some(t => t.bbox.x + t.bbox.width > census.source.width || t.bbox.y + t.bbox.height > census.source.height))) throw new Error("UNSAFE: qualification truth target geometry");
      if (frame.state === "KNOWN") for (const target of frame.targets) {
        const description = qualificationDigest({ description: target.description, category: target.category });
        if (identities.has(target.id) && identities.get(target.id) !== description) throw new Error("UNSAFE: qualification truth identity/category changed");
        identities.set(target.id, description);
      }
    });
    if (new Set(cases.map(c => c.caseId)).size !== cases.length || cases.some(c => c.endOrdinal <= c.startOrdinal || c.endOrdinal > frames.length)) throw new Error("UNSAFE: qualification case range");
  }
  return pack;
}

/** Data shape only. Serialized records never restore a trusted qualification decision or authority. */
export const HumanReviewMethodQualificationRecordSchema = z.object({ schemaVersion: z.literal(1), authority: z.literal("none"),
  methodId: z.literal(FULL_CANVAS_REVIEW_METHOD), presentationVersion: z.literal(QUALIFICATION_CRITERIA.presentationVersion), reviewSchemaVersion: z.literal(1),
  datasetVersion: Id, datasetDigest: Digest, truthDigest: Digest, criteriaVersion: z.literal(QUALIFICATION_CRITERIA.criteriaVersion), criteriaDigest: Digest,
  reviewerId: Id, truthAuthorId: Id, reviewReceiptDigest: Digest, comparisonDigest: Digest, correspondenceDigest: Digest,
  frameCount: Count, targetFrameCount: Count, falseEmptyCount: z.literal(0), missedTargetFrames: z.literal(0), multiTargetMissCount: z.literal(0),
  boundaryErrorFrames: z.literal(0), singleFrameAppearanceMisses: z.literal(0), bridgedAbsenceIntervals: z.literal(0), missedUnknown: z.literal(0),
  unnecessaryUnknownRate: z.number().min(0).max(0.05), falsePositiveTargetFrames: z.literal(0), identityMergeErrors: z.literal(0), identitySplitErrors: z.literal(0),
  qualificationStatus: z.literal("QUALIFIED"), createdAt: z.string().datetime(), sourceSnapshotDigest: Digest,
  humanEvidenceDigest: Digest }).strict().refine(r => r.reviewerId !== r.truthAuthorId, "Truth author cannot qualify their own review");
