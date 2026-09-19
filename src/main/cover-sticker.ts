import { randomUUID } from "node:crypto";
import { DEFAULT_COVER_STICKER, CoverStickerSchema, manualCoverRegions, type CoverRectangle, type CoverRegion, type CoverSticker } from "../shared/cover-sticker.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";
import type { ExportBatch, StickerLayer } from "./domain.js";
import type { AutomaticCoverTrack } from "./automatic-cover-tracks.js";

interface CoverArtwork {
  stickerId: string;
  assetPath: string;
  assetFingerprint: string;
}

interface FrozenCoverPlacement extends CoverArtwork {
  rectangle: CoverRectangle;
  tracks?: CoverSticker["tracks"];
  automatic?: boolean;
  regionId?: string;
  sharedSticker?: true;
  artworkCycle?: CoverArtwork[];
}
export interface FrozenCoverSticker extends FrozenCoverPlacement {
  regions?: FrozenCoverPlacement[];
  mediaRegions?: Record<string, FrozenCoverPlacement[]>;
}

export function resolveCoverSticker(settings: CoverSticker | undefined, assets: Readonly<Record<string, BuiltinStickerAsset | undefined>>, history: readonly ExportBatch[], mediaIds?: readonly string[]): FrozenCoverSticker | undefined {
  const options = CoverStickerSchema.parse(settings ?? DEFAULT_COVER_STICKER);
  if (!options.enabled) return undefined;
  if (options.trackingMode === "assisted") throw new Error("半自动覆盖必须经过审阅和批准。");
  const layouts = mediaIds ? Object.fromEntries(mediaIds.map((id) => [id, manualCoverRegions(options, id)])) : undefined;
  const regions = layouts ? Object.values(layouts).flat() : manualCoverRegions(options);
  if (!regions.length) return undefined;
  if (regions.some((region) => !region.stickerId) && !options.stickerIds.length) throw new Error("仍有素材的覆盖框使用统一款，请选择覆盖候选贴纸。");
  const candidates = options.stickerIds;
  if ([...candidates, ...regions.flatMap((region) => region.stickerId ? [region.stickerId] : [])].some((id) => !assets[id])) throw new Error("覆盖贴纸已删除或不可用，请重新选择自己的贴纸。");
  const previous = previousCoverStickerId(history, true);
  const freeze = (region: CoverRegion, mediaId?: string): FrozenCoverPlacement => {
    const tracks = mediaId ? region.tracks?.[mediaId] ? { [mediaId]: region.tracks[mediaId] } : undefined : region.tracks;
    const available = region.stickerId ? [region.stickerId, ...candidates.filter((id) => id !== region.stickerId)] : candidates;
    const last = region.stickerId ? previousCoverStickerId(history, false, { id: region.id, mediaId }) : previous;
    const start = (available.indexOf(last ?? "") + 1) % available.length;
    const cycleIds = [...available.slice(start), ...available.slice(0, start)];
    const stickerId = cycleIds[0];
    return { stickerId, ...assets[stickerId]!, ...(cycleIds.length > 1 ? { artworkCycle: cycleIds.map((id) => ({ stickerId: id, ...assets[id]! })) } : {}), rectangle: structuredClone(region.rectangle), ...(tracks ? { tracks: structuredClone(tracks) } : {}),
      ...(options.regions || layouts ? { regionId: region.id, ...(!region.stickerId ? { sharedSticker: true as const } : {}) } : {}) };
  };
  if (layouts) {
    const mediaRegions = Object.fromEntries(Object.entries(layouts).map(([id, items]) => [id, items.map((region) => freeze(region, id))]));
    const first = Object.values(mediaRegions).find((items) => items.length)![0];
    return { ...first, regions: [], mediaRegions };
  }
  const placements = regions.map((region) => freeze(region));
  return { ...placements[0], ...(options.regions ? { regions: placements } : {}), ...(options.trackingMode === "agent" ? { automatic: true } : {}) };
}

