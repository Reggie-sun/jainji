import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { discoverBinary, FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, type MediaItem } from "../src/main/domain";
import { coverLayerForMedia, resolveCoverSticker } from "../src/main/cover-sticker";
import { interpolateCoverRectangle, type CoverTrack } from "../src/shared/cover-sticker";

it("renders source-clocked motion, scale and visibility at 60 fps and retains audio", { timeout: 60_000 }, async (context) => {
  const [ffmpeg, ffprobe] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
  if (!ffmpeg || !ffprobe) return context.skip();
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-track-"));
  try {
    const sourcePath = path.join(directory, "source.mp4"), assetPath = path.join(directory, "blue.png"), output = path.join(directory, "output.mp4");
    const sourceResult = await runCommand(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=320x180:r=60:d=1.6", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath]).promise;
    expect(sourceResult.code, sourceResult.stderr).toBe(0);
    const assetResult = await runCommand(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=2x4096", "-frames:v", "1", assetPath]).promise;
    expect(assetResult.code, assetResult.stderr).toBe(0);
    const source: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source", fingerprint: "fixture", sizeBytes: 1, durationMs: 1600, width: 320, height: 180, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const track: CoverTrack = { startMs: 200, endMs: 1200, keyframes: [
      { timeMs: 200, rectangle: { x: 0.05, y: 0.05, width: 0.1, height: 0.1 } },
      { timeMs: 1000, rectangle: { x: 0.15, y: 0.1, width: 0.8, height: 0.8 } },
    ] };
    const stickerId = `uploaded-${"a".repeat(64)}`;
    const frozen = resolveCoverSticker({ enabled: true, stickerIds: [stickerId], rectangle: track.keyframes[0].rectangle, tracks: { [source.id]: track } }, { [stickerId]: { assetPath, assetFingerprint: "fixture" } }, [])!;
    const template = createDefaultTemplate();
    template.layers.push(coverLayerForMedia(frozen, source, source));
    const compiled = await new TemplateCompiler().compile(template, source, { ...DEFAULT_PRESET, resolutionMode: "source" }, { ffmpegPath: ffmpeg, fontResolver: { resolve: async () => null }, textFilePath: () => path.join(directory, "unused.txt") });
    const rendered = await runCommand(ffmpeg, [...compiled.args, output]).promise;
    expect(rendered.code, rendered.stderr).toBe(0);
    // Non-25fps-aligned frames detect stale sticker dimensions independently of x/y.
    for (const frame of [0, 12, 31, 43, 60, 71, 72, 90]) {
      const rawPath = path.join(directory, `frame-${frame}.rgb`);
      const decoded = await runCommand(ffmpeg, ["-v", "error", "-i", output, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", rawPath]).promise;
      expect(decoded.code, decoded.stderr).toBe(0);
      const data = await readFile(rawPath);
      let minX = 320, minY = 180, maxX = -1, maxY = -1;
      for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
        const offset = (y * 320 + x) * 3;
        if (data[offset + 2] > data[offset] + 80 && data[offset + 2] > data[offset + 1] + 80) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      }
      const timeMs = frame / 60 * 1000;
      if (timeMs < track.startMs || timeMs >= track.endMs) expect(maxX, `hidden at frame ${frame}`).toBe(-1);
      else {
        const rectangle = interpolateCoverRectangle(track.keyframes, timeMs);
        expect(Math.abs(minX - rectangle.x * 320), `x at frame ${frame}`).toBeLessThanOrEqual(2);
        expect(Math.abs(minY - rectangle.y * 180), `y at frame ${frame}`).toBeLessThanOrEqual(2);
        expect(Math.abs(maxX - minX + 1 - rectangle.width * 320), `width at frame ${frame}`).toBeLessThanOrEqual(2);
        expect(Math.abs(maxY - minY + 1 - rectangle.height * 180), `height at frame ${frame}`).toBeLessThanOrEqual(2);
      }
    }
    const probe = await new FfmpegAdapter(ffmpeg, ffprobe).probe(output);
    expect(probe.streams?.some((stream) => stream.codec_type === "audio")).toBe(true);
    expect(probe.streams?.find((stream) => stream.codec_type === "video")).toMatchObject({ width: 320, height: 180, r_frame_rate: "60/1" });
    expect(Number(probe.format?.duration)).toBeCloseTo(1.6, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
