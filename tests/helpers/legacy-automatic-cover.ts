/** Historical algorithm fixture for pixel-level regression coverage; production uses source-sticker-recognition. */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { COVER_DETECTION_WINDOW, COVER_SAMPLE_INTERVAL_MS, type CoverDetectionImage, type DetectedCoverFrame } from "../../src/shared/automatic-cover.js";
import { fingerprintFile } from "../../src/main/paths.js";
import { ProviderError } from "../../src/main/api-transport.js";
import type { FfmpegAdapter } from "../../src/main/ffmpeg.js";
import type { MediaItem } from "../../src/main/domain.js";
import { automaticCoverTracks, type AutomaticCoverTrack } from "../../src/main/automatic-cover-tracks.js";

type Detect = (images: readonly CoverDetectionImage[], previous: DetectedCoverFrame | undefined, signal: AbortSignal) => Promise<DetectedCoverFrame[]>;

export async function recognizeAutomaticCovers(ffmpeg: FfmpegAdapter, media: MediaItem, detect: Detect, signal: AbortSignal, horizonMs = media.durationMs): Promise<AutomaticCoverTrack[]> {
  signal.throwIfAborted();
  const durationMs = Math.min(media.durationMs, horizonMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new ProviderError("识别时段无效。");
  if (await fingerprintFile(media.sourcePath) !== media.fingerprint) throw new ProviderError("素材已发生变化，请重新导入后识别原贴纸。");
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-detection-"));
  try {
    const command = ffmpeg.run(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "1", "-i", media.sourcePath,
      "-t", String(durationMs / 1000), "-vf", "fps=4:start_time=0:round=up,scale=w='min(iw,1280)':h='min(ih,1280)':force_original_aspect_ratio=decrease", "-fps_mode", "passthrough", "-filter_threads", "1", "-threads", "1", "-q:v", "4", path.join(directory, "%08d.jpg")]);
    const abort = () => { void command.cancel().catch(() => undefined); };
    const timeout = setTimeout(abort, Math.max(30_000, media.durationMs * 2));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    try {
      const result = await command.promise;
      signal.throwIfAborted();
      if (result.code !== 0) throw new ProviderError("原贴纸识别抽帧失败，本条已停止。请检查素材后重试。");
    } finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
    const files = (await readdir(directory)).filter((name) => /^\d{8}\.jpg$/.test(name)).sort();
    if (!files.length) throw new ProviderError("素材过短或无法读取原贴纸识别画面，本条已停止。");
    const detected: DetectedCoverFrame[] = [];
    for (let offset = 0; offset < files.length; offset += COVER_DETECTION_WINDOW - 1) {
      signal.throwIfAborted();
      const images: CoverDetectionImage[] = [];
      for (let index = offset; index < Math.min(files.length, offset + COVER_DETECTION_WINDOW); index++) {
        const bytes = await readFile(path.join(directory, files[index]));
        if (!bytes.length || bytes.length > 2_000_000) throw new ProviderError("自动识别抽帧无效。");
        images.push({ timeMs: Math.min(durationMs - 1, index * COVER_SAMPLE_INTERVAL_MS), url: `data:image/jpeg;base64,${bytes.toString("base64")}` });
      }
      const previous = detected.at(-1);
      const result = await detect(images, previous, signal);
      signal.throwIfAborted();
      if (previous) detected[detected.length - 1] = result[0];
      detected.push(...(previous ? result.slice(1) : result));
      if (offset + COVER_DETECTION_WINDOW >= files.length) break;
    }
    return automaticCoverTracks(detected, durationMs);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
