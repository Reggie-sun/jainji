import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { prepareIndependentReviewMedia } from "../src/main/cover-review-input";
import { runIndependentCoverReview } from "../src/main/cover-review-provider";
import { createCoverReviewDraft } from "../src/main/cover-review-session";
import type { CoverReviewEvidence } from "../src/main/cover-review-evidence";
import type { MediaItem } from "../src/main/domain";

it("passes manual identities and separate target crops through the actual review input boundary", async () => {
  const mediaId = randomUUID(), evidenceId = randomUUID();
  const draft = createCoverReviewDraft(randomUUID(), [{ id: mediaId, fingerprint: "fixture", durationMs: 1000 } as MediaItem]);
  const media = draft.media[0];
  media.evidence = [{ id: evidenceId, relativePath: `${draft.id}/frame.png`, digest: "a".repeat(64), pts: 0, timeBase: 0.001, width: 1000, height: 1000, rotation: 0, transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 } }];
  const rectangles = [{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, { x: 0.8, y: 0.8, width: 0.1, height: 0.1 }];
  for (const rectangle of rectangles) {
    const id = randomUUID(); media.identities.push({ id, label: "human", semantics: "sticker", origin: "human" });
    media.segments.push({ id: randomUUID(), identityId: id, origin: "human", track: { startMs: 0, endMs: 500, keyframes: [{ timeMs: 0, rectangle }] } });
  }
  const requested: unknown[] = [];
  const owner = { images: async () => [{ timeMs: 0, url: "data:image/jpeg;base64,YQ==" }], crops: async (_: unknown, regions: { evidenceId: string; rectangle: typeof rectangles[number] }[]) => {
    requested.push(...regions.map(({ rectangle }) => rectangle));
    return regions.map(({ evidenceId, rectangle }) => ({ evidenceId, url: "data:image/jpeg;base64,Yg==", width: 100, height: 100, transform: { scaleX: rectangle.width, scaleY: rectangle.height, offsetX: rectangle.x, offsetY: rectangle.y } }));
  } } as unknown as CoverReviewEvidence;
  const input = await prepareIndependentReviewMedia(owner, draft, new AbortController().signal);
  expect(requested).toEqual(rectangles);
  const requests: string[] = [];
  const result = await runIndependentCoverReview(async (messages) => { requests.push(JSON.stringify(messages)); return '{"status":"no_issue_observed","findings":[]}'; }, { revision: 0, model: "fixture", maxRequests: 2, media: input }, new AbortController().signal, async () => undefined);
  expect(result.status).toBe("complete");
  expect(requests[0]).not.toContain(media.identities[0].id);
  for (const identity of media.identities) expect(requests[1]).toContain(identity.id);
  expect((requests[1].match(/image_url/g) ?? []).length).toBe(6);
  expect(requests.join("")).not.toContain("frame.png");
});
