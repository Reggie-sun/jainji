import { createHash } from "node:crypto";
import type { SourcePixelMask } from "../shared/source-sticker-knowledge.js";

export interface PixelSize { width: number; height: number }
export interface SourceToOutput extends PixelSize {
  scaledWidth: number; scaledHeight: number; padLeft: number; padTop: number;
}
export interface ShapeCoverResult {
  status: "PASS" | "UNSAFE";
  reason?: "invalid-raster" | "no-opaque-pixels" | "no-shape-match";
  radiusPx?: number;
  uncoveredPixels?: number;
  areaRatio?: number;
  widthRatio?: number;
  heightRatio?: number;
}
export interface PixelRange { startMs: number; endMs: number }

export const SHAPE_COVER_PIXEL_CONTRACT = Object.freeze({
  version: 1, maxRadiusSourcePx: 8, maxAreaRatio: 1.35, maxSpanRatio: 1.16,
  sourceProjection: "bicubic-support-v1",
});

function validSize(size: PixelSize): boolean {
  return Number.isSafeInteger(size.width) && Number.isSafeInteger(size.height) && size.width > 0 && size.height > 0;
}

/** Decode the persisted 1:1 source bitmap. Invalid records cannot become rectangles. */
export function decodeSourceMask(mask: SourcePixelMask, source: PixelSize): Uint8Array | null {
  const { bbox } = mask;
  if (mask.kind !== "static-binary-v1" || mask.encoding !== "bitpack-lsb-row-major-v1" || !validSize(source)
    || !Number.isSafeInteger(bbox.x) || !Number.isSafeInteger(bbox.y) || bbox.x < 0 || bbox.y < 0
    || !validSize(bbox) || bbox.width > 512 || bbox.height > 512 || bbox.x + bbox.width > source.width || bbox.y + bbox.height > source.height
    || source.width * source.height > 16_777_216) return null;
  const pixels = bbox.width * bbox.height;
  if (pixels > 262_144 || mask.dataBase64.length > 43_692
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(mask.dataBase64)) return null;
  const bytes = Buffer.from(mask.dataBase64, "base64");
  if (bytes.length !== Math.ceil(pixels / 8) || bytes.toString("base64") !== mask.dataBase64
    || createHash("sha256").update(bytes).digest("hex") !== mask.sha256
    || (pixels % 8 && (bytes[bytes.length - 1] & (0xff << (pixels % 8))))) return null;
  const full = new Uint8Array(source.width * source.height);
  let count = 0;
  for (let i = 0; i < pixels; i += 1) if (bytes[i >> 3] & (1 << (i & 7))) {
    full[(bbox.y + Math.floor(i / bbox.width)) * source.width + bbox.x + i % bbox.width] = 1;
    count += 1;
  }
  return count > 0 && count === mask.markedPixels ? full : null;
}

/** Enclose each marked source pixel footprint after scale/pad and bicubic filter support. */
export function projectSourceMask(mask: Uint8Array, source: PixelSize, output: SourceToOutput): Uint8Array | null {
  if (!validSize(source) || !validSize(output) || source.width * source.height > 16_777_216 || mask.length !== source.width * source.height
    || !Number.isSafeInteger(output.scaledWidth) || !Number.isSafeInteger(output.scaledHeight)
    || !Number.isSafeInteger(output.padLeft) || !Number.isSafeInteger(output.padTop)
    || output.scaledWidth <= 0 || output.scaledHeight <= 0 || output.padLeft < 0 || output.padTop < 0
    || output.padLeft + output.scaledWidth > output.width || output.padTop + output.scaledHeight > output.height
    || output.width * output.height > 16_777_216) return null;
  const projected = new Uint8Array(output.width * output.height);
  const scaleX = output.scaledWidth / source.width, scaleY = output.scaledHeight / source.height;
  const marginX = scaleX === 1 ? 1 : Math.max(1, Math.ceil(2 * scaleX));
  const marginY = scaleY === 1 ? 1 : Math.max(1, Math.ceil(2 * scaleY));
  for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) if (mask[y * source.width + x]) {
    const left = Math.max(0, Math.floor(output.padLeft + x * scaleX) - marginX);
    const right = Math.min(output.width, Math.ceil(output.padLeft + (x + 1) * scaleX) + marginX);
    const top = Math.max(0, Math.floor(output.padTop + y * scaleY) - marginY);
    const bottom = Math.min(output.height, Math.ceil(output.padTop + (y + 1) * scaleY) + marginY);
    for (let row = top; row < bottom; row += 1) projected.fill(1, row * output.width + left, row * output.width + right);
  }
  return projected;
}

