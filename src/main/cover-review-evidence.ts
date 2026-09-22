import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, realpath, stat, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { CoverEvidenceSchema, type CoverEvidence } from "../shared/cover-review.js";
import { CoverRectangleSchema, type CoverRectangle } from "../shared/cover-sticker.js";
import type { CoverDetectionImage } from "../shared/automatic-cover.js";
import type { MediaItem } from "./domain.js";
import { runCommand, type FfmpegAdapter, type RunningCommand } from "./ffmpeg.js";
import { fingerprintFile } from "./paths.js";

const SAMPLE_INTERVAL_MS = 250;
const MAX_DETECTOR_DIMENSION = 1280;
const MAX_FRAMES_PER_EXTRACTION = 64;

interface ProbeFrame { index: number; pts: number; timeBase: number; timeMs: number; timeOriginSeconds: number; width: number; height: number }
interface ProbeOutput { streams?: Array<{ time_base?: string }>; frames?: Array<{ best_effort_timestamp?: string | number; best_effort_timestamp_time?: string | number; width?: number; height?: number }> }
export interface CoverEvidenceCropRegion { evidenceId: string; rectangle: CoverRectangle }
export interface CoverEvidenceCrop { evidenceId: string; url: string; width: number; height: number; transform: { scaleX: number; scaleY: number; offsetX: number; offsetY: number } }

function timeBase(value: string | undefined): number | undefined {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match || Number(match[2]) === 0) return;
  return Number(match[1]) / Number(match[2]);
}

function contained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function digest(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject); input.once("end", resolve);
  });
  return hash.digest("hex");
}

