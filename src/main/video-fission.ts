import { FissionStartSchema, fissionAllocation, fissionVariant, type FissionStart } from "../shared/video-fission.js";
import { createDefaultTemplate, DEFAULT_PRESET, type ExportBatch, type MediaItem } from "./domain.js";
import type { ExportQueue } from "./queue.js";

/** Preparation only: the canonical queue owns persistence, execution and recovery. */
export async function createFissionBatches(queue: ExportQueue, input: FissionStart, mediaItems: readonly MediaItem[], signal?: AbortSignal): Promise<ExportBatch[]> {
  const request = FissionStartSchema.parse(input);
  const counts = fissionAllocation(request.mediaIds.length, request.total);
  const media = request.mediaIds.map(id => mediaItems.find(item => item.id === id));
  if (media.some(item => !item || item.probeStatus !== "ready")) throw new Error("所选素材已变化或无法读取，请重新选择。");
  const created: ExportBatch[] = [];
  try {
    for (let version = 0; version < Math.max(...counts); version++) {
      signal?.throwIfAborted();
      const template = createDefaultTemplate(`视频裂变 · 第 ${version + 1} 版`);
      template.fission = fissionVariant(version);
      created.push(await queue.createBatch({
        projectId: request.projectId, template, mediaItems,
        mediaIds: request.mediaIds.filter((_, i) => counts[i] > version),
        outputDirectory: request.outputDirectory,
        preset: { ...DEFAULT_PRESET, frameRateMode: "30" },
      }, signal));
    }
    signal?.throwIfAborted();
    return created;
  } catch (error) {
    // A partial preparation never starts rendering; retain canonical cancelled records.
    for (const batch of created) for (const task of batch.tasks) await queue.cancel(task.id);
    throw error;
  }
}
