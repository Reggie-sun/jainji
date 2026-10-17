import { describe, expect, it } from "vitest";
import { FissionSettingsSchema, FissionStartSchema, fissionAllocation, fissionVariant, type FissionSettings } from "../src/shared/video-fission";
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

  it("keeps a recipe stable for the same production seed and changes it for a new seed", () => {
    const seededVariant = fissionVariant as (version: number, productionSeed?: number) => FissionSettings;
    const legacy = fissionVariant(17);
    const firstRun = seededVariant(17, 481516);
    expect(seededVariant(17, 481516)).toEqual(firstRun);
    expect(seededVariant(17, 0)).toEqual(legacy);
    expect(seededVariant(17, 271828)).not.toEqual(firstRun);
    expect(() => seededVariant(0, -1)).toThrow();
    expect(() => seededVariant(0, 2147483648)).toThrow();
  });

  it("includes the complete micro-adjustment recipe and rejects stronger new controls", () => {
    const ranges = {
      temperatureKelvin: [6460, 6540], tint: [-0.0004, 0.0004], hueDegrees: [-0.08, 0.08],
      exposureStops: [-0.003, 0.003], shadows: [-0.0006, 0.0006], highlights: [-0.0006, 0.0006],
      blacks: [-0.0003, 0.0003], whites: [-0.0003, 0.0003], vibrance: [-0.002, 0.002], sharpness: [0, 0.045],
      grainStrength: [0, 2], vignetteAngle: [0, 0.08],
    } as const;
    for (let version = 0; version < 250; version++) {
      const settings = fissionVariant(version);
      for (const [key, [min, max]] of Object.entries(ranges)) {
        const value = settings[key as keyof typeof ranges];
        expect(value, `${key} at variant ${version}`).toBeTypeOf("number");
        expect(value).toBeGreaterThanOrEqual(min); expect(value).toBeLessThanOrEqual(max);
        expect(FissionSettingsSchema.safeParse({ ...settings, [key]: min - 0.01 }).success).toBe(false);
        expect(FissionSettingsSchema.safeParse({ ...settings, [key]: max + 0.01 }).success).toBe(false);
      }
      expect(Math.abs(settings.contrast - 1)).toBeLessThanOrEqual(0.0021);
      expect(Math.abs(settings.saturation - 1)).toBeLessThanOrEqual(0.0031);
      expect(Math.abs(settings.brightness)).toBeLessThanOrEqual(0.0006);
      expect(Math.abs(settings.gamma - 1)).toBeLessThanOrEqual(0.0011);
      expect(Number.isInteger(settings.grainSeed)).toBe(true);
      expect(settings.grainSeed).toBeGreaterThanOrEqual(0);
      expect(settings.grainSeed).toBeLessThanOrEqual(2147483647);
    }
    const { grainSeed: _, ...missingSeed } = fissionVariant(0);
    expect(FissionSettingsSchema.safeParse({ ...missingSeed, grainStrength: 1 }).success).toBe(false);
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
    expect(DEFAULT_PRESET.microAdjustments).toBeDefined();
    const normalGraph = ordinary.args[ordinary.args.indexOf("-filter_complex") + 1];
    for (const filter of ["colortemperature=", "unsharp=", "noise=", "vignette="]) expect(normalGraph).toContain(filter);
    const { microAdjustments: _, ...historicalPreset } = DEFAULT_PRESET;
    const historical = await compiler.compile(createDefaultTemplate(), media, historicalPreset, options);
    expect(historical.args[historical.args.indexOf("-filter_complex") + 1]).not.toContain("colortemperature=");
    expect(command.durationSeconds).toBeCloseTo(100 / variant.speed, 6);
    expect(command.args[command.args.indexOf("-af") + 1]).toContain(`atempo=${variant.speed}`);
    const graph = command.args[command.args.indexOf("-filter_complex") + 1];
    expect(graph).toContain(`(PTS-STARTPTS)/${variant.speed}`);
    expect(graph).toContain("pad=720:1280");
    expect(graph).not.toContain("crop=");
    for (const filter of ["colortemperature=", "colorbalance=", "hue=", "exposure=", "curves=", "vibrance=", "unsharp=", "noise=", "vignette="]) expect(graph).toContain(filter);

    const legacy = { speed: 1.0756, inset: 8, contrast: 1.025, saturation: 1.035, brightness: 0.006, gamma: 1.014 } as const;
    expect(FissionSettingsSchema.parse(legacy)).toEqual(legacy);
    const retry = await compiler.compile({ ...createDefaultTemplate(), fission: legacy }, media, DEFAULT_PRESET, options);
    const oldGraph = retry.args[retry.args.indexOf("-filter_complex") + 1];
    expect(oldGraph).toContain("eq=contrast=1.025:saturation=1.035:brightness=0.006:gamma=1.014");
    for (const filter of ["colortemperature=", "colorbalance=", "hue=", "exposure=", "curves=", "vibrance=", "unsharp=", "noise=", "vignette="]) expect(oldGraph).not.toContain(filter);
  });
});
