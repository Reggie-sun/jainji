import { describe, expect, it } from "vitest";
import {
  parseShapeCoverReviewObservation,
  verifyShapeCoverAdmission,
  type ShapeCoverAdmission,
} from "../src/main/shape-cover-admission";

const safetyPass = {
  action: "pass",
  reason: "observed with complete review evidence",
  contentSafety: { face: "SAFE", hands: "SAFE", product: "SAFE", subtitles: "SAFE" },
  naturalness: { verdict: "NATURAL", reason: "sample appears natural" },
  evidenceIds: ["source-frame-1", "preview-frame-1"],
};

describe("shape cover review observations", () => {
  it("parses complete safety observations as frozen, non-authoritative data", () => {
    const observation = parseShapeCoverReviewObservation(JSON.stringify(safetyPass));

    expect(observation).toEqual({
      purpose: "shape-cover-review-observation/v1",
      authority: "none",
      eligible: false,
      decision: safetyPass,
    });
    expect(Object.isFrozen(observation)).toBe(true);
    expect(Object.isFrozen(observation.decision)).toBe(true);
    if (observation.decision.action === "pass") {
      expect(Object.isFrozen(observation.decision.contentSafety)).toBe(true);
      expect(Object.isFrozen(observation.decision.naturalness)).toBe(true);
      expect(Object.isFrozen(observation.decision.evidenceIds)).toBe(true);
    }

    const notSafe = parseShapeCoverReviewObservation(JSON.stringify({
      ...safetyPass,
      contentSafety: { ...safetyPass.contentSafety, face: "UNKNOWN" },
      naturalness: { verdict: "UNNATURAL", reason: "edge is conspicuous" },
    }));
    expect(notSafe.decision).toMatchObject({ contentSafety: { face: "UNKNOWN" }, naturalness: { verdict: "UNNATURAL" } });
  });

  it("parses inspection and stop decisions through the existing supervisor contract", () => {
    expect(parseShapeCoverReviewObservation(JSON.stringify({ action: "inspect", reason: "need another view", requests: [{ timeMs: 10 }] })))
      .toMatchObject({ authority: "none", eligible: false, decision: { action: "inspect" } });
    expect(parseShapeCoverReviewObservation(JSON.stringify({ action: "stop", reason: "uncertain source" })))
      .toMatchObject({ authority: "none", eligible: false, decision: { action: "stop" } });
  });

  it.each([
    "not-json",
    JSON.stringify({ action: "pass", reason: "bare pass" }),
    JSON.stringify({ ...safetyPass, naturalness: undefined }),
    JSON.stringify({ ...safetyPass, contentSafety: { face: "SAFE", hands: "SAFE", product: "SAFE" } }),
    JSON.stringify({ ...safetyPass, admission: {} }),
    JSON.stringify({ ...safetyPass, authority: "PASS" }),
    JSON.stringify({ action: "inspect", reason: "need another view", requests: [], eligible: true }),
    JSON.stringify({ action: "revise", reason: "change a frozen shape", tracks: [] }),
  ])("rejects malformed decisions and any review authority fields: %s", raw => {
    expect(() => parseShapeCoverReviewObservation(raw)).toThrow();
  });

  it("does not let an observation or its JSON clone pass the production admission-handle check", async () => {
    const observation = parseShapeCoverReviewObservation(JSON.stringify(safetyPass));
    const restored = JSON.parse(JSON.stringify(observation)) as unknown;
    const verify = (value: unknown) => verifyShapeCoverAdmission(value as ShapeCoverAdmission, {} as never, {} as never, {} as never, "/unused");

    await expect(verify(observation)).rejects.toThrow("UNSAFE");
    await expect(verify(restored)).rejects.toThrow("UNSAFE");
  });
});
