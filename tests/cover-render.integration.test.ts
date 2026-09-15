import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TemplateCompiler } from "../src/main/compiler";
import { DEFAULT_PRESET, createDefaultTemplate, type MediaItem } from "../src/main/domain";
import { discoverBinary, FfmpegAdapter, runCommand } from "../src/main/ffmpeg";

const roots: string[] = [];
const coverId = `uploaded-${"b".repeat(64)}`;
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function pixel(ffmpegPath: string, input: string, x: number, y: number, destination: string): Promise<Buffer> {
  const result = await runCommand(ffmpegPath, ["-v", "error", "-y", "-i", input, "-vf", `crop=2:2:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", destination]).promise;
  expect(result.code, result.stderr).toBe(0);
  return readFile(destination);
}

for (const size of ["10x50", "2x4096", "4096x2"]) it(`covers an interior badge with ${size} artwork using bounded intermediate frames and retaining exterior pixels and audio`, { timeout: 60_000 }, async (context) => {
  const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
  if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-render-"));
  roots.push(directory);
  const sourcePath = path.join(directory, "source.mp4");
  const stickerPath = path.join(directory, "cover.png");
  const outputPath = path.join(directory, "covered.mp4");
  const source = await runCommand(ffmpegPath, [
    "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=160x90:r=24:d=0.25", "-f", "lavfi", "-i", "sine=frequency=440",
    "-filter_complex", "[0:v]drawbox=x=40:y=30:w=40:h=20:color=red:t=fill[v]", "-map", "[v]", "-map", "1:a", "-t", "0.25",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath,
  ]).promise;
  expect(source.code, source.stderr).toBe(0);
  const sticker = await runCommand(ffmpegPath, ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=blue:s=${size}`, "-frames:v", "1", stickerPath]).promise;
  expect(sticker.code, sticker.stderr).toBe(0);

  const template = createDefaultTemplate();
  template.layoutPolicy = "corner-safe-v1";
  template.layers.push({
    id: crypto.randomUUID(), type: "sticker", assetPath: stickerPath, assetFingerprint: "fixture", x: 0.25, y: 1 / 3,
    width: 0.25, rotationDeg: 0, opacity: 1, zIndex: 10, visible: true, cover: { stickerId: coverId, height: 2 / 9 },
  });
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 1, durationMs: 250, width: 160, height: 90, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
  const compiled = await new TemplateCompiler().compile(template, media, { ...DEFAULT_PRESET, resolutionMode: "source" }, { ffmpegPath, fontResolver: { resolve: async () => null }, textFilePath: () => path.join(directory, "unused.txt") });
  const args = [...compiled.args];
  const graphIndex = args.indexOf("-filter_complex") + 1;
  args[graphIndex] = args[graphIndex].replace("force_original_aspect_ratio=increase,crop", "force_original_aspect_ratio=increase,showinfo,crop");
  const rendered = await runCommand(compiled.binary, [...args, "-loglevel", "info", outputPath]).promise;
  expect(rendered.code, rendered.stderr).toBe(0);
  const intermediateSizes = [...rendered.stderr.matchAll(/\bs:(\d+)x(\d+)/g)];
  expect(intermediateSizes.length).toBeGreaterThan(0);
  for (const [, width, height] of intermediateSizes) {
    expect(Number(width)).toBeLessThanOrEqual(80);
    expect(Number(height)).toBeLessThanOrEqual(40);
  }

  const [inside, sourceExterior, outputExterior] = await Promise.all([
    pixel(ffmpegPath, outputPath, 60, 40, path.join(directory, "inside.rgb")),
    pixel(ffmpegPath, sourcePath, 10, 10, path.join(directory, "source-exterior.rgb")),
    pixel(ffmpegPath, outputPath, 10, 10, path.join(directory, "output-exterior.rgb")),
  ]);
  expect(inside[2]).toBeGreaterThan(inside[0] + 80);
  expect(Math.abs(outputExterior[0] - sourceExterior[0])).toBeLessThanOrEqual(8);
  expect(Math.abs(outputExterior[1] - sourceExterior[1])).toBeLessThanOrEqual(8);
  expect(Math.abs(outputExterior[2] - sourceExterior[2])).toBeLessThanOrEqual(8);
  const probe = await new FfmpegAdapter(ffmpegPath, ffprobePath).probe(outputPath);
  expect(probe.streams?.find((stream) => stream.codec_type === "video")).toMatchObject({ width: 160, height: 90 });
  expect(probe.streams?.some((stream) => stream.codec_type === "audio")).toBe(true);
});
