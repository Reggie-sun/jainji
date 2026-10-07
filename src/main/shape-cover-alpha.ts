import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { z } from "zod";
import { outputDimensions, type ExportSettings } from "../shared/export-settings.js";
import type { SourceIdentity } from "../shared/source-sticker-knowledge.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";
import type { PixelSize, SourceToOutput } from "./shape-cover-pixel-gate.js";
import { SHAPE_COVER_ALPHA_VERSION, MAX_FROZEN_SHAPE_BYTES } from "../shared/shape-cover.js";

export interface ShapeCoverPlacement extends PixelSize { x: number; y: number }
export interface ShapeCoverMediaTools { ffmpegPath: string; ffprobePath: string; signal?: AbortSignal }
export { SHAPE_COVER_ALPHA_VERSION } from "../shared/shape-cover.js";
const MAX_PIXELS = 16_777_216;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function mediaCommand(tools: ShapeCoverMediaTools, binary: string, args: string[], input?: Buffer, limit = 64 * 1024) {
  tools.signal?.throwIfAborted();
  return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [], errors: Buffer[] = [];
    let bytes = 0, errorBytes = 0, failure: string | undefined;
    const stop = (reason: string) => { failure = reason; child.kill("SIGKILL"); };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("media command timeout"), 20_000);
    const cleanup = () => { clearTimeout(timer); tools.signal?.removeEventListener("abort", abort); };
    tools.signal?.addEventListener("abort", abort, { once: true });
    if (tools.signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) stop("oversized media raster"); else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes > 64 * 1024) stop("oversized media diagnostics"); else errors.push(chunk);
    });
    child.stdin.on("error", () => stop("media input failed"));
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code) => {
      cleanup();
      if (failure || code !== 0) reject(new Error(failure ?? "media decode failed"));
      else resolve({ stdout: Buffer.concat(chunks), stderr: Buffer.concat(errors).toString("utf8") });
    });
    child.stdin.end(input);
  });
}

/** Read exactly the catalog-bound bytes. FFmpeg never reopens a mutable asset path. */
export async function readShapeCoverAsset(asset: BuiltinStickerAsset, tools: ShapeCoverMediaTools): Promise<Buffer> {
  tools.signal?.throwIfAborted();
  const file = await open(asset.assetPath, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size <= 0 || info.size > MAX_ASSET_BYTES) throw new Error("invalid local sticker asset");
    const bytes = Buffer.alloc(info.size + 1);
    const read = await file.read(bytes, 0, bytes.length, 0);
    const frozen = bytes.subarray(0, read.bytesRead);
    if (read.bytesRead !== info.size || `sha256:${digest(frozen)}` !== asset.assetFingerprint) throw new Error("sticker asset fingerprint mismatch");
    return frozen;
  } finally { await file.close(); }
}

