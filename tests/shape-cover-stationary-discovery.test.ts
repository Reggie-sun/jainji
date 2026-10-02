import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverBinary } from "../src/main/ffmpeg.js";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { collectFullSourceCensus } from "../src/main/source-fact-census.js";
import { prepareDiscoveryEvidence, verifyDiscoveryFramehash, selectDiscoveryOrdinals, type DiscoveryEvidence } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets, mapDiscoveryBox } from "../src/main/shape-cover-stationary-discovery.js";
import type { FullDecodeClock } from "../src/main/source-fact-census-clock.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
function run(binary: string, args: string[], input?: Buffer) {
  const r = spawnSync(binary, args, { input, timeout: 20000, maxBuffer: 8 * 1024 ** 2 });
  if (r.error || r.status !== 0) throw r.error ?? Error(r.stderr.toString()); return r.stdout;
}
async function fixture(kind: "multiple" | "background" | "blank" | "moving" | "blinking" | "cut" | "subtitle" | "print" | "crowded" | "speckled" = "multiple") {
  const ffmpeg = { ffmpegPath: (await discoverBinary("ffmpeg"))!, ffprobePath: (await discoverBinary("ffprobe"))! };
  const root = await mkdtemp(join(tmpdir(), "jianji-discovery-test-")); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const width = ["crowded", "speckled"].includes(kind) ? 360 : 96, height = width === 360 ? 360 : 80;
  const frameCount = 12, raw = Buffer.alloc(width * height * 3 * frameCount);
  for (let f = 0; f < frameCount; f++) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = ((f * height + y) * width + x) * 3;
      const v = kind === "blank" ? 80 : kind === "background" ? ((x * 11 + y * 7) % 200 + 20) : kind === "cut" ? (f < 6 ? 20 : 230) : ((f * 103 + x * 13 + y * 11) % 230 + 10);
      raw.fill(v, offset, offset + 3);
    }
    if (["background", "blank", "cut"].includes(kind)) continue;
    if (kind === "speckled") {
      for (let y = 1; y < height; y += 3) for (let x = 1; x < width; x += 3) {
        const offset = ((f * height + y) * width + x) * 3; raw.fill(240, offset, offset + 3);
      }
      continue;
    }
    const boxes = kind === "crowded" ? Array.from({ length: 143 }, (_, i) => [4 + (i % 13) * 27, 4 + Math.floor(i / 13) * 32, 8, 8])
      : kind === "multiple" ? [[12, 10, 12, 10], [57, 42, 18, 15]] : kind === "subtitle" ? [[20, 65, 40, 8]] : [[12 + (kind === "moving" ? f * 4 : 0), 10, 16, 14]];
    if (kind === "blinking" && f % 2) continue;
    for (const [bx, by, w, h] of boxes) for (let y = by; y < by + h; y++) for (let x = bx; x < bx + w; x++) {
      const offset = ((f * height + y) * width + x) * 3, v = (x + y) % 3 ? 240 : 20;
      raw.fill(v, offset, offset + 3);
    }
  }
  const sourcePath = join(root, "source.mp4");
  run(ffmpeg.ffmpegPath, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", "6", "-i", "pipe:0",
    "-vf", "setsar=1", "-c:v", "libx264", "-qp", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-video_track_timescale", "6000", "-n", sourcePath], raw);
  const probe = JSON.parse(run(ffmpeg.ffprobePath, ["-v", "error", "-show_streams", "-of", "json", sourcePath]).toString());
  const source = await identifySource(sourcePath, { width, height, rotation: 0, durationMs: 2000,
    timeBase: probe.streams[0].time_base, timeOriginPts: 0, interpretationVersion: 1 });
  return { sourcePath, source, ffmpeg, signal: new AbortController().signal };
}
async function evidenceFor(kind: Parameters<typeof fixture>[0] = "multiple", frames = 12) {
  const input = await fixture(kind), evidence = await prepareDiscoveryEvidence(input, { frames });
  cleanup.push(() => evidence.close()); return { input, evidence };
}
const candidates = (r: Awaited<ReturnType<typeof discoverStationaryTargets>>) => r.components.filter(c => c.state === "CANDIDATE");

