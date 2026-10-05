import type { ShapeCoverMediaTools } from "./shape-cover-alpha.js";
import { assertOwnedDiscoveryEvidence, discoveryHash, type DiscoveryEvidence } from "./source-fact-discovery-evidence.js";
import { discoverStationaryTargets, type StationaryDiscoveryResult } from "./shape-cover-stationary-discovery.js";
import { buildVisionCandidatePacket, type VisionComponent, type VisionPacket } from "./shape-cover-vision-packet.js";
import { ShapeCoverVisionSession, type VisionReceipt, type SemanticReviewContext } from "./shape-cover-vision-router.js";
import type { CandidateDecision } from "./shape-cover-vision-schema.js";
import { freezeAI } from "./source-fact-ai-contract.js";

export const HYBRID_SEMANTIC_LIMITS = Object.freeze({ candidates: 12, packetCandidates: 3, lunaPackets: 4, solPackets: 2, proximityFraction: 0.12 });
export interface HybridSemanticBatchPlan {
  sourceKey: string; candidateSetDigest: string; batchPlanDigest: string;
  allCandidates: VisionComponent[]; allCandidateIds: string[]; unknownCandidateIds: string[];
  batches: string[][]; spatialClusters: string[][]; failureCode: string | null;
}
export interface HybridConfirmedGroup {
  groupId: string; candidateIds: string[]; classification: "OVERLAY_STICKER" | "OVERLAY_LOGO";
  temporalAssessment: "STABLE" | "UNCERTAIN"; semanticSource: "LUNA" | "SOL"; riskFlags: string[];
  resolutionReason: string;
}
export interface HybridSemanticTargetSet {
  version: "hybrid-semantic-target-set/v1";
  status: "SEMANTIC_CONFIRMED" | "SEMANTIC_UNRESOLVED" | "SEMANTIC_UNSAFE";
  sourceKey: string; candidateSetDigest: string; batchPlanDigest: string; allCandidateIds: string[];
  confirmedGroups: HybridConfirmedGroup[];
  rejectedCandidates: { candidateId: string; classification: string; semanticSource: "LUNA" | "SOL"; reason: string }[];
  unresolvedCandidates: { candidateId: string; reasons: string[] }[];
  unknownCandidateIds: string[]; undetectedOverlaySuspected: boolean; crossBatchGroupingSuspected: boolean;
  semanticTemporalConflict: boolean; reasons: string[]; packetDigests: string[];
  receipts: VisionReceipt[]; receiptDigests: string[];
  requestCounts: { LUNA: number; SOL: number; MINIMAX: number };
  verifyFresh(): Promise<void>;
}

