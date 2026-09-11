import { stat } from "node:fs/promises";
import { now, type OutputArtifact } from "./domain.js";
import { FfmpegAdapter } from "./ffmpeg.js";

export class ArtifactVerifier {
  constructor(private readonly ffmpeg: FfmpegAdapter) {}

  async verify(filePath: string, taskId: string): Promise<OutputArtifact> {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0) throw new Error("artifact is empty");
    const probe = await this.ffmpeg.probe(filePath);
    const stream = probe.streams?.find((item) => item.codec_type === "video");
    if (!stream || !stream.width || !stream.height) throw new Error("artifact has no readable video track");
    const duration = Number(probe.format?.duration ?? stream.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("artifact has no valid duration");
    return {
      taskId,
      path: filePath,
      sizeBytes: info.size,
      durationMs: Math.round(duration * 1_000),
      createdAt: now(),
    };
  }
}