async function cancellable(command: RunningCommand, signal: AbortSignal): Promise<{ code: number }> {
  const abort = () => { void command.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try { const result = await command.promise; signal.throwIfAborted(); return result; }
  finally { signal.removeEventListener("abort", abort); }
}

/** Owns retained cover-review evidence below one project-controlled directory. */
export class CoverReviewEvidence {
  constructor(private readonly rootDirectory: string, private readonly ffmpeg: FfmpegAdapter) {}

  private async frames(media: MediaItem, signal: AbortSignal): Promise<ProbeFrame[]> {
    const command = runCommand(this.ffmpeg.ffprobePath, [
      "-v", "error", "-select_streams", "v:0", "-show_streams", "-show_frames",
      "-show_entries", "stream=time_base:frame=best_effort_timestamp,best_effort_timestamp_time,width,height", "-of", "json", media.sourcePath,
    ]);
    const result = await cancellable(command, signal);
    if (result.code !== 0) throw new Error("无法读取素材帧时间信息。");
    let output: ProbeOutput;
    try { output = JSON.parse((await command.promise).stdout) as ProbeOutput; } catch { throw new Error("素材帧时间信息无效。"); }
    const base = timeBase(output.streams?.[0]?.time_base);
    if (!base) throw new Error("素材缺少可用的帧时间基。");
    const frames: ProbeFrame[] = [];
    for (const [index, frame] of (output.frames ?? []).entries()) {
      const pts = Number(frame.best_effort_timestamp);
      const decodedTime = Number(frame.best_effort_timestamp_time);
      const width = Number(frame.width), height = Number(frame.height);
      if (!Number.isFinite(pts) || !Number.isFinite(decodedTime) || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) continue;
      frames.push({ index, pts, timeBase: base, timeMs: decodedTime * 1000, timeOriginSeconds: 0, width, height });
    }
    if (!frames.length) throw new Error("素材没有可用的视频帧。");
    const origin = frames[0].timeMs / 1000;
    return frames.map((frame) => ({ ...frame, timeMs: frame.timeMs - origin * 1000, timeOriginSeconds: origin }));
  }

  async extract(media: MediaItem, draftId: string, revision: number, signal: AbortSignal): Promise<{ evidence: CoverEvidence[]; images: CoverDetectionImage[]; frameTimesMs: number[] }> {
    signal.throwIfAborted();
    if (!Number.isInteger(revision) || revision < 0) throw new Error("审阅修订无效。");
    if (await fingerprintFile(media.sourcePath) !== media.fingerprint) throw new Error("素材已发生变化，请重新导入后分析。");
    const frames = await this.frames(media, signal);
    const samples: ProbeFrame[] = [];
    let nextSample = 0;
    for (const frame of frames) if (frame.timeMs >= nextSample) { samples.push(frame); nextSample = frame.timeMs + SAMPLE_INTERVAL_MS; }
    const directory = path.join(this.rootDirectory, draftId, `r-${revision}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filesystem = await statfs(directory);
    const estimate = samples.reduce((total, frame) => total + frame.width * frame.height, 0);
    if (filesystem.bavail * filesystem.bsize < estimate) throw new Error("审阅证据磁盘空间不足。");
    const prefix = randomUUID();
    const cleanupAttempt = async () => { await Promise.all((await readdir(directory)).filter((name) => name.startsWith(prefix)).map((name) => unlink(path.join(directory, name)).catch(() => undefined))); };
    try {
    for (let offset = 0; offset < samples.length; offset += MAX_FRAMES_PER_EXTRACTION) {
      const batch = samples.slice(offset, offset + MAX_FRAMES_PER_EXTRACTION);
      // Keep each extraction bounded and its selector tree shallow enough for
      // FFmpeg's expression recursion limit.
      let terms = batch.map((frame) => `eq(n\\,${frame.index})`);
      while (terms.length > 1) terms = Array.from({ length: Math.ceil(terms.length / 2) }, (_, index) => terms[index * 2 + 1] === undefined ? terms[index * 2] : `(${terms[index * 2]}+${terms[index * 2 + 1]})`);
      const selectors = terms[0];
      const batchIndex = String(offset / MAX_FRAMES_PER_EXTRACTION).padStart(4, "0");
      const originalPattern = path.join(directory, `${prefix}-${batchIndex}-%08d.png`);
      const extracted = await cancellable(this.ffmpeg.run(["-hide_banner", "-loglevel", "error", "-nostdin", "-i", media.sourcePath, "-vf", `select='${selectors}'`, "-fps_mode", "passthrough", originalPattern]), signal);
      if (extracted.code !== 0) throw new Error("无法抽取审阅证据帧。");
    }
    const files = (await readdir(directory)).filter((name) => new RegExp(`^${prefix}-\\d{4}-\\d{8}\\.png$`).test(name)).sort();
    if (files.length !== samples.length) throw new Error("审阅证据帧不完整。");
    const evidence: CoverEvidence[] = [], images: CoverDetectionImage[] = [];
    for (const [index, name] of files.entries()) {
      signal.throwIfAborted();
      const source = path.join(directory, name), detector = path.join(directory, `${prefix}-detector-${index}.jpg`);
      const scaled = await cancellable(this.ffmpeg.run(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", source, "-vf", `scale=w='min(iw,${MAX_DETECTOR_DIMENSION})':h='min(ih,${MAX_DETECTOR_DIMENSION})':force_original_aspect_ratio=decrease`, "-frames:v", "1", "-q:v", "4", detector]), signal);
      if (scaled.code !== 0) throw new Error("无法准备审阅候选帧。");
      const sample = samples[index], detectorBytes = await readFile(detector), dimensions = await stat(source);
      if (!detectorBytes.length || !dimensions.size) throw new Error("审阅候选帧无效。");
      const detectorScale = Math.min(1, MAX_DETECTOR_DIMENSION / Math.max(sample.width, sample.height));
      evidence.push(CoverEvidenceSchema.parse({ id: randomUUID(), relativePath: `${draftId}/r-${revision}/${name}`, digest: await digest(source), pts: sample.pts, timeBase: sample.timeBase, timeOriginSeconds: sample.timeOriginSeconds, width: media.width, height: media.height, rotation: media.rotation, transform: { scaleX: detectorScale, scaleY: detectorScale, offsetX: 0, offsetY: 0 } }));
      // The detector needs integer labels. Ordered images map to their matching
      // evidence entry, which retains the exact decoded PTS.
      images.push({ timeMs: Math.round(sample.timeMs), url: `data:image/jpeg;base64,${detectorBytes.toString("base64")}` });
      await unlink(detector).catch(() => undefined);
    }
    return { evidence, images, frameTimesMs: frames.map((frame) => frame.timeMs) };
    } catch (error) { await cleanupAttempt(); throw error; }
  }

  async verify(evidence: readonly CoverEvidence[]): Promise<void> {
    if (!evidence.length) return;
    const root = await realpath(this.rootDirectory);
    for (const item of evidence) {
      const parsed = CoverEvidenceSchema.parse(item);
      const candidate = path.resolve(this.rootDirectory, parsed.relativePath);
      if (!contained(path.resolve(this.rootDirectory), candidate)) throw new Error("审阅证据路径无效。");
      let resolved: string;
      try { resolved = await realpath(candidate); } catch { throw new Error("审阅证据文件缺失。"); }
      if (!contained(root, resolved) || !(await stat(resolved)).isFile() || await digest(resolved) !== parsed.digest) throw new Error("审阅证据校验失败。");
    }
  }

  async images(evidence: readonly CoverEvidence[], signal: AbortSignal): Promise<CoverDetectionImage[]> {
    await this.verify(evidence); const images: CoverDetectionImage[] = [];
    for (const item of evidence) {
      signal.throwIfAborted(); const source = path.join(this.rootDirectory, item.relativePath), temporary = `${source}.${randomUUID()}.jpg`;
      try {
        const result = await cancellable(this.ffmpeg.run(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", source, "-vf", `scale=w='min(iw,${MAX_DETECTOR_DIMENSION})':h='min(ih,${MAX_DETECTOR_DIMENSION})':force_original_aspect_ratio=decrease`, "-frames:v", "1", "-q:v", "4", temporary]), signal);
        if (result.code !== 0) throw new Error("无法读取审阅证据帧。"); const bytes = await readFile(temporary); if (!bytes.length) throw new Error("审阅证据帧无效。"); images.push({ timeMs: Math.round((item.pts * item.timeBase - (item.timeOriginSeconds ?? 0)) * 1000), url: `data:image/jpeg;base64,${bytes.toString("base64")}` });
      } finally { await unlink(temporary).catch(() => undefined); }
    }
    return images;
  }

  async crops(evidence: readonly CoverEvidence[], regions: readonly CoverEvidenceCropRegion[], signal: AbortSignal): Promise<CoverEvidenceCrop[]> {
    await this.verify(evidence);
    const byId = new Map(evidence.map((item) => [item.id, item]));
    const result: CoverEvidenceCrop[] = [];
    for (const region of regions) {
      signal.throwIfAborted();
      const item = byId.get(region.evidenceId);
      if (!item) throw new Error("裁剪证据引用无效。");
      const rectangle = CoverRectangleSchema.parse(region.rectangle);
      const padding = 0.1, x = Math.max(0, rectangle.x - padding), y = Math.max(0, rectangle.y - padding);
      const right = Math.min(1, rectangle.x + rectangle.width + padding), bottom = Math.min(1, rectangle.y + rectangle.height + padding);
      const leftPx = Math.max(0, Math.min(item.width - 1, Math.floor(x * item.width))), topPx = Math.max(0, Math.min(item.height - 1, Math.floor(y * item.height)));
      const rightPx = Math.max(leftPx + 1, Math.min(item.width, Math.ceil(right * item.width))), bottomPx = Math.max(topPx + 1, Math.min(item.height, Math.ceil(bottom * item.height)));
      const width = rightPx - leftPx, height = bottomPx - topPx;
      const source = path.join(this.rootDirectory, item.relativePath), output = `${source}.${randomUUID()}.crop.jpg`;
      try {
        const command = await cancellable(this.ffmpeg.run(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", source, "-vf", `crop=${width}:${height}:${leftPx}:${topPx}:exact=1`, "-frames:v", "1", "-q:v", "3", output]), signal);
        if (command.code !== 0) throw new Error("无法准备审阅裁剪。");
        const bytes = await readFile(output);
        if (!bytes.length) throw new Error("审阅裁剪无效。");
        result.push({ evidenceId: item.id, url: `data:image/jpeg;base64,${bytes.toString("base64")}`, width, height, transform: { scaleX: width / item.width, scaleY: height / item.height, offsetX: leftPx / item.width, offsetY: topPx / item.height } });
      } finally { await unlink(output).catch(() => undefined); }
    }
    return result;
  }

  async discardUnreferenced(evidence: readonly CoverEvidence[], retained: readonly CoverEvidence[]): Promise<void> {
    const parsedEvidence = evidence.map((item) => CoverEvidenceSchema.parse(item));
    const keep = new Set(retained.map((item) => CoverEvidenceSchema.parse(item).id));
    if (retained.some((item) => !parsedEvidence.some((candidate) => candidate.id === item.id))) throw new Error("保留审阅证据引用无效。");
    await this.verify(parsedEvidence);
    for (const item of parsedEvidence) if (!keep.has(item.id)) await unlink(path.resolve(this.rootDirectory, item.relativePath));
  }
}
