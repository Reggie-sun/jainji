import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareFullCanvasReviewEvidence, type FullCanvasReviewEvidence } from "../src/main/source-fact-review-evidence";
import { identifySource } from "../src/main/source-sticker-knowledge-store";
import { buildStationaryShapeEnvelope, readStationaryEnvelopeMask, type StationaryFrameInput } from "../src/main/shape-cover-stationary-envelope";
import { evaluateShapeCover, projectSourceMask } from "../src/main/shape-cover-pixel-gate";

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const mask = (x = 4, width = 2) => {
  const bytes = Buffer.alloc(Math.ceil(width / 8));
  for (let i = 0; i < width; i++) bytes[i >> 3] |= 1 << (i & 7);
  return { bbox: { x, y: 4, width, height: 1 }, encoding: "bitpack-lsb-row-major-v1" as const,
    dataBase64: bytes.toString("base64"), sha256: sha(bytes), markedPixels: width };
};
function run(binary: string, args: string[]) {
  const p = spawnSync(binary, args, { timeout: 10000, maxBuffer: 4 * 1024 ** 2 });
  if (p.status !== 0 || p.error) throw p.error ?? new Error(p.stderr.toString());
  return p.stdout;
}
let evidence: FullCanvasReviewEvidence; let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "jianji-stationary-test-"));
  const sourcePath = join(root, "source.mp4");
  const tools = { ffmpegPath: process.env.JIANJI_FFMPEG_PATH ?? "ffmpeg", ffprobePath: process.env.JIANJI_FFPROBE_PATH ?? "ffprobe" };
  run(tools.ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", "color=black:s=32x32:r=6:d=1", "-c:v", "libx264", "-crf", "0", "-bf", "0", "-pix_fmt", "yuv420p", "-video_track_timescale", "6000", sourcePath]);
  const probe = JSON.parse(run(tools.ffprobePath, ["-v", "error", "-show_streams", "-show_frames", "-of", "json", sourcePath]).toString());
  const source = await identifySource(sourcePath, { width: 32, height: 32, rotation: 0, durationMs: 1000,
    timeBase: probe.streams[0].time_base, timeOriginPts: probe.frames[0].pts, interpretationVersion: 1 });
  evidence = await prepareFullCanvasReviewEvidence({ sourcePath, source, ffmpeg: tools, signal: new AbortController().signal });
}, 30000);
afterAll(async () => { await evidence?.close(); if (root) await rm(root, { recursive: true, force: true }); });
const declare = (f: StationaryFrameInput) => ({ ...f.binding, targetId: "old-sticker", anchor: { x: 5, y: 4 }, state: "VISIBLE" as const, mask: mask(4, f.binding.index === 5 ? 5 : 2) });
const input = () => ({ evidence, targetId: "old-sticker", motion: "stationary-animation" as const,
  anchor: { x: 5, y: 4 }, range: { startFrame: 0, endFrame: 6 }, maskProviderId: "automated-test-unqualified", signal: new AbortController().signal, declareFrame: async (f: StationaryFrameInput) => declare(f) });

