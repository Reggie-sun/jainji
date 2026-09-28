import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as processes from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareFullCanvasReviewEvidence, type FullCanvasReviewEvidence } from "../src/main/source-fact-review-evidence";
import { createFullCanvasReviewSession, EMPTY_FRAME_CONFIRMATION, TARGET_SET_CONFIRMATION, FullCanvasReviewCommandSchema } from "../src/main/source-fact-review-session";
import { identifySource } from "../src/main/source-sticker-knowledge-store";

const roots: string[] = []; const evidence: FullCanvasReviewEvidence[] = [];
vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
const originalSpawn = vi.mocked(processes.spawn).getMockImplementation()!;
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const targetA = { id: randomUUID(), label: "左侧旧贴纸", kind: "static" as const };
const targetB = { id: randomUUID(), label: "中部动画旧贴纸", kind: "animated" as const };
afterEach(async () => {
  vi.mocked(processes.spawn).mockReset().mockImplementation(originalSpawn);
  await Promise.all(evidence.splice(0).map(value => value.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
function run(binary: string, args: string[]) {
  const result = spawnSync(binary, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 10000, maxBuffer: 4 * 1024 ** 2 });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.toString());
  return result.stdout;
}
async function fixture(vfr = false) {
  const root = await mkdtemp(join(tmpdir(), "jianji-d2-test-")); roots.push(root);
  const sourcePath = join(root, "source.mp4");
  const ffmpeg = { ffmpegPath: process.env.JIANJI_FFMPEG_PATH ?? "ffmpeg", ffprobePath: process.env.JIANJI_FFPROBE_PATH ?? "ffprobe" };
  const flash = "drawbox=x=2:y=2:w=6:h=6:color=white:t=fill:enable='eq(n,2)',drawbox=x=16:y=16:w=6:h=6:color=red:t=fill:enable='eq(n,2)'";
  run(ffmpeg.ffmpegPath, ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=black:s=32x32:r=6:d=1", "-vf", vfr ? `${flash},select='eq(n,0)+eq(n,2)+eq(n,5)'` : flash,
    "-fps_mode", "vfr", "-c:v", "libx264", "-crf", "0", "-bf", "0", "-pix_fmt", "yuv420p", "-video_track_timescale", "6000", sourcePath]);
  const probe = JSON.parse(run(ffmpeg.ffprobePath, ["-v", "error", "-show_streams", "-show_frames", "-of", "json", sourcePath]).toString());
  const source = await identifySource(sourcePath, { width: 32, height: 32, rotation: 0, durationMs: Math.round(Number(probe.streams[0].duration) * 1000),
    timeBase: probe.streams[0].time_base, timeOriginPts: probe.frames[0].pts, interpretationVersion: 1 });
  return { sourcePath, source, ffmpeg, signal: new AbortController().signal };
}
async function sessionFixture(vfr = false) {
  const input = await fixture(vfr); const asset = await prepareFullCanvasReviewEvidence(input); evidence.push(asset);
  return { input, asset, session: createFullCanvasReviewSession(asset, "test reviewer (automated, unqualified)") };
}
async function present(session: ReturnType<typeof createFullCanvasReviewSession>, ordinal: number) {
  const frame = await session.begin(ordinal);
  session.acknowledge({ presentationId: frame.presentationId, pixelSha256: sha(frame.bytes), width: frame.width, height: frame.height });
  return frame;
}
async function empty(session: ReturnType<typeof createFullCanvasReviewSession>, ordinal: number) {
  const frame = await present(session, ordinal);
  session.record({ type: "EMPTY", presentationId: frame.presentationId, confirmation: EMPTY_FRAME_CONFIRMATION });
}

describe("explicit full-canvas commands", () => {
  it.each([
    { type: "TARGETS", targets: [], confirmation: TARGET_SET_CONFIRMATION },
    { type: "EMPTY" }, { type: "EMPTY", confirmation: "没发现贴纸" },
    { type: "UNKNOWN", reason: "" }, { type: "SKIP" },
    { type: "EMPTY", confirmation: EMPTY_FRAME_CONFIRMATION, complete: true },
    { type: "EMPTY", confirmation: EMPTY_FRAME_CONFIRMATION, unverifiedIntervals: [] },
    { type: "EMPTY", confirmation: EMPTY_FRAME_CONFIRMATION, qualified: true },
  ])("rejects absent, implicit or caller-authorized semantics: %j", command => {
    expect(() => FullCanvasReviewCommandSchema.parse({ presentationId: randomUUID(), ...command })).toThrow();
  });
});

describe("D1 to full-canvas evidence and manual declarations", () => {
  it.each([false, true])("binds every decoded frame and preserves exact VFR ordinals: %s", async vfr => {
    const { asset, session } = await sessionFixture(vfr);
    const flashOrdinal = vfr ? 1 : 2;
    for (const frame of asset.census.frames) {
      const shown = await present(session, frame.index);
      expect(shown.binding).toMatchObject({ ordinal: frame.index, pts: frame.pts, endPts: frame.endPts, pixelSha256: sha(shown.bytes), byteLength: 4096 });
      if (frame.index === flashOrdinal) session.record({ type: "TARGETS", presentationId: shown.presentationId, targets: [targetA, targetB], confirmation: TARGET_SET_CONFIRMATION });
      else session.record({ type: "EMPTY", presentationId: shown.presentationId, confirmation: EMPTY_FRAME_CONFIRMATION });
    }
    const receipt = await session.finish();
    expect(receipt).toMatchObject({ authority: "none", eligible: false, semanticReview: "RECORDED_NOT_QUALIFIED", methodQualification: "NOT_EVALUATED", session: { censusDigest: asset.census.censusDigest, frameCount: vfr ? 3 : 6, frozen: true } });
    expect(receipt.declaredTargets).toEqual([targetA, targetB].sort((a, b) => a.id.localeCompare(b.id)));
    expect(receipt.unknownIntervals).toEqual([]);
    expect(receipt.unverifiedIntervals).toEqual([{ startFrame: 0, endFrame: asset.census.frames.length, startPts: asset.census.horizon.startPts, endPts: asset.census.horizon.endPts }]);
    expect(Object.isFrozen(receipt.results[flashOrdinal].result)).toBe(true);
    expect(new Set(asset.census.frames.map(frame => frame.pixelSha256)).size).toBe(2);
    await expect(session.begin(0)).rejects.toThrow(/frozen/);
    expect(() => session.record(receipt.results[0].result)).toThrow(/frozen/);
  }, 30000);

  it("digest binds the entire receipt, including qualification and frozen session state", async () => {
    const { asset, session } = await sessionFixture();
    for (const frame of asset.census.frames) await empty(session, frame.index);
    const receipt = await session.finish(); const { receiptDigest, ...body } = receipt;
    expect(receiptDigest).toBe(sha(JSON.stringify(body)));
    expect(receipt.methodQualification).toBe("NOT_EVALUATED");
    expect(receipt.unverifiedIntervals).toEqual([{ startFrame: 0, endFrame: 6, startPts: 0, endPts: 6000 }]);
  });

  it.each([0, 2, 5])("rejects unreviewed ordinal %i even when all pixels repeat", async omitted => {
    const { asset, session } = await sessionFixture();
    for (const frame of asset.census.frames) if (frame.index !== omitted) await empty(session, frame.index);
    await expect(session.finish()).rejects.toThrow(/every ordinal/);
    expect(session.snapshot().frozen).toBe(false);
  });

  it("UNKNOWN remains owner-computed unverified even with every ordinal recorded", async () => {
    const { asset, session } = await sessionFixture();
    for (const frame of asset.census.frames) {
      const shown = await present(session, frame.index);
      session.record(frame.index === 2 || frame.index === 3 ? { type: "UNKNOWN", presentationId: shown.presentationId, reason: "无法判断图案是否旧贴纸" }
        : { type: "EMPTY", presentationId: shown.presentationId, confirmation: EMPTY_FRAME_CONFIRMATION });
    }
    const receipt = await session.finish();
    expect(receipt.unknownIntervals).toEqual([{ startFrame: 2, endFrame: 4, startPts: 2000, endPts: 4000 }]);
    expect(receipt.unverifiedIntervals).toEqual([{ startFrame: 0, endFrame: 6, startPts: 0, endPts: 6000 }]);
    expect(receipt).toMatchObject({ eligible: false, methodQualification: "NOT_EVALUATED" });
  });

  it("rejects unpresented, stale or cross-session tokens and wrong readback binding", async () => {
    const { asset, session } = await sessionFixture(); const other = createFullCanvasReviewSession(asset, "other");
    const old = await session.begin(0); const current = await session.begin(1);
    expect(() => session.record({ type: "EMPTY", presentationId: current.presentationId, confirmation: EMPTY_FRAME_CONFIRMATION })).toThrow(/not acknowledged/);
    expect(() => session.acknowledge({ presentationId: old.presentationId, pixelSha256: old.binding.pixelSha256, width: 32, height: 32 })).toThrow(/mismatch/);
    expect(() => session.acknowledge({ presentationId: current.presentationId, pixelSha256: sha("different"), width: 32, height: 32 })).toThrow(/mismatch/);
    expect(() => session.acknowledge({ presentationId: current.presentationId, pixelSha256: current.binding.pixelSha256, width: 16, height: 16 })).toThrow(/mismatch/);
    expect(() => other.acknowledge({ presentationId: current.presentationId, pixelSha256: current.binding.pixelSha256, width: 32, height: 32 })).toThrow(/mismatch/);
  });

  it("rejects duplicate targets or conflicting identities; edits require a fresh presentation", async () => {
    const { session } = await sessionFixture(); const first = await present(session, 0);
    expect(() => session.record({ type: "TARGETS", presentationId: first.presentationId, targets: [targetA, targetA], confirmation: TARGET_SET_CONFIRMATION })).toThrow(/duplicate/);
    session.record({ type: "TARGETS", presentationId: first.presentationId, targets: [targetA], confirmation: TARGET_SET_CONFIRMATION });
    const second = await present(session, 1);
    expect(() => session.record({ type: "TARGETS", presentationId: second.presentationId, targets: [{ ...targetA, kind: "moving" }], confirmation: TARGET_SET_CONFIRMATION })).toThrow(/conflicts/);
    const revised = await present(session, 0);
    session.record({ type: "UNKNOWN", presentationId: revised.presentationId, reason: "目标关联不确定" });
    expect(session.snapshot().recordedOrdinals).toEqual([0]);
  });

  it("rejects caller-created or copied evidence and closes live access", async () => {
    const { asset, session } = await sessionFixture();
    expect(() => createFullCanvasReviewSession({ ...asset }, "forged")).toThrow(/not owned/);
    await asset.close();
    await expect(session.begin(0)).rejects.toThrow(/closed/);
    await expect(asset.readFrame(0)).rejects.toThrow(/closed/);
  });

  it("rejects source changes before presentation and before freeze", async () => {
    const { input, asset, session } = await sessionFixture();
    for (const frame of asset.census.frames) await empty(session, frame.index);
    const original = await readFile(input.sourcePath); await writeFile(input.sourcePath, original);
    await expect(session.begin(0)).rejects.toThrow(/generation/);
    await expect(session.finish()).rejects.toThrow(/generation/);
  });

  it("rejects corrupted stored bytes rather than trusting a stored hash", async () => {
    const before = new Set(await readdir(tmpdir())); const { session } = await sessionFixture();
    const root = (await readdir(tmpdir())).find(name => name.startsWith("jianji-full-canvas-review-") && !before.has(name))!;
    await writeFile(join(tmpdir(), root, "frames.rgba"), Buffer.alloc(6 * 4096));
    await expect(session.begin(0)).rejects.toThrow(/evidence generation/);
  });

  it("classifies unavailable engines and cancelled preparation as UNSAFE", async () => {
    const input = await fixture();
    await expect(prepareFullCanvasReviewEvidence({ ...input, ffmpeg: { ...input.ffmpeg, ffmpegPath: join(tmpdir(), randomUUID()) } })).rejects.toThrow(/^UNSAFE:/);
    await expect(prepareFullCanvasReviewEvidence({ ...input, signal: AbortSignal.abort() })).rejects.toThrow(/^UNSAFE:/);
  });

  it("rejects invalid ordinals and serializes frame loading with review commands", async () => {
    const { session } = await sessionFixture();
    await expect(session.begin(-1)).rejects.toThrow(/ordinal/);
    await expect(session.begin(6)).rejects.toThrow(/ordinal/);
    const loading = session.begin(0);
    await expect(session.begin(1)).rejects.toThrow(/in progress/);
    expect(() => session.record({ type: "EMPTY", presentationId: randomUUID(), confirmation: EMPTY_FRAME_CONFIRMATION })).toThrow(/in progress/);
    await loading;
  });

  it.each(["short", "extra", "corrupt", "stderr", "exit", "cancel"])("rejects %s during evidence decode and waits for close", async kind => {
    const input = await fixture(); const controller = new AbortController();
    let rawCalls = 0; let closed = false;
    vi.mocked(processes.spawn).mockImplementation((binary, args, options) => {
      if (!(args as string[]).includes("rawvideo") || ++rawCalls !== 2) return originalSpawn(binary, args, options as never);
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      const close = (code: number) => { if (closed) return; closed = true; child.stdout.end(); child.stderr.end(); child.emit("close", code); };
      child.kill.mockImplementation(() => { setImmediate(() => close(1)); return true; });
      setImmediate(() => {
        if (kind === "cancel") { controller.abort(); return; }
        if (kind === "stderr") { child.stderr.write("decode error"); return; }
        if (kind === "exit") { close(1); return; }
        child.stdout.end(Buffer.alloc(kind === "short" ? 4096 : kind === "extra" ? 7 * 4096 : 6 * 4096));
        setImmediate(() => close(0));
      });
      return child as unknown as ReturnType<typeof processes.spawn>;
    });
    await expect(prepareFullCanvasReviewEvidence({ ...input, signal: controller.signal })).rejects.toThrow(/^UNSAFE:/);
    expect(rawCalls).toBe(2); expect(closed).toBe(true);
  });
});
