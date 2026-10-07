import { beforeEach, expect, it, vi } from "vitest";
import { createHybridProductionSession } from "../src/main/hybrid-cover-session.js";
import { DEFAULT_PRESET, type MediaItem } from "../src/main/domain.js";
import { DecorationSchema } from "../src/shared/decorations.js";
import type { StickerAssets } from "../src/main/builtin-stickers.js";
import { PRICE_STYLES, priceStyleAppearance } from "../src/shared/price-styles.js";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), close: vi.fn(), discovery: vi.fn(), semantic: vi.fn(), geometry: vi.fn(), approve: vi.fn(), fresh: vi.fn() }));
vi.mock("../src/main/supervisor-evidence.js", () => ({ SupervisorEvidence: class {
  sourceIdentity = mocks.identity; dispose = async () => {};
} }));
vi.mock("../src/main/source-fact-discovery-evidence.js", async importOriginal => ({ ...await importOriginal<object>(),
  prepareDiscoveryEvidence: mocks.discovery }));
vi.mock("../src/main/shape-cover-vision-corner-semantic.js", () => ({ confirmHybridCornerTargets: mocks.semantic }));
vi.mock("../src/main/shape-cover-hybrid-h3.js", () => ({ prepareHybridCornerOverlays: mocks.geometry,
  readHybridFrozenOverlay: async (_h3: unknown, corner: string) => ({ overlay: { corner } }) }));
vi.mock("../src/main/hybrid-cover-production.js", () => ({ approveHybridOverlay: mocks.approve,
  hybridVideoMedia: async (media: MediaItem) => media,
  hybridTemplate: (layers: unknown[], base: { layers: unknown[] }) => ({ ...base, layers: [...base.layers.filter((l: any) => l.type === "text" || l.type === "sticker" && l.frame), ...layers] }) }));

const media = { id: "00000000-0000-4000-8000-000000000001", sourcePath: "/fixture.mp4", fingerprint: `sha256:${"a".repeat(64)}`,
  durationMs: 2000, width: 160, height: 160, rotation: 0, sizeBytes: 1000, probeStatus: "ready", importedAt: new Date().toISOString(), displayName: "fixture" } satisfies MediaItem;
const source = { fingerprint: media.fingerprint, byteLength: 1000, width: 160, height: 160, durationMs: 2000,
  rotation: 0, timeBase: "1/6000", timeOriginPts: 0, interpretationVersion: 1 };
