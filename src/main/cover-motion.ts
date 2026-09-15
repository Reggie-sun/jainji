import type { CoverKeyframe, CoverRectangle } from "../shared/cover-sticker.js";

const decimal = (value: number) => String(Number(value.toFixed(8)));

// Each clamped ramp contributes only on its own segment; endpoints stay fixed.
export function coverMotionExpression(frames: readonly CoverKeyframe[], field: keyof CoverRectangle): string {
  let expression = decimal(frames[0].rectangle[field]);
  for (let index = 1; index < frames.length; index += 1) {
    const a = frames[index - 1], b = frames[index];
    const delta = b.rectangle[field] - a.rectangle[field];
    if (delta === 0) continue;
    expression += `+(${decimal(delta)})*clip((t-${decimal(a.timeMs / 1000)})/${decimal((b.timeMs - a.timeMs) / 1000)},0,1)`;
  }
  return expression;
}

// Enclose the normalized rectangle on the 2-pixel grid used by 4:2:0 overlays.
export function coverRasterExpressions(frames: readonly CoverKeyframe[], width: number, height: number): Record<keyof CoverRectangle, string> {
  const x = coverMotionExpression(frames, "x"), y = coverMotionExpression(frames, "y");
  const w = coverMotionExpression(frames, "width"), h = coverMotionExpression(frames, "height");
  const left = `2*floor(${width}*(${x})/2)`, top = `2*floor(${height}*(${y})/2)`;
  return { x: left, y: top,
    width: `max(1,min(${width},2*ceil(${width}*((${x})+(${w}))/2))-(${left}))`,
    height: `max(1,min(${height},2*ceil(${height}*((${y})+(${h}))/2))-(${top}))`,
  };
}
