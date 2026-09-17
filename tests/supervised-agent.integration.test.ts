import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";
import { ApplicationService } from "../src/main/application";
import { AgentController } from "../src/main/agent-controller";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { fingerprintFile } from "../src/main/paths";
import type { PreviewReviewInput } from "../src/main/supervisor-protocol";

describe("automatic supervisor through real render and original queue", () => {
  it.each([{ coverEnabled: false, cancel: false }, { coverEnabled: true, cancel: false }, { coverEnabled: false, cancel: true }])("checks actual renders before admission (cover=$coverEnabled, cancel=$cancel)", async ({ coverEnabled, cancel }) => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-supervised-integration-"));
    const ffmpeg = new FfmpegAdapter("ffmpeg", "ffprobe");
    const source = path.join(directory, "source.mp4");
    expect((await runCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x284:r=24", "-f", "lavfi", "-i", "sine=f=440", "-vf", "drawbox=x=132:y=255:w=24:h=24:color=white:t=fill", "-t", "4", "-c:v", "libx264", "-c:a", "aac", source]).promise).code).toBe(0);
    const fingerprint = await fingerprintFile(source);
    const service = new ApplicationService(ffmpeg, { resolve: resolveFont });
    await service.addMedia([source]);
    const jobs = new JobStore(path.join(directory, "jobs"));
    const queue = new ExportQueue({ ffmpeg, jobStore: jobs, fontResolver: { resolve: resolveFont }, executionLimits: { analysis: 1, exports: 1, threads: 1 } });
    const assets = await ensureBuiltinStickerAssets(path.join(directory, "stickers"));
    const controller = new AgentController(service, queue, ffmpeg, () => {}, assets);
    if (coverEnabled) service.currentProject.coverSticker = { enabled: true, trackingMode: "agent", stickerIds: [], rectangle: { x: 0, y: 0, width: 0.1, height: 0.1 } };
    for (const provider of [controller.provider, controller.visionProvider, controller.reviewerProvider]) provider.configure({ apiKey: "fixture", model: "fixture", baseUrl: "https://unused.invalid/v1" });
    vi.spyOn(controller.provider, "shortlist").mockResolvedValue(["heart"]);
    vi.spyOn(controller.provider, "selectCoverSticker").mockResolvedValue("heart");
    vi.spyOn(controller.provider, "plan").mockResolvedValue({ summary: "fixture", captions: [], filter: "none", intensity: 0,
      stickers: (["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(corner => ({ corner, sticker: "heart", width: 0.08, rotationDeg: 0 })), priceStyle: "classic" });
    const detect = vi.spyOn(controller.visionProvider, "detectCovers").mockImplementation(async images => images.map(image => ({ timeMs: image.timeMs, targets: [] })));
    vi.spyOn(controller.reviewerProvider, "superviseRecognition").mockImplementation(async input => JSON.stringify({ action: "resolve", reason: "fixture deliberately misses corner, preview repairs it", frames: input.proposal }));
    const inspected: PreviewReviewInput[] = [];
    const review = vi.spyOn(controller.reviewerProvider, "supervisePreview").mockImplementation(async input => {
      inspected.push(input);
      if (cancel) { void controller.cancel(); return JSON.stringify({ action: "pass", reason: "取消竞态" }); }
      expect(queue.snapshot().batches).toHaveLength(0);
      expect(input.evidence.every(image => image.sourceUrl.startsWith("data:image/jpeg;") && image.previewUrl?.startsWith("data:image/jpeg;"))).toBe(true);
      expect(JSON.stringify(input)).not.toContain(directory);
      return JSON.stringify(inspected.length === 1
        ? { action: "revise", reason: "右下已有原贴纸，修正占位", tracks: [{ targetId: "source-badge", track: { startMs: 0, endMs: 3000, keyframes: [{ timeMs: 0, rectangle: { x: 0.825, y: 0.89, width: 0.15, height: 0.1 } }] } }] }
        : { action: "pass", reason: "重新检查修订样片" });
    });
    const render = vi.spyOn(queue, "renderPreview");
    try {
      const outputDirectory = path.join(directory, "output");
      await controller.start({ ruleId: "clean", brief: "", mediaIds: service.currentProject.mediaItems.map(media => media.id), outputDirectory,
        decorations: { mode: "agent", displayMode: "first-3s", productPrice: "手动内容", sticker: "none", fontFamily: "Noto Sans CJK SC" }, exportSettings: { resolutionMode: "source", frameRateMode: "source", quality: "balanced" } }, new Set([outputDirectory]));
      await vi.waitFor(() => expect(controller.busy).toBe(false), { timeout: 30_000 });
      expect(controller.snapshot()?.items[0].error).toBeUndefined();
      if (cancel) {
        expect(controller.snapshot()?.items[0].status).toBe("cancelled");
        expect(queue.snapshot().batches).toHaveLength(0);
        expect(review).toHaveBeenCalledOnce();
        for (const [call] of render.mock.calls) await expect(access(call.cacheDirectory)).rejects.toThrow();
        return;
      }
      expect(review).toHaveBeenCalledTimes(2);
      expect(render).toHaveBeenCalledTimes(2);
      expect(detect).toHaveBeenCalledTimes(2); // Only first 3s, not the full 4s source.
      await vi.waitFor(() => expect(queue.snapshot().batches[0]?.batch.tasks[0].status).toBe("completed"), { timeout: 30_000 });
      const batch = queue.snapshot().batches[0].batch;
      expect(batch.templateSnapshot.productPrice).toBe("手动内容");
      expect(batch.templateSnapshot.decorationDisplayMode).toBe("first-3s");
      expect(batch.templateSnapshot.layers.filter(layer => layer.type === "sticker" && !layer.cover && (!layer.activeRanges || layer.activeRanges.some(range => range.startMs < 3000)))).toHaveLength(3);
      expect(batch.templateSnapshot.layers.filter(layer => layer.type === "sticker" && layer.cover)).toHaveLength(coverEnabled ? 1 : 0);
      expect((await jobs.loadAll())).toHaveLength(1);
      expect(await fingerprintFile(source)).toBe(fingerprint);
      const output = await ffmpeg.probe(batch.tasks[0].outputPath!);
      expect(output.streams?.some(stream => stream.codec_type === "audio")).toBe(true);
      expect(Number(output.format?.duration)).toBeCloseTo(4, 1);
      for (const [call] of render.mock.calls) await expect(access(call.cacheDirectory)).rejects.toThrow();
    } finally { await controller.cancel(); await queue.shutdown(); await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

});
