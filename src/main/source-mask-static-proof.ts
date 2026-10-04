import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { z } from "zod";
import { MAX_AUTOMATIC_COVER_TRACKS } from "../shared/automatic-cover.js";
import { ConfirmedTargetStaticProofSchema, KnowledgeCandidateSchema, type ConfirmedTargetStaticProof,
  type KnowledgeCandidate, type KnowledgeEvidence, type ReviewedRange } from "../shared/source-sticker-knowledge.js";
import { factsDigest, sourceKey, type KnowledgeRun } from "./source-sticker-knowledge-store.js";
import { discoveryHash as hash } from "./source-fact-discovery-evidence.js";
import { freezeAI } from "./source-fact-ai-contract.js";
import { assertConfirmedStaticTarget, assertStaticTargetEvidence, staticIncomplete, type ConfirmedStaticTarget } from "./source-mask-static-target.js";
import { STATIC_MASK_CONFIG, readStaticMaskCandidate, type StaticMaskCandidate } from "./source-mask-static-extraction.js";
import { STATIC_GEOMETRY_CONFIG, StaticGeometryArtifactSchema, readOwnedStaticGeometry, type OwnedStaticGeometryEvidence } from "./source-mask-static-geometry.js";
import { encodeShapeCoverPng } from "./shape-cover-alpha.js";
import { AutoContourBitmapSchema } from "./source-mask-auto-extraction.js";
import type { FullSourceCensusInput } from "./source-fact-census.js";

/** Fixed method support, not caller-provided ENGINEERING_ACCEPTED or source safety. */
export const CONFIRMED_STATIC_METHOD = freezeAI({ type: "confirmed-target-static-method/v1", authority: "none", eligible: false,
  confirmationMethod: "confirmed-static-target-development/v2", maskMethod: "cpu-static-conservative-mask-development/v2",
  maskConfig: STATIC_MASK_CONFIG, geometryMethod: "cpu-static-geometry/v1", geometryKernel: STATIC_GEOMETRY_CONFIG,
  controlledCorpusVersion: "static-exact-alpha-corpus/v2", controlledCorpusDigest: "574668d9facb190eea7d33a9e679f278188dbbf42af800e871a4088f2bf5f5f0",
  engineeringEvidenceVersion: "StaticMaskEngineeringEvidence/v2", engineeringEvidenceDigest: "e52752c3220c5952e22e1a602e229287542338c21ed1ff8ff12c5fbafab0a4df",
  methodSources: { "src/main/source-mask-static-extraction.ts": "3d899ee23d23c4a92f6409eab7a4d5fb20e8ea7f502eca656b29dcdc9bb3a874",
    "src/main/source-mask-static-target.ts": "dfbf4b871006c16399b734214d02af86948d8366c2e0f40b3b03c7afae4f23b1",
    "src/main/shape-cover-stationary-discovery.ts": "490c7ce3e7a52ca896c964d02ba3303399e2b4b1a1d60a8c67b0959359437388" },
  claims: ["CONTROLLED_EXACT_ZERO_MISS", "REAL_DEVELOPMENT_NO_VISIBLE_RESIDUAL_ON_FROZEN_RISK_SET", "FULL_RANGE_GEOMETRY_SUPPORTED_WITHIN_V2_LIMITS"] });
