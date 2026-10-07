import { randomUUID } from "node:crypto";
import type { CoverSticker } from "../shared/cover-sticker.js";
import type { CoverReviewDraft } from "../shared/cover-review.js";
import { manualReviewInput, manualReviewMatches } from "../shared/manual-cover-review.js";
import { reviewDigest } from "./cover-review-approval.js";

export function seedManualReview(draft: CoverReviewDraft, settings: CoverSticker): void {
  if (!settings.manualRegionInput) return;
  const input = manualReviewInput(settings, draft.media);
  draft.manualRegionsDigest = reviewDigest(input);
  for (const intent of input) {
    const media = draft.media.find(item => item.mediaId === intent.mediaId)!;
    media.disposition = intent.disposition;
    media.identities = intent.regions.map((region, index) => ({ id: region.id, label: `人工覆盖区域 ${index + 1}`, semantics: "sticker", origin: "human" }));
    media.segments = intent.regions.map(region => ({ id: region.id, identityId: region.id, origin: "human", track: region.track }));
    media.decisions = [{ id: randomUUID(), action: intent.disposition === "cover" ? "confirm_geometry" : "no_cover", revision: draft.revision, at: draft.updatedAt }];
  }
}

export function assertManualReviewCurrent(draft: CoverReviewDraft, settings: CoverSticker | undefined): void {
  if (!draft.manualRegionsDigest && !settings?.manualRegionInput) return;
  if (!settings?.manualRegionInput || !draft.manualRegionsDigest ||
      draft.manualRegionsDigest !== reviewDigest(manualReviewInput(settings, draft.media)) || !manualReviewMatches(settings, draft)) {
    throw new Error("手动覆盖区域或时段已变化，请保存手动设置后重新生成预览。");
  }
}
