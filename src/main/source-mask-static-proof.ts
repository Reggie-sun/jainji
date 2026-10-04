import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { MAX_AUTOMATIC_COVER_TRACKS } from "../shared/automatic-cover.js";
import { ConfirmedTargetStaticProofV2Schema, KnowledgeCandidateSchema, type ConfirmedTargetStaticProof, type ConfirmedTargetStaticProofV2,
  type KnowledgeCandidate, type KnowledgeEvidence, type ReviewedRange } from "../shared/source-sticker-knowledge.js";
import { factsDigest, sourceKey, type KnowledgeRun } from "./source-sticker-knowledge-store.js";
import { discoveryHash as hash } from "./source-fact-discovery-evidence.js";
import { freezeAI } from "./source-fact-ai-contract.js";
import { assertConfirmedStaticTarget, assertStaticTargetEvidence, staticIncomplete, type ConfirmedStaticTarget } from "./source-mask-static-target.js";
import { readStaticMaskCandidate, type StaticMaskCandidate } from "./source-mask-static-extraction.js";
import { readOwnedStaticGeometry, type OwnedStaticGeometryEvidence } from "./source-mask-static-geometry.js";
import { readExactSourceFrames } from "./source-fact-exact-frames.js";
import { checkConfirmedStaticProofV1, CONFIRMED_STATIC_METHOD_V1 } from "./source-mask-static-proof-v1.js";
export { CONFIRMED_STATIC_METHOD_V1 };
import type { FullSourceCensusInput } from "./source-fact-census.js";

import { CONFIRMED_STATIC_METHOD_V2, checkConfirmedStaticProofV2, classifyStaticCandidateForProof } from "./source-mask-static-proof-v2.js";
export { CONFIRMED_STATIC_METHOD_V2, classifyStaticCandidateForProof };
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

