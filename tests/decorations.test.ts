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
});
