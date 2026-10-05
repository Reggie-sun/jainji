import { freezeAI } from "./source-fact-ai-contract.js";
import { discoveryHash } from "./source-fact-discovery-evidence.js";
import type { ShapeCoverPlacement } from "./shape-cover-alpha.js";
import type { PixelSize } from "./shape-cover-pixel-gate.js";

/** Sampled product heuristic, not a full-range geometry or persistence proof. */
export const HYBRID_MOTION_CONFIG = Object.freeze({ version: "hybrid-corner-sampled-motion/v1", minimumSamples: 3,
  maximumSamples: 32, interiorRadius: 3, minimumInteriorPixels: 8, minimumContrast: 64, channelTolerance: 48,
  minimumMatchFraction: 0.65, displacementStep: 3, maximumDisplacement: 12, minimumMotionImprovement: 0.15 });
export interface HybridMotionResult {
  status: "STATIC_SUPPORTED" | "MOVED" | "DISAPPEARED_OR_CHANGED" | "UNOBSERVABLE";
  sampleCount: number; config: typeof HYBRID_MOTION_CONFIG; samples: {
    componentIndex: number; index: number; supportPixels: number; stationaryMatch: number; bestMatch: number; dx: number; dy: number;
  }[]; digest: string;
}

export function checkHybridCornerMotion(frames: readonly { index: number; rgba: Buffer }[], size: PixelSize,
  mask: Uint8Array, components: readonly ShapeCoverPlacement[], signal?: AbortSignal): HybridMotionResult {
  const config = HYBRID_MOTION_CONFIG, samples: HybridMotionResult["samples"] = [];
  const finish = (status: HybridMotionResult["status"]) => {
    const body = { status, sampleCount: frames.length, config, samples };
    return freezeAI({ ...body, digest: discoveryHash(JSON.stringify(body)) });
  };
  const n = size.width * size.height;
  if (![size.width, size.height].every(v => Number.isSafeInteger(v) && v > 0) || n > 16_777_216 || mask.length !== n ||
    !components.length || components.length > 3 || frames.length < config.minimumSamples || frames.length > config.maximumSamples ||
    frames.some((f, i) => f.rgba.length !== n * 4 || !Number.isSafeInteger(f.index) || f.index < 0 || i > 0 && f.index <= frames[i - 1].index)) return finish("UNOBSERVABLE");
  const reference = frames[0].rgba;
  for (const [componentIndex, box] of components.entries()) {
    signal?.throwIfAborted();
    if (![box.x, box.y, box.width, box.height].every(Number.isSafeInteger) || box.x < 0 || box.y < 0 || box.width < 1 || box.height < 1 ||
      box.x + box.width > size.width || box.y + box.height > size.height) return finish("UNOBSERVABLE");
    // Strip extractor's conservative margin so changing surrounding video cannot dominate the observation.
    const points: number[] = [];
    for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) {
      let interior = true;
      for (let dy = -config.interiorRadius; dy <= config.interiorRadius && interior; dy++) for (let dx = -config.interiorRadius; dx <= config.interiorRadius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size.width || ny >= size.height || !mask[ny * size.width + nx]) { interior = false; break; }
      }
      if (interior) {
        const p = y * size.width + x; let contrast = 0;
        // A uniform overlap can remain identical while the whole overlay moves. It supplies no trackable signal.
        for (let d = -2; d <= 2; d++) if (d) for (let c = 0; c < 3; c++) contrast = Math.max(contrast,
          Math.abs(reference[p * 4 + c] - reference[(p + d) * 4 + c]),
          Math.abs(reference[p * 4 + c] - reference[(p + d * size.width) * 4 + c]));
        if (contrast >= config.minimumContrast) points.push(p);
      }
    }
    if (points.length < config.minimumInteriorPixels) return finish("UNOBSERVABLE");
    for (const frame of frames) {
      signal?.throwIfAborted();
      const match = (dx: number, dy: number) => {
        let count = 0;
        for (const p of points) {
          const x = p % size.width + dx, y = Math.floor(p / size.width) + dy;
          if (x < 0 || y < 0 || x >= size.width || y >= size.height) continue;
          const q = y * size.width + x;
          if ([0, 1, 2].every(c => Math.abs(reference[p * 4 + c] - frame.rgba[q * 4 + c]) <= config.channelTolerance)) count++;
        }
        return count / points.length;
      };
      const stationaryMatch = match(0, 0);
      let bestMatch = stationaryMatch, dx = 0, dy = 0;
      // Static samples stop immediately; displacement search is only needed for a deficient sample.
      if (stationaryMatch < config.minimumMatchFraction) for (let y = -config.maximumDisplacement; y <= config.maximumDisplacement; y += config.displacementStep)
        for (let x = -config.maximumDisplacement; x <= config.maximumDisplacement; x += config.displacementStep) {
          const score = match(x, y); if (score > bestMatch) { bestMatch = score; dx = x; dy = y; }
        }
      samples.push({ componentIndex, index: frame.index, supportPixels: points.length, stationaryMatch, bestMatch, dx, dy });
      if (stationaryMatch < config.minimumMatchFraction) return finish(bestMatch >= config.minimumMatchFraction &&
        bestMatch - stationaryMatch >= config.minimumMotionImprovement ? "MOVED" : "DISAPPEARED_OR_CHANGED");
    }
  }
  return finish("STATIC_SUPPORTED");
}
