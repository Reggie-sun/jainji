import { randomInt } from "node:crypto";
import { FissionScheduleSchema, FissionStartSchema, fissionAllocation, fissionVariant, type FissionStart, type FissionSettings, type FissionSchedule } from "../shared/video-fission.js";
import { createDefaultTemplate, DEFAULT_PRESET, type ExportBatch, type MediaItem } from "./domain.js";
import type { ExportQueue } from "./queue.js";
import { videoMicroAdjustmentFilters } from "./video-micro-adjustments.js";
import type { QianchuanUploadSelection, UploadAuthorization, UploadIdentity } from "../shared/douyin-upload.js";
import { createAutomaticOutputDirectory } from "./automatic-output-directory.js";

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
  const productionSeed = randomInt(0, 0x7fffffff);
  const created: ExportBatch[] = [];
  try {
    for (let version = 0; version < Math.max(...counts); version++) {
      signal?.throwIfAborted();
      const template = createDefaultTemplate(`视频裂变 · 第 ${version + 1} 版`);
      template.fission = fissionVariant(version, productionSeed);
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

/** Scheduler owns occurrence/upload claims; this adapter only executes the original frozen queue. */
export async function executeScheduledFission(queue: ExportQueue, input: FissionSchedule, mediaItems: readonly MediaItem[], remember: (batches: ExportBatch[]) => Promise<void>, signal: AbortSignal): Promise<UploadIdentity[]> {
  signal.throwIfAborted();
  const request = FissionScheduleSchema.parse(input);
  const sources = request.mediaIds.map(id => mediaItems.find(m => m.id === id));
  if (sources.some(m => !m || m.probeStatus !== "ready")) throw new Error("裂变素材未就绪。");
  const outputDirectory = request.outputDirectory ?? await createAutomaticOutputDirectory(sources.map(m => m!.sourcePath), new Date(), undefined, "fission");
  signal.throwIfAborted();
  const batches = await prepareFissionProduction(queue, { ...request, outputDirectory, douyinUpload: undefined }, mediaItems, {
    preflight: async () => undefined, remember,
    registerBatches: async () => { throw new Error("定时上传须由原自动化服务登记。"); },
  }, signal);
  let cancellation: Promise<unknown> | undefined;
  const cancel = () => cancellation ??= Promise.all(batches.flatMap(b => b.tasks.map(t => queue.cancel(t.id))));
  const abort = () => { void cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    await Promise.all(batches.map(b => queue.start(b.id)));
    await queue.waitForPersistence(signal); signal.throwIfAborted();
    const snapshot = queue.snapshot();
    const exports = batches.flatMap(prepared => {
      const batch = snapshot.batches.find(s => s.batch.id === prepared.id)?.batch;
      if (!batch || batch.projectId !== request.projectId || batch.tasks.length !== prepared.tasks.length || batch.tasks.some(t => t.status !== "completed" || t.outputArtifact?.taskId !== t.id)) throw new Error("裂变导出未全部成功，定时上传未启动。");
      return batch.tasks.map(t => ({ project_id: request.projectId, batch_id: batch.id, export_task_id: t.id }));
    });
    if (exports.length !== request.total) throw new Error("裂变成片数量不一致，未上传。");
    return exports;
  } catch (error) { await cancel(); throw error; }
  finally { signal.removeEventListener("abort", abort); if (cancellation) await cancellation; }
}
