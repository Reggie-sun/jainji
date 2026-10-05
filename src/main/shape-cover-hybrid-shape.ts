import type { BuiltinStickerAsset } from "./builtin-stickers.js";
import { readShapeCoverAsset, trimShapeCoverArtwork, rasterizeShapeCoverArtwork, type ShapeCoverMediaTools, type ShapeCoverPlacement } from "./shape-cover-alpha.js";
import { evaluateShapeCover, growOpaqueContour, SHAPE_COVER_PIXEL_CONTRACT, type PixelSize } from "./shape-cover-pixel-gate.js";
import { discoveryHash } from "./source-fact-discovery-evidence.js";
import { freezeAI } from "./source-fact-ai-contract.js";

export const HYBRID_SHAPE_SEARCH = freezeAI({ version: "hybrid-corner-shape-search/v1", maximumCandidates: 256,
  sizeFactors: [1, 1.25, 1.5, 2, 2.5] as readonly number[], translationFractions: [-0.1, 0, 0.1] as readonly number[],
  maximumTrials: 11520, maximumRasters: 1280, wallMs: 180_000 });
export type HybridStickerCandidate = { id: string; asset: BuiltinStickerAsset };
export type HybridShapeMatch = {
  candidate: HybridStickerCandidate; placement: ShapeCoverPlacement; radiusPx: number;
  trimBox: ShapeCoverPlacement; trimmedSha256: string; alphaSha256: string;
  raster: Awaited<ReturnType<typeof rasterizeShapeCoverArtwork>>;
  metrics: { candidates: number; rasters: number; trials: number; rejectedAssets: number };
};

export function hybridMaskBounds(mask: Uint8Array, size: PixelSize): ShapeCoverPlacement {
  let x = size.width, y = size.height, right = -1, bottom = -1;
  for (let p = 0; p < mask.length; p++) if (mask[p]) {
    x = Math.min(x, p % size.width); y = Math.min(y, Math.floor(p / size.width));
    right = Math.max(right, p % size.width); bottom = Math.max(bottom, Math.floor(p / size.width));
  }
  if (right < 0) throw Error("HYBRID_INVALID_MASK");
  return { x, y, width: right - x + 1, height: bottom - y + 1 };
}

