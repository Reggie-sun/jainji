import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { admitReviewedSourceMask } from "../src/main/source-mask-admission";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";

const available = ["ffmpeg", "ffprobe"].every(binary => spawnSync(binary, ["-version"], { stdio: "ignore" }).status === 0);
const directories: string[] = [];
const stores: SourceStickerKnowledgeStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jianji-mask-admission-test-")); directories.push(directory);
  const sourcePath = path.join(directory, "source.mp4");
  const created = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=white:s=64x64:r=30:d=3",
    "-vf", "drawbox=x=10:y=10:w=8:h=8:color=black:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath]);
  expect(created.status).toBe(0);
  const source = await readFile(sourcePath), packedMask = Buffer.alloc(8, 255);
  const contactSheet = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64");
  const probe = {
    status: "CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW", reason: null, sourceSha256: sha(source), sourceBytes: source.length,
    decodedSize: [64, 64], roi: [0, 0, 64, 64], fps: 30, frameRange: [0, 60], decodedFrames: 60, sampleFrames: [0, 2, 4, 58],
    method: "temporal-max-channel-std-lt20-largest-8-connected-component-dilate-3-v1",
    temporalCore: { checkedFrames: 60, worst: { meanMaxChannelDifference: 0 }, limit: 40 },
    mask: { bboxHalfOpen: [10, 10, 18, 18], size: [8, 8], markedPixels: 64, packedFormat: "bitpack-lsb-row-major-v1",
      packedBytes: packedMask.length, packedSha256: sha(packedMask) },
    edgeSheet: { frames: Array.from({ length: 60 }, (_, index) => index), sha256: sha(contactSheet) },
  };
  const probeReport = Buffer.from(`${JSON.stringify(probe)}\n`);
  const review = {
    version: 1, decision: "PASS", reviewer: "test-human", at: "2026-09-24T00:00:00Z", sourceSha256: probe.sourceSha256,
    maskSha256: probe.mask.packedSha256, probeSha256: sha(probeReport), contactSheetSha256: probe.edgeSheet.sha256,
    frameRange: probe.frameRange, reviewedFrames: 60, edge: "conservative", temporal: "stable", presence: "verified",
  };
  const store = await SourceStickerKnowledgeStore.open(directory); stores.push(store);
  return { directory, sourcePath, store, probeReport, packedMask, contactSheet, reviewReceipt: Buffer.from(`${JSON.stringify(review)}\n`) };
}

describe.skipIf(!available)("source mask admission and canonical publication", () => {
  it("publishes one reviewed segment with source-only proof and survives restart", async () => {
    const input = await fixture();
    const { source, revision } = await admitReviewedSourceMask({ ...input, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" });
    expect(revision.verification).toBe("source-mask-only");
    expect(revision.proof).toMatchObject({ mode: "source-mask-only-v1", maskReview: "PASS", reviewedFrameRange: { start: 0, endExclusive: 60 } });
    expect(revision.candidate.evidence).toHaveLength(5);
    expect(revision.candidate.facts.targets[0].segments[0].mask?.sha256).toBe(sha(input.packedMask));
    expect(revision.candidate.facts.reviewedRanges).toEqual([{ startMs: 0, endMs: 2000 }]);
    expect((await input.store.lookup(source, [{ startMs: 0, endMs: 3000 }])).status).toBe("miss");
    await input.store.close();
    const reopened = await SourceStickerKnowledgeStore.open(input.directory); stores.push(reopened);
    const head = await reopened.readHead(source);
    expect(head?.revision.id).toBe(revision.id);
    expect(head?.blobs.get(sha(input.reviewReceipt))).toEqual(input.reviewReceipt);
    expect(head?.blobs.get(sha(input.contactSheet))).toEqual(input.contactSheet);
    expect((await reopened.lookup(source, [{ startMs: 0, endMs: 2000 }])).status).toBe("hit");
    await expect(admitReviewedSourceMask({ ...input, store: reopened, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" })).rejects.toThrow();
  });

  it("rejects missing human PASS, altered review inputs and incomplete temporal sheets before publishing", async () => {
    const input = await fixture();
    const receipt = JSON.parse(input.reviewReceipt.toString("utf8"));
    for (const changed of [
      { ...input, reviewReceipt: Buffer.from(JSON.stringify({ ...receipt, decision: "FAIL" })) },
      { ...input, packedMask: Buffer.alloc(8, 0) },
      { ...input, contactSheet: Buffer.from("different sheet") },
      { ...input, probeReport: Buffer.from(input.probeReport.toString().replace('"checkedFrames":60', '"checkedFrames":59')) },
      { ...input, probeReport: Buffer.from(input.probeReport.toString().replace('"frames":[0,1,2', '"frames":[0,2,2')) },
    ]) await expect(admitReviewedSourceMask({ ...changed, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" })).rejects.toThrow(/^UNSAFE:/);
    const contactSheet = Buffer.from("not a PNG");
    const probeReport = Buffer.from(input.probeReport.toString().replace(sha(input.contactSheet), sha(contactSheet)));
    const reviewReceipt = Buffer.from(JSON.stringify({ ...receipt, probeSha256: sha(probeReport), contactSheetSha256: sha(contactSheet) }));
    await expect(admitReviewedSourceMask({ ...input, contactSheet, probeReport, reviewReceipt, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" })).rejects.toThrow(/not a PNG/);
    await writeFile(input.sourcePath, "changed bytes");
    await expect(admitReviewedSourceMask({ ...input, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" })).rejects.toThrow();
  });

  it("rejects a changed stored human review artifact on reload", async () => {
    const input = await fixture();
    const { source, revision } = await admitReviewedSourceMask({ ...input, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" });
    const events = path.join(input.store.directory, "sources", revision.sourceKey, "events");
    const [eventId] = await readdir(events);
    const receipt = path.join(events, eventId, "evidence", sha(input.reviewReceipt));
    await writeFile(receipt, Buffer.from("changed review receipt"));
    await expect(input.store.readHead(source)).rejects.toThrow();
  });
});
