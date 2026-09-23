import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { KnowledgeCandidateSchema, SourceIdentitySchema, type KnowledgeCandidate, type SourceMaskAdmissionProof } from "../shared/source-sticker-knowledge.js";
import { decodeSourceMask } from "./shape-cover-pixel-gate.js";
import { factsDigest, identifySource, type SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Pair = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
const ProbeSchema = z.object({
  status: z.literal("CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW"), reason: z.null(),
  sourceSha256: Digest, sourceBytes: z.number().int().positive(), decodedSize: Pair,
  roi: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().positive(), z.number().int().positive()]),
  fps: z.number().positive(), frameRange: Pair, decodedFrames: z.number().int().positive(), sampleFrames: z.array(z.number().int().nonnegative()).min(3).max(512),
  method: z.literal("temporal-max-channel-std-lt20-largest-8-connected-component-dilate-3-v1"),
  temporalCore: z.object({ checkedFrames: z.number().int().positive(), worst: z.object({ meanMaxChannelDifference: z.number().nonnegative() }), limit: z.literal(40) }),
  mask: z.object({ bboxHalfOpen: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
    size: Pair, markedPixels: z.number().int().positive(), packedFormat: z.literal("bitpack-lsb-row-major-v1"), packedBytes: z.number().int().positive(), packedSha256: Digest }),
  edgeSheet: z.object({ frames: z.array(z.number().int().nonnegative()).min(2).max(100), sha256: Digest }),
}).passthrough();
const ReviewSchema = z.object({
  version: z.literal(1), decision: z.literal("PASS"), reviewer: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/), at: z.string().datetime({ offset: true }),
  sourceSha256: Digest, maskSha256: Digest, probeSha256: Digest, contactSheetSha256: Digest,
  frameRange: Pair, reviewedFrames: z.number().int().min(2).max(100),
  edge: z.literal("conservative"), temporal: z.literal("stable"), presence: z.literal("verified"),
}).strict();
const ProbeOutput = z.object({
  streams: z.array(z.object({ width: z.number().int().positive(), height: z.number().int().positive(), time_base: z.string(),
    tags: z.object({ rotate: z.string().optional() }).optional(), side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional() }).passthrough()).min(1),
  format: z.object({ duration: z.string() }),
  frames: z.array(z.object({ best_effort_timestamp: z.union([z.string(), z.number()]), width: z.number().int().positive(), height: z.number().int().positive() }).passthrough()).min(2),
}).passthrough();

function sha(bytes: Buffer | string): string { return createHash("sha256").update(bytes).digest("hex"); }
function unsafe(reason: string): never { throw new Error(`UNSAFE: ${reason}`); }
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
async function command(binary: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [], errors: Buffer[] = [];
    let length = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.stdout.on("data", (chunk: Buffer) => { length += chunk.length; if (length > 8 * 1024 * 1024) child.kill("SIGKILL"); else output.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { if (errors.reduce((sum, part) => sum + part.length, 0) < 4096) errors.push(chunk); });
    child.on("error", reject);
    child.on("close", code => { clearTimeout(timer); code === 0 && length <= 8 * 1024 * 1024 ? resolve(Buffer.concat(output)) : reject(new Error(`Media evidence command failed: ${Buffer.concat(errors).toString("utf8").slice(0, 300)}`)); });
  });
}

export interface SourceMaskAdmissionInput {
  sourcePath: string;
  probeReport: Buffer;
  packedMask: Buffer;
  contactSheet: Buffer;
  reviewReceipt: Buffer;
  ffmpegPath: string;
  ffprobePath: string;
  store: SourceStickerKnowledgeStore;
}

