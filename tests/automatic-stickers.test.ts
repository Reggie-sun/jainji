import { describe, expect, it } from "vitest";
import { AUTOMATIC_STICKERS, isAutomaticStickerAllowed } from "../src/shared/automatic-stickers";
import { LIBRARY_STICKERS } from "../src/shared/asset-library";
import { BUNDLED_STICKERS } from "../src/shared/bundled-stickers";

describe("automatic sticker eligibility", () => {
  it("allows reviewed pinned illustrations and rejects unreviewed or textual assets", () => {
    expect(AUTOMATIC_STICKERS.length).toBe(55);
    expect(new Set(AUTOMATIC_STICKERS.map(({ id }) => id)).size).toBe(55);
    for (const entry of AUTOMATIC_STICKERS) {
      expect(isAutomaticStickerAllowed(entry.id)).toBe(true);
      if (entry.id.startsWith("fluent-")) expect(LIBRARY_STICKERS.some(({ id }) => id === entry.id)).toBe(true);
    }
    for (const entry of BUNDLED_STICKERS) expect(isAutomaticStickerAllowed(entry.id)).toBe(false);
    for (const entry of LIBRARY_STICKERS.filter(({ url }) => /Hundred%20points|Japanese%20discount|Money%20bag/.test(url))) expect(isAutomaticStickerAllowed(entry.id)).toBe(false);
    expect(isAutomaticStickerAllowed("unreviewed")).toBe(false);
  });
});
