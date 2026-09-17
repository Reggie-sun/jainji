import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { recognizeSourceStickerKnowledge, type RecognitionReviewContext } from "../src/main/source-sticker-recognition";
import { SupervisorEvidence } from "../src/main/supervisor-evidence";
import { discoverBinary, FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import type { MediaItem } from "../src/main/domain";
import type { CoverDetectionImage } from "../src/shared/automatic-cover";
import { interpolateCoverRectangle } from "../src/shared/cover-sticker";
import { KnowledgeCandidateSchema } from "../src/shared/source-sticker-knowledge";

async function command(binary: string, args: string[]): Promise<void> {
  const result = await runCommand(binary, ["-v", "error", ...args]).promise;
  expect(result.code, result.stderr).toBe(0);
}

async function fixture(adapter: FfmpegAdapter, directory: string, durationSeconds = 1): Promise<{ media: MediaItem; source: Awaited<ReturnType<SupervisorEvidence["sourceIdentity"]>> }> {
  const file = path.join(directory, "source.mp4");
  await command(adapter.ffmpegPath, ["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=4", "-t", String(durationSeconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath: file, displayName: "source.mp4", fingerprint: await fingerprintFile(file), sizeBytes: 1, durationMs: durationSeconds * 1000, width: 160, height: 90, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
  const evidence = new SupervisorEvidence(adapter, media);
  try { return { media, source: await evidence.sourceIdentity(new AbortController().signal) }; }
  finally { await evidence.dispose(); }
}

describe("source sticker recognition knowledge", () => {
  it("binds exact source evidence and splits a known target across an observed absence", async (context) => {
    const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-source-sticker-recognition-"));
    try {
      const { media, source } = await fixture(new FfmpegAdapter(ffmpegPath, ffprobePath), directory);
      const detect = vi.fn(async (images: CoverDetectionImage[]) => images.map((image) => ({ timeMs: image.timeMs, targets: image.timeMs === 500 ? [] : [{ id: "sticker", rectangle: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 } }] })));
      const review = vi.fn(async (input: RecognitionReviewContext) => JSON.stringify({ action: "resolve", reason: "checked", frames: input.proposal }));
      const result = await recognizeSourceStickerKnowledge(new FfmpegAdapter(ffmpegPath, ffprobePath), media, source, 1000, new AbortController().signal, detect, review, () => {});
      expect(result.facts.reviewedRanges).toEqual([{ startMs: 0, endMs: 1000 }]);
      expect(result.facts.targets).toHaveLength(1);
      expect(result.facts.targets[0].segments).toHaveLength(2);
      expect(result.facts.targets[0].segments[0].track.keyframes).toHaveLength(1);
      expect(result.facts.targets[0].segments[0].track.endMs).toBe(500);
      expect(result.facts.targets[0].segments[1].track.endMs).toBe(1000);
      expect(result.facts.targets[0].segments.flatMap((segment) => segment.track.keyframes).every((frame) => frame.rectangle.width === 0.2 && frame.rectangle.height === 0.1)).toBe(true);
      expect(result.facts.observations.some((observation) => observation.targetId === "sticker" && observation.presence === "ABSENT")).toBe(true);
      expect(result.evidence.every((evidence) => evidence.kind === "source" && result.blobs.get(evidence.digest)?.length === evidence.byteLength)).toBe(true);
      expect(result.requests).toBe(2);
      expect(detect).toHaveBeenCalledOnce();
      expect(review).toHaveBeenCalledOnce();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("does not publish a candidate after cancellation", async (context) => {
    const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-source-sticker-recognition-cancel-"));
    try {
      const { media, source } = await fixture(new FfmpegAdapter(ffmpegPath, ffprobePath), directory);
      const controller = new AbortController(); controller.abort();
      const detect = vi.fn(), review = vi.fn();
      await expect(recognizeSourceStickerKnowledge(new FfmpegAdapter(ffmpegPath, ffprobePath), media, source, 1000, controller.signal, detect, review, () => {})).rejects.toThrow();
      expect(detect).not.toHaveBeenCalled();
      expect(review).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("does not hand off a supervisor resolve that arrives after abort", async (context) => {
    const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-source-sticker-recognition-late-abort-"));
    try {
      const { media, source } = await fixture(new FfmpegAdapter(ffmpegPath, ffprobePath), directory);
      const controller = new AbortController();
      const detect = vi.fn(async (images: CoverDetectionImage[]) => images.map((image) => ({ timeMs: image.timeMs, targets: [] })));
      const review = vi.fn(async (input: RecognitionReviewContext) => {
        controller.abort(new Error("cancelled while supervisor was deciding"));
        return JSON.stringify({ action: "resolve", reason: "late", frames: input.proposal });
      });
      const onWindow = vi.fn(async () => {});
      await expect(recognizeSourceStickerKnowledge(new FfmpegAdapter(ffmpegPath, ffprobePath), media, source, 1000, controller.signal, detect, review, () => {}, onWindow)).rejects.toThrow();
      expect(detect).toHaveBeenCalledOnce();
      expect(review).toHaveBeenCalledOnce();
      expect(onWindow).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("retains a supervisor-requested crop and its full parent before disposing the window owner", async (context) => {
    const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-source-sticker-recognition-inspect-"));
    try {
      const { media, source } = await fixture(new FfmpegAdapter(ffmpegPath, ffprobePath), directory);
      let turn = 0;
      const result = await recognizeSourceStickerKnowledge(
        new FfmpegAdapter(ffmpegPath, ffprobePath), media, source, 1000, new AbortController().signal,
        async (images: CoverDetectionImage[]) => images.map((image) => ({ timeMs: image.timeMs, targets: [] })),
        async (input: RecognitionReviewContext) => turn++ === 0
          ? JSON.stringify({ action: "inspect", reason: "crop", requests: [{ timeMs: input.images[0].timeMs, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }] })
          : JSON.stringify({ action: "resolve", reason: "checked", frames: input.images.map((image) => ({ timeMs: image.timeMs, targets: [] })) }),
        () => {},
      );
      const crop = result.evidence.find((item) => item.crop);
      expect(crop?.crop?.sourceEvidenceId).toMatch(/^source-/);
      expect(result.evidence.some((item) => item.id === crop?.crop?.sourceEvidenceId && !item.crop)).toBe(true);
      expect(result.blobs.get(crop!.digest)?.length).toBe(crop!.byteLength);
      expect(result.requests).toBe(3);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("keeps fractional VFR observations bound to integer plateau keyframes", async (context) => {
    const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-source-sticker-recognition-vfr-"));
    try {
      const adapter = new FfmpegAdapter(ffmpegPath, ffprobePath), file = path.join(directory, "vfr.mp4");
      await command(ffmpegPath, ["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:d=1", "-vf", "select='eq(n,0)+eq(n,3)+eq(n,10)+eq(n,20)'", "-vsync", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
      const media: MediaItem = { id: crypto.randomUUID(), sourcePath: file, displayName: "vfr.mp4", fingerprint: await fingerprintFile(file), sizeBytes: 1, durationMs: 1000, width: 160, height: 90, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
      const reader = new SupervisorEvidence(adapter, media);
      const source = await reader.sourceIdentity(new AbortController().signal); await reader.dispose();
      const result = await recognizeSourceStickerKnowledge(adapter, media, source, 1000, new AbortController().signal,
        async (images: CoverDetectionImage[]) => images.map((image) => ({ timeMs: image.timeMs, targets: [{ id: "sticker", rectangle: { x: image.timeMs === 333 ? 0.2 : image.timeMs === 667 ? 0.3 : 0.1, y: 0.2, width: 0.2, height: 0.1 } }] })),
        async (input: RecognitionReviewContext) => JSON.stringify({ action: "resolve", reason: "checked", frames: input.proposal }), () => {},
      );
      expect(result.evidence.some((item) => !Number.isInteger(item.timeMs))).toBe(true);
      expect(result.facts.targets[0].segments.flatMap((segment) => segment.track.keyframes).every((frame) => Number.isInteger(frame.timeMs))).toBe(true);
      expect(result.facts.observations.filter((item) => item.presence === "PRESENT").every((item) => item.rectangle?.width === 0.2)).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("hands off a supervisor-confirmed first window before a later provider failure", async (context) => {
    const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-source-sticker-recognition-window-"));
    try {
      const { media, source } = await fixture(new FfmpegAdapter(ffmpegPath, ffprobePath), directory, 3);
      let callback: Awaited<ReturnType<typeof recognizeSourceStickerKnowledge>> | undefined;
      const detect = vi.fn(async (images: CoverDetectionImage[]) => {
        if (detect.mock.calls.length > 1) throw new Error("second window provider unavailable");
        return images.map((image) => ({ timeMs: image.timeMs, targets: [{ id: "sticker", rectangle: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 } }] }));
      });
      const review = vi.fn(async (input: RecognitionReviewContext) => JSON.stringify({ action: "resolve", reason: "checked", frames: input.proposal }));
      await expect(recognizeSourceStickerKnowledge(
        new FfmpegAdapter(ffmpegPath, ffprobePath), media, source, 3000, new AbortController().signal, detect, review, () => {},
        async (window) => { callback = window; },
      )).rejects.toThrow("second window provider unavailable");
      expect(detect).toHaveBeenCalledTimes(2);
      expect(review).toHaveBeenCalledOnce();
      expect(callback?.facts.reviewedRanges).toEqual([{ startMs: 0, endMs: 1751 }]);
      expect(callback?.evidence.every((item) => item.kind === "source" && callback!.blobs.get(item.digest)?.length === item.byteLength)).toBe(true);
      expect(() => KnowledgeCandidateSchema.parse({ schemaVersion: 1, id: "window-candidate", state: "candidate", source, baseRevisionId: null, runId: "window-run", requiredRanges: callback!.facts.reviewedRanges, facts: callback!.facts, evidence: callback!.evidence, resolvedDisputeIds: [], changes: [], provenance: { executor: "test", supervisor: "test", contractVersion: 1, requests: callback!.requests, at: new Date().toISOString() } })).not.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("shares the moving geometry at a <=50-keyframe segment boundary", async (context) => {
    const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-source-sticker-recognition-moving-"));
    try {
      const adapter = new FfmpegAdapter(ffmpegPath, ffprobePath);
      const { media, source } = await fixture(adapter, directory, 14);
      const result = await recognizeSourceStickerKnowledge(adapter, media, source, 14_000, new AbortController().signal,
        async (images: CoverDetectionImage[]) => images.map((image) => ({ timeMs: image.timeMs, targets: [{ id: "moving", rectangle: { x: 0.1 + image.timeMs / 140_000, y: 0.2, width: 0.2, height: 0.1 } }] })),
        async (input: RecognitionReviewContext) => JSON.stringify({ action: "resolve", reason: "checked", frames: input.proposal }), () => {},
      );
      const [first, second] = result.facts.targets[0].segments;
      expect(result.facts.targets[0].segments.length).toBeGreaterThan(1);
      expect(first.track.keyframes).toHaveLength(50);
      expect(first.track.endMs).toBe(second.track.startMs);
      expect(first.track.keyframes.find((frame) => frame.timeMs === first.track.endMs)?.rectangle.x).toBeCloseTo(0.1 + first.track.endMs / 140_000);
      expect(interpolateCoverRectangle(first.track.keyframes, first.track.endMs).x).toBeCloseTo(interpolateCoverRectangle(second.track.keyframes, second.track.startMs).x);
      expect(result.facts.targets[0].segments.every((segment, index, segments) => segment.track.keyframes.length <= 50 && (index === 0 || segments[index - 1].track.endMs <= segment.track.startMs))).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);
});
