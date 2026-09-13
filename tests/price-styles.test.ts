import { describe, expect, it } from "vitest";
import { DecorationSchema } from "../src/shared/decorations";
import { PRICE_STYLES, type PriceStyle } from "../src/shared/price-styles";
import { RULE_TEMPLATES, RuleIdSchema } from "../src/shared/agent";
import { materializePlan } from "../src/main/agent-provider";
import { assertPriceOnlyTemplate, DEFAULT_PRESET, EditTemplateSchema, type MediaItem } from "../src/main/domain";
import { TemplateCompiler } from "../src/main/compiler";
import type { StickerAssets } from "../src/main/builtin-stickers";

const media: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 900, height: 1600, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
const plan = { summary: "手动价格", captions: [], filter: "warm", intensity: 0.4 };
const sticker = { assetPath: "/tmp/sticker.png", assetFingerprint: "fixture" };
const assets: StickerAssets = { sparkle: sticker, arrow: sticker, heart: sticker, burst: sticker };

describe("local price styles", () => {
  it("keeps old drafts compatible and rejects unknown styles in either mode", () => {
    expect(DecorationSchema.parse({ productPrice: "19.90" }).priceStyle).toBeUndefined();
    for (const mode of ["manual", "agent"]) {
      expect(() => DecorationSchema.parse({ mode, productPrice: "19.90", priceStyle: "unknown" })).toThrow();
      expect(DecorationSchema.parse({ mode, productPrice: "19.90", priceStyle: "comic" })).toMatchObject({ productPrice: "19.90", priceStyle: "comic" });
    }
  });

  it.each(PRICE_STYLES)("freezes $id into exactly one local price layer and compiles its effects", async (entry) => {
    const style: PriceStyle = entry;
    const template = materializePlan(plan, "black-gold", media, assets, { productPrice: "19.9元30贴", sticker: "none", priceStyle: style.id });
    assertPriceOnlyTemplate(template);
    expect(template.layers).toHaveLength(1);
    const layer = template.layers[0];
    expect(layer).toMatchObject({ type: "text", content: "19.9元30贴", color: style.color, strokeColor: style.strokeColor, textAlign: "center", x: 0.1, y: 0.13, width: 0.8 });
    expect(EditTemplateSchema.parse(JSON.parse(JSON.stringify(template)))).toEqual(template);
    const compiled = await new TemplateCompiler().compile(template, media, { ...DEFAULT_PRESET, resolutionMode: "source" }, { ffmpegPath: "ffmpeg", fontResolver: { resolve: async () => "/tmp/font.ttf" }, textFilePath: () => "/tmp/price.txt" });
    expect(compiled.textFiles.map((file) => file.content)).toEqual(["19.9元30贴"]);
    const graph = compiled.args[compiled.args.indexOf("-filter_complex") + 1];
    expect(graph.match(/drawtext=/g)).toHaveLength(1);
    if (style.shadow) expect(graph).toContain(`shadowx=${Math.round(style.shadow.xRatio * media.height)}`);
    if (style.backgroundColor) expect(graph).toContain("box=1");
    const auto = materializePlan({ ...plan, stickers: [] }, "black-gold", media, assets, { mode: "agent", productPrice: "19.9元30贴", priceStyle: style.id }, { fonts: [], stickers: [] });
    expect(auto.layers[0]).toMatchObject({ color: style.color, content: "19.9元30贴" });
    expect(materializePlan(plan, "black-gold", media, assets, { sticker: "none", priceStyle: style.id }).layers).toEqual([]);
  });

  it("accepts and materializes every template through the canonical rule registry", () => {
    expect(new Set(RULE_TEMPLATES.map((rule) => rule.id)).size).toBeGreaterThanOrEqual(12);
    for (const rule of RULE_TEMPLATES) {
      expect(RuleIdSchema.parse(rule.id)).toBe(rule.id);
      const template = materializePlan({ summary: rule.name, captions: [], filter: rule.filters[0], intensity: rule.minIntensity }, rule.id, media, assets, { productPrice: "19.90", sticker: "none" });
      assertPriceOnlyTemplate(template);
      expect(template.filter.presetId).toBe(rule.filters[0]);
    }
  });
});
