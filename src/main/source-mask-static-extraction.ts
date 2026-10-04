import { setImmediate } from "node:timers/promises";
import { freezeAI } from "./source-fact-ai-contract.js";
import { discoveryHash as hash, type DiscoveryBinding } from "./source-fact-discovery-evidence.js";
import { AutoContourBitmapSchema, type AutoContourBitmap } from "./source-mask-auto-extraction.js";
import { assertStaticTargetEvidence, assertConfirmedStaticTarget, staticIncomplete, STATIC_MASK_LIMITS, type StaticTargetEvidence } from "./source-mask-static-target.js";

/** Development envelope; noise tolerances are observations, never independent boundary truth. */
export const STATIC_MASK_CONFIG = Object.freeze({ method: "cpu-static-conservative-mask-development/v2", maxChannelStd: 20,
  minimumComponentPixels: 8, edgeDifference: 18, dilationPixels: 3, originalPixelTolerance: 24, minimumFrames: 3 });
export interface StaticMaskCandidate {
  readonly receipt: Readonly<{ method: typeof STATIC_MASK_CONFIG.method; authority: "none"; eligible: false;
    status: "CANDIDATE_REQUIRES_INDEPENDENT_PIXEL_EVIDENCE" | "INCOMPLETE"; targetId: string; confirmationDigest: string;
    evidenceDigest: string; config: typeof STATIC_MASK_CONFIG; configDigest: string; mask: Readonly<AutoContourBitmap> | null;
    range: Readonly<{ startFrame: number; endFrame: number }>; sampleOrdinals: readonly number[];
    frames: readonly Readonly<DiscoveryBinding>[]; fullRangeVerification: "CONSISTENT_WITH_STATIC_ENVELOPE" | "REJECTED";
    anomalies: readonly { index: number; reason: string; changedSupportPixels: number; worstDifference: number }[];
    reasons: readonly string[]; maskReview: "NOT_EVALUATED"; motionReview: "NOT_EVALUATED"; sourceAdmission: "NOT_EVALUATED";
    coverage: "NOT_EVALUATED"; visualSafety: "NOT_EVALUATED"; receiptDigest: string }>;
  readonly metrics: Readonly<{ maskMs: number; verificationMs: number; workingBytes: number; scratchBytes: 0 }>;
}
const owners = new WeakMap<StaticMaskCandidate, { evidence: StaticTargetEvidence; started: bigint }>();
export function readStaticMaskCandidate(candidate: StaticMaskCandidate) {
  const owner = owners.get(candidate); if (!owner) staticIncomplete("unowned mask candidate");
  assertStaticTargetEvidence(owner.evidence); return owner;
}

export function packStaticMask(points: Uint8Array, roi: StaticTargetEvidence["roi"]): AutoContourBitmap | null {
  let left = roi.width, top = roi.height, right = -1, bottom = -1, markedPixels = 0;
  for (let p = 0; p < points.length; p++) if (points[p]) {
    left = Math.min(left, p % roi.width); right = Math.max(right, p % roi.width);
    top = Math.min(top, Math.floor(p / roi.width)); bottom = Math.max(bottom, Math.floor(p / roi.width)); markedPixels++;
  }
  if (!markedPixels) return null;
  const width = right - left + 1, height = bottom - top + 1, bytes = Buffer.alloc(Math.ceil(width * height / 8));
  for (let p = 0; p < points.length; p++) if (points[p]) {
    const bit = (Math.floor(p / roi.width) - top) * width + p % roi.width - left; bytes[bit >> 3] |= 1 << (bit & 7);
  }
  return AutoContourBitmapSchema.parse({ bbox: { x: roi.x + left, y: roi.y + top, width, height }, encoding: "bitpack-lsb-row-major-v1",
    dataBase64: bytes.toString("base64"), sha256: hash(bytes), markedPixels });
}

