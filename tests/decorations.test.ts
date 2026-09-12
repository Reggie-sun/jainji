import { describe, expect, it } from "vitest";
import { materializePlan } from "../src/main/agent-provider";
import { DecorationSchema } from "../src/shared/decorations";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";

const assets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: id }])) as BuiltinStickerAssets;
const plan = { summary: "测试", captions: [], filter: "warm", intensity: 0.4 };

describe("selected decorations", () => {
  it("uses selected stickers and never materializes decorative text", () => {
    const template = materializePlan(plan, "black-gold", { width: 720, height: 1280 }, assets, { sticker: "heart", productPrice: "19.90" });
    expect(template.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "sticker", assetPath: "/tmp/heart.png", width: 0.12, y: 0.8 }),
      expect.objectContaining({ type: "text", content: "¥ 19.90", textAlign: "center" }),
    ]));
    expect(template.layers.filter((layer) => layer.type === "text")).toHaveLength(1);
  });

  it("removes automatic stickers when disabled while preserving a missing-price draft", () => {
    expect(materializePlan(plan, "black-gold", { width: 720, height: 1280 }, assets, DecorationSchema.parse({ sticker: "none" })).layers).toEqual([]);
    expect(() => DecorationSchema.parse({ sticker: "/tmp/arbitrary.png" })).toThrow();
    expect(() => DecorationSchema.parse({ fontFamily: "/tmp/arbitrary.ttf" })).toThrow();
  });

  it("materializes independently selected sticker corners and reserves explicit corners", () => {
    const template = materializePlan(plan, "black-gold", { width: 720, height: 1280 }, assets, DecorationSchema.parse({
      corners: {
        "top-left": { type: "sticker", sticker: "heart" },
        "top-right": { type: "sticker", sticker: "arrow" },
        "bottom-left": { type: "none" },
        "bottom-right": { type: "sticker", sticker: "burst" },
      },
    }));
    expect(template.layers).toHaveLength(3);
    expect(template.layers.every((layer) => layer.type === "sticker")).toBe(true);
    expect(template.layers.map((layer) => layer.type === "sticker" && layer.assetPath)).toEqual(["/tmp/heart.png", "/tmp/arrow.png", "/tmp/burst.png"]);
  });

  it("rejects manual corner text and invalid sticker choices", () => {
    expect(() => DecorationSchema.parse({ corners: { "top-left": { type: "text", text: "细节之美", fontFamily: "Noto Sans CJK SC" } } })).toThrow();
    expect(() => DecorationSchema.parse({ corners: { "top-left": { type: "sticker", sticker: "template" } } })).toThrow();
    expect(() => DecorationSchema.parse({ corners: { "top-left": { type: "sticker", sticker: "unknown" } } })).toThrow();
    expect(() => DecorationSchema.parse({ corners: { centre: { type: "none" } } })).toThrow();
  });

  it("fails closed when a selected sticker asset is unavailable", () => {
    const missingHeart = { ...assets, heart: undefined } as unknown as BuiltinStickerAssets;
    expect(() => materializePlan(plan, "black-gold", { width: 720, height: 1280 }, missingHeart, DecorationSchema.parse({
      corners: { "top-left": { type: "sticker", sticker: "heart" } },
    }))).toThrow("所选贴纸尚未下载");
  });
});