/** Render the opaque silhouette in final output pixels for the existing overlay path. */
export function growOpaqueContour(alpha: Uint8Array, size: PixelSize, radius: number): Uint8Array | null {
  if (!validSize(size) || size.width * size.height > 16_777_216 || alpha.length !== size.width * size.height || !Number.isSafeInteger(radius) || radius < 0 || radius > 64) return null;
  const grown = new Uint8Array(alpha.length);
  for (let y = 0; y < size.height; y += 1) for (let x = 0; x < size.width; x += 1) if (alpha[y * size.width + x] === 255) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= size.height) continue;
      const halfWidth = Math.floor(Math.sqrt(radius * radius - dy * dy));
      grown.fill(1, ny * size.width + Math.max(0, x - halfWidth), ny * size.width + Math.min(size.width, x + halfWidth + 1));
    }
  }
  return grown;
}

/** Evaluate a measured final-size alpha raster; callers must supply the exact renderer's pixels. */
export function evaluateShapeCover(oldFinal: Uint8Array, alpha: Uint8Array, output: PixelSize, sourceScale: number): ShapeCoverResult {
  if (!validSize(output) || output.width * output.height > 16_777_216 || oldFinal.length !== output.width * output.height || alpha.length !== oldFinal.length
    || !Number.isFinite(sourceScale) || sourceScale <= 0 || sourceScale > 8 || !oldFinal.some(Boolean)) return { status: "UNSAFE", reason: "invalid-raster" };
  let visual = 0, opaque = 0, minX = output.width, minY = output.height, maxX = -1, maxY = -1;
  for (let i = 0; i < alpha.length; i += 1) {
    if (alpha[i] > 0) visual += 1;
    if (alpha[i] === 255) {
      opaque += 1;
      const x = i % output.width, y = Math.floor(i / output.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (!visual || !opaque) return { status: "UNSAFE", reason: "no-opaque-pixels" };
  const baseWidth = maxX - minX + 1, baseHeight = maxY - minY + 1;
  const maxRadius = Math.floor(SHAPE_COVER_PIXEL_CONTRACT.maxRadiusSourcePx * sourceScale);
  let bestUncovered = Number.POSITIVE_INFINITY;
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    const grown = growOpaqueContour(alpha, output, radius)!;
    let area = 0, uncovered = 0, left = output.width, top = output.height, right = -1, bottom = -1;
    for (let i = 0; i < grown.length; i += 1) {
      if (oldFinal[i] && !grown[i]) uncovered += 1;
      if (!grown[i]) continue;
      area += 1;
      const x = i % output.width, y = Math.floor(i / output.width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    bestUncovered = Math.min(bestUncovered, uncovered);
    const areaRatio = area / visual, widthRatio = (right - left + 1) / baseWidth, heightRatio = (bottom - top + 1) / baseHeight;
    if (areaRatio > SHAPE_COVER_PIXEL_CONTRACT.maxAreaRatio || widthRatio > SHAPE_COVER_PIXEL_CONTRACT.maxSpanRatio || heightRatio > SHAPE_COVER_PIXEL_CONTRACT.maxSpanRatio) continue;
    if (uncovered === 0) return { status: "PASS", radiusPx: radius, uncoveredPixels: 0, areaRatio, widthRatio, heightRatio };
  }
  return { status: "UNSAFE", reason: "no-shape-match", uncoveredPixels: bestUncovered };
}

/** Check every measured output PTS against the frozen source and overlay intervals. */
export function checkOutputFrameCoverage(frameTimesMs: readonly number[], sourceSegments: readonly PixelRange[], coverRanges: readonly PixelRange[]): { status: "PASS" } | { status: "UNSAFE"; frameIndex?: number } {
  const valid = (range: PixelRange) => Number.isFinite(range.startMs) && Number.isFinite(range.endMs)
    && range.startMs >= 0 && range.endMs > range.startMs;
  if (!frameTimesMs.length || !sourceSegments.length || sourceSegments.some(range => !valid(range)) || coverRanges.some(range => !valid(range))
    || frameTimesMs.some((time, index) => !Number.isFinite(time) || time < 0 || (index > 0 && time <= frameTimesMs[index - 1]))) return { status: "UNSAFE" };
  for (const [frameIndex, time] of frameTimesMs.entries()) {
    if (sourceSegments.some(range => time >= range.startMs && time < range.endMs)
      && !coverRanges.some(range => time >= range.startMs && time < range.endMs)) return { status: "UNSAFE", frameIndex };
  }
  return { status: "PASS" };
}
