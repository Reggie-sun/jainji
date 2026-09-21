import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactVerifier } from "../src/main/artifact";
import { materializePlan } from "../src/main/agent-provider";
import { DEFAULT_PRESET, now, randomTemplateDigest, type ExportBatch, type MediaItem, type OutputArtifact, type RandomStickerPoolEntry } from "../src/main/domain";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import type { StickerAssets } from "../src/main/builtin-stickers";

const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: "fixture" }])) as unknown as StickerAssets;
const manualTemplate = (productPrice: string) => materializePlan(
  { summary: "测试方案", captions: [], filter: "warm", intensity: 0.4 },
  "black-gold", { width: 720, height: 1280 }, stickerAssets, { mode: "manual", productPrice, sticker: "none" },
);
const makeMedia = async (id: string, sourcePath: string): Promise<MediaItem> => ({ id, sourcePath, displayName: path.basename(sourcePath), fingerprint: await fingerprintFile(sourcePath), sizeBytes: 1, durationMs: 1_000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() });
const fakeQueue = (directory: string, jobs = "jobs") => {
  const ffmpeg = { ffmpegPath: "/fake/ffmpeg", run: (args: string[]) => ({ process: {}, promise: (async () => { await writeFile(args[args.length - 1], "encoded"); return { code: 0, stdout: "", stderr: "" }; })(), cancel: async () => undefined }) } as unknown as FfmpegAdapter;
  const verifier = { verify: async (filePath: string, taskId: string): Promise<OutputArtifact> => ({ taskId, path: filePath, sizeBytes: 1, durationMs: 1_000, createdAt: now() }) } as unknown as ArtifactVerifier;
  const compiler = { compile: async () => ({ binary: "/fake", args: [], textFiles: [], durationSeconds: 1 }) } as any;
  return new ExportQueue({ jobStore: new JobStore(path.join(directory, jobs)), ffmpeg, compiler, artifactVerifier: verifier, fontResolver: { resolve: async () => "/tmp/font.ttf" } });
};
const completedSource = async (queue: ExportQueue, directory: string, media: MediaItem, projectId: string, productPrice = "19.9元拍一发三") => {
  const source = await queue.createBatch({ projectId, template: manualTemplate(productPrice), mediaIds: [media.id], mediaItems: [media], outputDirectory: path.join(directory, "out1"), preset: DEFAULT_PRESET });
  await queue.start(source.id);
  expect(queue.snapshot().batches[0].batch.status).toBe("completed");
  return source;
};
const dummyPool: RandomStickerPoolEntry[] = [{ id: "sparkle", assetPath: "/tmp/sparkle.png", assetFingerprint: "fixture" }];

