import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { fingerprintFile } from "../src/main/paths";
import { ensureBuiltinFrameAssets } from "../src/main/builtin-frames";

describe("built-in Agent stickers", () => {
  it("generates three immutable full-perimeter frame assets and refuses corrupt replacements", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-frames-"));
    try {
      const first = await ensureBuiltinFrameAssets(directory);
      expect(Object.keys(first).sort()).toEqual(["frame-confetti", "frame-hearts", "frame-stars"]);
      expect(await ensureBuiltinFrameAssets(directory)).toEqual(first);
      for (const asset of Object.values(first)) {
        const png = await readFile(asset.assetPath);
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([720, 1280]);
        expect(await fingerprintFile(asset.assetPath)).toBe(asset.assetFingerprint);
      }
      await writeFile(first["frame-stars"].assetPath, "corrupted");
      await expect(ensureBuiltinFrameAssets(directory)).rejects.toThrow();
      expect(await readFile(first["frame-stars"].assetPath, "utf8")).toBe("corrupted");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
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
