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

const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id}` }])) as BuiltinStickerAssets;

describe("AgentController queue admission", () => {
  it("does not let another project's recovered queued task block a new visible project", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-admission-"));
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    const queue = new ExportQueue({ ffmpeg, fontResolver: { resolve: async () => null }, jobStore: new JobStore(path.join(directory, "jobs")) });
    const id = crypto.randomUUID();
    service.currentProject.mediaItems.push({ id, displayName: "test", sourcePath: path.join(directory, "missing.mp4"), fingerprint: "missing", width: 10, height: 10, durationMs: 1000, sizeBytes: 1, rotation: 0, importedAt: new Date().toISOString(), probeStatus: "ready" });
    queue.snapshot = () => ({ revision: 1, batches: [{ batch: { projectId: "other-project", tasks: [{ status: "queued" }] } }] } as ReturnType<ExportQueue["snapshot"]>);
    const controller = new AgentController(service, queue, ffmpeg, () => {}, stickerAssets);
    controller.provider.configure({ apiKey: "unused-key", model: "unused", baseUrl: "https://example.test/v1" });
    try {
      await expect(controller.start({ ruleId: "clean", brief: "", mediaIds: [id], outputDirectory: directory }, new Set([directory]))).resolves.toBeUndefined();
    } finally { await controller.cancel(); await rm(directory, { recursive: true, force: true }); }
  });

  it("does not prepare or resolve manual selections in agent mode", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-agent-auto-"));
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    const queue = new ExportQueue({ ffmpeg, fontResolver: { resolve: async () => null }, jobStore: new JobStore(path.join(directory, "jobs")) });
    const id = crypto.randomUUID();
    service.currentProject.mediaItems.push({ id, displayName: "test", sourcePath: path.join(directory, "missing.mp4"), fingerprint: "missing", width: 10, height: 10, durationMs: 1000, sizeBytes: 1, rotation: 0, importedAt: new Date().toISOString(), probeStatus: "ready" });
    const library = { prepare: vi.fn(() => { throw new Error("manual asset should not prepare"); }), resolveFont: vi.fn(() => { throw new Error("manual font should not resolve"); }) } as unknown as AssetLibrary;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, stickerAssets, library);
    controller.provider.configure({ apiKey: "unused-key", model: "unused", baseUrl: "https://example.test/v1" });
    try {
      await expect(controller.start({ ruleId: "clean", brief: "", mediaIds: [id], outputDirectory: directory, decorations: { mode: "agent", sticker: "local-limited-discount", fontFamily: "Not A Font", corners: { "top-left": { type: "text", text: "坏数据", fontFamily: "Not A Font" } } } }, new Set([directory]))).resolves.toBeUndefined();
      expect(library.prepare).not.toHaveBeenCalled();
      expect(library.resolveFont).not.toHaveBeenCalled();
    } finally { await controller.cancel(); await rm(directory, { recursive: true, force: true }); }
  });
});
