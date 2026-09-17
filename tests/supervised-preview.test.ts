import { describe, expect, it, vi } from "vitest";
import { createDefaultTemplate } from "../src/main/domain";
import { superviseRenderedTemplate } from "../src/main/supervised-preview";

const pass = JSON.stringify({ action: "pass", reason: "检查通过" });
const revise = JSON.stringify({ action: "revise", reason: "原贴纸被漏检", tracks: [{ targetId: "a", track: { startMs: 0, endMs: 3000, keyframes: [{ timeMs: 0, rectangle: { x: 0.8, y: 0.8, width: 0.1, height: 0.1 } }] } }] });
function fixture() {
  const template = { ...createDefaultTemplate(), decorationDisplayMode: "first-3s" as const,
    layers: [{ id: crypto.randomUUID(), type: "sticker" as const, assetPath: "/fixture.png", assetFingerprint: "fixture", x: 0.01, y: 0.01, width: 0.08, rotationDeg: 0, opacity: 1, zIndex: 1, visible: true }] };
  const render = vi.fn().mockResolvedValueOnce("preview-0").mockResolvedValue("preview-1");
  const inspect = vi.fn(async (requests: { timeMs: number }[], _signal: AbortSignal, previewPath: string) => requests.map(request => ({ requestedTimeMs: request.timeMs, timeMs: request.timeMs, sourceUrl: "source", previewUrl: previewPath, previewTimeMs: request.timeMs })));
  const review = vi.fn().mockResolvedValue(pass);
  let width = 0.08;
  const rebuild = vi.fn(() => ({ ...template, version: 2, layers: template.layers.map(layer => ({ ...layer, width: width += 0.01 })) }));
  const stage = vi.fn();
  return { template, durationMs: 5000, tracks: [], coverEnabled: false, automaticCorners: true, render, inspect, review, rebuild, onStage: stage, signal: new AbortController().signal };
}

describe("rendered supervisor loop", () => {
  it("retains a repair request even when its schema is invalid, until an effective repair is reviewed", async () => {
    const malformedRevision = JSON.stringify({ action: "revise", reason: "左下缺角", tracks: [], corners: [{ corner: "bottom-left", width: 0.2, rotationDeg: 0 }] });
    const blocked = fixture(); blocked.review.mockResolvedValueOnce(malformedRevision).mockResolvedValue(pass);
    await expect(superviseRenderedTemplate(blocked)).rejects.toThrow("上限");
    expect(blocked.render).toHaveBeenCalledOnce();
    const repaired = fixture(); repaired.review.mockResolvedValueOnce(malformedRevision).mockResolvedValueOnce(pass).mockResolvedValueOnce(revise).mockResolvedValueOnce(pass);
    await expect(superviseRenderedTemplate(repaired)).resolves.toMatchObject({ version: 2 });
    expect(repaired.render).toHaveBeenCalledTimes(2);
    expect(repaired.review.mock.calls[1][0].history[0]).toMatchObject({ action: "revise", reason: "左下缺角" });
  });
  it("rejects a no-op repair and cannot accept an unchanged preview after an unfulfilled revision", async () => {
    const input = fixture(); input.rebuild.mockImplementation(() => ({ ...input.template, version: 2 }));
    input.review.mockResolvedValueOnce(revise).mockResolvedValue(pass);
    await expect(superviseRenderedTemplate(input)).rejects.toThrow("上限");
    expect(input.render).toHaveBeenCalledOnce();
    expect(input.review.mock.calls[1][0].feedback).toContain("没有改变");
    expect(input.review.mock.calls[1][0].history[0]).toMatchObject({ action: "revise", reason: "原贴纸被漏检" });
    expect(input.review.mock.calls[2][0].feedback).toContain("尚未得到有效修订");
  });
  it("does not count changes to stickers hidden after 3 seconds as a visual repair", async () => {
    const input = fixture(); input.template.layers[0] = { ...input.template.layers[0], activeRanges: [{ startMs: 3000, endMs: 5000 }] } as typeof input.template.layers[0];
    input.review.mockResolvedValue(revise);
    await expect(superviseRenderedTemplate(input)).rejects.toThrow("上限");
    expect(input.render).toHaveBeenCalledOnce();
  });
  it("rerenders corrections and reviews fresh paired images before accepting", async () => {
    const input = fixture(); input.review.mockResolvedValueOnce(revise).mockResolvedValueOnce(pass);
    const result = await superviseRenderedTemplate(input);
    expect(input.render).toHaveBeenCalledTimes(2);
    expect(input.rebuild).toHaveBeenCalledOnce();
    expect(input.review.mock.calls[1][0].evidence.every((image: { previewUrl: string }) => image.previewUrl === "preview-1")).toBe(true);
    expect(result.version).toBe(2);
    expect(input.review.mock.calls[0][0]).toMatchObject({ durationMs: 5000, trackHorizonMs: 3000, remainingRevisions: 2 });
    expect(input.review.mock.calls[1][0].remainingRevisions).toBe(1);
    expect(input.inspect.mock.calls[0][0].map(request => request.timeMs)).toEqual(expect.arrayContaining([2500, 2750, 3100]));
  });
  it("allows inspection without rerender and bounds all requests", async () => {
    const input = fixture(); input.review.mockResolvedValueOnce(JSON.stringify({ action: "inspect", reason: "放大右下", requests: [{ timeMs: 1250, crop: { x: 0.7, y: 0.7, width: 0.3, height: 0.3 } }] })).mockResolvedValueOnce(pass);
    await superviseRenderedTemplate(input);
    expect(input.render).toHaveBeenCalledOnce();
    expect(input.review.mock.calls[1][0].evidence.length).toBeGreaterThan(input.review.mock.calls[0][0].evidence.length);
  });
  it("never accepts a revision without a subsequent pass and stops at two revisions", async () => {
    const input = fixture(); input.review.mockResolvedValue(revise);
    await expect(superviseRenderedTemplate(input)).rejects.toThrow("上限");
    expect(input.render).toHaveBeenCalledTimes(3);
    expect(input.rebuild).toHaveBeenCalledTimes(2);
  });
  it("bounds malformed responses and rejects out-of-range tracks, tools and new text", async () => {
    for (const answer of ["not JSON", revise.replace('"endMs":3000', '"endMs":6000'), JSON.stringify({ action: "inspect", reason: "超时", requests: [{ timeMs: 5000 }] }), JSON.stringify({ action: "pass", reason: "通过", text: "改写" })]) {
      const input = fixture(); input.review.mockResolvedValue(answer);
      await expect(superviseRenderedTemplate(input)).rejects.toThrow("上限");
      expect(input.review).toHaveBeenCalledTimes(5);
      expect(input.rebuild).not.toHaveBeenCalled();
      expect(input.render).toHaveBeenCalledOnce();
      if (answer.includes('"endMs":6000')) expect(input.review.mock.calls[1][0].feedback).toContain("原贴纸在此后仍存在是正常保留");
    }
  });
  it("does not retry service errors and cancellation prevents further renders", async () => {
    const input = fixture(); input.review.mockRejectedValue(new Error("network"));
    await expect(superviseRenderedTemplate(input)).rejects.toThrow("network");
    expect(input.review).toHaveBeenCalledOnce();
    const controller = new AbortController(); input.signal = controller.signal;
    input.review.mockImplementation(async () => { controller.abort(); return revise; });
    await expect(superviseRenderedTemplate(input)).rejects.toThrow();
    expect(input.rebuild).not.toHaveBeenCalled();
  });
});
