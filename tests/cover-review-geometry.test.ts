import { describe, expect, it } from "vitest";
import { dragCoverRectangle, moveCoverSegment } from "../src/renderer/cover-review-geometry";
import type { CoverSegment } from "../src/shared/cover-review";

const rect = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
describe("cover review dragging", () => {
  it("explains a full animation track without dropping existing keys", () => {
    const segment: CoverSegment = { id: "s", identityId: "i", origin: "human", track: { startMs: 0, endMs: 2000, keyframes: Array.from({ length: 50 }, (_, i) => ({ timeMs: i * 20, rectangle: rect })) } };
    expect(() => moveCoverSegment(segment, 501, rect)).toThrow("关键帧已满");
    expect(moveCoverSegment(segment, 500, rect).track.keyframes).toHaveLength(50);
  });
  it("keeps the entire moved box inside the video", () => {
    expect(dragCoverRectangle(rect, 2, -2, false, false)).toEqual({ ...rect, x: 0.6, y: 0 });
  });
  it("resizes a fixed box independently and clamps to the video", () => {
    expect(dragCoverRectangle(rect, 2, -2, true, false)).toEqual({ ...rect, width: 0.8, height: 0.02 });
  });
  it("preserves animated aspect ratios at video edges", () => {
    const result = dragCoverRectangle(rect, 2, 2, true, true);
    expect(result.width / result.height).toBeCloseTo(2);
    expect(result.x + result.width).toBeLessThanOrEqual(1);
    expect(result.y + result.height).toBeLessThanOrEqual(1);
  });
  it("moves a static box without accidentally creating animation", () => {
    const segment: CoverSegment = { id: "s", identityId: "i", origin: "human", track: { startMs: 0, endMs: 1000, keyframes: [{ timeMs: 0, rectangle: rect }] } };
    expect(moveCoverSegment(segment, 500, { ...rect, x: 0.1 }).track.keyframes).toEqual([{ timeMs: 0, rectangle: { ...rect, x: 0.1 } }]);
    const animated = { ...segment, track: { ...segment.track, keyframes: [...segment.track.keyframes, { timeMs: 900, rectangle: rect }] } };
    expect(moveCoverSegment(animated, 500.5, rect).track.keyframes.map((frame) => frame.timeMs)).toEqual([0, 500, 900]);
    expect(moveCoverSegment(animated, 900, rect).track.keyframes).toHaveLength(2);
  });
});
