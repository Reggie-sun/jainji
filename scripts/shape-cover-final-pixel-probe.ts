/** M3 experiment: use FFmpeg asset pixels and the production-bound pixel gate; does not switch the renderer. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { SHAPE_COVER_PIXEL_CONTRACT, decodeSourceMask, evaluateShapeCover, growOpaqueContour, projectSourceMask } from "../src/main/shape-cover-pixel-gate.js";

function pair(value: string): [number, number] {
  const parts = value.split(",").map(Number);
  if (parts.length !== 2 || parts.some((part) => !Number.isSafeInteger(part) || part <= 0)) throw new Error(`Invalid positive pixel pair: ${value}`);
  return [parts[0], parts[1]];
}
function run(binary: string, args: string[], input?: Buffer): Buffer {
  const result = spawnSync(binary, args, { input, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${binary} failed: ${result.stderr?.toString("utf8").slice(0, 1000)}`);
  return result.stdout;
}
function hash(bytes: Buffer | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value || args.has(key)) throw new Error("Expected unique --key value arguments");
  args.set(key, value);
}
const maskDir = args.get("--mask-dir"), assetPath = args.get("--asset");
if (!maskDir || !assetPath || !args.get("--output-size") || !args.get("--panel-size")) throw new Error("Required: --mask-dir --asset --output-size width,height --panel-size width,height");
const [width, height] = pair(args.get("--output-size")!);
const [panelWidth, panelHeight] = pair(args.get("--panel-size")!);
if (panelWidth > width || panelHeight > height) throw new Error("Panel exceeds output");
const record = JSON.parse(readFileSync(`${maskDir}/result.json`, "utf8"));
if (record.status !== "CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW") throw new Error("M1 source mask was rejected");
const [sourceWidth, sourceHeight] = record.decodedSize as [number, number];
if (width * sourceHeight !== height * sourceWidth) throw new Error("This probe only supports exact-aspect outputs; use the pixel gate directly for padded exports");
const [x, y] = record.mask.bboxHalfOpen as [number, number, number, number];
const [maskWidth, maskHeight] = record.mask.size as [number, number];
const packed = readFileSync(`${maskDir}/candidate-mask.bitset`);
const sourceMask = decodeSourceMask({
  kind: "static-binary-v1", bbox: { x, y, width: maskWidth, height: maskHeight }, encoding: "bitpack-lsb-row-major-v1",
  dataBase64: packed.toString("base64"), sha256: record.mask.packedSha256, markedPixels: record.mask.markedPixels,
  creation: { method: "temporal-stability", version: 1 }, review: { method: "contact-sheet", version: 1, reviewer: "codex", at: "2026-09-24T00:00:00Z" }, evidenceIds: ["first", "last"],
}, { width: sourceWidth, height: sourceHeight });
if (!sourceMask) throw new Error("Invalid source mask payload");
const oldFinal = projectSourceMask(sourceMask, { width: sourceWidth, height: sourceHeight }, { width, height, scaledWidth: width, scaledHeight: height, padLeft: 0, padTop: 0 });
if (!oldFinal) throw new Error("Invalid source/output projection");
const asset = readFileSync(assetPath);
const probe = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", assetPath]).toString("utf8"));
const inputWidth = probe.streams?.[0]?.width, inputHeight = probe.streams?.[0]?.height;
if (!Number.isSafeInteger(inputWidth) || !Number.isSafeInteger(inputHeight)) throw new Error("Invalid asset dimensions");
const scale = Math.min(panelWidth / inputWidth, panelHeight / inputHeight);
const artworkWidth = Math.max(1, Math.round(inputWidth * scale)), artworkHeight = Math.max(1, Math.round(inputHeight * scale));
const panel = run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", assetPath, "-vf",
  `scale=${artworkWidth}:${artworkHeight}:flags=bicubic,pad=${panelWidth}:${panelHeight}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba`,
  "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]);
if (panel.length !== panelWidth * panelHeight * 4) throw new Error("Invalid FFmpeg alpha raster length");
const alpha = new Uint8Array(width * height);
for (let row = 0; row < panelHeight; row += 1) for (let col = 0; col < panelWidth; col += 1) alpha[row * width + width - panelWidth + col] = panel[(row * panelWidth + col) * 4 + 3];
const verdict = evaluateShapeCover(oldFinal, alpha, { width, height }, width / sourceWidth);
let overlayPngSha256: string | undefined;
if (args.get("--overlay-png")) {
  if (verdict.status !== "PASS" || verdict.radiusPx === undefined) throw new Error("Cannot make a cover overlay from an unsafe candidate");
  const contour = growOpaqueContour(alpha, { width, height }, verdict.radiusPx)!;
  const overlay = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1) for (let col = 0; col < width; col += 1) {
    const index = row * width + col, pixel = index * 4;
    if (contour[index]) { overlay[pixel] = 255; overlay[pixel + 1] = 255; overlay[pixel + 2] = 255; overlay[pixel + 3] = 255; }
    if (row >= panelHeight || col < width - panelWidth) continue;
    const art = (row * panelWidth + col - (width - panelWidth)) * 4, artAlpha = panel[art + 3];
    if (!artAlpha) continue;
    if (contour[index]) {
      for (let channel = 0; channel < 3; channel += 1) overlay[pixel + channel] = Math.round((panel[art + channel] * artAlpha + 255 * (255 - artAlpha)) / 255);
    } else {
      for (let channel = 0; channel < 3; channel += 1) overlay[pixel + channel] = panel[art + channel];
      overlay[pixel + 3] = artAlpha;
    }
  }
  const png = run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-i", "pipe:0", "-frames:v", "1", "-vcodec", "png", "-f", "image2pipe", "pipe:1"], overlay);
  writeFileSync(args.get("--overlay-png")!, png, { flag: "wx" });
  overlayPngSha256 = hash(png);
}
const report = { algorithm: SHAPE_COVER_PIXEL_CONTRACT, sourceSha256: record.sourceSha256, maskSha256: hash(packed), assetSha256: hash(asset), output: [width, height],
  panel: [panelWidth, panelHeight], placement: [width - panelWidth, 0], artwork: [artworkWidth, artworkHeight],
  projectedPixels: oldFinal.reduce((total, value) => total + value, 0), alphaSha256: hash(alpha), verdict, ...(overlayPngSha256 ? { overlayPngSha256 } : {}) };
if (args.get("--output")) writeFileSync(args.get("--output")!, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify(report)}\n`);
