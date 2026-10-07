import { CoverStickerSchema, DEFAULT_COVER_RECTANGLE, manualCoverRegions, type CoverSticker } from "./cover-sticker.js";
import type { CoverReviewDraft } from "./cover-review.js";

/** Saved manual intent, independent of artwork choice and review evidence. */
export function manualReviewInput(settings: CoverSticker, media: readonly { mediaId: string; durationMs: number }[]) {
  const parsed = CoverStickerSchema.parse(settings);
  return media.map(({ mediaId, durationMs }) => {
    const regions = manualCoverRegions(parsed, mediaId);
    if (!regions.length && !Object.prototype.hasOwnProperty.call(parsed.mediaRegions ?? {}, mediaId)) throw new Error("请逐素材添加覆盖框，或明确选择此素材不覆盖。");
    return { mediaId, disposition: regions.length ? "cover" as const : "no_cover" as const, regions: regions.map(region => {
      const track = region.tracks?.[mediaId] ?? { startMs: 0, endMs: durationMs, keyframes: [{ timeMs: 0, rectangle: region.rectangle }] };
      if (track.keyframes.length !== 1) throw new Error("真实贴纸覆盖只接受固定框，请先处理此素材的移动轨迹。");
      if (track.endMs > durationMs || track.keyframes.some(frame => frame.timeMs > durationMs)) throw new Error("覆盖时段超出素材时长。");
      return { id: region.id, track: structuredClone(track) };
    }) };
  });
}

export function manualReviewMatches(settings: CoverSticker, draft: CoverReviewDraft): boolean {
  try {
    const expected = manualReviewInput(settings, draft.media);
    const actual = draft.media.map(media => ({ mediaId: media.mediaId, disposition: media.disposition,
      regions: media.segments.map(segment => ({ id: segment.id, track: segment.track })) }));
    return JSON.stringify(expected) === JSON.stringify(actual);
  } catch { return false; }
}

/** Unsaved UI migration only: historical review-authored boxes must not be lost. */
export function manualSettingsFromReview(settings: CoverSticker, drafts: readonly CoverReviewDraft[]): CoverSticker {
  if (!settings.assistedArtwork || settings.manualRegionInput) return structuredClone(settings);
  const mediaRegions: NonNullable<CoverSticker["mediaRegions"]> = {};
  for (const draft of drafts.filter(item => item.assistedArtwork === settings.assistedArtwork)) {
    for (const media of draft.media) {
      delete mediaRegions[media.mediaId];
      if (media.disposition === "no_cover") mediaRegions[media.mediaId] = [];
      else if (media.segments.length) mediaRegions[media.mediaId] = media.segments.map(segment => ({
        id: segment.id, rectangle: { ...segment.track.keyframes[0].rectangle }, tracks: { [media.mediaId]: structuredClone(segment.track) },
      }));
    }
  }
  // Old manual residue is not the source of a historical human-region draft.
  return { ...structuredClone(settings), manualRegionInput: true, rectangle: { ...DEFAULT_COVER_RECTANGLE }, regions: [], tracks: undefined, mediaRegions };
}
