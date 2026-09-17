import { describe, expect, it, vi } from "vitest";
import { detectCollaborativeCovers } from "../src/main/collaborative-cover";

const images = [0, 250].map(timeMs => ({ timeMs, url: "data:image/jpeg;base64,aGVsbG8=" }));
const frames = (x = 0.1, id = "one") => images.map(({ timeMs }) => ({ timeMs, targets: [{ id, rectangle: { x, y: 0.1, width: 0.1, height: 0.1 } }] }));
const signal = () => new AbortController().signal;

describe("automatic multi-agent recognition", () => {
  it("requires blind agreement and keeps continuing identities", async () => {
    const detect = vi.fn().mockResolvedValue(frames());
    const review = vi.fn().mockResolvedValue(frames(0.11, "review"));
    const previous = { ...frames()[0], targets: [{ ...frames()[0].targets[0], id: "original" }] };
    const result = await detectCollaborativeCovers(images, previous, signal(), detect, review);
    expect(result.map(f => f.targets[0].id)).toEqual(["original", "original"]);
    expect(detect.mock.calls[0][2]).toEqual({ role: "detector" });
    expect(review.mock.calls[0][2]).toEqual({ role: "reviewer" });
    expect(detect).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledOnce();
  });
  it("runs one explicit dispute round and accepts only convergence", async () => {
    const detect = vi.fn().mockResolvedValueOnce(frames()).mockResolvedValueOnce(frames(0.5));
    const review = vi.fn().mockResolvedValue(frames(0.5, "review"));
    const stages: string[] = [];
    const result = await detectCollaborativeCovers(images, undefined, signal(), detect, review, stage => stages.push(stage));
    expect(result[0].targets[0].rectangle.x).toBe(0.5);
    expect(detect).toHaveBeenCalledTimes(2);
    expect(review).toHaveBeenCalledTimes(2);
    expect(review.mock.calls[1][2].dispute.detector).toEqual(frames());
    expect(stages).toEqual(["blind", "dispute"]);
  });
  it("fails persistent disagreement without arbitrary voting or more calls", async () => {
    const detect = vi.fn().mockResolvedValue(frames());
    const review = vi.fn().mockResolvedValue(frames(0.5));
    await expect(detectCollaborativeCovers(images, undefined, signal(), detect, review)).rejects.toThrow("协同识别仍有分歧");
    expect(detect).toHaveBeenCalledTimes(2);
    expect(review).toHaveBeenCalledTimes(2);
  });
  it("treats nested boxes with substantially different boundaries as a dispute", async () => {
    const first = frames().map(frame => ({ ...frame, targets: [{ id: "large", rectangle: { x: 0, y: 0, width: 1, height: 1 } }] }));
    const second = frames().map(frame => ({ ...frame, targets: [{ id: "small", rectangle: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }] }));
    const detect = vi.fn().mockResolvedValue(first), review = vi.fn().mockResolvedValue(second);
    const stages: string[] = [];
    await expect(detectCollaborativeCovers(images, undefined, signal(), detect, review, stage => stages.push(stage))).rejects.toThrow("协同识别仍有分歧");
    expect(stages).toEqual(["blind", "dispute"]);
    expect(detect).toHaveBeenCalledTimes(2);
    expect(review).toHaveBeenCalledTimes(2);
  });
  it("does not turn provider errors into retry or empty occupancy", async () => {
    const detect = vi.fn().mockRejectedValue(new Error("invalid JSON"));
    const review = vi.fn().mockResolvedValue(frames());
    await expect(detectCollaborativeCovers(images, undefined, signal(), detect, review)).rejects.toThrow("invalid JSON");
    expect(detect).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledOnce();
  });
  it("rejects cross-window disagreements even when both agents agree on the new window", async () => {
    const detect = vi.fn().mockResolvedValue(frames(0.5));
    const review = vi.fn().mockResolvedValue(frames(0.5));
    await expect(detectCollaborativeCovers(images, frames()[0], signal(), detect, review)).rejects.toThrow("协同识别仍有分歧");
  });
  it("stops before requests when cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    const detect = vi.fn();
    await expect(detectCollaborativeCovers(images, undefined, controller.signal, detect, detect)).rejects.toThrow();
    expect(detect).not.toHaveBeenCalled();
  });
  it("does not accept an identity swap hidden behind per-frame box agreement", async () => {
    const detector = frames();
    const reviewer = frames(); reviewer[1].targets[0].id = "different";
    await expect(detectCollaborativeCovers(images, undefined, signal(), async () => detector, async () => reviewer)).rejects.toThrow("协同识别仍有分歧");
  });
});
