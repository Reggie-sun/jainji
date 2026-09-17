import { describe, expect, it, vi } from "vitest";
import { AUTOMATIC_STICKERS } from "../src/shared/automatic-stickers";
import { CoverStickerSchema } from "../src/shared/cover-sticker";
import { resolveCoverSticker, coverLayerForMedia } from "../src/main/cover-sticker";
import { createDefaultTemplate, EditTemplateSchema, type ExportBatch, type MediaItem, type EditTemplate } from "../src/main/domain";
import { AgentRunner } from "../src/main/agent-runner";
import { DecorationSchema } from "../src/shared/decorations";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentController } from "../src/main/agent-controller";
import type { ExportQueue } from "../src/main/queue";
import type { AssetLibrary } from "../src/main/asset-library";
import * as agentFrames from "../src/main/agent-frames";
import * as automaticCover from "../src/main/automatic-cover";
import * as stickerPreviews from "../src/main/sticker-preview";
import * as supervisedPreview from "../src/main/supervised-preview";

const a = `uploaded-${"a".repeat(64)}`, b = `uploaded-${"b".repeat(64)}`;
const options = { enabled: true, stickerIds: [a, b], rectangle: { x: 0.3, y: 0.4, width: 0.3, height: 0.2 } };
const builtin = { assetPath: "/tmp/builtin.png", assetFingerprint: "sha256:builtin" };
const assets = { sparkle: builtin, arrow: builtin, heart: builtin, burst: builtin, [a]: { assetPath: "/tmp/a.png", assetFingerprint: "sha256:a" }, [b]: { assetPath: "/tmp/b.png", assetFingerprint: "sha256:b" } };
const automaticHeartStickers = () => [
  { corner: "top-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
  { corner: "top-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
  { corner: "bottom-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
  { corner: "bottom-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
];

describe("reusable batch cover", () => {
  it.each(["failure", "cancel"])("shares cover selection without silent retries on %s", async (outcome) => {
    const source: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 640, height: 480, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    let rejectSelection!: (error: Error) => void;
    const selectCoverSticker = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectSelection = reject; }));
    const plan = vi.fn(), enqueue = vi.fn(), detectCoverTracks = vi.fn();
    const runner = new AgentRunner({ frames: async () => [], plan, enqueue, detectCoverTracks, selectCoverSticker, stickerAssets: assets, onChange: () => {} });
    runner.start("project", "clean", "", [source, { ...source, id: crypto.randomUUID() }], 2);
    await vi.waitFor(() => expect(selectCoverSticker).toHaveBeenCalledTimes(1));
    if (outcome === "cancel") runner.cancel();
    rejectSelection(new Error("selection failed"));
    await runner.settled();
    expect(selectCoverSticker).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled(); expect(detectCoverTracks).not.toHaveBeenCalled();
    expect(runner.snapshot()?.items.every((item) => item.status === (outcome === "cancel" ? "cancelled" : "failed"))).toBe(true);
  });
  it("requires explicit coverage settings independently of decoration mode", () => {
    expect(resolveCoverSticker(undefined, assets, [])).toBeUndefined();
    const disabled = { ...options, enabled: false, trackingMode: "manual" as const };
    expect(resolveCoverSticker(disabled, assets, [])).toBeUndefined();
    expect(disabled.enabled).toBe(false);
    expect(resolveCoverSticker(undefined, { sparkle: builtin }, [])).toBeUndefined();
    expect(resolveCoverSticker({ ...options, trackingMode: "agent" }, assets, [])).toMatchObject({ automatic: true, stickerId: a });
    expect(resolveCoverSticker({ ...options, trackingMode: "manual" }, assets, [])).not.toHaveProperty("automatic");
  });
  it.each(["manual", "agent"] as const)("respects enabled and disabled coverage in a %s controller run", async (mode) => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-controller-"));
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    const source: MediaItem = { id: crypto.randomUUID(), sourcePath: path.join(directory, "source.mp4"), displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 640, height: 480, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    service.currentProject.mediaItems.push(source);
    service.setCoverSticker({ ...options, stickerIds: [], enabled: true, trackingMode: "agent" });
    const history: ExportBatch[] = [];
    const queue = {
      snapshot: () => ({ revision: history.length, batches: history.map((batch) => ({ batch })) }),
      createBatch: async (input: { template: EditTemplate }) => {
        const batch = { projectId: service.currentProject.id, id: crypto.randomUUID(), createdAt: new Date(Date.now() + history.length).toISOString(), templateSnapshot: structuredClone(input.template), tasks: [{ id: crypto.randomUUID(), status: "completed" }] } as ExportBatch;
        history.push(batch); return batch;
      }, start: async () => {}, cancel: async () => {},
    } as unknown as ExportQueue;
    const libraryId = AUTOMATIC_STICKERS.find(({ id }) => id.startsWith("fluent-"))!.id;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, assets, { ensure: async () => builtin, prepare: async () => assets, resolveFont: async () => "/tmp/font.ttf" } as unknown as AssetLibrary);
    controller.provider.configure({ apiKey: "unused", model: "unused", baseUrl: "https://example.test/v1" });
    const frames = vi.spyOn(agentFrames, "extractAgentFrames").mockResolvedValue([]);
    const plan = vi.spyOn(controller.provider, "plan").mockImplementation(async (_rule, _brief, _frames, _signal, catalog) => ({ summary: "包装", captions: [], filter: "cool", intensity: 0.3, ...(mode === "agent" ? { stickers: ["top-left", "top-right", "bottom-left", "bottom-right"].map((corner) => ({ corner, sticker: catalog!.stickers[0].id, width: 0.08, rotationDeg: 0 })), priceStyle: "ice" as const } : {}) }));
    const preview = vi.spyOn(stickerPreviews, "stickerPreview").mockResolvedValue("data:image/jpeg;base64,aA==");
    const selectCover = vi.spyOn(controller.provider, "selectCoverSticker").mockImplementation(async (_frames, _signal, catalog) => catalog.stickers[0].id);
    const shortlist = vi.spyOn(controller.provider, "shortlist").mockImplementation(async (_rule, _brief, _frames, _signal, catalog, selection) => selection ? ["sparkle"] : [catalog.stickers.some(({ id }) => id === libraryId) ? libraryId : "sparkle"]);
    const superviseRecognition = vi.spyOn(controller.reviewerProvider, "superviseRecognition").mockImplementation(async (context) => JSON.stringify({ action: "resolve", reason: "复核完成", frames: context.images.map(({ timeMs }) => ({ timeMs, targets: [] })) }));
    const superviseTemplate = vi.spyOn(supervisedPreview, "superviseRenderedTemplate").mockImplementation(async ({ template }) => template);
    const visionDetect = vi.spyOn(controller.visionProvider, "detectCovers").mockResolvedValue([]);
    const detect = vi.spyOn(automaticCover, "recognizeAutomaticCovers").mockImplementation(async (_ffmpeg, _source, recognize, signal) => {
      await recognize([{ timeMs: 0, url: "data:image/jpeg;base64,aA==" }], undefined, signal);
      return [{ targetId: "detected", track: { startMs: 0, endMs: 1000, keyframes: [{ timeMs: 0, rectangle: service.currentProject.coverSticker?.enabled ? options.rectangle : { x: 0, y: 0, width: 0.1, height: 0.1 } }] } }];
    });
    const input = { ruleId: "clean" as const, brief: "", mediaIds: [source.id], multiplier: 2, outputDirectory: directory, decorations: { mode, productPrice: "手动内容", sticker: "none", fontFamily: "Noto Sans CJK SC" } };
    try {
      await expect(controller.start(input, new Set([directory]))).rejects.toThrow("独立的视觉识别模型");
      expect(preview).not.toHaveBeenCalled();
      expect(shortlist).not.toHaveBeenCalled();
      expect(plan).not.toHaveBeenCalled();
      expect(detect).not.toHaveBeenCalled();
      controller.visionProvider.configure({ apiKey: "unused", model: "detector", baseUrl: "https://example.test/v1" });
      controller.reviewerProvider.configure({ apiKey: "unused", model: "detector", baseUrl: "https://example.test/v1" });
      await controller.start(input, new Set([directory]));
      await vi.waitFor(() => expect(controller.busy).toBe(false));
      await controller.start(input, new Set([directory]));
      await vi.waitFor(() => expect(controller.busy).toBe(false));
      expect(history.flatMap((batch) => batch.templateSnapshot.layers.flatMap((layer) => layer.type === "sticker" && layer.cover ? [layer.cover.stickerId] : []))).toEqual([libraryId, "sparkle", libraryId, "sparkle"]);
      expect(selectCover).toHaveBeenCalledTimes(4);
      expect(shortlist.mock.calls.filter((call) => !call[5])[1][4].stickers.some(({ id }) => id === libraryId)).toBe(false);
      expect(Object.keys(assets)).not.toContain(libraryId);
      service.setCoverSticker({ ...options, stickerIds: [`uploaded-${"c".repeat(64)}`] });
      await expect(controller.start(input, new Set([directory]))).rejects.toThrow("覆盖贴纸已删除");
      expect(plan).toHaveBeenCalledTimes(4);
      expect(detect).toHaveBeenCalledTimes(2);
      expect(visionDetect).toHaveBeenCalledTimes(2);
      expect(superviseRecognition).toHaveBeenCalledTimes(2);
      expect(superviseTemplate).toHaveBeenCalledTimes(4);
      expect(history.every((batch) => batch.templateSnapshot.layers.some((layer) => layer.type === "sticker" && layer.cover?.automatic))).toBe(true);
      for (const settings of [undefined, { ...options, enabled: false, stickerIds: [`uploaded-${"c".repeat(64)}`] }]) {
        service.currentProject.coverSticker = settings;
        await controller.start(input, new Set([directory]));
        await vi.waitFor(() => expect(controller.busy).toBe(false));
      }
      expect(plan).toHaveBeenCalledTimes(8);
      expect(detect).toHaveBeenCalledTimes(mode === "agent" ? 4 : 2);
      expect(visionDetect).toHaveBeenCalledTimes(mode === "agent" ? 4 : 2);
      expect(superviseRecognition).toHaveBeenCalledTimes(mode === "agent" ? 4 : 2);
      expect(superviseTemplate).toHaveBeenCalledTimes(mode === "agent" ? 8 : 4);
      expect(selectCover).toHaveBeenCalledTimes(4);
      expect(shortlist.mock.calls.filter(call => call[6] === "cover")).toHaveLength(4);
      if (mode === "agent") {
        expect(history.slice(4).every(batch => batch.templateSnapshot.layers.filter(layer => layer.type === "sticker").length === 3)).toBe(true);
        controller.visionProvider.clear();
        await expect(controller.start(input, new Set([directory]))).rejects.toThrow("独立的视觉识别模型");
        expect(plan).toHaveBeenCalledTimes(8);
      }
      expect(history.slice(4)).toHaveLength(4);
      expect(history.slice(4).every((batch) => batch.templateSnapshot.layers.every((layer) => layer.type !== "sticker" || !layer.cover))).toBe(true);
    } finally { await controller.cancel(); frames.mockRestore(); plan.mockRestore(); preview.mockRestore(); shortlist.mockRestore(); selectCover.mockRestore(); detect.mockRestore(); superviseRecognition.mockRestore(); superviseTemplate.mockRestore(); visionDetect.mockRestore(); await rm(directory, { recursive: true, force: true }); }
  });
  it("rejects enabled coverage with missing assets before requesting a model", async () => {
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: async () => null });
    service.setCoverSticker(options);
    const queue = { snapshot: () => ({ revision: 0, batches: [] }) } as unknown as ExportQueue;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, { sparkle: builtin, arrow: builtin, heart: builtin, burst: builtin });
    controller.provider.configure({ apiKey: "unused", model: "unused", baseUrl: "https://example.test/v1" });
    const plan = vi.spyOn(controller.provider, "plan");
    const detect = vi.spyOn(controller.provider, "detectCovers");
    try {
      await expect(controller.start({ ruleId: "clean", brief: "", mediaIds: [crypto.randomUUID()], outputDirectory: "/tmp", decorations: { mode: "agent", productPrice: "19.9", sticker: "none", fontFamily: "Noto Sans CJK SC" } }, new Set(["/tmp"]))).rejects.toThrow("覆盖贴纸已删除");
      expect(plan).not.toHaveBeenCalled();
      expect(detect).not.toHaveBeenCalled();
      expect(controller.busy).toBe(false);
    } finally { plan.mockRestore(); detect.mockRestore(); }
  });
  it("persists reusable settings with the project and isolates returned state", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-project-"));
    try {
      const service = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
      service.setCoverSticker(options);
      const state = service.view({ revision: 0, batches: [] });
      state.project.coverSticker!.rectangle.x = 0;
      expect(service.currentProject.coverSticker?.rectangle.x).toBe(0.3);
      await service.saveProject(path.join(directory, "project.json"));
      service.newProject();
      expect(service.currentProject.coverSticker).toBeUndefined();
      await service.loadProject(path.join(directory, "project.json"));
      expect(service.currentProject.coverSticker).toEqual(options);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(["manual", "agent"] as const)("rotates successive rounds in %s mode and freezes independently of later settings", async (mode) => {
    const source: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 640, height: 480, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const track = { startMs: 100, endMs: 900, keyframes: [{ timeMs: 0, rectangle: options.rectangle }, { timeMs: 1000, rectangle: { ...options.rectangle, x: 0.5 } }] };
    const frozen = resolveCoverSticker({ ...options, tracks: { [source.id]: track } }, assets, [])!;
    const enqueue = vi.fn(async (_template: EditTemplate) => crypto.randomUUID());
    const runner = new AgentRunner({ frames: async () => [], plan: async () => ({ summary: "包装", captions: [], filter: "cool", intensity: 0.3, ...(mode === "agent" ? { stickers: automaticHeartStickers(), priceStyle: "mint" } : {}) }), enqueue, stickerAssets: assets,
      decorations: DecorationSchema.parse({ mode, sticker: "none", productPrice: "手动内容" }), autoCatalog: mode === "agent" ? { fonts: [], stickers: [{ id: "heart", label: "爱心" }] } : undefined, coverSticker: frozen, onChange: () => {} });
    runner.start("project", "clean", "", [source], 4);
    await runner.settled();
    expect(enqueue).toHaveBeenCalledTimes(4);
    for (const [index, [template]] of enqueue.mock.calls.entries()) {
      expect(template.layers.filter((layer) => layer.type === "sticker" && layer.cover)).toHaveLength(1);
      expect(template.layers.find((layer) => layer.type === "sticker" && layer.cover)).toMatchObject({ assetPath: assets[index % 2 ? b : a].assetPath, cover: { stickerId: index % 2 ? b : a } });
      expect(template.layers.find((layer) => layer.type === "text")).toMatchObject({ content: "手动内容" });
      expect(template.layers.find((layer) => layer.type === "sticker" && layer.cover)).toMatchObject({ cover: { motion: track } });
    }
    frozen.rectangle.x = 0;
    expect(enqueue.mock.calls[0][0].layers.find((layer) => layer.type === "sticker" && layer.cover)?.x).toBe(0.3);
  });
  it("validates user rectangles and uploaded candidates without weakening ordinary settings", () => {
    expect(CoverStickerSchema.parse(options)).toEqual(options);
    expect(CoverStickerSchema.parse({ ...options, trackingMode: "agent", stickerIds: [] }).stickerIds).toEqual([]);
    for (const invalid of [{ ...options, stickerIds: [] }, { ...options, stickerIds: ["heart"] }, { ...options, stickerIds: [a, a] }, { ...options, rectangle: { ...options.rectangle, x: 0.9 } }]) expect(() => CoverStickerSchema.parse(invalid)).toThrow();
  });

  it("rotates against frozen history, and fails for missing candidates", () => {
    const first = resolveCoverSticker(options, assets, [])!;
    expect(first.stickerId).toBe(a);
    const layer = coverLayerForMedia(first, { width: 640, height: 480 }, { width: 640, height: 480 });
    const history = [{ createdAt: "2026-09-15T00:00:00Z", templateSnapshot: { ...createDefaultTemplate(), layers: [layer] } }] as ExportBatch[];
    expect(resolveCoverSticker(options, assets, history)?.stickerId).toBe(b);
    expect(resolveCoverSticker({ ...options, enabled: false }, {}, history)).toBeUndefined();
    expect(() => resolveCoverSticker(options, { [a]: assets[a] }, history)).toThrow("覆盖贴纸");
    options.rectangle.x = 0.2;
    expect(first.rectangle.x).toBe(0.3);
    options.rectangle.x = 0.3;
  });

  it("maps source rectangles into the padded export and freezes opaque zero-rotation layers", () => {
    const frozen = resolveCoverSticker(options, assets, [])!;
    const layer = coverLayerForMedia(frozen, { width: 800, height: 600 }, { width: 1280, height: 720 });
    expect(layer.x).toBeCloseTo(0.125 + 0.3 * 0.75);
    expect(layer.width).toBeCloseTo(0.3 * 0.75);
    expect(layer).toMatchObject({ y: 0.4, cover: { height: 0.2, stickerId: a }, opacity: 1, rotationDeg: 0 });
  });
  it.each([{ width: 1066, height: 480 }, { width: 480, height: 1066 }])("keeps full-frame covers within normalized bounds for $width x $height", (source) => {
    const frozen = resolveCoverSticker({ ...options, rectangle: { x: 0, y: 0, width: 1, height: 1 } }, assets, [])!;
    const output = source.width > source.height ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
    const layer = coverLayerForMedia(frozen, source, output);
    expect(() => EditTemplateSchema.parse({ ...createDefaultTemplate(), layers: [layer] })).not.toThrow();
  });
});
