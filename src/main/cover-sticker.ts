import { randomUUID } from "node:crypto";
import { CoverStickerSchema, type CoverRectangle, type CoverSticker } from "../shared/cover-sticker.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";
import type { ExportBatch, StickerLayer } from "./domain.js";

export interface FrozenCoverSticker {
  stickerId: string;
  assetPath: string;
  assetFingerprint: string;
  rectangle: CoverRectangle;
}

export function resolveCoverSticker(settings: CoverSticker | undefined, assets: Readonly<Record<string, BuiltinStickerAsset | undefined>>, history: readonly ExportBatch[]): FrozenCoverSticker | undefined {
  if (!settings) return undefined;
  const options = CoverStickerSchema.parse(settings);
  if (!options.enabled) return undefined;
  if (options.stickerIds.some((id) => !assets[id])) throw new Error("覆盖贴纸已删除或不可用，请重新选择自己的贴纸。");
  const previous = [...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .flatMap((batch) => batch.templateSnapshot.layers.flatMap((layer) => layer.type === "sticker" && layer.cover ? [layer.cover.stickerId] : []))[0];
  const previousIndex = options.stickerIds.indexOf(previous);
  const stickerId = options.stickerIds[(previousIndex + 1) % options.stickerIds.length];
  return { stickerId, ...assets[stickerId]!, rectangle: structuredClone(options.rectangle) };
}

export function coverLayerForMedia(frozen: FrozenCoverSticker, source: { width: number; height: number }, output: { width: number; height: number }): StickerLayer {
  const scale = Math.min(output.width / source.width, output.height / source.height);
  const widthRatio = Math.min(1, source.width * scale / output.width);
  const heightRatio = Math.min(1, source.height * scale / output.height);
  const rect = frozen.rectangle;
  return {
    id: randomUUID(), type: "sticker", assetPath: frozen.assetPath, assetFingerprint: frozen.assetFingerprint,
    x: (1 - widthRatio) / 2 + rect.x * widthRatio,
    y: (1 - heightRatio) / 2 + rect.y * heightRatio,
    width: rect.width * widthRatio, cover: { stickerId: frozen.stickerId, height: rect.height * heightRatio },
    rotationDeg: 0, opacity: 1, zIndex: 90, visible: true,
  };
}
