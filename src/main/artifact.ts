import { stat } from "node:fs/promises";
import { now, type OutputArtifact, type MediaItem, type ExportPreset } from "./domain.js";
import type { FissionSettings } from "../shared/video-fission.js";
import { outputDimensions } from "../shared/export-settings.js";
import { FfmpegAdapter } from "./ffmpeg.js";

export class ArtifactVerifier {
  constructor(private readonly ffmpeg: FfmpegAdapter) {}

  async verify(filePath: string, taskId: string, fission?: { media: MediaItem; preset: ExportPreset; settings: FissionSettings }): Promise<OutputArtifact> {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0) throw new Error("artifact is empty");
    const probe = await this.ffmpeg.probe(filePath);
    const stream = probe.streams?.find((item) => item.codec_type === "video");
    if (!stream || !stream.width || !stream.height) throw new Error("artifact has no readable video track");
    const duration = Number(probe.format?.duration ?? stream.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("artifact has no valid duration");
    if (fission) {
      const { media, preset, settings } = fission;
      const size = outputDimensions(media, preset);
      if (stream.width !== size.width || stream.height !== size.height || stream.codec_name !== "h264") throw new Error("裂变成片尺寸或编码不匹配。");
      const videoDuration = Number(stream.duration ?? duration);
      if (!Number.isFinite(videoDuration) || Math.abs(videoDuration - media.durationMs / 1000 / settings.speed) > 0.2) throw new Error("裂变成片时长不匹配。");
      const source = await this.ffmpeg.probe(media.sourcePath);
      const sourceAudio = source.streams?.filter(s => s.codec_type === "audio") ?? [];
      const outputAudio = probe.streams?.filter(s => s.codec_type === "audio") ?? [];
      if (sourceAudio.length !== outputAudio.length) throw new Error("裂变成片音轨数量不匹配。");
      for (const [i, audio] of outputAudio.entries()) {
        const sourceDuration = Number(sourceAudio[i].duration ?? source.format?.duration);
        const audioDuration = Number(audio.duration ?? probe.format?.duration);
        // Compilation caps every stream at the output video duration.
        const expected = Math.min(sourceDuration / settings.speed, media.durationMs / 1000 / settings.speed);
        if (audio.codec_name !== "aac" || !Number.isFinite(expected) || !Number.isFinite(audioDuration) || Math.abs(audioDuration - expected) > 0.2) throw new Error("裂变成片音频时长或编码不匹配。");
      }
    }
    return {
      taskId,
      path: filePath,
      sizeBytes: info.size,
      durationMs: Math.round(duration * 1_000),
      createdAt: now(),
    };
  }
}
