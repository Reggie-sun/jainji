import { describe, expect, it } from "vitest";
import { CoverDiagnostics, diagnosticTracks, diagnosticEvidence, measureCoverStage } from "../src/main/cover-diagnostics";
import { CoverDiagnosticsSchema, MAX_COVER_DIAGNOSTIC_EVENTS, MAX_COVER_DIAGNOSTIC_BYTES } from "../src/shared/cover-diagnostics";

const track = { targetId: "secret-user@example.com", track: { startMs: 0, endMs: 1000,
  keyframes: [{ timeMs: 0, rectangle: { x: 0, y: 0, width: 0.1, height: 0.1 } }] } };

describe("ephemeral cover diagnostics", () => {
  it("records comparable per-target digests without retaining model-controlled identifiers", () => {
    const before = diagnosticTracks([track]);
    const after = diagnosticTracks([{ ...track, track: { ...track.track, endMs: 900 } }]);
    expect(before.entries[0].target).toBe(after.entries[0].target);
    expect(before.entries[0].digest).not.toBe(after.entries[0].digest);
    expect(JSON.stringify(before)).not.toContain("secret");
    expect(diagnosticTracks([track])).toEqual(before);
    const other = { ...track, targetId: "unchanged" };
    const twoBefore = diagnosticTracks([track, other]);
    const twoAfter = diagnosticTracks([other, { ...track, track: { ...track.track, endMs: 900 } }]);
    expect(twoBefore.entries.filter(entry => twoAfter.entries.some(value => value.target === entry.target && value.digest !== entry.digest))).toHaveLength(1);
    expect(diagnosticTracks([other, track])).toEqual(twoBefore);
  });
  it("enforces a serialized byte bound even for maximum-sized tracks and concurrent open spans", async () => {
    const trace = new CoverDiagnostics();
    const tracks = diagnosticTracks(Array.from({ length: 64 }, (_, i) => ({ ...track, targetId: String(i) })));
    const pending: Array<Promise<void>> = [], releases: Array<() => void> = [];
    for (let i = 0; i < 100; i++) {
      trace.record("validation", "ok", { action: "revise", tracks, previousTracks: tracks });
      pending.push(trace.measure("review-provider", new AbortController().signal, () => new Promise<void>(resolve => releases.push(resolve))));
    }
    releases.forEach(release => release()); await Promise.all(pending);
    expect(trace.state.droppedEvents).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(trace.state))).toBeLessThanOrEqual(MAX_COVER_DIAGNOSTIC_BYTES);
    expect(trace.state.events.some(event => event.outcome === "running")).toBe(false);
  });
  it("projects only frame timing and crop geometry, dropping images, paths and extra fields", () => {
    const evidence = diagnosticEvidence([{ requestedTimeMs: 100, timeMs: 83, previewTimeMs: 90,
      sourceUrl: "data:image/png;base64,SECRET", previewUrl: "/home/account/secret.mp4",
      crop: { x: 0, y: 0, width: 0.5, height: 0.5 }, previewCrop: { x: 0.1, y: 0, width: 0.4, height: 0.5 } }]);
    expect(evidence).toEqual([{ requestedTimeMs: 100, timeMs: 83, previewTimeMs: 90,
      crop: { x: 0, y: 0, width: 0.5, height: 0.5 }, previewCrop: { x: 0.1, y: 0, width: 0.4, height: 0.5 } }]);
  });
  it("caps events, rejects arbitrary strings, and does not turn observation failures into pipeline errors", async () => {
    const trace = new CoverDiagnostics();
    for (let i = 0; i < MAX_COVER_DIAGNOSTIC_EVENTS + 10; i++) trace.record("validation", "ok", { action: "pass", reason: "accepted" });
    expect(trace.state.events).toHaveLength(MAX_COVER_DIAGNOSTIC_EVENTS);
    expect(trace.state.droppedEvents).toBe(10);
    expect(CoverDiagnosticsSchema.safeParse(trace.state).success).toBe(true);
    const bad = new CoverDiagnostics();
    bad.record("validation", "failed", { reason: "API-Key secret /home/me" as never });
    expect(JSON.stringify(bad.state)).not.toContain("secret");
    expect(bad.state.droppedEvents).toBe(1);
    await expect(measureCoverStage(bad, "review-provider", new AbortController().signal, async () => { throw new Error("/home/user KEY image prompt"); })).rejects.toThrow("KEY");
    expect(bad.state.events[0]).toMatchObject({ outcome: "failed", reason: "stage-failed" });
    expect(JSON.stringify(bad.state)).not.toMatch(/home|KEY|prompt/);
    const brokenObserver = new CoverDiagnostics(() => { throw new Error("observer unavailable"); });
    await expect(measureCoverStage(brokenObserver, "review-provider", new AbortController().signal, async () => "unchanged result")).resolves.toBe("unchanged result");
    expect(brokenObserver.state.events[0].outcome).toBe("ok");
  });
  it("keeps running spans readable and closes them on cancellation without retaining abort reasons", async () => {
    const trace = new CoverDiagnostics(), controller = new AbortController();
    let release!: () => void;
    const pending = measureCoverStage(trace.scope("preview", 2, 1), "review-provider", controller.signal,
      () => new Promise<void>(resolve => { release = resolve; }));
    expect(trace.state.events[0]).toMatchObject({ phase: "preview", revision: 1, turn: 2, outcome: "running" });
    controller.abort("sensitive account"); release(); await pending;
    expect(trace.state.events[0]).toMatchObject({ outcome: "cancelled", reason: "cancelled" });
    expect(trace.state.events[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(trace.state)).not.toContain("sensitive");
  });
});