describe("complete stationary envelope, never source admission", { timeout: 30000 }, () => {
  it("includes the final-frame expansion and preserves all raw candidates/bindings", async () => {
    const envelope = await buildStationaryShapeEnvelope(input());
    expect(envelope.receipt.frames.map(f => f.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(envelope.receipt.union).toMatchObject({ kind: "stationary-union-v1", bbox: { x: 4, y: 4, width: 5, height: 1 }, markedPixels: 5 });
    expect(envelope.receipt).toMatchObject({ authority: "none", eligible: false, semanticReview: "NOT_EVALUATED", motionReview: "NOT_EVALUATED", maskReview: "NOT_EVALUATED", censusDigest: evidence.census.censusDigest });
    const { receiptDigest, ...body } = envelope.receipt;
    expect(receiptDigest).toBe(sha(JSON.stringify(body)));
    expect(envelope.receipt.frames[5].mask?.markedPixels).toBe(5);
    const raster = readStationaryEnvelopeMask(envelope);
    expect(raster[4 * 32 + 8]).toBe(1);
    raster.fill(0); expect(readStationaryEnvelopeMask(envelope)[4 * 32 + 8]).toBe(1);
    expect(() => readStationaryEnvelopeMask({ ...envelope })).toThrow(/not owned/);
    expect(Object.isFrozen(envelope.receipt.frames[0].mask?.bbox)).toBe(true);
    const projected = projectSourceMask(readStationaryEnvelopeMask(envelope), { width: 32, height: 32 }, { width: 32, height: 32, scaledWidth: 32, scaledHeight: 32, padLeft: 0, padTop: 0 })!;
    const alpha = projected.map(bit => bit * 255);
    expect(evaluateShapeCover(projected, alpha, { width: 32, height: 32 }, 1).status).toBe("PASS");
  });

  it("keeps explicit blinking frames without inferring global EMPTY", async () => {
    const envelope = await buildStationaryShapeEnvelope({ ...input(), declareFrame: async f => f.binding.index % 2 ? { ...declare(f), state: "NOT_VISIBLE", mask: null } : declare(f) });
    expect(envelope.receipt.frames.filter(f => f.state === "NOT_VISIBLE")).toHaveLength(3);
    expect(envelope.receipt).not.toHaveProperty("verifiedNoStickerIntervals");
  });

  it("does not label a changing silhouette as static", async () => {
    await expect(buildStationaryShapeEnvelope({ ...input(), motion: "static" })).rejects.toThrow(/static mask changed/);
  });

  it("supports stable static masks and captures the range before asynchronous work", async () => {
    const request = input();
    const envelope = await buildStationaryShapeEnvelope({ ...request, motion: "static", declareFrame: async f => {
      request.range.endFrame = 1;
      return { ...declare(f), mask: mask() };
    } });
    expect(envelope.receipt.frames).toHaveLength(6);
    expect(envelope.receipt.declaredMotion).toBe("static");
    const subrange = await buildStationaryShapeEnvelope({ ...input(), range: { startFrame: 2, endFrame: 5 } });
    expect(subrange.receipt.frames.map(f => f.index)).toEqual([2, 3, 4]);
    expect(subrange.receipt.range).toMatchObject({ startPts: 2000, endPts: 5000 });
  });

  it.each(["moving", "unresolved"] as const)("rejects unsupported motion before mask work: %s", async motion => {
    let calls = 0;
    await expect(buildStationaryShapeEnvelope({ ...input(), motion, declareFrame: async f => { calls++; return declare(f); } })).rejects.toThrow(/motion/);
    expect(calls).toBe(0);
  });

  it.each([
    ["ordinal", (f: ReturnType<typeof declare>) => ({ ...f, index: f.index + 1 })],
    ["PTS", (f: ReturnType<typeof declare>) => ({ ...f, pts: f.pts + 1 })],
    ["endPTS", (f: ReturnType<typeof declare>) => ({ ...f, endPts: f.endPts - 1 })],
    ["pixel SHA", (f: ReturnType<typeof declare>) => ({ ...f, pixelSha256: "0".repeat(64) })],
    ["identity", (f: ReturnType<typeof declare>) => ({ ...f, targetId: "other" })],
    ["anchor", (f: ReturnType<typeof declare>) => ({ ...f, anchor: { x: 6, y: 4 } })],
    ["UNKNOWN", (f: ReturnType<typeof declare>) => ({ ...f, state: "UNKNOWN" })],
    ["missing", () => null],
    ["mask hash", (f: ReturnType<typeof declare>) => ({ ...f, mask: { ...f.mask, sha256: "0".repeat(64) } })],
    ["bounds", (f: ReturnType<typeof declare>) => ({ ...f, mask: mask(32) })],
    ["authority", (f: ReturnType<typeof declare>) => ({ ...f, qualified: true })],
  ])("rejects %s, including a bad final frame", async (_label, alter) => {
    await expect(buildStationaryShapeEnvelope({ ...input(), declareFrame: async f => f.binding.index === 5 ? alter(declare(f)) : declare(f) })).rejects.toThrow(/UNSAFE/);
  });

  it("rejects a missing final frame and stops without more work", async () => {
    const visited: number[] = [];
    await expect(buildStationaryShapeEnvelope({ ...input(), declareFrame: async f => { visited.push(f.binding.index); if (f.binding.index === 2) throw new Error("mask unavailable"); return declare(f); } })).rejects.toThrow(/UNSAFE/);
    expect(visited).toEqual([0, 1, 2]);
  });

  it("requires a nonempty union and explicit valid frame range", async () => {
    await expect(buildStationaryShapeEnvelope({ ...input(), declareFrame: async f => ({ ...declare(f), state: "NOT_VISIBLE", mask: null }) })).rejects.toThrow(/empty/);
    for (const range of [{ startFrame: 0, endFrame: 7 }, { startFrame: 1, endFrame: 1 }, { startFrame: -1, endFrame: 6 }]) {
      await expect(buildStationaryShapeEnvelope({ ...input(), range })).rejects.toThrow(/range/);
    }
  });

  it("rejects copied evidence and aborts a pending declaration with late output ignored", async () => {
    await expect(buildStationaryShapeEnvelope({ ...input(), evidence: { ...evidence } })).rejects.toThrow(/not owned/);
    const controller = new AbortController(); let release: () => void = () => {}; let called = 0;
    const pending = buildStationaryShapeEnvelope({ ...input(), signal: controller.signal, declareFrame: async f => { called++; await new Promise<void>(resolve => { release = resolve; controller.abort(); }); return declare(f); } });
    await expect(pending).rejects.toThrow(/cancel/); release(); await Promise.resolve();
    expect(called).toBe(1);
  });
});
