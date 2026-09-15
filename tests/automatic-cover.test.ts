import { describe, expect, it, vi } from "vitest";
import { automaticCoverTracks } from "../src/main/automatic-cover-tracks";
import { automaticCoverLayers, resolveCoverSticker } from "../src/main/cover-sticker";
import { createDefaultTemplate, EditTemplateSchema, type EditTemplate, type MediaItem } from "../src/main/domain";
import { AgentRunner } from "../src/main/agent-runner";
import { DecorationSchema } from "../src/shared/decorations";
import { ProviderError } from "../src/main/api-transport";
import { interpolateCoverRectangle } from "../src/shared/cover-sticker";

const id = `uploaded-${"a".repeat(64)}`;
const rect = { x: 0.1, y: 0.1, width: 0.1, height: 0.1 };
const asset = { assetPath: "/tmp/cover.png", assetFingerprint: "fixture" };
const assets = { sparkle: asset, heart: asset, burst: asset, arrow: asset, [id]: asset };
const source: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/video.mp4", displayName: "video", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 640, height: 480, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
const observations = [0, 250, 500, 750].map((timeMs) => ({ timeMs, targets: [
  { id: "a", rectangle: { ...rect, x: 0.1 + timeMs / 5000 } },
  ...(timeMs < 500 ? [{ id: "b", rectangle: { ...rect, x: 0.7 } }] : []),
] }));
const settings = { enabled: true, stickerIds: [id], rectangle: { ...rect, x: 0.8 }, trackingMode: "agent" as const };

describe("fully automatic multi-target cover", () => {
  it.each(["left", "right", "top", "bottom"])("keeps detected coverage at the %s image edge during simplification", (edge) => {
    const frames = [0, 250, 500].map((timeMs) => {
      const coordinate = timeMs === 250 ? 0 : 0.011;
      return { timeMs, targets: [{ id: "a", rectangle: { ...rect,
        ...(edge === "left" ? { x: coordinate } : edge === "right" ? { x: 0.9 - coordinate } : edge === "top" ? { y: coordinate } : { y: 0.9 - coordinate }),
      } }] };
    });
    const [result] = automaticCoverTracks(frames, 750);
    const box = interpolateCoverRectangle(result.track.keyframes, 250);
    const original = frames[1].targets[0].rectangle;
    expect(box.x).toBeLessThanOrEqual(original.x + 1e-10);
    expect(box.y).toBeLessThanOrEqual(original.y + 1e-10);
    expect(box.x + box.width).toBeGreaterThanOrEqual(original.x + original.width - 1e-10);
    expect(box.y + box.height).toBeGreaterThanOrEqual(original.y + original.height - 1e-10);
  });
  it("covers every detected target with padding and its own visibility, never the manual rectangle", () => {
    const tracks = automaticCoverTracks(observations, source.durationMs);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].track.keyframes).toHaveLength(2);
    expect(tracks[1].track.endMs).toBe(500);
    const frozen = resolveCoverSticker(settings, assets, [])!;
    const layers = automaticCoverLayers(frozen, source, source, tracks);
    expect(layers.every((layer) => layer.cover?.automatic && layer.assetPath === asset.assetPath)).toBe(true);
    expect(layers[0].x).toBeCloseTo(0.09);
    expect(EditTemplateSchema.parse({ ...createDefaultTemplate(), layers }).layers).toHaveLength(2);
    expect(automaticCoverLayers(frozen, source, source, [])).toEqual([]);
  });
  it("splits disappearances rather than drawing a track through missing targets", () => {
    const frames = [0, 250, 500, 750, 1000].map((timeMs) => ({ timeMs, targets: timeMs === 0 || timeMs === 1000 ? [{ id: "a", rectangle: rect }] : [] }));
    const tracks = automaticCoverTracks(frames, 1250);
    expect(tracks).toHaveLength(2);
    expect(tracks.map(({ track }) => [track.startMs, track.endMs])).toEqual([[0, 250], [750, 1250]]);
  });
  it("segments complex motion into bounded keyframe lists with continuous boundaries", () => {
    const frames = Array.from({ length: 80 }, (_, index) => ({ timeMs: index * 250, targets: [{ id: "a", rectangle: { ...rect, x: index % 2 ? 0.4 : 0.1 } }] }));
    const tracks = automaticCoverTracks(frames, 20_000);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].track.endMs).toBe(tracks[1].track.startMs);
    expect(tracks.every(({ track }) => track.keyframes.length <= 50)).toBe(true);
  });
  it.each(["manual", "agent"] as const)("detects once for all versions in %s decoration mode and freezes both targets", async (mode) => {
    const tracks = automaticCoverTracks(observations, 1000);
    const detectCoverTracks = vi.fn(async () => tracks);
    const enqueue = vi.fn(async (_template: EditTemplate) => crypto.randomUUID());
    const runner = new AgentRunner({ frames: async () => [], plan: async () => ({ summary: "包装", captions: [], filter: "cool", intensity: 0.3, ...(mode === "agent" ? { stickers: [], priceStyle: "ice" } : {}) }), enqueue, decorations: DecorationSchema.parse({ mode, productPrice: "手动内容", sticker: "none" }), stickerAssets: assets, coverSticker: resolveCoverSticker(settings, assets, []), detectCoverTracks, autoCatalog: mode === "agent" ? { fonts: [], stickers: [] } : undefined, onChange: () => {} });
    runner.start("project", "clean", "", [source], 3);
    await runner.settled();
    expect(detectCoverTracks).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(3);
    for (const [template] of enqueue.mock.calls) expect(template.layers.filter((layer) => layer.type === "sticker" && layer.cover?.automatic)).toHaveLength(2);
    const frozen = structuredClone(enqueue.mock.calls[0][0]);
    tracks[0].track.keyframes[0].rectangle.x = 0.5;
    expect(enqueue.mock.calls[0][0]).toEqual(frozen);
  });
  it("fails every version on uncertain detection without retries, packaging calls or manual fallback", async () => {
    const detectCoverTracks = vi.fn(async () => { throw new ProviderError("无法确定全部原贴纸"); });
    const plan = vi.fn(), enqueue = vi.fn();
    const runner = new AgentRunner({ frames: async () => [], plan, enqueue, stickerAssets: assets, coverSticker: resolveCoverSticker(settings, assets, []), detectCoverTracks, onChange: () => {} });
    runner.start("project", "clean", "", [source], 3);
    await runner.settled();
    expect(detectCoverTracks).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(runner.snapshot()?.items.every((item) => item.status === "failed" && item.error === "无法确定全部原贴纸")).toBe(true);
  });
});
