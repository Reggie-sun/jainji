import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { SupervisorEvidence } from "../src/main/supervisor-evidence";
import { discoverBinary, FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import type { MediaItem } from "../src/main/domain";

async function media(sourcePath: string, durationMs: number, width = 320, height = 180): Promise<MediaItem> {
  return { id: crypto.randomUUID(), sourcePath, displayName: path.basename(sourcePath), fingerprint: await fingerprintFile(sourcePath), sizeBytes: 1, durationMs, width, height, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
}

async function command(binary: string, args: string[]): Promise<void> {
  const result = await runCommand(binary, ["-v", "error", ...args]).promise;
  expect(result.code, result.stderr).toBe(0);
}

it("returns decoded CFR source/rendered pairs with pixel-rounded normalized crops", async (context) => {
  const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
  if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-supervisor-evidence-cfr-"));
  try {
    const source = path.join(directory, "source.mp4"), preview = path.join(directory, "preview.mp4"), letterboxed = path.join(directory, "letterboxed.mp4");
    await command(ffmpegPath, ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
    await command(ffmpegPath, ["-i", source, "-vf", "hflip", "-c:v", "libx264", "-pix_fmt", "yuv420p", preview]);
    await command(ffmpegPath, ["-i", source, "-vf", "scale=320:180,pad=320:320:0:70:black", "-c:v", "libx264", "-pix_fmt", "yuv420p", letterboxed]);
    const reader = new SupervisorEvidence(new FfmpegAdapter(ffmpegPath, ffprobePath), await media(source, 1000));
    const images = await reader.inspect([{ timeMs: 120, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }, { timeMs: 760 }], new AbortController().signal, preview);
    expect(images.map((image) => image.timeMs)).toEqual([100, 800]);
    expect(images.map((image) => image.previewTimeMs)).toEqual([100, 800]);
    expect(images[0].crop).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(images.every((image) => image.sourceUrl.startsWith("data:image/jpeg;base64,") && image.previewUrl?.startsWith("data:image/jpeg;base64,"))).toBe(true);
    const paired = await reader.inspect([{ timeMs: 120, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }], new AbortController().signal, letterboxed);
    expect(paired[0].previewCrop).toEqual({ x: 0.25, y: 0.359375, width: 0.5, height: 0.28125 });
    await reader.dispose(); await reader.dispose();
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60_000);

it("pairs VFR frames by decoded PTS and rejects invalid crop, time, and cancelled inspection", async (context) => {
  const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
  if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-supervisor-evidence-vfr-"));
  try {
    const source = path.join(directory, "source.mp4"), preview = path.join(directory, "preview.mp4"), sparsePreview = path.join(directory, "sparse-preview.mp4"), sparseSource = path.join(directory, "sparse-source.mp4");
    await command(ffmpegPath, ["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=20:d=1", "-vf", "select='eq(n,0)+eq(n,2)+eq(n,4)+eq(n,7)+eq(n,10)+eq(n,14)+eq(n,19)'", "-vsync", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
    await command(ffmpegPath, ["-i", source, "-c", "copy", preview]);
    await command(ffmpegPath, ["-i", source, "-vf", "select='eq(n,0)'", "-vsync", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", sparsePreview]);
    await command(ffmpegPath, ["-i", source, "-vf", "select='eq(n,0)+eq(n,6)'", "-vsync", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", sparseSource]);
    const reader = new SupervisorEvidence(new FfmpegAdapter(ffmpegPath, ffprobePath), await media(source, 1000, 160, 90));
    const images = await reader.inspect([{ timeMs: 330 }, { timeMs: 690 }], new AbortController().signal, preview);
    expect(images.map((image) => image.timeMs)).toEqual([350, 700]);
    expect(images.map((image) => image.previewTimeMs)).toEqual([350, 700]);
    await expect(reader.inspect([{ timeMs: 700 }], new AbortController().signal, sparsePreview)).rejects.toThrow(/时间不一致/);
    const sparseReader = new SupervisorEvidence(new FfmpegAdapter(ffmpegPath, ffprobePath), await media(sparseSource, 1000, 160, 90));
    await expect(sparseReader.inspect([{ timeMs: 400 }], new AbortController().signal)).rejects.toThrow(/源视频帧/);
    await sparseReader.dispose();
    await expect(reader.inspect([], new AbortController().signal)).rejects.toThrow(/1 至 8/);
    await expect(reader.inspect(Array.from({ length: 9 }, () => ({ timeMs: 100 })), new AbortController().signal)).rejects.toThrow(/1 至 8/);
    await expect(reader.inspect([{ timeMs: 1000 }], new AbortController().signal)).rejects.toThrow(/时间/);
    await expect(reader.inspect([{ timeMs: 100, crop: { x: 0.99, y: 0.99, width: 0.01, height: 0.01 } }], new AbortController().signal)).rejects.toThrow(/裁剪/);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(reader.inspect([{ timeMs: 100 }], cancelled.signal)).rejects.toThrow();
    await reader.dispose();
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60_000);