/** Derive support on original pixels, then verify EVERY confirmed ordinal; M1 ROI is never rasterized as mask. */
export async function extractStaticConservativeMask(evidence: StaticTargetEvidence, signal: AbortSignal): Promise<StaticMaskCandidate> {
  assertStaticTargetEvidence(evidence); const started = process.hrtime.bigint(), maskStart = performance.now();
  const config = STATIC_MASK_CONFIG, roi = evidence.roi, target = evidence.target.receipt, range = target.range;
  const n = roi.width * roi.height, sums = new Float64Array(n * 3), squares = new Float64Array(n * 3);
  const low = new Uint8Array(n * 3).fill(255), high = new Uint8Array(n * 3), stable = new Uint8Array(n);
  const check = () => { assertStaticTargetEvidence(evidence); signal.throwIfAborted(); if (Date.now() >= evidence.deadline) staticIncomplete("wall budget exceeded"); };
  check(); await evidence.verifyFresh();
  const discovery = assertConfirmedStaticTarget(evidence.target);
  const samples = discovery.receipt.frames.map((frame, index) => ({ frame, index })).filter(s => s.frame.index >= range.startFrame && s.frame.index < range.endFrame);
  for (const sample of samples) {
    check(); const rgba = await evidence.readRepresentativeRoi(sample.index);
    for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) {
      const i = p * 3 + c, v = rgba[p * 4 + c]; sums[i] += v; squares[i] += v * v;
      low[i] = Math.min(low[i], v); high[i] = Math.max(high[i], v);
    }
    await setImmediate();
  }
  for (let p = 0; p < n; p++) {
    let std = 0; for (let c = 0; c < 3; c++) { const i = p * 3 + c; std = Math.max(std, Math.sqrt(Math.max(0, squares[i] / samples.length - (sums[i] / samples.length) ** 2))); }
    stable[p] = std <= config.maxChannelStd ? 1 : 0;
  }
  const seen = new Uint8Array(n), queue = new Int32Array(n), support = new Uint8Array(n), reasons: string[] = [];
  if (samples.length < config.minimumFrames) reasons.push("INSUFFICIENT_ORIGINAL_REPRESENTATIVES");
  for (let seed = 0; seed < n; seed++) {
    if (!stable[seed] || seen[seed]) continue;
    let head = 0, tail = 1, edges = 0, intersects = false, touchesBoundary = false; seen[seed] = 1; queue[0] = seed;
    while (head < tail) {
      const p = queue[head++], x = p % roi.width, y = Math.floor(p / roi.width);
      // Decode envelope is not membership: only explicitly confirmed component boxes count.
      if (target.confirmedSourceBoxes.some(box => x + roi.x >= box.x && x + roi.x < box.x + box.width
        && y + roi.y >= box.y && y + roi.y < box.y + box.height)) intersects = true;
      if (x === 0 || y === 0 || x === roi.width - 1 || y === roi.height - 1) touchesBoundary = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= roi.width || ny >= roi.height) continue;
        const q = ny * roi.width + nx; let contrast = 0;
        for (let c = 0; c < 3; c++) contrast = Math.max(contrast, Math.abs(sums[p * 3 + c] - sums[q * 3 + c]) / samples.length);
        if (contrast >= config.edgeDifference) edges++;
        if (!stable[q] || seen[q]) continue; seen[q] = 1; queue[tail++] = q;
      }
    }
    if (intersects && tail >= config.minimumComponentPixels && edges > 0) {
      if (touchesBoundary) reasons.push("STABLE_COMPONENT_EXTENT_UNRESOLVED");
      else for (let j = 0; j < tail; j++) support[queue[j]] = 1;
    }
    check();
  }
  const conservative = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (support[p]) {
    const x = p % roi.width, y = Math.floor(p / roi.width), radius = config.dilationPixels;
    if (x - radius <= 0 || y - radius <= 0 || x + radius >= roi.width - 1 || y + radius >= roi.height - 1) reasons.push("CONSERVATIVE_MARGIN_EXTENT_UNRESOLVED");
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < roi.width && ny < roi.height) conservative[ny * roi.width + nx] = 1;
    }
  }
  const mask = packStaticMask(conservative, roi); if (!mask) reasons.push("TARGET_NOT_SEPARABLE");
  const maskMs = performance.now() - maskStart, verificationStart = performance.now();
  const anomalies: { index: number; reason: string; changedSupportPixels: number; worstDifference: number }[] = [];
  const frames = await evidence.streamRange((rgba, binding) => {
    check(); let changedSupportPixels = 0, worstDifference = 0;
    for (let p = 0; p < n; p++) if (support[p]) {
      let difference = 0;
      for (let c = 0; c < 3; c++) { const i = p * 3 + c, v = rgba[p * 4 + c]; difference = Math.max(difference, low[i] - v, v - high[i]); }
      worstDifference = Math.max(worstDifference, difference); if (difference > config.originalPixelTolerance) changedSupportPixels++;
    }
    if (changedSupportPixels) anomalies.push({ index: binding.index, reason: "STATIC_SUPPORT_CHANGED_OR_OCCLUDED", changedSupportPixels, worstDifference });
  }, signal);
  if (anomalies.length) reasons.push("FULL_RANGE_STATIC_CONTRADICTION");
  check(); await evidence.verifyFresh(); check();
  const body = { method: config.method, authority: "none" as const, eligible: false as const,
    status: reasons.length ? "INCOMPLETE" as const : "CANDIDATE_REQUIRES_INDEPENDENT_PIXEL_EVIDENCE" as const,
    targetId: target.targetId, confirmationDigest: target.confirmationDigest, evidenceDigest: evidence.evidenceDigest,
    config, configDigest: hash(JSON.stringify(config)), mask, range, sampleOrdinals: samples.map(s => s.frame.index), frames,
    fullRangeVerification: reasons.length ? "REJECTED" as const : "CONSISTENT_WITH_STATIC_ENVELOPE" as const,
    anomalies, reasons: [...new Set(reasons)], maskReview: "NOT_EVALUATED" as const, motionReview: "NOT_EVALUATED" as const,
    sourceAdmission: "NOT_EVALUATED" as const, coverage: "NOT_EVALUATED" as const, visualSafety: "NOT_EVALUATED" as const };
  if (Buffer.byteLength(JSON.stringify(body)) > STATIC_MASK_LIMITS.receiptBytes) staticIncomplete("receipt budget exceeded");
  const candidate = freezeAI({ receipt: { ...body, receiptDigest: hash(JSON.stringify(body)) }, metrics: {
    maskMs, verificationMs: performance.now() - verificationStart, workingBytes: evidence.metrics.workingBytes, scratchBytes: 0 as const } });
  owners.set(candidate, { evidence, started }); return candidate;
}