// Queue insertion order can differ from round order when plans finish concurrently.
export function previousCoverStickerId(history: readonly ExportBatch[], sharedOnly = false, region?: { id: string; mediaId?: string }): string | undefined {
  const covers = [...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((batch) => !region?.mediaId || batch.mediaIds.includes(region.mediaId))
    .flatMap((batch) => batch.templateSnapshot.layers.flatMap((layer) => layer.type === "sticker" && layer.cover && (!region || layer.cover.regionId === region.id) && (!sharedOnly || !layer.cover.regionId || layer.cover.sharedSticker) ? [layer.cover] : []));
  const latest = covers[0];
  if (!latest?.selection) return latest?.stickerId;
  return covers.filter((cover) => cover.selection?.runId === latest.selection!.runId)
    .sort((a, b) => b.selection!.round - a.selection!.round)[0].stickerId;
}

export function unusedCoverStickerIds(eligible: readonly string[], selected: readonly string[], previous?: string): string[] {
  const used = new Set<string>();
  for (const id of selected) {
    if (used.size === eligible.length) used.clear();
    if (eligible.includes(id)) used.add(id);
  }
  const last = selected.at(-1) ?? previous;
  const fresh = eligible.filter((id) => !used.has(id) && id !== last);
  return fresh.length ? fresh : eligible.length > 1 ? eligible.filter((id) => id !== last) : [...eligible];
}

export function manualCoverLayers(frozen: FrozenCoverSticker, source: { id?: string; width: number; height: number }, output: { width: number; height: number }, version = 1): StickerLayer[] {
  return ((source.id && frozen.mediaRegions?.[source.id]) || frozen.regions || [frozen]).map((placement) => coverLayerForMedia({ ...placement, ...placement.artworkCycle?.[(version - 1) % placement.artworkCycle.length] }, source, output));
}

const MAX_STATIC_COVER_DRIFT = 0.02;

export function staticAutomaticCoverTracks(tracks: readonly AutomaticCoverTrack[]): AutomaticCoverTrack[] {
  const grouped = new Map<string, AutomaticCoverTrack[]>();
  for (const value of tracks) grouped.set(value.targetId, [...(grouped.get(value.targetId) ?? []), value]);
  const result: AutomaticCoverTrack[] = [];
  for (const values of grouped.values()) {
    const frames = values.flatMap(({ track }) => track.keyframes);
    const reference = frames[0]?.rectangle;
    if (!reference || frames.some(({ rectangle }) => {
      const centerX = rectangle.x + rectangle.width / 2, centerY = rectangle.y + rectangle.height / 2;
      const referenceCenterX = reference.x + reference.width / 2, referenceCenterY = reference.y + reference.height / 2;
      return Math.abs(centerX - referenceCenterX) > MAX_STATIC_COVER_DRIFT
        || Math.abs(centerY - referenceCenterY) > MAX_STATIC_COVER_DRIFT;
    })) continue;
    if (frames.length === 1) {
      result.push(...structuredClone(values));
      continue;
    }
    const left = Math.min(...frames.map(({ rectangle }) => rectangle.x));
    const top = Math.min(...frames.map(({ rectangle }) => rectangle.y));
    const right = Math.max(...frames.map(({ rectangle }) => rectangle.x + rectangle.width));
    const bottom = Math.max(...frames.map(({ rectangle }) => rectangle.y + rectangle.height));
    const rectangle = { x: left, y: top, width: right - left, height: bottom - top };
    result.push(...values.map(({ targetId, track }) => ({ targetId, track: {
      startMs: track.startMs, endMs: track.endMs, keyframes: [{ timeMs: track.startMs, rectangle }],
    } })));
  }
  return result;
}

export function automaticCoverLayers(frozen: FrozenCoverSticker, source: { id: string; width: number; height: number }, output: { width: number; height: number }, tracks: readonly AutomaticCoverTrack[], options?: { preserveMotion?: boolean }): StickerLayer[] {
  const renderedTracks = options?.preserveMotion ? structuredClone(tracks) : staticAutomaticCoverTracks(tracks);
  return renderedTracks.map(({ targetId, track }) => {
    const layer = coverLayerForMedia({ ...frozen, tracks: { [source.id]: track } }, source, output);
    return { ...layer, cover: { ...layer.cover!, automatic: true, targetId } };
  });
}

export function coverLayerForMedia(frozen: FrozenCoverPlacement, source: { id?: string; width: number; height: number }, output: { width: number; height: number }): StickerLayer {
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
    width: rect.width, cover: { stickerId: frozen.stickerId, height: rect.height, opaqueBackground: true, ...(motion ? { motion } : {}), ...(frozen.regionId ? { regionId: frozen.regionId, ...(frozen.sharedSticker ? { sharedSticker: true } : {}) } : {}) },
    rotationDeg: 0, opacity: 1, zIndex: 90, visible: true,
  };
}
