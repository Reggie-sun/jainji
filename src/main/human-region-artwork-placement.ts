import type { PixelSize } from "./shape-cover-pixel-gate.js";
import type { ShapeCoverPlacement } from "./shape-cover-alpha.js";

/** Exhaustive integer translations for a rectangular target; only canvas edges may clip artwork. */
export function compactArtworkPlacement(alpha: Uint8Array, tile: PixelSize, target: ShapeCoverPlacement,
  canvas: PixelSize, scope: ShapeCoverPlacement, signal?: AbortSignal): ShapeCoverPlacement | undefined {
  const left = Math.max(target.x + target.width - tile.width, scope.x > 0 ? scope.x : -tile.width);
  const top = Math.max(target.y + target.height - tile.height, scope.y > 0 ? scope.y : -tile.height);
  const right = Math.min(target.x, scope.x + scope.width < canvas.width ? scope.x + scope.width - tile.width : canvas.width);
  const bottom = Math.min(target.y, scope.y + scope.height < canvas.height ? scope.y + scope.height - tile.height : canvas.height);
  if (left > right || top > bottom) return;
  const stride = tile.width + 1, cells = stride * (tile.height + 1);
  const holes = new Uint32Array(cells), visible = new Uint32Array(cells);
  for (let y = 0; y < tile.height; y++) {
    signal?.throwIfAborted();
    let rowHoles = 0, rowVisible = 0;
    for (let x = 0; x < tile.width; x++) {
      const a = alpha[y * tile.width + x], p = (y + 1) * stride + x + 1;
      rowHoles += Number(a !== 255); rowVisible += Number(a > 0);
      holes[p] = holes[p - stride] + rowHoles; visible[p] = visible[p - stride] + rowVisible;
    }
  }
  const sum = (integral: Uint32Array, x: number, y: number, width: number, height: number) =>
    integral[(y + height) * stride + x + width] - integral[y * stride + x + width]
    - integral[(y + height) * stride + x] + integral[y * stride + x];
  let best: ShapeCoverPlacement | undefined, bestVisible = -1, bestDistance = Infinity;
  for (let y = top; y <= bottom; y++) {
    signal?.throwIfAborted();
    for (let x = left; x <= right; x++) {
      if (sum(holes, target.x - x, target.y - y, target.width, target.height)) continue;
      const cx = Math.max(0, -x), cy = Math.max(0, -y);
      const width = Math.min(tile.width, canvas.width - x) - cx, height = Math.min(tile.height, canvas.height - y) - cy;
      const count = sum(visible, cx, cy, width, height);
      const distance = (x + tile.width / 2 - target.x - target.width / 2) ** 2 + (y + tile.height / 2 - target.y - target.height / 2) ** 2;
      if (count > bestVisible || count === bestVisible && distance < bestDistance) {
        best = { x, y, width: tile.width, height: tile.height }; bestVisible = count; bestDistance = distance;
      }
    }
  }
  return best;
}
