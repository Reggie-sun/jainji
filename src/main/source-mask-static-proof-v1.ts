/** Historical confirmed-target-static-v1 semantics; no new issuance. */
import { z } from "zod";
import { ConfirmedTargetStaticProofV1Schema, type ConfirmedTargetStaticProofV1 as ConfirmedTargetStaticProof,
  type KnowledgeCandidate, type ReviewedRange } from "../shared/source-sticker-knowledge.js";
import { factsDigest, sourceKey } from "./source-sticker-knowledge-store.js";
import { discoveryHash as hash } from "./source-fact-discovery-evidence.js";
import { freezeAI } from "./source-fact-ai-contract.js";
import { staticIncomplete, type ConfirmedStaticTarget } from "./source-mask-static-target.js";
import { type StaticMaskCandidate } from "./source-mask-static-extraction.js";
import { STATIC_GEOMETRY_CONFIG, StaticGeometryArtifactSchema } from "./source-mask-static-geometry-v1.js";
import { AutoContourBitmapSchema } from "./source-mask-auto-extraction.js";

const STATIC_MASK_CONFIG = Object.freeze({ method: "cpu-static-conservative-mask-development/v2", maxChannelStd: 20, minimumComponentPixels: 8, edgeDifference: 18, dilationPixels: 3, originalPixelTolerance: 24, minimumFrames: 3 });
/** Fixed method support, not caller-provided ENGINEERING_ACCEPTED or source safety. */
export const CONFIRMED_STATIC_METHOD_V1 = freezeAI({ type: "confirmed-target-static-method/v1", authority: "none", eligible: false,
  confirmationMethod: "confirmed-static-target-development/v2", maskMethod: "cpu-static-conservative-mask-development/v2",
  maskConfig: STATIC_MASK_CONFIG, geometryMethod: "cpu-static-geometry/v1", geometryKernel: STATIC_GEOMETRY_CONFIG,
  controlledCorpusVersion: "static-exact-alpha-corpus/v2", controlledCorpusDigest: "574668d9facb190eea7d33a9e679f278188dbbf42af800e871a4088f2bf5f5f0",
  engineeringEvidenceVersion: "StaticMaskEngineeringEvidence/v2", engineeringEvidenceDigest: "e52752c3220c5952e22e1a602e229287542338c21ed1ff8ff12c5fbafab0a4df",
  methodSources: { "src/main/source-mask-static-extraction.ts": "3d899ee23d23c4a92f6409eab7a4d5fb20e8ea7f502eca656b29dcdc9bb3a874",
    "src/main/source-mask-static-target.ts": "dfbf4b871006c16399b734214d02af86948d8366c2e0f40b3b03c7afae4f23b1",
    "src/main/shape-cover-stationary-discovery.ts": "490c7ce3e7a52ca896c964d02ba3303399e2b4b1a1d60a8c67b0959359437388" },
  claims: ["CONTROLLED_EXACT_ZERO_MISS", "REAL_DEVELOPMENT_NO_VISIBLE_RESIDUAL_ON_FROZEN_RISK_SET", "FULL_RANGE_GEOMETRY_SUPPORTED_WITHIN_V2_LIMITS"] });
