import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { materializePlan } from "../src/main/agent-provider";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { DEFAULT_PRESET, DEFAULT_TEXT_FONT_FAMILY, now, type MediaItem } from "../src/main/domain";
import { discoverBinary, FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";

describe("real FFmpeg output directory recovery", () => {
  it("recreates a removed timestamp directory and publishes text, audio and faststart MP4 through the queue", { timeout: 60_000 }, async (context) => {
    const [ffmpegPath, ffprobePath, fontPath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe"), resolveFont(DEFAULT_TEXT_FONT_FAMILY)]);
    if (!ffmpegPath || !ffprobePath || !fontPath) { context.skip(); return; }
    const directory = await mkdtemp(path.join(process.env.JIANJI_OUTPUT_TEST_ROOT ?? tmpdir(), "jianji-directory-proof-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const output = path.join(directory, "视频", "9.27 14：17");
    const sourcePath = path.join(directory, "竞品详情 (27).mp4");
    const source = await runCommand(ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=24:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac", sourcePath]).promise;
    expect(source.code, source.stderr).toBe(0);
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: path.basename(sourcePath), fingerprint: await fingerprintFile(sourcePath), sizeBytes: (await stat(sourcePath)).size, durationMs: 1_000, width: 160, height: 90, rotation: 0, probeStatus: "ready", importedAt: now() };
    const template = materializePlan({ summary: "目录恢复验证", captions: [], filter: "warm", intensity: 0.4 }, "black-gold", media, await ensureBuiltinStickerAssets(path.join(directory, "assets")), { productPrice: "19.9元2件", sticker: "none" });
    const ffmpeg = new FfmpegAdapter(ffmpegPath, ffprobePath);
    const queue = new ExportQueue({ jobStore: new JobStore(path.join(directory, "jobs")), ffmpeg, fontResolver: { resolve: resolveFont } });
    const batch = await queue.createBatch({ template, mediaIds: [media.id], mediaItems: [media], outputDirectory: output, preset: { ...DEFAULT_PRESET, resolutionMode: "source" } });
    await rm(output, { recursive: true });
    await queue.start(batch.id);
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status, task.errorMessage).toBe("completed");
    expect(task.outputArtifact?.sizeBytes).toBeGreaterThan(0);
    const probe = await ffmpeg.probe(task.outputPath!);
    expect(probe.streams?.find(stream => stream.codec_type === "video")).toMatchObject({ width: 160, height: 90, codec_name: "h264" });
    expect(probe.streams?.some(stream => stream.codec_type === "audio")).toBe(true);
    expect(Number(probe.format?.duration)).toBeCloseTo(1, 1);
    const decode = await runCommand(ffmpegPath, ["-v", "error", "-i", task.outputPath!, "-f", "null", "-"]).promise;
    expect(decode.code, decode.stderr).toBe(0);
    expect(await readdir(output)).toEqual([path.basename(task.outputPath!)]);
    expect(await fingerprintFile(sourcePath)).toBe(media.fingerprint);
  });
});
