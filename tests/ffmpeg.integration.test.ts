import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactVerifier } from "../src/main/artifact";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, DEFAULT_TEXT_FONT_FAMILY, type MediaItem } from "../src/main/domain";
import { discoverBinary, FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";
import { runLayoutAgent } from "../src/main/layout-agent";

describe("real FFmpeg proof render", () => {
  it.for([{ shade: "black", min: 14, max: 20 }, { shade: "gray", min: 110, max: 140 }, { shade: "white", min: 220, max: 236 }])("preserves $shade brightness with the cool filter", { timeout: 60_000 }, async ({ shade, min, max }, context) => {
    const ffmpegPath = await discoverBinary("ffmpeg");
    if (!ffmpegPath) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-cool-lightness-"));
    const sourcePath = path.join(directory, "gray.mp4");
    const source = await runCommand(ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", `color=${shade}:s=64x64:r=24:d=0.2`, "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath]).promise;
    expect(source.code, source.stderr).toBe(0);
    const template = createDefaultTemplate("cool lightness");
    template.filter = { presetId: "cool", intensity: 0.3 };
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "gray.mp4", fingerprint: "fixture", sizeBytes: 1, durationMs: 200, width: 64, height: 64, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const compiled = await new TemplateCompiler().compile(template, media, { ...DEFAULT_PRESET, resolutionMode: "source" }, { ffmpegPath, fontResolver: { resolve: async () => null }, textFilePath: () => path.join(directory, "unused.txt") });
    const output = path.join(directory, "cool.mp4");
    const rendered = await runCommand(compiled.binary, [...compiled.args, output]).promise;
    expect(rendered.code, rendered.stderr).toBe(0);
    const measured = await runCommand(ffmpegPath, ["-hide_banner", "-i", output, "-vf", "signalstats,metadata=print", "-frames:v", "1", "-f", "null", "-"]).promise;
    expect(measured.code, measured.stderr).toBe(0);
    const luma = Number(measured.stderr.match(/lavfi.signalstats.YAVG=([\d.]+)/)?.[1]);
    expect(luma).toBeGreaterThanOrEqual(min);
    expect(luma).toBeLessThanOrEqual(max);
    if (shade === "gray") {
      const pixels = path.join(directory, "cool.rgb");
      const decoded = await runCommand(ffmpegPath, ["-v", "error", "-i", output, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", pixels]).promise;
      expect(decoded.code, decoded.stderr).toBe(0);
      const rgb = await readFile(pixels);
      expect(rgb[2]).toBeGreaterThan(rgb[0]);
    }
  });
  it("renders Unicode text, transparent sticker and filter, then verifies the artifact", async (context) => {
    const [ffmpegPath, ffprobePath, fontPath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe"), resolveFont(DEFAULT_TEXT_FONT_FAMILY)]);
    if (!ffmpegPath || !ffprobePath || !fontPath) {
      context.skip();
      return;
    }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-ffmpeg-"));
    const sourcePath = path.join(directory, "横屏;$(not-a-command).mp4");
    const stickerPath = path.join(directory, "贴纸.png");
    const outputPath = path.join(directory, "proof.mp4");
    const source = await runCommand(ffmpegPath, ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", sourcePath]).promise;
    expect(source.code, source.stderr).toBe(0);
    const sticker = await runCommand(ffmpegPath, ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=red@0.5:s=80x80", "-frames:v", "1", "-vf", "format=rgba", stickerPath]).promise;
    expect(sticker.code, sticker.stderr).toBe(0);
    const probe = await new FfmpegAdapter(ffmpegPath, ffprobePath).probe(sourcePath);
    const stream = probe.streams?.find((item) => item.codec_type === "video")!;
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: path.basename(sourcePath), fingerprint: "fixture", sizeBytes: 1, durationMs: Math.round(Number(probe.format?.duration ?? 1) * 1_000), width: stream.width!, height: stream.height!, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const template = runLayoutAgent(createDefaultTemplate("fixture"), { style: "black-gold", title: "你好，简辑", price: "19.9元2单" });
    template.layers.push({ id: crypto.randomUUID(), type: "sticker", assetPath: stickerPath, assetFingerprint: "fixture", x: 0.76, y: 0.8, width: 0.2, rotationDeg: 7, opacity: 0.8, zIndex: 3, visible: true });
    template.filter = { presetId: "warm", intensity: 0.6 };
    const compiler = new TemplateCompiler();
    const compiled = await compiler.compile(template, media, DEFAULT_PRESET, { ffmpegPath, fontResolver: { resolve: resolveFont }, textFilePath: (id) => path.join(directory, `${id}.txt`) });
    await Promise.all(compiled.textFiles.map((file) => writeFile(file.path, file.content, "utf8")));
    const result = await runCommand(compiled.binary, [...compiled.args, outputPath]).promise;
    expect(result.code, result.stderr).toBe(0);
    const artifact = await new ArtifactVerifier(new FfmpegAdapter(ffmpegPath, ffprobePath)).verify(outputPath, crypto.randomUUID());
    expect(artifact.durationMs).toBeGreaterThan(0);
    expect(artifact.sizeBytes).toBeGreaterThan(0);
  }, 60_000);

  it("preserves motion from a bundled GIF sticker", async (context) => {
    const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-gif-sticker-"));
    const sourcePath = path.join(directory, "source.mp4");
    const outputPath = path.join(directory, "animated-proof.mp4");
    const source = await runCommand(ffmpegPath, ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0x224466:s=320x180:r=25:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", sourcePath]).promise;
    expect(source.code, source.stderr).toBe(0);
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 1, durationMs: 2_000, width: 320, height: 180, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const template = createDefaultTemplate("animated sticker proof");
    template.layers.push({ id: crypto.randomUUID(), type: "sticker", assetPath: path.resolve("resources/stickers/downloaded/click-mini-cart.gif"), assetFingerprint: "fixture", x: 0.04, y: 0.04, width: 0.2, rotationDeg: 0, opacity: 1, zIndex: 0, visible: true });
    const compiled = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, { ffmpegPath, fontResolver: { resolve: async () => null }, textFilePath: () => path.join(directory, "unused.txt") });
    const rendered = await runCommand(compiled.binary, [...compiled.args, outputPath]).promise;
    expect(rendered.code, rendered.stderr).toBe(0);
    const hashes = await runCommand(ffmpegPath, ["-v", "error", "-i", outputPath, "-vf", "fps=10", "-t", "2", "-f", "framemd5", "-"]).promise;
    expect(hashes.code, hashes.stderr).toBe(0);
    const uniqueFrames = new Set(hashes.stdout.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => line.split(",").at(-1)?.trim()));
    expect(uniqueFrames.size).toBeGreaterThan(1);
  }, 60_000);
});
