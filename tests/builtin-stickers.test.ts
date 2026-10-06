import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeRgbaPng, ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { fingerprintFile } from "../src/main/paths";
import { ensureBuiltinFrameAssets } from "../src/main/builtin-frames";
import { assertDecorationFrameOptions, createDecorationFrameResolver } from "../src/main/decoration-frame";
import { FrameIdSchema } from "../src/shared/frames";
import { DecorationSchema } from "../src/shared/decorations";
import type { StickerAssets } from "../src/main/builtin-stickers";

describe("built-in Agent stickers", () => {
  it("generates thirteen restrained transparent commerce frames and admits the full random pool", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-frames-"));
    try {
      const historicalBytes = encodeRgbaPng(new Uint8Array([80, 60, 40, 255]), 1, 1);
      const historicalHash = createHash("sha256").update(historicalBytes).digest("hex");
      const historicalPath = path.join(directory, `frame-stars-${historicalHash}.png`);
      await writeFile(historicalPath, historicalBytes);
      const first = await ensureBuiltinFrameAssets(directory);
      expect(first["frame-stars"].assetPath).not.toBe(historicalPath);
      expect(await readFile(historicalPath)).toEqual(historicalBytes);
      await expect(assertDecorationFrameOptions({ frame: { mode: "random" } }, first as StickerAssets)).resolves.toBeUndefined();
      await expect(assertDecorationFrameOptions({ frame: { mode: "auto" } }, first as StickerAssets)).resolves.toBeUndefined();
      expect(Object.keys(first)).toHaveLength(13);
      expect(new Set(Object.values(first).map(asset => asset.assetFingerprint)).size).toBe(13);
      expect(first["frame-stars"].assetFingerprint).not.toBe("sha256:d3e24a0d294f2e3292cc458fd8c4b40037e801e909527e6540f4fd3c42806e5b");
      const resolve = createDecorationFrameResolver(DecorationSchema.parse({ mode: "agent", frame: { mode: "random" } }), first as StickerAssets);
      expect(new Set(Array.from({ length: 13 }, () => resolve("source").frameId))).toEqual(new Set(Object.keys(first)));
      expect(await ensureBuiltinFrameAssets(directory)).toEqual(first);
      expect(await readFile(historicalPath)).toEqual(historicalBytes);
      for (const [id, asset] of Object.entries(first)) {
        expect(FrameIdSchema.parse(id)).toBe(id);
        const manual = createDecorationFrameResolver(DecorationSchema.parse({ mode: "agent", frame: { mode: "manual", frameId: id } }), first as StickerAssets);
        expect(manual("source").frameId).toBe(id);
        const png = await readFile(asset.assetPath);
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([720, 1280]);
        expect(await fingerprintFile(asset.assetPath)).toBe(asset.assetFingerprint);
        const chunks: Buffer[] = [];
        for (let offset = 8; offset < png.length;) {
          const length = png.readUInt32BE(offset);
          if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
          offset += length + 12;
        }
        const rows = inflateSync(Buffer.concat(chunks));
        expect(rows.length).toBe((720 * 4 + 1) * 1280);
        let opaqueCenter = 0;
        let missingPerimeter = 0;
        let visiblePixels = 0;
        let wideDecoration = 0;
        for (let y = 0; y < 1280; y += 1) {
          expect(rows[y * (720 * 4 + 1)]).toBe(0);
          for (let x = 0; x < 720; x += 1) {
            const alpha = rows[y * (720 * 4 + 1) + 1 + x * 4 + 3];
            if (alpha) visiblePixels += 1;
            if (alpha && x >= 40 && x < 680 && y >= 72 && y < 1208) wideDecoration += 1;
            if (x >= 180 && x < 540 && y >= 320 && y < 960 && alpha) opaqueCenter += 1;
            if ((x === 0 || x === 719 || y === 0 || y === 1279) && alpha !== 255) missingPerimeter += 1;
          }
        }
        expect(opaqueCenter, id).toBe(0);
        expect(missingPerimeter, id).toBe(0);
        expect(wideDecoration, id).toBe(0);
        expect(visiblePixels / (720 * 1280), id).toBeLessThan(0.095);
      }
      await writeFile(first["frame-stars"].assetPath, "corrupted");
      await expect(assertDecorationFrameOptions({ frame: { mode: "random" } }, first as StickerAssets)).rejects.toThrow("边框");
      await expect(assertDecorationFrameOptions({ frame: { mode: "auto" } }, first as StickerAssets)).rejects.toThrow("边框");
      const mediaId = crypto.randomUUID();
      await expect(assertDecorationFrameOptions({ frame: { mode: "random" }, framesByMedia: { [mediaId]: { mode: "none" } } }, first as StickerAssets, [mediaId])).resolves.toBeUndefined();
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
