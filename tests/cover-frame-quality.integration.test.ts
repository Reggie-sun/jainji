import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverBinary, FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { recognizeAutomaticCovers } from "./helpers/legacy-automatic-cover";
import type { MediaItem } from "../src/main/domain";

it.each([
  [720, 1280, 720, 1280],
  [1920, 1080, 1280, 720],
  [320, 180, 320, 180],
])("preserves bounded cover detection detail for %ix%i source", async (width, height, expectedWidth, expectedHeight) => {
  const [binary, probe] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
  if (!binary || !probe) throw new Error("FFmpeg and ffprobe required for frame quality verification");
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-quality-"));
  try {
    const sourcePath = path.join(directory, "source.mp4");
    const result = await runCommand(binary, ["-v", "error", "-f", "lavfi", "-i", `testsrc2=s=${width}x${height}:r=4:d=0.5`, "-c:v", "libx264", sourcePath]).promise;
    expect(result.code, result.stderr).toBe(0);
    const ffmpeg = new FfmpegAdapter(binary, probe);
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "fixture", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 1, width, height, durationMs: 500, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    let requests = 0;
    await recognizeAutomaticCovers(ffmpeg, media, async (images) => {
      requests++;
      expect(images.map(({ timeMs }) => timeMs)).toEqual([0, 250]);
      for (const image of images) {
        const bytes = Buffer.from(image.url.split(",")[1], "base64");
        expect(bytes.length).toBeLessThanOrEqual(2_000_000);
        const jpeg = path.join(directory, `${image.timeMs}.jpg`);
        await writeFile(jpeg, bytes);
        const info = await ffmpeg.probe(jpeg);
        expect(info.streams?.[0]).toMatchObject({ width: expectedWidth, height: expectedHeight });
      }
      return images.map(({ timeMs }) => ({ timeMs, targets: [] }));
    }, new AbortController().signal);
    expect(requests).toBe(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
