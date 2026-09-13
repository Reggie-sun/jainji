import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FfmpegAdapter } from "./ffmpeg.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";
import { fingerprintFile } from "./paths.js";

export async function stickerPreview(ffmpeg: FfmpegAdapter, asset: BuiltinStickerAsset, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (await fingerprintFile(asset.assetPath) !== asset.assetFingerprint) throw new Error("贴纸已发生变化，请重新开始。");
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-sticker-preview-"));
  try {
    signal.throwIfAborted();
    const output = path.join(directory, "preview.jpg");
    const command = ffmpeg.run([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", "color=c=0xeeeeee:s=256x256",
      "-threads", "1", "-i", asset.assetPath,
      "-filter_complex_threads", "1", "-filter_complex",
      "[1:v]scale=224:224:force_original_aspect_ratio=decrease[sticker];[0:v][sticker]overlay=(W-w)/2:(H-h)/2",
      "-frames:v", "1", "-threads", "1", "-q:v", "3", output,
    ]);
    const cancel = () => { void command.cancel().catch(() => undefined); };
    const timer = setTimeout(cancel, 20_000);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await command.promise;
      signal.throwIfAborted();
      if (result.code !== 0) throw new Error("贴纸预览生成失败，请重新开始。");
      const bytes = await readFile(output);
      if (!bytes.length || bytes.length > 200_000) throw new Error("贴纸预览无效。");
      return `data:image/jpeg;base64,${bytes.toString("base64")}`;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
