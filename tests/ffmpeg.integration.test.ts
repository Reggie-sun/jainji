import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactVerifier } from "../src/main/artifact";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, DEFAULT_TEXT_FONT_FAMILY, type MediaItem } from "../src/main/domain";
import { discoverBinary, FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";

describe("real FFmpeg proof render", () => {
  it("renders Unicode text, transparent sticker and filter, then verifies the artifact", async () => {
    const [ffmpegPath, ffprobePath, fontPath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe"), resolveFont(DEFAULT_TEXT_FONT_FAMILY)]);
    if (!ffmpegPath || !ffprobePath || !fontPath) return;
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
    const template = createDefaultTemplate("fixture");
    template.layers.push({ id: crypto.randomUUID(), type: "text", content: "你好，简辑", fontFamily: DEFAULT_TEXT_FONT_FAMILY, fontSizeRatio: 0.12, color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidthRatio: 0.004, x: 0.05, y: 0.05, width: 0.8, opacity: 1, zIndex: 1, visible: true });
    template.layers.push({ id: crypto.randomUUID(), type: "sticker", assetPath: stickerPath, assetFingerprint: "fixture", x: 0.7, y: 0.6, width: 0.2, rotationDeg: 7, opacity: 0.8, zIndex: 2, visible: true });
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
});
