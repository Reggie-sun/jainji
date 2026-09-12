import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MediaItem } from "./domain.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import { fingerprintFile } from "./paths.js";

export async function extractAgentFrames(ffmpeg: FfmpegAdapter, media: MediaItem, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted();
  if (await fingerprintFile(media.sourcePath) !== media.fingerprint) throw new Error("素材已发生变化，请重新导入。");
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-frames-"));
  try {
    const frames: string[] = [];
    for (const fraction of [0.1, 0.5, 0.85]) {
      signal.throwIfAborted();
      const output = path.join(directory, `${frames.length}.jpg`);
      const command = ffmpeg.run([
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-ss", String(Math.max(0, (media.durationMs / 1000 - 0.1) * fraction)), "-threads", "1", "-i", media.sourcePath,
        "-frames:v", "1", "-filter_threads", "1", "-vf", "scale=640:640:force_original_aspect_ratio=decrease", "-threads", "1", "-q:v", "5", output,
      ]);
      const timeout = setTimeout(() => { void command.cancel().catch(() => undefined); }, 20_000);
      const abort = () => { void command.cancel().catch(() => undefined); };
      signal.addEventListener("abort", abort, { once: true });
      try {
        const result = await command.promise;
        signal.throwIfAborted();
        if (result.code !== 0) throw new Error("无法读取素材画面，请检查文件或重新导入。");
        const bytes = await readFile(output);
        if (bytes.length === 0 || bytes.length > 2_000_000) throw new Error("素材抽帧无效。");
        frames.push(`data:image/jpeg;base64,${bytes.toString("base64")}`);
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    }
    return frames;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
