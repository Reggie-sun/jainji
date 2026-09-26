import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admitReviewedSourceMask } from "../src/main/source-mask-admission";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";
import { computeCommonShapeCoverCandidates, type ShapeCoverCandidateRequest } from "../src/main/shape-cover-candidates";
import * as alphaMedia from "../src/main/shape-cover-alpha";
import type { ExportSettings } from "../src/shared/export-settings";

const available = ["ffmpeg", "ffprobe"].every(binary => spawnSync(binary, ["-version"], { stdio: "ignore" }).status === 0);
const roots: string[] = [], stores: SourceStickerKnowledgeStore[] = [];
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const settings: ExportSettings = { resolutionMode: "source", frameRateMode: "source", quality: "balanced" };
const placement = { x: 6, y: 6, width: 32, height: 32 };
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(sourceSize = 64) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jianji-common-shape-")); roots.push(root);
  const store = await SourceStickerKnowledgeStore.open(root); stores.push(store);
  const targets: ShapeCoverCandidateRequest["intendedTargets"] = [];
  const sheet = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64");
  for (const [index, x] of [10, 26].entries()) {
    const sourcePath = path.join(root, `source-${index}.mp4`);
    expect(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", `color=c=white:s=${sourceSize}x${sourceSize}:r=30:d=3`,
      "-vf", `drawbox=x=${x}:y=10:w=8:h=8:color=black:t=fill`, "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", sourcePath]).status).toBe(0);
    const sourceBytes = await readFile(sourcePath), packedMask = Buffer.alloc(8, 255);
    const probe = { status: "CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW", reason: null, sourceSha256: sha(sourceBytes), sourceBytes: sourceBytes.length,
      decodedSize: [sourceSize, sourceSize], roi: [0, 0, sourceSize, sourceSize], fps: 30, frameRange: [0, 60], decodedFrames: 60, sampleFrames: [0, 2, 4, 58],
      method: "temporal-max-channel-std-lt20-largest-8-connected-component-dilate-3-v1",
      temporalCore: { checkedFrames: 60, worst: { meanMaxChannelDifference: 0 }, limit: 40 },
      mask: { bboxHalfOpen: [x, 10, x + 8, 18], size: [8, 8], markedPixels: 64, packedFormat: "bitpack-lsb-row-major-v1", packedBytes: 8, packedSha256: sha(packedMask) },
      edgeSheet: { frames: Array.from({ length: 60 }, (_, i) => i), sha256: sha(sheet) } };
    const probeReport = Buffer.from(JSON.stringify(probe));
    const reviewReceipt = Buffer.from(JSON.stringify({ version: 1, decision: "PASS", reviewer: "test-human", at: "2026-09-27T00:00:00Z",
      sourceSha256: probe.sourceSha256, maskSha256: sha(packedMask), probeSha256: sha(probeReport), contactSheetSha256: sha(sheet),
      frameRange: [0, 60], reviewedFrames: 60, edge: "conservative", temporal: "stable", presence: "verified" }));
    const { source, revision } = await admitReviewedSourceMask({ sourcePath, store, packedMask, probeReport, reviewReceipt, contactSheet: sheet, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" });
    targets.push({ id: `intended-${index}`, sourcePath, source, revisionId: revision.id, targetId: "static-sticker", segmentId: "static-segment",
      range: { startMs: 0, endMs: 2000 }, placements: [{ outputSettingId: "source", rectangle: { ...placement } }] });
  }
  const candidates: ShapeCoverCandidateRequest["candidates"] = [];
  for (const kind of ["left", "right", "full", "partial", "empty"] as const) {
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      pixels[i] = 255;
      pixels[i + 3] = kind === "empty" ? 0 : kind === "partial" ? 128 : kind === "left" && x >= 16 || kind === "right" && x < 16 ? 0 : 255;
    }
    const assetPath = path.join(root, `${kind}.png`);
    expect(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "32x32", "-i", "pipe:0", "-frames:v", "1", "-threads", "1", assetPath], { input: pixels }).status).toBe(0);
    const fingerprint = sha(await readFile(assetPath));
    candidates.push({ id: `uploaded-${fingerprint}`, asset: { assetPath, assetFingerprint: `sha256:${fingerprint}` } });
  }
  return { root, store, request: { intendedTargets: targets, outputSettings: [{ id: "source", settings }], candidates } satisfies ShapeCoverCandidateRequest };
}
const tools = { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" };

describe.skipIf(!available)("whole-round shape candidate geometry", () => {
  it("uses real alpha and intersects every intended target rather than the first", async () => {
    const { store, request } = await fixture();
    const first = await computeCommonShapeCoverCandidates({ ...request, intendedTargets: request.intendedTargets.slice(0, 1) }, store, tools);
    expect(first.commonSafeCandidateIds, JSON.stringify(first)).toContain(request.candidates[0].id);
    const round = await computeCommonShapeCoverCandidates(request, store, tools);
    expect(round).toMatchObject({ status: "PASS", verification: "geometry-only", contentSafety: "NOT_EVALUATED", commonSafeCandidateIds: [request.candidates[2].id] });
    expect(round.evaluations).toHaveLength(10);
    expect(round.evaluations.filter(cell => cell.candidateId === request.candidates[0].id).map(cell => cell.verdict.status)).toEqual(["PASS", "UNSAFE"]);
    expect(round.evaluations.filter(cell => cell.candidateId === request.candidates[1].id).map(cell => cell.verdict.status)).toEqual(["UNSAFE", "PASS"]);
    expect(round.evaluations.filter(cell => cell.candidateId === request.candidates[3].id || cell.candidateId === request.candidates[4].id).every(cell => cell.verdict.status === "UNSAFE")).toBe(true);
    expect(round.evaluations[0]).toMatchObject({ sourceRevisionId: request.intendedTargets[0].revisionId, outputSettingId: "source", placement, rasterVersion: "ffmpeg-bicubic-contain-rgba-v1" });
    expect(round.evaluations[0].alphaSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns UNSAFE for an empty intersection even though each target has a candidate", async () => {
    const { store, request } = await fixture();
    const result = await computeCommonShapeCoverCandidates({ ...request, candidates: request.candidates.slice(0, 2) }, store, tools);
    expect(result).toMatchObject({ status: "UNSAFE", reason: "no-common-candidate", commonSafeCandidateIds: [] });
    expect(result.evaluations.filter(cell => cell.verdict.status === "PASS")).toHaveLength(2);
  });

  it.each(["target", "segment", "range", "revision", "identity", "placement"])("rejects a missing or mismatched intended %s before enumerating assets", async change => {
    const { store, request } = await fixture();
    const target = request.intendedTargets[1];
    if (change === "target") target.targetId = "missing";
    if (change === "segment") target.segmentId = "missing";
    if (change === "range") target.range.endMs = 2500;
    if (change === "revision") target.revisionId = "stale";
    if (change === "identity") target.source = { ...target.source, interpretationVersion: 2 };
    if (change === "placement") target.placements = [];
    const opened = vi.spyOn(store, "verifySource");
    const assetRead = vi.spyOn(alphaMedia, "readShapeCoverAsset");
    const result = await computeCommonShapeCoverCandidates({ ...request, candidates: [{ id: request.candidates[2].id, asset: { ...request.candidates[2].asset, assetPath: "must-not-be-read.png" } }] }, store, tools);
    expect(result.status).toBe("UNSAFE");
    expect(result.commonSafeCandidateIds).toEqual([]);
    expect(result.evaluations).toEqual([]);
    expect(assetRead).not.toHaveBeenCalled();
    if (change !== "placement") expect(opened).toHaveBeenCalled();
  });

  it("rejects changed source bytes and stored review evidence", async () => {
    const { root, store, request } = await fixture();
    const first = request.intendedTargets[0];
    const original = await readFile(first.sourcePath);
    await writeFile(first.sourcePath, "changed source");
    expect((await computeCommonShapeCoverCandidates(request, store, tools)).status).toBe("UNSAFE");
    await writeFile(first.sourcePath, original);
    const key = (await store.readHead(first.source))!.revision.sourceKey;
    const events = path.join(store.directory, "sources", key, "events");
    const [event] = await readdir(events), evidenceDir = path.join(events, event, "evidence");
    const [blob] = await readdir(evidenceDir); await writeFile(path.join(evidenceDir, blob), "changed evidence");
    expect((await computeCommonShapeCoverCandidates(request, store, tools)).evaluations).toEqual([]);
    expect(await readdir(root)).toContain("source-0.mp4");
  });

  it("binds every output setting and does not reuse a source-size PASS at 720p", async () => {
    const { store, request } = await fixture(128);
    request.candidates = [request.candidates[2]];
    request.outputSettings.push({ id: "720", settings: { ...settings, resolutionMode: "720p", frameRateMode: "30" } });
    for (const target of request.intendedTargets) target.placements.push({ outputSettingId: "720", rectangle: { ...placement } });
    const result = await computeCommonShapeCoverCandidates(request, store, tools);
    expect(result).toMatchObject({ status: "UNSAFE", reason: "no-common-candidate", commonSafeCandidateIds: [] });
    expect(result.evaluations.filter(cell => cell.outputSettingId === "source").every(cell => cell.verdict.status === "PASS")).toBe(true);
    expect(result.evaluations.filter(cell => cell.outputSettingId === "720").every(cell => cell.verdict.status === "UNSAFE" && cell.verdict.reason === "no-shape-match")).toBe(true);
    expect(result.evaluations.find(cell => cell.outputSettingId === "720")?.projection).toMatchObject({ width: 1280, height: 720, scaledWidth: 720, scaledHeight: 720, padLeft: 280, padTop: 0 });
    for (const target of request.intendedTargets) target.placements[1].rectangle = { x: 314, y: 34, width: 210, height: 210 };
    const corrected = await computeCommonShapeCoverCandidates(request, store, tools);
    expect(corrected).toMatchObject({ status: "PASS", commonSafeCandidateIds: [request.candidates[0].id] });
    expect(corrected.evaluations).toHaveLength(4);
    expect(corrected.evaluations.every(cell => cell.verdict.status === "PASS" && cell.verdict.uncoveredPixels === 0)).toBe(true);
  });

  it("rejects corrupt assets, duplicate IDs, invalid geometry and cancellation", async () => {
    const { store, request } = await fixture();
    request.candidates = [request.candidates[2]];
    await writeFile(request.candidates[0].asset.assetPath, "changed asset");
    expect((await computeCommonShapeCoverCandidates(request, store, tools)).commonSafeCandidateIds).toEqual([]);
    expect((await computeCommonShapeCoverCandidates({ ...request, intendedTargets: [request.intendedTargets[0], request.intendedTargets[0]] }, store, tools)).evaluations).toEqual([]);
    request.intendedTargets[0].placements[0].rectangle.x = -1;
    expect((await computeCommonShapeCoverCandidates(request, store, tools)).evaluations).toEqual([]);
    const controller = new AbortController(); controller.abort();
    expect(await computeCommonShapeCoverCandidates(request, store, { ...tools, signal: controller.signal })).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
  });

  it("fences a changed head, source, asset or cancellation during evaluation", async () => {
    const { store, request } = await fixture();
    request.candidates = [request.candidates[2]];
    const readHead = store.readHead.bind(store);
    let calls = 0;
    const spy = vi.spyOn(store, "readHead").mockImplementation(async source => {
      const head = await readHead(source);
      return ++calls > request.intendedTargets.length && head ? { ...head, revision: { ...head.revision, id: "new-revision" } } : head;
    });
    const stale = await computeCommonShapeCoverCandidates(request, store, tools);
    expect(stale.evaluations.every(cell => cell.verdict.status === "PASS")).toBe(true);
    expect(stale).toMatchObject({ status: "UNSAFE", reason: "round-invalid-or-stale", commonSafeCandidateIds: [] });
    spy.mockRestore();
    const rasterize = alphaMedia.rasterizeShapeCoverAlpha;
    const originalSource = await readFile(request.intendedTargets[0].sourcePath);
    const sourceSpy = vi.spyOn(alphaMedia, "rasterizeShapeCoverAlpha").mockImplementation(async (...args) => {
      const result = await rasterize(...args);
      await writeFile(request.intendedTargets[0].sourcePath, "changed during evaluation");
      return result;
    });
    expect(await computeCommonShapeCoverCandidates(request, store, tools)).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
    sourceSpy.mockRestore(); await writeFile(request.intendedTargets[0].sourcePath, originalSource);
    const originalAsset = await readFile(request.candidates[0].asset.assetPath);
    const rasterSpy = vi.spyOn(alphaMedia, "rasterizeShapeCoverAlpha").mockImplementation(async (...args) => {
      const result = await rasterize(...args);
      await writeFile(request.candidates[0].asset.assetPath, "changed after frozen read");
      return result;
    });
    expect(await computeCommonShapeCoverCandidates(request, store, tools)).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
    rasterSpy.mockRestore(); await writeFile(request.candidates[0].asset.assetPath, originalAsset);
    const controller = new AbortController();
    vi.spyOn(alphaMedia, "rasterizeShapeCoverAlpha").mockImplementation(async (...args) => {
      const result = await rasterize(...args); controller.abort(); return result;
    });
    expect(await computeCommonShapeCoverCandidates(request, store, { ...tools, signal: controller.signal })).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
  });

  it("rejects actual animated pixels and cannot turn a decode/tool failure into a rectangle", async () => {
    const { root, store, request } = await fixture();
    const assetPath = path.join(root, "animated.gif");
    expect(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "testsrc=s=32x32:r=2:d=1", "-frames:v", "2", "-threads", "1", assetPath]).status).toBe(0);
    request.candidates = [{ id: "heart", asset: { assetPath, assetFingerprint: `sha256:${sha(await readFile(assetPath))}` } }];
    const result = await computeCommonShapeCoverCandidates(request, store, tools);
    expect(result).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
    expect(result.evaluations.every(cell => cell.verdict.status === "UNSAFE" && cell.verdict.reason === "asset-unusable")).toBe(true);
    expect(await computeCommonShapeCoverCandidates(request, store, { ...tools, ffprobePath: path.join(root, "missing-ffprobe") })).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
  });
});
