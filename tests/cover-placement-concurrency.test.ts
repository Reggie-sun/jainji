import { afterEach, expect, it, vi } from "vitest";
import { AgentRunner } from "../src/main/agent-runner";
import type { MediaItem } from "../src/main/domain";
import type { CoverPlacement } from "../src/shared/cover-placement";
import { DecorationSchema } from "../src/shared/decorations";
import * as limits from "../src/main/execution-limits";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";

afterEach(() => vi.restoreAllMocks());
function media(fingerprint: string): MediaItem {
  return { id: crypto.randomUUID(), sourcePath: `/tmp/${fingerprint}`, displayName: fingerprint, fingerprint, sizeBytes: 10,
    width: 640, height: 480, durationMs: 1000, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
}
function harness(selectCoverSticker?: ConstructorParameters<typeof AgentRunner>[0]["selectCoverSticker"], failure?: "acquire" | "frames") {
  const active = new Set<string>(), entered: string[] = [], releases: Array<() => void> = [], events: string[] = [];
  let peak = 0;
  const runner = new AgentRunner({
    stickerAssets: Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map(id => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id}` }])) as BuiltinStickerAssets,
    decorations: DecorationSchema.parse({ sticker: "none", productPrice: "手动文字" }),
    coverSticker: { automatic: true, stickerId: "heart", assetPath: "/tmp/heart.png", assetFingerprint: "sha256:heart", rectangle: { x: 0, y: 0, width: 0.1, height: 0.1 } },
    frames: async source => { if (failure === "frames" && source.fingerprint === "a") throw new Error("bad source"); return [source.displayName]; }, selectCoverSticker,
    plan: async () => ({ summary: "ok", captions: [], filter: "cool", intensity: 0.3 }),
    enqueue: async () => { events.push("enqueue"); return crypto.randomUUID(); }, onChange() {},
    placement: {
      acquire: async source => {
        if (active.has(source.fingerprint)) throw new Error("same source overlapped");
        active.add(source.fingerprint); entered.push(source.fingerprint); peak = Math.max(peak, active.size);
        await new Promise<void>(resolve => releases.push(resolve));
        // Cancellation can occur while an external call finishes; finally must still drain it.
        active.delete(source.fingerprint);
        if (failure === "acquire" && source.fingerprint === "a") throw new Error("blocked source");
        return { tracks: [] } as unknown as CoverPlacement;
      },
      review: async (_source, _placement, template) => { events.push("preview"); return template; },
      enqueue: async (_source, _template, signal, submit) => { signal.throwIfAborted(); return submit(); },
      close: async () => { expect(active.size).toBe(0); events.push("close"); },
    },
  });
  return { runner, entered, releases, events, peak: () => peak };
}

it("runs independent cover sources concurrently, serializes copies/versions, and keeps the preview barrier", async () => {
  vi.spyOn(limits, "executionLimits").mockReturnValue({ exports: 1, analysis: 2, threads: 2 });
  const h = harness();
  h.runner.start("project", "clean", "", [media("a"), media("a"), media("b"), media("c")], 2);
  try {
    await vi.waitFor(() => expect(h.entered).toEqual(["a", "b"]));
    h.releases[1]();
    await vi.waitFor(() => expect(h.entered).toEqual(["a", "b", "b"]));
    h.releases[2]();
    await vi.waitFor(() => expect(h.entered).toEqual(["a", "b", "b", "c"]));
    expect(h.events).not.toContain("enqueue");
    for (let index = 0; index < 8; index++) {
      await vi.waitFor(() => expect(h.releases.length).toBeGreaterThan(index));
      h.releases[index]();
    }
    await h.runner.settled();
    expect(h.peak()).toBe(2);
    expect(h.runner.snapshot()?.items.map(item => ({ status: item.status, error: item.error }))).toEqual(Array(8).fill({ status: "exporting", error: undefined }));
    expect(h.events).toEqual([...Array(8).fill("preview"), ...Array(8).fill("enqueue"), "close"]);
  } finally {
    h.runner.cancel(); h.releases.forEach(release => release()); await h.runner.settled();
  }
});

it("cancels queued sources and waits for active work before closing the placement session", async () => {
  vi.spyOn(limits, "executionLimits").mockReturnValue({ exports: 1, analysis: 2, threads: 2 });
  const h = harness();
  h.runner.start("project", "clean", "", [media("a"), media("b"), media("c")]);
  try {
    await vi.waitFor(() => expect(h.entered).toEqual(["a", "b"]));
    h.runner.cancel(); h.releases[0]();
    await Promise.resolve(); expect(h.events).not.toContain("close");
  } finally {
    h.runner.cancel(); h.releases.forEach(release => release()); await h.runner.settled();
  }
  expect(h.entered).toEqual(["a", "b"]);
  expect(h.events).toEqual(["close"]);
  expect(h.runner.snapshot()?.items.map(item => item.status)).toEqual(["cancelled", "cancelled", "cancelled"]);
});

it("caps cover work at three even on larger machines", async () => {
  vi.spyOn(limits, "executionLimits").mockReturnValue({ exports: 1, analysis: 8, threads: 8 });
  const h = harness();
  h.runner.start("project", "clean", "", [media("a"), media("b"), media("c"), media("d")]);
  try { await vi.waitFor(() => expect(h.entered).toEqual(["a", "b", "c"])); }
  finally { h.runner.cancel(); h.releases.forEach(release => release()); await h.runner.settled(); }
  expect(h.peak()).toBe(3);
  expect(h.entered).not.toContain("d");
});

it("shares one selection per round from the first eligible source and preserves rotation", async () => {
  vi.spyOn(limits, "executionLimits").mockReturnValue({ exports: 1, analysis: 2, threads: 2 });
  const selected: Array<{ frames: string[]; previous: readonly string[] }> = [];
  const h = harness(async (frames, _signal, previous) => {
    selected.push({ frames, previous });
    return { automatic: true, stickerId: selected.length === 1 ? "heart" : "sparkle", assetPath: "/tmp/sticker.png", assetFingerprint: "sha256:sticker",
      rectangle: { x: 0, y: 0, width: 0.1, height: 0.1 } };
  });
  h.runner.start("project", "clean", "", [media("a"), media("b")], 2);
  try {
    await vi.waitFor(() => expect(h.entered).toEqual(["a", "b"]));
    h.releases[1]();
    await vi.waitFor(() => expect(h.entered).toEqual(["a", "b", "b"]));
    h.releases[2]();
    await vi.waitFor(() => expect(selected).toHaveLength(2));
    expect(selected).toEqual([{ frames: ["b"], previous: [] }, { frames: ["b"], previous: ["heart"] }]);
    h.releases[0]();
    await vi.waitFor(() => expect(h.releases).toHaveLength(4));
    h.releases[3](); await h.runner.settled();
    expect(selected).toHaveLength(2);
  } finally { h.runner.cancel(); h.releases.forEach(release => release()); await h.runner.settled(); }
});

it.each(["acquire", "frames"] as const)("does not make healthy peers depend on a first source failing at %s", async failure => {
  vi.spyOn(limits, "executionLimits").mockReturnValue({ exports: 1, analysis: 2, threads: 2 });
  const selected: string[][] = [];
  const h = harness(async frames => {
    selected.push(frames);
    return { automatic: true, stickerId: "heart", assetPath: "/tmp/heart.png", assetFingerprint: "sha256:heart", rectangle: { x: 0, y: 0, width: 0.1, height: 0.1 } };
  }, failure);
  h.runner.start("project", "clean", "", [media("a"), media("b")]);
  try {
    await vi.waitFor(() => expect(h.entered).toEqual(["a", "b"]));
    h.releases.forEach(release => release()); await h.runner.settled();
    expect(selected).toEqual([["b"]]);
    expect(h.runner.snapshot()?.items.map(item => item.status)).toEqual(["failed", "exporting"]);
  } finally { h.runner.cancel(); h.releases.forEach(release => release()); await h.runner.settled(); }
});
