import { describe, expect, it } from "vitest";
import { AUTOMATIC_STICKERS, isAutomaticStickerAllowed } from "../src/shared/automatic-stickers";
import { LIBRARY_STICKERS } from "../src/shared/asset-library";
import { BUNDLED_STICKERS } from "../src/shared/bundled-stickers";
import { CURATED_STICKERS } from "../src/shared/curated-stickers";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { AssetLibrary } from "../src/main/asset-library";
import { tmpdir } from "node:os";
import path from "node:path";

describe("automatic sticker eligibility", () => {
  it("allows reviewed pinned illustrations and rejects unreviewed or textual assets", () => {
    expect(AUTOMATIC_STICKERS.length).toBe(97);
    expect(new Set(AUTOMATIC_STICKERS.map(({ id }) => id)).size).toBe(97);
    for (const entry of AUTOMATIC_STICKERS) {
      expect(isAutomaticStickerAllowed(entry.id)).toBe(true);
      if (entry.id.startsWith("fluent-")) expect(LIBRARY_STICKERS.some(({ id }) => id === entry.id)).toBe(true);
    }
    for (const entry of BUNDLED_STICKERS) expect(isAutomaticStickerAllowed(entry.id)).toBe(false);
    for (const entry of LIBRARY_STICKERS.filter(({ url }) => /Hundred%20points|Japanese%20discount|Money%20bag/.test(url))) expect(isAutomaticStickerAllowed(entry.id)).toBe(false);
    expect(isAutomaticStickerAllowed("unreviewed")).toBe(false);
  });

  it("ships every reviewed choice with pinned bytes and exposes new commerce choices offline", async () => {
    for (const entry of AUTOMATIC_STICKERS.filter(({ id }) => id.startsWith("fluent-"))) {
      const asset = LIBRARY_STICKERS.find(({ id }) => id === entry.id)!;
      const bytes = await readFile(path.join("resources/sticker-library", `${asset.blob}.png`));
      expect(bytes.length).toBe(asset.size);
      expect(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")).toBe(asset.blob);
      expect(CURATED_STICKERS.some(({ id }) => id === entry.id)).toBe(true);
    }
    const root = await mkdtemp(path.join(tmpdir(), "jianji-commerce-stickers-"));
    const library = new AssetLibrary(root, async () => { throw new Error("No downloads expected for bundled stickers"); });
    for (const label of ["上升火箭", "双手比心", "星光魔法棒", "粉色莲花", "缤纷彩虹"]) {
      const asset = CURATED_STICKERS.find((entry) => entry.label === label)!;
      expect(isAutomaticStickerAllowed(asset.id)).toBe(true);
      expect((await library.ensure(asset.id)).assetFingerprint).toMatch(/^sha256:/);
    }
  });
});
