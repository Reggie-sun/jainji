import { interpolateCoverRectangle, type CoverRectangle } from "../shared/cover-sticker.js";
import { CORNER_SAFE_POLICY, nearestStickerCorner } from "../shared/layout-policy.js";
import { CORNERS, type Corner } from "../shared/decorations.js";
import type { Layer, StickerLayer } from "./domain.js";

type Range = { startMs: number; endMs: number };
// The corner regions contain the full allowed rendered sticker footprint, not just its anchor.
const cornerWidth = CORNER_SAFE_POLICY.cornerMargin + CORNER_SAFE_POLICY.maxStickerWidth;
const cornerHeight = CORNER_SAFE_POLICY.cornerMargin + CORNER_SAFE_POLICY.maxStickerHeight;

function occupiedCorners(rectangle: CoverRectangle): Corner[] {
  return CORNERS.filter(corner =>
    (corner.endsWith("left") ? rectangle.x < cornerWidth : rectangle.x + rectangle.width > 1 - cornerWidth)
    && (corner.startsWith("top") ? rectangle.y < cornerHeight : rectangle.y + rectangle.height > 1 - cornerHeight));
}

function boundaries(rectangle: CoverRectangle): number[] {
  return [rectangle.x - cornerWidth,
    rectangle.x + rectangle.width - (1 - cornerWidth),
    rectangle.y - cornerHeight,
    rectangle.y + rectangle.height - (1 - cornerHeight)];
}

// Split linear motion exactly at the existing corner-policy boundaries, not at a new sampling rate.
function cornerRanges(layer: StickerLayer, durationMs: number, occupied: Map<Corner, Range[]>): void {
  const motion = layer.cover!.motion;
  const frames = motion?.keyframes ?? [{ timeMs: 0, rectangle: { x: layer.x, y: layer.y, width: layer.width, height: layer.cover!.height } }];
  const start = motion?.startMs ?? 0, end = motion?.endMs ?? durationMs;
  const times = [...new Set([start, ...frames.map(f => f.timeMs).filter(t => t > start && t < end), end])].sort((a,b) => a-b);
  for (let index = 1; index < times.length; index++) {
    const a = times[index - 1], b = times[index];
    const left = boundaries(interpolateCoverRectangle(frames, a));
    const right = boundaries(interpolateCoverRectangle(frames, b));
    const cuts = [a, b];
    left.forEach((value, axis) => {
      if (value * right[axis] < 0) cuts.push(a + (b-a) * -value / (right[axis]-value));
    });
    cuts.sort((x,y) => x-y);
    for (let part = 1; part < cuts.length; part++) {
      if (cuts[part] <= cuts[part-1]) continue;
      for (const corner of occupiedCorners(interpolateCoverRectangle(frames, (cuts[part-1]+cuts[part])/2))) {
        occupied.get(corner)!.push({ startMs: cuts[part-1], endMs: cuts[part] });
      }
    }
  }
}

/** Only called for new automatic plans. Persist the gap ranges; retries never recalculate them. */
export function fillUncoveredCorners(layers: readonly Layer[], durationMs: number): Layer[] {
  const occupied = new Map<Corner, Range[]>(CORNERS.map(corner => [corner, []]));
  for (const layer of layers) {
    if (layer.type === "sticker" && layer.cover && layer.visible) cornerRanges(layer, durationMs, occupied);
  }
  return layers.flatMap((layer): Layer[] => {
    if (layer.type !== "sticker" || layer.cover || !layer.visible) return [layer];
    const corner = nearestStickerCorner(layer);
    const ranges = occupied.get(`${corner.vertical}-${corner.horizontal}`)!;
    if (!ranges.length) return [layer];
    const gaps: Range[] = [];
    let end = 0;
    for (const range of ranges.sort((a,b) => a.startMs-b.startMs)) {
      if (range.startMs > end) gaps.push({ startMs: end, endMs: range.startMs });
      end = Math.max(end, range.endMs);
    }
    if (end < durationMs) gaps.push({ startMs: end, endMs: durationMs });
    return gaps.length ? [{ ...layer, activeRanges: gaps }] : [];
  });
}
