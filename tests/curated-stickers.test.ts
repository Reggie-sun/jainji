import { describe, expect, it } from "vitest";
import { CURATED_STICKERS, STICKER_SELECTION } from "../src/shared/curated-stickers";
import { LIBRARY_STICKERS } from "../src/shared/asset-library";
import { DecorationSchema } from "../src/shared/decorations";

describe("commerce video sticker selection", () => {
  it("resolves every approved concept exactly once with localized search terms", () => {
    expect(CURATED_STICKERS).toHaveLength(56);
    expect(CURATED_STICKERS.length).toBe(STICKER_SELECTION.length);
    expect(new Set(CURATED_STICKERS.map((asset) => asset.id)).size).toBe(CURATED_STICKERS.length);
    expect(CURATED_STICKERS.every((asset) => /[\u4e00-\u9fff]/.test(asset.label) && asset.searchTerms.length > 0)).toBe(true);
    expect(CURATED_STICKERS.some((asset) => asset.label === "蝴蝶")).toBe(true);
    for (const category of ["促销", "指引", "强调", "轻装饰", "正向情绪"]) {
      expect(CURATED_STICKERS.some((asset) => asset.searchTerms.includes(category))).toBe(true);
    }
  });
  it("excludes irrelevant concepts and duplicate skin variants from discovery", () => {
    expect(CURATED_STICKERS.length).toBeLessThan(100);
    expect(CURATED_STICKERS.some((asset) => /\/Dark\/|\/Light\/|\/Medium|Flag|Anatomical|Firefighter|Bow%20and%20arrow/.test(asset.url))).toBe(false);
    expect(CURATED_STICKERS.filter((asset) => asset.searchTerms.includes("Thumbs up"))).toHaveLength(1);
  });
  it("keeps hidden legacy IDs valid without offering them for new selection", () => {
    const hidden = LIBRARY_STICKERS.find((asset) => !CURATED_STICKERS.some((visible) => visible.id === asset.id))!;
    expect(hidden).toBeDefined();
    expect(DecorationSchema.parse({ sticker: hidden.id }).sticker).toBe(hidden.id);
    expect(LIBRARY_STICKERS).toHaveLength(3144);
  });
});
