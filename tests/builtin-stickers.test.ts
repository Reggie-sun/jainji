import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { fingerprintFile } from "../src/main/paths";

describe("built-in Agent stickers", () => {
  it("materializes four stable PNG resources with matching fingerprints", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-stickers-"));
    try {
      const first = await ensureBuiltinStickerAssets(directory);
      await writeFile(first.sparkle.assetPath, "corrupted");
      const second = await ensureBuiltinStickerAssets(directory);
      expect(second).toEqual(first);
      expect(Object.keys(first).sort()).toEqual(["arrow", "burst", "heart", "sparkle"]);
      for (const asset of Object.values(first)) {
        expect(path.isAbsolute(asset.assetPath)).toBe(true);
        expect((await readFile(asset.assetPath)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(await fingerprintFile(asset.assetPath)).toBe(asset.assetFingerprint);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