const methodBytes = () => Buffer.from(JSON.stringify(CONFIRMED_STATIC_METHOD));
const Digest = z.string().regex(/^[a-f0-9]{64}$/), Ordinal = z.number().int().nonnegative().safe(), Pts = z.number().int().safe();
const TargetProofShape = ConfirmedTargetStaticProofSchema.innerType().shape.targets.element.shape;
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
type Entry = { segmentId: string; target: ConfirmedStaticTarget };
export interface FrozenConfirmedStaticTargetSet { readonly receipt: Readonly<{ method: "confirmed-static-target-set/v1"; sourceKey: string; confirmedSetDigest: string; count: number }> }
const sets = new WeakMap<FrozenConfirmedStaticTargetSet, readonly Entry[]>();
const entryKey = (t: { targetId: string; segmentId: string; range: { startFrame: number } }) => `${t.targetId}:${t.range.startFrame.toString().padStart(8, "0")}:${t.segmentId}`;
function confirmationFields(r: ConfirmedStaticTarget["receipt"]): ConfirmedTargetStaticProof["targets"][number]["confirmation"] {
  return { method: r.method, confirmationDigest: r.confirmationDigest, discoveryDigest: r.discoveryDigest, resultDigest: r.resultDigest,
    confirmedCandidateIds: [...r.confirmedCandidateIds], confirmedComponentDigests: [...r.confirmedComponentDigests],
    confirmedSourceBoxes: r.confirmedSourceBoxes.map(b => ({ ...b })), targetEnvelopeBox: { ...r.targetEnvelopeBox } };
}
export function confirmedStaticSetDigest(targets: readonly Pick<ConfirmedTargetStaticProof["targets"][number], "targetId" | "segmentId" | "range" | "confirmation">[]): string {
  return hash(JSON.stringify(targets.map(t => ({ targetId: t.targetId, segmentId: t.segmentId, range: t.range, confirmation: t.confirmation }))));
}
/** Explicitly freezes C before mask/proof publication; omitted/extra extraction results cannot change C. */
export function freezeConfirmedStaticTargetSet(raw: readonly Entry[]): FrozenConfirmedStaticTargetSet {
  if (!raw.length || raw.length > MAX_AUTOMATIC_COVER_TRACKS || new Set(raw.map(v => v.segmentId)).size !== raw.length) staticIncomplete("invalid confirmed set");
  for (const e of raw) { assertConfirmedStaticTarget(e.target); if (!/^[a-zA-Z0-9_-]{1,120}$/.test(e.segmentId)) staticIncomplete("invalid segment ID"); }
  const entries = [...raw].sort((a, b) => { const x = entryKey({ ...a.target.receipt, segmentId: a.segmentId }), y = entryKey({ ...b.target.receipt, segmentId: b.segmentId }); return x < y ? -1 : x > y ? 1 : 0; });
  const key = entries[0].target.receipt.sourceKey;
  if (entries.some(e => e.target.receipt.sourceKey !== key)) staticIncomplete("cross-source confirmed set");
  const targets = entries.map(e => ({ targetId: e.target.receipt.targetId, segmentId: e.segmentId, range: e.target.receipt.range, confirmation: confirmationFields(e.target.receipt) }));
  const result = freezeAI({ receipt: { method: "confirmed-static-target-set/v1" as const, sourceKey: key, confirmedSetDigest: confirmedStaticSetDigest(targets), count: entries.length } });
  sets.set(result, Object.freeze(entries.map(e => Object.freeze({ ...e })))); return result;
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

type Inputs = { segmentId: string; candidate: StaticMaskCandidate; geometry: OwnedStaticGeometryEvidence };
type Issuance = { candidate: KnowledgeCandidate; proof: ConfirmedTargetStaticProof; blobs: Map<string, Buffer> };
const proofs = new WeakMap<ConfirmedTargetStaticProof, { candidateJson: string; blobDigests: Map<string, string>; verify: () => Promise<void>; check: () => void }>();
function rangeMs(first: number, end: number, source: KnowledgeCandidate["source"]): ReviewedRange {
  const [n, d] = source.timeBase.split("/").map(Number);
  return { startMs: Math.floor((first - source.timeOriginPts) * n / d * 1000), endMs: Math.ceil((end - source.timeOriginPts) * n / d * 1000) };
}

export async function issueConfirmedTargetStaticProof(input: FullSourceCensusInput, run: KnowledgeRun, set: FrozenConfirmedStaticTargetSet,
  results: readonly Inputs[], baseRevisionId: string | null = null): Promise<Issuance> {
  const entries = sets.get(set); if (!entries) staticIncomplete("unowned confirmed set");
  input.signal.throwIfAborted();
  if (results.length !== entries.length || new Set(results.map(r => r.segmentId)).size !== results.length) staticIncomplete("confirmed set incomplete or duplicated");
  const matched = entries.map(e => {
    const result = results.find(r => r.segmentId === e.segmentId); if (!result) staticIncomplete("confirmed segment omitted");
    const maskOwner = readStaticMaskCandidate(result.candidate), geoOwner = readOwnedStaticGeometry(result.geometry);
    if (maskOwner.evidence.target !== e.target || geoOwner.evidence !== maskOwner.evidence || geoOwner.candidate !== result.candidate
      || result.geometry.receipt.status !== "DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED" || result.geometry.receipt.issueFrames.length) staticIncomplete("unowned/mismatched or unsupported geometry");
    classifyStaticCandidateForProof(result.candidate.receipt); return { ...e, ...result, evidence: maskOwner.evidence, geoOwner };
  });
  if (sourceKey(input.source) !== set.receipt.sourceKey) staticIncomplete("proof source mismatch");
  const inputBinding = { sourcePath: await realpath(input.sourcePath), ffmpegPath: await realpath(input.ffmpeg.ffmpegPath), ffprobePath: await realpath(input.ffmpeg.ffprobePath) };
  if (matched.some(m => Object.entries(inputBinding).some(([k, p]) => m.geoOwner.inputBinding[k as keyof typeof inputBinding] !== p))) staticIncomplete("proof source/engine binding mismatch");
  const verify = async () => {
    input.signal.throwIfAborted(); for (const m of matched) { assertConfirmedStaticTarget(m.target); await m.geoOwner.verifyFresh(); }
    for (const [p, expected] of Object.entries(CONFIRMED_STATIC_METHOD.methodSources)) if (hash(await readFile(p)) !== expected) staticIncomplete("qualified confirmation/mask method changed");
    input.signal.throwIfAborted();
  };
  await verify();
  // A synchronous generation fence is also checked at the manifest publication point.
  const paths = [...new Set([await realpath(input.sourcePath), await realpath(input.ffmpeg.ffmpegPath), await realpath(input.ffmpeg.ffprobePath),
    ...matched.flatMap(m => Object.keys(m.geometry.receipt.methodSources)), ...Object.keys(CONFIRMED_STATIC_METHOD.methodSources),
    "src/main/source-mask-static-proof.ts", "src/shared/source-sticker-knowledge.ts", "src/main/source-sticker-knowledge-store.ts"])];
  const generations = paths.map(p => statSync(p, { bigint: true }));
  const check = () => {
    input.signal.throwIfAborted(); if (!sets.has(set)) staticIncomplete("closed confirmed set");
    for (const m of matched) { assertStaticTargetEvidence(m.evidence); readOwnedStaticGeometry(m.geometry).checkFresh(); if (Date.now() >= m.evidence.deadline) staticIncomplete("proof evidence expired"); }
    paths.forEach((p, i) => { const s = statSync(p, { bigint: true }); if (["dev", "ino", "size", "mtimeNs", "ctimeNs"].some(k => s[k as keyof typeof s] !== generations[i][k as keyof typeof s])) staticIncomplete("proof source/engine/method generation changed"); });
  };
  const blobs = new Map<string, Buffer>(), evidence: KnowledgeEvidence[] = [], sources = new Map<number, string>();
  const at = new Date().toISOString(), reviewer = "local-static-proof-issuer", id = randomUUID(), targets: ConfirmedTargetStaticProof["targets"] = [];
  const addArtifact = (artifact: "target-confirmation" | "mask-extraction" | "full-range-geometry" | "engineering-method", value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value)), digest = hash(bytes);
    evidence.push({ id: `proof-${evidence.length}`, kind: "confirmed-target-proof", version: 1, artifact, digest, byteLength: bytes.length }); blobs.set(digest, bytes); return digest;
  };
  const methodArtifactDigest = addArtifact("engineering-method", CONFIRMED_STATIC_METHOD);
  const factTargets: KnowledgeCandidate["facts"]["targets"] = [], observations: KnowledgeCandidate["facts"]["observations"] = [], ranges: ReviewedRange[] = [];
  for (const m of matched) {
    const r = m.candidate.receipt, c = m.target.receipt, g = m.geometry.receipt, discovery = assertConfirmedStaticTarget(m.target);
    const sourceEvidenceIds: [string, string] = ["", ""];
    for (const [i, ordinal] of [c.range.startFrame, c.range.endFrame - 1].entries()) {
      let evidenceId = sources.get(ordinal);
      if (!evidenceId) {
        const sample = discovery.receipt.frames.findIndex(f => f.index === ordinal);
        if (sample < 0) staticIncomplete("range boundary original evidence missing");
        const frame = discovery.receipt.frames[sample], rgba = await discovery.readFrame(sample);
        const png = await encodeShapeCoverPng(rgba, input.source, { ...input.ffmpeg, signal: input.signal });
        evidenceId = `source-${ordinal}`;
        const [n, d] = input.source.timeBase.split("/").map(Number);
        evidence.push({ id: evidenceId, kind: "source", digest: hash(png), byteLength: png.length, pts: frame.pts,
          timeMs: (frame.pts - input.source.timeOriginPts) * n / d * 1000, width: input.source.width, height: input.source.height });
        blobs.set(hash(png), png); sources.set(ordinal, evidenceId);
      }
      sourceEvidenceIds[i] = evidenceId;
    }
    const artifacts = { confirmation: addArtifact("target-confirmation", { type: "confirmed-static-target/v2", receipt: c }),
      extraction: addArtifact("mask-extraction", { type: "static-mask-extraction/v2", sourceKey: c.sourceKey, targetId: c.targetId,
        confirmationDigest: c.confirmationDigest, evidenceDigest: r.evidenceDigest, receiptDigest: r.receiptDigest, method: r.method, config: r.config, configDigest: r.configDigest,
        range: r.range, mask: r.mask, status: r.status, reasons: r.reasons, fullRangeVerification: r.fullRangeVerification,
        anomalies: r.anomalies, sampleOrdinals: r.sampleOrdinals, frameCount: r.frames.length, firstPts: r.frames[0].pts, lastPts: r.frames.at(-1)!.pts,
        endPts: r.frames.at(-1)!.endPts, bindingDigest: hash(JSON.stringify(r.frames)), clockDigest: g.clockDigest }),
      geometry: addArtifact("full-range-geometry", { type: "owned-static-geometry/v1", receipt: g, reference: m.geoOwner.data.reference }) };
    targets.push({ targetId: c.targetId, segmentId: m.segmentId, range: { ...c.range }, confirmation: confirmationFields(c),
      mask: { method: "cpu-static-conservative-mask-development/v2", configDigest: r.configDigest, maskSha256: r.mask!.sha256 },
      geometry: { method: "cpu-static-geometry/v1", geometryDigest: g.geometryDigest, configDigest: g.configDigest, referenceDigest: g.referenceDigest,
        frameMetricsDigest: g.frameMetricsDigest, evidenceDigest: g.evidenceDigest, bindingDigest: g.bindingDigest, clockDigest: g.clockDigest,
        frameCount: g.frameCount, firstPts: g.firstPts, lastPts: g.lastPts, endPts: g.endPts }, sourceEvidenceIds, artifacts });
    const range = rangeMs(g.firstPts, g.endPts, input.source), b = r.mask!.bbox;
    const rectangle = { x: b.x / input.source.width, y: b.y / input.source.height, width: b.width / input.source.width, height: b.height / input.source.height };
    const segment = { id: m.segmentId, track: { ...range, keyframes: [{ timeMs: range.startMs, rectangle }] }, interpolation: "linear" as const, evidenceIds: sourceEvidenceIds,
      mask: { ...r.mask!, kind: "static-binary-v1" as const, creation: { method: "cpu-static-conservative-mask-development", version: 2 },
        review: { method: "confirmed-target-static", version: 1, reviewer, at }, evidenceIds: sourceEvidenceIds } };
    let ft = factTargets.find(t => t.id === c.targetId); if (!ft) { ft = { id: c.targetId, segments: [] }; factTargets.push(ft); } ft.segments.push(segment);
    for (const evidenceId of sourceEvidenceIds) observations.push({ evidenceId, targetId: c.targetId, presence: "PRESENT", rectangle }); ranges.push(range);
  }
  ranges.sort((a, b) => a.startMs - b.startMs); const reviewedRanges: ReviewedRange[] = [];
  for (const range of ranges) { const last = reviewedRanges.at(-1); if (last && range.startMs <= last.endMs) last.endMs = Math.max(last.endMs, range.endMs); else reviewedRanges.push({ ...range }); }
  const candidate = KnowledgeCandidateSchema.parse({ schemaVersion: 1, id, state: "candidate", source: input.source, baseRevisionId, runId: run.id, requiredRanges: reviewedRanges,
    facts: { reviewedRanges, targets: factTargets, exclusions: [], observations, samplingStrategy: "confirmed-target-static-v1" }, evidence,
    resolvedDisputeIds: [], changes: [], provenance: { executor: "cpu-static-confirmed-target", supervisor: reviewer, contractVersion: 1, requests: 0, at } });
  const proof = freezeAI(ConfirmedTargetStaticProofSchema.parse({ mode: "confirmed-target-static-v1", authority: "none", eligible: false,
    candidateId: id, runId: run.id, sourceKey: set.receipt.sourceKey, factsDigest: factsDigest(candidate.facts), confirmedSetDigest: set.receipt.confirmedSetDigest,
    sourceEvidenceIds: [...sources.values()], methodArtifactDigest, targets }));
  checkConfirmedStaticProof(candidate, proof, blobs); await verify(); check();
  const candidateJson = JSON.stringify(candidate), blobDigests = new Map([...blobs].map(([k, b]) => [k, hash(b)]));
  proofs.set(proof, { candidateJson, blobDigests, verify, check });
  return { candidate: freezeAI(candidate), proof, blobs };
}

