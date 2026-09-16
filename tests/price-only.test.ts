import { expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { materializePlan, validatePlan } from "../src/main/agent-provider";
import { DecorationSchema } from "../src/shared/decorations";
import { DEFAULT_PRESET, type MediaItem } from "../src/main/domain";
import type { StickerAssets } from "../src/main/builtin-stickers";
import { TemplateCompiler } from "../src/main/compiler";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import type { FfmpegAdapter } from "../src/main/ffmpeg";
import { ExportBatchSchema } from "../src/main/domain";

const plan = { summary: "仅保留价格", captions: [], filter: "warm", intensity: 0.4 };
const options = { productPrice: "19.9元30贴", sticker: "none" };
const dimensions = { width: 720, height: 1280 };
const automaticAssets: StickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: "fixture" }])) as StickerAssets;
const automaticHeartStickers = () => [
  { corner: "top-left", sticker: "heart", width: 0.12, rotationDeg: 0 },
  { corner: "top-right", sticker: "heart", width: 0.12, rotationDeg: 0 },
  { corner: "bottom-left", sticker: "heart", width: 0.12, rotationDeg: 0 },
  { corner: "bottom-right", sticker: "heart", width: 0.12, rotationDeg: 0 },
];
const automaticCatalog = { fonts: [], stickers: [{ id: "heart", label: "爱心" }] };
const automaticPlan = (priceStyle = "classic") => ({ ...plan, stickers: automaticHeartStickers(), priceStyle });

it.each(["19.9元\n到手30贴", "春日新品\n拍一发三", "一二三四五六七八九十一二\n一二三四五六七八九十一二", "%{n}\n优惠 50%"])("preserves arbitrary manual text through export: %s", async (productPrice) => {
  for (const mode of ["manual", "agent"] as const) {
    for (const size of [dimensions, { width: 1920, height: 1080 }]) {
      const template = materializePlan(mode === "agent" ? automaticPlan() : plan, "black-gold", size, automaticAssets, { mode, productPrice, sticker: "none" }, mode === "agent" ? automaticCatalog : undefined);
      const compile = (value: typeof template) => new TemplateCompiler().compile(value, { ...size, sourcePath: "/tmp/source.mp4", durationMs: 1000 } as MediaItem, DEFAULT_PRESET, { ffmpegPath: "ffmpeg", fontResolver: { resolve: async () => "/tmp/font.ttf" }, textFilePath: (id) => `/tmp/${id}.txt` });
      const compiled = await compile(JSON.parse(JSON.stringify(template)));
      expect(compiled.textFiles.map((entry) => entry.content)).toEqual(productPrice.split("\n"));
      expect(compiled.args.join(" ")).toContain("expansion=none");
      const changed = structuredClone(template);
      const priceLayer = changed.layers.find((layer) => layer.type === "text");
      if (priceLayer?.type === "text") priceLayer.content = "模型擅自改写";
      await expect(compile(changed)).rejects.toThrow(/价格/);
    }
  }
});

it.each(["manual", "agent"] as const)("compiles two centered price lines from one frozen layer in %s mode", async (mode) => {
  const productPrice = "9.9元到手5卷\n19.9元拍一发三";
  for (const size of [dimensions, { width: 1920, height: 1080 }]) {
    const template = materializePlan(mode === "agent" ? automaticPlan() : plan, "black-gold", size, automaticAssets, { mode, productPrice, sticker: "none" }, mode === "agent" ? automaticCatalog : undefined);
    expect(template.layers.filter((layer) => layer.type === "sticker")).toHaveLength(mode === "agent" ? 4 : 0);
    expect(template.layers.find((layer) => layer.type === "text")).toMatchObject({ content: productPrice });
    const compiled = await new TemplateCompiler().compile(JSON.parse(JSON.stringify(template)), { ...size, sourcePath: "/tmp/source.mp4", durationMs: 1000 } as MediaItem, DEFAULT_PRESET, { ffmpegPath: "ffmpeg", fontResolver: { resolve: async () => "/tmp/font.ttf" }, textFilePath: (id) => `/tmp/${id}.txt` });
    expect(compiled.textFiles.map((entry) => entry.content)).toEqual(productPrice.split("\n"));
    expect(new Set(compiled.textFiles.map((entry) => entry.path)).size).toBe(2);
    const graph = compiled.args[compiled.args.indexOf("-filter_complex") + 1];
    expect(graph.match(/x=w\*0.50000-text_w\/2/g)).toHaveLength(2);
    expect(graph).toContain("y=h*0.13000");
    expect(graph).toContain(`y=h*${(0.13 + Math.min(0.08 * size.width / size.height, 0.14) * 1.4).toFixed(5)}`);
  }
});

it("rejects decorative model text in both modes at the local boundary", () => {
  for (const catalog of [undefined, automaticCatalog]) {
    const raw = { ...(catalog ? automaticPlan() : plan), captions: [{ text: "细节之美", corner: "bottom-right", size: 0.026, ...(catalog ? { fontFamily: "Noto Sans CJK SC" } : {}) }] };
    expect(() => validatePlan(raw, "black-gold", catalog)).toThrow();
  }
});

it("rejects manual corner text even when otherwise valid", () => {
  expect(DecorationSchema.safeParse({ ...options, corners: { "bottom-right": { type: "text", text: "细节之美", fontFamily: "Noto Sans CJK SC" } } }).success).toBe(false);
});

