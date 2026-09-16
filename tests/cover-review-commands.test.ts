import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createCoverReviewDraft, editCoverReviewDraft, assertReviewResolved, recoverCoverReviewDraft } from "../src/main/cover-review-session";
import type { MediaItem } from "../src/main/domain";

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
it("recovery keeps interrupted analysis honest without model calls", () => {
  const { draft } = fixture(); draft.status = "analyzing";
  const restored = recoverCoverReviewDraft(draft);
  expect(restored.status).toBe("needs_human");
  expect(restored.media[0].analysis).toBe("incomplete");
  expect(restored.media[0].disposition).toBe("unresolved");
});
