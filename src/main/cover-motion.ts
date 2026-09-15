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
