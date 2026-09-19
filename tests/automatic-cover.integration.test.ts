import { expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FfmpegAdapter, discoverBinary, runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { recognizeAutomaticCovers } from "./helpers/legacy-automatic-cover";
import { automaticCoverLayers, resolveCoverSticker } from "../src/main/cover-sticker";
import { createDefaultTemplate, DEFAULT_PRESET, type MediaItem } from "../src/main/domain";
import { TemplateCompiler } from "../src/main/compiler";
import { interpolateCoverRectangle } from "../src/shared/cover-sticker";

it("recognizes moving fixture badges but omits them from automatic cover rendering", { timeout: 60_000 }, async (context) => {
  const [binary, probe] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
  if (!binary || !probe) return context.skip();
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-auto-cover-proof-"));
  const ffmpeg = new FfmpegAdapter(binary, probe);
  try {
    const sourcePath = path.join(directory, "source.mp4");
    const sourceCommand = await runCommand(binary, ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=320x180:r=20:d=2.5", "-f", "lavfi", "-i", "color=c=red:s=32x18:r=20:d=2.5", "-f", "lavfi", "-i", "color=c=lime:s=32x18:r=20:d=2.5", "-f", "lavfi", "-i", "sine=frequency=440:duration=2.5", "-filter_complex", "[0:v][1:v]overlay=x='20+40*t':y=20[a];[a][2:v]overlay=x='230-30*t':y=100:enable='lt(t,1.25)'[v]", "-map", "[v]", "-map", "3:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", "2.5", sourcePath]).promise;
    expect(sourceCommand.code, sourceCommand.stderr).toBe(0);
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 1, durationMs: 2500, width: 320, height: 180, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    // A detector can reconcile two observations into a larger overlap box. The
    // sampling pipeline must retain that reconciled frame, not discard it.
    const reconciled = await recognizeAutomaticCovers(ffmpeg, media, async (images, previous) => images.map(({ timeMs }, index) => ({
      timeMs, targets: [{ id: "badge", rectangle: { x: 0.1, y: 0.1, width: 0.1, height: previous && index === 0 ? 0.2 : 0.1 } }],
    })), new AbortController().signal);
    const boundary = interpolateCoverRectangle(reconciled[0].track.keyframes, 1750);
    expect(boundary.y + boundary.height).toBeGreaterThanOrEqual(0.3);
    let requests = 0;
    // The fixture detector inspects decoded pixels; no commercial model is called.
    const tracks = await recognizeAutomaticCovers(ffmpeg, media, async (images, previous) => {
      requests++;
      if (previous) expect(images[0].timeMs).toBe(previous.timeMs);
      const frames = [];
      for (const [index, image] of images.entries()) {
        expect(image.url).toMatch(/^data:image\/jpeg;base64,/);
        const jpg = path.join(directory, `input-${requests}-${index}.jpg`), raw = path.join(directory, `input-${requests}-${index}.rgb`);
        await writeFile(jpg, Buffer.from(image.url.split(",")[1], "base64"));
        const decode = await runCommand(binary, ["-v", "error", "-i", jpg, "-vf", "scale=320:180", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]).promise;
        expect(decode.code, decode.stderr).toBe(0);
        const data = await readFile(raw);
        const targets = [];
        for (const [id, channel] of [["red", 0], ["green", 1]] as const) {
          let left = 320, top = 180, right = -1, bottom = -1;
          for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
            const offset = (y * 320 + x) * 3;
            if (data[offset + channel] > 150 && data[offset + channel] > data[offset + (1 - channel)] + 80 && data[offset + channel] > data[offset + 2] + 80) {
              left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
            }
          }
          if (right >= 0) targets.push({ id, rectangle: { x: left / 320, y: top / 180, width: (right + 1 - left) / 320, height: (bottom + 1 - top) / 180 } });
        }
        frames.push({ timeMs: image.timeMs, targets });
      }
      return frames;
    }, new AbortController().signal);
    expect(requests).toBe(2);
    expect(tracks).toHaveLength(2);
    expect(tracks.find(({ targetId }) => targetId.startsWith("green"))!.track.endMs).toBeLessThan(2500);
    const cancelled = new AbortController();
    let cancelledRequests = 0;
    await expect(recognizeAutomaticCovers(ffmpeg, media, async (images) => {
      cancelledRequests++;
      cancelled.abort();
      return images.map(({ timeMs }) => ({ timeMs, targets: [] }));
    }, cancelled.signal)).rejects.toThrow();
    expect(cancelledRequests).toBe(1);
    const assetPath = path.join(directory, "cover.png");
    const assetResult = await runCommand(binary, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=2x4096", "-frames:v", "1", assetPath]).promise;
    expect(assetResult.code, assetResult.stderr).toBe(0);
    const id = `uploaded-${"a".repeat(64)}`;
    const frozen = resolveCoverSticker({ enabled: true, stickerIds: [id], trackingMode: "agent", rectangle: { x: 0.8, y: 0.8, width: 0.1, height: 0.1 } }, { [id]: { assetPath, assetFingerprint: "fixture" } }, [])!;
    const template = createDefaultTemplate();
    template.layers = automaticCoverLayers(frozen, media, media, tracks);
    expect(template.layers).toEqual([]);
    const compiled = await new TemplateCompiler().compile(template, media, { ...DEFAULT_PRESET, resolutionMode: "source" }, { ffmpegPath: binary, fontResolver: { resolve: async () => null }, textFilePath: (id) => path.join(directory, `${id}.txt`) });
    expect(compiled.args).not.toContain("-filter_complex_script");
    await Promise.all(compiled.textFiles.map((file) => writeFile(file.path, file.content)));
    const output = path.join(directory, "output.mp4");
    const rendered = await runCommand(binary, [...compiled.args, output]).promise;
    expect(rendered.code, rendered.stderr).toBe(0);
    for (const frame of [0, 5, 10, 15, 20, 30, 40]) {
      const raw = path.join(directory, `output-${frame}.rgb`);
      const decoded = await runCommand(binary, ["-v", "error", "-i", output, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]).promise;
      expect(decoded.code, decoded.stderr).toBe(0);
      const data = await readFile(raw);
      let originalBadge = 0, blue = 0, whiteBacking = 0;
      for (let offset = 0; offset < data.length; offset += 3) {
        if ((data[offset] > data[offset + 1] + 80 && data[offset] > data[offset + 2] + 80) || (data[offset + 1] > data[offset] + 80 && data[offset + 1] > data[offset + 2] + 80)) originalBadge++;
        if (data[offset + 2] > data[offset] + 80 && data[offset + 2] > data[offset + 1] + 80) blue++;
        if (data[offset] > 210 && data[offset + 1] > 210 && data[offset + 2] > 210) whiteBacking++;
      }
      expect(originalBadge, `moving badge missing at frame ${frame}`).toBeGreaterThan(10);
      expect(blue).toBeLessThan(10);
      expect(whiteBacking).toBeLessThan(10);
    }
    const info = await ffmpeg.probe(output);
    expect(info.streams?.some((stream) => stream.codec_type === "audio")).toBe(true);
    expect(info.streams?.find((stream) => stream.codec_type === "video")).toMatchObject({ width: 320, height: 180, r_frame_rate: "20/1" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
