import { describe, expect, it } from "vitest";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultProject, createDefaultTemplate, DEFAULT_PRESET, EditTemplateSchema, ProjectSchema, type MediaItem } from "../src/main/domain";

const coverId = `uploaded-${"a".repeat(64)}`;
const media: MediaItem = {
  id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 1,
  durationMs: 1_000, width: 1280, height: 720, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString(),
};

function coverLayer(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(), type: "sticker" as const, assetPath: "/tmp/cover.png", assetFingerprint: "fixture",
    x: 0.31, y: 0.32, width: 0.23, rotationDeg: 0, opacity: 1, zIndex: 10, visible: true,
    cover: { stickerId: coverId, height: 0.17 }, ...overrides,
  };
}

describe("cover sticker templates", () => {
  it("keeps ordinary middle stickers subject to the corner policy while accepting one arbitrary cover", () => {
    const ordinary = createDefaultTemplate();
    ordinary.layoutPolicy = "corner-safe-v1";
    ordinary.layers.push({ ...coverLayer(), cover: undefined });
    expect(() => EditTemplateSchema.parse(ordinary)).toThrow("四角");

    const cover = createDefaultTemplate();
    cover.layoutPolicy = "corner-safe-v1";
    cover.layers.push(coverLayer());
    expect(EditTemplateSchema.parse(cover).layers).toHaveLength(1);
  });

  it("rejects out-of-frame, forged, non-opaque, rotated and duplicate covers", () => {
    for (const layer of [
      coverLayer({ y: 0.9, cover: { stickerId: coverId, height: 0.17 } }),
      coverLayer({ cover: { stickerId: "unknown-builtin", height: 0.17 } }),
      coverLayer({ opacity: 0.8 }),
      coverLayer({ rotationDeg: 1 }),
      coverLayer({ width: 0 }),
    ]) {
      const template = createDefaultTemplate();
      template.layers.push(layer);
      expect(EditTemplateSchema.safeParse(template).success).toBe(false);
    }
    const duplicate = createDefaultTemplate();
    duplicate.layers.push(coverLayer(), coverLayer({ x: 0.5 }));
    expect(EditTemplateSchema.safeParse(duplicate).success).toBe(false);
  });

  it("persists an optional validated cover configuration on projects", () => {
    const project = createDefaultProject();
    project.coverSticker = { enabled: true, stickerIds: [coverId], rectangle: { x: 0.31, y: 0.32, width: 0.23, height: 0.17 } };
    expect(ProjectSchema.parse(project).coverSticker).toEqual(project.coverSticker);
  });

  it("compiles a cover as an exact rectangle without corner snapping or rotation", async () => {
    const template = createDefaultTemplate();
    template.layoutPolicy = "corner-safe-v1";
    template.layers.push(coverLayer());
    const command = await new TemplateCompiler().compile(template, media, { ...DEFAULT_PRESET, resolutionMode: "source" }, {
      ffmpegPath: "ffmpeg", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused.txt",
    });
    const graph = command.args[command.args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("scale=294:122:force_original_aspect_ratio=increase,crop=294:122");
    expect(graph).toContain("crop=w='min(iw,ceil(ih*294/122))':h='min(ih,ceil(iw*122/294))':exact=1,scale=");
    expect(graph).toContain("overlay=x=main_w*0.31000:y=main_h*0.32000");
    expect(graph).not.toContain("cornerMargin");
    expect(graph).not.toContain("rotate=");
  });
});
