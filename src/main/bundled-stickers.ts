import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUNDLED_STICKERS, type BundledStickerId } from "../shared/bundled-stickers.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";

export type BundledStickerAssets = Readonly<Record<BundledStickerId, BuiltinStickerAsset>>;

export async function loadBundledStickerAssets(directory: string): Promise<BundledStickerAssets> {
  const absoluteDirectory = path.resolve(directory);
  const entries = await Promise.all(BUNDLED_STICKERS.map(async (entry) => {
    const assetPath = path.join(absoluteDirectory, entry.fileName);
    const bytes = await readFile(assetPath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== entry.sha256) throw new Error(`bundled sticker integrity mismatch: ${entry.id}`);
    return [entry.id, { assetPath, assetFingerprint: `sha256:${entry.sha256}` }] as const;
  }));
  return Object.fromEntries(entries) as BundledStickerAssets;
}
