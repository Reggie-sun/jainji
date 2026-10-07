import { CoverRectangleSchema, type CoverRectangle } from "../shared/cover-sticker.js";
import type { HumanPixelBox } from "../shared/human-region-cover.js";
import type { PixelSize, SourceToOutput } from "./shape-cover-pixel-gate.js";

/** Outward source-pixel support under the same bicubic scale/pad used by the compiler. */
export function projectHumanRectangle(rectangle: CoverRectangle, source: PixelSize, output: SourceToOutput): HumanPixelBox {
  const r = CoverRectangleSchema.parse(rectangle);
  if (![source.width, source.height, output.width, output.height, output.scaledWidth, output.scaledHeight].every(n => Number.isSafeInteger(n) && n > 0)
    || ![output.padLeft, output.padTop].every(n => Number.isSafeInteger(n) && n >= 0)
    || output.padLeft + output.scaledWidth > output.width || output.padTop + output.scaledHeight > output.height) throw Error("人工区域输出映射无效");
  const sx = output.scaledWidth / source.width, sy = output.scaledHeight / source.height;
  const mx = sx === 1 ? 1 : Math.max(1, Math.ceil(2 * sx)), my = sy === 1 ? 1 : Math.max(1, Math.ceil(2 * sy));
  const x = Math.max(0, Math.floor(output.padLeft + Math.floor(r.x * source.width) * sx) - mx);
  const y = Math.max(0, Math.floor(output.padTop + Math.floor(r.y * source.height) * sy) - my);
  const right = Math.min(output.width, Math.ceil(output.padLeft + Math.ceil((r.x + r.width) * source.width - 1e-9) * sx) + mx);
  const bottom = Math.min(output.height, Math.ceil(output.padTop + Math.ceil((r.y + r.height) * source.height - 1e-9) * sy) + my);
  return { x, y, width: right - x, height: bottom - y };
}

export function opaqueRegionCovered(alpha: Uint8Array, size: PixelSize, target: HumanPixelBox): boolean {
  if (alpha.length !== size.width * size.height || target.width <= 0 || target.height <= 0 || target.x < 0 || target.y < 0
    || target.x + target.width > size.width || target.y + target.height > size.height) return false;
  for (let y = target.y; y < target.y + target.height; y++) for (let x = target.x; x < target.x + target.width; x++) if (alpha[y * size.width + x] !== 255) return false;
  return true;
}

export function humanRegionBitmap(box: HumanPixelBox, size: PixelSize): Uint8Array {
  const result = new Uint8Array(size.width * size.height);
  for (let y = box.y; y < box.y + box.height; y++) result.fill(1, y * size.width + box.x, y * size.width + box.x + box.width);
  return result;
}
