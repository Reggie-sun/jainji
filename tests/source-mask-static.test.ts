import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { discoverBinary } from "../src/main/ffmpeg.js";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareDiscoveryEvidence, type DiscoveryBinding } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";
import { confirmStaticDiscoveryTarget, prepareStaticTargetEvidence, type StaticTargetEvidence } from "../src/main/source-mask-static-target.js";
import { extractStaticConservativeMask } from "../src/main/source-mask-auto-extraction.js";
import { packStaticMask } from "../src/main/source-mask-static-extraction.js";
import { freezeStaticPixelTruth, qualifyStaticMask } from "../src/main/source-mask-auto-qualification.js";
import type { StaticPixelTruthInput } from "../src/main/source-mask-static-qualification.js";
import { decodeSourceMask } from "../src/main/shape-cover-pixel-gate.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
function run(binary: string, args: string[], input?: Buffer) {
  const result = spawnSync(binary, args, { input, timeout: 20000, maxBuffer: 8 * 1024 ** 2 });
  if (result.error || result.status) throw result.error ?? Error(result.stderr.toString()); return result.stdout;
}
type Kind = "static" | "blink" | "move" | "tail" | "thin" | "alpha" | "group" | "group-edge" | "group-margin";
async function fixture(kind: Kind = "static") {
  const width = 128, height = 96, count = 30, root = await mkdtemp(join(tmpdir(), "jianji-static-mask-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const ffmpeg = { ffmpegPath: (await discoverBinary("ffmpeg"))!, ffprobePath: (await discoverBinary("ffprobe"))! };
  const raw = Buffer.alloc(width * height * 3 * count), required: Uint8Array[] = [];
  for (let f = 0; f < count; f++) {
    const points = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x, offset = (f * width * height + p) * 3, background = (x * 13 + y * 7 + f * 107) % 230 + 10;
      const sx = x - (kind === "move" && f === 15 ? 9 : 0);
      const grouped = kind.startsWith("group");
      let visible = Math.abs(sx - (grouped ? 35 : 65)) + Math.abs(y - 43) <= 12;
      if (grouped) visible ||= x >= 95 && x <= 98 && y >= 41 && y <= 44;
      if (kind === "group-edge" || kind === "group-margin") visible ||= x >= (kind === "group-edge" ? 0 : 1) && x <= 4 && y >= 41 && y <= 44;
      // Independent middle feature and subtitle-like feature are not construction targets.
      const unrelated = grouped && (x >= 65 && x <= 68 && y >= 41 && y <= 44 || x >= 32 && x <= 43 && y >= 65 && y <= 68);
      if (kind === "thin") visible ||= y === 43 && sx >= 77 && sx <= 86;
      if (kind === "tail" && f === 29) visible ||= x >= 78 && x <= 87 && y === 43;
      if (kind === "alpha" && !visible && Math.abs(sx - 65) + Math.abs(y - 43) <= 14) {
        points[p] = 1; raw.fill(Math.round(background * 0.85 + 235 * 0.15), offset, offset + 3);
      }
      else if (visible && !(kind === "blink" && f === 15)) { points[p] = 1; raw.fill((sx + y) % 3 ? 235 : 25, offset, offset + 3); }
      else raw.fill(unrelated ? ((x + y) % 3 ? 235 : 25) : background, offset, offset + 3);
    }
    required.push(points);
  }
  const sourcePath = join(root, "source.mp4");
  run(ffmpeg.ffmpegPath, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", "10", "-i", "pipe:0",
    "-vf", "setsar=1", "-c:v", "libx264", "-qp", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-video_track_timescale", "10000", "-n", sourcePath], raw);
  const probe = JSON.parse(run(ffmpeg.ffprobePath, ["-v", "error", "-show_streams", "-of", "json", sourcePath]).toString());
  const source = await identifySource(sourcePath, { width, height, rotation: 0, durationMs: 3000, timeBase: probe.streams[0].time_base, timeOriginPts: 0, interpretationVersion: 1 });
  const input = { sourcePath, source, ffmpeg, signal: new AbortController().signal };
  const discovery = await prepareDiscoveryEvidence(input, { frames: 4 }); cleanup.push(() => discovery.close());
  const result = await discoverStationaryTargets(discovery, input.signal), component = result.components.find(c => c.state === "CANDIDATE");
  expect(component).toBeDefined();
  const selection = { candidateId: component!.id, targetId: randomUUID(), confirmedBy: "controlled-target-confirmation", description: "constructed diamond",
    decision: "CONFIRM_STATIC_TARGET_IDENTITY_AND_RANGE_ONLY" as const, range: { startFrame: 0, endFrame: count } };
  const target = await confirmStaticDiscoveryTarget(discovery, selection, input.signal);
  const evidence = await prepareStaticTargetEvidence(input, target); cleanup.push(() => evidence.close());
  return { input, discovery, result, selection, target, evidence, required, count };
}
async function truthFor(evidence: StaticTargetEvidence, required: Uint8Array[], moving = false): Promise<StaticPixelTruthInput> {
  const frames: StaticPixelTruthInput["frames"] = [];
  await evidence.streamRange((_rgba, binding) => {
    // Pixel truth comes only from the media construction, never from M1 or extracted mask.
    const source = { x: 0, y: 0, width: 128, height: 96 };
    const mask = packStaticMask(required[binding.index], source)!;
    frames.push({ binding: { ...binding }, requiredPixels: mask, motion: moving ? "MOVING" : "STATIC" });
  }, new AbortController().signal);
  return { scope: "CONTROLLED_CONSTRUCTION", authorId: "media-constructor", reviewerId: "independent-pixel-comparator",
    origin: "INDEPENDENT_REQUIRED_PIXELS_NOT_EXTRACTOR_MASK", frames };
}

describe("static confirmed-target mask development", () => {
  it("explicitly confirms two target components without swallowing middle or subtitle components", async () => {
    const { input, discovery, result, selection, evidence: old, required } = await fixture("group");
    const ids = result.components.filter(c => c.state === "CANDIDATE" && (c.gridBox.x === 23 || c.gridBox.x === 95)).map(c => c.id);
    expect(ids).toHaveLength(2);
    const { candidateId: _single, ...identity } = selection;
    const target = await confirmStaticDiscoveryTarget(discovery, { ...identity, candidateIds: ids.reverse() } as never, input.signal);
    expect(target.receipt.method).toBe("confirmed-static-target-development/v2");
    const receipt = target.receipt as unknown as { confirmedCandidateIds: string[]; confirmedSourceBoxes: unknown[] };
    expect(receipt.confirmedCandidateIds).toEqual([...ids].sort()); expect(receipt.confirmedSourceBoxes).toHaveLength(2);
    const reordered = await confirmStaticDiscoveryTarget(discovery, { ...identity, candidateIds: [...ids].reverse() }, input.signal);
    expect(reordered.receipt).toEqual(target.receipt);
    const evidence = await prepareStaticTargetEvidence(input, target); cleanup.push(() => evidence.close());
    const truth = await freezeStaticPixelTruth(evidence, await truthFor(evidence, required));
    const candidate = await extractStaticConservativeMask(evidence, input.signal);
    expect((await qualifyStaticMask(candidate, truth, input.signal)).metrics.missedRequiredPixels).toBe(0);
    const raster = decodeSourceMask({ ...candidate.receipt.mask!, kind: "static-binary-v1" }, input.source)!;
    for (let y = 41; y <= 44; y++) for (let x = 65; x <= 68; x++) expect(raster[y * 128 + x]).toBe(0);
    for (let y = 65; y <= 68; y++) for (let x = 32; x <= 43; x++) expect(raster[y * 128 + x]).toBe(0);
    // Omitted logical component is never silently supplemented; exact comparison exposes it.
    const omittedTruth = await freezeStaticPixelTruth(old, await truthFor(old, required));
    const omitted = await qualifyStaticMask(await extractStaticConservativeMask(old, input.signal), omittedTruth, input.signal);
    expect(omitted.status).toBe("NOT_QUALIFIED"); expect(omitted.metrics.missedRequiredPixels).toBe(480);
  }, 30000);
  it("normalizes legacy single selections to the identical singleton v2 behavior without a truth dependency", async () => {
    const { input, discovery, selection, target, evidence } = await fixture(), { candidateId, ...identity } = selection;
    const grouped = await confirmStaticDiscoveryTarget(discovery, { ...identity, candidateIds: [candidateId] }, input.signal);
    expect(grouped.receipt).toEqual(target.receipt);
    const next = await prepareStaticTargetEvidence(input, grouped); cleanup.push(() => next.close());
    expect((await extractStaticConservativeMask(next, input.signal)).receipt.mask)
      .toEqual((await extractStaticConservativeMask(evidence, input.signal)).receipt.mask);
    for (const file of ["src/main/source-mask-static-target.ts", "src/main/source-mask-static-extraction.ts", "src/main/shape-cover-stationary-discovery.ts"]) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*(?:scripts\/|engineering-corpus|construction-truth)/);
      expect(source).not.toMatch(/constructCase|CONTROLLED_CASES|logicalIdentity/);
    }
  }, 30000);
  it("rejects duplicate, empty, unknown and cross-source groups, authored boxes and serialized v1/clone authority", async () => {
    const { input, discovery, selection, target } = await fixture();
    const foreign = await fixture("thin"), { candidateId, ...identity } = selection;
    for (const candidateIds of [[], [candidateId, candidateId], ["0".repeat(64)], [foreign.selection.candidateId]]) {
      await expect(confirmStaticDiscoveryTarget(discovery, { ...identity, candidateIds } as never, input.signal)).rejects.toThrow();
    }
    await expect(confirmStaticDiscoveryTarget(discovery, { ...identity, candidateIds: [candidateId], sourceBoxes: [] } as never, input.signal)).rejects.toThrow();
    await expect(confirmStaticDiscoveryTarget(discovery, { ...identity, candidateIds: [candidateId], mask: {} } as never, input.signal)).rejects.toThrow();
    await expect(confirmStaticDiscoveryTarget(discovery, { ...selection, method: "confirmed-static-target-development/v1" } as never, input.signal)).rejects.toThrow();
    await expect(prepareStaticTargetEvidence(input, JSON.parse(JSON.stringify(target)))).rejects.toThrow(/unowned/);
    for (const range of [{ startFrame: 0, endFrame: 31 }, { startFrame: 1, endFrame: 1 }])
      await expect(confirmStaticDiscoveryTarget(discovery, { ...identity, candidateIds: [candidateId], range } as never, input.signal)).rejects.toThrow(/range/);
  }, 30000);
  it.each(["group-edge", "group-margin"] as const)("keeps confirmed %s extent fail-closed", async kind => {
    const { input, discovery, result, selection } = await fixture(kind), { candidateId: _single, ...identity } = selection;
    const ids = result.components.filter(c => c.state === "CANDIDATE" && c.gridBox.y < 60).map(c => c.id);
    const target = await confirmStaticDiscoveryTarget(discovery, { ...identity, candidateIds: ids } as never, input.signal);
    const evidence = await prepareStaticTargetEvidence(input, target); cleanup.push(() => evidence.close());
    const candidate = await extractStaticConservativeMask(evidence, input.signal);
    expect(candidate.receipt.status).toBe("INCOMPLETE");
    expect(candidate.receipt.reasons).toContain(kind === "group-edge" ? "STABLE_COMPONENT_EXTENT_UNRESOLVED" : "CONSERVATIVE_MARGIN_EXTENT_UNRESOLVED");
  }, 30000);
  it("builds an irregular original-pixel mask and checks the complete range against independently frozen construction pixels", async () => {
    const { input, evidence, required, count } = await fixture("thin");
    const truth = await freezeStaticPixelTruth(evidence, await truthFor(evidence, required));
    const candidate = await extractStaticConservativeMask(evidence, input.signal), result = await qualifyStaticMask(candidate, truth, input.signal);
    expect(candidate.receipt.status).toBe("CANDIDATE_REQUIRES_INDEPENDENT_PIXEL_EVIDENCE");
    expect(candidate.receipt.frames).toHaveLength(count); expect(candidate.receipt.frames[0].index).toBe(0); expect(candidate.receipt.frames.at(-1)!.index).toBe(count - 1);
    expect(candidate.receipt.mask!.markedPixels).toBeLessThan(candidate.receipt.mask!.bbox.width * candidate.receipt.mask!.bbox.height);
    expect(result.status).toBe("DEVELOPMENT_MATCH"); expect(result.metrics.missedRequiredPixels).toBe(0);
    expect(result.metrics.requiredPixels).toBe(required.reduce((n, pixels) => n + pixels.reduce((a, b) => a + b, 0), 0));
    expect(result.metrics.comparedFrames).toBe(count); expect(result.authority).toBe("none"); expect(result.eligible).toBe(false);
    expect(candidate.metrics.scratchBytes).toBe(0); expect(evidence.metrics.workingBytes).toBeLessThan(512 * 1024 ** 2);
  }, 30000);
  it("retains known faint antialiased/transparent construction edges without declaring arbitrary real transparency supported", async () => {
    const { input, evidence, required } = await fixture("alpha"), truth = await freezeStaticPixelTruth(evidence, await truthFor(evidence, required));
    const candidate = await extractStaticConservativeMask(evidence, input.signal), result = await qualifyStaticMask(candidate, truth, input.signal);
    expect(result.status).toBe("DEVELOPMENT_MATCH"); expect(result.metrics.missedRequiredPixels).toBe(0);
    expect(candidate.receipt.maskReview).toBe("NOT_EVALUATED");
  }, 30000);
  it.each(["blink", "move"] as const)("rejects an unsampled %s at the original ordinal without shortening the range", async kind => {
    const { input, evidence, count } = await fixture(kind), candidate = await extractStaticConservativeMask(evidence, input.signal);
    expect(candidate.receipt.sampleOrdinals).not.toContain(15);
    expect(candidate.receipt.status).toBe("INCOMPLETE"); expect(candidate.receipt.anomalies.some(a => a.index === 15)).toBe(true);
    expect(candidate.receipt.frames).toHaveLength(count); expect(candidate.receipt.range).toEqual({ startFrame: 0, endFrame: count });
  }, 30000);
  it("finds a missing thin tail extension using independent required pixels even if core stability is unchanged", async () => {
    const { input, evidence, required } = await fixture("tail"), truth = await freezeStaticPixelTruth(evidence, await truthFor(evidence, required));
    const candidate = await extractStaticConservativeMask(evidence, input.signal), result = await qualifyStaticMask(candidate, truth, input.signal);
    expect(result.status).toBe("NOT_QUALIFIED"); expect(result.metrics.missedRequiredPixels).toBeGreaterThan(0); expect(result.reasons).toContain("MISSING_REQUIRED_PIXELS");
  }, 30000);
  it("does not claim zero miss without independent truth or promote real-media declarations to reviewed evidence", async () => {
    const { input, evidence, required } = await fixture(), raw = await truthFor(evidence, required);
    const real = await freezeStaticPixelTruth(evidence, { ...raw, scope: "REAL_MEDIA" });
    const candidate = await extractStaticConservativeMask(evidence, input.signal);
    for (const truth of [null, real]) { const result = await qualifyStaticMask(candidate, truth, input.signal);
      expect(result.status).toBe("INCOMPLETE"); expect(result.metrics.requiredPixels).toBeNull(); expect(result.metrics.missedRequiredPixels).toBeNull(); }
  }, 30000);
  it("rejects late/clone truth, cloned candidates and incomplete or mismatched independent frames", async () => {
    const { input, evidence, required } = await fixture(), raw = await truthFor(evidence, required), truth = await freezeStaticPixelTruth(evidence, raw);
    await expect(freezeStaticPixelTruth(evidence, { ...raw, frames: raw.frames.slice(1) })).rejects.toThrow(/range/);
    await expect(freezeStaticPixelTruth(evidence, { ...raw, reviewerId: raw.authorId })).rejects.toThrow(/independence/);
    const candidate = await extractStaticConservativeMask(evidence, input.signal), late = await freezeStaticPixelTruth(evidence, raw);
    await expect(qualifyStaticMask(candidate, late, input.signal)).rejects.toThrow(/late/);
    await expect(qualifyStaticMask(candidate, { ...truth }, input.signal)).rejects.toThrow(/unowned/);
    await expect(qualifyStaticMask({ ...candidate }, truth, input.signal)).rejects.toThrow(/unowned/);
    const wrongFrames = raw.frames.map((f, i) => i ? f : { ...f, binding: { ...f.binding, pts: f.binding.pts + 1 } });
    await expect(freezeStaticPixelTruth(evidence, { ...raw, frames: wrongFrames })).rejects.toThrow(/clock/);
  }, 30000);
  it("rejects wrong confirmations/source, enlarged/exhausted budgets and forged/closed evidence", async () => {
    const { input, discovery, target, selection, evidence } = await fixture();
    await expect(confirmStaticDiscoveryTarget(discovery, { ...selection, candidateId: "0".repeat(64) }, input.signal)).rejects.toThrow(/candidate/);
    await expect(prepareStaticTargetEvidence(input, { ...target })).rejects.toThrow(/unowned/);
    await expect(prepareStaticTargetEvidence({ ...input, source: { ...input.source, fingerprint: `sha256:${"0".repeat(64)}` } }, target)).rejects.toThrow(/source/);
    await expect(prepareStaticTargetEvidence(input, target, { wallMs: 300001 })).rejects.toThrow(/budget/);
    await expect(prepareStaticTargetEvidence(input, target, { workingBytes: 1 })).rejects.toThrow(/working/);
    await expect(extractStaticConservativeMask({ ...evidence }, input.signal)).rejects.toThrow(/unowned/);
    await evidence.close(); await expect(extractStaticConservativeMask(evidence, input.signal)).rejects.toThrow(/closed/);
  }, 30000);
  it("checks original ROI hashes independently, source mutation and cancellation during streaming", async () => {
    const { input, evidence, discovery } = await fixture();
    const bindings: DiscoveryBinding[] = [], sourceFrame = await discovery.readFrame(0);
    await evidence.streamRange((rgba, binding) => { bindings.push({ ...binding });
      if (binding.index === 0) { const roi = evidence.roi;
        for (let y = 0; y < roi.height; y++) expect(rgba.subarray(y * roi.width * 4, (y + 1) * roi.width * 4))
          .toEqual(sourceFrame.subarray(((roi.y + y) * 128 + roi.x) * 4, ((roi.y + y) * 128 + roi.x + roi.width) * 4)); }
    }, input.signal);
    expect(bindings).toHaveLength(30);
    const cancelled = new AbortController();
    await expect(evidence.streamRange(() => cancelled.abort(), cancelled.signal)).rejects.toThrow(/cancelled|aborted/);
    await expect(extractStaticConservativeMask(evidence, AbortSignal.abort())).rejects.toThrow(/aborted/);
    await appendFile(input.sourcePath, Buffer.from([1])); await expect(evidence.verifyFresh()).rejects.toThrow(/generation/);
  }, 30000);
  it("refuses MOVING/UNKNOWN independent motion instead of declaring static qualification", async () => {
    const { input, evidence, required } = await fixture(), truth = await freezeStaticPixelTruth(evidence, await truthFor(evidence, required, true));
    const result = await qualifyStaticMask(await extractStaticConservativeMask(evidence, input.signal), truth, input.signal);
    expect(result.status).toBe("NOT_QUALIFIED"); expect(result.reasons).toContain("STATIC_MOTION_TRUTH_MISMATCH");
  }, 30000);
});
