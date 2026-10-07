import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createCoverReviewDraft, editCoverReviewDraft, assertReviewResolved, recoverCoverReviewDraft } from "../src/main/cover-review-session";
import type { MediaItem } from "../src/main/domain";
import { manualReviewInput, manualReviewMatches, manualSettingsFromReview } from "../src/shared/manual-cover-review";
import { DEFAULT_COVER_STICKER, type CoverSticker } from "../src/shared/cover-sticker";

it("reuses saved manual boxes and times, leaves unframed media uncovered, and rejects moving tracks", () => {
  const { draft } = fixture();
  const mediaId = draft.media[0].mediaId;
  const region = { id: randomUUID(), rectangle: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } };
  const track = { startMs: 100, endMs: 800, keyframes: [{ timeMs: 250, rectangle: region.rectangle }] };
  const settings: CoverSticker = { ...DEFAULT_COVER_STICKER, enabled: true, trackingMode: "assisted", assistedArtwork: "human-region-v1", manualRegionInput: true,
    mediaRegions: { [mediaId]: [region, { ...region, id: randomUUID(), tracks: { [mediaId]: track } }] } };
  expect(manualReviewInput(settings, draft.media)[0].regions.map(region => region.track)).toEqual([
    { startMs: 0, endMs: 1000, keyframes: [{ timeMs: 0, rectangle: region.rectangle }] }, track,
  ]);
  expect(manualReviewInput({ ...settings, mediaRegions: undefined }, draft.media)[0].disposition).toBe("no_cover");
  const untouched = { mediaId: randomUUID(), durationMs: 1000 };
  expect(manualReviewInput(settings, [...draft.media, untouched]).map(item => item.disposition)).toEqual(["cover", "no_cover"]);
  expect(manualReviewInput({ ...settings, mediaRegions: { [mediaId]: [] } }, draft.media)[0].disposition).toBe("no_cover");
  track.keyframes.push({ timeMs: 500, rectangle: region.rectangle });
  expect(() => manualReviewInput(settings, draft.media)).toThrow(/固定框/);
});

it("projects historical human drafts without resurrecting old manual residue", () => {
  const { draft } = fixture(); draft.assistedArtwork = "human-region-v1";
  const media = draft.media[0], id = randomUUID();
  const track = { startMs: 200, endMs: 900, keyframes: [{ timeMs: 200, rectangle: { x: 0.2, y: 0.1, width: 0.2, height: 0.3 } }] };
  media.segments = [{ id, identityId: id, origin: "human", track }]; media.disposition = "cover";
  const settings: CoverSticker = { ...DEFAULT_COVER_STICKER, trackingMode: "assisted", assistedArtwork: "human-region-v1", regions: [{ id: randomUUID(), rectangle: DEFAULT_COVER_STICKER.rectangle }] };
  const migrated = manualSettingsFromReview(settings, [draft]);
  expect(migrated.mediaRegions![media.mediaId][0].tracks![media.mediaId]).toEqual(track);
  expect(migrated.regions).toEqual([]);
  expect(manualReviewMatches(migrated, draft)).toBe(true);
  migrated.mediaRegions![media.mediaId][0].tracks![media.mediaId].endMs = 800;
  expect(manualReviewMatches(migrated, draft)).toBe(false);
  expect(media.segments[0].track.endMs).toBe(900);
  expect(settings.manualRegionInput).toBeUndefined();
});

function fixture() {
  const draft = createCoverReviewDraft(randomUUID(), [{ id: randomUUID(), fingerprint: "original", durationMs: 1000 } as MediaItem]);
  const base = { projectId: draft.projectId, draftId: draft.id, expectedRevision: draft.revision, mediaId: draft.media[0].mediaId };
  return { draft, base };
}
it("requires an explicit no-cover decision for zero candidates, with stale command rejection", () => {
  const { draft, base } = fixture();
  expect(() => assertReviewResolved(draft)).toThrow();
  const edited = editCoverReviewDraft(draft, { ...base, type: "no_cover" });
  expect(() => assertReviewResolved(edited)).not.toThrow();
  expect(edited.media[0].analysis).toBe("not_started");
  expect(() => editCoverReviewDraft(edited, { ...base, type: "no_cover" })).toThrow(/过期/);
  expect(draft.media[0].disposition).toBe("unresolved");
});
it("validates human geometry and keeps two independent visible segments", () => {
  const { draft, base } = fixture();
  const identity = { id: randomUUID(), label: "中部贴纸", semantics: "sticker", origin: "human" };
  const segment = { id: randomUUID(), identityId: identity.id, origin: "human", track: { startMs: 100, endMs: 900, keyframes: [{ timeMs: 100, rectangle: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } }] } };
  const added = editCoverReviewDraft(draft, { ...base, type: "put_segment", identity, segment });
  const split = editCoverReviewDraft(added, { ...base, expectedRevision: added.revision, type: "split", segmentId: segment.id, atMs: 500 });
  expect(split.media[0].segments.map(({ track }) => [track.startMs, track.endMs])).toEqual([[100, 500], [500, 900]]);
  expect(() => editCoverReviewDraft(draft, { ...base, type: "put_segment", identity, segment: { ...segment, track: { ...segment.track, endMs: 1001 } } })).toThrow();
  expect(split.media[0].decisions).toHaveLength(2);
});
it.each(["draft", "analyzing"] as const)("recovery keeps interrupted %s honest without model calls", (status) => {
  const { draft } = fixture(); draft.status = status;
  const restored = recoverCoverReviewDraft(draft);
  expect(restored.status).toBe("needs_human");
  expect(restored.media[0].analysis).toBe("incomplete");
  expect(restored.media[0].disposition).toBe("unresolved");
});
