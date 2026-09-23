import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { KnowledgeCandidateSchema, SourceIdentitySchema, coversRanges, sourceGeometryChanged, sourceObservationsChanged, type SourceFacts } from "../src/shared/source-sticker-knowledge";

const digest = "a".repeat(64);
const source = { fingerprint: `sha256:${digest}`, byteLength: 100, width: 720, height: 1280, rotation: 0, durationMs: 10000, timeBase: "1/90000", timeOriginPts: 0, interpretationVersion: 1 };
const evidence = { id: "frame", kind: "source", digest, byteLength: 5, pts: 0, timeMs: 0, width: 720, height: 1280 };
const facts = { reviewedRanges: [{ startMs: 0, endMs: 3000 }], targets: [], exclusions: [], observations: [{ evidenceId: "frame", presence: "ABSENT" }], samplingStrategy: "timed-full-frames-v1" };
const candidate = { schemaVersion: 1, id: "candidate", state: "candidate", source, baseRevisionId: null, runId: "run", requiredRanges: facts.reviewedRanges, facts, evidence: [evidence], resolvedDisputeIds: [], changes: [], provenance: { executor: "test/model", supervisor: "test/model", contractVersion: 1, requests: 2, at: "2026-09-17T00:00:00Z" } };

describe("source sticker knowledge contract", () => {
  it("treats changed mask pixels as a source geometry revision within the disputed range", () => {
    const rectangle = { x: 0.1, y: 0.1, width: 0.1, height: 0.1 };
    const mask = { kind: "static-binary-v1" as const, bbox: { x: 72, y: 128, width: 3, height: 3 }, encoding: "bitpack-lsb-row-major-v1" as const,
      dataBase64: "CAA=", sha256: digest, markedPixels: 1, creation: { method: "probe", version: 1 },
      review: { method: "contact-sheet", version: 1, reviewer: "codex", at: "2026-09-24T00:00:00Z" }, evidenceIds: ["frame", "later"] };
    const before: SourceFacts = { ...facts, observations: [], targets: [{ id: "sticker", segments: [{ id: "segment", track: { startMs: 0, endMs: 3000, keyframes: [{ timeMs: 0, rectangle }] }, evidenceIds: ["frame", "later"], interpolation: "linear", mask }] }] };
    const after = structuredClone(before);
    expect(sourceGeometryChanged(before, after, [{ startMs: 0, endMs: 3000 }], "sticker")).toBe(false);
    after.targets[0].segments[0].mask!.sha256 = "b".repeat(64);
    expect(sourceGeometryChanged(before, after, [{ startMs: 0, endMs: 3000 }], "sticker")).toBe(true);
    expect(sourceGeometryChanged(before, after, [{ startMs: 3000, endMs: 4000 }], "sticker")).toBe(false);
    expect(sourceObservationsChanged(before, after, [0])).toBe(false);
  });
  it("binds a bounded static source-pixel mask to two original PTS inside its segment", () => {
    const rectangle = { x: 0.1, y: 0.1, width: 0.1, height: 0.1 };
    const later = { ...evidence, id: "later", pts: 180000, timeMs: 2000 };
    const bytes = Buffer.from([255, 1]);
    const mask = {
      kind: "static-binary-v1", bbox: { x: 72, y: 128, width: 3, height: 3 },
      encoding: "bitpack-lsb-row-major-v1", dataBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"), markedPixels: 9,
      creation: { method: "temporal-stability", version: 1 },
      review: { method: "contact-sheet", version: 1, reviewer: "codex", at: "2026-09-24T00:00:00Z" },
      evidenceIds: ["frame", "later"],
    };
    const segment = { id: "segment", track: { startMs: 0, endMs: 3000, keyframes: [{ timeMs: 0, rectangle }] }, evidenceIds: ["frame", "later"], interpolation: "linear", mask };
    const factsWithMask = { ...facts, targets: [{ id: "sticker", segments: [segment] }], observations: [
      { evidenceId: "frame", targetId: "sticker", presence: "PRESENT", rectangle },
      { evidenceId: "later", targetId: "sticker", presence: "PRESENT", rectangle },
    ] };
    const value = { ...candidate, facts: factsWithMask, evidence: [evidence, later] };
    expect(KnowledgeCandidateSchema.safeParse(value).success).toBe(true);
    for (const badMask of [
      { ...mask, bbox: { ...mask.bbox, x: 719 } },
      { ...mask, bbox: { ...mask.bbox, width: 513 } },
      { ...mask, evidenceIds: ["frame", "missing"] },
      { ...mask, evidenceIds: ["frame", "frame"] },
      { ...mask, dataBase64: "AAAA" },
    ]) expect(KnowledgeCandidateSchema.safeParse({ ...value, facts: { ...factsWithMask, targets: [{ id: "sticker", segments: [{ ...segment, mask: badMask }] }] } }).success).toBe(false);
    expect(KnowledgeCandidateSchema.safeParse({ ...value, facts: { ...factsWithMask, targets: [{ id: "sticker", segments: [{ ...segment, track: { ...segment.track, keyframes: [...segment.track.keyframes, { timeMs: 2000, rectangle }] } }] }] } }).success).toBe(false);
    expect(KnowledgeCandidateSchema.safeParse({ ...value, evidence: [evidence, { ...later, width: 360, height: 640 }] }).success).toBe(false);
    expect(KnowledgeCandidateSchema.safeParse({ ...value, facts: { ...factsWithMask, targets: [{ id: "sticker", segments: [{ ...segment, mask: { ...mask, dataBase64: "A".repeat(43696) } }] }] } }).success).toBe(false);
  });
  it("compares fresh recognition only at observed times, ignoring window-tail interpolation and local labels", () => {
    const moving = (id: string, endMs: number, points: number[][]): SourceFacts => ({ ...facts, observations: [], targets: [{ id, segments: [{ id: "segment", interpolation: "linear", evidenceIds: ["frame"], track: { startMs: 0, endMs, keyframes: points.map(([timeMs, x]) => ({ timeMs, rectangle: { x, y: 0, width: 0.1, height: 0.1 } })) } }] }] });
    const previous = moving("old-label", 3000, [[0, 0.1], [1750, 0.275], [2000, 0.3]]);
    const window = moving("new-label", 1751, [[0, 0.1], [1750, 0.275]]);
    expect(sourceObservationsChanged(previous, window, [0, 1750])).toBe(false);
    window.targets[0].segments[0].track.keyframes[1].rectangle.x = 0.4;
    expect(sourceObservationsChanged(previous, window, [0, 1750])).toBe(true);
    expect(sourceObservationsChanged(previous, { ...window, targets: [] }, [0])).toBe(true);
  });

  it("requires byte identity and a complete decoding interpretation, without paths or styling", () => {
    expect(SourceIdentitySchema.safeParse(source).success).toBe(true);
    for (const invalid of [{ ...source, fingerprint: "filename.mp4" }, { ...source, byteLength: 0 }, { ...source, path: "/video.mp4" }, { ...source, timeBase: "0/0" }]) expect(SourceIdentitySchema.safeParse(invalid).success).toBe(false);
    expect(KnowledgeCandidateSchema.safeParse({ ...candidate, price: "10元" }).success).toBe(false);
  });

  it("requires explicit coverage and original evidence even for no targets", () => {
    expect(KnowledgeCandidateSchema.safeParse(candidate).success).toBe(true);
    for (const patch of [{ reviewedRanges: [] }, { observations: [] }, { observations: [{ evidenceId: "missing", presence: "ABSENT" }] }, { reviewedRanges: [{ startMs: 0, endMs: 10001 }] }]) expect(KnowledgeCandidateSchema.safeParse({ ...candidate, facts: { ...facts, ...patch } }).success).toBe(false);
    expect(KnowledgeCandidateSchema.safeParse({ ...candidate, evidence: [] }).success).toBe(false);
  });

  it("does not turn partial coverage or gaps into full coverage", () => {
    expect(coversRanges(facts.reviewedRanges, [{ startMs: 0, endMs: 10000 }])).toBe(false);
    expect(coversRanges([{ startMs: 0, endMs: 10000 }], facts.reviewedRanges)).toBe(true);
    expect(coversRanges([{ startMs: 0, endMs: 1000 }, { startMs: 2000, endMs: 3000 }], facts.reviewedRanges)).toBe(false);
    expect(coversRanges([{ startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 3000 }], facts.reviewedRanges)).toBe(true);
  });

  it("uses existing geometry, track ratio and keyframe order rules; forbids interpolation across absence", () => {
    const track = { startMs: 0, endMs: 3000, keyframes: [{ timeMs: 0, rectangle: { x: 0, y: 0, width: 0.1, height: 0.1 } }] };
    const withTarget = { ...candidate, facts: { ...facts, targets: [{ id: "sticker", segments: [{ id: "segment", track, evidenceIds: ["frame"], interpolation: "linear" }] }], observations: [{ evidenceId: "frame", targetId: "sticker", presence: "PRESENT", rectangle: track.keyframes[0].rectangle }] } };
    expect(KnowledgeCandidateSchema.safeParse(withTarget).success).toBe(true);
    const invalid = structuredClone(withTarget);
    invalid.facts.targets[0].segments[0].track.keyframes[0].rectangle.x = 1;
    expect(KnowledgeCandidateSchema.safeParse(invalid).success).toBe(false);
    expect(KnowledgeCandidateSchema.safeParse({ ...withTarget, facts: { ...withTarget.facts, observations: [{ evidenceId: "frame", targetId: "sticker", presence: "ABSENT" }] } }).success).toBe(false);
  });

  it("rejects future contracts and manual/assisted provenance", () => {
    for (const patch of [{ schemaVersion: 2 }, { mode: "manual" }, { reviewDrafts: [] }, { provenance: { ...candidate.provenance, humanApproval: true } }]) expect(KnowledgeCandidateSchema.safeParse({ ...candidate, ...patch }).success).toBe(false);
  });

  it("requires present evidence inside each segment and rejects global absence conflicts", () => {
    const rectangle = { x: 0, y: 0, width: 0.1, height: 0.1 };
    const withTarget = { ...candidate, facts: { ...facts, targets: [{ id: "sticker", segments: [{ id: "segment", track: { startMs: 1000, endMs: 2000, keyframes: [{ timeMs: 1000, rectangle }] }, evidenceIds: ["frame"], interpolation: "linear" }] }], observations: [{ evidenceId: "frame", targetId: "sticker", presence: "PRESENT", rectangle }] } };
    expect(KnowledgeCandidateSchema.safeParse(withTarget).success).toBe(false);
    withTarget.facts.targets[0].segments[0].track.startMs = 0;
    expect(KnowledgeCandidateSchema.safeParse(withTarget).success).toBe(true);
    expect(KnowledgeCandidateSchema.safeParse({ ...withTarget, facts: { ...withTarget.facts, observations: [...withTarget.facts.observations, { evidenceId: "frame", presence: "ABSENT" }] } }).success).toBe(false);
  });

  it("keeps decoded PTS for VFR pairs and full-frame scaling/crop mappings", () => {
    const scaled = { ...candidate, evidence: [{ ...evidence, width: 360, height: 640 }] };
    expect(KnowledgeCandidateSchema.safeParse(scaled).success).toBe(true);
    const pair = { id: "preview", kind: "preview", digest, byteLength: 5, pts: 1, timeBase: "1/30", timeOriginPts: 0, timeMs: 1000 / 30, width: 720, height: 1280, sourceEvidenceId: "frame", candidateId: "candidate", factsDigest: digest, templateDigest: digest, outputSettingsDigest: digest };
    expect(KnowledgeCandidateSchema.safeParse({ ...candidate, evidence: [evidence, pair] }).success).toBe(true);
    expect(KnowledgeCandidateSchema.safeParse({ ...candidate, evidence: [evidence, { ...pair, timeMs: 999 }] }).success).toBe(false);
    expect(KnowledgeCandidateSchema.safeParse({ ...candidate, evidence: [evidence, { ...pair, pts: 30, timeMs: 1000 }] }).success).toBe(false);
    const crop = { ...evidence, id: "crop", width: 72, height: 128, crop: { sourceEvidenceId: "frame", rectangle: { x: 0, y: 0, width: 0.1, height: 0.1 } } };
    expect(KnowledgeCandidateSchema.safeParse({ ...candidate, evidence: [evidence, crop] }).success).toBe(true);
    expect(KnowledgeCandidateSchema.safeParse({ ...candidate, evidence: [evidence, { ...crop, pts: 90 }] }).success).toBe(false);
  });

  it("rejects contradictory observed geometry and present observations outside all segments", () => {
    const rectangle = { x: 0, y: 0, width: 0.1, height: 0.1 };
    const value = { ...candidate, facts: { ...facts, targets: [{ id: "sticker", segments: [{ id: "segment", track: { startMs: 0, endMs: 1000, keyframes: [{ timeMs: 0, rectangle: { ...rectangle, x: 0.8 } }] }, evidenceIds: ["frame"], interpolation: "linear" }] }], observations: [{ evidenceId: "frame", targetId: "sticker", presence: "PRESENT", rectangle }] } };
    expect(KnowledgeCandidateSchema.safeParse(value).success).toBe(false);
    value.facts.targets[0].segments[0].track.keyframes[0].rectangle.x = 0;
    expect(KnowledgeCandidateSchema.safeParse(value).success).toBe(true);
    const outside = { ...evidence, id: "outside", pts: 180000, timeMs: 2000 };
    expect(KnowledgeCandidateSchema.safeParse({ ...value, evidence: [evidence, outside], facts: { ...value.facts, observations: [...value.facts.observations, { evidenceId: "outside", targetId: "sticker", presence: "PRESENT", rectangle }] } }).success).toBe(false);
  });
});
