import { describe, expect, it } from "vitest";
import { executionLimits, exportThreads, verifiedExportCount } from "../src/main/execution-limits";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem } from "../src/main/domain";

const ampleMemory = { totalBytes: 96 * 1024 ** 3, availableBytes: 80 * 1024 ** 3 };

describe("hardware execution limits", () => {
  it.each([
    [1, { exports: 1, analysis: 1, threads: 1 }],
    [4, { exports: 1, analysis: 4, threads: 4 }],
    [8, { exports: 2, analysis: 8, threads: 8 }],
    [12, { exports: 3, analysis: 8, threads: 12 }],
    [20, { exports: 5, analysis: 8, threads: 20 }],
    [40, { exports: 6, analysis: 8, threads: 40 }],
  ])("bounds process and thread counts for %i available CPUs", (cores, expected) => {
    expect(executionLimits(cores, "libx264", ampleMemory)).toEqual(expected);
    expect(expected.threads).toBe(cores);
  });

  it("sizes CPU and GPU slots independently and caps both at six", () => {
    const memory = { totalBytes: 96 * 1024 ** 3, availableBytes: 80 * 1024 ** 3 };
    expect(executionLimits(20, "h264_nvenc", memory)).toEqual({ exports: 6, analysis: 8, threads: 20 });
    expect(executionLimits(2, "h264_nvenc", memory).exports).toBe(1);
    expect(executionLimits(8, "h264_nvenc", memory).exports).toBe(2);
    expect(executionLimits(20, "libx264", memory).exports).toBe(5);
  });

  it("reduces GPU concurrency when available memory is limited", () => {
    expect(executionLimits(20, "h264_nvenc", { totalBytes: 8 * 1024 ** 3, availableBytes: 4 * 1024 ** 3 }).exports).toBe(2);
    expect(executionLimits(20, "h264_nvenc", { totalBytes: 96 * 1024 ** 3, availableBytes: 2 * 1024 ** 3 }).exports).toBe(1);
  });

  it("reduces CPU concurrency for memory pressure and invalid core counts", () => {
    expect(executionLimits(12, "libx264", { totalBytes: 16 * 1024 ** 3, availableBytes: 4 * 1024 ** 3 }).exports).toBe(1);
    expect(executionLimits(12, "libx264", { totalBytes: 16 * 1024 ** 3, availableBytes: 5 * 1024 ** 3 }).exports).toBe(2);
    expect(executionLimits(0, "libx264", ampleMemory)).toEqual({ exports: 1, analysis: 1, threads: 1 });
  });

  it("shares the CPU budget across admitted exports", () => {
    expect(exportThreads({ threads: 12, exports: 3 })).toBe(4);
    expect(exportThreads({ threads: 12, exports: 2 })).toBe(6);
    expect(exportThreads({ threads: 20, exports: 1 })).toBe(8);
    expect(exportThreads({ threads: 1, exports: 1 })).toBe(1);
  });

  it.each(["h264_nvenc", "h264_amf", "h264_qsv"] as const)("sizes %s from the same CPU and memory policy", (encoder) => {
    expect(executionLimits(12, encoder, { totalBytes: 16 * 1024 ** 3, availableBytes: 12 * 1024 ** 3 }).exports).toBe(4);
  });

  it("uses only a concurrency level that passes simultaneous encoding", async () => {
    const tried: number[] = [];
    expect(await verifiedExportCount(6, async (count) => { tried.push(count); return count <= 4; })).toBe(4);
    expect(tried).toEqual([6, 5, 4]);
    expect(await verifiedExportCount(2, async () => { throw new Error("device unavailable"); })).toBe(0);
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
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720");
    expect(args[args.indexOf("-preset") + 1]).toBe("medium");
    expect(args[args.indexOf("-crf") + 1]).toBe("23");
  });
});
