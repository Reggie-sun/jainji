import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { KnowledgeCandidateSchema } from "../src/shared/source-sticker-knowledge";
import { checkFullSourceFactContract, type FrameInventory, type FullSourceClaim } from "./helpers/full-source-fact-contract";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const source = { fingerprint: `sha256:${hash("source")}`, byteLength: 100, width: 64, height: 64, rotation: 0 as const, durationMs: 1000, timeBase: "1/1000", timeOriginPts: 10, interpretationVersion: 1 };
function fixture() {
  const inventory: FrameInventory = { source: { ...source }, revisionId: "revision", factsDigest: hash("facts"), decodeProfile: "full-canvas-rgba-pts-v1", horizonEndPts: 1010,
    frames: [{ index: 0, pts: 10, endPts: 210 }, { index: 1, pts: 210, endPts: 710 }, { index: 2, pts: 710, endPts: 1010 }].map(frame => ({ ...frame, pixelSha256: hash("same-pixels"), byteLength: 64 * 64 * 4 })) };
  const claim: FullSourceClaim = { schemaVersion: 1, source: { ...source }, revisionId: inventory.revisionId, factsDigest: inventory.factsDigest, decodeProfile: inventory.decodeProfile,
    frames: inventory.frames.map(frame => ({ index: frame.index, pts: frame.pts, pixelSha256: frame.pixelSha256, byteLength: frame.byteLength, scope: "full-canvas-rgba", state: "COMPLETE", targets: [] })), targets: [] };
  return { inventory, claim };
}
const target = (id: string, startFrame: number, endFrame: number, segmentId = "segment") => ({ id, segments: [{ id: segmentId, startFrame, endFrame }] });
const check = (value: ReturnType<typeof fixture>) => checkFullSourceFactContract(value.inventory, value.claim);

