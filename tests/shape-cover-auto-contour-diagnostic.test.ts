import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAutoContourDevelopment } from "../scripts/shape-cover-auto-contour-diagnostic";
import { contourEvidence, packedTruth, TARGET_A, TARGET_B } from "./helpers/auto-contour-evidence";

let fixture: Awaited<ReturnType<typeof contourEvidence>>;
beforeAll(async () => { fixture = await contourEvidence(); }, 30000);
afterAll(async () => { await fixture?.close(); });
const manifest = () => ({ purpose: "AUTO_CONTOUR_DEVELOPMENT_ONLY", declarationOrigin: "UNQUALIFIED_ENGINEERING_DECLARATIONS",
  sourcePath: fixture.sourcePath, source: fixture.evidence.census.source, ffmpeg: fixture.ffmpeg,
  range: { startFrame: 0, endFrame: 6 }, declarations: fixture.declarations });

describe("author-side auto-contour diagnostic", { timeout: 30000 }, () => {
  it("records both actual methods and explicit incomplete live layers without a preset mask or sticker", async () => {
    const directory = join(fixture.root, "development");
    const report = await runAutoContourDevelopment(manifest(), directory, new AbortController().signal);
    expect(report).toMatchObject({ purpose: "AUTO_CONTOUR_DEVELOPMENT_ONLY", authority: "none", eligible: false, production: "PRODUCT_DISABLED",
      selectedMethod: null, qualifiedExtractor: null, modelRequests: 0, productionHandle: null, formalQualification: "INCOMPLETE" });
    expect(report.methods.map(m => m.status)).toEqual(["CANDIDATE", "INCOMPLETE"]);
    expect(report.methods.map(m => m.comparison)).toEqual([
      { status: "INCOMPLETE", maskReview: "NOT_EVALUATED", motionReview: "NOT_EVALUATED", metrics: null },
      { status: "INCOMPLETE", maskReview: "NOT_EVALUATED", motionReview: "NOT_EVALUATED", metrics: null },
    ]);
    const candidate = JSON.parse(await readFile(join(directory, "method-0-candidate.json"), "utf8"));
    expect(candidate.targets[0].frames[5].mask.markedPixels).toBe(7);
    const saved = await readFile(join(directory, "result.json"));
    await expect(runAutoContourDevelopment(manifest(), directory, new AbortController().signal)).rejects.toThrow();
    expect(await readFile(join(directory, "result.json"))).toEqual(saved);
  });

  it("freezes independent controlled construction before comparing either method", async () => {
    const truthSet = { scope: "CONTROLLED_CONSTRUCTION", authorId: "construction-author", reviewerId: "independent-construction-checker",
      targets: [TARGET_A, TARGET_B].map(targetId => ({ targetId, frames: fixture.evidence.census.frames.map(binding => {
        const pixels = targetId === TARGET_A ? fixture.pixels[binding.index] : [20 * 32 + 20];
        return { binding, state: pixels.length ? "VISIBLE" : "NOT_VISIBLE", mask: packedTruth(pixels), reason: null,
          motion: targetId === TARGET_A ? "STATIONARY_ANIMATION" : "STATIC" };
      }) })) };
    const report = await runAutoContourDevelopment({ ...manifest(), truthSet }, join(fixture.root, "controlled-comparison"), new AbortController().signal);
    expect(report.methods[0].comparison).toMatchObject({ status: "DEVELOPMENT_MATCH", authority: "none", eligible: false });
    expect(report.methods[1].comparison).toMatchObject({ status: "INCOMPLETE", authority: "none", eligible: false });
    expect(report.selectedMethod).toBeNull();
  });

  it("rejects injected extractor masks, production claims, bad frame identity and cancellation", async () => {
    for (const extra of [{ mask: packedTruth(fixture.pixels[0]) }, { qualified: true }, { candidateId: "preset-star" }]) {
      await expect(runAutoContourDevelopment({ ...manifest(), ...extra }, join(fixture.root, "rejected"), new AbortController().signal)).rejects.toThrow();
    }
    const declarations = structuredClone(fixture.declarations); declarations[5].binding.pixelSha256 = "0".repeat(64);
    const directory = join(fixture.root, "invalid-binding");
    await expect(runAutoContourDevelopment({ ...manifest(), declarations }, directory, new AbortController().signal)).rejects.toThrow(/UNSAFE/);
    expect(JSON.parse(await readFile(join(directory, "failure.json"), "utf8"))).toMatchObject({ status: "INCOMPLETE", modelRequests: 0, authority: "none", eligible: false });
    const controller = new AbortController(); controller.abort();
    await expect(runAutoContourDevelopment(manifest(), join(fixture.root, "cancelled"), controller.signal)).rejects.toThrow();
  });

  it("does not issue an envelope after independently known moving-target acceptance", async () => {
    const truthSet = { scope: "CONTROLLED_CONSTRUCTION", authorId: "construction-author", reviewerId: "independent-construction-checker",
      targets: [TARGET_A, TARGET_B].map(targetId => ({ targetId, frames: fixture.evidence.census.frames.map(binding => {
        const pixels = targetId === TARGET_A ? fixture.pixels[binding.index] : [20 * 32 + 20];
        return { binding, state: pixels.length ? "VISIBLE" : "NOT_VISIBLE", mask: packedTruth(pixels), reason: null,
          motion: targetId === TARGET_A ? "MOVING" : "STATIC" };
      }) })) };
    const report = await runAutoContourDevelopment({ ...manifest(), truthSet }, join(fixture.root, "known-moving"), new AbortController().signal);
    expect(report.methods[0].comparison).toMatchObject({ status: "NOT_QUALIFIED", failures: expect.arrayContaining([
      expect.objectContaining({ code: "MOVING_TARGET_ACCEPTED", targetId: TARGET_A }),
    ]) });
    expect(report.methods[0].envelopes).toEqual([]);
    expect(report.productionHandle).toBeNull();
  });
});
