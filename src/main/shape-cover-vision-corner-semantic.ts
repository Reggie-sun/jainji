import type { ShapeCoverMediaTools } from "./shape-cover-alpha.js";
import { assertOwnedDiscoveryEvidence, discoveryHash, type DiscoveryEvidence } from "./source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "./shape-cover-stationary-discovery.js";
import { buildVisionCandidatePacket, type VisionPacket } from "./shape-cover-vision-packet.js";
import { ShapeCoverVisionSession, type VisionReceipt, type CornerReviewContext } from "./shape-cover-vision-router.js";
import { CORNERS, CORNER_SCOPE_POLICY, assertOwnedCornerPlan, createCornerScopePlan, type Corner, type CornerScopePlan } from "./shape-cover-vision-corner-policy.js";
import type { CornerDecision } from "./shape-cover-vision-corner-schema.js";
import { freezeAI } from "./source-fact-ai-contract.js";

export interface ConfirmedCornerTarget {
  logicalTargetId: string; candidateIds: string[]; classification: "OVERLAY_STICKER" | "OVERLAY_LOGO";
  semanticSource: "LUNA" | "SOL"; temporalObservation: "STABLE"; riskFlags: string[];
}
export interface CornerSemanticResult {
  corner: Corner; status: "NO_CANDIDATE" | "NO_OVERLAY" | "CONFIRMED" | "UNRESOLVED"; candidateIds: string[];
  rejectedCandidates: { candidateId: string; classification: string; semanticSource: "LUNA" | "SOL"; reason: string }[];
  unresolvedCandidates: { candidateId: string; reasons: string[] }[]; confirmedTarget?: ConfirmedCornerTarget;
  reasons: string[]; packetDigests: string[]; receiptDigests: string[];
}
export interface HybridCornerSemanticSet {
  version: "HybridCornerSemanticSet/v1";
  status: "CORNER_SEMANTIC_READY" | "CORNER_SEMANTIC_EMPTY" | "CORNER_SEMANTIC_PARTIAL" | "CORNER_SEMANTIC_BLOCKED";
  sourceKey: string; policyVersion: string; policyDigest: string; candidateSetDigest: string; scopeDigest: string;
  outOfScopeCandidateIds: string[]; outOfScopeReason: "OUT_OF_CORNER_SCOPE";
  unknownCandidateIds: string[]; unknownReason: "UNKNOWN_NOT_PROPOSED"; ambiguousCandidateIds: string[];
  assignments: CornerScopePlan["assignments"]; corners: Record<Corner, CornerSemanticResult>;
  packetDigests: string[]; receiptDigests: string[]; receipts: VisionReceipt[];
  requestCounts: { LUNA: number; SOL: number; MINIMAX: number }; sourceErrors: string[];
  verifyFresh(): Promise<void>;
}
const ownedResults = new WeakSet<object>();
const explicitMotion = (r: CornerDecision) => r.decisions.some(d => ["MOVED", "DISAPPEARED", "CHANGED"].includes(d.temporalState));
const needsSol = (r: CornerDecision) => r.decisions.some(d => d.decision === "UNKNOWN" || d.temporalState !== "STABLE" || d.riskFlags.length > 0) ||
  r.groups.some(g => g.sameLogicalOverlay === "UNCERTAIN");
const highRiskDisagreement = (l: CornerDecision, s: CornerDecision) => l.decisions.some(a => s.decisions.some(b => b.candidateId === a.candidateId &&
  a.decision !== "UNKNOWN" && b.decision !== "UNKNOWN" && (a.decision !== b.decision || a.class !== b.class))) ||
  // An explicit independent-overlay observation cannot be silently combined by Sol.
  (l.groups.length > 1 || l.groups.some(g => g.sameLogicalOverlay === false && g.candidateIds.length > 1)) &&
    s.groups.length === 1 && s.groups[0].sameLogicalOverlay === true;

