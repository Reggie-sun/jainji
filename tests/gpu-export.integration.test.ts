import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { ApplicationService } from "../src/main/application";
import { materializePlan } from "../src/main/agent-provider";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { DEFAULT_PRESET, DEFAULT_TEXT_FONT_FAMILY } from "../src/main/domain";
import { checkCapabilities, resolveFont, runCommand } from "../src/main/ffmpeg";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { DecorationSchema } from "../src/shared/decorations";

it("exports price, sticker and audio through real NVENC and verifies the published files", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-gpu-export-"));
  let queue: ExportQueue | undefined;
  try {
    const checked = await checkCapabilities(directory, resolveFont);
    if (!checked.status.ready || checked.status.videoEncoder !== "h264_nvenc" || !await resolveFont(DEFAULT_TEXT_FONT_FAMILY)) {
      context.skip(); return;
    }
    const adapter = checked.adapter!;
    const source = path.join(directory, "input.mp4");
    const generated = await runCommand(adapter.ffmpegPath, [
      "-hide_banner", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "h264_nvenc", "-pix_fmt", "yuv420p", "-c:a", "aac", source,
    ]).promise;
    expect(generated.code, generated.stderr).toBe(0);
    const service = new ApplicationService(adapter, { resolve: resolveFont });
    const [media] = await service.addMedia([source]);
    const stickers = await ensureBuiltinStickerAssets(path.join(directory, "stickers"));
    const template = materializePlan({ summary: "fixture", captions: [], filter: "cool", intensity: 0.3 }, "clean", media, stickers,
      DecorationSchema.parse({ productPrice: "19.90", sticker: "heart" }));
    expect(template.layers.some((layer) => layer.type === "text" && layer.content === "¥ 19.90")).toBe(true);
    expect(template.layers.some((layer) => layer.type === "sticker")).toBe(true);
    const run = vi.spyOn(adapter, "run");
    queue = new ExportQueue({
      ffmpeg: adapter, videoEncoder: checked.status.videoEncoder,
      fontResolver: { resolve: resolveFont }, jobStore: new JobStore(path.join(directory, "jobs")),
    });
    const batch = await queue.createBatch({
      projectId: service.currentProject.id, template, mediaIds: Array(6).fill(media.id), mediaItems: [media],
      outputDirectory: path.join(directory, "out"), preset: { ...DEFAULT_PRESET, resolutionMode: "source" },
    });
    await queue.start(batch.id);
    expect(run).toHaveBeenCalledTimes(6);
    for (const [args] of run.mock.calls) expect(args[args.indexOf("-c:v") + 1]).toBe("h264_nvenc");
    const tasks = queue.snapshot().batches[0].batch.tasks;
    expect(tasks.map((task) => task.errorMessage)).toEqual(Array(6).fill(undefined));
    expect(tasks.map((task) => task.status)).toEqual(Array(6).fill("completed"));
    expect(new Set(tasks.map((task) => task.outputPath)).size).toBe(6);
    for (const task of tasks) {
      expect(task.outputArtifact?.durationMs).toBeGreaterThanOrEqual(1900);
      const output = await adapter.probe(task.outputPath!);
      expect(output.streams?.find((stream) => stream.codec_type === "video")).toMatchObject({ codec_name: "h264", width: 640, height: 360 });
      expect(output.streams?.some((stream) => stream.codec_type === "audio")).toBe(true);
    }
  } finally {
    await queue?.shutdown();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