/** Measure actual scale/pad rounding instead of accepting caller-supplied transforms. */
export async function measureShapeCoverOutput(sourcePath: string, source: SourceIdentity, settings: ExportSettings, tools: ShapeCoverMediaTools, autorotate = false): Promise<SourceToOutput> {
  const size = outputDimensions(source, settings);
  if (size.width * size.height > MAX_PIXELS || source.width * source.height > MAX_PIXELS) throw new Error("output raster exceeds pixel limit");
  if (settings.resolutionMode === "source") return { ...size, scaledWidth: source.width, scaledHeight: source.height, padLeft: 0, padTop: 0 };
  const result = await mediaCommand(tools, tools.ffmpegPath, ["-hide_banner", "-loglevel", "verbose", "-nostdin", "-threads", "1", ...(autorotate ? [] : ["-noautorotate"]), "-i", sourcePath,
    "-filter_threads", "1", "-vf", `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-frames:v", "1", "-threads", "1", "-f", "null", "-"]);
  const match = /\[Parsed_pad_\d+[^\]]*\] w:(\d+) h:(\d+) -> w:(\d+) h:(\d+) x:(\d+) y:(\d+)/.exec(result.stderr);
  if (!match || Number(match[3]) !== size.width || Number(match[4]) !== size.height) throw new Error("source scale/pad measurement unavailable");
  return { ...size, scaledWidth: Number(match[1]), scaledHeight: Number(match[2]), padLeft: Number(match[5]), padTop: Number(match[6]) };
}

const AssetProbe = z.object({ streams: z.array(z.object({ codec_name: z.enum(["png", "mjpeg"]), width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096),
  nb_read_frames: z.literal("1"), tags: z.object({ rotate: z.string().optional() }).optional(), side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional(),
})).length(1) });

/** Fully transparent/partial alpha survives decoding; only the pixel gate decides opacity. */
async function rasterizeArtwork(bytes: Buffer, output: PixelSize, placement: ShapeCoverPlacement, tools: ShapeCoverMediaTools, includeRgba: boolean) {
  if (![output.width, output.height, placement.width, placement.height].every(value => Number.isSafeInteger(value) && value > 0)
    || ![placement.x, placement.y].every(value => Number.isSafeInteger(value) && value >= 0)
    || output.width * output.height > MAX_PIXELS || placement.x + placement.width > output.width || placement.y + placement.height > output.height) throw new Error("invalid final-pixel placement");
  const probe = AssetProbe.parse(JSON.parse((await mediaCommand(tools, tools.ffprobePath,
    ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames,tags,side_data_list", "-of", "json", "pipe:0"], bytes)).stdout.toString("utf8"))).streams[0];
  if (Number(probe.tags?.rotate ?? 0) !== 0 || probe.side_data_list?.some(item => item.rotation)) throw new Error("rotated sticker is unsupported");
  const scale = Math.min(placement.width / probe.width, placement.height / probe.height);
  const artworkWidth = Math.max(1, Math.round(probe.width * scale)), artworkHeight = Math.max(1, Math.round(probe.height * scale));
  const raster = (await mediaCommand(tools, tools.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1", "-noautorotate", "-i", "pipe:0",
    "-filter_threads", "1", "-vf", `format=rgba,scale=${artworkWidth}:${artworkHeight}:flags=bicubic,pad=${placement.width}:${placement.height}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba`,
    "-frames:v", "1", "-threads", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], bytes, placement.width * placement.height * 4)).stdout;
  if (raster.length !== placement.width * placement.height * 4) throw new Error("incomplete FFmpeg alpha raster");
  const alpha = new Uint8Array(output.width * output.height);
  const rgba = includeRgba ? Buffer.alloc(alpha.length * 4) : undefined;
  if (rgba) for (let y = 0; y < placement.height; y++) raster.copy(rgba, ((placement.y + y) * output.width + placement.x) * 4, y * placement.width * 4, (y + 1) * placement.width * 4);
  for (let y = 0; y < placement.height; y++) for (let x = 0; x < placement.width; x++) alpha[(placement.y + y) * output.width + placement.x + x] = raster[(y * placement.width + x) * 4 + 3];
  return { rgba, alpha, alphaSha256: digest(alpha), rasterVersion: SHAPE_COVER_ALPHA_VERSION, artwork: { width: artworkWidth, height: artworkHeight } };
}

export async function rasterizeShapeCoverArtwork(bytes: Buffer, output: PixelSize, placement: ShapeCoverPlacement, tools: ShapeCoverMediaTools) {
  const result = await rasterizeArtwork(bytes, output, placement, tools, true);
  return { ...result, rgba: result.rgba! };
}

/** Proportional artwork may cross the canvas edge; clip only at the video boundary. */
export async function rasterizeClippedShapeArtwork(bytes: Buffer, output: PixelSize, placement: ShapeCoverPlacement, tools: ShapeCoverMediaTools) {
  if (![placement.x, placement.y].every(Number.isSafeInteger) || output.width * output.height > MAX_PIXELS) throw Error("invalid clipped placement");
  const tile = await rasterizeShapeCoverArtwork(bytes, placement, { x: 0, y: 0, width: placement.width, height: placement.height }, tools);
  const alpha = new Uint8Array(output.width * output.height), rgba = Buffer.alloc(alpha.length * 4);
  const left = Math.max(0, placement.x), top = Math.max(0, placement.y);
  const right = Math.min(output.width, placement.x + placement.width), bottom = Math.min(output.height, placement.y + placement.height);
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const from = (y - placement.y) * placement.width + x - placement.x, to = y * output.width + x;
    alpha[to] = tile.alpha[from]; tile.rgba.copy(rgba, to * 4, from * 4, from * 4 + 4);
  }
  return { ...tile, alpha, rgba, alphaSha256: digest(alpha) };
}

export async function rasterizeShapeCoverAlpha(bytes: Buffer, output: PixelSize, placement: ShapeCoverPlacement, tools: ShapeCoverMediaTools) {
  const { rgba: _rgba, ...result } = await rasterizeArtwork(bytes, output, placement, tools, false);
  return result;
}

/** Remove only all-transparent outer rows/columns. No opaque or partial-alpha pixel is changed. */
export async function trimShapeCoverArtwork(bytes: Buffer, tools: ShapeCoverMediaTools) {
  const probe = AssetProbe.parse(JSON.parse((await mediaCommand(tools, tools.ffprobePath,
    ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames,tags,side_data_list", "-of", "json", "pipe:0"], bytes)).stdout.toString("utf8"))).streams[0];
  const raster = await rasterizeShapeCoverArtwork(bytes, probe, { x: 0, y: 0, width: probe.width, height: probe.height }, tools);
  let x = probe.width, y = probe.height, right = -1, bottom = -1;
  for (let p = 0; p < raster.alpha.length; p++) if (raster.alpha[p]) {
    x = Math.min(x, p % probe.width); y = Math.min(y, Math.floor(p / probe.width));
    right = Math.max(right, p % probe.width); bottom = Math.max(bottom, Math.floor(p / probe.width));
  }
  if (right < 0) throw Error("HYBRID_EMPTY_ARTWORK");
  const trimBox = { x, y, width: right - x + 1, height: bottom - y + 1 }, rgba = Buffer.alloc(trimBox.width * trimBox.height * 4);
  for (let row = 0; row < trimBox.height; row++) raster.rgba.copy(rgba, row * trimBox.width * 4,
    ((y + row) * probe.width + x) * 4, ((y + row) * probe.width + x + trimBox.width) * 4);
  const trimmed = await encodeShapeCoverPng(rgba, trimBox, tools);
  if (!(await decodeShapeCoverPng(trimmed, trimBox, tools)).equals(rgba)) throw Error("HYBRID_TRIM_PIXEL_MISMATCH");
  return { bytes: trimmed, trimBox, sha256: digest(trimmed) };
}

export async function encodeShapeCoverPng(rgba: Buffer, size: PixelSize, tools: ShapeCoverMediaTools): Promise<Buffer> {
  if (size.width * size.height > MAX_PIXELS || rgba.length !== size.width * size.height * 4) throw new Error("Invalid frozen RGBA raster");
  return (await mediaCommand(tools, tools.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${size.width}x${size.height}`,
    "-i", "pipe:0", "-frames:v", "1", "-threads", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1"], rgba, MAX_FROZEN_SHAPE_BYTES)).stdout;
}

export async function decodeShapeCoverPng(bytes: Buffer, size: PixelSize, tools: ShapeCoverMediaTools): Promise<Buffer> {
  if (size.width * size.height > MAX_PIXELS || bytes.length > MAX_FROZEN_SHAPE_BYTES) throw new Error("Oversized frozen shape raster");
  const rgba = (await mediaCommand(tools, tools.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1", "-i", "pipe:0",
    "-frames:v", "1", "-threads", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], bytes, size.width * size.height * 4)).stdout;
  if (rgba.length !== size.width * size.height * 4) throw new Error("Incomplete frozen shape raster");
  return rgba;
}
