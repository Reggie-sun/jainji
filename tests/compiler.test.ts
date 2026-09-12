import { describe, expect, it } from "vitest";
import { createDefaultTemplate, DEFAULT_PRESET, type MediaItem } from "../src/main/domain";
import { escapeFilterValue, TemplateCompiler } from "../src/main/compiler";

const media: MediaItem = {
  id: crypto.randomUUID(), sourcePath: "/tmp/source;$(touch hacked).mp4", displayName: "source;$(touch hacked).mp4",
  fingerprint: "sha256:test", sizeBytes: 10, durationMs: 1_000, width: 1920, height: 1080, rotation: 0,
  probeStatus: "ready", importedAt: new Date().toISOString(),
};

describe("TemplateCompiler", () => {
  it("keeps hostile paths in argv and escapes filter values", async () => {
    const template = createDefaultTemplate();
    template.layers.push({
      id: crypto.randomUUID(), type: "text", content: "Unicode 演示; $(not a command)", fontFamily: "DejaVu Sans", fontSizeRatio: 0.06,
      color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidthRatio: 0.004,
      x: 0.1, y: 0.1, width: 0.7, opacity: 1, zIndex: 1, visible: true,
    });
    const command = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, {
      ffmpegPath: "/usr/bin/ffmpeg",
      fontResolver: { resolve: async () => "/usr/share/fonts/truetype/dejavu/DejaVu Sans.ttf" },
      textFilePath: () => "/tmp/jianji-text.txt",
    });
    expect(command.args).toContain(media.sourcePath);
    expect(command.args.join(" ")).not.toContain("shell=true");
    expect(command.textFiles[0].content).toContain("$(not a command)");
    expect(escapeFilterValue("a:b,c;[d]\\e")).toBe("a\\:b\\,c\\;\\[d\\]\\\\e");
  });

  it("wraps full-width CJK glyphs within the normalized layer width", async () => {
    const template = createDefaultTemplate();
    template.layers.push({
      id: crypto.randomUUID(), type: "text", content: "简辑真实素材测试", fontFamily: "Noto Sans CJK SC", fontSizeRatio: 0.08,
      color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidthRatio: 0.004,
      x: 0.06, y: 0.08, width: 0.88, opacity: 1, zIndex: 1, visible: true,
    });
    const command = await new TemplateCompiler().compile(template, { ...media, width: 720, height: 1280 }, DEFAULT_PRESET, {
      ffmpegPath: "/usr/bin/ffmpeg",
      fontResolver: { resolve: async () => "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc" },
      textFilePath: () => "/tmp/jianji-cjk-text.txt",
    });
    expect(command.textFiles[0].content).toBe("简辑真实素材\n测试");
  });

  it("compiles an agent badge background through drawtext box options", async () => {
    const template = createDefaultTemplate();
    template.layers.push({
      id: crypto.randomUUID(), type: "text", content: "19.9元2单", fontFamily: "Noto Sans CJK SC", fontSizeRatio: 0.026,
      color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 143, g: 21, b: 21, a: 0.9 }, strokeWidthRatio: 0.001,
      backgroundColor: { r: 232, g: 62, b: 62, a: 0.92 }, backgroundPaddingRatio: 0.006,
      x: 0.7, y: 0.022, width: 0.275, opacity: 1, zIndex: 2, visible: true,
    });
    const command = await new TemplateCompiler().compile(template, { ...media, width: 720, height: 1280 }, DEFAULT_PRESET, {
      ffmpegPath: "/usr/bin/ffmpeg",
      fontResolver: { resolve: async () => "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc" },
      textFilePath: () => "/tmp/jianji-agent-price.txt",
    });
    const graph = command.args[command.args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("box=1");
    expect(graph).toContain("boxcolor=0xe83e3e@0.920");
    expect(graph).toContain("boxborderw=8");
  });

  it("fits governed bottom-corner stickers inside landscape output bounds", async () => {
    const template = createDefaultTemplate();
    template.layoutPolicy = "corner-safe-v1";
    template.layers.push({
      id: crypto.randomUUID(), type: "sticker", assetPath: "/tmp/square.png", assetFingerprint: "fixture",
      x: 0.76, y: 0.8, width: 0.2, rotationDeg: 0, opacity: 1, zIndex: 1, visible: true,
    });
    const command = await new TemplateCompiler().compile(template, { ...media, width: 320, height: 180 }, DEFAULT_PRESET, {
      ffmpegPath: "/usr/bin/ffmpeg", fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused.txt",
    });
    const graph = command.args[command.args.indexOf("-filter_complex") + 1];
    expect(command.args.slice(command.args.indexOf("-stream_loop"), command.args.indexOf("-stream_loop") + 4)).toEqual(["-stream_loop", "-1", "-i", "/tmp/square.png"]);
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
