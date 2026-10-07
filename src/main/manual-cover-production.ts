import { randomUUID } from "node:crypto";
import type { CoverSticker } from "../shared/cover-sticker.js";
import { manualReviewInput } from "../shared/manual-cover-review.js";
import type { MediaItem } from "./domain.js";
import type { HumanRegionIntent } from "./human-region-cover.js";

/** Snapshot saved boxes for a normal run. This is intent, never a review or approval. */
export function manualProductionIntent(projectId: string, settings: CoverSticker, media: MediaItem[]): HumanRegionIntent {
  if (!settings.enabled || !settings.manualRegionInput || settings.assistedArtwork !== "human-region-v1") throw Error("真实贴纸覆盖设置未保存。");
  const targets = manualReviewInput(settings, media.map(item => ({ mediaId: item.id, durationMs: item.durationMs })));
  return { id: randomUUID(), projectId, revision: 0, assistedArtwork: "human-region-v1", admission: "manual-production-v1",
    media: targets.map(target => ({ mediaId: target.mediaId, sourceFingerprint: media.find(item => item.id === target.mediaId)!.fingerprint,
      disposition: target.disposition,
      identities: target.regions.map(region => ({ id: region.id, label: "人工覆盖区域", semantics: "sticker", origin: "human" })),
      segments: target.regions.map(region => ({ id: region.id, identityId: region.id, origin: "human", track: region.track })),
    })) };
}
