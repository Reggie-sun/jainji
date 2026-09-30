/** Original-user-media geometry diagnostic. Raw temporal masks are NOT reviewed/AI source facts. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { UploadedStickers } from "../src/main/uploaded-stickers.js";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareFullCanvasReviewEvidence } from "../src/main/source-fact-review-evidence.js";
import { buildStationaryShapeEnvelope, readStationaryEnvelopeMask } from "../src/main/shape-cover-stationary-envelope.js";
import { decodeSourceMask, projectSourceMask, evaluateShapeCover, growOpaqueContour, checkOutputFrameCoverage } from "../src/main/shape-cover-pixel-gate.js";
import { readShapeCoverAsset, rasterizeShapeCoverArtwork, encodeShapeCoverPng, decodeShapeCoverPng } from "../src/main/shape-cover-alpha.js";

const [realSource, maskArchive, uploadedRoot, candidateId, newDirectory, ffmpegPath, ffprobePath] = process.argv.slice(2);
if (process.argv.length !== 9 || ![realSource, maskArchive, uploadedRoot, candidateId, newDirectory, ffmpegPath, ffprobePath].every(Boolean)) throw new Error("Expected realSource maskArchive uploadedRoot candidateId newDirectory ffmpegPath ffprobePath");
const root = resolve(newDirectory), size = { width: 720, height: 1280 };
const placement = { x: 601, y: 0, width: 119, height: 78 }, anchor = { x: 668, y: 30 };
const projection = { ...size, scaledWidth: size.width, scaledHeight: size.height, padLeft: 0, padTop: 0 };
const tools = { ffmpegPath, ffprobePath, signal: new AbortController().signal };
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const commands: Array<{ binary: string; args: string[] }> = [];
function run(binary: string, args: string[], maxBuffer = 8 * 1024 ** 2): Buffer {
  commands.push({ binary, args });
  const p = spawnSync(binary, args, { timeout: 60000, maxBuffer });
  if (p.error || p.status !== 0) throw p.error ?? new Error(p.stderr.toString().slice(0, 2000));
  return p.stdout;
}
const save = async (filename: string, data: unknown) => writeFile(join(root, filename), `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const sourceFingerprint = sha(await readFile(realSource));
const probe = JSON.parse(run(ffprobePath, ["-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", realSource]).toString());
const stream = probe.streams[0];
if (stream.width !== size.width || stream.height !== size.height || stream.avg_frame_rate !== "30/1") throw new Error("This known-media diagnostic requires its original 720x1280/30fps source");
const source = await identifySource(realSource, { ...size, rotation: 0, durationMs: Math.round(Number(stream.duration) * 1000), timeBase: stream.time_base, timeOriginPts: stream.start_pts, interpretationVersion: 1 });
const cells = await Promise.all([14, 90].map(async start => {
  const segment = `segment-${start}-${start + 3}`, recordBytes = await readFile(join(maskArchive, segment, "result.json"));
  const record = JSON.parse(recordBytes.toString()), packed = await readFile(join(maskArchive, segment, "candidate-mask.bitset"));
  if (record.status !== "CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW" || record.sourceSha256 !== sourceFingerprint || record.sourceBytes !== source.byteLength
    || JSON.stringify(record.decodedSize) !== JSON.stringify([size.width, size.height]) || JSON.stringify(record.frameRange) !== JSON.stringify([start * 30, (start + 3) * 30])) throw new Error("Raw diagnostic source/mask binding differs");
  const [x, y] = record.mask.bboxHalfOpen, [width, height] = record.mask.size;
  const mask = { bbox: { x, y, width, height }, encoding: "bitpack-lsb-row-major-v1" as const, dataBase64: packed.toString("base64"), sha256: record.mask.packedSha256, markedPixels: record.mask.markedPixels };
  if (!decodeSourceMask({ ...mask, kind: "static-binary-v1" }, size)) throw new Error("Invalid raw temporal candidate bytes");
  return { start, segment, mask, rawRecordSha256: sha(recordBytes), rawMethod: record.method };
}));
const assets = await new UploadedStickers(uploadedRoot, () => { throw new Error("Import disabled"); }).load();
const asset = assets[candidateId]; if (!asset) throw new Error("Candidate absent from validated upload catalog");
const assetBytes = await readShapeCoverAsset(asset, tools), artwork = await rasterizeShapeCoverArtwork(assetBytes, size, placement, tools);
await mkdir(root, { mode: 0o700 }); // Exclusive run: never replace prior evidence.
await save("inputs.json", { source, candidateId, assetFingerprint: asset.assetFingerprint, placement, cells, authority: "none", eligible: false, modelRequests: 0 });
process.stdout.write("Preparing original full-source D1/D2 evidence; no target injection or model request.\n");
const evidence = await prepareFullCanvasReviewEvidence({ sourcePath: realSource, source, ffmpeg: tools, signal: tools.signal });
try {
  await save("census.json", evidence.census);
  const declarations = [];
  for (const cell of cells) {
    process.stdout.write(`Reading original ${cell.segment} ordinals ${cell.start * 30}..${(cell.start + 3) * 30 - 1}.\n`);
    const envelope = await buildStationaryShapeEnvelope({ evidence, motion: "static", anchor, range: { startFrame: cell.start * 30, endFrame: (cell.start + 3) * 30 }, targetId: "known-top-right-original-sticker", maskProviderId: "historical-temporal-candidate-unreviewed-not-ai", signal: tools.signal,
      declareFrame: async ({ binding }) => ({ ...binding, targetId: "known-top-right-original-sticker", anchor, state: "VISIBLE", mask: cell.mask }) });
    const projected = projectSourceMask(readStationaryEnvelopeMask(envelope), size, projection)!;
    const verdict = evaluateShapeCover(projected, artwork.alpha, size, 1);
    if (verdict.status !== "PASS") throw new Error(`No common geometric cover: ${JSON.stringify(verdict)}`);
    await mkdir(join(root, cell.segment)); await save(`${cell.segment}/envelope.json`, envelope.receipt);
    declarations.push({ cell, envelope, projected, verdict });
  }
  const radius = Math.max(...declarations.map(d => d.verdict.radiusPx!)), grown = growOpaqueContour(artwork.alpha, size, radius)!;
  const rgba = Buffer.from(artwork.rgba);
  for (let i = 0; i < grown.length; i++) if (grown[i]) {
    const alpha = rgba[i * 4 + 3];
    for (let channel = 0; channel < 3; channel++) rgba[i * 4 + channel] = Math.round((rgba[i * 4 + channel] * alpha + 255 * (255 - alpha)) / 255);
    rgba[i * 4 + 3] = 255;
  }
  const png = await encodeShapeCoverPng(rgba, size, tools), decoded = await decodeShapeCoverPng(png, size, tools);
  if (!decoded.equals(rgba)) throw new Error("Frozen PNG roundtrip differs");
  const overlay = join(root, "frozen-overlay.png"); await writeFile(overlay, png, { flag: "wx" });
  const reports = [];
  for (const { cell, envelope, projected, verdict } of declarations) {
    let uncoveredPixels = 0; for (let i = 0; i < projected.length; i++) if (projected[i] && decoded[i * 4 + 3] !== 255) uncoveredPixels++;
    if (uncoveredPixels) throw new Error("Raw candidate contains pixels outside opaque frozen contour");
    const dir = join(root, cell.segment), original = join(dir, "original.mp4"), covered = join(dir, "covered.mp4");
    for (const [mode, output] of [["original", original], ["covered", covered]] as const) {
      run(ffmpegPath, ["-v", "error", "-nostdin", "-n", "-ss", String(cell.start), "-i", realSource,
        ...(mode === "covered" ? ["-loop", "1", "-framerate", "30", "-i", overlay, "-filter_complex_threads", "1", "-filter_complex", "[0:v]setpts=PTS-STARTPTS[b];[b][1:v]overlay=0:0:format=auto:shortest=1,format=yuv420p[v]", "-map", "[v]"] : ["-map", "0:v:0"]),
        "-map", "0:a:0", "-t", "3", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output]);
      run(ffmpegPath, ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"]);
    }
    const inspect = (file: string) => JSON.parse(run(ffprobePath, ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_streams", "-of", "json", file], 16 * 1024 ** 2).toString());
    const baseline = inspect(original), final = inspect(covered), frameTimes = final.frames.map((f: { pts_time: string }) => Number(f.pts_time) * 1000);
    if (frameTimes.length !== 90 || baseline.frames.length !== 90 || final.streams[0].width !== size.width || final.streams[0].height !== size.height
      || final.streams[0].duration !== "3.000000" || frameTimes.some((t: number, index: number) => Math.abs(t - Number(baseline.frames[index].pts_time) * 1000) > 0.001
        || Math.abs(t - (envelope.receipt.frames[index].pts - envelope.receipt.range.startPts) * 1000 / 15360) > 0.001)
      || checkOutputFrameCoverage(frameTimes, [{ startMs: 0, endMs: 3000 }], [{ startMs: 0, endMs: 3000 }]).status !== "PASS") throw new Error("Output original ordinal/PTS horizon differs");
    const pcm = (file: string) => run(ffmpegPath, ["-v", "error", "-i", file, "-map", "0:a:0", "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"]);
    const originalPcm = pcm(original), coveredPcm = pcm(covered); if (!originalPcm.equals(coveredPcm)) throw new Error("Coverage changed sample audio");
    // All 90 actual output frames appear in each contact sheet; no sampled screenshot claims completeness.
    for (const [mode, file] of [["original", original], ["covered", covered]] as const) run(ffmpegPath, ["-v", "error", "-n", "-i", file, "-vf", "crop=140:100:580:0,scale=280:200,tile=10x9", "-frames:v", "1", join(dir, `${mode}-all-frames.png`)]);
    run(ffmpegPath, ["-v", "error", "-n", "-i", original, "-i", covered, "-filter_complex_threads", "1", "-filter_complex", "[0:v][1:v]hstack=inputs=2[v]", "-map", "[v]", "-map", "0:a:0", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-c:a", "copy", "-movflags", "+faststart", join(dir, "comparison.mp4")]);
    run(ffmpegPath, ["-v", "error", "-n", "-ss", "1.5", "-i", join(dir, "comparison.mp4"), "-frames:v", "1", join(dir, "comparison.png")]);
    const report = { segment: cell.segment, originalFrameRange: [cell.start * 30, (cell.start + 3) * 30], originalSourceRangeMs: [cell.start * 1000, (cell.start + 3) * 1000],
      receiptDigest: envelope.receipt.receiptDigest, rawRecordSha256: cell.rawRecordSha256, rawMethod: cell.rawMethod, candidatePixels: envelope.receipt.union.markedPixels,
      projectedPixels: projected.reduce((n, bit) => n + bit, 0), verdict, radiusPx: radius, perFrame: envelope.receipt.frames.map((f, i) => ({ originalIndex: f.index, originalPts: f.pts, originalPixelSha256: f.pixelSha256, outputPtsMs: frameTimes[i], candidateUncoveredPixels: uncoveredPixels })),
      outputFrameCount: frameTimes.length, videoDurationMs: 3000, audioComparison: "DECODED_PCM_IDENTICAL_TO_SAME_SOURCE_SEGMENT_EXPORT", pcmSha256: sha(originalPcm),
      originalExportSha256: sha(await readFile(original)), coveredSha256: sha(await readFile(covered)), maskReview: "NOT_EVALUATED", motionReview: "NOT_EVALUATED", semanticReview: "NOT_EVALUATED" };
    await save(`${cell.segment}/verification.json`, report); reports.push(report);
    process.stdout.write(`Rendered and fully decoded real ${cell.segment}: ${frameTimes.length} frames, conditional coverage gaps ${uncoveredPixels}, matched audio.\n`);
  }
  if (sha(await readFile(realSource)) !== sourceFingerprint) throw new Error("Original source changed");
  await readShapeCoverAsset(asset, tools);
  await save("commands.json", commands);
  await save("result.json", { status: "ORIGINAL_USER_MEDIA_GEOMETRY_DIAGNOSTIC", datasetLayer: "REAL_MEDIA_KNOWN_STATIC_TARGET", authority: "none", eligible: false,
    source, censusDigest: evidence.census.censusDigest, completeSourceCensusFrameCount: evidence.census.horizon.frameCount, reviewedSourceFrames: 0, targetDiagnosticFrameCount: reports.reduce((n, r) => n + r.outputFrameCount, 0),
    candidateId, assetFingerprint: asset.assetFingerprint, frozenPngSha256: sha(png), placement, radiusPx: radius, reports,
    oldTargetInjection: false, independentHoldout: false, modelRequests: 0, aiSelection: "NOT_EVALUATED", realStationaryAnimation: "NOT_EVALUATED", naturalness: "NOT_EVALUATED", fullSourceSemantic: "NOT_EVALUATED", production: "PRODUCT_DISABLED" });
} finally { await evidence.close(); }
process.stdout.write(`${JSON.stringify({ root, modelRequests: 0, product: "PRODUCT_DISABLED" })}\n`);
