import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { discoverBinary } from "../src/main/ffmpeg.js";
import { identifySource, SourceStickerKnowledgeStore, factsDigest } from "../src/main/source-sticker-knowledge-store.js";
import { prepareDiscoveryEvidence, type DiscoveryBinding } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";
import { confirmStaticDiscoveryTarget, prepareStaticTargetEvidence, type StaticTargetEvidence } from "../src/main/source-mask-static-target.js";
import { extractStaticConservativeMask } from "../src/main/source-mask-auto-extraction.js";
import { packStaticMask } from "../src/main/source-mask-static-extraction.js";
import { freezeStaticPixelTruth, qualifyStaticMask } from "../src/main/source-mask-auto-qualification.js";
import type { StaticPixelTruthInput } from "../src/main/source-mask-static-qualification.js";
import { decodeSourceMask } from "../src/main/shape-cover-pixel-gate.js";
import { readAdmittedShapeCoverTarget } from "../src/main/shape-cover-candidates.js";
import { verifyStaticTargetGeometry, readOwnedStaticGeometry } from "../src/main/source-mask-static-geometry.js";
import { freezeConfirmedStaticTargetSet, issueConfirmedTargetStaticProof, checkConfirmedStaticProof, confirmedStaticSetDigest,
  classifyStaticCandidateForProof } from "../src/main/source-mask-static-proof.js";
