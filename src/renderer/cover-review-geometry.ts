import type { CoverSegment } from "../shared/cover-review";
import type { CoverRectangle } from "../shared/cover-sticker";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function dragCoverRectangle(rect: CoverRectangle, dx: number, dy: number, resize: boolean, keepRatio: boolean): CoverRectangle {
  if (!resize) return { ...rect, x: clamp(rect.x + dx, 0, 1 - rect.width), y: clamp(rect.y + dy, 0, 1 - rect.height) };
  if (!keepRatio) return { ...rect, width: clamp(rect.width + dx, 0.02, 1 - rect.x), height: clamp(rect.height + dy, 0.02, 1 - rect.y) };
  const ratio = rect.width / rect.height;
  const delta = Math.abs(dx) >= Math.abs(dy * ratio) ? dx : dy * ratio;
  const max = Math.min(1 - rect.x, (1 - rect.y) * ratio);
  const width = clamp(rect.width + delta, Math.min(max, Math.max(0.02, 0.02 * ratio)), max);
  return { ...rect, width, height: width / ratio };
}

export function moveCoverSegment(segment: CoverSegment, timeMs: number, rectangle: CoverRectangle): CoverSegment {
  const at = segment.track.keyframes.length === 1 ? segment.track.keyframes[0].timeMs : Math.floor(timeMs);
  if (segment.track.keyframes.length >= 50 && !segment.track.keyframes.some((frame) => frame.timeMs === at)) throw new Error("关键帧已满，请在跟随设置中选择已有关键帧后调整。");
  return { ...segment, track: { ...segment.track, keyframes: [...segment.track.keyframes.filter((frame) => frame.timeMs !== at), { timeMs: at, rectangle }].sort((a, b) => a.timeMs - b.timeMs) } };
}
