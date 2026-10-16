import { describe, expect, it } from "vitest";
import { FissionStartSchema, fissionAllocation, fissionVariant } from "../src/shared/video-fission";
import { createDefaultTemplate, DEFAULT_PRESET, EditTemplateSchema, type MediaItem } from "../src/main/domain";
import { TemplateCompiler } from "../src/main/compiler";

describe("local video fission", () => {
  it("allocates an exact total in source order, including a partial final round", () => {
    expect(fissionAllocation(3, 100)).toEqual([34, 33, 33]);
    expect(fissionAllocation(2, 50)).toEqual([25, 25]);
    expect(fissionAllocation(3, 2)).toEqual([1, 1, 0]);
    for (const total of [0, -1, 251, 1.5, NaN]) expect(() => fissionAllocation(2, total)).toThrow();
    expect(FissionStartSchema.safeParse({ projectId: crypto.randomUUID(), mediaIds: [crypto.randomUUID()], total: 251, outputDirectory: "/tmp/out" }).success).toBe(false);
    const id = crypto.randomUUID();
    expect(FissionStartSchema.safeParse({ projectId: crypto.randomUUID(), mediaIds: [id, id], total: 10, outputDirectory: "/tmp/out" }).success).toBe(false);
  });

  it("freezes distinct bounded settings for every permitted version", () => {
    const variants = Array.from({ length: 250 }, (_, i) => fissionVariant(i));
    expect(new Set(variants.map(v => JSON.stringify(v))).size).toBe(250);
    for (const v of variants) {
      expect(v.speed).toBeGreaterThanOrEqual(0.97);
      expect(v.speed).toBeLessThanOrEqual(1.0756);
      expect(EditTemplateSchema.safeParse({ ...createDefaultTemplate(), fission: v }).success).toBe(true);
    }
    const template = { ...createDefaultTemplate(), fission: fissionVariant(0), filter: { presetId: "warm", intensity: 0.3 } };
    expect(EditTemplateSchema.safeParse(template).success).toBe(false);
    expect(EditTemplateSchema.safeParse({ ...createDefaultTemplate(), fission: { ...fissionVariant(0), speed: 2 } }).success).toBe(false);
  });

  it("changes both clocks together and keeps ordinary exports at source duration", async () => {
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source", fingerprint: "fixture", sizeBytes: 1, durationMs: 100000, width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const options = { ffmpegPath: "/fake", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused", threads: 1 };
    const compiler = new TemplateCompiler();
    const ordinary = await compiler.compile(createDefaultTemplate(), media, DEFAULT_PRESET, options);
    const variant = fissionVariant(1);
    const command = await compiler.compile({ ...createDefaultTemplate(), fission: variant }, media, { ...DEFAULT_PRESET, frameRateMode: "30" }, options);
    expect(ordinary.durationSeconds).toBe(100);
    expect(ordinary.args).not.toContain("-af");
    expect(command.durationSeconds).toBeCloseTo(100 / variant.speed, 6);
    expect(command.args[command.args.indexOf("-af") + 1]).toContain(`atempo=${variant.speed}`);
    const graph = command.args[command.args.indexOf("-filter_complex") + 1];
    expect(graph).toContain(`(PTS-STARTPTS)/${variant.speed}`);
    expect(graph).toContain("pad=720:1280");
    expect(graph).not.toContain("crop=");
  });
});
