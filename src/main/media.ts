import { stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { now, type MediaItem } from "./domain.js";
import { fingerprintFile } from "./paths.js";
import { FfmpegAdapter } from "./ffmpeg.js";

const SUPPORTED_CONTAINERS = new Set([".mp4", ".mov", ".mkv", ".webm"]);
const SUPPORTED_VIDEO_CODECS = new Set(["av1", "cinepak", "flv1", "h263", "h264", "hevc", "mjpeg", "mpeg1video", "mpeg2video", "mpeg4", "msmpeg4v3", "prores", "theora", "vp8", "vp9", "vc1", "wmv3"]);

export interface MediaView extends Omit<MediaItem, "sourcePath"> {
  previewUrl: string;
}

function rotationFromProbe(stream: { tags?: { rotate?: string }; side_data_list?: Array<{ rotation?: number }> }): 0 | 90 | 180 | 270 {
  const raw = Number(stream.tags?.rotate ?? stream.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? 0);
  const normalized = ((Math.round(raw / 90) * 90) % 360 + 360) % 360;
  return (normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0) as 0 | 90 | 180 | 270;
}

export class MediaCatalog {
  constructor(private readonly ffmpeg: FfmpegAdapter) {}

  async probePaths(paths: readonly string[]): Promise<MediaItem[]> {
    return Promise.all(paths.map((sourcePath) => this.probeOne(sourcePath)));
  }

  async probeOne(sourcePath: string): Promise<MediaItem> {
    const displayName = path.basename(sourcePath);
    const base = {
      id: randomUUID(),
      sourcePath: path.resolve(sourcePath),
      displayName: displayName || "未命名素材",
      fingerprint: `unavailable:${Date.now()}`,
      sizeBytes: 0,
      durationMs: 0,
      width: 1,
      height: 1,
      rotation: 0 as const,
      probeStatus: "invalid" as const,
      importedAt: now(),
    };
    try {
      const extension = path.extname(sourcePath).toLowerCase();
      if (!SUPPORTED_CONTAINERS.has(extension)) throw new Error(`unsupported container: ${extension || "unknown"}`);
      const fileInfo = await stat(sourcePath);
      if (!fileInfo.isFile() || fileInfo.size === 0) throw new Error("input is empty or not a regular file");
      const probe = await this.ffmpeg.probe(sourcePath);
      const stream = probe.streams?.find((entry) => entry.codec_type === "video");
      if (!stream || !stream.width || !stream.height) throw new Error("missing video track");
      if (!stream.codec_name || !SUPPORTED_VIDEO_CODECS.has(stream.codec_name.toLowerCase())) throw new Error(`unsupported codec: ${stream.codec_name ?? "unknown"}`);
      const rotation = rotationFromProbe(stream);
      const width = rotation === 90 || rotation === 270 ? stream.height : stream.width;
      const height = rotation === 90 || rotation === 270 ? stream.width : stream.height;
      const duration = Number(probe.format?.duration ?? stream.duration ?? 0);
      return {
        ...base,
        fingerprint: await fingerprintFile(sourcePath),
        sizeBytes: fileInfo.size,
        durationMs: Math.max(0, Math.round(duration * 1_000)),
        width,
        height,
        rotation,
        probeStatus: "ready",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        errorCode: message.includes("missing video") ? "missing_video_track" : message.includes("unsupported codec") ? "codec_unsupported" : "probe_failed",
        errorMessage: message.slice(0, 2_000),
      };
    }
  }

  async revalidate(media: MediaItem): Promise<boolean> {
    try {
      const info = await stat(media.sourcePath);
      return info.isFile() && info.size > 0 && await fingerprintFile(media.sourcePath) === media.fingerprint;
    } catch { return false; }
  }
}

export function toMediaView(media: MediaItem): MediaView {
  const { sourcePath: _sourcePath, ...publicMedia } = media;
  return {
    ...publicMedia,
    previewUrl: `jianji-media://${encodeURIComponent(media.id)}`,
  };
}
