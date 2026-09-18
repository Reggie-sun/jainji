import { describe, expect, it, vi } from "vitest";
import { createDefaultTemplate } from "../src/main/domain";
import { superviseRenderedTemplate, PreviewReviewSession } from "../src/main/supervised-preview";
import { CoverDiagnostics, diagnosticTracks } from "../src/main/cover-diagnostics";

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
  it("retains revision identities and prior inspection checkpoints after a later failure without replaying them", async () => {
    const input = fixture(), diagnostics = new CoverDiagnostics();
    const request = { timeMs: 1250, crop: { x: 0.7, y: 0.7, width: 0.3, height: 0.3 } };
    input.review.mockResolvedValueOnce(JSON.stringify({ action: "inspect", reason: "secret /home/me sk-key", requests: [request] }))
      .mockResolvedValueOnce(revise).mockRejectedValueOnce(new Error("account@example.com"));
    await expect(superviseRenderedTemplate({ ...input, diagnostics })).rejects.toThrow("account");
    const revision = diagnostics.state.events.find(event => event.action === "revise" && event.outcome === "ok");
    expect(revision).toMatchObject({ previousTracks: diagnosticTracks([]), tracks: diagnosticTracks(JSON.parse(revise).tracks) });
    const nextSample = diagnostics.state.events.find(event => event.stage === "sample" && event.revision === 1);
    expect(nextSample?.priorInspections).toEqual([request]);
    expect(nextSample?.requests).not.toContainEqual(request);
    expect(diagnostics.state.events.at(-1)).toMatchObject({ stage: "review-provider", outcome: "failed" });
    expect(JSON.stringify(diagnostics.state)).not.toMatch(/secret|home|sk-key|account|fixture.png|preview-1/);
  });
  it.each([
    { mode: "first-3s" as const, times: [0, 2500, 2750, 3100, 5000, 10000, 14999, 19999] },
    { mode: "first-5s" as const, times: [0, 4500, 4750, 5000, 5100, 10000, 14999, 19999] },
  ])("samples later stickers and the $mode price fade within eight frames", async ({ mode, times }) => {
    const input = fixture();
    await superviseRenderedTemplate({ ...input, durationMs: 20000, template: { ...input.template, decorationDisplayMode: mode, stickerDisplayMode: "full" } });
    expect(input.inspect.mock.calls[0][0].map(request => request.timeMs)).toEqual(times);
  });
  it("reviews full-duration sticker repairs while still sampling the price fade", async () => {
    const input = fixture();
    const template = { ...input.template, stickerDisplayMode: "full" as const,
      layers: input.template.layers.map(layer => ({ ...layer, activeRanges: [{ startMs: 3000, endMs: 5000 }] })) };
    input.rebuild.mockImplementation(() => ({ ...template, layers: template.layers.map(layer => ({ ...layer, width: 0.09 })) }));
    input.review.mockResolvedValueOnce(revise.replace('"endMs":3000', '"endMs":5000')).mockResolvedValueOnce(pass);
    const result = await superviseRenderedTemplate({ ...input, template });
    expect(result).toMatchObject({ checkedRanges: [{ startMs: 0, endMs: 5000 }], budget: { renders: 2, revisions: 1 } });
    expect(result.tracks[0].track.endMs).toBe(5000);
    expect(input.review.mock.calls[0][0]).toMatchObject({ displayMode: "first-3s", stickerDisplayMode: "full", trackHorizonMs: 5000 });
    expect(input.inspect.mock.calls[0][0].map(request => request.timeMs)).toEqual(expect.arrayContaining([2500, 2750, 3100, 4999]));
  });
  it("retains a repair request even when its schema is invalid, until an effective repair is reviewed", async () => {
    const malformedRevision = JSON.stringify({ action: "revise", reason: "左下缺角", tracks: [], corners: [{ corner: "bottom-left", width: 0.2, rotationDeg: 0 }] });
    const blocked = fixture(); blocked.review.mockResolvedValueOnce(malformedRevision).mockResolvedValue(pass);
    await expect(superviseRenderedTemplate(blocked)).rejects.toThrow("上限");
    expect(blocked.render).toHaveBeenCalledOnce();
    const repaired = fixture(); repaired.review.mockResolvedValueOnce(malformedRevision).mockResolvedValueOnce(pass).mockResolvedValueOnce(revise).mockResolvedValueOnce(pass);
    await expect(superviseRenderedTemplate(repaired)).resolves.toMatchObject({ template: { version: 2 } });
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
    expect(result.previewPath).toBe("preview-1");
    expect(result.template.version).toBe(2);
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
    const diagnostics = new CoverDiagnostics();
    await expect(superviseRenderedTemplate({ ...input, diagnostics })).rejects.toThrow("上限");
    expect(input.render).toHaveBeenCalledTimes(3);
    expect(input.rebuild).toHaveBeenCalledTimes(2);
    expect(diagnostics.state.events.filter(event => event.action === "revise" && event.outcome === "ok")).toHaveLength(2);
    expect(diagnostics.state.events.at(-1)).toMatchObject({ outcome: "failed", reason: "budget-exhausted", revision: 2 });
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

  it("returns checked scope, source tracks, history and cumulative counts without enqueuing", async () => {
    const input = fixture(); input.review.mockResolvedValueOnce(revise).mockResolvedValueOnce(pass);
    const result = await superviseRenderedTemplate(input);
    expect(result).toMatchObject({ checkedRanges: [{ startMs: 0, endMs: 3000 }], budget: { turns: 2, revisions: 1, renders: 2 }, tracks: [{ targetId: "a" }] });
    expect(result.history[0]).toMatchObject({ action: "revise", applied: true });
    expect(result.knowledge).toBeUndefined();
  });

  it("shares a version's original five-turn budget across calls, including failures", async () => {
    const session = new PreviewReviewSession(); const input = fixture();
    input.review.mockRejectedValueOnce(new Error("network"));
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("network");
    expect(session.snapshot().turns).toBe(1);
    input.review.mockResolvedValue(pass);
    for (let i = 0; i < 4; i++) await superviseRenderedTemplate({ ...input, session });
    expect(input.review).toHaveBeenCalledTimes(5);
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("上限");
    expect(input.review).toHaveBeenCalledTimes(5);
  });
  it("does not transfer a legacy visual repair to a stale template on resume", async () => {
    const input = fixture(), session = new PreviewReviewSession();
    input.review.mockResolvedValueOnce(revise).mockRejectedValueOnce(new Error("network"));
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("network");
    input.review.mockResolvedValue(pass);
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("上限");
  });
});
