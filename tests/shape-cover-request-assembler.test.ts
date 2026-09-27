import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShapeCoverRequestAssembler } from "../src/main/shape-cover-request-assembler";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";
import { admitReviewedSourceMask } from "../src/main/source-mask-admission";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const dirs: string[] = [], stores: SourceStickerKnowledgeStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const intent = (mediaIds = [crypto.randomUUID()]) => ({
  coverStrategy: "shape-matched-static-v1", ruleId: "clean", brief: "", mediaIds, outputDirectory: "/unused-output",
  decorations: { mode: "agent", productPrice: "手动展示", sticker: "template", fontFamily: "Noto Sans CJK SC" },
});
function setup(store?: SourceStickerKnowledgeStore) {
  const ffmpeg = new FfmpegAdapter("ffmpeg", "ffprobe");
  const service = new ApplicationService(ffmpeg, { resolve: async () => null });
  service.currentProject.coverSticker = { enabled: true, trackingMode: "agent", stickerIds: [], rectangle: { x: .1, y: .1, width: .5, height: .5 } };
  return { service, assembler: new ShapeCoverRequestAssembler({ service, store, ffmpeg }) };
}

describe("shape request assembler input boundary", () => {
  it.each(["source", "intendedTargets", "segmentId", "revisionId", "outputSettings", "candidates", "placements", "contentSafety", "completeness", "enabled"])("rejects caller field %s before collecting canonical facts", async field => {
    const { assembler } = setup();
    await expect(assembler.assemble({ ...intent(), [field]: true }, new AbortController().signal)).rejects.toThrow(/UNSAFE:.*intent/);
  });
  it("requires explicit versioned intent, not an ordinary request", async () => {
    const { coverStrategy: _strategy, ...legacy } = intent();
    await expect(setup().assembler.assemble(legacy, new AbortController().signal)).rejects.toThrow(/UNSAFE:.*intent/);
  });
  it("rejects a media id outside the canonical project", async () => {
    await expect(setup().assembler.assemble(intent(), new AbortController().signal)).rejects.toThrow(/UNSAFE:.*素材/);
  });
  it("does not normalize an unknown version into the old mode", async () => {
    await expect(setup().assembler.assemble({ ...intent(), coverStrategy: "shape-matched-static-v2" }, new AbortController().signal)).rejects.toThrow(/UNSAFE:.*intent/);
  });
  it("fails cancelled input without returning a partial request", async () => {
    const abort = new AbortController(); abort.abort();
    await expect(setup().assembler.assemble(intent(), abort.signal)).rejects.toThrow(/UNSAFE:.*取消/);
  });
});