it("retains strict model fields and template filter limits", () => {
  for (const raw of [{ ...plan, intensity: 0.9 }, { ...plan, filter: "cool" }, { ...plan, command: "ffmpeg" }, { ...plan, price: "19.90" }]) {
    expect(() => validatePlan(raw, "black-gold")).toThrow();
  }
  expect(() => validatePlan({ ...plan, filter: "mono", intensity: 0 }, "mono")).toThrow();
});

it.each(["19.9元30贴", "29.90元50片", "999999.99元1贴", "19.90元1000毫升"])("renders the exact manual quantity price without wrapping: %s", async (productPrice) => {
  for (const size of [dimensions, { width: 1920, height: 1080 }]) {
    for (const mode of ["manual", "agent"] as const) {
      const template = materializePlan(mode === "agent" ? automaticPlan() : plan, "black-gold", size, automaticAssets, { mode, productPrice, sticker: "none" }, mode === "agent" ? automaticCatalog : undefined);
      const compiled = await new TemplateCompiler().compile(template, { ...size, sourcePath: "/tmp/source.mp4", durationMs: 1000 } as MediaItem, DEFAULT_PRESET, { ffmpegPath: "ffmpeg", fontResolver: { resolve: async () => "/tmp/font.ttf" }, textFilePath: () => "/tmp/price.txt" });
      expect(compiled.textFiles.map((entry) => entry.content)).toEqual([productPrice]);
    }
  }
});

it("materializes and compiles exactly the manual price, rejects added or modified text", async () => {
  const template = materializePlan(plan, "black-gold", dimensions, {} as StickerAssets, options);
  expect(template.layers).toEqual([expect.objectContaining({ type: "text", content: options.productPrice, textAlign: "center" })]);
  const compiler = new TemplateCompiler();
  const compile = (value: typeof template) => compiler.compile(value, { ...dimensions, sourcePath: "/tmp/source.mp4", durationMs: 1000 } as MediaItem, DEFAULT_PRESET, { ffmpegPath: "ffmpeg", fontResolver: { resolve: async () => "/tmp/font.ttf" }, textFilePath: () => "/tmp/price.txt" });
  expect((await compile(template)).textFiles.map((entry) => entry.content)).toEqual([options.productPrice]);
  const changed = structuredClone(template);
  if (changed.layers[0].type === "text") changed.layers[0].content = "细节之美";
  await expect(compile(changed)).rejects.toThrow(/价格/);
  await expect(compile({ ...template, layers: [...template.layers, { ...template.layers[0], id: crypto.randomUUID() }] })).rejects.toThrow(/价格/);
  await expect(compile({ ...template, productPrice: undefined })).rejects.toThrow(/价格/);
  await expect(compile({ ...template, layers: template.layers.map((layer) => ({ ...layer, x: 0.2 })) })).rejects.toThrow(/价格/);
});

it.each(["queued", "failed"] as const)("keeps %s historical jobs readable but blocks export and retry before FFmpeg", async (status) => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-price-only-"));
  const store = new JobStore(path.join(directory, "jobs"));
  const template = materializePlan(plan, "black-gold", dimensions, {} as StickerAssets, options);
  delete template.productPrice;
  if (template.layers[0].type === "text") template.layers[0].content = "细节之美";
  const id = crypto.randomUUID();
  const mediaId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const batch = ExportBatchSchema.parse({
    schemaVersion: 2, id, templateSnapshot: template, mediaIds: [mediaId],
    mediaSnapshots: [{ id: mediaId, ...dimensions, sourcePath: path.join(directory, "source.mp4"), displayName: "source", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, rotation: 0, probeStatus: "ready", importedAt: timestamp }],
    outputDirectory: directory, preset: DEFAULT_PRESET, status: status === "queued" ? "active" : "completed_with_errors", estimatedBytes: 1, createdAt: timestamp,
    tasks: [{ id: crypto.randomUUID(), batchId: id, mediaId, status, progress: 0, attempt: 1, outputPath: path.join(directory, "out.mp4"), createdAt: timestamp, attempts: [] }],
  });
  await store.save({ schemaVersion: 2, revision: 1, batch, updatedAt: timestamp });
  const run = vi.fn();
  const queue = new ExportQueue({ jobStore: store, ffmpeg: { run } as unknown as FfmpegAdapter, fontResolver: { resolve: async () => null } });
  expect((await queue.recover()).batches[0].batch.templateSnapshot.layers).toEqual(template.layers);
  await expect(queue.createBatch({ template, mediaIds: [mediaId], mediaItems: batch.mediaSnapshots!, outputDirectory: directory, preset: DEFAULT_PRESET })).rejects.toThrow(/重新制作/);
  if (status === "failed") {
    const before = queue.snapshot();
    await expect(queue.retry([batch.tasks[0].id])).rejects.toThrow(/重新制作/);
    expect(queue.snapshot()).toEqual(before);
  } else {
    expect(queue.snapshot().batches[0].batch.tasks[0].status).toBe("interrupted");
    await queue.start(id);
    expect(queue.snapshot().batches[0].batch.tasks[0].status).toBe("interrupted");
    await expect(queue.retry([batch.tasks[0].id])).rejects.toThrow(/重新制作/);
  }
  expect(run).not.toHaveBeenCalled();
});
