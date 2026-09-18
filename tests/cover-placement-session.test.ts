import { describe, expect, it, vi } from "vitest";
import { CoverPlacementSession, completedCoverPlacements } from "../src/main/cover-placement-session";
import { createDefaultTemplate, type MediaItem, type ExportBatch } from "../src/main/domain";
import { CoverPlacementSchema } from "../src/shared/cover-placement";
import type { KnowledgeRun } from "../src/main/source-sticker-knowledge-store";

const source = { fingerprint: `sha256:${"a".repeat(64)}`, byteLength: 10, width: 100, height: 100, rotation: 0 as const, durationMs: 6000, timeBase: "1/1000", timeOriginPts: 0, interpretationVersion: 1 };
const media: MediaItem = { id: crypto.randomUUID(), sourcePath: "/source.mp4", displayName: "source", fingerprint: source.fingerprint, sizeBytes: 10, durationMs: 6000, width: 100, height: 100, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
const placement = { schemaVersion: 1 as const, source, tracks: [{ targetId: "badge", track: { startMs: 0, endMs: 6000, keyframes: [{ timeMs: 0, rectangle: { x: 0.8, y: 0.8, width: 0.1, height: 0.1 } }] } }] };
const signal = () => new AbortController().signal;
function setup(cached = false) {
  const identify = vi.fn(async () => structuredClone(source)), guard = vi.fn(async () => undefined), propose = vi.fn(async () => structuredClone(placement));
  const admitCheck = vi.fn(async () => {});
  const store = { beginRun: vi.fn(async () => Object.freeze({ id: crypto.randomUUID() })), endRun: vi.fn(async () => {}), readHead: guard,
    admit: async <T>(_token: KnowledgeRun, _revision: string | null, submit: () => Promise<T>) => { await admitCheck(); return submit(); } };
  const review = vi.fn(async (input: Parameters<ConstructorParameters<typeof CoverPlacementSession>[0]["review"]>[0]) => ({ template: input.template, tracks: input.placement.tracks }));
  const template = createDefaultTemplate();
  const session = new CoverPlacementSession({ identify, store, propose, review, cached: cached ? [placement] : [] });
  return { session, identify, guard, store, admitCheck, propose, review, template };
}
describe("approximate cover placement session", () => {
  it("selects newest completed tagged placements regardless of recovered file order, never manual snapshots", () => {
    const batch = (createdAt: string, status: string, tagged: boolean, targetId: string) => ({ createdAt, tasks: [{ status }],
      templateSnapshot: { ...createDefaultTemplate(), ...(tagged ? { coverPlacement: { ...placement, tracks: [{ ...placement.tracks[0], targetId }] } } : {}) } }) as ExportBatch;
    const entries = [batch("2026-09-18T02:00:00Z", "completed", true, "new"), batch("2026-09-18T03:00:00Z", "failed", true, "failed"),
      batch("2026-09-18T04:00:00Z", "completed", false, "manual"), batch("2026-09-18T01:00:00Z", "completed", true, "old")];
    expect(completedCoverPlacements(entries).map(value => value.tracks[0].targetId)).toEqual(["new", "old"]);
  });
  it("does not silently retry a failed source proposal for each version in the same run", async () => {
    const f = setup(); f.propose.mockRejectedValue(new Error("provider unavailable"));
    await expect(f.session.acquire(media, signal(), () => {})).rejects.toThrow("provider unavailable");
    await expect(f.session.acquire(media, signal(), () => {})).rejects.toThrow("provider unavailable");
    expect(f.propose).toHaveBeenCalledOnce();
  });
  it("reuses only explicitly tagged same-source placements and checks every new template", async () => {
    const f = setup(true), p = await f.session.acquire(media, signal(), () => {});
    const result = await f.session.review(media, p, f.template, () => f.template, signal(), () => {});
    expect(f.propose).not.toHaveBeenCalled();
    expect(f.review).toHaveBeenCalledOnce();
    expect(result.coverPlacement).toEqual(placement);
    expect(result.sourceStickerKnowledge).toBeUndefined();
    expect(f.template).not.toHaveProperty("coverPlacement");
    await f.session.assertCurrent(media, result, signal());
    await expect(f.session.assertCurrent(media, { ...result, name: "changed" }, signal())).rejects.toThrow();
    const copy = await f.session.acquire({ ...media, id: crypto.randomUUID(), sourcePath: "/renamed.mp4" }, signal(), () => {});
    expect(copy).toEqual(placement);
    expect(f.propose).not.toHaveBeenCalled();
  });
  it("shares one proposal across versions but freezes each supervisor-corrected result", async () => {
    const f = setup(), p = await f.session.acquire(media, signal(), () => {});
    const corrected = structuredClone(placement.tracks); corrected[0].track.keyframes[0].rectangle.x = 0.7;
    f.review.mockResolvedValueOnce({ template: f.template, tracks: corrected });
    const result = await f.session.review(media, p, f.template, () => f.template, signal(), () => {});
    expect(result.coverPlacement!.tracks[0].track.keyframes[0].rectangle.x).toBe(0.7);
    const next = await f.session.acquire(media, signal(), () => {});
    expect(next.tracks).toEqual(corrected);
    expect(f.propose).toHaveBeenCalledOnce();
  });
  it("keeps known disputes, changed sources, and late responses from becoming accepted placements", async () => {
    const f = setup(true); f.guard.mockRejectedValueOnce(new Error("disputed"));
    await expect(f.session.acquire(media, signal(), () => {})).rejects.toThrow("争议");
    expect(f.propose).not.toHaveBeenCalled();
    const p = await f.session.acquire(media, signal(), () => {});
    const cancel = new AbortController();
    f.review.mockImplementationOnce(async input => { cancel.abort(); return { template: input.template, tracks: input.placement.tracks }; });
    await expect(f.session.review(media, p, f.template, () => f.template, cancel.signal, () => {})).rejects.toThrow();
    const accepted = await f.session.review(media, p, f.template, () => f.template, signal(), () => {});
    f.identify.mockResolvedValueOnce({ ...source, byteLength: 11 });
    await expect(f.session.assertCurrent(media, accepted, signal())).rejects.toThrow();
  });
  it("refreshes explicitly and does not reuse a different byte identity or a failed preview", async () => {
    const f = setup(true);
    const session = new CoverPlacementSession({ identify: f.identify, store: f.store, propose: f.propose, review: f.review,
      cached: [placement], refreshMediaIds: new Set([media.id]) });
    const p = await session.acquire(media, signal(), () => {});
    expect(f.propose).toHaveBeenCalledOnce();
    f.review.mockRejectedValueOnce(new Error("bad preview"));
    await expect(session.review(media, p, f.template, () => f.template, signal(), () => {})).rejects.toThrow("bad preview");
    await expect(session.assertCurrent(media, f.template, signal())).rejects.toThrow();
    const other = setup(true); other.identify.mockResolvedValue({ ...source, fingerprint: `sha256:${"b".repeat(64)}` });
    await expect(other.session.acquire(media, signal(), () => {})).rejects.toThrow();
  });
  it("holds a store run and uses atomic store admission rather than an earlier read-head verdict", async () => {
    const f = setup(true), abort = new AbortController(), submit = vi.fn(async () => "task");
    const p = await f.session.acquire(media, abort.signal, () => {});
    const template = await f.session.review(media, p, f.template, () => f.template, abort.signal, () => {});
    expect(f.store.beginRun).toHaveBeenCalledOnce();
    expect(f.store.endRun).not.toHaveBeenCalled();
    f.admitCheck.mockRejectedValueOnce(new Error("dispute raced with handoff"));
    await expect(f.session.enqueue(media, template, abort.signal, submit)).rejects.toThrow("dispute");
    expect(submit).not.toHaveBeenCalled();
    await f.session.close();
    expect(f.store.endRun).toHaveBeenCalledOnce();
    await expect(f.session.assertCurrent(media, template, abort.signal)).rejects.toThrow();
  });
  it("rejects future formats, overlapping target intervals and out-of-range geometry", () => {
    for (const invalid of [{ ...placement, schemaVersion: 2 }, { ...placement, tracks: [{ ...placement.tracks[0], targetId: "x".repeat(81) }] }, { ...placement, tracks: [...placement.tracks, ...placement.tracks] },
      { ...placement, tracks: [{ ...placement.tracks[0], track: { ...placement.tracks[0].track, endMs: 6001 } }] },
      { ...placement, tracks: [{ ...placement.tracks[0], track: { ...placement.tracks[0].track, keyframes: [{ timeMs: 0, rectangle: { x: 0.99, y: 0, width: 0.1, height: 0.1 } }] } }] }]) {
      expect(CoverPlacementSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
