import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { manualCoverLayers, resolveCoverSticker } from "../src/main/cover-sticker";
import { prepareAgentTemplate } from "../src/main/agent-template-preparation";
import { AgentController } from "../src/main/agent-controller";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import type { CreateBatchInput, ExportQueue } from "../src/main/queue";
import type { AssetLibrary } from "../src/main/asset-library";
import * as agentFrames from "../src/main/agent-frames";
import type { CoverSticker } from "../src/shared/cover-sticker";
import { DecorationSchema } from "../src/shared/decorations";
import type { MediaItem } from "../src/main/domain";
import type { StickerAssets } from "../src/main/builtin-stickers";

const stickerIds = "abcdef01".split("").map((character) => `uploaded-${character.repeat(64)}`);
const assets = Object.fromEntries(stickerIds.map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id.slice(-64)}` }])) as StickerAssets;
const corners = [[0, 0], [0.8, 0], [0, 0.9], [0.8, 0.9]] as const;
const settings: CoverSticker = {
  enabled: true, trackingMode: "manual", stickerIds: [], rectangle: { x: 0, y: 0, width: 0.2, height: 0.1 },
  regions: corners.map(([x, y]) => ({ id: crypto.randomUUID(), rectangle: { x, y, width: 0.2, height: 0.1 }, stickerId: stickerIds[0] })),
};
const media = (id = crypto.randomUUID()): MediaItem => ({
  id, sourcePath: "/tmp/source.mp4", displayName: "source", fingerprint: "fixture", sizeBytes: 1,
  durationMs: 1000, width: 640, height: 480, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString(),
});

describe("local random with corner covers", () => {
  it("requires a model only when the selected path uses one", async () => {
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    const queue = { snapshot: () => ({ batches: [] }) } as unknown as ExportQueue;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, assets);
    const request = { ruleId: "clean" as const, brief: "", mediaIds: [crypto.randomUUID()], outputDirectory: "/tmp", decorations: DecorationSchema.parse({ mode: "agent", productPrice: "手动文字" }) };
    await expect(controller.start(request, new Set())).rejects.toThrow("请先接入模型");
    service.setCoverSticker({ ...settings, trackingMode: "agent" });
    await expect(controller.start({ ...request, decorations: DecorationSchema.parse({ mode: "random", productPrice: "手动文字" }) }, new Set())).rejects.toThrow("请先接入模型");
  });

  it("uses four different visible covers and omits corner stickers hidden beneath them", () => {
    const source = media();
    const frozen = resolveCoverSticker(settings, assets, [], [source.id], true)!;
    const covers = manualCoverLayers(frozen, source, source);
    expect(new Set(covers.map((layer) => layer.cover?.stickerId)).size).toBe(4);

    const template = prepareAgentTemplate({
      plan: { summary: "本地随机", captions: [], filter: "cool", intensity: 0.4 }, ruleId: "clean", source,
      stickerAssets: assets, decorations: DecorationSchema.parse({ mode: "random", productPrice: "手动文字" }),
      coverSticker: frozen, runId: crypto.randomUUID(), version: 1,
    });
    expect(template.layers.filter((layer) => layer.type === "sticker" && layer.cover)).toHaveLength(4);
    expect(template.layers.filter((layer) => layer.type === "sticker" && !layer.cover)).toHaveLength(0);
  });

  it("distributes artwork across sources and rejects a pool too small for one source", () => {
    const first = media(), second = media();
    const frozen = resolveCoverSticker(settings, assets, [], [first.id, second.id], true)!;
    const selected = [first, second].flatMap((source) => manualCoverLayers(frozen, source, source).map((layer) => layer.cover!.stickerId));
    expect(new Set(selected).size).toBe(8);
    expect(frozen.mediaRegions?.[first.id].every((region) => region.artworkCycle === undefined)).toBe(true);
    const nextVersion = manualCoverLayers(frozen, first, first, 2).map((layer) => layer.cover!.stickerId);
    expect(new Set(nextVersion).size).toBe(4);
    expect(nextVersion).not.toEqual(selected.slice(0, 4));
    expect(() => resolveCoverSticker(settings, Object.fromEntries(Object.entries(assets).slice(0, 3)), [], [first.id], true)).toThrow(/4/);
  });

  it("queues random versions without extracting unused Agent frames or calling the creative model", async () => {
    const outputDirectory = await mkdtemp(path.join(tmpdir(), "jianji-random-cover-"));
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    const sources = [media(), media()].map((source) => ({ ...source, width: 720, height: 1280 }));
    service.currentProject.mediaItems.push(...sources);
    service.setCoverSticker(settings);
    const createBatch = vi.fn(async (_input: CreateBatchInput) => ({ id: crypto.randomUUID(), tasks: [{ id: crypto.randomUUID() }] }));
    const queue = { snapshot: () => ({ revision: 0, batches: [] }), createBatch, start: async () => {}, cancel: async () => {} } as unknown as ExportQueue;
    const library = { prepare: async () => assets, resolveFont: async () => "/tmp/font.ttf" } as unknown as AssetLibrary;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, assets, library);
    expect(controller.provider.status().configured).toBe(false);
    const frames = vi.spyOn(agentFrames, "extractAgentFrames").mockImplementation(async () => { throw new Error("random mode must not extract frames"); });
    const plan = vi.spyOn(controller.provider, "plan");
    try {
      await controller.start({ ruleId: "clean", brief: "", mediaIds: sources.map(({ id }) => id), outputDirectory,
        decorations: { mode: "random", productPrice: "手动文字", sticker: "template", fontFamily: "Noto Sans CJK SC" } }, new Set([outputDirectory]));
      await vi.waitFor(() => expect(createBatch).toHaveBeenCalledTimes(2));
      expect(frames).not.toHaveBeenCalled();
      expect(plan).not.toHaveBeenCalled();
      for (const [input] of createBatch.mock.calls) {
        const covers = input.template.layers.flatMap((layer) => layer.type === "sticker" && layer.cover ? [layer.cover.stickerId] : []);
        expect(covers).toHaveLength(4);
        expect(new Set(covers).size).toBe(4);
        expect(input.template.layers.filter((layer) => layer.type === "sticker" && !layer.cover)).toHaveLength(0);
      }
    } finally { frames.mockRestore(); plan.mockRestore(); await controller.cancel(); await rm(outputDirectory, { recursive: true, force: true }); }
  });
});
