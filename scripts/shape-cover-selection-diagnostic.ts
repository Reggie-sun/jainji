/** Known-media geometry diagnostic only. No source admission, reviewer receipts or model calls. */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { UploadedStickers } from "../src/main/uploaded-stickers.js";
import { decodeSourceMask, projectSourceMask, evaluateShapeCover, growOpaqueContour } from "../src/main/shape-cover-pixel-gate.js";
import { readShapeCoverAsset, rasterizeShapeCoverArtwork, encodeShapeCoverPng, decodeShapeCoverPng } from "../src/main/shape-cover-alpha.js";

const [archive, uploadedRoot, sourcePath, outputDirectory] = process.argv.slice(2);
if (!archive || !uploadedRoot || !sourcePath || !outputDirectory || process.argv.length !== 6) throw new Error("Expected archive uploadedRoot sourcePath newOutputDirectory");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sourceBytes = await readFile(sourcePath), sourceSha256 = sha(sourceBytes);
const size = { width: 720, height: 1280 }, projection = { ...size, scaledWidth: 720, scaledHeight: 1280, padLeft: 0, padTop: 0 };
const placement = { x: 601, y: 0, width: 119, height: 78 };
const tools = { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" };
const masks = await Promise.all(["segment-14-17", "segment-90-93"].map(async segment => {
  const record = JSON.parse(await readFile(path.join(archive, segment, "result.json"), "utf8"));
  if (record.status !== "CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW" || record.sourceSha256 !== sourceSha256
    || JSON.stringify(record.decodedSize) !== JSON.stringify([size.width, size.height])) throw new Error("Diagnostic source/mask identity mismatch");
  const packed = await readFile(path.join(archive, segment, "candidate-mask.bitset"));
  const [x, y] = record.mask.bboxHalfOpen, [width, height] = record.mask.size;
  const sourceMask = decodeSourceMask({ kind: "static-binary-v1", encoding: "bitpack-lsb-row-major-v1", bbox: { x, y, width, height },
    dataBase64: packed.toString("base64"), sha256: record.mask.packedSha256, markedPixels: record.mask.markedPixels }, size);
  const projected = sourceMask && projectSourceMask(sourceMask, size, projection);
  if (!projected) throw new Error("Invalid raw diagnostic mask");
  return { segment, maskSha256: sha(packed), projected };
}));
// load is the existing hash/tombstone catalog owner; no import or image re-encoding occurs.
const assets = await new UploadedStickers(uploadedRoot, () => { throw new Error("Import disabled"); }).load();
await mkdir(outputDirectory); // Refuse to overwrite an earlier experiment.
const candidates = [];
for (const [candidateId, asset] of Object.entries(assets)) {
  try {
    const bytes = await readShapeCoverAsset(asset, tools);
    const raster = await rasterizeShapeCoverArtwork(bytes, size, placement, tools);
    const evaluations = masks.map(({ segment, maskSha256, projected }) => ({ segment, maskSha256, verdict: evaluateShapeCover(projected, raster.alpha, size, 1) }));
    const commonSafe = evaluations.every(cell => cell.verdict.status === "PASS");
    const overlays: Array<{ segment: string; path: string; pngSha256: string; radiusPx: number }> = [];
    if (commonSafe) for (const [index, cell] of evaluations.entries()) {
      const radius = cell.verdict.radiusPx!, grown = growOpaqueContour(raster.alpha, size, radius)!, rgba = Buffer.from(raster.rgba);
      for (let i = 0; i < grown.length; i++) if (grown[i]) {
        const alpha = rgba[i * 4 + 3];
        for (let channel = 0; channel < 3; channel++) rgba[i * 4 + channel] = Math.round((rgba[i * 4 + channel] * alpha + 255 * (255 - alpha)) / 255);
        rgba[i * 4 + 3] = 255;
      }
      const png = await encodeShapeCoverPng(rgba, size, tools), decoded = await decodeShapeCoverPng(png, size, tools);
      if (!decoded.equals(rgba) || masks[index].projected.some((marked, i) => marked && decoded[i * 4 + 3] !== 255)) throw new Error("Diagnostic PNG coverage mismatch");
      const filename = path.join(outputDirectory, `${candidateId}-${cell.segment}.png`);
      await writeFile(filename, png, { flag: "wx" });
      overlays.push({ segment: cell.segment, path: filename, pngSha256: sha(png), radiusPx: radius });
    }
    await readShapeCoverAsset(asset, tools);
    candidates.push({ candidateId, assetFingerprint: asset.assetFingerprint, alphaSha256: raster.alphaSha256, evaluations, commonSafe, overlays });
  } catch (error) { candidates.push({ candidateId, commonSafe: false, error: error instanceof Error ? error.message : "diagnostic failed" }); }
}
if (sha(await readFile(sourcePath)) !== sourceSha256) throw new Error("Source changed during diagnostic");
const commonSafeCandidateIds = candidates.filter(cell => cell.commonSafe).map(cell => cell.candidateId);
const report = { authority: "none", eligible: false, status: "GEOMETRY_DIAGNOSTIC_ONLY", sourceAdmission: "NOT_ATTEMPTED", humanReview: "NOT_EVALUATED",
  liveSelection: "INCOMPLETE", liveReview: "INCOMPLETE", modelRequests: 0, formalMetrics: null, independentHoldout: false,
  sourceSha256, sourceByteLength: sourceBytes.length, projection, placement, catalogOwner: "UploadedStickers.load", candidateCount: candidates.length,
  commonSafeCandidateIds, candidates };
await writeFile(path.join(outputDirectory, "geometry-matrix.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ outputDirectory, candidateCount: candidates.length, commonSafeCandidateIds, modelRequests: 0 })}\n`);