/** Spatial relationships are packing hints only. A connected cluster is never split. */
export function planHybridSemanticBatches(result: Readonly<StationaryDiscoveryResult>): HybridSemanticBatchPlan {
  const ordered = result.components.filter(c => c.state === "CANDIDATE")
    .map(c => ({ candidateId: c.id, gridBox: c.gridBox, sourceBox: c.sourceBox, signals: c.signals }))
    .sort((a, b) => a.sourceBox.y - b.sourceBox.y || a.sourceBox.x - b.sourceBox.x || a.candidateId.localeCompare(b.candidateId));
  const allCandidates = structuredClone(ordered), allCandidateIds = allCandidates.map(c => c.candidateId);
  const sourceKey = result.evidence.sourceKey;
  const candidateSetDigest = discoveryHash(JSON.stringify({ sourceKey, allCandidates }));
  const spatialClusters: string[][] = [], batches: string[][] = [];
  let failureCode: string | null = result.status === "INCOMPLETE" ? "SEMANTIC_M1_INCOMPLETE" : null;
  if (new Set(allCandidateIds).size !== allCandidateIds.length) failureCode = "SEMANTIC_CANDIDATE_ID_MISMATCH";
  if (ordered.length > HYBRID_SEMANTIC_LIMITS.candidates) failureCode = "SEMANTIC_CANDIDATE_LIMIT_EXCEEDED";
  if (!ordered.length) failureCode = "SEMANTIC_NO_CANDIDATES_NO_ABSENCE_CLAIM";
  if (!failureCode) {
    const remaining = new Set(allCandidateIds);
    const gap = Math.min(result.mapping.sourceWidth, result.mapping.sourceHeight) * HYBRID_SEMANTIC_LIMITS.proximityFraction;
    const related = (a: VisionComponent, b: VisionComponent) => {
      const x = Math.max(0, a.sourceBox.x - b.sourceBox.x - b.sourceBox.width, b.sourceBox.x - a.sourceBox.x - a.sourceBox.width);
      const y = Math.max(0, a.sourceBox.y - b.sourceBox.y - b.sourceBox.height, b.sourceBox.y - a.sourceBox.y - a.sourceBox.height);
      return x <= gap && y <= gap;
    };
    for (const seed of ordered) {
      if (!remaining.delete(seed.candidateId)) continue;
      const cluster = [seed];
      for (let i = 0; i < cluster.length; i++) for (const c of ordered) {
        if (remaining.has(c.candidateId) && related(cluster[i], c)) { remaining.delete(c.candidateId); cluster.push(c); }
      }
      spatialClusters.push(allCandidateIds.filter(id => cluster.some(c => c.candidateId === id)));
    }
    if (spatialClusters.some(c => c.length > HYBRID_SEMANTIC_LIMITS.packetCandidates)) failureCode = "COMPLEX_GROUPING";
    else for (const cluster of spatialClusters) {
      const batch = batches.find(b => b.length + cluster.length <= HYBRID_SEMANTIC_LIMITS.packetCandidates);
      if (batch) batch.push(...cluster); else batches.push([...cluster]);
    }
    if (batches.length > HYBRID_SEMANTIC_LIMITS.lunaPackets) failureCode = "SEMANTIC_BATCH_LIMIT_EXCEEDED";
  }
  if (failureCode) batches.length = 0;
  const body = { version: "hybrid-semantic-batch-plan/v1", sourceKey, candidateSetDigest, limits: HYBRID_SEMANTIC_LIMITS, spatialClusters, batches, failureCode };
  return { sourceKey, candidateSetDigest, batchPlanDigest: discoveryHash(JSON.stringify(body)), allCandidates, allCandidateIds,
    unknownCandidateIds: result.components.filter(c => c.state !== "CANDIDATE").map(c => c.id).sort(), batches, spatialClusters, failureCode };
}

const explicitMotion = (r: CandidateDecision) => r.decisions.some(d => ["MOVED", "DISAPPEARED", "CHANGED"].includes(d.temporalState));
const needsSol = (r: CandidateDecision) => r.decisions.some(d => d.decision === "UNKNOWN" || d.riskFlags.length > 0 || d.temporalState !== "STABLE") ||
  r.groups.some(g => g.sameLogicalOverlay !== true || g.candidateIds.length > 1);

