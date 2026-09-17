import { vi } from "vitest";
import type { AutomaticCoverTrack } from "../../src/main/automatic-cover-tracks";
import type { EditTemplate, MediaItem } from "../../src/main/domain";
import { SourceStickerKnowledgeSession, type KnowledgeBinding, type KnowledgeVersion } from "../../src/main/source-sticker-knowledge-session";
import type { SourceStickerKnowledgeStore } from "../../src/main/source-sticker-knowledge-store";
import { PreviewReviewSession } from "../../src/main/supervised-preview";

/** Controller tests replace only the durable-session boundary, leaving Controller and Runner scheduling intact. */
export function controllerKnowledge(sourceTracks: readonly AutomaticCoverTrack[] | ((binding: KnowledgeBinding) => readonly AutomaticCoverTrack[]) = []) {
  const acquire = vi.spyOn(SourceStickerKnowledgeSession.prototype, "acquire").mockImplementation(async (media: MediaItem, horizonMs: number, signal: AbortSignal) => {
    signal.throwIfAborted();
    return Object.freeze({ media: structuredClone(media), horizonMs, key: `${media.id}:${horizonMs}` }) as KnowledgeBinding;
  });
  const tracked = vi.spyOn(SourceStickerKnowledgeSession.prototype, "tracks").mockImplementation(async (binding: KnowledgeBinding) => structuredClone([...(typeof sourceTracks === "function" ? sourceTracks(binding) : sourceTracks)]));
  const review = vi.spyOn(SourceStickerKnowledgeSession.prototype, "review").mockImplementation(async (_binding, template: EditTemplate, _rebuild, signal: AbortSignal) => {
    signal.throwIfAborted();
    return { template: structuredClone(template), reviewSession: new PreviewReviewSession() } as KnowledgeVersion;
  });
  const reconcile = vi.spyOn(SourceStickerKnowledgeSession.prototype, "reconcile").mockImplementation(async (_versions, signal: AbortSignal) => { signal.throwIfAborted(); });
  const enqueue = vi.spyOn(SourceStickerKnowledgeSession.prototype, "enqueue").mockImplementation(async (version: KnowledgeVersion, signal: AbortSignal, submit) => {
    signal.throwIfAborted();
    return submit(version.template);
  });
  const close = vi.spyOn(SourceStickerKnowledgeSession.prototype, "close").mockResolvedValue();
  return {
    store: {} as SourceStickerKnowledgeStore,
    acquire, tracks: tracked, review, reconcile, enqueue, close,
    restore: () => { acquire.mockRestore(); tracked.mockRestore(); review.mockRestore(); reconcile.mockRestore(); enqueue.mockRestore(); close.mockRestore(); },
  };
}