/** Per-corner development owner. No mask, motion algorithm, proof, store, preview or queue calls. */
export async function reviewHybridCornerPlan(plan: CornerScopePlan, session: ShapeCoverVisionSession,
  buildPacket: (ids: readonly string[]) => Promise<VisionPacket>, verifySource: () => Promise<void>, signal: AbortSignal): Promise<HybridCornerSemanticSet> {
  assertOwnedCornerPlan(plan);
  const start = session.receipts.length, packets: VisionPacket[] = [], sourceErrors: string[] = [];
  const corners = Object.fromEntries(CORNERS.map(corner => [corner, { corner, status: "NO_CANDIDATE", candidateIds: [...plan.corners[corner].candidateIds],
    rejectedCandidates: [], unresolvedCandidates: [], reasons: [], packetDigests: [], receiptDigests: [] }])) as unknown as HybridCornerSemanticSet["corners"];
  const fresh = async () => { signal.throwIfAborted(); await verifySource(); signal.throwIfAborted(); };
  const unresolved = (c: CornerSemanticResult, reason: string) => {
    c.status = "UNRESOLVED"; delete c.confirmedTarget; c.reasons = [reason];
    c.unresolvedCandidates = c.candidateIds.filter(id => !c.rejectedCandidates.some(d => d.candidateId === id)).map(candidateId => ({ candidateId, reasons: [reason] }));
  };
  try {
    await fresh();
    if (session.sourceKey !== plan.sourceKey || session.mode !== "CORNER" || session.modelRequests !== 0) throw Error("VISION_SOURCE_BINDING");
    if (plan.failureCode) throw Error(plan.failureCode);
    for (const corner of CORNERS) {
      const c = corners[corner], ids = c.candidateIds;
      await fresh();
      if (!ids.length) continue;
      if (ids.length > CORNER_SCOPE_POLICY.maximumCandidatesPerCorner) { unresolved(c, "CORNER_COMPLEX_UNRESOLVED"); continue; }
      const packet = await buildPacket(ids), m = packet.manifest;
      if (m.sourceKey !== plan.sourceKey || m.sourceWidth !== plan.sourceWidth || m.sourceHeight !== plan.sourceHeight ||
        JSON.stringify(m.candidates) !== JSON.stringify(ids.map(id => plan.allCandidates.find(a => a.candidateId === id)))) throw Error("VISION_CANDIDATE_BINDING");
      packets.push(packet); c.packetDigests.push(packet.packetDigest);
      const context: CornerReviewContext = { corner, cornerScopeRect: plan.corners[corner].scopeRect, policyVersion: plan.policyVersion,
        policyDigest: plan.policyDigest, scopeDigest: plan.scopeDigest };
      const receiptStart = session.receipts.length;
      let luna: CornerDecision, final: CornerDecision, semanticSource: "LUNA" | "SOL" = "LUNA";
      try {
        luna = await session.request("LUNA", packet, signal, context) as CornerDecision;
        final = luna;
        if (explicitMotion(luna)) { unresolved(c, "UNRESOLVED_FOR_STATIC_V1"); continue; }
        if (luna.undetectedCornerOverlaySuspected) { unresolved(c, "UNDETECTED_CORNER_OVERLAY_SUSPECTED"); continue; }
        if (needsSol(luna)) {
          final = await session.request("SOL", packet, signal, { ...context, lunaSummary: luna }) as CornerDecision;
          semanticSource = "SOL";
        }
        if (explicitMotion(final)) { unresolved(c, "UNRESOLVED_FOR_STATIC_V1"); continue; }
        if (final.undetectedCornerOverlaySuspected) { unresolved(c, "UNDETECTED_CORNER_OVERLAY_SUSPECTED"); continue; }
        if (semanticSource === "SOL" && highRiskDisagreement(luna, final)) { unresolved(c, "CORNER_MODEL_DISAGREEMENT"); continue; }
        for (const d of final.decisions) if (d.decision === "REJECT") c.rejectedCandidates.push({ candidateId: d.candidateId,
          classification: d.class, semanticSource, reason: d.shortReason });
        if (needsSol(final)) { unresolved(c, "CORNER_SEMANTIC_UNRESOLVED"); continue; }
        if (!final.groups.length) { c.status = "NO_OVERLAY"; continue; }
        if (final.groups.length > 1 || final.groups[0].sameLogicalOverlay === false && final.groups[0].candidateIds.length > 1) {
          unresolved(c, "CORNER_MULTIPLE_OVERLAYS_UNSUPPORTED"); continue;
        }
        const candidateIds = ids.filter(id => final.groups[0].candidateIds.includes(id));
        c.confirmedTarget = { logicalTargetId: discoveryHash(JSON.stringify({ sourceKey: plan.sourceKey, policyDigest: plan.policyDigest, candidateSetDigest: plan.candidateSetDigest, corner, candidateIds })),
          candidateIds, classification: final.decisions.some(d => candidateIds.includes(d.candidateId) && d.class === "OVERLAY_STICKER") ? "OVERLAY_STICKER" : "OVERLAY_LOGO",
          semanticSource, temporalObservation: "STABLE", riskFlags: [] };
        c.status = "CONFIRMED";
      } catch (error) {
        const last = session.receipts.at(-1);
        if (error instanceof Error && error.message === "VISION_INVALID_OUTPUT" &&
          !["VISION_PACKET_MISMATCH", "VISION_CANDIDATE_MISMATCH", "VISION_CORNER_MISMATCH"].includes(last?.outputFailureCode ?? "")) {
          unresolved(c, "VISION_INVALID_OUTPUT"); // Bad JSON/group syntax skips this corner; never repair or retry.
        } else throw error;
      } finally {
        c.receiptDigests = session.receipts.slice(receiptStart).map(r => discoveryHash(JSON.stringify(r)));
      }
    }
    await fresh(); for (const packet of packets) await packet.verifyFresh();
  } catch (error) {
    const code = error instanceof Error && /^(VISION_[A-Z_]+|MODEL_IMAGE_CAPABILITY_UNAVAILABLE)$/.test(error.message) ? error.message :
      signal.aborted ? "VISION_CANCELLED" : "VISION_STALE_BINDING";
    sourceErrors.push(code);
    for (const c of Object.values(corners)) { c.rejectedCandidates = []; unresolved(c, code); }
  }
  for (const c of Object.values(corners)) {
    const ids = [...(c.confirmedTarget?.candidateIds ?? []), ...c.rejectedCandidates.map(d => d.candidateId), ...c.unresolvedCandidates.map(d => d.candidateId)];
    if (ids.length !== c.candidateIds.length || new Set(ids).size !== ids.length || ids.some(id => !c.candidateIds.includes(id))) throw Error("VISION_CORNER_PARTITION_INVALID");
  }
  const confirmed = CORNERS.some(c => corners[c].status === "CONFIRMED"), partial = plan.ambiguousCandidateIds.length > 0 || CORNERS.some(c => corners[c].status === "UNRESOLVED");
  const status = sourceErrors.length ? "CORNER_SEMANTIC_BLOCKED" : partial ? "CORNER_SEMANTIC_PARTIAL" : confirmed ? "CORNER_SEMANTIC_READY" : "CORNER_SEMANTIC_EMPTY";
  const receipts = session.receipts.slice(start);
  const data = freezeAI({ version: "HybridCornerSemanticSet/v1" as const, status, sourceKey: plan.sourceKey, policyVersion: plan.policyVersion, policyDigest: plan.policyDigest,
    candidateSetDigest: plan.candidateSetDigest, scopeDigest: plan.scopeDigest, outOfScopeCandidateIds: plan.outOfScopeCandidateIds, outOfScopeReason: "OUT_OF_CORNER_SCOPE" as const,
    unknownCandidateIds: plan.unknownCandidateIds, unknownReason: "UNKNOWN_NOT_PROPOSED" as const, ambiguousCandidateIds: plan.ambiguousCandidateIds,
    assignments: plan.assignments, corners, packetDigests: packets.map(p => p.packetDigest), receiptDigests: receipts.map(r => discoveryHash(JSON.stringify(r))),
    receipts, requestCounts: { ...session.requestCounts }, sourceErrors });
  const result = Object.freeze({ ...data, verifyFresh: async () => { await fresh(); for (const packet of packets) await packet.verifyFresh(); } }) as HybridCornerSemanticSet;
  ownedResults.add(result); return result;
}

