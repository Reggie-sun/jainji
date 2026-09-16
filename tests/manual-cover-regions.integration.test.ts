import { expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { discoverBinary, FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, type MediaItem } from "../src/main/domain";
import { manualCoverLayers, resolveCoverSticker } from "../src/main/cover-sticker";

it("renders four independently assigned covers with independent visibility and preserves source audio", { timeout: 60_000 }, async (context) => {
  const [ffmpeg, ffprobe] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
  if (!ffmpeg || !ffprobe) return context.skip();
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-multi-cover-"));
  try {
    const sourcePath = path.join(directory, "source.mp4"), output = path.join(directory, "output.mp4");
    const run = async (args: string[]) => { const result = await runCommand(ffmpeg, ["-v", "error", ...args]).promise; expect(result.code, result.stderr).toBe(0); };
    await run(["-f", "lavfi", "-i", "color=c=gray:s=320x180:r=24:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath]);
    const assets: Record<string, { assetPath: string; assetFingerprint: string }> = {};
    for (const [index, color] of ["red", "blue"].entries()) {
      const assetPath = path.join(directory, `${color}.png`);
      await run(["-f", "lavfi", "-i", `color=c=${color}:s=32x32`, "-frames:v", "1", assetPath]);
      assets[`uploaded-${String(index).repeat(64)}`] = { assetPath, assetFingerprint: color };
    }
    const [red, blue] = Object.keys(assets);
    const source: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 320, height: 180, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const regions = [[0, 0], [0.8, 0], [0, 0.8], [0.8, 0.8]].map(([x, y], index) => ({ id: crypto.randomUUID(), rectangle: { x, y, width: 0.2, height: 0.2 }, stickerId: index % 2 ? blue : red }));
    const frozen = resolveCoverSticker({ enabled: true, stickerIds: [], rectangle: regions[0].rectangle, regions: regions.map((region, index) => index === 3 ? { ...region, tracks: { [source.id]: { startMs: 0, endMs: 500, keyframes: [{ timeMs: 0, rectangle: region.rectangle }] } } } : region) }, assets, [])!;
    const template = { ...createDefaultTemplate(), layers: manualCoverLayers(frozen, source, source) };
    const compiled = await new TemplateCompiler().compile(template, source, { ...DEFAULT_PRESET, resolutionMode: "source" }, { ffmpegPath: ffmpeg, fontResolver: { resolve: async () => null }, textFilePath: () => path.join(directory, "unused.txt") });
    await Promise.all(compiled.textFiles.map((file) => writeFile(file.path, file.content)));
    await run([...compiled.args, output]);
    for (const frame of [0, 18]) {
      const rawPath = path.join(directory, `frame-${frame}.rgb`);
      await run(["-i", output, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", rawPath]);
      const data = await readFile(rawPath);
      const pixel = (x: number, y: number) => [...data.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3)];
      for (const [index, region] of regions.entries()) {
        const [r, g, b] = pixel(Math.round((region.rectangle.x + 0.1) * 320), Math.round((region.rectangle.y + 0.1) * 180));
        if (index === 3 && frame === 18) expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(10);
        else if (index % 2) expect(b - Math.max(r, g)).toBeGreaterThan(100);
        else expect(r - Math.max(g, b)).toBeGreaterThan(100);
      }
      expect(pixel(160, 90).every((value) => value > 110 && value < 145)).toBe(true);
    }
    const probe = await new FfmpegAdapter(ffmpeg, ffprobe).probe(output);
    expect(probe.streams?.some((stream) => stream.codec_type === "audio")).toBe(true);
    expect(Number(probe.format?.duration)).toBeCloseTo(1, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