describe("M5-D test-only completeness contract (never authority)", () => {
  it("keeps a complete empty claim unissued even with no unverified frames", () => {
    const result = check(fixture());
    expect(result).toMatchObject({ consistency: "CONSISTENT", authority: "none", eligible: false, semanticReview: "NOT_EVALUATED",
      unverifiedIntervals: [], claimedNoStickerIntervals: [{ startFrame: 0, endFrame: 3 }], claimedCoveredIntervals: [{ startFrame: 0, endFrame: 3 }] });
  });

  it.each([0, 1, 2])("computes omitted frame %i as unverified instead of inferring ABSENT", index => {
    const value = fixture(); value.claim.frames.splice(index, 1);
    expect(check(value)).toMatchObject({ consistency: "CONSISTENT", eligible: false, unverifiedIntervals: [{ startFrame: index, endFrame: index + 1 }] });
  });

  it("merges missing and UNKNOWN frames and partitions the entire horizon", () => {
    const value = fixture(); value.claim.frames[1].state = "UNKNOWN"; value.claim.frames.pop();
    expect(check(value)).toMatchObject({ consistency: "CONSISTENT", claimedCoveredIntervals: [{ startFrame: 0, endFrame: 1 }],
      unverifiedIntervals: [{ startFrame: 1, endFrame: 3 }] });
  });

  it.each(["source", "revision", "facts", "profile", "pts", "pixels", "byteLength", "crop", "scale", "duplicate", "outside", "schema", "complete", "unverified"]) ("rejects mismatched or caller-invented %s", kind => {
    const value = fixture();
    if (kind === "source") value.claim.source = { ...source, fingerprint: `sha256:${hash("other")}` };
    if (kind === "revision") value.claim.revisionId = "other";
    if (kind === "facts") value.claim.factsDigest = hash("other");
    if (kind === "profile") Object.assign(value.claim, { decodeProfile: "sampled-v1" });
    if (kind === "pts") value.claim.frames[1].pts++;
    if (kind === "pixels") value.claim.frames[1].pixelSha256 = hash("other");
    if (kind === "byteLength") value.claim.frames[1].byteLength--;
    if (kind === "crop") Object.assign(value.claim.frames[1], { scope: "roi", crop: { x: 0, y: 0 } });
    if (kind === "scale") Object.assign(value.claim.frames[1], { width: 32, height: 32 });
    if (kind === "duplicate") value.claim.frames.push(value.claim.frames[0]);
    if (kind === "outside") value.claim.frames[2].index = 3;
    if (kind === "schema") Object.assign(value.claim, { schemaVersion: 2 });
    if (kind === "complete") Object.assign(value.claim, { complete: true });
    if (kind === "unverified") Object.assign(value.claim, { unverifiedIntervals: [] });
    expect(check(value)).toMatchObject({ consistency: "INVALID", authority: "none", eligible: false });
  });

  it.each(["first", "middle", "tail", "gap", "overlap", "origin", "unknown-tail", "duration", "unsafe-pts"]) ("rejects an incomplete decoded inventory: %s", kind => {
    const value = fixture();
    if (kind === "first") value.inventory.frames.shift();
    if (kind === "middle") value.inventory.frames.splice(1, 1);
    if (kind === "tail") value.inventory.frames.pop();
    if (kind === "gap") value.inventory.frames[1].pts++;
    if (kind === "overlap") value.inventory.frames[1].pts--;
    if (kind === "origin") value.inventory.frames[0].pts--;
    if (kind === "unknown-tail") Object.assign(value.inventory.frames[2], { endPts: undefined });
    if (kind === "duration") value.inventory.horizonEndPts++;
    if (kind === "unsafe-pts") value.inventory.frames[2].endPts = Number.MAX_SAFE_INTEGER + 1;
    expect(check(value).consistency).toBe("INVALID");
  });

  it("allows distinct VFR frame ordinals with identical pixel hashes", () => {
    expect(new Set(fixture().inventory.frames.map(frame => frame.pixelSha256)).size).toBe(1);
    expect(check(fixture()).consistency).toBe("CONSISTENT");
  });

  it("rejects unsupported source orientation and inventory pixel size", () => {
    const value = fixture();
    Object.assign(value.inventory.source, { rotation: 90 }); Object.assign(value.claim.source, { rotation: 90 });
    expect(check(value).consistency).toBe("INVALID");
    const resized = fixture(); resized.inventory.frames[1].byteLength /= 4;
    expect(check(resized).consistency).toBe("INVALID");
  });

  it("cannot accept a mask PASS or caller reviewer receipt as full-source authority", () => {
    const value = fixture();
    expect(checkFullSourceFactContract(value.inventory, { ...value.claim, proof: { mode: "source-mask-only-v1", maskReview: "PASS" } }).consistency).toBe("INVALID");
    expect(checkFullSourceFactContract(value.inventory, { ...value.claim, reviewReceipt: { decision: "PASS", exhaustive: true } }).consistency).toBe("INVALID");
  });

  it("enumerates simultaneous targets and separates disappearance/reappearance", () => {
    const value = fixture(); value.claim.frames[0].targets = ["a", "b"]; value.claim.frames[2].targets = ["a"];
    value.claim.targets = [{ id: "a", segments: [target("a", 0, 1, "first").segments[0], target("a", 2, 3, "return").segments[0]] }, target("b", 0, 1)];
    expect(check(value)).toMatchObject({ consistency: "CONSISTENT", claimedNoStickerIntervals: [{ startFrame: 1, endFrame: 2 }] });
    value.claim.targets[0].segments[0].endFrame = 3;
    expect(check(value).consistency).toBe("INVALID");
  });

  it.each(["omitted", "extra", "short", "wide", "duplicate-target", "duplicate-segment", "duplicate-observation"]) ("rejects catalogue/frame-set inconsistency: %s", kind => {
    const value = fixture(); value.claim.frames[1].targets = ["a"]; value.claim.targets = [target("a", 1, 2)];
    if (kind === "omitted") value.claim.targets = [];
    if (kind === "extra") value.claim.targets.push(target("b", 0, 1));
    if (kind === "short") value.claim.targets[0].segments[0].startFrame = 2;
    if (kind === "wide") value.claim.targets[0].segments[0].startFrame = 0;
    if (kind === "duplicate-target") value.claim.targets.push(value.claim.targets[0]);
    if (kind === "duplicate-segment") value.claim.targets[0].segments.push(value.claim.targets[0].segments[0]);
    if (kind === "duplicate-observation") value.claim.frames[1].targets.push("a");
    expect(check(value).consistency).toBe("INVALID");
  });

  it("does not upgrade the currently valid broad range plus one sampled ABSENT", () => {
    const value = fixture(); const evidence = { id: "frame", kind: "source", digest: hash("evidence"), byteLength: 5, pts: 10, timeMs: 0, width: 64, height: 64 };
    const facts = { reviewedRanges: [{ startMs: 0, endMs: 1000 }], targets: [], exclusions: [], observations: [{ evidenceId: "frame", presence: "ABSENT" }], samplingStrategy: "timed-full-frames-v1" };
    const sampled = { schemaVersion: 1, id: "candidate", state: "candidate", source, baseRevisionId: null, runId: "run", requiredRanges: facts.reviewedRanges, facts, evidence: [evidence], resolvedDisputeIds: [], changes: [], provenance: { executor: "test/model", supervisor: "test/model", contractVersion: 1, requests: 2, at: "2026-09-28T00:00:00Z" } };
    expect(KnowledgeCandidateSchema.safeParse(sampled).success).toBe(true);
    expect(checkFullSourceFactContract(value.inventory, sampled).consistency).toBe("INVALID");
    value.claim.frames = [value.claim.frames[0]];
    expect(check(value).unverifiedIntervals).toEqual([{ startFrame: 1, endFrame: 3 }]);
  });
});

