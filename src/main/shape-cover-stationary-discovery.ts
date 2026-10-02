import { setImmediate } from "node:timers/promises";
import { createHash } from "node:crypto";
import { freezeAI } from "./source-fact-ai-contract.js";
import { assertOwnedDiscoveryEvidence, DISCOVERY_LIMITS, discoveryHash, discoveryIncomplete,
  type DiscoveryEvidence, type DiscoveryReceipt } from "./source-fact-discovery-evidence.js";

/** Development parameters: frozen before real-media runs, no holdout tuning. */
export const STATIONARY_DISCOVERY_CONFIG = Object.freeze({ method: "cpu-stationary-components/v1", gridMaxSide: 360,
  maxChannelStd: 20, adjacentDifference: 30, persistence: 0.8, edgeDifference: 18,
  minimumComponentPixels: 12, minimumEdgePixels: 4, roiPaddingCells: 2,
  maxComponentAreaFraction: 0.2, maxComponents: 4096, maxCandidates: 128, minimumSpanMs: 1000 });
type Box = { x: number; y: number; width: number; height: number };
export interface StationaryDiscoveryComponent {
  id: string; gridBox: Box; sourceBox: Box;
  state: "CANDIDATE" | "UNKNOWN"; reasons: string[];
  signals: { stablePixels: number; meanMaxChannelStd: number; edgePixels: number;
    meanAdjacentPersistence: number; sampledScreenCoordinateConsistency: number };
  confidence: number;
  originalPixels: null | { supportPixels: number; meanMaxChannelStd: number; stableFraction: number;
    roiFrames: { index: number; pts: number; endPts: number; roiSha256: string }[] };
}
export interface StationaryDiscoveryResult {
  method: string; authority: "none"; eligible: false; status: "CANDIDATES_REQUIRE_CONFIRMATION" | "NO_CONFIRMED_TARGET" | "INCOMPLETE";
  targetConfirmation: "NOT_EVALUATED"; maskReview: "NOT_EVALUATED"; motionReview: "NOT_EVALUATED";
  sourceAdmission: "NOT_EVALUATED"; coverage: "NOT_EVALUATED"; visualSafety: "NOT_EVALUATED";
  evidence: Readonly<DiscoveryReceipt>; config: typeof STATIONARY_DISCOVERY_CONFIG; configDigest: string;
  mapping: { method: "integer-cell-origin-with-outward-roi/v1"; gridWidth: number; gridHeight: number; sourceWidth: number; sourceHeight: number };
  reasons: string[]; components: StationaryDiscoveryComponent[];
  statisticsDigest: string; resultDigest: string;
  metrics: { temporalMs: number; componentsMs: number; originalPixelsMs: number; workingBytes: number };
}
export function mapDiscoveryBox(box: Box, grid: { width: number; height: number }, source: { width: number; height: number }, padding = 0): Box {
  const x = Math.floor(Math.max(0, box.x - padding) * source.width / grid.width);
  const y = Math.floor(Math.max(0, box.y - padding) * source.height / grid.height);
  const right = Math.ceil(Math.min(grid.width, box.x + box.width + padding) * source.width / grid.width);
  const bottom = Math.ceil(Math.min(grid.height, box.y + box.height + padding) * source.height / grid.height);
  return { x, y, width: right - x, height: bottom - y };
}

