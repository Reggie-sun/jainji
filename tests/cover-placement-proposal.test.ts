import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CoverPlacementSchema } from "../src/shared/cover-placement";
import { proposeCoverPlacement, type ReviewCoverPlacementInput } from "../src/main/cover-placement-proposal";
import { discoverBinary, FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import type { MediaItem } from "../src/main/domain";

async function command(binary: string, args: string[]): Promise<void> {
  const result = await runCommand(binary, ["-v", "error", ...args]).promise;
  expect(result.code, result.stderr).toBe(0);
}

async function fixture(): Promise<{ adapter: FfmpegAdapter; media: MediaItem; directory: string }> {
  const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
  if (!ffmpegPath || !ffprobePath) throw new Error("ffmpeg unavailable");
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-placement-"));
  const sourcePath = path.join(directory, "source.mp4");
  await command(ffmpegPath, ["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath]);
  return {
    adapter: new FfmpegAdapter(ffmpegPath, ffprobePath), directory,
    media: { id: crypto.randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 1, durationMs: 1000, width: 160, height: 90, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() },
  };
}

const rectangle = { x: 0.1, y: 0.2, width: 0.2, height: 0.1 };
const proposal = (tracks = [{ targetId: "first", track: { startMs: 0, endMs: 1000, keyframes: [{ timeMs: 0, rectangle }] } }]) => JSON.stringify({ action: "propose", reason: "approximate placement", tracks });

describe("cover placement proposal", () => {
  it("explains ratio and boundary failures so the next proposal can correct them", async () => {
    const f = await fixture();
    try {
      let calls = 0;
      const result = await proposeCoverPlacement(f.adapter, f.media, new AbortController().signal, async input => {
        if (++calls === 1) return proposal([{ targetId: "moving", track: { startMs: 0, endMs: 1000, keyframes: [
          { timeMs: 0, rectangle }, { timeMs: 500, rectangle: { x: 0.9, y: 0.2, width: 0.2, height: 0.2 } },
        ] } }]);
        expect(input.feedback).toContain("x + width");
        expect(input.feedback).toContain("width / height");
        return proposal();
      }, () => {});
      expect(calls).toBe(2);
      expect(result.tracks[0].track.keyframes).toHaveLength(1);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  }, 60_000);
  it("keeps approximate tracks separate from source facts and accepts differently shaped targets", async () => {
    let input: ReviewCoverPlacementInput | undefined;
    let fixtureValue: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      fixtureValue = await fixture();
      const result = await proposeCoverPlacement(fixtureValue.adapter, fixtureValue.media, new AbortController().signal, async (value) => {
        input = value;
        return proposal([
          { targetId: "wide", track: { startMs: 0, endMs: 500, keyframes: [{ timeMs: 0, rectangle: { x: 0, y: 0, width: 0.5, height: 0.1 } }] } },
          { targetId: "tall", track: { startMs: 500, endMs: 1000, keyframes: [{ timeMs: 500, rectangle: { x: 0.6, y: 0.1, width: 0.1, height: 0.5 } }] } },
        ]);
      }, () => {});
      expect(result).toMatchObject({ schemaVersion: 1, tracks: [{ targetId: "wide" }, { targetId: "tall" }] });
      expect(input?.durationMs).toBe(1000);
      expect(input?.images.length).toBeLessThanOrEqual(12);
      expect(input?.images[0]?.requestedTimeMs).toBe(0);
      expect(input?.images.at(-1)?.requestedTimeMs).toBe(999);
      expect(CoverPlacementSchema.parse(result)).toEqual(result);
    } finally { if (fixtureValue) await rm(fixtureValue.directory, { recursive: true, force: true }); }
  }, 60_000);

  it("supplies inspected evidence and accepts a corrected response within its bounded turns", async () => {
    let fixtureValue: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      fixtureValue = await fixture();
      const complete = vi.fn(async (input: ReviewCoverPlacementInput) => complete.mock.calls.length === 1
        ? JSON.stringify({ action: "inspect", reason: "need detail", requests: [{ timeMs: 500, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }] })
        : input.images.some((image) => image.crop) ? proposal() : "invalid");
      const result = await proposeCoverPlacement(fixtureValue.adapter, fixtureValue.media, new AbortController().signal, complete, () => {});
      expect(result.tracks).toHaveLength(1);
      expect(complete).toHaveBeenCalledTimes(2);
      expect(complete.mock.calls[1][0].images.some((image: { crop?: unknown }) => Boolean(image.crop))).toBe(true);
    } finally { if (fixtureValue) await rm(fixtureValue.directory, { recursive: true, force: true }); }
  }, 60_000);

  it("permits further bounded inspection without consuming its three proposal turns", async () => {
    let fixtureValue: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      fixtureValue = await fixture();
      const complete = vi.fn(async () => complete.mock.calls.length <= 3
        ? JSON.stringify({ action: "inspect", reason: "need another frame", requests: [{ timeMs: complete.mock.calls.length * 200 }] })
        : proposal());
      const result = await proposeCoverPlacement(fixtureValue.adapter, fixtureValue.media, new AbortController().signal, complete, () => {});
      expect(result.tracks).toHaveLength(1);
      expect(complete).toHaveBeenCalledTimes(4);
    } finally { if (fixtureValue) await rm(fixtureValue.directory, { recursive: true, force: true }); }
  }, 60_000);

  it("rejects unsafe placements with sanitized retry feedback instead of publishing them", async () => {
    let fixtureValue: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      fixtureValue = await fixture();
      const complete = vi.fn(async (_input: ReviewCoverPlacementInput) => proposal([{ targetId: "unsafe", track: { startMs: 0, endMs: 1001, keyframes: [{ timeMs: 0, rectangle }] } }]));
      await expect(proposeCoverPlacement(fixtureValue.adapter, fixtureValue.media, new AbortController().signal, complete, () => {})).rejects.toThrow(/上限.*返回结构不合格/);
      expect(complete).toHaveBeenCalledTimes(3);
      expect(complete.mock.calls[1][0].feedback).not.toContain("unsafe");
    } finally { if (fixtureValue) await rm(fixtureValue.directory, { recursive: true, force: true }); }
  }, 60_000);

  it("bounds invalid inspection requests without calling the provider forever", async () => {
    const f = await fixture();
    try {
      const complete = vi.fn(async () => JSON.stringify({ action: "inspect", reason: "outside", requests: [{ timeMs: 1000 }] }));
      await expect(proposeCoverPlacement(f.adapter, f.media, new AbortController().signal, async () => {
        if (complete.mock.calls.length >= 3) throw new Error("unbounded inspection");
        return complete();
      }, () => {})).rejects.toThrow(/上限/);
      expect(complete).toHaveBeenCalledTimes(3);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  }, 60_000);

  it("does not retry service failures or publish a response that arrives after cancellation", async () => {
    let fixtureValue: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      fixtureValue = await fixture();
      const unavailable = vi.fn(async () => { throw new Error("provider unavailable"); });
      await expect(proposeCoverPlacement(fixtureValue.adapter, fixtureValue.media, new AbortController().signal, unavailable, () => {})).rejects.toThrow("provider unavailable");
      expect(unavailable).toHaveBeenCalledOnce();
      const controller = new AbortController();
      const late = vi.fn(async () => { controller.abort(new Error("cancelled")); return proposal(); });
      await expect(proposeCoverPlacement(fixtureValue.adapter, fixtureValue.media, controller.signal, late, () => {})).rejects.toThrow();
      expect(late).toHaveBeenCalledOnce();
    } finally { if (fixtureValue) await rm(fixtureValue.directory, { recursive: true, force: true }); }
  }, 60_000);

  it("runs the identity guard before any model response and refuses changed media before return", async () => {
    let fixtureValue: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      fixtureValue = await fixture();
      const blocked = vi.fn(async () => { throw new Error("knowledge disputed"); }), never = vi.fn();
      await expect(proposeCoverPlacement(fixtureValue.adapter, fixtureValue.media, new AbortController().signal, never, () => {}, blocked)).rejects.toThrow("knowledge disputed");
      expect(never).not.toHaveBeenCalled();
      const complete = vi.fn(async () => {
        await command(fixtureValue!.adapter.ffmpegPath, ["-f", "lavfi", "-i", "color=black:size=160x90:rate=12", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", fixtureValue!.media.sourcePath]);
        return proposal();
      });
      await expect(proposeCoverPlacement(fixtureValue.adapter, fixtureValue.media, new AbortController().signal, complete, () => {})).rejects.toThrow(/身份|素材/);
    } finally { if (fixtureValue) await rm(fixtureValue.directory, { recursive: true, force: true }); }
  }, 60_000);
});
