import { describe, expect, it, vi } from "vitest";
import { CoverStickerSchema, MAX_MANUAL_COVERS, manualCoverRegions, type CoverSticker } from "../src/shared/cover-sticker";
import { resolveCoverSticker, manualCoverLayers } from "../src/main/cover-sticker";
import { createDefaultTemplate, EditTemplateSchema, ProjectSchema, type ExportBatch, type MediaItem } from "../src/main/domain";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { AgentRunner } from "../src/main/agent-runner";
import { DecorationSchema } from "../src/shared/decorations";

const a = `uploaded-${"a".repeat(64)}`, b = `uploaded-${"b".repeat(64)}`;
const builtin = { assetPath: "/tmp/builtin.png", assetFingerprint: "builtin" };
const assets = { sparkle: builtin, arrow: builtin, heart: builtin, burst: builtin, [a]: { assetPath: "/tmp/a.png", assetFingerprint: "a" }, [b]: { assetPath: "/tmp/b.png", assetFingerprint: "b" } };
const rectangle = { x: 0.1, y: 0.1, width: 0.2, height: 0.1 };
const source: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 640, height: 480, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
const settings = (): CoverSticker => ({ enabled: true, stickerIds: [a, b], rectangle, trackingMode: "manual", regions: [
  { id: crypto.randomUUID(), rectangle: { ...rectangle, x: 0, y: 0 }, stickerId: b },
  { id: crypto.randomUUID(), rectangle: { ...rectangle, x: 0.8, y: 0 } },
  { id: crypto.randomUUID(), rectangle: { ...rectangle, x: 0, y: 0.9 } },
  { id: crypto.randomUUID(), rectangle: { ...rectangle, x: 0.8, y: 0.9 }, stickerId: a },
] });

describe("multiple manual cover regions", () => {
  it("freezes all four regions and rotates only shared artwork across batches", () => {
    const options = settings();
    const frozen = resolveCoverSticker(options, assets, [])!;
    const layers = manualCoverLayers(frozen, source, source);
    expect(layers.map((layer) => layer.cover?.stickerId)).toEqual([b, a, a, a]);
    expect(layers.map((layer) => layer.cover?.regionId)).toEqual(options.regions!.map((region) => region.id));
    const template = EditTemplateSchema.parse({ ...createDefaultTemplate(), layers });
    const history = [{ createdAt: new Date().toISOString(), templateSnapshot: template }] as ExportBatch[];
    expect(manualCoverLayers(resolveCoverSticker(options, assets, history)!, source, source).map((layer) => layer.cover?.stickerId)).toEqual([b, b, b, a]);
    options.regions![0].rectangle.x = 0.3;
    expect(manualCoverLayers(frozen, source, source)[0].x).toBe(0);
  });
  it("accepts independent artwork without shared candidates and rejects missing assigned assets", () => {
    const options = settings(); options.regions = options.regions!.map((region) => ({ ...region, stickerId: a })); options.stickerIds = [];
    expect(CoverStickerSchema.safeParse(options).success).toBe(true);
    expect(manualCoverLayers(resolveCoverSticker(options, assets, [])!, source, source)).toHaveLength(4);
    expect(() => resolveCoverSticker(options, {}, [])).toThrow("覆盖贴纸已删除");
    delete options.regions[0].stickerId;
    expect(CoverStickerSchema.safeParse(options).success).toBe(false);
  });
  it("validates unique regions, bounded counts and per-region geometry", () => {
    const options = settings();
    for (const regions of [[], [options.regions![0], options.regions![0]], Array.from({ length: MAX_MANUAL_COVERS + 1 }, () => ({ id: crypto.randomUUID(), rectangle })), [{ id: crypto.randomUUID(), rectangle: { ...rectangle, x: 1 } }]]) {
      expect(CoverStickerSchema.safeParse({ ...options, regions }).success).toBe(false);
    }
    const layers = manualCoverLayers(resolveCoverSticker(options, assets, [])!, source, source);
    layers[1].cover!.regionId = layers[0].cover!.regionId;
    expect(EditTemplateSchema.safeParse({ ...createDefaultTemplate(), layers }).success).toBe(false);
  });
  it("validates, saves and cleans per-media tracks on every region", () => {
    const service = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
    service.currentProject.mediaItems.push(source);
    const options = settings();
    options.regions![2].tracks = { [source.id]: { startMs: 0, endMs: 1100, keyframes: [{ timeMs: 0, rectangle }] } };
    expect(() => service.setCoverSticker(options)).toThrow("时长");
    options.regions![2].tracks[source.id].endMs = 900;
    service.setCoverSticker(options);
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(service.currentProject))).coverSticker).toEqual(options);
    service.removeMedia(source.id);
    expect(service.currentProject.coverSticker!.regions![2].tracks![source.id]).toBeUndefined();
    expect(ProjectSchema.safeParse(service.currentProject).success).toBe(true);
  });
  it("exports every region on every version without invoking automatic tracking", async () => {
    const enqueue = vi.fn(async () => crypto.randomUUID()), detectCoverTracks = vi.fn();
    const runner = new AgentRunner({ frames: async () => [], plan: async () => ({ summary: "manual", captions: [], filter: "cool", intensity: 0.3 }), enqueue,
      stickerAssets: assets, decorations: DecorationSchema.parse({ productPrice: "手动内容", sticker: "none" }), coverSticker: resolveCoverSticker(settings(), assets, []), detectCoverTracks, onChange: () => {} });
    runner.start("project", "clean", "", [source], 3); await runner.settled();
    expect(enqueue).toHaveBeenCalledTimes(3); expect(detectCoverTracks).not.toHaveBeenCalled();
    for (const [template] of enqueue.mock.calls as unknown as [ReturnType<typeof createDefaultTemplate>][]) expect(template.layers.filter((layer) => layer.type === "sticker" && layer.cover)).toHaveLength(4);
  });
  it("reads old single-region projects unchanged", () => {
    const options = { enabled: true, stickerIds: [a], rectangle };
    expect(manualCoverRegions(options)).toHaveLength(1);
    const layers = manualCoverLayers(resolveCoverSticker(options, assets, [])!, source, source);
    expect(layers).toHaveLength(1); expect(layers[0].x).toBe(rectangle.x);
    expect(layers[0].cover).not.toHaveProperty("regionId");
  });
});
