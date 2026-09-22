import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CoverRectangleSchema, type CoverRectangle } from "../shared/cover-sticker.js";
import type { KnowledgeEvidence, SourceIdentity } from "../shared/source-sticker-knowledge.js";
import type { MediaItem } from "./domain.js";
import { runCommand, type FfmpegAdapter, type RunningCommand } from "./ffmpeg.js";
import { identifySource } from "./source-sticker-knowledge-store.js";

const MAX_REQUESTS = 8;
const MAX_REVIEW_LOOPS = 5;
const MAX_RETAINED_REQUESTS = MAX_REQUESTS * MAX_REVIEW_LOOPS;
const MAX_IMAGE_BYTES = 2_000_000;
const MAX_DIMENSION = 1280;
const ID = /^[a-zA-Z0-9_-]{1,120}$/;
const DIGEST = /^[a-f0-9]{64}$/;

export interface EvidenceRequest { timeMs: number; crop?: CoverRectangle }
export interface SupervisorEvidenceImage {
  requestedTimeMs: number;
  timeMs: number;
  sourceUrl: string;
  previewUrl?: string;
  previewTimeMs?: number;
  crop?: CoverRectangle;
  previewCrop?: CoverRectangle;
  sourceEvidenceId?: string;
  previewEvidenceId?: string;
  fullSourceUrl?: string;
  fullPreviewUrl?: string;
  fullSourceEvidenceId?: string;
}
export interface EvidenceBinding { candidateId: string; factsDigest: string; templateDigest: string; outputSettingsDigest: string }
export interface SupervisorEvidenceHandoff { source: SourceIdentity; evidence: KnowledgeEvidence[]; blobs: Map<string, Buffer> }

interface DecodedFrame { index: number; pts: number; timeMs: number; width: number; height: number }
interface DecodedFrames { timeBase: string; timeOriginPts: number; frames: DecodedFrame[] }
interface ProbeOutput { streams?: Array<{ time_base?: string }>; frames?: Array<{ best_effort_timestamp?: string | number; width?: number; height?: number }> }
interface ExtractedImage { url: string; bytes: Buffer; width: number; height: number }
interface StoredSource { id: string; kind: "source"; bytes: Buffer; pts: number; timeMs: number; width: number; height: number; crop?: { sourceEvidenceId: string; rectangle: CoverRectangle } }
interface StoredPreview { id: string; kind: "preview"; bytes: Buffer; pts: number; timeMs: number; width: number; height: number; timeBase: string; timeOriginPts: number; sourceEvidenceId: string }
type StoredEvidence = StoredSource | StoredPreview;
interface ImageHandle { image: SupervisorEvidenceImage; snapshot: string; sourceEvidenceId: string; previewEvidenceId?: string }

function timeoutFor(media: MediaItem): number { return Math.max(20_000, Math.min(120_000, media.durationMs * 2)); }
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function validTimeBase(value: string | undefined): value is string {
  const parts = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(value ?? "");
  return Boolean(parts) && parts!.slice(1).every((part) => Number.isSafeInteger(Number(part)));
}
function timeMs(pts: number, originPts: number, timeBase: string): number {
  const [numerator, denominator] = timeBase.split("/").map(Number);
  return (pts - originPts) * numerator / denominator * 1000;
}
function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("监督证据帧格式无效。");
  for (let index = 2; index + 9 < bytes.length;) {
    if (bytes[index] !== 0xff) { index += 1; continue; }
    while (bytes[index] === 0xff) index += 1;
    const marker = bytes[index++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (index + 1 >= bytes.length) break;
    const length = bytes.readUInt16BE(index);
    if (length < 2 || index + length > bytes.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const height = bytes.readUInt16BE(index + 3), width = bytes.readUInt16BE(index + 5);
      if (width > 0 && height > 0) return { width, height };
      break;
    }
    index += length;
  }
  throw new Error("监督证据帧尺寸无效。");
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
  } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}
