import { randomUUID } from "node:crypto";
import { DEFAULT_COVER_STICKER, CoverStickerSchema, type CoverRectangle, type CoverSticker } from "../shared/cover-sticker.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";
import type { ExportBatch, StickerLayer } from "./domain.js";
import type { AutomaticCoverTrack } from "./automatic-cover-tracks.js";

export interface FrozenCoverSticker {
  stickerId: string;
  assetPath: string;
  assetFingerprint: string;
  rectangle: CoverRectangle;
  tracks?: CoverSticker["tracks"];
  automatic?: boolean;
}

export function resolveCoverSticker(settings: CoverSticker | undefined, assets: Readonly<Record<string, BuiltinStickerAsset | undefined>>, history: readonly ExportBatch[]): FrozenCoverSticker | undefined {
  const options = CoverStickerSchema.parse(settings ?? DEFAULT_COVER_STICKER);
  if (!options.enabled) return undefined;
  const candidates = options.stickerIds;
  if (candidates.some((id) => !assets[id])) throw new Error("覆盖贴纸已删除或不可用，请重新选择自己的贴纸。");
  const previous = [...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .flatMap((batch) => batch.templateSnapshot.layers.flatMap((layer) => layer.type === "sticker" && layer.cover ? [layer.cover.stickerId] : []))[0];
  const previousIndex = candidates.indexOf(previous);
  const stickerId = candidates[(previousIndex + 1) % candidates.length];
  return { stickerId, ...assets[stickerId]!, rectangle: structuredClone(options.rectangle), ...(options.tracks ? { tracks: structuredClone(options.tracks) } : {}), ...(options.trackingMode === "agent" ? { automatic: true } : {}) };
}

export function automaticCoverLayers(frozen: FrozenCoverSticker, source: { id: string; width: number; height: number }, output: { width: number; height: number }, tracks: readonly AutomaticCoverTrack[]): StickerLayer[] {
  return tracks.map(({ targetId, track }) => {
    const layer = coverLayerForMedia({ ...frozen, tracks: { [source.id]: track } }, source, output);
    return { ...layer, cover: { ...layer.cover!, automatic: true, targetId } };
  });
}

export function coverLayerForMedia(frozen: FrozenCoverSticker, source: { id?: string; width: number; height: number }, output: { width: number; height: number }): StickerLayer {
  const scale = Math.min(output.width / source.width, output.height / source.height);
  const widthRatio = Math.min(1, source.width * scale / output.width);
  const heightRatio = Math.min(1, source.height * scale / output.height);
  const mapRectangle = (rect: CoverRectangle): CoverRectangle => ({
    x: (1 - widthRatio) / 2 + rect.x * widthRatio,
    y: (1 - heightRatio) / 2 + rect.y * heightRatio,
    width: rect.width * widthRatio, height: rect.height * heightRatio,
  });
  const track = source.id ? frozen.tracks?.[source.id] : undefined;
  const rect = mapRectangle(track?.keyframes[0].rectangle ?? frozen.rectangle);
  const motion = track && { ...track, keyframes: track.keyframes.map((frame) => ({ timeMs: frame.timeMs, rectangle: mapRectangle(frame.rectangle) })) };
  return {
    id: randomUUID(), type: "sticker", assetPath: frozen.assetPath, assetFingerprint: frozen.assetFingerprint,
    x: rect.x, y: rect.y,
    width: rect.width, cover: { stickerId: frozen.stickerId, height: rect.height, opaqueBackground: true, ...(motion ? { motion } : {}) },
    rotationDeg: 0, opacity: 1, zIndex: 90, visible: true,
  };
}