describe("appendFromBatch", () => {
  it("appends N rendered clones of a completed batch without model calls or overwrites", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-append-"));
    const sourcePath = path.join(directory, "a.mp4");
    await writeFile(sourcePath, "a");
    const media = await makeMedia(crypto.randomUUID(), sourcePath);
    const queue = fakeQueue(directory);
    queue.setMediaLookup((id) => (id === media.id ? media : undefined));
    const projectId = crypto.randomUUID();
    const source = await completedSource(queue, directory, media, projectId);

    const appended = await queue.appendFromBatch({ batchId: source.id, projectId, count: 2, productPrice: "29.9元\n第二件半价", outputDirectory: path.join(directory, "out2") }, dummyPool);
    expect(appended).toHaveLength(2);
    expect(new Set(appended.map((batch) => batch.id)).size).toBe(2);
    expect(appended.every((batch) => batch.id !== source.id)).toBe(true);
    expect(appended.every((batch) => batch.submission === undefined)).toBe(true);
    for (const batch of appended) {
      expect(batch.projectId).toBe(projectId);
      expect(batch.templateSnapshot.id).not.toBe(source.templateSnapshot.id);
      expect(batch.templateSnapshot.productPrice).toBe("29.9元\n第二件半价");
      const text = batch.templateSnapshot.layers.find((layer) => layer.type === "text");
      if (text?.type !== "text") throw new Error("missing text layer");
      expect(text.content).toBe("29.9元\n第二件半价");
      expect(randomTemplateDigest(batch.templateSnapshot)).toBe(randomTemplateDigest(source.templateSnapshot));
    }

    await Promise.all(appended.map((batch) => queue.start(batch.id)));
    const states = queue.snapshot().batches.map((state) => state.batch);
    const finished = appended.map((batch) => states.find((candidate) => candidate.id === batch.id)!);
    expect(finished.every((batch) => batch.status === "completed")).toBe(true);
    const outputPaths = finished.map((batch) => batch.tasks[0].outputPath);
    expect(new Set(outputPaths).size).toBe(2);
    for (const outputPath of outputPaths) expect(outputPath?.startsWith(path.join(directory, "out2") + path.sep)).toBe(true);
    expect((await readdir(path.join(directory, "out2"))).filter((name) => name.endsWith(".mp4"))).toHaveLength(2);
    expect((await new JobStore(path.join(directory, "jobs")).loadAll())).toHaveLength(3);
  });

  it("randomizes stickers from the pool while freezing geometry", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-append-random-"));
    const stickerIds = ["sparkle", "arrow", "heart", "burst"];
    const pool: RandomStickerPoolEntry[] = [];
    for (const id of stickerIds) {
      const assetPath = path.join(directory, `${id}.png`);
      await writeFile(assetPath, id);
      pool.push({ id, assetPath, assetFingerprint: await fingerprintFile(assetPath) });
    }
    const poolAssets = Object.fromEntries(pool.map((entry) => [entry.id, { assetPath: entry.assetPath, assetFingerprint: entry.assetFingerprint }])) as unknown as StickerAssets;
    const stickeredTemplate = (productPrice: string) => materializePlan(
      { summary: "测试方案", captions: [], filter: "warm", intensity: 0.4, priceStyle: "classic", stickers: [
        { corner: "top-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
        { corner: "top-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
        { corner: "bottom-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
        { corner: "bottom-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
      ] },
      "black-gold", { width: 720, height: 1280 }, poolAssets, { mode: "agent", productPrice, sticker: "none" },
      { fonts: [], stickers: [{ id: "heart", label: "爱心" }] },
    );
    const sourcePath = path.join(directory, "a.mp4");
    await writeFile(sourcePath, "a");
    const media = await makeMedia(crypto.randomUUID(), sourcePath);
    const queue = fakeQueue(directory);
    queue.setMediaLookup((id) => (id === media.id ? media : undefined));
    const projectId = crypto.randomUUID();
    const source = await queue.createBatch({ projectId, template: stickeredTemplate("19.9元拍一发三"), mediaIds: [media.id], mediaItems: [media], outputDirectory: path.join(directory, "out1"), preset: DEFAULT_PRESET });
    await queue.start(source.id);
    expect(queue.snapshot().batches[0].batch.status).toBe("completed");

    const appended = await queue.appendFromBatch({ batchId: source.id, projectId, count: 2, productPrice: "19.9元拍一发三", outputDirectory: path.join(directory, "out2") }, pool);
    const sourceStickers = source.templateSnapshot.layers.filter((layer) => layer.type === "sticker");
    expect(sourceStickers.length).toBeGreaterThan(0);
    for (const batch of appended) {
      const batchStickers = batch.templateSnapshot.layers.filter((layer) => layer.type === "sticker");
      expect(batchStickers.length).toBe(sourceStickers.length);
      for (const layer of batchStickers) {
        if (layer.type !== "sticker") throw new Error("expected sticker layer");
        expect(pool.some((entry) => entry.assetFingerprint === layer.assetFingerprint)).toBe(true);
      }
      expect(randomTemplateDigest(batch.templateSnapshot)).toBe(randomTemplateDigest(source.templateSnapshot));
      expect(batch.templateSnapshot.filter.presetId).toMatch(/^(none|warm|cool|vivid)$/);
    }
  });

  it("returns the frozen display text and media count for dialog prefill", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-append-prefill-"));
    const sourcePath = path.join(directory, "a.mp4");
    await writeFile(sourcePath, "a");
    const media = await makeMedia(crypto.randomUUID(), sourcePath);
    const queue = fakeQueue(directory);
    queue.setMediaLookup((id) => (id === media.id ? media : undefined));
    const projectId = crypto.randomUUID();
    const source = await completedSource(queue, directory, media, projectId);

    expect(await queue.appendPrefill(source.id, projectId)).toEqual({ productPrice: "19.9元拍一发三", mediaCount: 1 });
    expect(await queue.appendPrefill(source.id, crypto.randomUUID())).toBeUndefined();
    expect(await queue.appendPrefill(crypto.randomUUID(), projectId)).toBeUndefined();
  });

  it("rejects cross-project, over-capacity, and not-yet-completed appends", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-append-guards-"));
    const sourcePath = path.join(directory, "a.mp4");
    await writeFile(sourcePath, "a");
    const media = await makeMedia(crypto.randomUUID(), sourcePath);
    const queue = fakeQueue(directory);
    queue.setMediaLookup((id) => (id === media.id ? media : undefined));
    const projectId = crypto.randomUUID();
    const source = await completedSource(queue, directory, media, projectId);
    const output = path.join(directory, "out2");

    await expect(queue.appendFromBatch({ batchId: source.id, projectId: crypto.randomUUID(), count: 1, productPrice: "1元", outputDirectory: output }, dummyPool)).rejects.toThrow(/当前项目/);
    await expect(queue.appendFromBatch({ batchId: source.id, projectId, count: 251, productPrice: "1元", outputDirectory: output }, dummyPool)).rejects.toThrow(/250/);
    const active = await queue.createBatch({ projectId, template: manualTemplate("1元"), mediaIds: [media.id], mediaItems: [media], outputDirectory: path.join(directory, "out3"), preset: DEFAULT_PRESET });
    await expect(queue.appendFromBatch({ batchId: active.id, projectId, count: 1, productPrice: "1元", outputDirectory: output }, dummyPool)).rejects.toThrow(/已完成/);
  });

  it("rejects appends whose legacy source has no usable media snapshots", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-append-legacy-"));
    const sourcePath = path.join(directory, "a.mp4");
    await writeFile(sourcePath, "a");
    const media = await makeMedia(crypto.randomUUID(), sourcePath);
    const projectId = crypto.randomUUID();
    const origin = fakeQueue(directory, "jobs-origin");
    origin.setMediaLookup((id) => (id === media.id ? media : undefined));
    const source = await completedSource(origin, directory, media, projectId);

    const legacyBatch = structuredClone(source) as ExportBatch;
    delete legacyBatch.mediaSnapshots;
    const legacyQueue = fakeQueue(directory, "jobs-legacy");
    legacyQueue.setMediaLookup(() => undefined);
    await legacyQueue.hydrate([legacyBatch]);
    await expect(legacyQueue.appendFromBatch({ batchId: legacyBatch.id, projectId, count: 1, productPrice: "1元", outputDirectory: path.join(directory, "out2") }, dummyPool)).rejects.toThrow(/素材已变化/);
  });

  it("rejects appends when the sticker pool is empty", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-append-empty-pool-"));
    const sourcePath = path.join(directory, "a.mp4");
    await writeFile(sourcePath, "a");
    const media = await makeMedia(crypto.randomUUID(), sourcePath);
    const queue = fakeQueue(directory);
    queue.setMediaLookup((id) => (id === media.id ? media : undefined));
    const projectId = crypto.randomUUID();
    const source = await completedSource(queue, directory, media, projectId);

    await expect(queue.appendFromBatch({ batchId: source.id, projectId, count: 1, productPrice: "1元", outputDirectory: path.join(directory, "out2") }, [])).rejects.toThrow(/贴纸/);
  });
});