describe("bounded representative RGBA evidence", () => {
  it("binds selected original ordinals, PTS and pixels to the existing full-census owner without spooling full source", async () => {
    const { input, evidence } = await evidenceFor("multiple", 4), full = await collectFullSourceCensus(input);
    expect(evidence.receipt.frames.map(f => f.index)).toEqual([0, 4, 7, 11]);
    for (const f of evidence.receipt.frames) expect(f).toEqual(full.frames[f.index]);
    expect(evidence.metrics.scratchBytes).toBe(input.source.width * input.source.height * 4 * 4);
    expect(evidence.receipt.authority).toBe("none"); expect(evidence.receipt.eligible).toBe(false);
    await expect(evidence.readFrame(4)).rejects.toThrow(/ordinal/);
  }, 30000);
  it("rejects wrong source identity and enlarged or exhausted budgets", async () => {
    const input = await fixture();
    await expect(prepareDiscoveryEvidence({ ...input, source: { ...input.source, fingerprint: `sha256:${"0".repeat(64)}` } })).rejects.toThrow(/identity/);
    await expect(prepareDiscoveryEvidence(input, { frames: 97 })).rejects.toThrow(/budget/);
    await expect(prepareDiscoveryEvidence(input, { scratchBytes: 1 })).rejects.toThrow(/scratch/);
    await expect(prepareDiscoveryEvidence(input, { wallMs: 1 })).rejects.toThrow(/wall/);
  }, 30000);
  it("rejects source drift, closed and forged evidence; cancellation never returns candidates", async () => {
    const { input, evidence } = await evidenceFor();
    await expect(discoverStationaryTargets({ ...evidence } as DiscoveryEvidence, input.signal)).rejects.toThrow(/unowned/);
    const cancelled = AbortSignal.abort();
    await expect(discoverStationaryTargets(evidence, cancelled)).rejects.toThrow(/cancelled/);
    await expect(prepareDiscoveryEvidence({ ...input, signal: cancelled })).rejects.toThrow(/cancelled/);
    await appendFile(input.sourcePath, Buffer.from([1])); await expect(evidence.readFrame(0)).rejects.toThrow(/generation/);
    await evidence.close(); await expect(discoverStationaryTargets(evidence, input.signal)).rejects.toThrow(/closed/);
  }, 30000);
  it("rejects mismatched framehash PTS, pixel digest, timebase and missing tail", () => {
    const f = { index: 4, pts: 4000, endPts: 5000, byteLength: 64, pixelSha256: "a".repeat(64) };
    const text = `#hash: SHA256\n#tb 0: 1/6000\n0, 4000, 4000, 1000, 64, ${f.pixelSha256}\n`;
    expect(() => verifyDiscoveryFramehash(text, [f], "1/6000")).not.toThrow();
    for (const bad of [text.replace(", 4000, 1000", ", 3999, 1000"), text.replace(", 1000, 64", ", 999, 64"), text.replace(f.pixelSha256, "b".repeat(64)), text.replace("1/6000", "1/30"), "#hash: SHA256\n#tb 0: 1/6000\n"]) {
      expect(() => verifyDiscoveryFramehash(bad, [f], "1/6000")).toThrow(/INCOMPLETE/);
    }
  });
  it("samples by exact PTS on a nonuniform clock and maps half-open ROIs outward", () => {
    const clock = { frames: [0, 1, 2, 6, 9, 12].map((pts, index) => ({ index, pts, endPts: pts + 1 })) } as FullDecodeClock;
    expect(selectDiscoveryOrdinals(clock, 4)).toEqual([0, 3, 4, 5]);
    expect(mapDiscoveryBox({ x: 1, y: 2, width: 2, height: 2 }, { width: 3, height: 5 }, { width: 10, height: 13 })).toEqual({ x: 3, y: 5, width: 7, height: 6 });
  });
});
describe("CPU full-canvas stationary candidate development", () => {
  it("finds every separated component including a smaller non-corner target, recomputes original pixels and repeats deterministically", async () => {
    const { input, evidence } = await evidenceFor(), a = await discoverStationaryTargets(evidence, input.signal), b = await discoverStationaryTargets(evidence, input.signal);
    expect(candidates(a)).toHaveLength(2); expect(a.resultDigest).toBe(b.resultDigest);
    expect(candidates(a).some(c => c.sourceBox.x <= 12 && c.sourceBox.y <= 10 && c.sourceBox.x + c.sourceBox.width >= 24)).toBe(true);
    for (const c of candidates(a)) { expect(c.originalPixels!.roiFrames).toHaveLength(12); expect(c.originalPixels!.stableFraction).toBeGreaterThan(0.8); }
    expect(a.status).toBe("CANDIDATES_REQUIRE_CONFIRMATION"); expect(a.authority).toBe("none"); expect(a.eligible).toBe(false);
    expect(a.maskReview).toBe("NOT_EVALUATED"); expect(a.targetConfirmation).toBe("NOT_EVALUATED");
    expect(JSON.stringify(a)).not.toContain("dataBase64");
  }, 30000);
  it.each(["background", "blank", "moving", "blinking", "cut"] as const)("%s never becomes an identified sticker or absence proof", async kind => {
    const { input, evidence } = await evidenceFor(kind), result = await discoverStationaryTargets(evidence, input.signal);
    expect(candidates(result)).toHaveLength(0); expect(result.status).toBe("NO_CONFIRMED_TARGET");
    expect(result.reasons).toContain("NO_ABSENCE_CLAIM"); expect(result.motionReview).toBe("NOT_EVALUATED");
    if (kind === "background" || kind === "blank") expect(result.components.some(c => c.reasons.includes("EXTENSIVE_STABLE_BACKGROUND_AMBIGUITY"))).toBe(true);
  }, 30000);
  it.each(["subtitle", "print"] as const)("%s remains a semantic ambiguity even with strong stationary signals", async kind => {
    const { input, evidence } = await evidenceFor(kind), result = await discoverStationaryTargets(evidence, input.signal);
    expect(candidates(result).length).toBeGreaterThan(0);
    expect(candidates(result).every(c => c.reasons.includes("BACKGROUND_SUBTITLE_OR_PRODUCT_PRINT_POSSIBLE"))).toBe(true);
    expect(result.targetConfirmation).toBe("NOT_EVALUATED");
  }, 30000);
  it("reports insufficient representative time as INCOMPLETE, no vacant success", async () => {
    const { input, evidence } = await evidenceFor("multiple", 2), result = await discoverStationaryTargets(evidence, input.signal);
    expect(result.status).toBe("INCOMPLETE"); expect(candidates(result)).toHaveLength(0);
  }, 30000);
  it.each(["crowded", "speckled"] as const)("%s exceeds finite enumeration budgets without returning a truncated success", async kind => {
    const { input, evidence } = await evidenceFor(kind);
    await expect(discoverStationaryTargets(evidence, input.signal)).rejects.toThrow(/budget exceeded; no truncated success/);
  }, 30000);
  it("stops cancellation during live preparation and during discovery", async () => {
    const input = await fixture(), prepareController = new AbortController();
    const preparing = prepareDiscoveryEvidence({ ...input, signal: prepareController.signal });
    const prepareTimer = setTimeout(() => prepareController.abort(), 10);
    try { await expect(preparing).rejects.toThrow(/cancelled/); } finally { clearTimeout(prepareTimer); }
    const evidence = await prepareDiscoveryEvidence(input); cleanup.push(() => evidence.close());
    const discoveryController = new AbortController(), discovering = discoverStationaryTargets(evidence, discoveryController.signal);
    const discoverTimer = setTimeout(() => discoveryController.abort(), 10);
    try { await expect(discovering).rejects.toThrow(/cancelled/); } finally { clearTimeout(discoverTimer); }
  }, 30000);
});
