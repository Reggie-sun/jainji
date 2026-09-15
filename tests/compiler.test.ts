import { describe, expect, it } from "vitest";
import { createDefaultTemplate, DEFAULT_PRESET, type MediaItem } from "../src/main/domain";
import { escapeFilterValue, TemplateCompiler } from "../src/main/compiler";

const media: MediaItem = {
  id: crypto.randomUUID(), sourcePath: "/tmp/source;$(touch hacked).mp4", displayName: "source;$(touch hacked).mp4",
  fingerprint: "sha256:test", sizeBytes: 10, durationMs: 1_000, width: 1920, height: 1080, rotation: 0,
  probeStatus: "ready", importedAt: new Date().toISOString(),
};

describe("TemplateCompiler", () => {
  it.each([7, -7, 90])("reduces oversized stickers before %i degree rotation without changing animation input", async (rotationDeg) => {
    const template = createDefaultTemplate();
    template.layers.push({ id: crypto.randomUUID(), type: "sticker", assetPath: "/tmp/animated.gif", assetFingerprint: "fixture", x: 0.04, y: 0.04, width: 0.12, rotationDeg, opacity: 1, zIndex: 0, visible: true });
    const command = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, {
      ffmpegPath: "/fake", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused",
    });
    const graph = command.args[command.args.indexOf("-filter_complex") + 1];
    const stickerGraph = graph.slice(graph.indexOf("[1:v]"));
    expect(stickerGraph.indexOf("scale=")).toBeLessThan(stickerGraph.indexOf("rotate="));
    expect(stickerGraph).toContain("min(iw,");
    expect(command.args.slice(command.args.indexOf("-stream_loop"), command.args.indexOf("-stream_loop") + 2)).toEqual(["-stream_loop", "-1"]);
  });

  it.each([[540, 960], [1080, 1920]])("preserves %i x %i dimensions with explicit source resolution", async (width, height) => {
    const command = await new TemplateCompiler().compile(createDefaultTemplate(), { ...media, width, height }, { ...DEFAULT_PRESET, resolutionMode: "source" }, {
      ffmpegPath: "/fake", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused",
    });
    const graph = command.args[command.args.indexOf("-filter_complex") + 1];
    expect(graph).not.toContain("scale=");
    expect(graph).not.toContain("pad=");
    expect(command.args).not.toContain("-r");
    expect(command.args).toContain("0:a?");
  });

  it.each(["h264_amf", "h264_qsv"] as const)("uses the probed pixel format and options for %s", async (videoEncoder) => {
    const command = await new TemplateCompiler().compile(createDefaultTemplate(), media, DEFAULT_PRESET, {
      ffmpegPath: "/fake", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused", videoEncoder,
    });
    expect(command.args[command.args.indexOf("-c:v") + 1]).toBe(videoEncoder);
    expect(command.args[command.args.indexOf("-pix_fmt") + 1]).toBe("nv12");
    if (videoEncoder === "h264_qsv") {
      expect(command.args[command.args.indexOf("-init_hw_device") + 1]).toBe("qsv:hw");
      expect(command.args.indexOf("-init_hw_device")).toBeLessThan(command.args.indexOf("-i"));
    }
    expect(command.args).not.toContain("-crf");
    expect(command.args).toContain("0:a?");
  });
  it("uses the selected GPU encoder while preserving the governed filter graph and container", async () => {
    const compiler = new TemplateCompiler();
    const options = { ffmpegPath: "/fake", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused", threads: 4 };
    const template = createDefaultTemplate();
    const cpu = await compiler.compile(template, media, DEFAULT_PRESET, options);
    const gpu = await compiler.compile(template, media, DEFAULT_PRESET, { ...options, videoEncoder: "h264_nvenc" });
    expect(gpu.args[gpu.args.indexOf("-c:v") + 1]).toBe("h264_nvenc");
    expect(gpu.args).toContain("-cq");
    expect(gpu.args).not.toContain("-crf");
    expect(gpu.args[gpu.args.indexOf("-filter_complex") + 1]).toBe(cpu.args[cpu.args.indexOf("-filter_complex") + 1]);
    expect(gpu.args[gpu.args.indexOf("-t") + 1]).toBe(cpu.args[cpu.args.indexOf("-t") + 1]);
    expect(gpu.args[gpu.args.indexOf("-f") + 1]).toBe("mp4");
    expect(gpu.args).toContain("0:a?");
  });

  it("keeps hostile paths in argv and escapes filter values", async () => {
    const template = createDefaultTemplate();
    const command = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, {
      ffmpegPath: "/usr/bin/ffmpeg", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/jianji-text.txt",
    });
    expect(command.args).toContain(media.sourcePath);
    expect(command.args.join(" ")).not.toContain("shell=true");
    expect(escapeFilterValue("a:b,c;[d]")).toBe("a\\:b\\,c\\;\\[d\\]");
  });

  it("rejects legacy badges before resolving fonts or producing a command", async () => {
    const template = createDefaultTemplate();
    template.layers.push({
      id: crypto.randomUUID(), type: "text", content: "细节之美", fontFamily: "Noto Sans CJK SC", fontSizeRatio: 0.026,
      color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidthRatio: 0.001,
      x: 0.54, y: 0.9, width: 0.42, opacity: 1, zIndex: 1, visible: true,
    });
    await expect(new TemplateCompiler().compile(template, media, DEFAULT_PRESET, {
      ffmpegPath: "/usr/bin/ffmpeg", fontResolver: { resolve: async () => { throw new Error("must not resolve"); } }, textFilePath: () => "/tmp/unused.txt",
    })).rejects.toThrow("请手动填写价格并重新制作");
  });

  it("fits governed bottom-corner stickers inside landscape output bounds", async () => {
    const template = createDefaultTemplate();
    template.layoutPolicy = "corner-safe-v1";
    template.layers.push({
      id: crypto.randomUUID(), type: "sticker", assetPath: "/tmp/square.png", assetFingerprint: "fixture",
      x: 0.76, y: 0.8, width: 0.2, rotationDeg: 0, opacity: 1, zIndex: 1, visible: true,
    });
    const command = await new TemplateCompiler().compile(template, { ...media, width: 320, height: 180 }, { ...DEFAULT_PRESET, resolutionMode: "720p" }, {
      ffmpegPath: "/usr/bin/ffmpeg", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused.txt",
    });
    const graph = command.args[command.args.indexOf("-filter_complex") + 1];
    expect(command.args.slice(command.args.indexOf("-stream_loop"), command.args.indexOf("-stream_loop") + 4)).toEqual(["-stream_loop", "-1", "-i", "/tmp/square.png"]);
    expect(command.args.slice(command.args.indexOf("-stream_loop") - 2, command.args.indexOf("-stream_loop"))).toEqual(["-t", "1.000"]);
    expect(graph).toContain("scale=256:115:force_original_aspect_ratio=decrease");
    expect(graph).toContain("overlay=x=main_w-overlay_w-main_w*0.04000:y=main_h-overlay_h-main_h*0.04000");
  });

  it("loops GIF sticker inputs without flattening their frame timestamps", async () => {
    const template = createDefaultTemplate();
    template.layers.push({
      id: crypto.randomUUID(), type: "sticker", assetPath: "/tmp/animated.gif", assetFingerprint: "fixture",
      x: 0.04, y: 0.04, width: 0.12, rotationDeg: 0, opacity: 1, zIndex: 1, visible: true,
    });
    const command = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, {
      ffmpegPath: "/usr/bin/ffmpeg", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused.txt",
    });
    expect(command.args.slice(command.args.indexOf("-stream_loop"), command.args.indexOf("-stream_loop") + 4)).toEqual(["-stream_loop", "-1", "-i", "/tmp/animated.gif"]);
    expect(command.args.slice(command.args.indexOf("-stream_loop") - 2, command.args.indexOf("-stream_loop"))).toEqual(["-t", "1.000"]);
    expect(command.args[command.args.indexOf("-filter_complex") + 1]).toContain("setpts=PTS-STARTPTS");
  });

  it.each([
    { name: "portrait 720p", width: 540, height: 960, resolutionMode: "720p" as const, size: "720:1280" },
    { name: "landscape 720p", width: 1920, height: 1080, resolutionMode: "720p" as const, size: "1280:720" },
    { name: "portrait 1080p", width: 720, height: 1280, resolutionMode: "1080p" as const, size: "1080:1920" },
  ])("preserves orientation for $name exports", async ({ width, height, resolutionMode, size }) => {
    const command = await new TemplateCompiler().compile(createDefaultTemplate(), { ...media, width, height }, { ...DEFAULT_PRESET, resolutionMode, frameRateMode: "30" }, {
      ffmpegPath: "/usr/bin/ffmpeg", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused.txt",
    });
    const graph = command.args[command.args.indexOf("-filter_complex") + 1];
    expect(graph).toContain(`scale=${size}:force_original_aspect_ratio=decrease,pad=${size}`);
    expect(command.args.slice(command.args.indexOf("-r"), command.args.indexOf("-r") + 2)).toEqual(["-r", "30"]);
    expect(command.args.slice(command.args.indexOf("-c:v"), command.args.indexOf("-c:v") + 2)).toEqual(["-c:v", "libx264"]);
    expect(command.args.slice(command.args.indexOf("-c:a"), command.args.indexOf("-c:a") + 2)).toEqual(["-c:a", "aac"]);
    expect(command.args.slice(command.args.indexOf("-b:a"), command.args.indexOf("-b:a") + 2)).toEqual(["-b:a", "192k"]);
    expect(command.args.slice(command.args.indexOf("-ar"), command.args.indexOf("-ar") + 2)).toEqual(["-ar", "44100"]);
  });
});