import { ConfirmedTargetStaticProofSchema, KnowledgeCandidateSchema } from "../src/shared/source-sticker-knowledge.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
function run(binary: string, args: string[], input?: Buffer) {
  const result = spawnSync(binary, args, { input, timeout: 20000, maxBuffer: 8 * 1024 ** 2 });
  if (result.error || result.status) throw result.error ?? Error(result.stderr.toString()); return result.stdout;
}
type Kind = "static" | "blink" | "move" | "tail" | "thin" | "alpha" | "group" | "group-edge" | "group-margin" | "geometry" | "geometry-move" | "geometry-group" | "geometry-rgb";
async function fixture(kind: Kind = "static") {
  const width = 128, height = 96, count = 30, root = await mkdtemp(join(tmpdir(), "jianji-static-mask-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const ffmpeg = { ffmpegPath: (await discoverBinary("ffmpeg"))!, ffprobePath: (await discoverBinary("ffprobe"))! };
  const raw = Buffer.alloc(width * height * 3 * count), required: Uint8Array[] = [];
  const texture = new Uint8Array(width * height); let seed = 5489;
  for (let p = 0; p < texture.length; p++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; texture[p] = (seed >>> 0) % (kind === "geometry-rgb" ? 220 : 256); }
  for (let f = 0; f < count; f++) {
    const points = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x, offset = (f * width * height + p) * 3, background = ((kind.startsWith("geometry") ? 0 : x * 13 + y * 7) + f * 107) % 230 + 10;
      const sx = x - ((kind === "move" || kind === "geometry-move") && f === 15 ? 9 : 0);
      const grouped = kind.startsWith("group") || kind === "geometry-group";
      let visible = Math.abs(sx - (grouped ? 35 : 65)) + Math.abs(y - 43) <= 12;
      if (kind.startsWith("geometry")) visible = y >= 22 && y <= 62 && (kind === "geometry-group" ? sx >= 12 && sx <= 48 || sx >= 78 && sx <= 114 : sx >= 40 && sx <= 90);
      if (grouped && kind !== "geometry-group") visible ||= x >= 95 && x <= 98 && y >= 41 && y <= 44;
      if (kind === "group-edge" || kind === "group-margin") visible ||= x >= (kind === "group-edge" ? 0 : 1) && x <= 4 && y >= 41 && y <= 44;
      // Independent middle feature and subtitle-like feature are not construction targets.
      const unrelated = grouped && kind !== "geometry-group" && (x >= 65 && x <= 68 && y >= 41 && y <= 44 || x >= 32 && x <= 43 && y >= 65 && y <= 68);
      if (kind === "thin") visible ||= y === 43 && sx >= 77 && sx <= 86;
      if (kind === "tail" && f === 29) visible ||= x >= 78 && x <= 87 && y === 43;
      if (kind === "alpha" && !visible && Math.abs(sx - 65) + Math.abs(y - 43) <= 14) {
        points[p] = 1; raw.fill(Math.round(background * 0.85 + 235 * 0.15), offset, offset + 3);
      }
      else if (visible && !(kind === "blink" && f === 15)) {
        points[p] = 1;
        const geometryBorder = y < 25 || y > 59 || (kind === "geometry-group" ? sx < 15 || sx > 111 || sx > 45 && sx < 81 : sx < 43 || sx > 87);
        const pixel = kind.startsWith("geometry") ? geometryBorder ? 128 : texture[y * width + sx] : (sx + y) % 3 ? 235 : 25;
        raw.fill(pixel + (kind === "geometry-rgb" && f === 15 ? 35 : 0), offset, offset + 3);
      }
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
  it("owns frozen full-range geometry, rejects clones and cancellation, and detects source staleness", async () => {
    const { input, evidence } = await fixture("geometry"), candidate = await extractStaticConservativeMask(evidence, input.signal);
    const geometry = await verifyStaticTargetGeometry(input, evidence, candidate), owner = readOwnedStaticGeometry(geometry);
    expect(geometry.receipt.status).toBe("DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED");
    expect(geometry.receipt.frameCount).toBe(30); expect(geometry.receipt.method).toBe("cpu-static-geometry/v1");
    expect(owner.evidence).toBe(evidence); expect(owner.candidate).toBe(candidate);
    expect(Object.isFrozen(owner)).toBe(true); expect(Object.isFrozen(owner.data)).toBe(true);
    expect(() => Object.assign(owner, { verifyFresh: async () => {} })).toThrow();
    expect(() => readOwnedStaticGeometry(JSON.parse(JSON.stringify(geometry)))).toThrow(/unowned/);
    await expect(verifyStaticTargetGeometry(input, evidence, JSON.parse(JSON.stringify(candidate)))).rejects.toThrow(/unowned/);
    const abort = new AbortController(); abort.abort();
    await expect(verifyStaticTargetGeometry({ ...input, signal: abort.signal }, evidence, candidate)).rejects.toThrow();
    await appendFile(input.sourcePath, "changed"); await expect(owner.verifyFresh()).rejects.toThrow(/changed/);
  }, 30000);
  it("issues a live single-target proof and durably reloads it without restoring publication ownership", async () => {
    const { input, target, evidence } = await fixture("geometry"), set = freezeConfirmedStaticTargetSet([{ target, segmentId: "segment" }]);
    const candidate = await extractStaticConservativeMask(evidence, input.signal), geometry = await verifyStaticTargetGeometry(input, evidence, candidate);
    const root = await mkdtemp(join(tmpdir(), "jianji-static-proof-store-")); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = await SourceStickerKnowledgeStore.open(root); cleanup.push(() => store.close());
    const run = await store.beginRun(input.source, input.signal), issued = await issueConfirmedTargetStaticProof(input, run, set, [{ segmentId: "segment", candidate, geometry }]);
    expect(issued.proof.mode).toBe("confirmed-target-static-v1"); expect(issued.proof.authority).toBe("none"); expect(issued.proof.eligible).toBe(false);
    expect(issued.proof.targets[0].confirmation.confirmedCandidateIds).toEqual(target.receipt.confirmedCandidateIds);
    expect(() => checkConfirmedStaticProof(issued.candidate, issued.proof, issued.blobs)).not.toThrow();
    await expect(store.publishConfirmedStaticTargets(run, issued.candidate, JSON.parse(JSON.stringify(issued.proof)), issued.blobs)).rejects.toThrow(/unowned/);
    await expect(issueConfirmedTargetStaticProof(input, run, JSON.parse(JSON.stringify(set)), [{ segmentId: "segment", candidate, geometry }])).rejects.toThrow(/unowned/);
    await expect(issueConfirmedTargetStaticProof(input, run, set, [{ segmentId: "segment", candidate, geometry: JSON.parse(JSON.stringify(geometry)) }])).rejects.toThrow(/unowned/);
    const revision = await store.publishConfirmedStaticTargets(run, issued.candidate, issued.proof, issued.blobs);
    expect(revision.verification).toBe("confirmed-target-static");
    expect((await store.publishConfirmedStaticTargets(run, issued.candidate, issued.proof, issued.blobs)).id).toBe(revision.id);
    await store.endRun(run); await store.close();
    const reopened = await SourceStickerKnowledgeStore.open(root); cleanup.push(() => reopened.close());
    const head = await reopened.readHead(input.source); expect(head!.revision).toEqual(revision); expect(head!.blobs).toEqual(issued.blobs);
    await expect(readAdmittedShapeCoverTarget({ id: "consumer-barrier", sourcePath: input.sourcePath, source: input.source,
      revisionId: revision.id, targetId: target.receipt.targetId, segmentId: "segment", range: issued.candidate.requiredRanges[0], placements: [] }, reopened)).rejects.toThrow(/not admitted/);
    const events = join(reopened.directory, "sources", revision.sourceKey, "events"), [event] = await readdir(events);
    await writeFile(join(events, event, "evidence", issued.proof.targets[0].artifacts.geometry), "corrupted geometry");
    await expect(reopened.readHead(input.source)).rejects.toThrow(/digest/);
  }, 30000);
  it("rejects every changed proof binding and retains the complete confirmed-set denominator", async () => {
    const { input, target, evidence } = await fixture("geometry"), candidate = await extractStaticConservativeMask(evidence, input.signal);
    const geometry = await verifyStaticTargetGeometry(input, evidence, candidate), run = { id: randomUUID() }, set = freezeConfirmedStaticTargetSet([{ target, segmentId: "segment" }]);
    const issued = await issueConfirmedTargetStaticProof(input, run, set, [{ segmentId: "segment", candidate, geometry }]);
    const changes = ["confirmationDigest", "componentDigest", "maskSha", "configDigest", "geometryDigest", "frameCount", "firstPts", "lastPts", "range", "empty", "extra", "duplicate", "source"];
    for (const change of changes) {
      const proof = structuredClone(issued.proof), t = proof.targets[0];
      if (change === "confirmationDigest") t.confirmation.confirmationDigest = "a".repeat(64);
      if (change === "componentDigest") t.confirmation.confirmedComponentDigests[0] = "a".repeat(64);
      if (change === "maskSha") t.mask.maskSha256 = "a".repeat(64);
      if (change === "configDigest") t.mask.configDigest = "a".repeat(64);
      if (change === "geometryDigest") t.geometry.geometryDigest = "a".repeat(64);
      if (change === "frameCount") t.geometry.frameCount--;
      if (change === "firstPts") t.geometry.firstPts++;
      if (change === "lastPts") t.geometry.lastPts--;
      if (change === "range") t.range.startFrame++;
      if (change === "empty") proof.targets = [];
      if (change === "extra") proof.targets.push({ ...structuredClone(t), targetId: randomUUID(), segmentId: "extra" });
      if (change === "duplicate") proof.targets.push(structuredClone(t));
      if (change === "source") proof.sourceKey = "a".repeat(64);
      proof.confirmedSetDigest = confirmedStaticSetDigest(proof.targets);
      expect(() => checkConfirmedStaticProof(issued.candidate, proof, issued.blobs), change).toThrow();
    }
    const facts = structuredClone(issued.candidate); facts.facts.targets.push({ ...structuredClone(facts.facts.targets[0]), id: randomUUID(), segments: [{ ...structuredClone(facts.facts.targets[0].segments[0]), id: "omitted" }] });
    const altered = { ...issued.proof, factsDigest: factsDigest(facts.facts) };
    expect(() => checkConfirmedStaticProof(facts, altered, issued.blobs)).toThrow(/set incomplete/);
    for (const reason of ["TARGET_NOT_SEPARABLE", "STABLE_COMPONENT_EXTENT_UNRESOLVED", "CONSERVATIVE_MARGIN_EXTENT_UNRESOLVED", "INSUFFICIENT_ORIGINAL_REPRESENTATIVES", "unknown-future-reason"])
      expect(() => classifyStaticCandidateForProof({ ...candidate.receipt, status: "INCOMPLETE", reasons: [reason] })).toThrow();
    expect(() => classifyStaticCandidateForProof({ ...candidate.receipt, status: "INCOMPLETE", reasons: [] })).toThrow();
    await expect(issueConfirmedTargetStaticProof(input, run, set, [])).rejects.toThrow(/incomplete/);
    await expect(issueConfirmedTargetStaticProof(input, run, set, [{ segmentId: "other", candidate, geometry }])).rejects.toThrow(/omitted/);
    const cancel = new AbortController(); cancel.abort();
    await expect(issueConfirmedTargetStaticProof({ ...input, signal: cancel.signal }, run, set, [{ segmentId: "segment", candidate, geometry }])).rejects.toThrow();
    expect(ConfirmedTargetStaticProofSchema.safeParse({ ...issued.proof, arbitraryAuthority: true }).success).toBe(false);
  }, 30000);
  it("binds a multi-component logical target and two explicitly confirmed targets in the same source", async () => {
    const { input, discovery, result, selection } = await fixture("geometry-group"), { candidateId: _single, ...identity } = selection;
    const ids = result.components.filter(c => c.state === "CANDIDATE").map(c => c.id);
    expect(ids).toHaveLength(2);
    const group = await confirmStaticDiscoveryTarget(discovery, { ...identity, candidateIds: ids }, input.signal);
    const groupSet = freezeConfirmedStaticTargetSet([{ target: group, segmentId: "group" }]);
    const groupEvidence = await prepareStaticTargetEvidence(input, group); cleanup.push(() => groupEvidence.close());
    const groupCandidate = await extractStaticConservativeMask(groupEvidence, input.signal), groupGeometry = await verifyStaticTargetGeometry(input, groupEvidence, groupCandidate);
    const groupProof = await issueConfirmedTargetStaticProof(input, { id: randomUUID() }, groupSet, [{ segmentId: "group", candidate: groupCandidate, geometry: groupGeometry }]);
    expect(groupProof.proof.targets[0].confirmation.confirmedCandidateIds).toEqual([...ids].sort());
    expect(groupProof.proof.targets[0].confirmation.confirmedComponentDigests).toEqual(group.receipt.confirmedComponentDigests);
    expect(groupProof.proof.targets[0].confirmation.confirmedSourceBoxes).toEqual(group.receipt.confirmedSourceBoxes);
    const pairs = [];
    for (const [i, id] of ids.entries()) {
      const target = await confirmStaticDiscoveryTarget(discovery, { ...identity, targetId: randomUUID(), candidateIds: [id] }, input.signal);
      const evidence = await prepareStaticTargetEvidence(input, target); cleanup.push(() => evidence.close());
      const candidate = await extractStaticConservativeMask(evidence, input.signal), geometry = await verifyStaticTargetGeometry(input, evidence, candidate);
      pairs.push({ target, segmentId: `part-${i}`, candidate, geometry });
    }
    const set = freezeConfirmedStaticTargetSet(pairs), run = { id: randomUUID() };
    const issued = await issueConfirmedTargetStaticProof(input, run, set, [...pairs].reverse());
    expect(issued.candidate.facts.targets).toHaveLength(2); expect(issued.proof.targets).toHaveLength(2);
    expect(() => checkConfirmedStaticProof(issued.candidate, issued.proof, issued.blobs)).not.toThrow();
    expect(KnowledgeCandidateSchema.safeParse(issued.candidate).success).toBe(true);
    await expect(issueConfirmedTargetStaticProof(input, run, set, pairs.slice(1))).rejects.toThrow(/incomplete/);
    await expect(issueConfirmedTargetStaticProof(input, run, set, [pairs[0], pairs[0]])).rejects.toThrow(/duplicated/);
    const omitted = structuredClone(issued.proof); omitted.targets.pop(); omitted.confirmedSetDigest = confirmedStaticSetDigest(omitted.targets);
    expect(() => checkConfirmedStaticProof(issued.candidate, omitted, issued.blobs)).toThrow(/set incomplete/);
    const omittedSegment = structuredClone(issued.candidate); omittedSegment.facts.targets[0].segments = [];
    expect(() => checkConfirmedStaticProof(omittedSegment, { ...issued.proof, factsDigest: factsDigest(omittedSegment.facts) }, issued.blobs)).toThrow(/set incomplete/);
    const duplicate = structuredClone(issued.candidate); duplicate.facts.targets[0].segments.push(structuredClone(duplicate.facts.targets[0].segments[0]));
    expect(KnowledgeCandidateSchema.safeParse(duplicate).success).toBe(false);
  }, 60000);
  it("rejects cancellation before append, stale engines, base conflicts and disputed reuse", async () => {
    const { input, target, evidence } = await fixture("geometry"), candidate = await extractStaticConservativeMask(evidence, input.signal);
    const geometry = await verifyStaticTargetGeometry(input, evidence, candidate), set = freezeConfirmedStaticTargetSet([{ target, segmentId: "segment" }]);
    const root = await mkdtemp(join(tmpdir(), "jianji-static-proof-fence-")); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const controller = new AbortController();
    let cancel = true;
    let store = await SourceStickerKnowledgeStore.open(root, { fault: at => { if (cancel && at === "after_evidence") controller.abort(); } }); cleanup.push(() => store.close());
    const run = await store.beginRun(input.source, controller.signal), issued = await issueConfirmedTargetStaticProof(input, run, set, [{ segmentId: "segment", candidate, geometry }]);
    await expect(store.publishConfirmedStaticTargets(run, issued.candidate, issued.proof, issued.blobs)).rejects.toThrow(/cancel/);
    await expect(store.readHead(input.source)).rejects.toThrow(/Interrupted/); await store.endRun(run); await store.close(); cancel = false;
    const interrupted = await SourceStickerKnowledgeStore.open(root);
    expect((await interrupted.lookup(input.source, issued.candidate.facts.reviewedRanges)).status).toBe("unusable"); await interrupted.close();
    const freshRoot = await mkdtemp(join(tmpdir(), "jianji-static-proof-conflict-")); cleanup.push(() => rm(freshRoot, { recursive: true, force: true }));
    store = await SourceStickerKnowledgeStore.open(freshRoot); cleanup.push(() => store.close());
    const next = await store.beginRun(input.source, input.signal);
    await expect(issueConfirmedTargetStaticProof({ ...input, ffmpeg: { ...input.ffmpeg, ffmpegPath: input.ffmpeg.ffprobePath } }, next, set, [{ segmentId: "segment", candidate, geometry }])).rejects.toThrow(/engine binding/);
    const bad = await issueConfirmedTargetStaticProof(input, next, set, [{ segmentId: "segment", candidate, geometry }], randomUUID());
    await expect(store.publishConfirmedStaticTargets(next, bad.candidate, bad.proof, bad.blobs)).rejects.toThrow(/changed|conflict|base/i);
    const fresh = await issueConfirmedTargetStaticProof(input, next, set, [{ segmentId: "segment", candidate, geometry }]);
    const revision = await store.publishConfirmedStaticTargets(next, fresh.candidate, fresh.proof, fresh.blobs);
    await store.recordDispute(next, { schemaVersion: 1, id: "observed", revisionId: revision.id, ranges: fresh.candidate.facts.reviewedRanges,
      kind: "incomplete_boundary", reason: "original source boundary objection", evidence: fresh.candidate.evidence.filter(e => e.kind === "source"), at: new Date().toISOString() }, fresh.blobs);
    expect((await store.lookup(input.source, fresh.candidate.facts.reviewedRanges)).status).toBe("disputed");
    await store.endRun(next);
  }, 30000);
  it("keeps an unsampled geometry contradiction in the full-range owned evidence", async () => {
    const { input, evidence } = await fixture("geometry-move"), candidate = await extractStaticConservativeMask(evidence, input.signal);
    const geometry = await verifyStaticTargetGeometry(input, evidence, candidate);
    expect(geometry.receipt.status).toBe("INCOMPLETE_GEOMETRY_CONTRADICTION_OR_UNRESOLVED");
    expect(geometry.receipt.issueFrames).toContain(15); expect(geometry.receipt.frameCount).toBe(30);
    const set = freezeConfirmedStaticTargetSet([{ target: evidence.target, segmentId: "segment" }]);
    await expect(issueConfirmedTargetStaticProof(input, { id: randomUUID() }, set, [{ segmentId: "segment", candidate, geometry }])).rejects.toThrow(/unsupported geometry/);
  }, 30000);
  it("allows only the explicit historical RGB signal with owned supported geometry", async () => {
    const { input, target, evidence } = await fixture("geometry-rgb"), set = freezeConfirmedStaticTargetSet([{ target, segmentId: "segment" }]);
    const candidate = await extractStaticConservativeMask(evidence, input.signal), geometry = await verifyStaticTargetGeometry(input, evidence, candidate);
    expect(candidate.receipt.status).toBe("INCOMPLETE"); expect(candidate.receipt.reasons).toEqual(["FULL_RANGE_STATIC_CONTRADICTION"]);
    expect(candidate.receipt.anomalies.map(a => a.index)).toEqual([15]);
    expect(geometry.receipt.status).toBe("DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED");
    expect(classifyStaticCandidateForProof(candidate.receipt)).toBe("HISTORICAL_RGB_SIGNAL");
    const run = { id: randomUUID() }, issued = await issueConfirmedTargetStaticProof(input, run, set, [{ segmentId: "segment", candidate, geometry }]);
    const artifact = JSON.parse(issued.blobs.get(issued.proof.targets[0].artifacts.extraction)!.toString());
    expect(artifact.anomalies).toEqual(candidate.receipt.anomalies); expect(artifact.status).toBe("INCOMPLETE");
    await expect(issueConfirmedTargetStaticProof(input, run, set, [{ segmentId: "segment", candidate, geometry: { receipt: geometry.receipt } }])).rejects.toThrow(/unowned/);
    for (const reason of ["TARGET_NOT_SEPARABLE", "STABLE_COMPONENT_EXTENT_UNRESOLVED", "CONSERVATIVE_MARGIN_EXTENT_UNRESOLVED", "INSUFFICIENT_ORIGINAL_REPRESENTATIVES", "unknown"])
      expect(() => classifyStaticCandidateForProof({ ...candidate.receipt, reasons: [...candidate.receipt.reasons, reason] })).toThrow();
  }, 30000);
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
