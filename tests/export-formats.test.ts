import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentStartSchema } from "../src/shared/agent";
import { createDefaultTemplate, DEFAULT_PRESET, ExportPresetSchema, type MediaItem } from "../src/main/domain";
import { discoverBinary, FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { allocateOutputPath, fingerprintFile } from "../src/main/paths";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { AgentController } from "../src/main/agent-controller";
import { ApplicationService } from "../src/main/application";
import * as frames from "../src/main/agent-frames";
import type { StickerAssets } from "../src/main/builtin-stickers";
import type { AssetLibrary } from "../src/main/asset-library";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultsPanel } from "../src/renderer/ResultsPanel";
import type { DesktopState } from "../src/shared/desktop";

describe("export format selection", () => {
  it("keeps legacy requests and presets on MP4 and rejects unknown formats", () => {
    const input = { decorations: { productPrice: "19.90" }, ruleId: "clean", mediaIds: [crypto.randomUUID()], outputDirectory: "/tmp/output", brief: "" };
    expect(AgentStartSchema.parse(input).exportFormat ?? "mp4").toBe("mp4");
    expect(DEFAULT_PRESET.container).toBe("mp4");
    for (const exportFormat of ["mp4", "mov", "mkv"]) {
      expect(AgentStartSchema.parse({ ...input, exportFormat }).exportFormat).toBe(exportFormat);
      expect(ExportPresetSchema.parse({ ...DEFAULT_PRESET, container: exportFormat }).container).toBe(exportFormat);
    }
    expect(AgentStartSchema.safeParse({ ...input, exportFormat: "../avi" }).success).toBe(false);
  });

  it.each(["mp4", "mov", "mkv"] as const)("renders and publishes real %s video and audio without replacing files", async (format) => {
    const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
    if (!ffmpegPath || !ffprobePath) throw new Error("Format integration proof requires FFmpeg and ffprobe");
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-formats-"));
    const sourcePath = path.join(directory, "source.mp4");
    const source = await runCommand(ffmpegPath, ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=24", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath]).promise;
    expect(source.code, source.stderr).toBe(0);
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 1000, durationMs: 500, width: 160, height: 90, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const store = new JobStore(path.join(directory, "jobs"));
    const ffmpeg = new FfmpegAdapter(ffmpegPath, ffprobePath);
    const queue = new ExportQueue({ ffmpeg, jobStore: store, fontResolver: { resolve: async () => null } });
    const batch = await queue.createBatch({ template: createDefaultTemplate(), mediaIds: [media.id], mediaItems: [media], outputDirectory: directory, preset: { ...DEFAULT_PRESET, container: format } });
    expect(batch.tasks[0].outputPath).toBe(path.join(directory, `source_edited.${format}`));
    // A file appears after allocation: publication must preserve it and its chosen format.
    await writeFile(batch.tasks[0].outputPath!, "existing user file");
    await queue.start(batch.id);
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status, task.errorMessage).toBe("completed");
    expect(task.outputArtifact?.path).toBe(path.join(directory, `source_edited_1.${format}`));
    expect(await readFile(batch.tasks[0].outputPath!, "utf8")).toBe("existing user file");
    const probeResult = await runCommand(ffprobePath, ["-v", "error", "-show_format", "-show_streams", "-of", "json", task.outputArtifact!.path]).promise;
    expect(probeResult.code).toBe(0);
    const probe = JSON.parse(probeResult.stdout);
    expect(probe.streams.map((stream: { codec_name: string }) => stream.codec_name)).toEqual(["h264", "aac"]);
    if (format === "mkv") expect(probe.format.format_name).toContain("matroska");
    else expect(probe.format.tags.major_brand.trim()).toBe(format === "mov" ? "qt" : "isom");
    const persisted = (await store.loadAll())[0];
    expect(persisted.batch.preset.container).toBe(format);
    const markup = renderToStaticMarkup(createElement(ResultsPanel, {
      state: { queue: { batches: [persisted] }, project: { mediaItems: [media] } } as unknown as DesktopState,
      busy: false, retryingIds: [], onCancel: () => {}, onRetry: () => {}, onOpen: () => {}, onReveal: () => {}, onNew: () => {},
    }));
    expect(markup).toContain("独立包装 · 成片");
    expect(markup).not.toContain("MP4 成片");
    expect(await allocateOutputPath(directory, sourcePath, "_edited", [], format)).toBe(path.join(directory, `source_edited_2.${format}`));
    // Simulate interruption, then recover and retry with the stored format.
    persisted.batch.tasks[0].status = "running";
    persisted.batch.status = "active";
    await store.save(persisted);
    const recovered = new ExportQueue({ ffmpeg, jobStore: store, fontResolver: { resolve: async () => null } });
    await recovered.recover();
    await recovered.retry([task.id]);
    await recovered.start(batch.id);
    const retried = recovered.snapshot().batches[0].batch.tasks[0];
    expect(retried.status, retried.errorMessage).toBe("completed");
    expect(retried.outputArtifact?.path).toBe(path.join(directory, `source_edited_2.${format}`));
  }, 30000);

  it.each([undefined, "mov", "mkv"] as const)("carries requested %s format through AgentController to the stored batch", async (exportFormat) => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-format-controller-"));
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath: path.join(directory, "source.mp4"), displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 160, height: 90, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    service.currentProject.mediaItems.push(media);
    const queue = new ExportQueue({ ffmpeg, jobStore: new JobStore(path.join(directory, "jobs")), fontResolver: { resolve: async () => "/fixture/font.ttf" } });
    const assets = {} as StickerAssets;
    const library = { prepare: async () => assets, resolveFont: async () => "/fixture/font.ttf" } as unknown as AssetLibrary;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, assets, library);
    controller.provider.configure({ apiKey: "unused", model: "unused", baseUrl: "https://example.test/v1" });
    vi.spyOn(frames, "extractAgentFrames").mockResolvedValue([]);
    vi.spyOn(controller.provider, "plan").mockResolvedValue({ summary: "fixture", captions: [{ text: "示例", corner: "top-left", size: 0.025 }], filter: "cool", intensity: 0.3 });
    vi.spyOn(queue, "start").mockResolvedValue();
    try {
      await controller.start({ ruleId: "clean", brief: "", mediaIds: [media.id], outputDirectory: directory, decorations: { productPrice: "19.90", sticker: "none", fontFamily: "Noto Sans CJK SC" }, exportFormat }, new Set([directory]));
      await vi.waitFor(() => expect(controller.snapshot()?.status).toBe("finished"));
      expect(controller.snapshot()?.items[0].status).toBe("exporting");
      expect(queue.snapshot().batches[0].batch.preset).toEqual({ ...DEFAULT_PRESET, container: exportFormat ?? "mp4" });
    } finally { await controller.cancel(); vi.restoreAllMocks(); }
  });
});