const available = ["ffmpeg", "ffprobe"].every(binary => spawnSync(binary, ["-version"], { stdio: "ignore" }).status === 0);
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jianji-shape-assembler-")); dirs.push(directory);
  const sourcePath = path.join(directory, "source.mp4");
  const created = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=white:s=64x64:r=30:d=3",
    "-vf", "drawbox=x=10:y=10:w=8:h=8:color=black:t=fill", "-threads", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath]);
  expect(created.status).toBe(0);
  const sourceBytes = await readFile(sourcePath), packedMask = Buffer.alloc(8, 255);
  const contactSheet = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64");
  const probe = { status: "CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW", reason: null, sourceSha256: hash(sourceBytes), sourceBytes: sourceBytes.length,
    decodedSize: [64, 64], roi: [0, 0, 64, 64], fps: 30, frameRange: [0, 60], decodedFrames: 60, sampleFrames: [0, 2, 4, 58],
    method: "temporal-max-channel-std-lt20-largest-8-connected-component-dilate-3-v1",
    temporalCore: { checkedFrames: 60, worst: { meanMaxChannelDifference: 0 }, limit: 40 },
    mask: { bboxHalfOpen: [10, 10, 18, 18], size: [8, 8], markedPixels: 64, packedFormat: "bitpack-lsb-row-major-v1", packedBytes: 8, packedSha256: hash(packedMask) },
    edgeSheet: { frames: Array.from({ length: 60 }, (_, i) => i), sha256: hash(contactSheet) } };
  const probeReport = Buffer.from(`${JSON.stringify(probe)}\n`);
  const reviewReceipt = Buffer.from(`${JSON.stringify({ version: 1, decision: "PASS", reviewer: "test-human", at: "2026-09-24T00:00:00Z",
    sourceSha256: probe.sourceSha256, maskSha256: hash(packedMask), probeSha256: hash(probeReport), contactSheetSha256: hash(contactSheet),
    frameRange: [0, 60], reviewedFrames: 60, edge: "conservative", temporal: "stable", presence: "verified" })}\n`);
  const store = await SourceStickerKnowledgeStore.open(directory); stores.push(store);
  const admitted = await admitReviewedSourceMask({ sourcePath, store, probeReport, packedMask, contactSheet, reviewReceipt, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" });
  const value = setup(store), id = crypto.randomUUID();
  value.service.currentProject.mediaItems.push({ id, sourcePath, displayName: "fixture", fingerprint: admitted.source.fingerprint, sizeBytes: admitted.source.byteLength,
    width: 64, height: 64, rotation: 0, durationMs: 3000, probeStatus: "ready", importedAt: "2026-09-24T00:00:00Z" });
  return { ...value, ...admitted, store, sourcePath, sourceBytes, input: intent([id]) };
}

describe.skipIf(!available)("canonical mask facts never imply full-source request authority", () => {
  it("reads a real admitted revision but refuses to issue from a short segment", async () => {
    const value = await fixture(), head = vi.spyOn(value.store, "readHead");
    await expect(value.assembler.assemble(value.input, new AbortController().signal)).rejects.toThrow(/UNSAFE:.*M5-D/);
    expect(head).toHaveBeenCalledWith(value.source);
    expect((await value.store.readHead(value.source))?.revision.id).toBe(value.revision.id);
  });
  it("does not treat even full-length reviewedRanges as completeness authority", async () => {
    const value = await fixture(), head = await value.store.readHead(value.source);
    // This is a read-side counterexample, not an issued D proof or a store publication.
    head!.revision.candidate.facts.reviewedRanges = [{ startMs: 0, endMs: 3000 }];
    vi.spyOn(value.store, "readHead").mockResolvedValue(head);
    await expect(value.assembler.assemble(value.input, new AbortController().signal)).rejects.toThrow(/UNSAFE:.*M5-D/);
  });
  it("rejects changed source bytes before using a reviewed revision", async () => {
    const value = await fixture();
    await writeFile(value.sourcePath, Buffer.concat([value.sourceBytes, Buffer.from("drift")]));
    await expect(value.assembler.assemble(value.input, new AbortController().signal)).rejects.toThrow(/UNSAFE:/);
  });
  it("rejects a missing canonical head rather than deriving masks from project rectangles", async () => {
    const value = await fixture(); vi.spyOn(value.store, "readHead").mockResolvedValue(undefined);
    await expect(value.assembler.assemble(value.input, new AbortController().signal)).rejects.toThrow(/UNSAFE:.*mask/);
  });
  it("collects every selected media before considering any request issuance", async () => {
    const value = await fixture(), secondId = crypto.randomUUID();
    value.service.currentProject.mediaItems.push({ ...value.service.currentProject.mediaItems[0], id: secondId });
    const readHead = value.store.readHead.bind(value.store);
    let reads = 0;
    vi.spyOn(value.store, "readHead").mockImplementation(source => ++reads >= 3 ? Promise.resolve(undefined) : readHead(source));
    await expect(value.assembler.assemble(intent([...value.input.mediaIds, secondId]), new AbortController().signal)).rejects.toThrow(/UNSAFE:.*mask/);
    expect(reads).toBe(3);
  });
  it("rejects an unusable mask instead of using the canonical track bbox", async () => {
    const value = await fixture(), head = await value.store.readHead(value.source);
    head!.revision.candidate.facts.targets[0].segments[0].mask = undefined;
    vi.spyOn(value.store, "readHead").mockResolvedValue(head);
    await expect(value.assembler.assemble(value.input, new AbortController().signal)).rejects.toThrow(/UNSAFE:.*mask/);
  });
});
