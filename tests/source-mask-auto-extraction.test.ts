import { utimes } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AUTO_CONTOUR_CONFIG, AUTO_CONTOUR_LIMITS, extractAutomaticSourceContours, buildAutomaticContourEnvelope, assertOwnedAutomaticContours } from "../src/main/source-mask-auto-extraction";
import { readStationaryEnvelopeMask } from "../src/main/shape-cover-stationary-envelope";
import { contourEvidence, contourHash, packedTruth, TARGET_A, TARGET_B } from "./helpers/auto-contour-evidence";

let fixture: Awaited<ReturnType<typeof contourEvidence>>;
beforeAll(async () => { fixture = await contourEvidence(); }, 30000);
afterAll(async () => { await fixture?.close(); });
const input = () => ({ evidence: fixture.evidence, declarations: fixture.declarations, config: AUTO_CONTOUR_CONFIG, signal: new AbortController().signal });

describe("automatic contours remain development candidates", { timeout: 30000 }, () => {
  it("fixes the initial support envelope without source or production authority", () => {
    expect(AUTO_CONTOUR_CONFIG.support).toBe("controlled-uniform-exterior-development/v1");
    expect(AUTO_CONTOUR_CONFIG.method).toBe("per-frame-exterior-difference/v1");
    expect(typeof extractAutomaticSourceContours).toBe("function");
  });

  it("extracts every original ordinal, thin low-contrast tip, blink and final expansion without a mask input", async () => {
    const candidate = await extractAutomaticSourceContours(input());
    expect(candidate.receipt).toMatchObject({ method: "auto-source-contour-candidate/v1", status: "CANDIDATE", authority: "none", eligible: false,
      maskReview: "NOT_EVALUATED", motionReview: "NOT_EVALUATED", censusDigest: fixture.evidence.census.censusDigest });
    const frames = candidate.receipt.targets.find(t => t.targetId === TARGET_A)!.frames;
    expect(frames.map(f => f.binding.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(frames.map(f => f.mask)).toEqual(fixture.pixels.map(p => packedTruth(p)));
    expect(frames[2]).toMatchObject({ state: "NOT_VISIBLE", mask: null });
    expect(frames[5].mask?.markedPixels).toBe(7);
    expect(candidate.receipt.targets.map(t => t.targetId)).toEqual([TARGET_A, TARGET_B]);
    const { receiptDigest, ...body } = candidate.receipt;
    expect(receiptDigest).toBe(contourHash(JSON.stringify(body)));
    expect(Object.isFrozen(frames[0].mask?.bbox)).toBe(true);
    const envelope = await buildAutomaticContourEnvelope(candidate, TARGET_A, new AbortController().signal);
    expect(envelope.receipt.union.markedPixels).toBe(7);
    expect(readStationaryEnvelopeMask(envelope)[6 * 32 + 8]).toBe(1);
    expect(envelope.receipt.motionReview).toBe("NOT_EVALUATED");
  });

  it("keeps the temporal baseline separate and exposes its final-frame omissions", async () => {
    const candidate = await extractAutomaticSourceContours({ ...input(), config: { ...AUTO_CONTOUR_CONFIG, method: "temporal-stable-exterior-difference/v1" } });
    const frames = candidate.receipt.targets.find(t => t.targetId === TARGET_A)!.frames;
    expect(candidate.receipt.status).toBe("INCOMPLETE");
    expect(frames.some(f => f.state === "UNKNOWN")).toBe(true);
    await expect(buildAutomaticContourEnvelope(candidate, TARGET_A, new AbortController().signal)).rejects.toThrow(/UNSAFE/);
  });

  it.each([0, 2, 5])("rejects a missing ordinal %s before reading extraction frames", async index => {
    await expect(extractAutomaticSourceContours({ ...input(), declarations: fixture.declarations.filter((_, i) => i !== index) })).rejects.toThrow(/UNSAFE/);
  });

  it.each(["index", "pts", "endPts", "byteLength", "pixelSha256"] as const)("rejects tampered %s bindings", async field => {
    const declarations = structuredClone(fixture.declarations);
    (declarations[5].binding as Record<string, unknown>)[field] = field === "pixelSha256" ? "0".repeat(64) : Number(declarations[5].binding[field]) + 1;
    await expect(extractAutomaticSourceContours({ ...input(), declarations })).rejects.toThrow(/UNSAFE/);
  });

  it("rejects duplicate ordinals, injected masks, moving, oversized and changed identities", async () => {
    await expect(extractAutomaticSourceContours({ ...input(), declarations: [...fixture.declarations, fixture.declarations[0]] })).rejects.toThrow(/UNSAFE/);
    const declarations = structuredClone(fixture.declarations);
    Object.assign(declarations[0].declaration.targets[0], { mask: packedTruth(fixture.pixels[0]) });
    await expect(extractAutomaticSourceContours({ ...input(), declarations })).rejects.toThrow(/UNSAFE/);
    for (const change of [{ category: "moving" }, { description: "another identity" }, { bbox: { x: 0, y: 0, width: 513, height: 1 } }]) {
      const changed = structuredClone(fixture.declarations); Object.assign(changed[5].declaration.targets[0], change);
      await expect(extractAutomaticSourceContours({ ...input(), declarations: changed })).rejects.toThrow(/UNSAFE/);
    }
  });

  it("never treats ambiguous borders, target-free rectangles or changed static masks as success", async () => {
    const ambiguous = await contourEvidence("ambiguous");
    try {
      const candidate = await extractAutomaticSourceContours({ ...input(), evidence: ambiguous.evidence, declarations: ambiguous.declarations });
      expect(candidate.receipt.status).toBe("INCOMPLETE");
      expect(candidate.receipt.targets[0].frames[0]).toMatchObject({ state: "UNKNOWN", mask: null, reason: "EXTERIOR_NOT_UNIFORM" });
      await expect(buildAutomaticContourEnvelope(candidate, TARGET_A, new AbortController().signal)).rejects.toThrow(/UNSAFE/);
    } finally { await ambiguous.close(); }
    const declarations = structuredClone(fixture.declarations);
    declarations.forEach(d => d.declaration.targets.forEach(t => { if (t.id === TARGET_A) t.category = "static"; }));
    const candidate = await extractAutomaticSourceContours({ ...input(), declarations });
    expect(candidate.receipt.status).toBe("INCOMPLETE");
    expect(candidate.receipt.targets[0].frames.some(f => f.reason === "STATIC_VISIBILITY_OR_CONTOUR_CHANGED")).toBe(true);
  });

  it("rejects copied ownership, captures inputs and cancels pending evidence work", async () => {
    const candidate = await extractAutomaticSourceContours(input());
    expect(() => assertOwnedAutomaticContours(JSON.parse(JSON.stringify(candidate)))).toThrow(/UNSAFE/);
    await expect(extractAutomaticSourceContours({ ...input(), evidence: { ...fixture.evidence } })).rejects.toThrow(/UNSAFE/);
    const declarations = structuredClone(fixture.declarations);
    const pending = extractAutomaticSourceContours({ ...input(), declarations });
    declarations[0].binding.pixelSha256 = "0".repeat(64);
    expect((await pending).receipt.status).toBe("CANDIDATE");
    const controller = new AbortController();
    const cancelled = extractAutomaticSourceContours({ ...input(), signal: controller.signal });
    queueMicrotask(() => controller.abort());
    await expect(cancelled).rejects.toThrow(/UNSAFE/);
  });

  it("keeps UNKNOWN explicit and never creates a usable envelope from missing identification", async () => {
    const declarations = fixture.declarations.map(d => ({ binding: d.binding, declaration: d.binding.index === 5
      ? { ordinal: 5, type: "UNKNOWN" as const, reason: "ambiguous identification" } : d.declaration }));
    const candidate = await extractAutomaticSourceContours({ ...input(), declarations });
    expect(candidate.receipt.targets.every(t => t.frames[5].state === "UNKNOWN" && t.frames[5].mask === null)).toBe(true);
    expect(candidate.receipt.status).toBe("INCOMPLETE");
    expect(candidate.receipt.declarations[5].declaration.type).toBe("UNKNOWN");
    await expect(buildAutomaticContourEnvelope(candidate, TARGET_A, new AbortController().signal)).rejects.toThrow(/UNSAFE/);
  });

  it("revokes closed evidence and rejects a changed source generation", async () => {
    const local = await contourEvidence("static");
    try {
      const candidate = await extractAutomaticSourceContours({ ...input(), evidence: local.evidence, declarations: local.declarations });
      const future = new Date(Date.now() + 10000); await utimes(local.sourcePath, future, future);
      await expect(buildAutomaticContourEnvelope(candidate, TARGET_A, new AbortController().signal)).rejects.toThrow(/UNSAFE/);
      await local.evidence.close();
      expect(() => assertOwnedAutomaticContours(candidate)).toThrow(/UNSAFE/);
    } finally { await local.close(); }
  });

  it("interrupts the D1 wall deadline without publishing a late candidate", async () => {
    vi.useFakeTimers();
    try {
      const pending = extractAutomaticSourceContours(input());
      const rejected = expect(pending).rejects.toThrow(/wall budget/);
      await vi.advanceTimersByTimeAsync(AUTO_CONTOUR_LIMITS.wallMs);
      await rejected;
    } finally { vi.useRealTimers(); }
  });
});