const methodBytes = () => Buffer.from(JSON.stringify(CONFIRMED_STATIC_METHOD_V1));
const Digest = z.string().regex(/^[a-f0-9]{64}$/), Ordinal = z.number().int().nonnegative().safe(), Pts = z.number().int().safe();
const TargetProofShape = ConfirmedTargetStaticProofV1Schema.innerType().shape.targets.element.shape;
const ConfirmationArtifact = z.object({ type: z.literal("confirmed-static-target/v2"), receipt: z.object({
  targetId: z.string().uuid(), confirmedBy: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(300),
  decision: z.literal("CONFIRM_STATIC_TARGET_IDENTITY_AND_RANGE_ONLY"), range: TargetProofShape.range,
  ...TargetProofShape.confirmation.shape, authority: z.literal("none"), eligible: z.literal(false), sourceKey: Digest,
}).strict() }).strict();
const ExtractionArtifact = z.object({ type: z.literal("static-mask-extraction/v2"), sourceKey: Digest, targetId: z.string().uuid(),
  confirmationDigest: Digest, evidenceDigest: Digest, receiptDigest: Digest, method: z.literal("cpu-static-conservative-mask-development/v2"),
  config: z.unknown().refine(v => JSON.stringify(v) === JSON.stringify(STATIC_MASK_CONFIG)), configDigest: Digest,
  range: TargetProofShape.range, mask: AutoContourBitmapSchema, status: z.enum(["CANDIDATE_REQUIRES_INDEPENDENT_PIXEL_EVIDENCE", "INCOMPLETE"]),
  reasons: z.array(z.string()).max(8), fullRangeVerification: z.enum(["CONSISTENT_WITH_STATIC_ENVELOPE", "REJECTED"]),
  anomalies: z.array(z.object({ index: Ordinal, reason: z.literal("STATIC_SUPPORT_CHANGED_OR_OCCLUDED"), changedSupportPixels: Ordinal.min(1), worstDifference: z.number().finite().min(0).max(255) }).strict()).max(20000),
  sampleOrdinals: z.array(Ordinal).min(3).max(96), frameCount: Ordinal.min(1).max(20000), firstPts: Pts, lastPts: Pts, endPts: Pts, bindingDigest: Digest, clockDigest: Digest,
}).strict();
function confirmationFields(r: ConfirmedStaticTarget["receipt"]): ConfirmedTargetStaticProof["targets"][number]["confirmation"] {
  return { method: r.method, confirmationDigest: r.confirmationDigest, discoveryDigest: r.discoveryDigest, resultDigest: r.resultDigest,
    confirmedCandidateIds: [...r.confirmedCandidateIds], confirmedComponentDigests: [...r.confirmedComponentDigests],
    confirmedSourceBoxes: r.confirmedSourceBoxes.map(b => ({ ...b })), targetEnvelopeBox: { ...r.targetEnvelopeBox } };
}
export function confirmedStaticSetDigest(targets: readonly Pick<ConfirmedTargetStaticProof["targets"][number], "targetId" | "segmentId" | "range" | "confirmation">[]): string {
  return hash(JSON.stringify(targets.map(t => ({ targetId: t.targetId, segmentId: t.segmentId, range: t.range, confirmation: t.confirmation }))));
}
/** Exhaustive classification: the one explicitly downgraded RGB signal is never a blanket INCOMPLETE exemption. */
export function classifyStaticCandidateForProof(receipt: StaticMaskCandidate["receipt"]): "SUPPORTED" | "HISTORICAL_RGB_SIGNAL" {
  if (receipt.method !== "cpu-static-conservative-mask-development/v2" || JSON.stringify(receipt.config) !== JSON.stringify(STATIC_MASK_CONFIG)
    || receipt.configDigest !== hash(JSON.stringify(STATIC_MASK_CONFIG)) || !receipt.mask) staticIncomplete("unsupported mask method/config or missing mask");
  for (const reason of receipt.reasons) switch (reason) {
    case "FULL_RANGE_STATIC_CONTRADICTION": break;
    case "TARGET_NOT_SEPARABLE": case "STABLE_COMPONENT_EXTENT_UNRESOLVED": case "CONSERVATIVE_MARGIN_EXTENT_UNRESOLVED":
    case "INSUFFICIENT_ORIGINAL_REPRESENTATIVES": staticIncomplete(`hard mask reason ${reason}`);
    default: staticIncomplete(`unknown mask reason ${reason}`);
  }
  if (receipt.reasons.length === 1 && receipt.reasons[0] === "FULL_RANGE_STATIC_CONTRADICTION"
    && receipt.status === "INCOMPLETE" && receipt.fullRangeVerification === "REJECTED" && receipt.anomalies.length) return "HISTORICAL_RGB_SIGNAL";
  if (!receipt.reasons.length && !receipt.anomalies.length && receipt.status === "CANDIDATE_REQUIRES_INDEPENDENT_PIXEL_EVIDENCE"
    && receipt.fullRangeVerification === "CONSISTENT_WITH_STATIC_ENVELOPE") return "SUPPORTED";
  return staticIncomplete("inconsistent mask status/reasons");
}

function rangeMs(first: number, end: number, source: KnowledgeCandidate["source"]): ReviewedRange {
  const [n, d] = source.timeBase.split("/").map(Number);
  return { startMs: Math.floor((first - source.timeOriginPts) * n / d * 1000), endMs: Math.ceil((end - source.timeOriginPts) * n / d * 1000) };
}