export async function confirmHybridCornerTargets(evidence: DiscoveryEvidence, tools: ShapeCoverMediaTools,
  session: ShapeCoverVisionSession, signal: AbortSignal): Promise<HybridCornerSemanticSet> {
  assertOwnedDiscoveryEvidence(evidence);
  const plan = createCornerScopePlan(await discoverStationaryTargets(evidence, signal));
  return reviewHybridCornerPlan(plan, session, ids => buildVisionCandidatePacket(evidence, ids, { ...tools, signal }),
    async () => { assertOwnedDiscoveryEvidence(evidence); await evidence.verifyFresh(); }, signal);
}

/** Sole H3 semantic projection; serialized sets have no live freshness authority. */
export async function getConfirmedCornerTargets(result: HybridCornerSemanticSet): Promise<(ConfirmedCornerTarget & {
  corner: Corner; semanticReceiptBinding: { sourceKey: string; policyDigest: string; scopeDigest: string; packetDigests: string[]; receiptDigests: string[] };
})[]> {
  if (!ownedResults.has(result)) throw Error("VISION_CORNER_RESULT_BINDING");
  if (result.status === "CORNER_SEMANTIC_BLOCKED") return [];
  await result.verifyFresh();
  return freezeAI(CORNERS.flatMap(corner => {
    const c = result.corners[corner];
    return c.status === "CONFIRMED" && c.confirmedTarget ? [{ ...structuredClone(c.confirmedTarget), corner,
      semanticReceiptBinding: { sourceKey: result.sourceKey, policyDigest: result.policyDigest, scopeDigest: result.scopeDigest,
        packetDigests: [...c.packetDigests], receiptDigests: [...c.receiptDigests] } }] : [];
  }));
}