function nearest(frames: readonly DecodedFrame[], requestedTimeMs: number): DecodedFrame {
  let selected = frames[0];
  for (const frame of frames) if (Math.abs(frame.timeMs - requestedTimeMs) < Math.abs(selected.timeMs - requestedTimeMs)) selected = frame;
  if (!selected) throw new Error("视频没有可用的解码帧。");
  return selected;
}
function intervalAt(frames: readonly DecodedFrame[], index: number): number {
  const around = [frames[index - 1], frames[index + 1]].filter((frame): frame is DecodedFrame => Boolean(frame)).map((frame) => Math.abs(frame.timeMs - frames[index].timeMs)).filter((interval) => interval > 0);
  return around.length ? Math.min(...around) : 0;
}
function cropPixels(crop: CoverRectangle, width: number, height: number): { x: number; y: number; width: number; height: number; actual: CoverRectangle } {
  const x = Math.floor(crop.x * width), y = Math.floor(crop.y * height), right = Math.ceil((crop.x + crop.width) * width), bottom = Math.ceil((crop.y + crop.height) * height), croppedWidth = right - x, croppedHeight = bottom - y;
  if (x < 0 || y < 0 || right > width || bottom > height || croppedWidth < 2 || croppedHeight < 2) throw new Error("证据裁剪区域过小或超出画面。");
  return { x, y, width: croppedWidth, height: croppedHeight, actual: { x: x / width, y: y / height, width: croppedWidth / width, height: croppedHeight / height } };
}
function previewCropPixels(sourceCrop: CoverRectangle, sourceWidth: number, sourceHeight: number, previewWidth: number, previewHeight: number) {
  const scale = Math.min(previewWidth / sourceWidth, previewHeight / sourceHeight);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("渲染预览画面尺寸无效。");
  const paddingX = (previewWidth - sourceWidth * scale) / 2, paddingY = (previewHeight - sourceHeight * scale) / 2;
  return cropPixels({ x: (paddingX + sourceCrop.x * sourceWidth * scale) / previewWidth, y: (paddingY + sourceCrop.y * sourceHeight * scale) / previewHeight, width: sourceCrop.width * sourceWidth * scale / previewWidth, height: sourceCrop.height * sourceHeight * scale / previewHeight }, previewWidth, previewHeight);
}
function uprightFilters(rotation: MediaItem["rotation"]): string[] {
  if (rotation === 90) return ["transpose=1"];
  if (rotation === 180) return ["hflip", "vflip"];
  if (rotation === 270) return ["transpose=2"];
  return [];
}

/** Extracts bounded decoded evidence and owns only in-memory bytes until handoff. */
export class SupervisorEvidence {
  private directory?: string;
  private disposed = false;
  private readonly records = new Map<string, StoredEvidence>();
  private readonly handles = new WeakMap<SupervisorEvidenceImage, ImageHandle>();
  private source?: SourceIdentity;
  private retainedRequests = 0;

  constructor(private readonly ffmpeg: FfmpegAdapter, private readonly media: MediaItem) {}
  private ensureOpen(): void { if (this.disposed) throw new Error("监督证据已释放。"); }