/** Full-canvas representative-frame heuristic, not a mask extractor or a target identity issuer. */
export async function discoverStationaryTargets(evidence: DiscoveryEvidence, signal: AbortSignal): Promise<Readonly<StationaryDiscoveryResult>> {
  assertOwnedDiscoveryEvidence(evidence);
  const receipt = evidence.receipt, config = STATIONARY_DISCOVERY_CONFIG, source = receipt.source;
  const check = () => {
    assertOwnedDiscoveryEvidence(evidence);
    if (signal.aborted) discoveryIncomplete("cancelled");
    if (Date.now() >= evidence.deadline) discoveryIncomplete("wall budget exceeded");
  };
  check(); await evidence.verifyFresh(); check();
  const scale = Math.min(1, config.gridMaxSide / Math.max(source.width, source.height));
  const width = Math.max(1, Math.floor(source.width * scale)), height = Math.max(1, Math.floor(source.height * scale));
  const n = width * height, count = receipt.frames.length;
  const mapping = { method: "integer-cell-origin-with-outward-roi/v1" as const, gridWidth: width, gridHeight: height,
    sourceWidth: source.width, sourceHeight: source.height };
  const sums = new Float64Array(n * 3), squares = new Float64Array(n * 3), previous = new Uint8Array(n * 3);
  const current = new Uint8Array(n * 3), adjacent = new Uint16Array(n), edges = new Uint16Array(n);
  let workingBytes = sums.byteLength + squares.byteLength + previous.byteLength + current.byteLength + adjacent.byteLength + edges.byteLength
    + source.width * source.height * 4 * 2 + n * 20;
  if (workingBytes > DISCOVERY_LIMITS.workingBytes) discoveryIncomplete("working-set budget exceeded");
  const read = async (sampleIndex: number) => {
    check(); const rgba = await evidence.readFrame(sampleIndex); check();
    const binding = receipt.frames[sampleIndex];
    if (rgba.length !== binding.byteLength || discoveryHash(rgba) !== binding.pixelSha256) discoveryIncomplete("original frame pixel binding mismatch");
    return rgba;
  };
  const start = performance.now();
  for (let sample = 0; sample < count; sample++) {
    const rgba = await read(sample);
    for (let y = 0; y < height; y++) {
      if ((y & 15) === 0) check();
      for (let x = 0; x < width; x++) {
        const p = y * width + x, offset = (Math.floor(y * source.height / height) * source.width + Math.floor(x * source.width / width)) * 4;
        let difference = 0;
        for (let c = 0; c < 3; c++) {
          const i = p * 3 + c, value = rgba[offset + c]; current[i] = value;
          sums[i] += value; squares[i] += value * value;
          difference = Math.max(difference, Math.abs(value - previous[i]));
        }
        if (sample && difference <= config.adjacentDifference) adjacent[p]++;
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x; let edge = 0;
      for (const q of [x + 1 < width ? p + 1 : p, y + 1 < height ? p + width : p]) {
        for (let c = 0; c < 3; c++) edge = Math.max(edge, Math.abs(current[p * 3 + c] - current[q * 3 + c]));
      }
      if (edge >= config.edgeDifference) edges[p]++;
    }
    previous.set(current); await setImmediate(); check();
  }
  const temporalMs = performance.now() - start, componentStart = performance.now();
  const deviations = new Float32Array(n), stable = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    let std = 0;
    for (let c = 0; c < 3; c++) { const i = p * 3 + c; std = Math.max(std, Math.sqrt(Math.max(0, squares[i] / count - (sums[i] / count) ** 2))); }
    deviations[p] = std;
    stable[p] = std <= config.maxChannelStd && adjacent[p] / Math.max(1, count - 1) >= config.persistence ? 1 : 0;
  }
  const statisticHash = createHash("sha256");
  for (const a of [sums, squares, adjacent, edges, deviations, stable]) statisticHash.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  const statisticsDigest = statisticHash.digest("hex");
  const seen = new Uint8Array(n), queue = new Int32Array(n), components: StationaryDiscoveryComponent[] = [];
  const supports: { component: StationaryDiscoveryComponent; points: number[]; sums: Float64Array; squares: Float64Array }[] = [];
  const spanMs = count ? (receipt.frames[count - 1].pts - receipt.frames[0].pts) * Number(source.timeBase.split("/")[0]) * 1000 / Number(source.timeBase.split("/")[1]) : 0;
  const insufficient = count < 3 || spanMs < config.minimumSpanMs;
  for (let seed = 0; seed < n; seed++) {
    if ((seed & 4095) === 0) { await setImmediate(); check(); }
    if (!stable[seed] || seen[seed]) continue;
    let head = 0, tail = 1, left = width, top = height, right = 0, bottom = 0, edgePixels = 0, deviation = 0, persistence = 0;
    queue[0] = seed; seen[seed] = 1;
    while (head < tail) {
      if ((head & 4095) === 0) check();
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      deviation += deviations[p]; persistence += adjacent[p] / Math.max(1, count - 1);
      if (edges[p] / count >= config.persistence) edgePixels++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx; if (!stable[q] || seen[q]) continue; seen[q] = 1; queue[tail++] = q;
      }
    }
    if (components.length >= config.maxComponents) discoveryIncomplete("component budget exceeded; no truncated success");
    const gridBox = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    const sourceBox = mapDiscoveryBox(gridBox, { width, height }, source, config.roiPaddingCells);
    const reasons = ["STATIONARY_SIGNALS_DO_NOT_ESTABLISH_STICKER_IDENTITY", "UNSAMPLED_TIME_NOT_VERIFIED", "BACKGROUND_SUBTITLE_OR_PRODUCT_PRINT_POSSIBLE"];
    const reject: string[] = [];
    if (insufficient) reject.push("INSUFFICIENT_TIME_EVIDENCE");
    if (tail < config.minimumComponentPixels) reject.push("COMPONENT_TOO_SMALL");
    if (edgePixels < config.minimumEdgePixels) reject.push("INSUFFICIENT_PERSISTENT_EDGES");
    if (tail / n > config.maxComponentAreaFraction) reject.push("EXTENSIVE_STABLE_BACKGROUND_AMBIGUITY");
    if (left === 0 || top === 0 || right === width - 1 || bottom === height - 1) reasons.push("SOURCE_EDGE_EXTENT_UNRESOLVED");
    const confidence = Math.max(0, Math.min(1, (1 - deviation / tail / config.maxChannelStd) * persistence / tail));
    const component: StationaryDiscoveryComponent = { id: discoveryHash(`${receipt.evidenceDigest}:${JSON.stringify(gridBox)}`), gridBox, sourceBox,
      state: reject.length ? "UNKNOWN" : "CANDIDATE", reasons: [...reject, ...reasons], confidence,
      signals: { stablePixels: tail, meanMaxChannelStd: deviation / tail, edgePixels, meanAdjacentPersistence: persistence / tail,
        sampledScreenCoordinateConsistency: persistence / tail }, originalPixels: null };
    components.push(component);
    if (component.state === "CANDIDATE") {
      if (supports.length >= config.maxCandidates) discoveryIncomplete("candidate budget exceeded; no truncated success");
      // Check original pixels inside each discovered cell (up to 3x3), not outside its support or a resized mask.
      const points = new Set<number>();
      for (let j = 0; j < tail; j++) {
        const p = queue[j], gx = p % width, gy = Math.floor(p / width);
        const sx = Math.floor(gx * source.width / width), sy = Math.floor(gy * source.height / height);
        const ex = Math.min(sx + 3, Math.ceil((gx + 1) * source.width / width)), ey = Math.min(sy + 3, Math.ceil((gy + 1) * source.height / height));
        for (let y = sy; y < ey; y++) for (let x = sx; x < ex; x++) {
          points.add(y * source.width + x);
        }
      }
      workingBytes += points.size * (6 * 8 + 64);
      if (workingBytes > DISCOVERY_LIMITS.workingBytes) discoveryIncomplete("original-pixel working-set budget exceeded");
      supports.push({ component, points: [...points], sums: new Float64Array(points.size * 3), squares: new Float64Array(points.size * 3) });
      component.originalPixels = { supportPixels: points.size, meanMaxChannelStd: 0, stableFraction: 0, roiFrames: [] };
    }
  }
  const componentsMs = performance.now() - componentStart, originalStart = performance.now();
  if (supports.length) for (let sample = 0; sample < count; sample++) {
    const rgba = await read(sample), binding = receipt.frames[sample];
    for (const support of supports) {
      check(); const b = support.component.sourceBox, hash = createHash("sha256");
      for (let y = b.y; y < b.y + b.height; y++) hash.update(rgba.subarray((y * source.width + b.x) * 4, (y * source.width + b.x + b.width) * 4));
      support.component.originalPixels!.roiFrames.push({ index: binding.index, pts: binding.pts, endPts: binding.endPts, roiSha256: hash.digest("hex") });
      for (let j = 0; j < support.points.length; j++) {
        if ((j & 4095) === 0) check();
        for (let c = 0; c < 3; c++) { const i = j * 3 + c, v = rgba[support.points[j] * 4 + c]; support.sums[i] += v; support.squares[i] += v * v; }
      }
    }
    await setImmediate(); check();
  }
  for (const support of supports) {
    let deviation = 0, stablePixels = 0;
    for (let j = 0; j < support.points.length; j++) {
      let std = 0;
      for (let c = 0; c < 3; c++) { const i = j * 3 + c; std = Math.max(std, Math.sqrt(Math.max(0, support.squares[i] / count - (support.sums[i] / count) ** 2))); }
      deviation += std; if (std <= config.maxChannelStd) stablePixels++;
    }
    const pixels = support.component.originalPixels!; pixels.meanMaxChannelStd = deviation / support.points.length; pixels.stableFraction = stablePixels / support.points.length;
    if (pixels.stableFraction < config.persistence) { support.component.state = "UNKNOWN"; support.component.reasons.unshift("ORIGINAL_PIXEL_STABILITY_CONTRADICTION"); }
  }
  const originalPixelsMs = performance.now() - originalStart;
  check(); await evidence.verifyFresh(); check();
  const status = insufficient ? "INCOMPLETE" as const : components.some(c => c.state === "CANDIDATE") ? "CANDIDATES_REQUIRE_CONFIRMATION" as const : "NO_CONFIRMED_TARGET" as const;
  const body = { method: config.method, authority: "none" as const, eligible: false as const, status,
    targetConfirmation: "NOT_EVALUATED" as const, maskReview: "NOT_EVALUATED" as const, motionReview: "NOT_EVALUATED" as const,
    sourceAdmission: "NOT_EVALUATED" as const, coverage: "NOT_EVALUATED" as const, visualSafety: "NOT_EVALUATED" as const,
    evidence: receipt, config, configDigest: discoveryHash(JSON.stringify(config)), mapping,
    reasons: ["NO_ABSENCE_CLAIM", "NO_TARGET_CONFIRMED", ...(insufficient ? ["INSUFFICIENT_TIME_EVIDENCE"] : [])], components, statisticsDigest };
  // Timings deliberately excluded from deterministic result identity.
  return freezeAI({ ...body, resultDigest: discoveryHash(JSON.stringify(body)), metrics: { temporalMs, componentsMs, originalPixelsMs, workingBytes } });
}
