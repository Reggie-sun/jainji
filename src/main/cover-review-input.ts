import type { CoverReviewDraft } from "../shared/cover-review.js";
import { interpolateCoverRectangle } from "../shared/cover-sticker.js";
import type { CoverReviewEvidence } from "./cover-review-evidence.js";
import type { IndependentMedia } from "./cover-review-provider.js";

export async function prepareIndependentReviewMedia(owner: CoverReviewEvidence, draft: CoverReviewDraft, signal: AbortSignal): Promise<IndependentMedia[]> {
  const result: IndependentMedia[] = [];
  for (const media of draft.media) {
    const images = await owner.images(media.evidence, signal);
    const frames = media.evidence.map(({ relativePath: _path, digest: _digest, ...frame }, index) => ({ ...frame, url: images[index].url }));
    const candidates: IndependentMedia["candidates"] = [];
    for (const { id, semantics } of media.identities) {
      const observations = media.observations.filter(({ identityId }) => identityId === id).map(({ evidenceId, rectangle }) => ({ evidenceId, rectangle }));
      const segments = media.segments.filter(({ identityId }) => identityId === id);
      // Each identity gets its own original-resolution crop, never a union of
      // distant targets. Choose one supplied representative frame per identity.
      const region = media.evidence.flatMap((evidence) => {
        const time = (evidence.pts * evidence.timeBase - (evidence.timeOriginSeconds ?? 0)) * 1000;
        const segment = segments.find(({ track }) => time >= track.startMs && time < track.endMs);
        const rectangle = segment ? interpolateCoverRectangle(segment.track.keyframes, time) : observations.find(({ evidenceId }) => evidenceId === evidence.id)?.rectangle;
        return rectangle ? [{ evidenceId: evidence.id, rectangle }] : [];
      }).slice(0, 1);
      const crops = (await owner.crops(media.evidence, region, signal)).map(({ evidenceId, ...crop }) => ({ ...frames.find(({ id }) => id === evidenceId)!, ...crop }));
      candidates.push({ id, semantics, observations, segments, crops });
    }
    result.push({ mediaId: media.mediaId, frames, candidates });
  }
  return result;
}