export function authorizeConfirmedStaticProof(candidate: KnowledgeCandidate, proof: ConfirmedTargetStaticProof, blobs: ReadonlyMap<string, Buffer>) {
  const owned = proofs.get(proof); if (!owned) staticIncomplete("unowned confirmed-target proof");
  if (JSON.stringify(KnowledgeCandidateSchema.parse(candidate)) !== owned.candidateJson
    || [...owned.blobDigests].some(([k, v]) => !blobs.has(k) || hash(blobs.get(k)!) !== v)) staticIncomplete("issued candidate or evidence changed");
  owned.check(); return { verify: owned.verify, check: owned.check };
}

/** Durable validation checks the archived bytes; it never recreates live evidence ownership. */
export function checkConfirmedStaticProof(candidate: KnowledgeCandidate, raw: ConfirmedTargetStaticProof, blobs: ReadonlyMap<string, Buffer>): void {
  const proof = ConfirmedTargetStaticProofSchema.parse(raw), fail = (why: string): never => staticIncomplete(`confirmed proof ${why}`);
  if (proof.sourceKey !== sourceKey(candidate.source) || proof.runId !== candidate.runId || proof.candidateId !== candidate.id
    || proof.factsDigest !== factsDigest(candidate.facts) || proof.confirmedSetDigest !== confirmedStaticSetDigest(proof.targets)
    || candidate.facts.samplingStrategy !== "confirmed-target-static-v1" || candidate.facts.exclusions.length || candidate.changes.length || candidate.resolvedDisputeIds.length
    || candidate.provenance.requests !== 0 || candidate.evidence.some(e => e.kind === "preview" || e.kind === "source-mask-review")) fail("source/run/set/facts mismatch");
  const segments = candidate.facts.targets.flatMap(t => t.segments.map(s => ({ targetId: t.id, segment: s })));
  if (segments.length !== proof.targets.length || segments.some(s => proof.targets.filter(t => t.targetId === s.targetId && t.segmentId === s.segment.id).length !== 1)) fail("confirmed set incomplete");
  const artifacts = candidate.evidence.filter(e => e.kind === "confirmed-target-proof"), used = new Set<string>();
  function doc(digest: string, artifact: "target-confirmation" | "mask-extraction" | "full-range-geometry" | "engineering-method") {
    const refs = artifacts.filter(e => e.digest === digest && e.artifact === artifact), bytes = blobs.get(digest);
    if (refs.length !== 1 || !bytes || bytes.length !== refs[0].byteLength || hash(bytes) !== digest || bytes.length > 8 * 1024 ** 2) return fail("missing/changed artifact bytes");
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