/** Local catalog-only search. All allowed placements are enumerated; no stochastic/model selection. */
export async function searchHybridCornerShape(candidates: readonly HybridStickerCandidate[], oldFinal: Uint8Array,
  size: PixelSize, scope: ShapeCoverPlacement, sourceScale: number, tools: ShapeCoverMediaTools): Promise<HybridShapeMatch | null> {
  const config = HYBRID_SHAPE_SEARCH, deadline = Date.now() + config.wallMs;
  if (candidates.length > config.maximumCandidates) throw Error("HYBRID_SEARCH_LIMIT");
  const bounds = hybridMaskBounds(oldFinal, size), points: number[] = [];
  for (let p = 0; p < oldFinal.length; p++) if (oldFinal[p]) points.push(p);
  const metrics = { candidates: candidates.length, rasters: 0, trials: 0, rejectedAssets: 0 };
  const check = () => {
    tools.signal?.throwIfAborted();
    if (Date.now() >= deadline || metrics.rasters > config.maximumRasters || metrics.trials > config.maximumTrials) throw Error("HYBRID_SEARCH_LIMIT");
  };
  let best: { candidate: HybridStickerCandidate; placement: ShapeCoverPlacement; radiusPx: number; trimBox: ShapeCoverPlacement;
    bytes: Buffer; trimmedSha256: string; rank: number[] } | undefined;
  for (const candidate of [...candidates].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    check();
    // A stale catalog fingerprint is a source binding failure, never a silent unavailable-asset skip.
    let bytes: Buffer;
    try { bytes = await readShapeCoverAsset(candidate.asset, tools); }
    catch { check(); throw Error("HYBRID_CATALOG_BINDING"); }
    let trimmed: Awaited<ReturnType<typeof trimShapeCoverArtwork>>;
    try { trimmed = await trimShapeCoverArtwork(bytes, tools); }
    catch (error) {
      check();
      if (!(error instanceof Error) || !["HYBRID_EMPTY_ARTWORK", "rotated sticker is unsupported"].includes(error.message) && error.name !== "ZodError") throw error;
      metrics.rejectedAssets++; continue;
    }
    const baseScale = Math.max(bounds.width / trimmed.trimBox.width, bounds.height / trimmed.trimBox.height);
    const seenSizes = new Set<string>();
    for (const factor of config.sizeFactors) {
      check();
      const width = Math.max(1, Math.ceil(trimmed.trimBox.width * baseScale * factor)), height = Math.max(1, Math.ceil(trimmed.trimBox.height * baseScale * factor));
      if (width > scope.width || height > scope.height || seenSizes.has(`${width}/${height}`)) continue;
      seenSizes.add(`${width}/${height}`); metrics.rasters++; check();
      const tile = await rasterizeShapeCoverArtwork(trimmed.bytes, { width, height }, { x: 0, y: 0, width, height }, tools);
      const positions = new Map<string, ShapeCoverPlacement>();
      for (const fy of config.translationFractions) for (const fx of config.translationFractions) {
        const x = Math.max(scope.x, Math.min(scope.x + scope.width - width, Math.round(bounds.x + (bounds.width - width) / 2 + fx * bounds.width)));
        const y = Math.max(scope.y, Math.min(scope.y + scope.height - height, Math.round(bounds.y + (bounds.height - height) / 2 + fy * bounds.height)));
        positions.set(`${x}/${y}`, { x, y, width, height });
      }
      // Reuse one contour per radius for all translations. Work stays in the small artwork tile.
      const radiusLimit = Math.floor(SHAPE_COVER_PIXEL_CONTRACT.maxRadiusSourcePx * sourceScale);
      const remaining = new Map(positions);
      for (let radius = 0; radius <= radiusLimit && remaining.size; radius++) {
        check();
        // Include dilation outside the artwork rectangle, clipped only at the final canvas edge.
        const pad = radiusLimit, expanded = { width: width + pad * 2, height: height + pad * 2 }, alpha = new Uint8Array(expanded.width * expanded.height);
        for (let row = 0; row < height; row++) alpha.set(tile.alpha.subarray(row * width, (row + 1) * width), (row + pad) * expanded.width + pad);
        const grown = growOpaqueContour(alpha, expanded, radius)!;
        for (const [key, placement] of remaining) {
          if (radius === 0) { metrics.trials++; check(); }
          if (!points.every(p => {
            const x = p % size.width - placement.x + pad, y = Math.floor(p / size.width) - placement.y + pad;
            return x >= 0 && y >= 0 && x < expanded.width && y < expanded.height && grown[y * expanded.width + x];
          })) continue;
          // Translate measured pixels into a canvas-clipped local window containing ALL old pixels and growth support.
          const left = Math.max(0, Math.min(bounds.x, placement.x - pad)), top = Math.max(0, Math.min(bounds.y, placement.y - pad));
          const right = Math.min(size.width, Math.max(bounds.x + bounds.width, placement.x + width + pad));
          const bottom = Math.min(size.height, Math.max(bounds.y + bounds.height, placement.y + height + pad));
          const window = { width: right - left, height: bottom - top }, localAlpha = new Uint8Array(window.width * window.height), localOld = new Uint8Array(localAlpha.length);
          for (let row = 0; row < height; row++) localAlpha.set(tile.alpha.subarray(row * width, (row + 1) * width), (placement.y - top + row) * window.width + placement.x - left);
          for (const p of points) localOld[(Math.floor(p / size.width) - top) * window.width + p % size.width - left] = 1;
          const verdict = evaluateShapeCover(localOld, localAlpha, window, sourceScale);
          remaining.delete(key);
          if (verdict.status !== "PASS") continue;
          const rank = [tile.alpha.reduce((n, a) => n + Number(a > 0), 0), verdict.radiusPx!, width * height, placement.y, placement.x];
          const precedes = !best || rank.some((n, i) => n < best!.rank[i] && rank.slice(0, i).every((v, j) => v === best!.rank[j]));
          if (precedes) best = { candidate, placement, radiusPx: verdict.radiusPx!, trimBox: trimmed.trimBox,
            bytes: trimmed.bytes, trimmedSha256: trimmed.sha256, rank };
        }
      }
    }
  }
  check();
  if (!best) return null;
  const raster = await rasterizeShapeCoverArtwork(best.bytes, size, best.placement, tools);
  const verdict = evaluateShapeCover(oldFinal, raster.alpha, size, sourceScale);
  if (verdict.status !== "PASS" || verdict.radiusPx !== best.radiusPx) throw Error("HYBRID_SHAPE_BINDING");
  return { candidate: best.candidate, placement: best.placement, radiusPx: best.radiusPx, trimBox: best.trimBox,
    trimmedSha256: best.trimmedSha256, alphaSha256: discoveryHash(raster.alpha), raster, metrics };
}