  private async frames(filePath: string, signal: AbortSignal): Promise<DecodedFrames> {
    const result = await bounded(runCommand(this.ffmpeg.ffprobePath, ["-v", "error", "-select_streams", "v:0", "-show_streams", "-show_frames", "-show_entries", "stream=time_base:frame=best_effort_timestamp,width,height", "-of", "json", filePath]), signal, timeoutFor(this.media));
    if (result.code !== 0) throw new Error("无法读取视频帧时间信息。");
    let output: ProbeOutput;
    try { output = JSON.parse(result.stdout) as ProbeOutput; } catch { throw new Error("视频帧时间信息无效。"); }
    const base = output.streams?.[0]?.time_base;
    if (!validTimeBase(base)) throw new Error("视频缺少可用的帧时间基。");
    const raw = (output.frames ?? []).flatMap((frame, index) => {
      const pts = Number(frame.best_effort_timestamp), width = Number(frame.width), height = Number(frame.height);
      return Number.isSafeInteger(pts) && Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 ? [{ index, pts, width, height }] : [];
    });
    if (!raw.length) throw new Error("视频没有可用的解码帧。");
    const timeOriginPts = raw[0].pts;
    return { timeBase: base, timeOriginPts, frames: raw.map((frame) => ({ ...frame, timeMs: timeMs(frame.pts, timeOriginPts, base) })) };
  }
  private async identity(info: DecodedFrames, signal: AbortSignal): Promise<SourceIdentity> {
    signal.throwIfAborted();
    const source = await identifySource(this.media.sourcePath, { width: this.media.width, height: this.media.height, rotation: this.media.rotation, durationMs: Math.round(this.media.durationMs), timeBase: info.timeBase, timeOriginPts: info.timeOriginPts, interpretationVersion: 1 });
    if (source.fingerprint !== this.media.fingerprint) throw new Error("素材已发生变化，请重新导入后监督。");
    return source;
  }
  async sourceIdentity(signal: AbortSignal): Promise<SourceIdentity> {
    this.ensureOpen(); signal.throwIfAborted();
    const identity = await this.identity(await this.frames(this.media.sourcePath, signal), signal);
    if (this.source && JSON.stringify(this.source) !== JSON.stringify(identity)) throw new Error("素材解释发生变化，已停止监督。");
    return { ...identity };
  }
  private async root(): Promise<string> { if (!this.directory) this.directory = await mkdtemp(path.join(tmpdir(), "jianji-supervisor-evidence-")); return this.directory; }
  private async image(filePath: string, frame: DecodedFrame, crop: { x: number; y: number; width: number; height: number } | undefined, signal: AbortSignal, rotation: MediaItem["rotation"] = 0): Promise<ExtractedImage> {
    const output = path.join(await this.root(), `${randomUUID()}.jpg`), filters = [`select='eq(n\\,${frame.index})'`];
    signal.throwIfAborted();
    filters.push(...uprightFilters(rotation));
    if (crop) filters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1`);
    filters.push(`scale=w='min(iw,${MAX_DIMENSION})':h='min(ih,${MAX_DIMENSION})':force_original_aspect_ratio=decrease`);
    try {
      const result = await bounded(this.ffmpeg.run(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-noautorotate", "-i", filePath, "-vf", filters.join(","), "-fps_mode", "passthrough", "-frames:v", "1", "-q:v", "5", output]), signal, timeoutFor(this.media));
      if (result.code !== 0) throw new Error("无法抽取监督证据帧。");
      const bytes = await readFile(output);
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("监督证据帧无效或过大。");
      return { url: `data:image/jpeg;base64,${bytes.toString("base64")}`, bytes, ...jpegDimensions(bytes) };
    } finally { await unlink(output).catch(() => undefined); }
  }
  private sourceRecord(image: ExtractedImage, frame: DecodedFrame, crop?: { sourceEvidenceId: string; rectangle: CoverRectangle }): StoredSource {
    return { id: `source-${randomUUID()}`, kind: "source", bytes: Buffer.from(image.bytes), pts: frame.pts, timeMs: frame.timeMs, width: image.width, height: image.height, ...(crop ? { crop } : {}) };
  }
  private previewRecord(image: ExtractedImage, frame: DecodedFrame, info: DecodedFrames, sourceEvidenceId: string): StoredPreview {
    return { id: `preview-${randomUUID()}`, kind: "preview", bytes: Buffer.from(image.bytes), pts: frame.pts, timeMs: frame.timeMs, width: image.width, height: image.height, timeBase: info.timeBase, timeOriginPts: info.timeOriginPts, sourceEvidenceId };
  }
  private retain(records: readonly StoredEvidence[], handle: ImageHandle): void {
    for (const record of records) { if (this.records.has(record.id)) throw new Error("监督证据记录冲突。"); this.records.set(record.id, record); }
    this.handles.set(handle.image, handle);
  }

  async inspect(requests: readonly EvidenceRequest[], signal: AbortSignal, previewPath?: string): Promise<SupervisorEvidenceImage[]> {
    this.ensureOpen(); signal.throwIfAborted();
    if (!requests.length || requests.length > MAX_REQUESTS) throw new Error("每次监督证据请求应为 1 至 8 帧。");
    if (this.retainedRequests + requests.length > MAX_RETAINED_REQUESTS) throw new Error("监督证据保留已达本版本检查上限。");
    for (const request of requests) { if (!Number.isFinite(request.timeMs) || request.timeMs < 0 || request.timeMs >= this.media.durationMs) throw new Error("监督证据时间超出素材范围。"); if (request.crop) CoverRectangleSchema.parse(request.crop); }
    const sourceInfo = await this.frames(this.media.sourcePath, signal), sourceIdentity = await this.identity(sourceInfo, signal);
    if (this.source && JSON.stringify(this.source) !== JSON.stringify(sourceIdentity)) throw new Error("素材解释发生变化，已停止监督。");
    const previewInfo = previewPath ? await this.frames(previewPath, signal) : undefined, sourceWidth = this.media.width, sourceHeight = this.media.height;
    if (!Number.isInteger(sourceWidth) || sourceWidth < 2 || !Number.isInteger(sourceHeight) || sourceHeight < 2) throw new Error("素材画面尺寸无效。");
    const result: SupervisorEvidenceImage[] = [];
    const retained: Array<{ records: StoredEvidence[]; image: SupervisorEvidenceImage; handle: ImageHandle }> = [];
    for (const request of requests) {
      signal.throwIfAborted();
      const source = nearest(sourceInfo.frames, request.timeMs);
      if (Math.abs(source.timeMs - request.timeMs) > 250) throw new Error("请求时间附近没有可用的源视频帧，已停止监督。");
      const sourceCrop = request.crop ? cropPixels(request.crop, sourceWidth, sourceHeight) : undefined;
      const fullSourceImage = await this.image(this.media.sourcePath, source, undefined, signal, this.media.rotation), sourceImage = sourceCrop ? await this.image(this.media.sourcePath, source, sourceCrop, signal, this.media.rotation) : fullSourceImage;
      const fullSource = this.sourceRecord(fullSourceImage, source), displayedSource = sourceCrop ? this.sourceRecord(sourceImage, source, { sourceEvidenceId: fullSource.id, rectangle: sourceCrop.actual }) : fullSource;
      const records: StoredEvidence[] = sourceCrop ? [fullSource, displayedSource] : [fullSource];
      let previewUrl: string | undefined, previewTimeMs: number | undefined, previewCrop: CoverRectangle | undefined, previewEvidenceId: string | undefined, fullPreviewUrl: string | undefined;
      if (previewInfo && previewPath) {
        const preview = nearest(previewInfo.frames, source.timeMs), previewIndex = previewInfo.frames.indexOf(preview), tolerance = Math.min(250, Math.max(50, intervalAt(previewInfo.frames, previewIndex)));
        if (Math.abs(preview.timeMs - source.timeMs) > tolerance) throw new Error("渲染预览与素材帧时间不一致，已停止监督。");
        const mappedCrop = sourceCrop ? previewCropPixels(sourceCrop.actual, sourceWidth, sourceHeight, preview.width, preview.height) : undefined;
        const fullPreviewImage = await this.image(previewPath, preview, undefined, signal), displayedPreview = mappedCrop ? await this.image(previewPath, preview, mappedCrop, signal) : fullPreviewImage;
        const fullPreview = this.previewRecord(fullPreviewImage, preview, previewInfo, fullSource.id);
        records.push(fullPreview); previewUrl = displayedPreview.url; previewTimeMs = preview.timeMs; previewCrop = mappedCrop?.actual; previewEvidenceId = fullPreview.id; fullPreviewUrl = mappedCrop ? fullPreviewImage.url : undefined;
      }
      const image = Object.freeze({ requestedTimeMs: request.timeMs, timeMs: source.timeMs, sourceUrl: sourceImage.url, ...(previewUrl ? { previewUrl, previewTimeMs, previewEvidenceId } : {}), ...(sourceCrop ? { crop: sourceCrop.actual, fullSourceUrl: fullSourceImage.url, fullSourceEvidenceId: fullSource.id } : {}), ...(previewCrop ? { previewCrop, fullPreviewUrl } : {}), sourceEvidenceId: displayedSource.id }) as SupervisorEvidenceImage;
      retained.push({ records, image, handle: { image, snapshot: JSON.stringify(image), sourceEvidenceId: displayedSource.id, ...(previewEvidenceId ? { previewEvidenceId } : {}) } }); result.push(image);
    }
    signal.throwIfAborted();
    const finalIdentity = await this.identity(await this.frames(this.media.sourcePath, signal), signal);
    if (JSON.stringify(finalIdentity) !== JSON.stringify(sourceIdentity)) throw new Error("素材在证据抽取期间发生变化，已停止监督。");
    this.ensureOpen(); for (const item of retained) this.retain(item.records, item.handle);
    this.source = sourceIdentity; this.retainedRequests += requests.length;
    return result;
  }

  capture(images: readonly SupervisorEvidenceImage[], binding: EvidenceBinding): SupervisorEvidenceHandoff {
    this.ensureOpen();
    if (!images.length) throw new Error("监督证据交接至少需要一帧。");
    if (!ID.test(binding.candidateId) || ![binding.factsDigest, binding.templateDigest, binding.outputSettingsDigest].every((value) => DIGEST.test(value))) throw new Error("监督证据绑定无效。");
    if (!this.source) throw new Error("监督证据尚未完成抽取。");
    const needed = new Set<string>();
    for (const image of images) {
      const handle = this.handles.get(image);
      if (!handle || handle.image !== image || handle.snapshot !== JSON.stringify(image)) throw new Error("监督证据引用无效。");
      needed.add(handle.sourceEvidenceId); if (handle.previewEvidenceId) needed.add(handle.previewEvidenceId);
    }
    for (const id of [...needed]) {
      const record = this.records.get(id);
      if (!record) throw new Error("监督证据记录缺失。");
      if (record.kind === "source" && record.crop) needed.add(record.crop.sourceEvidenceId);
      if (record.kind === "preview") needed.add(record.sourceEvidenceId);
    }
    const evidence: KnowledgeEvidence[] = [], blobs = new Map<string, Buffer>();
    for (const record of this.records.values()) {
      if (!needed.has(record.id)) continue;
      const bytes = Buffer.from(record.bytes), frame = { id: record.id, digest: digest(bytes), byteLength: bytes.length, pts: record.pts, timeMs: record.timeMs, width: record.width, height: record.height };
      const item: KnowledgeEvidence = record.kind === "source"
        ? { ...frame, kind: "source", ...(record.crop ? { crop: { sourceEvidenceId: record.crop.sourceEvidenceId, rectangle: { ...record.crop.rectangle } } } : {}) }
        : { ...frame, kind: "preview", sourceEvidenceId: record.sourceEvidenceId, candidateId: binding.candidateId, timeBase: record.timeBase, timeOriginPts: record.timeOriginPts, factsDigest: binding.factsDigest, templateDigest: binding.templateDigest, outputSettingsDigest: binding.outputSettingsDigest };
      evidence.push(item); blobs.set(frame.digest, Buffer.from(bytes));
    }
    return { source: { ...this.source }, evidence, blobs };
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.records.clear();
    this.source = undefined;
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
  }
}
