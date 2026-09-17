import { describe, expect, it, vi } from "vitest";
import { detectCollaborativeCovers } from "../src/main/collaborative-cover";
import { CoverObservationError } from "../src/main/cover-track-provider";
const images = [0, 250].map(timeMs => ({ timeMs, url: "data:image/jpeg;base64,aGVsbG8=" }));
const frames = (x = 0.1, id = "one") => images.map(({ timeMs }) => ({ timeMs, targets: [{ id, rectangle: { x, y: 0.1, width: 0.1, height: 0.1 } }] }));
const signal = () => new AbortController().signal;
const resolve = (x = 0.5) => JSON.stringify({ action: "resolve", reason: "依据原图修正边界", frames: frames(x) });
describe("supervised cover recognition", () => {
  it("lets the supervisor correct the executor instead of requiring identical boxes", async () => {
    const detect = vi.fn().mockResolvedValue(frames()), review = vi.fn().mockResolvedValue(resolve());
    const result = await detectCollaborativeCovers(images, undefined, signal(), detect, review, vi.fn());
    expect(result).toEqual(frames(0.5));
    expect(review.mock.calls[0][0].proposal).toEqual(frames());
    expect(review.mock.calls[0][0].images).toEqual(images);
    expect(detect).toHaveBeenCalledOnce();
  });
  it("requests extra evidence before resolving an invalid executor observation", async () => {
    const detect = vi.fn().mockRejectedValue(new CoverObservationError("JSON 格式无效"));
    const inspect = vi.fn().mockResolvedValue([{ requestedTimeMs: 100, timeMs: 100, sourceUrl: images[0].url }]);
    const review = vi.fn().mockResolvedValueOnce(JSON.stringify({ action: "inspect", reason: "检查闪现", requests: [{ timeMs: 100 }] })).mockResolvedValueOnce(resolve());
    await expect(detectCollaborativeCovers(images, undefined, signal(), detect, review, inspect)).resolves.toEqual(frames(0.5));
    expect(review.mock.calls[0][0].feedback).toContain("JSON");
    expect(review.mock.calls[1][0].evidence).toHaveLength(1);
    expect(inspect).toHaveBeenCalledOnce();
    expect(detect).toHaveBeenCalledOnce();
  });
  it("reports schema errors within a fixed three-call budget", async () => {
    const review = vi.fn().mockResolvedValue("not json"), stages = vi.fn();
    await expect(detectCollaborativeCovers(images, undefined, signal(), async () => frames(), review, vi.fn(), stages)).rejects.toThrow("上限");
    expect(review).toHaveBeenCalledTimes(3);
    expect(review.mock.calls[1][0].feedback).toContain("JSON");
    expect(stages).toHaveBeenCalledTimes(4);
  });
  it("rejects altered timestamps, ambiguous overlap and out-of-window requests", async () => {
    for (const answer of [JSON.stringify({ action: "resolve", reason: "检查", frames: frames().reverse() }), resolve(), JSON.stringify({ action: "inspect", reason: "检查", requests: [{ timeMs: 10_000 }] })]) {
      const inspect = vi.fn();
      await expect(detectCollaborativeCovers(images, frames()[0], signal(), async () => frames(), async () => answer, inspect)).rejects.toThrow("上限");
      expect(inspect).not.toHaveBeenCalled();
    }
  });
  it("keeps continuing identities after a valid supervisor correction", async () => {
    const result = await detectCollaborativeCovers(images, frames(0.1, "previous")[0], signal(), async () => frames(), async () => resolve(0.11), vi.fn());
    expect(result.map(frame => frame.targets[0].id)).toEqual(["previous", "previous"]);
  });
  it("does not retry service errors or continue after cancellation or an explicit stop", async () => {
    const review = vi.fn(), inspect = vi.fn();
    await expect(detectCollaborativeCovers(images, undefined, signal(), async () => { throw new Error("401"); }, review, inspect)).rejects.toThrow("401");
    expect(review).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort(); const detect = vi.fn();
    await expect(detectCollaborativeCovers(images, undefined, controller.signal, detect, review, inspect)).rejects.toThrow();
    expect(detect).not.toHaveBeenCalled();
    review.mockResolvedValue(JSON.stringify({ action: "stop", reason: "遮挡无法确认" }));
    await expect(detectCollaborativeCovers(images, undefined, signal(), async () => frames(), review, inspect)).rejects.toThrow("无法确认");
    expect(review).toHaveBeenCalledOnce();
  });
});
