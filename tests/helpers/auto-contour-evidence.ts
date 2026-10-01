import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identifySource } from "../../src/main/source-sticker-knowledge-store";
import { prepareFullCanvasReviewEvidence } from "../../src/main/source-fact-review-evidence";

export const contourHash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export const TARGET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const TARGET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Controlled grayscale construction, independently specified before extracting any contour. */
export async function contourEvidence(kind: "static" | "animated" | "ambiguous" = "animated") {
  const root = await mkdtemp(join(tmpdir(), "jianji-auto-contour-test-"));
  const ffmpeg = { ffmpegPath: process.env.JIANJI_FFMPEG_PATH ?? "ffmpeg", ffprobePath: process.env.JIANJI_FFPROBE_PATH ?? "ffprobe" };
  const sourcePath = join(root, "source.mp4"), raw = Buffer.alloc(32 * 32 * 6);
  const pixels: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const target = kind === "static" || i !== 2 ? [5 * 32 + 5, 6 * 32 + 4, 6 * 32 + 5, 6 * 32 + 6, 7 * 32 + 5] : [];
    if (kind !== "static" && i === 5) target.push(6 * 32 + 7, 6 * 32 + 8);
    for (const p of target) raw[i * 1024 + p] = p === 5 * 32 + 5 ? 8 : 240;
    raw[i * 1024 + 20 * 32 + 20] = 200;
    if (kind === "ambiguous") raw[i * 1024 + 2 * 32 + 2] = 80;
    pixels.push(target);
  }
  const run = (binary: string, args: string[], input?: Buffer) => {
    const p = spawnSync(binary, args, { input, timeout: 15000, maxBuffer: 4 * 1024 ** 2 });
    if (p.status !== 0 || p.error) throw p.error ?? Error(p.stderr.toString());
    return p.stdout;
  };
  try {
    run(ffmpeg.ffmpegPath, ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "32x32", "-framerate", "6", "-i", "pipe:0",
      "-vf", "setsar=1", "-c:v", "libx264", "-qp", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-video_track_timescale", "6000", "-n", sourcePath], raw);
    const probe = JSON.parse(run(ffmpeg.ffprobePath, ["-v", "error", "-show_streams", "-of", "json", sourcePath]).toString());
    const source = await identifySource(sourcePath, { width: 32, height: 32, rotation: 0, durationMs: 1000,
      timeBase: probe.streams[0].time_base, timeOriginPts: 0, interpretationVersion: 1 });
    const evidence = await prepareFullCanvasReviewEvidence({ sourcePath, source, ffmpeg, signal: new AbortController().signal });
    const declarations = evidence.census.frames.map(binding => ({ binding: { ...binding }, declaration: { ordinal: binding.index, type: "TARGETS" as const,
      targets: [
        ...(pixels[binding.index].length ? [{ id: TARGET_A, description: "controlled cross", category: kind === "static" ? "static" as const : "animated" as const,
          bbox: { x: 2, y: 2, width: 10, height: 10 } }] : []),
        { id: TARGET_B, description: "second target", category: "static" as const, bbox: { x: 18, y: 18, width: 5, height: 5 } },
      ] } }));
    return { evidence, declarations, pixels, sourcePath, ffmpeg, root, close: async () => { await evidence.close(); await rm(root, { recursive: true, force: true }); } };
  } catch (e) { await rm(root, { recursive: true, force: true }); throw e; }
}

export function packedTruth(pixels: number[], width = 32) {
  if (!pixels.length) return null;
  const xs = pixels.map(p => p % width), ys = pixels.map(p => Math.floor(p / width));
  const bbox = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
  const bytes = Buffer.alloc(Math.ceil(bbox.width * bbox.height / 8));
  for (const p of pixels) { const bit = (Math.floor(p / width) - bbox.y) * bbox.width + p % width - bbox.x; bytes[bit >> 3] |= 1 << (bit & 7); }
  return { bbox, encoding: "bitpack-lsb-row-major-v1" as const, dataBase64: bytes.toString("base64"), sha256: contourHash(bytes), markedPixels: pixels.length };
}
