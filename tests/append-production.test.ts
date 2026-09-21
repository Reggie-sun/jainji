import { describe, expect, it } from "vitest";
import { AppendProductionSchema } from "../src/shared/agent";
import { appendTemplateDigest, assertPriceOnlyTemplate, cloneTemplateForAppend, createDefaultTemplate, EditTemplateSchema } from "../src/main/domain";
import { materializePlan } from "../src/main/agent-provider";
import { formatProductPrice } from "../src/shared/decorations";
import type { StickerAssets } from "../src/main/builtin-stickers";

describe("AppendProductionSchema", () => {
  const valid = { batchId: crypto.randomUUID(), count: 2, productPrice: "19.9元拍一发三", outputDirectory: "/tmp/out" };
  it("accepts a valid append request", () => {
    expect(AppendProductionSchema.parse(valid)).toEqual(valid);
  });
  it.each([
    ["non-uuid batchId", { ...valid, batchId: "not-a-uuid" }],
    ["count 0", { ...valid, count: 0 }],
    ["count above 250", { ...valid, count: 251 }],
    ["fractional count", { ...valid, count: 1.5 }],
    ["blank display text", { ...valid, productPrice: "" }],
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
