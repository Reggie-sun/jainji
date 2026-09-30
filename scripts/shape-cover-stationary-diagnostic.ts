/** Controlled composite render proof. No model, knowledge write, queue or production admission. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { UploadedStickers } from "../src/main/uploaded-stickers.js";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareFullCanvasReviewEvidence } from "../src/main/source-fact-review-evidence.js";
import { buildStationaryShapeEnvelope, readStationaryEnvelopeMask } from "../src/main/shape-cover-stationary-envelope.js";
import { projectSourceMask, evaluateShapeCover, growOpaqueContour, checkOutputFrameCoverage } from "../src/main/shape-cover-pixel-gate.js";
import { readShapeCoverAsset, rasterizeShapeCoverArtwork, encodeShapeCoverPng, decodeShapeCoverPng } from "../src/main/shape-cover-alpha.js";

const [realSource, uploadedRoot, candidateId, newDirectory, ffmpegPath, ffprobePath] = process.argv.slice(2);
if (process.argv.length !== 8 || ![realSource, uploadedRoot, candidateId, newDirectory, ffmpegPath, ffprobePath].every(Boolean)) throw new Error("Expected realSource uploadedRoot candidateId newDirectory ffmpegPath ffprobePath");
const root = resolve(newDirectory), size = { width: 360, height: 640 }, frameCount = 36;
const placement = { x: 282, y: 12, width: 75, height: 54 }, anchor = { x: 319, y: 39 };
const projection = { ...size, scaledWidth: size.width, scaledHeight: size.height, padLeft: 0, padTop: 0 };
const tools = { ffmpegPath, ffprobePath, signal: new AbortController().signal };
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function run(binary: string, args: string[], maxBuffer = 128 * 1024 ** 2): Buffer {
  const p = spawnSync(binary, args, { timeout: 60000, maxBuffer });
  if (p.error || p.status !== 0) throw p.error ?? new Error(p.stderr.toString().slice(0, 2000));
  return p.stdout;
}
const json = async (name: string, data: unknown) => writeFile(join(root, name), `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const sourceFingerprint = sha(await readFile(realSource));
const assets = await new UploadedStickers(uploadedRoot, () => { throw new Error("Import disabled"); }).load();
const asset = assets[candidateId]; if (!asset) throw new Error("Candidate is not in the validated upload catalog");
const bytes = await readShapeCoverAsset(asset, tools), artwork = await rasterizeShapeCoverArtwork(bytes, size, placement, tools);
await mkdir(root, { mode: 0o700 }); // Existing runs are never replaced.
const phases: Array<{ raster: Uint8Array; mask: { bbox: typeof placement; encoding: "bitpack-lsb-row-major-v1"; dataBase64: string; sha256: string; markedPixels: number } }> = [];
for (const extent of [0.35, 0.5, 1]) {
  const raster = new Uint8Array(size.width * size.height), packed = Buffer.alloc(Math.ceil(placement.width * placement.height / 8)); let count = 0;
  for (let y = placement.y + 3; y < placement.y + placement.height - 3; y++) for (let x = placement.x + 3; x < placement.x + placement.width - 3; x++) {
    if (Math.abs(x - anchor.x) > placement.width * extent / 2 || Math.abs(y - anchor.y) > placement.height * extent / 2) continue;
    let interior = true;
    for (let dy = -3; dy <= 3 && interior; dy++) for (let dx = -3; dx <= 3; dx++) if (artwork.alpha[(y + dy) * size.width + x + dx] !== 255) { interior = false; break; }
    if (!interior) continue;
    raster[y * size.width + x] = 1; count++;
    const bit = (y - placement.y) * placement.width + x - placement.x; packed[bit >> 3] |= 1 << (bit & 7);
  }
  if (!count) throw new Error("Empty controlled target phase");
  phases.push({ raster, mask: { bbox: placement, encoding: "bitpack-lsb-row-major-v1", dataBase64: packed.toString("base64"), sha256: sha(packed), markedPixels: count } });
  const rgba = Buffer.alloc(raster.length * 4);
  for (let i = 0; i < raster.length; i++) if (raster[i]) { rgba[i * 4] = 30; rgba[i * 4 + 1] = 220; rgba[i * 4 + 2] = 240; rgba[i * 4 + 3] = 255; }
  await writeFile(join(root, `old-phase-${phases.length - 1}.png`), await encodeShapeCoverPng(rgba, size, tools), { flag: "wx" });
}
const background = join(root, "background.mp4");
run(ffmpegPath, ["-v", "error", "-nostdin", "-ss", "14", "-i", realSource, "-t", "3", "-map", "0:v:0", "-map", "0:a?", "-vf", "scale=360:640:flags=bicubic,fps=12", "-c:v", "libx264", "-crf", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-c:a", "copy", "-video_track_timescale", "12000", background]);
const reports = [];
for (const motion of ["static", "stationary-animation"] as const) {
  const dir = join(root, motion); await mkdir(dir);
  // Animation has blinking frames and a larger phase present ONLY on the final ordinal.
  const phaseAt = (index: number): number => motion === "static" ? 1 : [5, 17, 29].includes(index) ? -1 : index === 35 ? 2 : Math.floor(index / 6) % 2;
  const visible = Array.from({ length: frameCount }, (_, index) => ({ index, phase: phaseAt(index) }));
  const sourcePath = join(dir, "source.mp4");
  const filters = ["[0:v]format=rgba[v0]"];
  for (let phase = 0; phase < 3; phase++) {
    const ordinals = visible.filter(v => v.phase === phase).map(v => `eq(n,${v.index})`).join("+") || "0";
    filters.push(`[v${phase}][${phase + 1}:v]overlay=0:0:format=rgb:enable='${ordinals}'[v${phase + 1}]`);
  }
  const composite = (output: string, graph: string[]) => run(ffmpegPath, ["-v", "error", "-nostdin", "-i", background, ...phases.flatMap((_, i) => ["-loop", "1", "-framerate", "12", "-i", join(root, `old-phase-${i}.png`)]),
    "-filter_complex_threads", "1", "-filter_complex", graph.join(";"), "-map", "[v3]", "-map", "0:a?", "-t", "3", "-c:v", "libx264", "-crf", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-c:a", "copy", "-video_track_timescale", "12000", output]);
  composite(sourcePath, filters);
  // Same conversion/overlay pipeline, with the old-target overlays explicitly disabled.
  const noOldSource = join(dir, "without-old-target-source.mp4");
  composite(noOldSource, filters.map(f => f.replace(/enable='[^']*'/, "enable='0'")));
  const probe = JSON.parse(run(ffprobePath, ["-v", "error", "-show_streams", "-show_frames", "-select_streams", "v:0", "-of", "json", sourcePath]).toString());
  const source = await identifySource(sourcePath, { ...size, rotation: 0, durationMs: Math.round(Number(probe.streams[0].duration) * 1000), timeBase: probe.streams[0].time_base, timeOriginPts: probe.frames[0].pts, interpretationVersion: 1 });
  const evidence = await prepareFullCanvasReviewEvidence({ sourcePath, source, ffmpeg: tools, signal: tools.signal });
  try {
    if (evidence.census.horizon.frameCount !== frameCount) throw new Error("Controlled frame count differs");
    const envelope = await buildStationaryShapeEnvelope({ evidence, motion, anchor, range: { startFrame: 0, endFrame: frameCount }, targetId: "controlled-old-sticker", maskProviderId: "known-composite-recipe-unqualified", signal: tools.signal,
      declareFrame: async ({ binding }) => ({ ...binding, targetId: "controlled-old-sticker", anchor, state: phaseAt(binding.index) < 0 ? "NOT_VISIBLE" : "VISIBLE", mask: phaseAt(binding.index) < 0 ? null : phases[phaseAt(binding.index)].mask }) });
    const union = readStationaryEnvelopeMask(envelope), projected = projectSourceMask(union, size, projection)!;
    const verdict = evaluateShapeCover(projected, artwork.alpha, size, 1);
    if (verdict.status !== "PASS") throw new Error(`No shape match: ${JSON.stringify(verdict)}`);
    const grown = growOpaqueContour(artwork.alpha, size, verdict.radiusPx!)!, rgba = Buffer.from(artwork.rgba);
    for (let i = 0; i < grown.length; i++) if (grown[i]) {
      const alpha = rgba[i * 4 + 3];
      for (let channel = 0; channel < 3; channel++) rgba[i * 4 + channel] = Math.round((rgba[i * 4 + channel] * alpha + 255 * (255 - alpha)) / 255);
      rgba[i * 4 + 3] = 255;
    }
    const png = await encodeShapeCoverPng(rgba, size, tools), decoded = await decodeShapeCoverPng(png, size, tools);
    if (!decoded.equals(rgba)) throw new Error("PNG did not preserve frozen bytes");
    const perFrame = visible.map(({ index, phase }) => {
      const p = phase < 0 ? new Uint8Array(union.length) : projectSourceMask(phases[phase].raster, size, projection)!;
      let uncoveredPixels = 0; for (let i = 0; i < p.length; i++) if (p[i] && decoded[i * 4 + 3] !== 255) uncoveredPixels++;
      return { index, phase, uncoveredPixels };
    });
    if (perFrame.some(f => f.uncoveredPixels)) throw new Error("A target phase remains uncovered");
    const overlay = join(dir, "frozen-overlay.png"); await writeFile(overlay, png, { flag: "wx" });
    const render = (inputPath: string, outputPath: string) => run(ffmpegPath, ["-v", "error", "-nostdin", "-i", inputPath, "-loop", "1", "-framerate", "12", "-i", overlay,
      "-filter_complex_threads", "1", "-filter_complex", "[0:v]format=rgba[b];[b][1:v]overlay=0:0:format=rgb:shortest=1[v]", "-map", "[v]", "-map", "0:a?", "-t", "3", "-c:v", "libx264", "-crf", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-c:a", "copy", "-video_track_timescale", "12000", outputPath]);
    const covered = join(dir, "covered.mp4"), reference = join(dir, "without-old-target-covered.mp4"); render(sourcePath, covered); render(noOldSource, reference);
    const decodeVideo = (file: string) => run(ffmpegPath, ["-v", "error", "-i", file, "-map", "0:v:0", "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"]);
    const actual = decodeVideo(covered), expected = decodeVideo(reference), bytesPerFrame = union.length * 4;
    if (actual.length !== frameCount * bytesPerFrame || expected.length !== actual.length) throw new Error("Output decode incomplete");
    const comparison = visible.map(({ index }) => {
      const a = actual.subarray(index * bytesPerFrame, (index + 1) * bytesPerFrame), b = expected.subarray(index * bytesPerFrame, (index + 1) * bytesPerFrame);
      let differentPixels = 0; for (let i = 0; i < a.length; i += 4) if (!a.subarray(i, i + 4).equals(b.subarray(i, i + 4))) differentPixels++;
      return { index, actualSha256: sha(a), referenceSha256: sha(b), differentPixels };
    });
    if (comparison.some(f => f.differentPixels !== 0)) throw new Error("Rendered target differs from the balanced target-free reference");
    const finalExpansionPixels = phases[2].raster.reduce((count, bit, index) => count + (bit && !phases[0].raster[index] ? 1 : 0), 0);
    if (!finalExpansionPixels || phases[1].mask.markedPixels >= phases[2].mask.markedPixels) throw new Error("Controlled animation does not test a new final-frame extent");
    const outputProbe = JSON.parse(run(ffprobePath, ["-v", "error", "-show_frames", "-select_streams", "v:0", "-of", "json", covered]).toString());
    const frameTimes = outputProbe.frames.map((f: { pts_time: string }) => Number(f.pts_time) * 1000);
    if (frameTimes.length !== frameCount || frameTimes.some((t: number, i: number) => Math.abs(t - Number(probe.frames[i].pts_time) * 1000) > 0.001)
      || checkOutputFrameCoverage(frameTimes, [{ startMs: 0, endMs: 3000 }], [{ startMs: 0, endMs: 3000 }]).status !== "PASS") throw new Error("Output frame timing differs");
    const pcm = (file: string) => run(ffmpegPath, ["-v", "error", "-i", file, "-map", "0:a:0", "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"]);
    const sourcePcm = pcm(sourcePath), outputPcm = pcm(covered);
    if (!sourcePcm.equals(outputPcm)) throw new Error("Audio changed");
    for (const index of [0, 17, 34, 35]) {
      const original = await evidence.readFrame(index), result = actual.subarray(index * bytesPerFrame, (index + 1) * bytesPerFrame);
      const sideBySide = Buffer.alloc(size.width * 2 * size.height * 4);
      for (let y = 0; y < size.height; y++) { original.copy(sideBySide, y * size.width * 8, y * size.width * 4, (y + 1) * size.width * 4); result.copy(sideBySide, y * size.width * 8 + size.width * 4, y * size.width * 4, (y + 1) * size.width * 4); }
      await writeFile(join(dir, `comparison-${index}.png`), await encodeShapeCoverPng(sideBySide, { width: 720, height: 640 }, tools), { flag: "wx" });
    }
    await json(`${motion}/envelope.json`, envelope.receipt);
    await json(`${motion}/census.json`, evidence.census);
    await json(`${motion}/pixel-check.json`, { verdict, perFrame, comparison, frameTimes, sourcePcmSha256: sha(sourcePcm), outputPcmSha256: sha(outputPcm) });
    reports.push({ motion, source, censusDigest: evidence.census.censusDigest, receiptDigest: envelope.receipt.receiptDigest, unionPixels: envelope.receipt.union.markedPixels,
      phasePixels: phases.map(p => p.mask.markedPixels), finalExpansionPixels, frameCount, uncoveredPixels: 0, outputDiffPixels: comparison.reduce((n, f) => n + f.differentPixels, 0), audioIdentical: true, frozenPngSha256: sha(png), coveredSha256: sha(await readFile(covered)) });
  } finally { await evidence.close(); }
}
if (sha(await readFile(realSource)) !== sourceFingerprint) throw new Error("Real background source changed");
await readShapeCoverAsset(asset, tools);
await json("result.json", { status: "ENGINEERING_RENDER_EVIDENCE", authority: "none", eligible: false, datasetLayer: "CONTROLLED_COMPOSITE_WITH_REAL_BACKGROUND", independentHoldout: false,
  sourceFingerprint, candidateId, assetFingerprint: asset.assetFingerprint, placement, reports, modelRequests: 0, motionReview: "NOT_EVALUATED", maskReview: "NOT_EVALUATED", naturalness: "NOT_EVALUATED", production: "PRODUCT_DISABLED" });
process.stdout.write(`${JSON.stringify({ root, reports, modelRequests: 0 })}\n`);
