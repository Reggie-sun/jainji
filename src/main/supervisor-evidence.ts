import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CoverRectangleSchema, type CoverRectangle } from "../shared/cover-sticker.js";
import type { MediaItem } from "./domain.js";
import { runCommand, type FfmpegAdapter, type RunningCommand } from "./ffmpeg.js";
import { fingerprintFile } from "./paths.js";

const MAX_REQUESTS = 8;
const MAX_IMAGE_BYTES = 2_000_000;
const MAX_DIMENSION = 1280;

export interface EvidenceRequest { timeMs: number; crop?: CoverRectangle }
export interface SupervisorEvidenceImage {
  requestedTimeMs: number;
  timeMs: number;
  sourceUrl: string;
  previewUrl?: string;
  previewTimeMs?: number;
  crop?: CoverRectangle;
  previewCrop?: CoverRectangle;
}

interface DecodedFrame { index: number; timeMs: number; width: number; height: number }
interface ProbeOutput { frames?: Array<{ best_effort_timestamp_time?: string | number; width?: number; height?: number }> }

function timeoutFor(media: MediaItem): number {
  return Math.max(20_000, Math.min(120_000, media.durationMs * 2));
}

async function bounded(command: RunningCommand, signal: AbortSignal, timeoutMs: number): Promise<{ code: number; stdout: string }> {
  let timedOut = false;
  const cancel = () => { void command.cancel().catch(() => undefined); };
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    const result = await command.promise;
    signal.throwIfAborted();
    if (timedOut) throw new Error("证据抽取超时，请检查视频后重试。");
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

function nearest(frames: readonly DecodedFrame[], timeMs: number): DecodedFrame {
  let selected = frames[0];
  for (const frame of frames) {
    if (Math.abs(frame.timeMs - timeMs) < Math.abs(selected.timeMs - timeMs)) selected = frame;
  }
  if (!selected) throw new Error("视频没有可用的解码帧。");
  return selected;
}

function intervalAt(frames: readonly DecodedFrame[], index: number): number {
  const around = [frames[index - 1], frames[index + 1]]
    .filter((frame): frame is DecodedFrame => Boolean(frame))
    .map((frame) => Math.abs(frame.timeMs - frames[index].timeMs))
    .filter((interval) => interval > 0);
  return around.length ? Math.min(...around) : 0;
}

function cropPixels(crop: CoverRectangle, width: number, height: number): { x: number; y: number; width: number; height: number; actual: CoverRectangle } {
  const x = Math.floor(crop.x * width), y = Math.floor(crop.y * height);
  const right = Math.ceil((crop.x + crop.width) * width), bottom = Math.ceil((crop.y + crop.height) * height);
  const croppedWidth = right - x, croppedHeight = bottom - y;
  if (x < 0 || y < 0 || right > width || bottom > height || croppedWidth < 2 || croppedHeight < 2) throw new Error("证据裁剪区域过小或超出画面。");
  return { x, y, width: croppedWidth, height: croppedHeight, actual: { x: x / width, y: y / height, width: croppedWidth / width, height: croppedHeight / height } };
}

function previewCropPixels(sourceCrop: CoverRectangle, sourceWidth: number, sourceHeight: number, previewWidth: number, previewHeight: number) {
  const scale = Math.min(previewWidth / sourceWidth, previewHeight / sourceHeight);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("渲染预览画面尺寸无效。");
  const paddingX = (previewWidth - sourceWidth * scale) / 2;
  const paddingY = (previewHeight - sourceHeight * scale) / 2;
  return cropPixels({
    x: (paddingX + sourceCrop.x * sourceWidth * scale) / previewWidth,
    y: (paddingY + sourceCrop.y * sourceHeight * scale) / previewHeight,
    width: sourceCrop.width * sourceWidth * scale / previewWidth,
    height: sourceCrop.height * sourceHeight * scale / previewHeight,
  }, previewWidth, previewHeight);
}

/** Extracts bounded, decoded frame evidence for one automatic supervisor decision. */
export class SupervisorEvidence {
  private directory?: string;
  private disposed = false;

  constructor(private readonly ffmpeg: FfmpegAdapter, private readonly media: MediaItem) {}

  private async frames(filePath: string, signal: AbortSignal): Promise<DecodedFrame[]> {
    const result = await bounded(runCommand(this.ffmpeg.ffprobePath, [
      "-v", "error", "-select_streams", "v:0", "-show_frames",
      "-show_entries", "frame=best_effort_timestamp_time,width,height", "-of", "json", filePath,
    ]), signal, timeoutFor(this.media));
    if (result.code !== 0) throw new Error("无法读取视频帧时间信息。");
    let output: ProbeOutput;
    try { output = JSON.parse(result.stdout) as ProbeOutput; } catch { throw new Error("视频帧时间信息无效。"); }
    const raw = (output.frames ?? []).flatMap((frame, index) => {
      const timeMs = Number(frame.best_effort_timestamp_time) * 1000;
      const width = Number(frame.width), height = Number(frame.height);
      return Number.isFinite(timeMs) && Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 ? [{ index, timeMs, width, height }] : [];
    });
    if (!raw.length) throw new Error("视频没有可用的解码帧。");
    const origin = raw[0].timeMs;
    return raw.map((frame) => ({ ...frame, timeMs: frame.timeMs - origin }));
  }

  private async root(): Promise<string> {
    if (!this.directory) this.directory = await mkdtemp(path.join(tmpdir(), "jianji-supervisor-evidence-"));
    return this.directory;
  }

  private async image(filePath: string, frame: DecodedFrame, crop: { x: number; y: number; width: number; height: number } | undefined, signal: AbortSignal): Promise<string> {
    const directory = await this.root();
    signal.throwIfAborted();
    const output = path.join(directory, `${randomUUID()}.jpg`);
    const filters = [`select='eq(n\\,${frame.index})'`];
    if (crop) filters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1`);
    filters.push(`scale=w='min(iw,${MAX_DIMENSION})':h='min(ih,${MAX_DIMENSION})':force_original_aspect_ratio=decrease`);
    try {
      const result = await bounded(this.ffmpeg.run(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", filePath, "-vf", filters.join(","), "-vsync", "0", "-frames:v", "1", "-q:v", "5", output]), signal, timeoutFor(this.media));
      if (result.code !== 0) throw new Error("无法抽取监督证据帧。");
      const bytes = await readFile(output);
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("监督证据帧无效或过大。");
      return `data:image/jpeg;base64,${bytes.toString("base64")}`;
    } finally { await unlink(output).catch(() => undefined); }
  }

  async inspect(requests: readonly EvidenceRequest[], signal: AbortSignal, previewPath?: string): Promise<SupervisorEvidenceImage[]> {
    signal.throwIfAborted();
    if (this.disposed) throw new Error("监督证据已释放。");
    if (!requests.length || requests.length > MAX_REQUESTS) throw new Error("每次监督证据请求应为 1 至 8 帧。");
    for (const request of requests) {
      if (!Number.isFinite(request.timeMs) || request.timeMs < 0 || request.timeMs >= this.media.durationMs) throw new Error("监督证据时间超出素材范围。");
      if (request.crop) CoverRectangleSchema.parse(request.crop);
    }
    if (await fingerprintFile(this.media.sourcePath) !== this.media.fingerprint) throw new Error("素材已发生变化，请重新导入后监督。");
    const sourceFrames = await this.frames(this.media.sourcePath, signal);
    const previewFrames = previewPath ? await this.frames(previewPath, signal) : undefined;
    const sourceWidth = this.media.width, sourceHeight = this.media.height;
    if (!Number.isInteger(sourceWidth) || sourceWidth < 2 || !Number.isInteger(sourceHeight) || sourceHeight < 2) throw new Error("素材画面尺寸无效。");
    const result: SupervisorEvidenceImage[] = [];
    for (const request of requests) {
      signal.throwIfAborted();
      const source = nearest(sourceFrames, request.timeMs);
      if (Math.abs(source.timeMs - request.timeMs) > 250) throw new Error("请求时间附近没有可用的源视频帧，已停止监督。");
      const sourceCrop = request.crop ? cropPixels(request.crop, sourceWidth, sourceHeight) : undefined;
      const sourceUrl = await this.image(this.media.sourcePath, source, sourceCrop, signal);
      if (!previewFrames || !previewPath) {
        result.push({ requestedTimeMs: request.timeMs, timeMs: Math.round(source.timeMs), sourceUrl, ...(sourceCrop ? { crop: sourceCrop.actual } : {}) });
        continue;
      }
      const preview = nearest(previewFrames, source.timeMs);
      const previewIndex = previewFrames.indexOf(preview);
      const tolerance = Math.min(250, Math.max(50, intervalAt(previewFrames, previewIndex)));
      if (Math.abs(preview.timeMs - source.timeMs) > tolerance) throw new Error("渲染预览与素材帧时间不一致，已停止监督。");
      const previewCrop = sourceCrop ? previewCropPixels(sourceCrop.actual, sourceWidth, sourceHeight, preview.width, preview.height) : undefined;
      const previewUrl = await this.image(previewPath, preview, previewCrop, signal);
      result.push({ requestedTimeMs: request.timeMs, timeMs: Math.round(source.timeMs), sourceUrl, previewUrl, previewTimeMs: Math.round(preview.timeMs), ...(sourceCrop ? { crop: sourceCrop.actual, previewCrop: previewCrop!.actual } : {}) });
    }
    return result;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
  }
}
