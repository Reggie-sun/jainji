import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadBundledStickerAssets } from "../src/main/bundled-stickers";
import { fingerprintFile, validateTemplateResources } from "../src/main/paths";
import { createDefaultTemplate } from "../src/main/domain";
import { BUNDLED_STICKERS } from "../src/shared/bundled-stickers";
import { DecorationSchema } from "../src/shared/decorations";

const resourceDirectory = path.resolve("resources/stickers/downloaded");
const ffmpeg = process.env.JIANJI_FFMPEG_PATH || "ffmpeg";
const canDecode = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;

describe("bundled downloaded stickers", () => {
  it.skipIf(!canDecode)("decodes the custom sticker with corrected EXIF metadata", () => {
    const result = spawnSync(ffmpeg, ["-v", "error", "-i", path.join(resourceDirectory, "custom-062.png"), "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
  it("loads pinned PNG and GIF files with matching fingerprints", async () => {
    const assets = await loadBundledStickerAssets(resourceDirectory);
    expect(BUNDLED_STICKERS.length).toBeGreaterThanOrEqual(18);
    expect(Object.keys(assets).sort()).toEqual(BUNDLED_STICKERS.map(({ id }) => id).sort());
    expect(BUNDLED_STICKERS.filter(({ animated }) => animated)).toHaveLength(3);
    for (const entry of BUNDLED_STICKERS) {
      expect(DecorationSchema.parse({ sticker: entry.id }).sticker).toBe(entry.id);
      const asset = assets[entry.id];
      expect(path.extname(asset.assetPath)).toBe(path.extname(entry.fileName));
      expect((await readFile(asset.assetPath)).length).toBeGreaterThan(0);
      expect(await fingerprintFile(asset.assetPath)).toBe(asset.assetFingerprint);
    }
  });

  it("admits a fingerprinted GIF as a template resource", async () => {
    const assets = await loadBundledStickerAssets(resourceDirectory);
    const template = createDefaultTemplate();
    template.layers.push({ id: crypto.randomUUID(), type: "sticker", ...assets["local-click-mini-cart"], x: 0.04, y: 0.04, width: 0.12, rotationDeg: 0, opacity: 1, zIndex: 0, visible: true });
    expect(await validateTemplateResources(template, { resolve: async () => null })).toEqual([]);
  });

  it("rejects a bundled file that no longer matches its pinned digest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-bundled-stickers-"));
    const copiedDirectory = path.join(root, "downloaded");
    try {
      await cp(resourceDirectory, copiedDirectory, { recursive: true });
      await writeFile(path.join(copiedDirectory, "limited-discount.png"), "changed");
      await expect(loadBundledStickerAssets(copiedDirectory)).rejects.toThrow("bundled sticker integrity mismatch: local-limited-discount");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
