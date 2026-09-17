import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentController } from "../src/main/agent-controller";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";
import type { AssetLibrary } from "../src/main/asset-library";
import * as agentFrames from "../src/main/agent-frames";
import * as automaticCover from "../src/main/automatic-cover";
import * as stickerPreviews from "../src/main/sticker-preview";
import { DEFAULT_PRESET } from "../src/main/domain";
import { isAutomaticStickerAllowed } from "../src/shared/automatic-stickers";
import { isUploadedStickerId } from "../src/shared/decorations";

const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id}` }])) as BuiltinStickerAssets;

describe("AgentController queue admission", () => {
  it.each(["start", "brief"])("waits for uploaded preview cleanup when cancelling %s", async (operation) => {
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    const queue = { snapshot: () => ({ revision: 1, batches: [] }) } as unknown as ExportQueue;
    const id = `uploaded-${"c".repeat(64)}`;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, { ...stickerAssets, [id]: { assetPath: "/unused.png", assetFingerprint: "unused" } });
    controller.provider.configure({ apiKey: "unused", model: "unused", baseUrl: "https://example.test/v1" });
    let aborted = false;
    let release!: () => void;
    const preview = vi.spyOn(stickerPreviews, "stickerPreview").mockImplementation(async (_ffmpeg, _asset, signal) => new Promise((_resolve, reject) => {
      release = () => reject(new Error("cancelled after cleanup"));
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    }));
    const plan = vi.spyOn(controller.provider, "plan");
    const brief = vi.spyOn(controller.provider, "generateBrief");
    try {
      const input = { ruleId: "clean" as const, brief: "", mediaIds: [crypto.randomUUID()], outputDirectory: path.resolve("unused-output"), decorations: { mode: "agent" as const, productPrice: "19.90", sticker: "template", fontFamily: "Noto Sans CJK SC" } };
      const pending = (operation === "start" ? controller.start(input, new Set()) : controller.generateBrief({ ruleId: input.ruleId, decorations: input.decorations })).catch(() => undefined);
      await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
      let cancelled = false;
      const cancel = controller.cancel().then(() => { cancelled = true; });
      await vi.waitFor(() => expect(aborted).toBe(true));
      expect(cancelled).toBe(false);
      expect(controller.busy).toBe(true);
      release();
      await Promise.all([pending, cancel]);
      expect(controller.busy).toBe(false);
      expect(plan).not.toHaveBeenCalled();
      expect(brief).not.toHaveBeenCalled();
    } finally { release?.(); preview.mockRestore(); plan.mockRestore(); brief.mockRestore(); }
  });

  it("cancels candidate selection without preparing previews or calling the final model", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-shortlist-cancel-"));
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    const queue = { snapshot: () => ({ revision: 1, batches: [] }) } as unknown as ExportQueue;
    const id = crypto.randomUUID();
    service.currentProject.mediaItems.push({ id, displayName: "test", sourcePath: path.join(directory, "missing.mp4"), fingerprint: "missing", width: 10, height: 10, durationMs: 1000, sizeBytes: 1, rotation: 0, importedAt: new Date().toISOString(), probeStatus: "ready" });
    const library = { ensure: vi.fn(), resolveFont: async () => "/tmp/font.ttf" } as unknown as AssetLibrary;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, { ...stickerAssets, [`uploaded-${"a".repeat(64)}`]: stickerAssets.sparkle }, library);
    controller.provider.configure({ apiKey: "unused", model: "unused", baseUrl: "https://example.test/v1" });
    const frames = vi.spyOn(agentFrames, "extractAgentFrames").mockResolvedValue([]);
    const finalPlan = vi.spyOn(controller.provider, "plan");
    const shortlist = vi.spyOn(controller.provider, "shortlist").mockImplementation(async (_rule, _brief, _images, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const preview = vi.spyOn(stickerPreviews, "stickerPreview").mockResolvedValue("data:image/jpeg;base64,aA==");
    const detect = vi.spyOn(automaticCover, "recognizeAutomaticCovers").mockResolvedValue([]);
    try {
      await controller.start({ ruleId: "clean", brief: "", mediaIds: [id], outputDirectory: directory, decorations: { mode: "agent", displayMode: "first-3s", productPrice: "19.90", sticker: "template", fontFamily: "Noto Sans CJK SC" } }, new Set([directory]));
      await vi.waitFor(() => expect(shortlist).toHaveBeenCalledTimes(1));
      expect(shortlist.mock.calls[0][1]).toContain("最后 0.5 秒渐隐");
      const catalog = shortlist.mock.calls[0][4];
      expect(catalog.stickers).toHaveLength(56);
      expect(catalog.stickers.every(({ id: stickerId }) => isAutomaticStickerAllowed(stickerId) || isUploadedStickerId(stickerId))).toBe(true);
      expect(catalog.stickers.some(({ id: stickerId }) => stickerId.startsWith("local-") || stickerId === "fluent-bf9436317c97f49dd95dacd3358e8983a24b2aec")).toBe(false);
      await controller.cancel();
      expect(finalPlan).not.toHaveBeenCalled();
      expect(library.ensure).not.toHaveBeenCalled();
      expect(controller.snapshot()?.items[0].status).toBe("cancelled");
      expect(controller.busy).toBe(false);
    } finally { preview.mockRestore(); detect.mockRestore(); frames.mockRestore(); finalPlan.mockRestore(); shortlist.mockRestore(); await controller.cancel(); await rm(directory, { recursive: true, force: true }); }
  });
  it.each([1, 250])("admits %i outputs with 500 historical exports despite another project's recovered queued task", async (multiplier) => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-admission-"));
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    const queue = new ExportQueue({ ffmpeg, fontResolver: { resolve: async () => null }, jobStore: new JobStore(path.join(directory, "jobs")) });
    const id = crypto.randomUUID();
    service.currentProject.mediaItems.push({ id, displayName: "test", sourcePath: path.join(directory, "missing.mp4"), fingerprint: "missing", width: 10, height: 10, durationMs: 1000, sizeBytes: 1, rotation: 0, importedAt: new Date().toISOString(), probeStatus: "ready" });
    service.currentProject.exportBatches = Array.from({ length: 500 }, () => {
      const batchId = crypto.randomUUID();
      return {
        schemaVersion: 2, id: batchId, projectId: service.currentProject.id,
        templateSnapshot: service.currentProject.templates[0], mediaIds: [id],
        outputDirectory: directory, preset: DEFAULT_PRESET, status: "cancelled",
        estimatedBytes: 0, createdAt: service.currentProject.updatedAt,
        tasks: [{ id: crypto.randomUUID(), batchId, mediaId: id, status: "cancelled", progress: 0, attempt: 0, createdAt: service.currentProject.updatedAt, attempts: [] }],
      };
    });
    queue.snapshot = () => ({ revision: 1, batches: [{ batch: { projectId: "other-project", tasks: [{ status: "queued" }] } }] } as ReturnType<ExportQueue["snapshot"]>);
    const controller = new AgentController(service, queue, ffmpeg, () => {}, stickerAssets);
    controller.provider.configure({ apiKey: "unused-key", model: "unused", baseUrl: "https://example.test/v1" });
    try {
      await expect(controller.start({ ruleId: "clean", brief: "", mediaIds: [id], multiplier, outputDirectory: directory, decorations: { productPrice: "19.90", sticker: "template", fontFamily: "Noto Sans CJK SC" } }, new Set([directory]))).resolves.toBeUndefined();
      expect(controller.snapshot()?.items).toHaveLength(multiplier);
      expect(service.currentProject.exportBatches).toHaveLength(500);
    } finally { await controller.cancel(); await rm(directory, { recursive: true, force: true }); }
  });

  it("does not prepare or resolve manual selections in agent mode", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-agent-auto-"));
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    const queue = new ExportQueue({ ffmpeg, fontResolver: { resolve: async () => null }, jobStore: new JobStore(path.join(directory, "jobs")) });
    const id = crypto.randomUUID();
    service.currentProject.mediaItems.push({ id, displayName: "test", sourcePath: path.join(directory, "missing.mp4"), fingerprint: "missing", width: 10, height: 10, durationMs: 1000, sizeBytes: 1, rotation: 0, importedAt: new Date().toISOString(), probeStatus: "ready" });
    const library = { prepare: vi.fn(() => { throw new Error("manual asset should not prepare"); }), resolveFont: vi.fn(async () => "/tmp/default-font.ttf") } as unknown as AssetLibrary;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, { ...stickerAssets, [`uploaded-${"a".repeat(64)}`]: stickerAssets.sparkle }, library);
    controller.provider.configure({ apiKey: "unused-key", model: "unused", baseUrl: "https://example.test/v1" });
    const preview = vi.spyOn(stickerPreviews, "stickerPreview").mockResolvedValue("data:image/jpeg;base64,aA==");
    const detect = vi.spyOn(automaticCover, "recognizeAutomaticCovers").mockResolvedValue([]);
    try {
      await expect(controller.start({ ruleId: "clean", brief: "", mediaIds: [id], outputDirectory: directory, decorations: { productPrice: "19.90", mode: "agent", sticker: "local-limited-discount", fontFamily: "Not A Font", corners: { "top-left": { type: "sticker", sticker: "heart" } } } }, new Set([directory]))).resolves.toBeUndefined();
      expect(library.prepare).not.toHaveBeenCalled();
      expect(library.resolveFont).toHaveBeenCalledTimes(1);
      expect(library.resolveFont).toHaveBeenCalledWith("Noto Sans CJK SC");
    } finally { preview.mockRestore(); detect.mockRestore(); await controller.cancel(); await rm(directory, { recursive: true, force: true }); }
  });

  it("cancels a pending brief generation and clears its busy state", async () => {
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    const queue = { snapshot: () => ({ revision: 1, batches: [] }) } as unknown as ExportQueue;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, stickerAssets);
    let reject!: (error: unknown) => void;
    controller.provider.useChatGPT("test", (_messages, signal) => new Promise<string>((_resolve, fail) => {
      reject = fail;
      signal.addEventListener("abort", () => fail(signal.reason), { once: true });
    }));
    const pending = controller.generateBrief({ ruleId: "clean" });
    expect(controller.busy).toBe(true);
    await expect(controller.generateBrief({ ruleId: "clean" })).rejects.toThrow("正在处理");
    await controller.cancel();
    await expect(pending).rejects.toBeDefined();
    expect(controller.busy).toBe(false);
    expect(reject).toBeTypeOf("function");
  });
});
