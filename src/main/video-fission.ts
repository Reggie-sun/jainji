import { FissionStartSchema, fissionAllocation, fissionVariant, type FissionStart, type FissionSettings } from "../shared/video-fission.js";
import { createDefaultTemplate, DEFAULT_PRESET, type ExportBatch, type MediaItem } from "./domain.js";
import type { ExportQueue } from "./queue.js";
import { videoMicroAdjustmentFilters } from "./video-micro-adjustments.js";
import type { QianchuanUploadSelection, UploadAuthorization } from "../shared/douyin-upload.js";

/** Canonical compiler consumes frozen values; missing new controls add no filters. */
export function fissionVideoFilters(settings: FissionSettings, dimensions: { width: number; height: number }): string {
  const { width, height } = dimensions;
  const insetWidth = Math.max(2, Math.round(width * (1 - 2 * settings.inset / 720) / 2) * 2);
  const insetHeight = Math.max(2, Math.round(height * (1 - 2 * settings.inset / 720) / 2) * 2);
  return `scale=${insetWidth}:${insetHeight}:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x101010,setsar=1,${videoMicroAdjustmentFilters(settings)}`;
}

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
        preset: { ...DEFAULT_PRESET, microAdjustments: undefined, frameRateMode: "30" },
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

/** The existing uploader owns authorization and intents; no export starts before registration. */
export async function prepareFissionProduction(queue: ExportQueue, input: FissionStart, mediaItems: readonly MediaItem[], owner: {
  preflight(selection: QianchuanUploadSelection | undefined, total: number): Promise<UploadAuthorization | undefined>;
  registerBatches(batches: ExportBatch[], selection: QianchuanUploadSelection, authorization?: UploadAuthorization): Promise<void>;
  remember(batches: ExportBatch[]): Promise<void>;
}, signal?: AbortSignal): Promise<ExportBatch[]> {
  const request = FissionStartSchema.parse(input);
  signal?.throwIfAborted();
  const authorization = await owner.preflight(request.douyinUpload, request.total);
  signal?.throwIfAborted();
  if (request.douyinUpload && !authorization) throw new Error("千川账号预检不可用，请重新选择账号。");
  const batches = await createFissionBatches(queue, request, mediaItems, signal);
  try {
    await owner.remember(batches);
    signal?.throwIfAborted();
    if (request.douyinUpload) await owner.registerBatches(batches, request.douyinUpload, authorization);
    signal?.throwIfAborted();
    return batches;
  } catch (error) {
    for (const batch of batches) for (const task of batch.tasks) await queue.cancel(task.id);
    throw error;
  }
}
