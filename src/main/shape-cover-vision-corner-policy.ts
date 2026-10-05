import { z } from "zod";
import { discoveryHash } from "./source-fact-discovery-evidence.js";
import { freezeAI } from "./source-fact-ai-contract.js";
import type { StationaryDiscoveryResult } from "./shape-cover-stationary-discovery.js";
import type { VisionComponent } from "./shape-cover-vision-packet.js";

export const CornerSchema = z.enum(["TOP_LEFT", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_RIGHT"]);
export type Corner = z.infer<typeof CornerSchema>;
export const CORNERS = Object.freeze(CornerSchema.options);
/** Product scope only. Never a semantic, mask or absence decision. */
export const CORNER_SCOPE_POLICY = Object.freeze({ version: "CornerScopePolicy/v1", outerWidthFraction: 0.30,
  outerHeightFraction: 0.30, minimumAreaInside: 0.60, maximumCandidatesPerCorner: 3 });
export const CORNER_POLICY_DIGEST = discoveryHash(JSON.stringify(CORNER_SCOPE_POLICY));
export type CornerScopeRect = { x: number; y: number; width: number; height: number };
export type CornerAssignment = { corner: Corner | null; areaInsideRatio: number; reason: null | "OUT_OF_CORNER_SCOPE" | "CORNER_SCOPE_AMBIGUOUS" };

export function cornerScopeRect(corner: Corner, width: number, height: number): CornerScopeRect {
  CornerSchema.parse(corner);
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw Error("VISION_SOURCE_BINDING");
  const w = width * CORNER_SCOPE_POLICY.outerWidthFraction, h = height * CORNER_SCOPE_POLICY.outerHeightFraction;
  return { x: corner.endsWith("RIGHT") ? width - w : 0, y: corner.startsWith("BOTTOM") ? height - h : 0, width: w, height: h };
}

export function assignCandidateCorner(box: CornerScopeRect, width: number, height: number): CornerAssignment {
  if (![box.x, box.y, box.width, box.height].every(Number.isSafeInteger) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 ||
      box.x + box.width > width || box.y + box.height > height) throw Error("VISION_CANDIDATE_BINDING");
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const matches = CORNERS.filter(c => {
    const r = cornerScopeRect(c, width, height);
    // Strict inner boundaries as specified; the outer screen edge is included.
    return (c.endsWith("LEFT") ? cx >= 0 && cx < r.width : cx > r.x && cx <= width) &&
      (c.startsWith("TOP") ? cy >= 0 && cy < r.height : cy > r.y && cy <= height);
  });
  if (matches.length > 1) return { corner: null, areaInsideRatio: 0, reason: "CORNER_SCOPE_AMBIGUOUS" };
  if (!matches.length) return { corner: null, areaInsideRatio: 0, reason: "OUT_OF_CORNER_SCOPE" };
  const corner = matches[0], r = cornerScopeRect(corner, width, height);
  const area = Math.max(0, Math.min(box.x + box.width, r.x + r.width) - Math.max(box.x, r.x)) *
    Math.max(0, Math.min(box.y + box.height, r.y + r.height) - Math.max(box.y, r.y));
  const areaInsideRatio = area / (box.width * box.height);
  return { corner: areaInsideRatio >= CORNER_SCOPE_POLICY.minimumAreaInside ? corner : null, areaInsideRatio,
    reason: areaInsideRatio >= CORNER_SCOPE_POLICY.minimumAreaInside ? null : "OUT_OF_CORNER_SCOPE" };
}

export interface CornerScopePlan {
  sourceKey: string; sourceWidth: number; sourceHeight: number; policyVersion: string; policyDigest: string;
  candidateSetDigest: string; scopeDigest: string; failureCode: string | null;
  allCandidates: VisionComponent[]; unknownCandidateIds: string[]; outOfScopeCandidateIds: string[]; ambiguousCandidateIds: string[];
  assignments: { candidateId: string; sourceBox: CornerScopeRect; corner: Corner | null; reason: CornerAssignment["reason"]; areaInsideRatio: number }[];
  corners: Record<Corner, { corner: Corner; candidateIds: string[]; scopeRect: CornerScopeRect }>;
}
const ownedPlans = new WeakSet<object>();
export function assertOwnedCornerPlan(plan: CornerScopePlan): void {
  if (!ownedPlans.has(plan)) throw Error("VISION_CORNER_PLAN_BINDING");
}

export function createCornerScopePlan(result: Readonly<StationaryDiscoveryResult>): CornerScopePlan {
  const sourceKey = result.evidence.sourceKey, { sourceWidth, sourceHeight } = result.mapping;
  if (!/^[a-f0-9]{64}$/.test(sourceKey) || new Set(result.components.map(c => c.id)).size !== result.components.length ||
      result.components.some(c => !/^[a-zA-Z0-9_-]{1,100}$/.test(c.id) || !["CANDIDATE", "UNKNOWN"].includes(c.state))) throw Error("VISION_SOURCE_BINDING");
  const allCandidates = result.components.filter(c => c.state === "CANDIDATE")
    .map(c => ({ candidateId: c.id, gridBox: c.gridBox, sourceBox: c.sourceBox, signals: c.signals }))
    .sort((a, b) => a.sourceBox.y - b.sourceBox.y || a.sourceBox.x - b.sourceBox.x || a.candidateId.localeCompare(b.candidateId));
  const unknownCandidateIds = result.components.filter(c => c.state === "UNKNOWN").map(c => c.id).sort();
  const assignments = allCandidates.map(c => ({ candidateId: c.candidateId, sourceBox: c.sourceBox, ...assignCandidateCorner(c.sourceBox, sourceWidth, sourceHeight) }));
  const corners = Object.fromEntries(CORNERS.map(corner => [corner, { corner, scopeRect: cornerScopeRect(corner, sourceWidth, sourceHeight),
    candidateIds: assignments.filter(a => a.corner === corner).map(a => a.candidateId) }])) as CornerScopePlan["corners"];
  const candidateSetDigest = discoveryHash(JSON.stringify({ sourceKey, allCandidates, unknownCandidateIds }));
  const body = { sourceKey, sourceWidth, sourceHeight, policyVersion: CORNER_SCOPE_POLICY.version, policyDigest: CORNER_POLICY_DIGEST,
    candidateSetDigest, failureCode: result.status === "INCOMPLETE" ? "VISION_M1_INCOMPLETE" : null, allCandidates, unknownCandidateIds,
    outOfScopeCandidateIds: assignments.filter(a => a.reason === "OUT_OF_CORNER_SCOPE").map(a => a.candidateId),
    ambiguousCandidateIds: assignments.filter(a => a.reason === "CORNER_SCOPE_AMBIGUOUS").map(a => a.candidateId), assignments, corners };
  const plan = freezeAI(structuredClone({ ...body, scopeDigest: discoveryHash(JSON.stringify(body)) }));
  ownedPlans.add(plan); return plan;
}
