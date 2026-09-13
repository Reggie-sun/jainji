import { describe, expect, it } from "vitest";
import { executionLimits } from "../src/main/execution-limits";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem } from "../src/main/domain";

describe("hardware execution limits", () => {
  it.each([
    [1, { exports: 1, analysis: 1, threads: 1 }],
    [4, { exports: 1, analysis: 4, threads: 4 }],
    [20, { exports: 1, analysis: 8, threads: 20 }],
    [40, { exports: 1, analysis: 8, threads: 40 }],
  ])("bounds process and thread counts for %i available CPUs", (cores, expected) => {
    expect(executionLimits(cores)).toEqual(expected);
    expect(expected.threads).toBe(cores);
  });

  it("uses up to four GPU export slots without multiplying CPU software exports", () => {
    expect(executionLimits(20, "h264_nvenc")).toEqual({ exports: 4, analysis: 8, threads: 20 });
    expect(executionLimits(2, "h264_nvenc").exports).toBe(2);
    expect(executionLimits(20, "libx264").exports).toBe(1);
  });

  it("defaults to 720p and bounds decoding, filtering and encoding threads", async () => {
    expect(DEFAULT_PRESET.resolutionMode).toBe("720p");
    const template = createDefaultTemplate();
    template.layers.push({ id: crypto.randomUUID(), type: "sticker", assetPath: "/tmp/sticker.gif", assetFingerprint: "test", x: 0, y: 0, width: 0.1, rotationDeg: 0, opacity: 1, zIndex: 0, visible: true });
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source.mp4", fingerprint: "test", width: 1920, height: 1080, durationMs: 1000, sizeBytes: 1, rotation: 0, probeStatus: "ready", importedAt: now() };
    const compiled = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, { ffmpegPath: "/fake", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/text.txt", threads: 1 });
    const args = compiled.args;
    const threadOptions = args.flatMap((arg, index) => arg === "-threads" ? [args[index + 1]] : []);
    expect(threadOptions).toEqual(["1", "1", "1"]);
    expect(args.slice(args.indexOf("-threads"), args.indexOf("-threads") + 4)).toEqual(["-threads", "1", "-i", media.sourcePath]);
    expect(args[args.indexOf("-filter_complex_threads") + 1]).toBe("1");
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("1280:720");
    expect(args[args.indexOf("-preset") + 1]).toBe("medium");
    expect(args[args.indexOf("-crf") + 1]).toBe("23");
  });
});
