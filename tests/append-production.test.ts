import { describe, expect, it } from "vitest";
import { AppendProductionSchema } from "../src/shared/agent";
import { appendTemplateDigest, assertPriceOnlyTemplate, BalancedStickerPicker, cloneTemplateForAppend, cloneTemplateForRandom, createDefaultTemplate, EditTemplateSchema, randomTemplateDigest, RANDOM_FILTER_POOL, type RandomStickerPoolEntry } from "../src/main/domain";
import { materializePlan } from "../src/main/agent-provider";
import { formatProductPrice } from "../src/shared/decorations";
import type { StickerAssets } from "../src/main/builtin-stickers";

it("chooses a new frame only for a new random append and keeps frozen/manual frame identity", () => {
  const asset = { assetPath: "/tmp/frame.png", assetFingerprint: "fixture" };
  const source = materializePlan({ summary: "包装", captions: [], filter: "cool", intensity: .3 }, "clean", { width: 720, height: 1280 },
    { sparkle: asset, heart: asset, arrow: asset, burst: asset, "frame-stars": asset }, { frameId: "frame-stars", frame: { mode: "random" }, sticker: "heart", productPrice: "测试" });
  const picker = new BalancedStickerPicker([{ id: "heart", ...asset }]);
  const framePicker = new BalancedStickerPicker([{ id: "frame-hearts", assetPath: "/tmp/new-frame.png", assetFingerprint: "new" }]);
  const appended = cloneTemplateForRandom(source, "新内容", picker, framePicker);
  expect(appended.layers.find(l => l.type === "sticker" && l.frame)).toMatchObject({ frame: { id: "frame-hearts", selection: "random" }, assetPath: "/tmp/new-frame.png" });
  expect(source.layers.find(l => l.type === "sticker" && l.frame)).toMatchObject({ frame: { id: "frame-stars" }, assetPath: "/tmp/frame.png" });
  expect(cloneTemplateForAppend(source, "新内容").layers.find(l => l.type === "sticker" && l.frame)).toMatchObject({ frame: { id: "frame-stars" } });
  expect(() => cloneTemplateForRandom(source, "新内容", picker)).toThrow("边框");
  expect(randomTemplateDigest(appended)).toBe(randomTemplateDigest(source));
});

it("retains frozen frame bytes through manual and random append while changing ordinary stickers", () => {
  const asset = { assetPath: "/tmp/frame.png", assetFingerprint: `sha256:${"b".repeat(64)}` };
  const source = materializePlan({ summary: "边框", captions: [], filter: "cool", intensity: .3 }, "clean", { width: 720, height: 1280 },
    { sparkle: asset, heart: asset, arrow: asset, burst: asset, "frame-stars": asset }, { frameId: "frame-stars", sticker: "heart", productPrice: "测试" });
  const frame = source.layers.find(layer => layer.type === "sticker" && layer.frame)!;
  const picked = { id: "arrow", assetPath: "/tmp/arrow.png", assetFingerprint: "changed" };
  for (const cloned of [cloneTemplateForAppend(source, "新内容"), cloneTemplateForRandom(source, "新内容", new BalancedStickerPicker([picked]))]) {
    expect(cloned.layers.find(layer => layer.type === "sticker" && layer.frame)).toEqual({ ...frame, id: expect.any(String) });
  }
});

describe("AppendProductionSchema", () => {
  const valid = { batchId: crypto.randomUUID(), count: 2, productPrice: "19.9元拍一发三", outputDirectory: "/tmp/out" };
  it("accepts a valid append request", () => {
    expect(AppendProductionSchema.parse(valid)).toEqual(valid);
  });
  it("allows empty text for authoritative source-template validation", () => {
    expect(AppendProductionSchema.parse({ ...valid, productPrice: "" }).productPrice).toBe("");
  });
  it.each([
    ["non-uuid batchId", { ...valid, batchId: "not-a-uuid" }],
    ["count 0", { ...valid, count: 0 }],
    ["count above 250", { ...valid, count: 251 }],
    ["fractional count", { ...valid, count: 1.5 }],
    ["line over 12 chars", { ...valid, productPrice: "一二三四五六七八九十一二三" }],
    ["three lines", { ...valid, productPrice: "一\n二\n三" }],
    ["blank middle line", { ...valid, productPrice: "一\n \n二" }],
    ["empty output directory", { ...valid, outputDirectory: "" }],
    ["unexpected key", { ...valid, extra: true }],
  ])("rejects %s", (_label, input) => {
    expect(AppendProductionSchema.safeParse(input).success).toBe(false);
  });
});

