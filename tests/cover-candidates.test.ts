import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { analyzeCoverCandidates } from "../src/main/cover-candidates";
import type { CoverReviewMedia } from "../src/shared/cover-review";

function media(): CoverReviewMedia {
  const evidence = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000].map((timeMs) => ({ id: randomUUID(), relativePath: `${randomUUID()}/r-0/${timeMs}.png`, digest: "a".repeat(64), pts: timeMs, timeBase: 0.001, width: 100, height: 50, rotation: 0 as const, transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 } }));
  return { mediaId: randomUUID(), sourceFingerprint: "fixture", durationMs: 3000, analysis: "not_started", disposition: "unresolved", identities: [], segments: [], evidence, observations: [], issues: [], decisions: [] };
}

const rectangle = { x: 0.1, y: 0.1, width: 0.2, height: 0.1 };

describe("cover candidates", () => {
  it("uses overlapping bounded detector windows and records candidates as sampled observations", async () => {
    const source = media();
    const images = source.evidence.map((item) => ({ timeMs: Math.round(item.pts * item.timeBase * 1000), url: "data:image/jpeg;base64,AA==" }));
    const detect = vi.fn(async (window: readonly typeof images[number][]) => window.map((image) => ({ timeMs: image.timeMs, targets: image.timeMs === 250 ? [] : [{ id: "badge", rectangle }] })));
    const onRequest = vi.fn();

    const result = await analyzeCoverCandidates(source, images, detect, new AbortController().signal, onRequest);

    expect(detect.mock.calls.map(([window]) => window.map((item: { timeMs: number }) => item.timeMs))).toEqual([[0, 250, 500, 750, 1000, 1250, 1500, 1750], [1750, 2000]]);
    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(result.analysis).toBe("complete");
    expect(result.observations.some((item) => item.presence === "ABSENT")).toBe(false);
    expect(result.observations.some((item) => item.presence === "UNKNOWN")).toBe(true);
    expect(result.segments).toHaveLength(0);
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "uncertain_presence" }));
  });

  it("keeps completed observations but marks a detector failure incomplete without exposing its error", async () => {
    const source = media();
    const images = source.evidence.slice(0, 2).map((item) => ({ timeMs: Math.round(item.pts * item.timeBase * 1000), url: "data:image/jpeg;base64,AA==" }));
    const detect = vi.fn().mockRejectedValue(new Error("Bearer secret-token"));

    const result = await analyzeCoverCandidates(source, images, detect, new AbortController().signal);

    expect(result.analysis).toBe("incomplete");
    expect(result.analysisError).not.toContain("secret-token");
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "insufficient_evidence", origin: "local" }));
  });

  it("turns invalid detector geometry into incomplete evidence rather than losing the draft", async () => {
    const source = media();
    const images = source.evidence.slice(0, 1).map((item) => ({ timeMs: Math.round(item.pts * item.timeBase * 1000), url: "data:image/jpeg;base64,AA==" }));
    const result = await analyzeCoverCandidates(source, images, async () => [{ timeMs: 0, targets: [{ id: "bad", rectangle: { x: 0.9, y: 0, width: 0.2, height: 0.1 } }] }] as any, new AbortController().signal);
    expect(result.analysis).toBe("incomplete");
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "insufficient_evidence" }));
  });

  it("does not dispatch a detector request when persisting its request count fails", async () => {
    const source = media();
    const images = source.evidence.slice(0, 1).map((item) => ({ timeMs: Math.round(item.pts * item.timeBase * 1000), url: "data:image/jpeg;base64,AA==" }));
    const detect = vi.fn();
    const result = await analyzeCoverCandidates(source, images, detect, new AbortController().signal, async () => { throw new Error("save failed"); });
    expect(detect).not.toHaveBeenCalled();
    expect(result.analysis).toBe("incomplete");
  });

  it("rejects repeated analysis of the same draft", async () => {
    const source = media();
    source.identities.push({ id: randomUUID(), label: "existing", semantics: "unknown", origin: "algorithm" });
    await expect(analyzeCoverCandidates(source, source.evidence.map((item) => ({ timeMs: Math.round(item.pts * item.timeBase * 1000), url: "data:image/jpeg;base64,AA==" })), async () => [], new AbortController().signal)).rejects.toThrow(/已完成候选分析/);
  });
});