const pass = { id: "00000000-0000-4000-8000-000000000002", type: "sticker", cover: { hybridApproved: { corner: "TOP_RIGHT" } } };
function fixture(selectedMedia = media) {
  const routes = vi.fn(async () => ({} as any)), knowledge = { lookup: vi.fn(async (_source?: typeof source) => ({ status: "miss" })) };
  const session = createHybridProductionSession({ tools: { ffmpegPath: "unused", ffprobePath: "unused" }, preset: DEFAULT_PRESET,
    directory: "/unused", candidates: [], stickerAssets: {} as StickerAssets, decorations: DecorationSchema.parse({ mode: "agent", displayText: { enabled: false, x: 0.5, y: 0.7 } }),
    ruleId: "clean", knowledgeStore: knowledge as any, routes });
  return { session, routes, knowledge, prepare: (version = 0) => session.prepare(selectedMedia, version, "run", new AbortController().signal, () => {}) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue(source); mocks.discovery.mockImplementation(async () => ({ close: mocks.close }));
  mocks.semantic.mockResolvedValue({ status: "CORNER_SEMANTIC_READY", corners: Object.fromEntries(["TOP_LEFT", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_RIGHT"].map(c => [c, { status: "NO_CANDIDATE" }])) });
  mocks.geometry.mockResolvedValue({ status: "READY", corners: [{ corner: "TOP_LEFT", status: "FROZEN" }, { corner: "TOP_RIGHT", status: "FROZEN" }, { corner: "BOTTOM_RIGHT", status: "SKIPPED" }], verifyFresh: mocks.fresh });
  mocks.approve.mockImplementation(async overlay => { if (overlay.corner === "TOP_LEFT") throw Error("UNSAFE: HYBRID_H4_NOT_PASS"); return pass; });
});
it("keeps a safe corner despite local H4 rejection and reuses the same freeze for all versions", async () => {
  const f = fixture(), a = await f.prepare(), b = await f.prepare(1);
  expect(a.layers).toEqual([pass]); expect(b.layers).toEqual([pass]);
  expect(a.name).toContain("右上：已处理"); expect(a.name).toContain("左上：样片未通过"); expect(a.name).toContain("其他角落保持原样");
  expect(a.name.length).toBeLessThanOrEqual(120);
  expect(mocks.semantic).toHaveBeenCalledTimes(1); expect(mocks.geometry).toHaveBeenCalledTimes(1); expect(mocks.approve).toHaveBeenCalledTimes(2);
  expect(mocks.close).toHaveBeenCalledTimes(2);
  const dense = await mocks.discovery.mock.results[1].value;
  expect(mocks.discovery.mock.calls.map(c => c[1])).toEqual([{ frames: 24 }, undefined]);
  expect(mocks.semantic.mock.calls[0][4]).toBe(dense); expect(mocks.geometry.mock.calls[0][6]).toBe(dense);
});
it("keeps Hybrid approval bytes cached while resolving and freezing per-version frame overrides", async () => {
  const assets = Object.fromEntries(["sparkle", "arrow", "heart", "burst", "frame-stars", "frame-hearts", "frame-confetti"].map(id => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: "fixture" }])) as StickerAssets;
  const manualMedia = { ...media, id: crypto.randomUUID() }, offMedia = { ...media, id: crypto.randomUUID() };
  const session = createHybridProductionSession({ tools: { ffmpegPath: "unused", ffprobePath: "unused" }, preset: DEFAULT_PRESET, directory: "/unused", candidates: [], stickerAssets: assets,
    decorations: DecorationSchema.parse({ frame: { mode: "random" }, displayText: { enabled: false, x: .5, y: .13 }, framesByMedia: { [manualMedia.id]: { mode: "manual", frameId: "frame-hearts" }, [offMedia.id]: { mode: "none" } } }),
    ruleId: "clean", routes: async () => ({} as any) });
  const prepare = (source: MediaItem, version: number) => session.prepare(source, version, "run", new AbortController().signal, () => {});
  const frames = [];
  for (let version = 1; version <= 3; version++) {
    const first = await prepare(media, version), again = await prepare(media, version);
    const frame = first.layers.find(l => l.type === "sticker" && l.frame);
    expect(again.layers.find(l => l.type === "sticker" && l.frame)).toMatchObject({ assetPath: frame!.type === "sticker" ? frame!.assetPath : "", frame: frame!.type === "sticker" ? frame!.frame : undefined });
    frames.push(frame?.type === "sticker" ? frame.frame?.id : undefined);
  }
  expect(new Set(frames).size).toBe(3);
  expect((await prepare(manualMedia, 1)).layers.find(l => l.type === "sticker" && l.frame)).toMatchObject({ frame: { id: "frame-hearts", selection: "manual" } });
  expect((await prepare(offMedia, 1)).layers.find(l => l.type === "sticker" && l.frame)).toBeUndefined();
  expect(mocks.geometry).toHaveBeenCalledTimes(1); expect(mocks.approve).toHaveBeenCalledTimes(2);
});
it("exports an explicit unchanged result when every corner is unresolved or skipped", async () => {
  mocks.geometry.mockResolvedValue({ status: "READY", corners: [{ corner: "TOP_RIGHT", status: "SKIPPED" }], verifyFresh: mocks.fresh });
  const result = await fixture().prepare(); expect(result.layers).toEqual([]); expect(result.name).toContain("已处理 0 个角落");
  expect(mocks.approve).not.toHaveBeenCalled();
});
it("randomizes only text appearance per output and freezes exact templates without requiring ordinary corner assets", async () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  const session = createHybridProductionSession({ tools: { ffmpegPath: "unused", ffprobePath: "unused" }, preset: DEFAULT_PRESET,
    directory: "/unused", candidates: [], stickerAssets: {} as StickerAssets, ruleId: "clean", routes: async () => ({} as any),
    decorations: DecorationSchema.parse({ mode: "random", productPrice: "用户原文", frame: { mode: "none" }, displayText: { enabled: true, x: .5, y: .7 } }) });
  const prepare = (version = 0) => session.prepare(media, version, "run", new AbortController().signal, () => {});
  try {
    const first = await prepare();
    expect(first.layers.find(l => l.type === "text")).toMatchObject({ content: "用户原文", ...priceStyleAppearance(PRICE_STYLES[0]) });
    expect(first.layers.filter(l => l.type === "sticker")).toEqual([pass]);
    random.mockReturnValue(.99999);
    expect(await prepare()).toEqual(first);
    const next = await prepare(1);
    expect(next.layers.find(l => l.type === "text")).toMatchObject(priceStyleAppearance(PRICE_STYLES.at(-1)!));
    expect(next.layers.filter(l => l.type === "sticker")).toEqual([pass]);
    first.layers.length = 0;
    expect((await prepare()).layers).toHaveLength(2);
    expect(mocks.geometry).toHaveBeenCalledTimes(1);
    expect(mocks.approve).toHaveBeenCalledTimes(2);
  } finally { random.mockRestore(); }
});
it("keeps per-media text disabled in random Hybrid and honors cancellation before a cached output", async () => {
  const session = createHybridProductionSession({ tools: { ffmpegPath: "unused", ffprobePath: "unused" }, preset: DEFAULT_PRESET,
    directory: "/unused", candidates: [], stickerAssets: {} as StickerAssets, ruleId: "clean", routes: async () => ({} as any),
    decorations: DecorationSchema.parse({ mode: "random", displayTextByMedia: { [media.id]: { enabled: false, x: .5, y: .7 } }, frame: { mode: "none" } }) });
  const result = await session.prepare(media, 0, "run", new AbortController().signal, () => {});
  expect(result.layers).toEqual([pass]);
  const cancelled = new AbortController(); cancelled.abort();
  await expect(session.prepare(media, 0, "run", cancelled.signal, () => {})).rejects.toThrow();
  expect(mocks.geometry).toHaveBeenCalledTimes(1);
});
it("does not convert infrastructure failure into a skipped corner or retry the unknown request", async () => {
  mocks.approve.mockRejectedValue(Error("UNSAFE: HYBRID_QA_INFRASTRUCTURE"));
  const f = fixture(); await expect(f.prepare()).rejects.toThrow("QA_INFRASTRUCTURE"); await expect(f.prepare(1)).rejects.toThrow("QA_INFRASTRUCTURE");
  expect(mocks.approve).toHaveBeenCalledTimes(1); expect(f.routes).toHaveBeenCalledTimes(1); expect(mocks.close).toHaveBeenCalledTimes(2);
});
it("stops on a known source dispute before requesting models", async () => {
  const f = fixture(); f.knowledge.lookup.mockResolvedValue({ status: "disputed" });
  await expect(f.prepare()).rejects.toThrow("争议"); expect(f.routes).not.toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalledTimes(1);
});
it("stops a changed source before discovery or model requests", async () => {
  mocks.identity.mockResolvedValue({ ...source, fingerprint: `sha256:${"b".repeat(64)}` });
  const f = fixture(); await expect(f.prepare()).rejects.toThrow("原素材已变化"); expect(f.routes).not.toHaveBeenCalled();
});
it("does not lose a legacy container-identity dispute when the video timeline differs", async () => {
  const f = fixture({ ...media, durationMs: 2013 });
  f.knowledge.lookup.mockImplementation(async identity => ({ status: identity?.durationMs === 2013 ? "disputed" : "miss" }));
  await expect(f.prepare()).rejects.toThrow("争议");
  expect(f.knowledge.lookup.mock.calls.map(([identity]) => identity?.durationMs)).toEqual([2000, 2013]);
  expect(f.routes).not.toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalledTimes(1);
});