const dimensions = { width: 720, height: 1280 };
const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: "fixture" }])) as unknown as StickerAssets;
const automaticCatalog = { fonts: [], stickers: [{ id: "heart", label: "爱心" }] };
const pricedTemplate = (productPrice: string) => materializePlan(
  { summary: "测试方案", captions: [], filter: "warm", intensity: 0.4, priceStyle: "classic", stickers: [
    { corner: "top-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
    { corner: "top-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
    { corner: "bottom-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
    { corner: "bottom-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
  ] },
  "black-gold", dimensions, stickerAssets, { mode: "agent", productPrice, sticker: "none" }, automaticCatalog,
);

// Regression: ISSUE-001 — appending a text-disabled batch required a text layer.
// Found by /qa on 2026-10-05.
// Report: .agent/harness/runs/20261005-qa/qa-report.md
describe("text-disabled append clones", () => {
  const pool = [{ id: "heart", ...stickerAssets.heart }];
  const clone = (source: ReturnType<typeof pricedTemplate>, text: string, random: boolean) => random
    ? cloneTemplateForRandom(source, text, new BalancedStickerPicker(pool))
    : cloneTemplateForAppend(source, text);
  it.each([false, true])("preserves explicit text-off settings (random=%s)", (random) => {
    const source = pricedTemplate("原文字");
    source.displayText = { enabled: false, x: 0.5, y: 0.13 };
    source.layers = source.layers.filter((layer) => layer.type !== "text");
    delete source.productPrice;
    const before = structuredClone(source);
    for (const input of ["", "不会新增文字"]) {
      const cloned = clone(source, input, random);
      expect(cloned.id).not.toBe(source.id);
      expect(cloned.displayText).toEqual(source.displayText);
      expect(cloned.layers.some((layer) => layer.type === "text")).toBe(false);
      expect(cloned).not.toHaveProperty("productPrice");
      expect(random ? randomTemplateDigest(cloned) : appendTemplateDigest(cloned)).toBe(random ? randomTemplateDigest(source) : appendTemplateDigest(source));
      expect(() => assertPriceOnlyTemplate(cloned)).not.toThrow();
    }
    expect(source).toEqual(before);
  });
  it.each([false, true])("rejects inconsistent text-off sources and empty text-on input (random=%s)", (random) => {
    const source = pricedTemplate("原文字");
    expect(() => clone(source, "", random)).toThrow();
    source.displayText = { enabled: false, x: 0.5, y: 0.13 };
    expect(() => clone(source, "追加文字", random)).toThrow(/关闭展示文字/);
    source.layers = source.layers.filter((layer) => layer.type !== "text");
    expect(() => clone(source, "追加文字", random)).toThrow(/关闭展示文字/);
  });
});

describe("cloneTemplateForAppend", () => {
  it("regenerates every id, swaps only the display text, and proves the rest byte-identical", () => {
    const source = pricedTemplate("19.9元拍一发三");
    const cloned = cloneTemplateForAppend(source, "29.9元\n第二件半价");
    expect(cloned.id).not.toBe(source.id);
    expect(cloned.productPrice).toBe("29.9元\n第二件半价");
    const sourceIds = source.layers.map((layer) => layer.id);
    const clonedIds = cloned.layers.map((layer) => layer.id);
    expect(new Set(clonedIds).size).toBe(cloned.layers.length);
    for (const id of clonedIds) expect(sourceIds).not.toContain(id);
    const sourceText = source.layers.find((layer) => layer.type === "text");
    const clonedText = cloned.layers.find((layer) => layer.type === "text");
    if (clonedText?.type !== "text") throw new Error("missing text layer");
    expect(clonedText.content).toBe(formatProductPrice("29.9元\n第二件半价"));
    expect(clonedText.id).not.toBe(sourceText?.id);
    expect(appendTemplateDigest(cloned)).toBe(appendTemplateDigest(source));
    expect(() => EditTemplateSchema.parse(cloned)).not.toThrow();
    expect(() => assertPriceOnlyTemplate(cloned)).not.toThrow();
  });

  it("formats pure numeric lines with the yen prefix", () => {
    const cloned = cloneTemplateForAppend(pricedTemplate("原价 99"), "19.9");
    const text = cloned.layers.find((layer) => layer.type === "text");
    if (text?.type !== "text") throw new Error("missing text layer");
    expect(text.content).toBe("¥ 19.9");
    expect(cloned.productPrice).toBe("19.9");
  });

  it("rejects invalid display text before touching the template", () => {
    expect(() => cloneTemplateForAppend(pricedTemplate("19.9元拍一发三"), "")).toThrow();
  });

  it("rejects sources without exactly one text layer", () => {
    expect(() => cloneTemplateForAppend(createDefaultTemplate(), "19.9元拍一发三")).toThrow(/展示文字层/);
  });

  it("pins the digest to preserved fields so geometry, filter, and layer-order drift cannot escape", () => {
    const source = pricedTemplate("19.9元拍一发三");
    const cloned = cloneTemplateForAppend(source, "29.9元\n第二件半价");
    expect(appendTemplateDigest(cloned)).toBe(appendTemplateDigest(source));
    const geometryDrift = structuredClone(cloned);
    const sticker = geometryDrift.layers.find((layer) => layer.type === "sticker");
    if (sticker?.type !== "sticker") throw new Error("missing sticker layer");
    sticker.x += 0.01;
    expect(appendTemplateDigest(geometryDrift)).not.toBe(appendTemplateDigest(cloned));
    const filterDrift = structuredClone(cloned);
    filterDrift.filter = { ...filterDrift.filter, intensity: filterDrift.filter.intensity + 0.1 };
    expect(appendTemplateDigest(filterDrift)).not.toBe(appendTemplateDigest(cloned));
    const reordered = structuredClone(cloned);
    reordered.layers.reverse();
    expect(appendTemplateDigest(reordered)).not.toBe(appendTemplateDigest(cloned));
  });
});

describe("cloneTemplateForRandom", () => {
  const randomPool: RandomStickerPoolEntry[] = [
    { id: "sparkle", assetPath: "/tmp/sparkle.png", assetFingerprint: "fp-sparkle" },
    { id: "arrow", assetPath: "/tmp/arrow.png", assetFingerprint: "fp-arrow" },
    { id: "heart", assetPath: "/tmp/heart.png", assetFingerprint: "fp-heart" },
    { id: "burst", assetPath: "/tmp/burst.png", assetFingerprint: "fp-burst" },
    { id: "star", assetPath: "/tmp/star.png", assetFingerprint: "fp-star" },
    { id: "flower", assetPath: "/tmp/flower.png", assetFingerprint: "fp-flower" },
  ];

  it("randomizes stickers and filter while freezing geometry", () => {
    const source = pricedTemplate("19.9元拍一发三");
    const picker = new BalancedStickerPicker(randomPool);
    const cloned = cloneTemplateForRandom(source, "29.9元\n第二件半价", picker);
    expect(cloned.id).not.toBe(source.id);
    expect(cloned.productPrice).toBe("29.9元\n第二件半价");
    const text = cloned.layers.find((layer) => layer.type === "text");
    if (text?.type !== "text") throw new Error("missing text layer");
    expect(text.content).toBe(formatProductPrice("29.9元\n第二件半价"));
    for (const layer of cloned.layers) {
      if (layer.type !== "sticker") continue;
      expect(randomPool.some((entry) => entry.assetFingerprint === layer.assetFingerprint)).toBe(true);
    }
    expect(RANDOM_FILTER_POOL).toContain(cloned.filter.presetId);
    expect(randomTemplateDigest(cloned)).toBe(randomTemplateDigest(source));
    expect(() => EditTemplateSchema.parse(cloned)).not.toThrow();
    expect(() => assertPriceOnlyTemplate(cloned)).not.toThrow();
  });

  it("produces different sticker combinations across clones", () => {
    const source = pricedTemplate("19.9元拍一发三");
    const picker = new BalancedStickerPicker(randomPool);
    const first = cloneTemplateForRandom(source, "19.9元拍一发三", picker);
    const second = cloneTemplateForRandom(source, "19.9元拍一发三", picker);
    const firstPrints = first.layers.filter((l) => l.type === "sticker").map((l) => l.type === "sticker" ? l.assetFingerprint : "");
    const secondPrints = second.layers.filter((l) => l.type === "sticker").map((l) => l.type === "sticker" ? l.assetFingerprint : "");
    expect(firstPrints).not.toEqual(secondPrints);
  });

  it("rejects an empty sticker pool", () => {
    const source = pricedTemplate("19.9元拍一发三");
    expect(() => new BalancedStickerPicker([])).toThrow(/贴纸/);
    expect(() => cloneTemplateForRandom(source, "19.9元", new BalancedStickerPicker(randomPool))).not.toThrow();
  });

  it("rejects sources without exactly one text layer", () => {
    const picker = new BalancedStickerPicker(randomPool);
    expect(() => cloneTemplateForRandom(createDefaultTemplate(), "19.9元拍一发三", picker)).toThrow(/展示文字层/);
  });
});