/** Durable validation checks the archived bytes; it never recreates live evidence ownership. */
export function checkConfirmedStaticProofV1(candidate: KnowledgeCandidate, raw: ConfirmedTargetStaticProof, blobs: ReadonlyMap<string, Buffer>): void {
  const proof = ConfirmedTargetStaticProofV1Schema.parse(raw), fail = (why: string): never => staticIncomplete(`confirmed proof ${why}`);
  if (proof.sourceKey !== sourceKey(candidate.source) || proof.runId !== candidate.runId || proof.candidateId !== candidate.id
    || proof.factsDigest !== factsDigest(candidate.facts) || proof.confirmedSetDigest !== confirmedStaticSetDigest(proof.targets)
    || candidate.facts.samplingStrategy !== "confirmed-target-static-v1" || candidate.facts.exclusions.length || candidate.changes.length || candidate.resolvedDisputeIds.length
    || candidate.provenance.requests !== 0 || candidate.evidence.some(e => e.kind === "preview" || e.kind === "source-mask-review")) fail("source/run/set/facts mismatch");
  const segments = candidate.facts.targets.flatMap(t => t.segments.map(s => ({ targetId: t.id, segment: s })));
  if (segments.length !== proof.targets.length || segments.some(s => proof.targets.filter(t => t.targetId === s.targetId && t.segmentId === s.segment.id).length !== 1)) fail("confirmed set incomplete");
  const artifacts = candidate.evidence.filter(e => e.kind === "confirmed-target-proof"), used = new Set<string>();
  function doc(digest: string, artifact: "target-confirmation" | "mask-extraction" | "full-range-geometry" | "engineering-method") {
    const refs = artifacts.filter(e => e.digest === digest && e.artifact === artifact), bytes = blobs.get(digest);
    if (refs.length !== 1 || refs[0].version !== 1 || !bytes || bytes.length !== refs[0].byteLength || hash(bytes) !== digest || bytes.length > 8 * 1024 ** 2) return fail("missing/changed artifact bytes");
    used.add(refs[0].id); return JSON.parse(bytes.toString("utf8"));
  }
  if (JSON.stringify(doc(proof.methodArtifactDigest, "engineering-method")) !== methodBytes().toString("utf8")) fail("unsupported engineering method");
  for (const t of proof.targets) {
    const s = segments.find(s => s.targetId === t.targetId && s.segment.id === t.segmentId)!.segment, mask = s.mask;
    if (!mask || mask.sha256 !== t.mask.maskSha256 || mask.creation.method !== "cpu-static-conservative-mask-development" || mask.creation.version !== 2
      || mask.review.method !== "confirmed-target-static" || mask.review.version !== 1 || mask.review.reviewer !== candidate.provenance.supervisor || mask.review.at !== candidate.provenance.at
      || JSON.stringify(mask.evidenceIds) !== JSON.stringify(t.sourceEvidenceIds) || JSON.stringify(s.evidenceIds) !== JSON.stringify(t.sourceEvidenceIds)) fail("mask identity/evidence mismatch");
    const confirmation = doc(t.artifacts.confirmation, "target-confirmation");
    ConfirmationArtifact.parse(confirmation);
    const c = confirmation.receipt as ConfirmedStaticTarget["receipt"];
    if (confirmation.type !== "confirmed-static-target/v2" || c.method !== "confirmed-static-target-development/v2" || c.sourceKey !== proof.sourceKey || c.targetId !== t.targetId
      || c.authority !== "none" || c.eligible !== false || JSON.stringify(c.range) !== JSON.stringify(t.range)
      || JSON.stringify(confirmationFields(c)) !== JSON.stringify(t.confirmation)) fail("confirmation/components mismatch");
    const { confirmationDigest, ...confirmationBody } = c;
    if (hash(JSON.stringify(confirmationBody)) !== confirmationDigest) fail("confirmation digest");
    const boxes = c.confirmedSourceBoxes, x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    if (JSON.stringify(c.targetEnvelopeBox) !== JSON.stringify({ x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y })) fail("envelope mismatch");
    const e = doc(t.artifacts.extraction, "mask-extraction");
    ExtractionArtifact.parse(e);
    for (const ordinals of [e.sampleOrdinals, e.anomalies.map((a: { index: number }) => a.index)] as number[][])
      if (ordinals.some((v, i) => v < t.range.startFrame || v >= t.range.endFrame || i > 0 && v <= ordinals[i - 1])) fail("noncanonical sample/anomaly range");
    if (e.type !== "static-mask-extraction/v2" || e.sourceKey !== proof.sourceKey || e.targetId !== t.targetId || e.confirmationDigest !== c.confirmationDigest
      || e.method !== t.mask.method || e.configDigest !== t.mask.configDigest || e.configDigest !== hash(JSON.stringify(STATIC_MASK_CONFIG)) || JSON.stringify(e.config) !== JSON.stringify(STATIC_MASK_CONFIG)
      || JSON.stringify(e.range) !== JSON.stringify(t.range) || ["bbox", "dataBase64", "encoding", "sha256", "markedPixels"].some(k => JSON.stringify(e.mask?.[k]) !== JSON.stringify(mask![k as keyof typeof mask]))) fail("extraction mask/config binding");
    classifyStaticCandidateForProof(e);
    const gdoc = StaticGeometryArtifactSchema.parse(doc(t.artifacts.geometry, "full-range-geometry")), g = gdoc.receipt;
    const { geometryDigest, ...geometryBody } = g;
    if (hash(JSON.stringify(geometryBody)) !== geometryDigest || g.referenceDigest !== hash(JSON.stringify(gdoc.reference))
      || g.configDigest !== hash(JSON.stringify(STATIC_GEOMETRY_CONFIG)) || g.sourceKey !== proof.sourceKey || g.targetId !== t.targetId
      || g.confirmationDigest !== c.confirmationDigest || g.evidenceDigest !== e.evidenceDigest || JSON.stringify(g.range) !== JSON.stringify(t.range)
      || g.status !== "DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED" || g.issueFrames.length || g.issueRanges.length
      || Object.entries(t.geometry).some(([k, v]) => JSON.stringify(g[k as keyof typeof g]) !== JSON.stringify(v))
      || ["bindingDigest", "clockDigest", "frameCount", "firstPts", "lastPts", "endPts"].some(k => e[k] !== g[k as keyof typeof g])) fail("owned geometry/binding mismatch");
    const limits = STATIC_GEOMETRY_CONFIG, summary = g.summary;
    if (summary.maximumGlobalOffset > limits.maximumOffset || summary.minimumGlobalCorrelation < limits.minimumCorrelation
      || summary.minimumDistinctPeakGap < limits.ambiguityCorrelationGap || summary.maximumLostLandmarkFraction > limits.maximumLostFraction
      || summary.gradientEnergyRatio[0] < limits.energyRatio[0] || summary.gradientEnergyRatio[1] > limits.energyRatio[1]
      || summary.minimumLocalCorrelation < limits.minimumCellCorrelation || summary.maximumLocalOffset > limits.maximumLocalOffset) fail("geometry limits unsupported");
    const range = rangeMs(g.firstPts, g.endPts, candidate.source);
    if (s.track.startMs !== range.startMs || s.track.endMs !== range.endMs) fail("range PTS mismatch");
    for (const [i, id] of t.sourceEvidenceIds.entries()) {
      const frame = candidate.evidence.find(e => e.id === id), bytes = frame ? blobs.get(frame.digest) : undefined;
      if (!frame || frame.kind !== "source" || frame.crop || frame.pts !== (i ? g.lastPts : g.firstPts) || !proof.sourceEvidenceIds.includes(id)
        || !bytes || bytes.length !== frame.byteLength || hash(bytes) !== frame.digest || bytes.length < 24
        || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || bytes.readUInt32BE(16) !== candidate.source.width || bytes.readUInt32BE(20) !== candidate.source.height) fail("boundary original evidence mismatch");
    }
  }
  const sourceIds = new Set(proof.targets.flatMap(t => t.sourceEvidenceIds));
  if (proof.sourceEvidenceIds.length !== sourceIds.size || proof.sourceEvidenceIds.some(id => !sourceIds.has(id)) || artifacts.length !== used.size
    || candidate.evidence.filter(e => e.kind === "source").length !== sourceIds.size) fail("extra/missing durable evidence");
}
