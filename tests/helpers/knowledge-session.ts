import type { AgentRunner } from "../../src/main/agent-runner";
import type { AutomaticCoverTrack } from "../../src/main/automatic-cover-tracks";
import type { EditTemplate, MediaItem } from "../../src/main/domain";
import { PreviewReviewSession } from "../../src/main/supervised-preview";
import type { PreviewRevision } from "../../src/main/supervisor-protocol";

type Dependencies = ConstructorParameters<typeof AgentRunner>[0];
type Review = (template: EditTemplate, media: MediaItem, tracks: AutomaticCoverTrack[], rebuild: (revision: PreviewRevision) => EditTemplate) => Promise<EditTemplate>;
/** Geometry/runner unit tests stub the knowledge boundary; session/store/integration tests exercise the real owner. */
export function knowledgeFixture(detect: (media: MediaItem, signal: AbortSignal, stage: (value: string) => void) => Promise<AutomaticCoverTrack[]> = async () => [], review: Review = async template => template): NonNullable<Dependencies["knowledge"]> {
  const tracks = new Map<string, Promise<AutomaticCoverTrack[]>>();
  return {
    acquire: async (media, horizonMs, signal, stage) => {
      if (!tracks.has(media.id)) tracks.set(media.id, detect(media, signal, stage));
      await tracks.get(media.id);
      return { media, horizonMs, key: media.id };
    },
    tracks: async binding => (await tracks.get(binding.media.id))!,
    review: async (binding, template, rebuild) => ({ template: await review(template, binding.media, (await tracks.get(binding.media.id))!, rebuild), previewPath: `/tmp/${binding.media.id}-supervisor-preview.mp4`, reviewSession: new PreviewReviewSession() }),
    reconcile: async () => {},
    enqueue: async (version, signal, enqueue) => { signal.throwIfAborted(); return enqueue(version.template); },
    close: async () => { tracks.clear(); },
  };
}
