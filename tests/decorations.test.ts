import { describe, it, expect } from "vitest";
import { materializePlan } from "../src/main/agent-provider";
import { DecorationSchema } from "../src/shared/decorations";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";

const assets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: id }])) as BuiltinStickerAssets;
const plan = { summary: "测试", captions: [{ text: "好物推荐", size: 0.026, corner: "top-left" }], filter: "warm", intensity: 0.4 };
describe("selected decorations", () => {
  it("uses selected font and sticker instead of template defaults", () => {
    const template = materializePlan(plan, "black-gold", { width: 720, height: 1280 }, assets, { sticker: "heart", fontFamily: "Noto Serif CJK SC" });
    expect(template.layers[0]).toMatchObject({ fontFamily: "Noto Serif CJK SC" });
    expect(template.layers[1]).toMatchObject({ assetPath: "/tmp/heart.png", width: 0.12, y: 0.8 });
  });
  it("removes stickers when disabled and preserves old requests", () => {
    expect(materializePlan(plan, "black-gold", { width: 720, height: 1280 }, assets, DecorationSchema.parse({ sticker: "none" })).layers.map((layer) => layer.type)).toEqual(["text"]);
    expect(materializePlan(plan, "black-gold", { width: 720, height: 1280 }, assets).layers[1]).toMatchObject({ assetPath: "/tmp/sparkle.png" });
    expect(() => DecorationSchema.parse({ sticker: "/tmp/arbitrary.png" })).toThrow();
    expect(() => DecorationSchema.parse({ fontFamily: "/tmp/arbitrary.ttf" })).toThrow();
  });
  it("accepts a bundled Chinese sticker while retaining corner-safe template geometry", () => {
    const localAssets = { ...assets, "local-limited-discount": { assetPath: "/tmp/limited-discount.png", assetFingerprint: "sha256:local" } };
    const decorations = DecorationSchema.parse({ sticker: "local-limited-discount" });
    const template = materializePlan(plan, "black-gold", { width: 720, height: 1280 }, localAssets, decorations);
    expect(template.layers[1]).toMatchObject({ assetPath: "/tmp/limited-discount.png", width: 0.12, x: 0.84, y: 0.8 });
  });
  it("materializes independently selected corner decorations and reserves explicit corners", () => {
    const template = materializePlan(plan, "black-gold", { width: 720, height: 1280 }, assets, DecorationSchema.parse({
      corners: {
        "top-left": { type: "sticker", sticker: "heart" },
        "top-right": { type: "text", text: "¥99", fontFamily: "Noto Serif CJK SC" },
        "bottom-left": { type: "none" },
        "bottom-right": { type: "text", text: "限时", fontFamily: "Noto Sans CJK SC" },
      },
    }));
    expect(template.layers).toHaveLength(3);
    expect(template.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "sticker", assetPath: "/tmp/heart.png", x: 0.04, y: 0.04 }),
      expect.objectContaining({ type: "text", content: "¥99", fontFamily: "Noto Serif CJK SC", x: 0.54, y: 0.04 }),
      expect.objectContaining({ type: "text", content: "限时", fontFamily: "Noto Sans CJK SC", x: 0.54, y: 0.9 }),
    ]));
    expect(template.layers.map((layer) => layer.type === "text" ? layer.content : layer.assetPath)).not.toEqual(expect.arrayContaining(["好物推荐"]));
  });
  it("does not place automatic stickers in explicitly empty corners", () => {
    const template = materializePlan({ ...plan, captions: [{ text: "今日", size: 0.026, corner: "top-right" }] }, "black-gold", { width: 720, height: 1280 }, assets, DecorationSchema.parse({
      corners: { "bottom-right": { type: "none" } },
    }));
    expect(template.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "sticker", assetPath: "/tmp/sparkle.png", x: 0.04, y: 0.8 }),
    ]));
  });
  it("keeps four explicit stickers within the corner-safe policy", () => {
    const template = materializePlan({ ...plan, filter: "vivid", intensity: 0.6 }, "electric", { width: 720, height: 1280 }, assets, DecorationSchema.parse({
      corners: {
        "top-left": { type: "sticker", sticker: "sparkle" },
        "top-right": { type: "sticker", sticker: "arrow" },
        "bottom-left": { type: "sticker", sticker: "heart" },
        "bottom-right": { type: "sticker", sticker: "burst" },
      },
    }));
    expect(template.layers).toHaveLength(4);
    expect(template.layers.every((layer) => layer.type === "sticker")).toBe(true);
    expect(template.layers.map((layer) => layer.zIndex)).toEqual([0, 1, 2, 3]);
  });
  it("rejects invalid manual corner selections", () => {
    expect(() => DecorationSchema.parse({ corners: { "top-left": { type: "sticker", sticker: "template" } } })).toThrow();
    expect(() => DecorationSchema.parse({ corners: { "top-left": { type: "sticker", sticker: "unknown" } } })).toThrow();
    expect(() => DecorationSchema.parse({ corners: { "top-left": { type: "text", text: "限时", fontFamily: "unknown" } } })).toThrow();
    expect(() => DecorationSchema.parse({ corners: { "top-left": { type: "text", text: "  ", fontFamily: "Noto Sans CJK SC" } } })).toThrow();
    expect(() => DecorationSchema.parse({ corners: { "top-left": { type: "text", text: "限\n时", fontFamily: "Noto Sans CJK SC" } } })).toThrow();
    expect(() => DecorationSchema.parse({ corners: { centre: { type: "none" } } })).toThrow();
  });
  it("fails closed when an explicit sticker asset is unavailable", () => {
    const missingHeart = { ...assets, heart: undefined } as unknown as BuiltinStickerAssets;
    expect(() => materializePlan(plan, "black-gold", { width: 720, height: 1280 }, missingHeart, DecorationSchema.parse({
      corners: { "top-left": { type: "sticker", sticker: "heart" } },
    }))).toThrow("所选贴纸尚未下载");
  });
});