type Inputs = { segmentId: string; candidate: StaticMaskCandidate; geometry: OwnedStaticGeometryEvidence };
type Issuance = { candidate: KnowledgeCandidate; proof: ConfirmedTargetStaticProofV2; blobs: Map<string, Buffer> };
const proofs = new WeakMap<ConfirmedTargetStaticProofV2, { candidateJson: string; blobDigests: Map<string, string>; verify: () => Promise<void>; check: () => void }>();
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
      || result.geometry.receipt.status !== "DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED" || result.geometry.receipt.issueFrames.length
      || result.geometry.receipt.components.some(c => c.status !== "SUPPORTED" || c.issueFrames.length)) staticIncomplete("unowned/mismatched or unsupported geometry");
    classifyStaticCandidateForProof(result.candidate.receipt); return { ...e, ...result, evidence: maskOwner.evidence, geoOwner };
  });
  if (sourceKey(input.source) !== set.receipt.sourceKey) staticIncomplete("proof source mismatch");
  const inputBinding = { sourcePath: await realpath(input.sourcePath), ffmpegPath: await realpath(input.ffmpeg.ffmpegPath), ffprobePath: await realpath(input.ffmpeg.ffprobePath) };
  if (matched.some(m => Object.entries(inputBinding).some(([k, p]) => m.geoOwner.inputBinding[k as keyof typeof inputBinding] !== p))) staticIncomplete("proof source/engine binding mismatch");
  const verify = async () => {
    input.signal.throwIfAborted(); for (const m of matched) { assertConfirmedStaticTarget(m.target); await m.geoOwner.verifyFresh(); }
    for (const [p, expected] of Object.entries(CONFIRMED_STATIC_METHOD_V2.methodSources)) if (hash(await readFile(p)) !== expected) staticIncomplete("qualified confirmation/mask method changed");
    input.signal.throwIfAborted();
  };
  await verify();
  // A synchronous generation fence is also checked at the manifest publication point.
  const paths = [...new Set([await realpath(input.sourcePath), await realpath(input.ffmpeg.ffmpegPath), await realpath(input.ffmpeg.ffprobePath),
    ...matched.flatMap(m => Object.keys(m.geometry.receipt.methodSources)), ...Object.keys(CONFIRMED_STATIC_METHOD_V2.methodSources),
    "src/main/source-mask-static-proof.ts", "src/main/source-mask-static-proof-v2.ts", "src/main/source-fact-exact-frames.ts", "src/shared/source-sticker-knowledge.ts", "src/main/source-sticker-knowledge-store.ts"])];
  const generations = paths.map(p => statSync(p, { bigint: true }));
  const check = () => {
    input.signal.throwIfAborted(); if (!sets.has(set)) staticIncomplete("closed confirmed set");
    for (const m of matched) { assertStaticTargetEvidence(m.evidence); readOwnedStaticGeometry(m.geometry).checkFresh(); if (Date.now() >= m.evidence.deadline) staticIncomplete("proof evidence expired"); }
    paths.forEach((p, i) => { const s = statSync(p, { bigint: true }); if (["dev", "ino", "size", "mtimeNs", "ctimeNs"].some(k => s[k as keyof typeof s] !== generations[i][k as keyof typeof s])) staticIncomplete("proof source/engine/method generation changed"); });
  };
  const blobs = new Map<string, Buffer>(), evidence: KnowledgeEvidence[] = [], sources = new Map<number, string>();
  const at = new Date().toISOString(), reviewer = "local-static-proof-issuer", id = randomUUID(), targets: ConfirmedTargetStaticProofV2["targets"] = [];
  const addArtifact = (artifact: "target-confirmation" | "mask-extraction" | "full-range-geometry" | "engineering-method", value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value)), digest = hash(bytes);
    evidence.push({ id: `proof-${evidence.length}`, kind: "confirmed-target-proof", version: 2, artifact, digest, byteLength: bytes.length }); blobs.set(digest, bytes); return digest;
  };
  const methodArtifactDigest = addArtifact("engineering-method", CONFIRMED_STATIC_METHOD_V2);
  const boundaryFrames = await readExactSourceFrames(input, matched[0].evidence.clock,
    matched.flatMap(m => [m.target.receipt.range.startFrame, m.target.receipt.range.endFrame - 1]), Math.min(...matched.map(m => m.evidence.deadline)));
  const discovery = assertConfirmedStaticTarget(matched[0].target);
  if (boundaryFrames.bindings.some(f => f.ffmpegFingerprint !== discovery.receipt.decode.ffmpegFingerprint
    || f.ffprobeFingerprint !== discovery.receipt.decode.ffprobeFingerprint || f.clockDigest !== discovery.receipt.clockDigest)) staticIncomplete("exact boundary decode interpretation mismatch");
  const factTargets: KnowledgeCandidate["facts"]["targets"] = [], observations: KnowledgeCandidate["facts"]["observations"] = [], ranges: ReviewedRange[] = [];
  for (const m of matched) {
    const r = m.candidate.receipt, c = m.target.receipt, g = m.geometry.receipt;
    const sourceEvidenceIds: [string, string] = ["", ""];
    for (const [i, ordinal] of [c.range.startFrame, c.range.endFrame - 1].entries()) {
      let evidenceId = sources.get(ordinal);
      if (!evidenceId) {
        const frame = boundaryFrames.bindings.find(f => f.index === ordinal)!;
        const rgba = boundaryFrames.readFrame(ordinal);
        evidenceId = `source-${ordinal}`;
        const [n, d] = input.source.timeBase.split("/").map(Number);
        evidence.push({ id: evidenceId, kind: "source", digest: hash(rgba), byteLength: rgba.length, pts: frame.pts,
          timeMs: (frame.pts - input.source.timeOriginPts) * n / d * 1000, width: input.source.width, height: input.source.height });
        blobs.set(hash(rgba), rgba); sources.set(ordinal, evidenceId);
      }
      // Independently bind each target's ROI boundary pixels to the exact full original.
      const full = boundaryFrames.readFrame(ordinal), roi = m.evidence.roi, cropped = Buffer.alloc(roi.width * roi.height * 4);
      for (let y = 0; y < roi.height; y++) full.copy(cropped, y * roi.width * 4,
        ((roi.y + y) * input.source.width + roi.x) * 4, ((roi.y + y) * input.source.width + roi.x + roi.width) * 4);
      if (hash(cropped) !== r.frames[i ? r.frames.length - 1 : 0].pixelSha256) staticIncomplete("boundary ordinal pixel bytes mismatch");
      sourceEvidenceIds[i] = evidenceId;
    }
    const artifacts = { confirmation: addArtifact("target-confirmation", { type: "confirmed-static-target/v2", receipt: c }),
      extraction: addArtifact("mask-extraction", { type: "static-mask-extraction/v2", sourceKey: c.sourceKey, targetId: c.targetId,
        confirmationDigest: c.confirmationDigest, evidenceDigest: r.evidenceDigest, receiptDigest: r.receiptDigest, method: r.method, config: r.config, configDigest: r.configDigest,
        range: r.range, mask: r.mask, status: r.status, reasons: r.reasons, fullRangeVerification: r.fullRangeVerification,
        anomalies: r.anomalies, sampleOrdinals: r.sampleOrdinals, frameCount: r.frames.length, firstPts: r.frames[0].pts, firstEndPts: r.frames[0].endPts, lastPts: r.frames.at(-1)!.pts,
        endPts: r.frames.at(-1)!.endPts, bindingDigest: hash(JSON.stringify(r.frames)), clockDigest: g.clockDigest }),
      geometry: addArtifact("full-range-geometry", { type: "owned-static-geometry/v2", receipt: g, references: m.geoOwner.data.references }) };
    targets.push({ targetId: c.targetId, segmentId: m.segmentId, range: { ...c.range }, confirmation: confirmationFields(c),
      mask: { method: "cpu-static-conservative-mask-development/v2", configDigest: r.configDigest, maskSha256: r.mask!.sha256 },
      geometry: { method: "cpu-static-geometry/v2", geometryDigest: g.geometryDigest, configDigest: g.configDigest, referenceDigest: g.referenceDigest,
        frameMetricsDigest: g.frameMetricsDigest, evidenceDigest: g.evidenceDigest, bindingDigest: g.bindingDigest, clockDigest: g.clockDigest,
        frameCount: g.frameCount, firstPts: g.firstPts, lastPts: g.lastPts, endPts: g.endPts,
        components: g.components.map(v => ({ candidateId: v.candidateId, componentDigest: v.componentDigest, sourceBox: v.sourceBox,
          method: v.method, referenceDigest: v.referenceDigest, metricsDigest: v.metricsDigest, frameCount: v.frameCount, status: "SUPPORTED" as const })) },
      boundaryFrames: [boundaryFrames.bindings.find(f => f.index === c.range.startFrame)!, boundaryFrames.bindings.find(f => f.index === c.range.endFrame - 1)!], sourceEvidenceIds, artifacts });
    const range = rangeMs(g.firstPts, g.endPts, input.source), b = r.mask!.bbox;
    const rectangle = { x: b.x / input.source.width, y: b.y / input.source.height, width: b.width / input.source.width, height: b.height / input.source.height };
    const segment = { id: m.segmentId, track: { ...range, keyframes: [{ timeMs: range.startMs, rectangle }] }, interpolation: "linear" as const, evidenceIds: sourceEvidenceIds,
      mask: { ...r.mask!, kind: "static-binary-v1" as const, creation: { method: "cpu-static-conservative-mask-development", version: 2 },
        review: { method: "confirmed-target-static", version: 2, reviewer, at }, evidenceIds: sourceEvidenceIds } };
    let ft = factTargets.find(t => t.id === c.targetId); if (!ft) { ft = { id: c.targetId, segments: [] }; factTargets.push(ft); } ft.segments.push(segment);
    for (const evidenceId of sourceEvidenceIds) observations.push({ evidenceId, targetId: c.targetId, presence: "PRESENT", rectangle }); ranges.push(range);
  }
  ranges.sort((a, b) => a.startMs - b.startMs); const reviewedRanges: ReviewedRange[] = [];
  for (const range of ranges) { const last = reviewedRanges.at(-1); if (last && range.startMs <= last.endMs) last.endMs = Math.max(last.endMs, range.endMs); else reviewedRanges.push({ ...range }); }
  const candidate = KnowledgeCandidateSchema.parse({ schemaVersion: 1, id, state: "candidate", source: input.source, baseRevisionId, runId: run.id, requiredRanges: reviewedRanges,
    facts: { reviewedRanges, targets: factTargets, exclusions: [], observations, samplingStrategy: "confirmed-target-static-v2" }, evidence,
    resolvedDisputeIds: [], changes: [], provenance: { executor: "cpu-static-confirmed-target", supervisor: reviewer, contractVersion: 1, requests: 0, at } });
  const proof = freezeAI(ConfirmedTargetStaticProofV2Schema.parse({ mode: "confirmed-target-static-v2", authority: "none", eligible: false,
    candidateId: id, runId: run.id, sourceKey: set.receipt.sourceKey, factsDigest: factsDigest(candidate.facts), confirmedSetDigest: set.receipt.confirmedSetDigest,
    sourceEvidenceIds: [...sources.values()], methodArtifactDigest, targets }));
  checkConfirmedStaticProof(candidate, proof, blobs); await boundaryFrames.verifyFresh(); await verify(); check();
  const candidateJson = JSON.stringify(candidate), blobDigests = new Map([...blobs].map(([k, b]) => [k, hash(b)]));
  proofs.set(proof, { candidateJson, blobDigests, verify, check });
  return { candidate: freezeAI(candidate), proof, blobs };
}

export function authorizeConfirmedStaticProof(candidate: KnowledgeCandidate, proof: ConfirmedTargetStaticProof, blobs: ReadonlyMap<string, Buffer>) {
  if (proof.mode !== "confirmed-target-static-v2") staticIncomplete("historical v1 cannot be newly issued");
  const owned = proofs.get(proof); if (!owned) staticIncomplete("unowned confirmed-target proof");
  if (JSON.stringify(KnowledgeCandidateSchema.parse(candidate)) !== owned.candidateJson
    || [...owned.blobDigests].some(([k, v]) => !blobs.has(k) || hash(blobs.get(k)!) !== v)) staticIncomplete("issued candidate or evidence changed");
  owned.check(); return { verify: owned.verify, check: owned.check };
}

/** Version dispatch over archived bytes; live issuer freshness is a separate contract. */
export function checkConfirmedStaticProof(candidate: KnowledgeCandidate, raw: ConfirmedTargetStaticProof, blobs: ReadonlyMap<string, Buffer>): void {
  if (raw.mode === "confirmed-target-static-v1") return checkConfirmedStaticProofV1(candidate, raw, blobs);
  return checkConfirmedStaticProofV2(candidate, raw, blobs);
}