/** Executable development seam. H3 uses confirmHybridSemanticTargets, never raw JSON. */
export async function reviewHybridSemanticPlan(planInput: HybridSemanticBatchPlan, session: ShapeCoverVisionSession,
  buildPacket: (ids: readonly string[]) => Promise<VisionPacket>, verifySource: () => Promise<void>, signal: AbortSignal): Promise<HybridSemanticTargetSet> {
  const plan = structuredClone(planInput), start = session.receipts.length;
  const confirmedGroups: HybridConfirmedGroup[] = [], rejectedCandidates: HybridSemanticTargetSet["rejectedCandidates"] = [];
  const unresolved = new Map<string, string[]>(plan.allCandidateIds.map(id => [id, [plan.failureCode ?? "SEMANTIC_REVIEW_INCOMPLETE"]]));
  const reasons = new Set<string>(), packets: VisionPacket[] = [];
  let undetectedOverlaySuspected = false, crossBatchGroupingSuspected = false, semanticTemporalConflict = false;
  const sourceFresh = async () => { signal.throwIfAborted(); await verifySource(); signal.throwIfAborted(); };
  const observe = (result: CandidateDecision) => {
    undetectedOverlaySuspected ||= result.undetectedOverlaySuspected;
    crossBatchGroupingSuspected ||= result.crossBatchGroupingSuspected === true;
    semanticTemporalConflict ||= explicitMotion(result);
  };
  const mark = (ids: readonly string[], reason: string) => { for (const id of ids) unresolved.set(id, [reason]); reasons.add(reason); };
  try {
    await sourceFresh();
    if (session.sourceKey !== plan.sourceKey) throw Error("VISION_SOURCE_BINDING");
    if (plan.failureCode) reasons.add(plan.failureCode);
    else {
      const flattened = plan.batches.flat();
      if (flattened.length !== plan.allCandidateIds.length || new Set(flattened).size !== flattened.length ||
        flattened.some(id => !plan.allCandidateIds.includes(id)) || plan.batches.length > 4 || plan.batches.some(b => b.length < 1 || b.length > 3) ||
        plan.spatialClusters.some(c => !plan.batches.some(b => c.every(id => b.includes(id))))) throw Error("SEMANTIC_BATCH_COMPLETENESS");
      for (const ids of plan.batches) {
        await sourceFresh();
        const packet = await buildPacket(ids);
        if (packet.manifest.sourceKey !== plan.sourceKey || JSON.stringify(packet.manifest.candidates) !== JSON.stringify(ids.map(id => plan.allCandidates.find(c => c.candidateId === id)))) throw Error("VISION_SOURCE_BINDING");
        packets.push(packet);
        const context: SemanticReviewContext = { batchPlanDigest: plan.batchPlanDigest,
          allCandidates: plan.allCandidates.map(c => ({ candidateId: c.candidateId, sourceBox: c.sourceBox })) };
        const luna = await session.request("LUNA", packet, signal, context) as CandidateDecision;
        observe(luna);
        if (luna.undetectedOverlaySuspected || luna.crossBatchGroupingSuspected) { mark(ids, luna.undetectedOverlaySuspected ? "UNDETECTED_OVERLAY_SUSPECTED" : "CROSS_BATCH_GROUPING_UNRESOLVED"); continue; }
        if (explicitMotion(luna)) { mark(ids, "SEMANTIC_TEMPORAL_CONFLICT"); continue; }
        let final = luna, semanticSource: "LUNA" | "SOL" = "LUNA";
        if (needsSol(luna)) {
          if (session.requestCounts.SOL >= HYBRID_SEMANTIC_LIMITS.solPackets) { mark(ids, "SEMANTIC_SOL_BUDGET_EXHAUSTED"); continue; }
          final = await session.request("SOL", packet, signal, { ...context, lunaSummary: luna }) as CandidateDecision;
          semanticSource = "SOL"; observe(final);
        }
        if (final.undetectedOverlaySuspected || final.crossBatchGroupingSuspected || explicitMotion(final)) {
          mark(ids, final.undetectedOverlaySuspected ? "UNDETECTED_OVERLAY_SUSPECTED" : final.crossBatchGroupingSuspected ? "CROSS_BATCH_GROUPING_UNRESOLVED" : "SEMANTIC_TEMPORAL_CONFLICT"); continue;
        }
        const disagreement = new Set(luna.decisions.filter(l => l.decision === "CONFIRM" && final.decisions.some(s => s.candidateId === l.candidateId &&
          (s.decision === "REJECT" || s.decision === "CONFIRM" && s.class !== l.class))).map(d => d.candidateId));
        for (const d of final.decisions) {
          if (disagreement.has(d.candidateId)) { mark([d.candidateId], "SEMANTIC_MODEL_DISAGREEMENT"); continue; }
          if (d.decision === "UNKNOWN") { mark([d.candidateId], "SEMANTIC_UNKNOWN"); continue; }
          if (d.decision === "REJECT") {
            unresolved.delete(d.candidateId); rejectedCandidates.push({ candidateId: d.candidateId, classification: d.class, semanticSource, reason: d.shortReason });
          }
        }
        for (const proposed of final.groups) {
          // A false group is an explicit partition instruction, never a deletion.
          const partition = proposed.sameLogicalOverlay === false ? proposed.candidateIds.map(id => [id]) : [proposed.candidateIds];
          for (const members of partition) {
            const decisions = members.map(id => final.decisions.find(d => d.candidateId === id)!);
            const flags = [...new Set(decisions.flatMap(d => d.riskFlags))];
            if (proposed.sameLogicalOverlay === "UNCERTAIN" || members.some(id => disagreement.has(id)) ||
              decisions.some(d => d.temporalState !== "STABLE" || d.riskFlags.length > 0) || new Set(decisions.map(d => d.class)).size !== 1) {
              mark(members, members.some(id => disagreement.has(id)) ? "SEMANTIC_MODEL_DISAGREEMENT" : "SEMANTIC_GROUP_UNRESOLVED"); continue;
            }
            const candidateIds = plan.allCandidateIds.filter(id => members.includes(id));
            for (const id of candidateIds) unresolved.delete(id);
            const resolvedFromReject = semanticSource === "SOL" && luna.decisions.some(d => members.includes(d.candidateId) && d.decision === "REJECT");
            confirmedGroups.push({ groupId: discoveryHash(JSON.stringify({ sourceKey: plan.sourceKey, candidateSetDigest: plan.candidateSetDigest, candidateIds })),
              candidateIds, classification: decisions[0].class as HybridConfirmedGroup["classification"], temporalAssessment: "STABLE", semanticSource,
              riskFlags: flags, resolutionReason: resolvedFromReject ? "SOL_HARD_CASE_RESOLVED_LUNA_REJECT: " + decisions.map(d => d.shortReason).join("; ") : decisions.map(d => d.shortReason).join("; ") });
          }
        }
      }
    }
    await sourceFresh();
    for (const packet of packets) await packet.verifyFresh();
  } catch (error) {
    const code = error instanceof Error && /^(VISION_[A-Z_]+|SEMANTIC_[A-Z_]+|MODEL_IMAGE_CAPABILITY_UNAVAILABLE)$/.test(error.message) ? error.message :
      signal.aborted ? "VISION_CANCELLED" : "VISION_STALE_BINDING";
    reasons.add(code);
    // Failed source/packet/provider binding cannot leave an adoptable partial target set.
    confirmedGroups.length = 0; rejectedCandidates.length = 0;
    mark(plan.allCandidateIds, code);
  }
  if (undetectedOverlaySuspected || crossBatchGroupingSuspected || semanticTemporalConflict) {
    const code = undetectedOverlaySuspected ? "UNDETECTED_OVERLAY_SUSPECTED" : crossBatchGroupingSuspected ? "CROSS_BATCH_GROUPING_UNRESOLVED" : "SEMANTIC_TEMPORAL_CONFLICT";
    reasons.add(code);
    for (const group of confirmedGroups) mark(group.candidateIds, code);
    confirmedGroups.length = 0;
  }
  const confirmedIds = confirmedGroups.flatMap(g => g.candidateIds), rejectedIds = rejectedCandidates.map(c => c.candidateId);
  const partition = [...confirmedIds, ...rejectedIds, ...unresolved.keys()];
  if (partition.length !== plan.allCandidateIds.length || new Set(partition).size !== partition.length || partition.some(id => !plan.allCandidateIds.includes(id))) throw Error("SEMANTIC_PARTITION_INVALID");
  const receipts = session.receipts.slice(start);
  const status = undetectedOverlaySuspected ? "SEMANTIC_UNSAFE" : unresolved.size || reasons.size ? "SEMANTIC_UNRESOLVED" : "SEMANTIC_CONFIRMED";
  const data = { version: "hybrid-semantic-target-set/v1" as const, status, sourceKey: plan.sourceKey, candidateSetDigest: plan.candidateSetDigest,
    batchPlanDigest: plan.batchPlanDigest, allCandidateIds: plan.allCandidateIds, confirmedGroups, rejectedCandidates,
    unresolvedCandidates: plan.allCandidateIds.filter(id => unresolved.has(id)).map(candidateId => ({ candidateId, reasons: unresolved.get(candidateId)! })),
    unknownCandidateIds: plan.unknownCandidateIds, undetectedOverlaySuspected, crossBatchGroupingSuspected, semanticTemporalConflict,
    reasons: [...reasons], packetDigests: packets.map(p => p.packetDigest), receipts,
    receiptDigests: receipts.map(r => discoveryHash(JSON.stringify(r))), requestCounts: { ...session.requestCounts } };
  // Immutable run-local result; freshness is not restored by serializing this object.
  return Object.freeze({ ...freezeAI(data), verifyFresh: async () => { await sourceFresh(); for (const packet of packets) await packet.verifyFresh(); } }) as HybridSemanticTargetSet;
}

export async function confirmHybridSemanticTargets(evidence: DiscoveryEvidence, tools: ShapeCoverMediaTools,
  session: ShapeCoverVisionSession, signal: AbortSignal): Promise<HybridSemanticTargetSet> {
  assertOwnedDiscoveryEvidence(evidence);
  const result = await discoverStationaryTargets(evidence, signal), plan = planHybridSemanticBatches(result);
  const verifySource = async () => { assertOwnedDiscoveryEvidence(evidence); await evidence.verifyFresh(); };
  return reviewHybridSemanticPlan(plan, session, ids => buildVisionCandidatePacket(evidence, ids, { ...tools, signal }), verifySource, signal);
}