/** A human PASS is bound to exact probe, sheet, source bytes, decoded PTS and persisted mask. */
async function publishReviewedSourceMask(input: SourceMaskAdmissionInput) {
  if (!input.probeReport.length || input.probeReport.length > 8 * 1024 * 1024
    || !input.reviewReceipt.length || input.reviewReceipt.length > 8 * 1024 * 1024
    || !input.contactSheet.length || input.contactSheet.length > 8 * 1024 * 1024
    || !pngSize(input.contactSheet)?.width || !pngSize(input.contactSheet)?.height) unsafe("review evidence is missing, oversized or not a PNG contact sheet");
  const probe = ProbeSchema.parse(JSON.parse(input.probeReport.toString("utf8")));
  const review = ReviewSchema.parse(JSON.parse(input.reviewReceipt.toString("utf8")));
  const [start, end] = probe.frameRange;
  if (end - start < 30 || end - start > 100 || probe.decodedFrames !== end || probe.edgeSheet.frames.length !== end - start
    || probe.edgeSheet.frames.some((frame, index) => frame !== start + index)
    || probe.temporalCore.checkedFrames !== end - start || probe.temporalCore.worst.meanMaxChannelDifference > probe.temporalCore.limit
    || probe.sampleFrames[0] !== start || probe.sampleFrames.at(-1)! < end - 3
    || probe.sampleFrames.some((frame, index) => frame < start || frame >= end || (index > 0 && frame <= probe.sampleFrames[index - 1]))) unsafe("probe time evidence is incomplete");
  if (review.sourceSha256 !== probe.sourceSha256 || review.maskSha256 !== probe.mask.packedSha256
    || review.probeSha256 !== sha(input.probeReport) || review.contactSheetSha256 !== probe.edgeSheet.sha256
    || review.frameRange[0] !== start || review.frameRange[1] !== end || review.reviewedFrames !== end - start
    || sha(input.contactSheet) !== probe.edgeSheet.sha256 || sha(input.packedMask) !== probe.mask.packedSha256
    || input.packedMask.length !== probe.mask.packedBytes) unsafe("review, mask or contact sheet does not match the probe");
  const media = ProbeOutput.parse(JSON.parse((await command(input.ffprobePath, ["-v", "error", "-select_streams", "v:0", "-show_streams", "-show_format", "-show_frames", "-show_entries", "stream=width,height,time_base,tags,side_data_list:format=duration:frame=best_effort_timestamp,width,height", "-of", "json", input.sourcePath])).toString("utf8")));
  const stream = media.streams[0], rotation = Number(stream.tags?.rotate ?? stream.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? 0);
  if (rotation !== 0 || !/^([1-9]\d*)\/([1-9]\d*)$/.test(stream.time_base) || !media.frames[end]
    || stream.width !== probe.decodedSize[0] || stream.height !== probe.decodedSize[1]
    || media.frames.some(frame => frame.width !== stream.width || frame.height !== stream.height)) unsafe("source interpretation is unsupported or changed");
  const source = SourceIdentitySchema.parse(await identifySource(input.sourcePath, { width: stream.width, height: stream.height, rotation: 0,
    durationMs: Math.round(Number(media.format.duration) * 1000), timeBase: stream.time_base,
    timeOriginPts: Number(media.frames[0].best_effort_timestamp), interpretationVersion: 1 }));
  if (source.fingerprint !== `sha256:${probe.sourceSha256}` || source.byteLength !== probe.sourceBytes) unsafe("source bytes changed");
  const [num, den] = stream.time_base.split("/").map(Number);
  const at = (index: number) => {
    const pts = Number(media.frames[index].best_effort_timestamp);
    if (!Number.isSafeInteger(pts)) unsafe("invalid source PTS");
    return { pts, timeMs: (pts - source.timeOriginPts) * num / den * 1000 };
  };
  const first = at(start), last = at(end - 1), after = at(end);
  for (let index = start + 1; index <= end; index++) if (Math.abs(at(index).timeMs - at(index - 1).timeMs - 1000 / probe.fps) > 1) unsafe("variable frame timing is unsupported by this probe");
  const startMs = Math.round(first.timeMs), endMs = Math.round(after.timeMs);
  if (Math.abs(startMs - first.timeMs) > 0.5 || Math.abs(endMs - after.timeMs) > 0.5 || endMs - startMs < 1000
    || last.timeMs <= first.timeMs || last.timeMs >= endMs) unsafe("source frame boundary cannot be represented conservatively");
  const [left, top, right, bottom] = probe.mask.bboxHalfOpen;
  const [roiX, roiY, roiWidth, roiHeight] = probe.roi;
  if (left <= roiX || top <= roiY || right >= roiX + roiWidth || bottom >= roiY + roiHeight) unsafe("probe ROI touches or clips the mask");
  const bbox = { x: left, y: top, width: right - left, height: bottom - top };
  if (bbox.width !== probe.mask.size[0] || bbox.height !== probe.mask.size[1]) unsafe("mask dimensions changed");
  const mask = {
    kind: "static-binary-v1" as const, bbox, encoding: "bitpack-lsb-row-major-v1" as const,
    dataBase64: input.packedMask.toString("base64"), sha256: probe.mask.packedSha256, markedPixels: probe.mask.markedPixels,
    creation: { method: "temporal-stability", version: 1 },
    review: { method: "contact-sheet", version: 1, reviewer: review.reviewer, at: review.at },
    evidenceIds: ["mask-first", "mask-last"],
  };
  if (!decodeSourceMask(mask, { width: source.width, height: source.height })) unsafe("mask encoding or bounds are invalid");
  const directory = await mkdtemp(path.join(os.tmpdir(), "jianji-source-mask-admission-"));
  let run: Awaited<ReturnType<SourceStickerKnowledgeStore["beginRun"]>> | undefined;
  try {
    await command(input.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", "-noautorotate", "-i", input.sourcePath,
      "-vf", `select='eq(n\\,${start})+eq(n\\,${end - 1})'`, "-vsync", "0", "-frames:v", "2", "-c:v", "png", path.join(directory, "frame-%d.png")]);
    const bytes = [await readFile(path.join(directory, "frame-1.png")), await readFile(path.join(directory, "frame-2.png"))];
    if (bytes.some(frame => !frame.length || frame.length > 8 * 1024 * 1024
      || pngSize(frame)?.width !== source.width || pngSize(frame)?.height !== source.height)) unsafe("source evidence frame is missing, resized or oversized");
    await input.store.verifySource(input.sourcePath, source);
    const evidence = [first, last].map((frame, index) => ({ id: index ? "mask-last" : "mask-first", kind: "source" as const,
      digest: sha(bytes[index]), byteLength: bytes[index].length, pts: frame.pts, timeMs: frame.timeMs, width: source.width, height: source.height }));
    const artifacts = [
      { id: "mask-probe", kind: "source-mask-review" as const, artifact: "probe-report" as const, digest: sha(input.probeReport), byteLength: input.probeReport.length },
      { id: "mask-contact-sheet", kind: "source-mask-review" as const, artifact: "contact-sheet" as const, digest: sha(input.contactSheet), byteLength: input.contactSheet.length },
      { id: "mask-review-receipt", kind: "source-mask-review" as const, artifact: "review-receipt" as const, digest: sha(input.reviewReceipt), byteLength: input.reviewReceipt.length },
    ];
    const rectangle = { x: left / source.width, y: top / source.height, width: bbox.width / source.width, height: bbox.height / source.height };
    const range = { startMs, endMs };
    run = await input.store.beginRun(source);
    const candidate: KnowledgeCandidate = KnowledgeCandidateSchema.parse({ schemaVersion: 1, id: randomUUID(), state: "candidate", source,
      baseRevisionId: null, runId: run.id, requiredRanges: [range],
      facts: { reviewedRanges: [range], targets: [{ id: "static-sticker", segments: [{ id: "static-segment", track: { ...range, keyframes: [{ timeMs: startMs, rectangle }] },
        evidenceIds: mask.evidenceIds, interpolation: "linear", mask }] }], exclusions: [],
        observations: evidence.map(frame => ({ evidenceId: frame.id, targetId: "static-sticker", presence: "PRESENT", rectangle })),
        samplingStrategy: `temporal-stability-v1-frames-${start}-${end}` },
      evidence: [...evidence, ...artifacts], resolvedDisputeIds: [], changes: [],
      provenance: { executor: "local-mask-probe-v1", supervisor: review.reviewer, contractVersion: 1, requests: 0, at: review.at } });
    const proof: SourceMaskAdmissionProof = { mode: "source-mask-only-v1", candidateId: candidate.id, factsDigest: factsDigest(candidate.facts), sourceReviewed: true,
      maskReview: "PASS", sourceEvidenceIds: mask.evidenceIds, probeSha256: sha(input.probeReport), contactSheetSha256: probe.edgeSheet.sha256,
      reviewReceiptSha256: sha(input.reviewReceipt), reviewedFrameRange: { start, endExclusive: end } };
    const blobs = new Map<string, Buffer>([...bytes, input.probeReport, input.contactSheet, input.reviewReceipt].map(value => [sha(value), value]));
    const revision = await input.store.publishSourceMask(run, candidate, proof, blobs);
    await input.store.verifySource(input.sourcePath, source);
    const head = await input.store.readHead(source);
    if (head?.revision.id !== revision.id || head.revision.verification !== "source-mask-only"
      || head.revision.candidate.facts.targets[0].segments[0].mask?.sha256 !== mask.sha256) unsafe("published source mask readback failed");
    return { source, revision };
  } finally {
    if (run) await input.store.endRun(run);
    await rm(directory, { recursive: true, force: true });
  }
}

export async function admitReviewedSourceMask(input: SourceMaskAdmissionInput) {
  try { return await publishReviewedSourceMask(input); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("UNSAFE:")) throw error;
    throw new Error(`UNSAFE: ${error instanceof Error ? error.message : "source mask admission failed"}`, { cause: error });
  }
}
