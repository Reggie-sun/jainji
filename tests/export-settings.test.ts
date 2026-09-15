import { describe, expect, it } from "vitest";
import { AgentStartSchema } from "../src/shared/agent";
import { ExportSettingsSchema, DEFAULT_EXPORT_SETTINGS } from "../src/shared/export-settings";
import { DEFAULT_PRESET, ExportPresetSchema, createDefaultTemplate, type MediaItem } from "../src/main/domain";
import { TemplateCompiler } from "../src/main/compiler";

const input = { ruleId: "clean", mediaIds: [crypto.randomUUID()], brief: "", outputDirectory: "/tmp/output", decorations: { productPrice: "19.9" } };
describe("export settings contract", () => {
  it("accepts legacy requests and shares the preset defaults", () => {
    expect(AgentStartSchema.parse(input).exportSettings).toBeUndefined();
    expect(ExportSettingsSchema.parse(DEFAULT_EXPORT_SETTINGS)).toEqual({ resolutionMode: "720p", frameRateMode: "source", quality: "balanced" });
    expect(ExportPresetSchema.parse(DEFAULT_PRESET)).toMatchObject(DEFAULT_EXPORT_SETTINGS);
  });
  it.each([{ resolutionMode: "4k" }, { frameRateMode: "999" }, { quality: "bad" }, { videoCodec: "evil" }])("rejects unsupported settings %j at request admission", (invalid) => {
    expect(AgentStartSchema.safeParse({ ...input, exportSettings: { ...DEFAULT_EXPORT_SETTINGS, ...invalid } }).success).toBe(false);
  });
  it.each(["high", "balanced", "small"] as const)("compiles selected 1080p / 30 fps / %s quality", async (quality) => {
    const settings = { resolutionMode: "1080p" as const, frameRateMode: "30" as const, quality };
    const parsed = AgentStartSchema.parse({ ...input, exportSettings: settings });
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source", fingerprint: "test", sizeBytes: 1, durationMs: 1000, width: 540, height: 960, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const command = await new TemplateCompiler().compile(createDefaultTemplate(), media, { ...DEFAULT_PRESET, ...parsed.exportSettings }, { ffmpegPath: "ffmpeg", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused" });
    expect(command.args[command.args.indexOf("-filter_complex") + 1]).toContain("scale=1080:1920");
    expect(command.args[command.args.indexOf("-r") + 1]).toBe("30");
    expect(command.args[command.args.indexOf("-crf") + 1]).toBe(quality === "high" ? "18" : quality === "small" ? "28" : "23");
  });
});
