import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FfmpegAdapter } from "./ffmpeg.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";
import { fingerprintFile } from "./paths.js";

export interface StickerContactSheet {
  stickerIds: readonly string[];
  url: string;
  columns: number;
}

const CONTACT_SHEET_COLUMNS = 5;
const CONTACT_SHEET_CAPACITY = 25;
const CONTACT_SHEET_CELL_SIZE = 192;
const CONTACT_SHEET_STICKER_SIZE = 160;
const CONTACT_SHEET_MAX_BYTES = 2_000_000;

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

export async function stickerContactSheets(
  ffmpeg: FfmpegAdapter,
  stickers: readonly { id: string; asset: BuiltinStickerAsset }[],
  signal: AbortSignal,
): Promise<StickerContactSheet[]> {
  const sheets: StickerContactSheet[] = [];
  for (let offset = 0; offset < stickers.length; offset += CONTACT_SHEET_CAPACITY) {
    const batch = stickers.slice(offset, offset + CONTACT_SHEET_CAPACITY);
    signal.throwIfAborted();
    for (const { asset } of batch) {
      signal.throwIfAborted();
      if (await fingerprintFile(asset.assetPath) !== asset.assetFingerprint) throw new Error("贴纸已发生变化，请重新开始。");
    }

    const directory = await mkdtemp(path.join(tmpdir(), "jianji-sticker-contact-sheet-"));
    try {
      signal.throwIfAborted();
      const output = path.join(directory, "contact-sheet.jpg");
      const columns = Math.min(CONTACT_SHEET_COLUMNS, batch.length);
      const filters = batch.map((_, index) =>
        `[${index}:v]scale=${CONTACT_SHEET_STICKER_SIZE}:${CONTACT_SHEET_STICKER_SIZE}:force_original_aspect_ratio=decrease[scaled${index}];` +
        `color=c=0xeeeeee:s=${CONTACT_SHEET_CELL_SIZE}x${CONTACT_SHEET_CELL_SIZE}:r=1:d=1[bg${index}];` +
        `[bg${index}][scaled${index}]overlay=(W-w)/2:(H-h)/2:shortest=1,format=rgb24[sticker${index}]`,
      );
      const layout = batch.map((_, index) => `${(index % columns) * CONTACT_SHEET_CELL_SIZE}_${Math.floor(index / columns) * CONTACT_SHEET_CELL_SIZE}`).join("|");
      filters.push(batch.length === 1
        ? "[sticker0]null[sheet]"
        : `${batch.map((_, index) => `[sticker${index}]`).join("")}xstack=inputs=${batch.length}:layout=${layout}:fill=0xeeeeee[sheet]`);
      const command = ffmpeg.run([
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        ...batch.flatMap(({ asset }) => ["-i", asset.assetPath]),
        "-filter_complex_threads", "1", "-filter_complex", filters.join(";"),
        "-map", "[sheet]", "-frames:v", "1", "-threads", "1", "-q:v", "4", output,
      ]);
      const cancel = () => { void command.cancel().catch(() => undefined); };
      const timer = setTimeout(cancel, 20_000);
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const result = await command.promise;
        signal.throwIfAborted();
        if (result.code !== 0) throw new Error("贴纸预览生成失败，请重新开始。");
        const bytes = await readFile(output);
        if (!bytes.length || bytes.length > CONTACT_SHEET_MAX_BYTES) throw new Error("贴纸预览无效。");
        for (const { asset } of batch) {
          signal.throwIfAborted();
          if (await fingerprintFile(asset.assetPath) !== asset.assetFingerprint) throw new Error("贴纸已发生变化，请重新开始。");
        }
        sheets.push({ stickerIds: batch.map(({ id }) => id), columns, url: `data:image/jpeg;base64,${bytes.toString("base64")}` });
      } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  return sheets;
}