describe("M5-D real CPU decode counterexample with synthetic truth", () => {
  it("endpoint samples miss a central one-frame sticker and a simultaneous second target", () => {
    const directory = mkdtempSync(join(tmpdir(), "jianji-m5d-"));
    const run = (program: string, args: string[]) => {
      const binary = program === "ffmpeg" ? process.env.JIANJI_FFMPEG_PATH ?? program : process.env.JIANJI_FFPROBE_PATH ?? program;
      const result = spawnSync(binary, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
      expect(result.error, result.stderr?.toString()).toBeUndefined();
      expect(result.status, result.stderr?.toString()).toBe(0);
      return result.stdout;
    };
    try {
      const path = join(directory, "flash.mp4");
      run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=30:d=1", "-vf",
        "drawbox=x=24:y=24:w=8:h=8:color=white:t=fill:enable='eq(n,15)',drawbox=x=40:y=24:w=8:h=8:color=white:t=fill:enable='eq(n,15)'",
        "-c:v", "libx264", "-crf", "0", "-pix_fmt", "yuv444p", "-video_track_timescale", "30000", path]);
      const probe = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_streams", "-show_entries",
        "stream=time_base,duration_ts:frame=best_effort_timestamp,duration,pkt_duration,width,height", "-of", "json", path]).toString()) as {
          streams: { time_base: string; duration_ts: number }[]; frames: { best_effort_timestamp: number; duration?: number; pkt_duration?: number; width: number; height: number }[];
        };
      const raw = run("ffmpeg", ["-v", "error", "-nostdin", "-i", path, "-map", "0:v:0", "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]);
      const size = 64 * 64 * 4; expect(probe.frames).toHaveLength(30); expect(raw.length).toBe(30 * size);
      expect(probe.streams[0]).toMatchObject({ time_base: "1/30000", duration_ts: 30000 });
      const pixels = (index: number) => raw.subarray(index * size, (index + 1) * size);
      expect(hash(pixels(0))).toBe(hash(pixels(29)));
      expect(hash(pixels(15))).not.toBe(hash(pixels(0)));
      expect([pixels(15)[(24 * 64 + 24) * 4], pixels(15)[(24 * 64 + 40) * 4]]).toEqual([255, 255]);
      const bytes = readFileSync(path); const value = fixture();
      value.inventory.source = { ...source, fingerprint: `sha256:${hash(bytes)}`, byteLength: bytes.length, timeBase: probe.streams[0].time_base, timeOriginPts: 0 };
      value.inventory.horizonEndPts = probe.streams[0].duration_ts;
      value.inventory.frames = probe.frames.map((frame, index) => {
        const duration = frame.duration ?? frame.pkt_duration;
        expect([frame.width, frame.height, duration]).toEqual([64, 64, 1000]);
        if (frame.duration !== undefined && frame.pkt_duration !== undefined) expect(frame.duration).toBe(frame.pkt_duration);
        return { index, pts: frame.best_effort_timestamp, endPts: frame.best_effort_timestamp + duration!, pixelSha256: hash(pixels(index)), byteLength: size };
      });
      value.claim.source = value.inventory.source;
      value.claim.frames = value.inventory.frames.map(frame => ({ index: frame.index, pts: frame.pts, pixelSha256: frame.pixelSha256, byteLength: size, scope: "full-canvas-rgba", state: "COMPLETE", targets: [] }));
      // Both catalogue and annotations lie together: hashes/set equality cannot detect semantic omission.
      expect(check(value)).toMatchObject({ consistency: "CONSISTENT", unverifiedIntervals: [], authority: "none", eligible: false, semanticReview: "NOT_EVALUATED" });
      value.claim.frames[15].targets = ["central", "second"];
      expect(check(value).consistency).toBe("INVALID");
      value.claim.targets = [target("central", 15, 16), target("second", 15, 16)];
      expect(check(value)).toMatchObject({ consistency: "CONSISTENT", eligible: false, claimedNoStickerIntervals: [{ startFrame: 0, endFrame: 15 }, { startFrame: 16, endFrame: 30 }] });
      value.claim.targets.pop(); expect(check(value).consistency).toBe("INVALID");
      value.claim.frames = [value.claim.frames[0], value.claim.frames[29]]; value.claim.targets = [];
      expect(check(value).unverifiedIntervals).toEqual([{ startFrame: 1, endFrame: 29 }]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 45000);
});
