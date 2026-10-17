import { expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHumanRegionCover, type HumanRegionIntent } from "../src/main/human-region-cover";
import { decodeShapeCoverPng } from "../src/main/shape-cover-alpha";
import { opaqueRegionCovered } from "../src/main/human-region-geometry";
import { encodeRgbaPng, type StickerAssets } from "../src/main/builtin-stickers";
import { loadBundledStickerAssets } from "../src/main/bundled-stickers";
import { DEFAULT_PRESET, now, type MediaItem } from "../src/main/domain";
import { FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin";
import { compactArtworkPlacement } from "../src/main/human-region-artwork-placement";
import * as shapeSearch from "../src/main/shape-cover-hybrid-shape";
import { isCoverPoolStickerId, isHumanRegionStickerId } from "../src/shared/cover-sticker";
import { AssetLibrary } from "../src/main/asset-library";
import { LIBRARY_STICKERS } from "../src/shared/asset-library";
import { DecorationSchema } from "../src/shared/decorations";
import { loadHumanRegionArtworkIndex } from "../src/main/human-region-artwork-index";

it("retains measured sizes across several target groups and batches only cache misses", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-size-batch-"));
  try {
    const bytes = encodeRgbaPng(Buffer.alloc(16, 255), 2, 2);
    const asset = { assetPath: path.join(directory, "unused.png"), assetFingerprint: "sha256:" + createHash("sha256").update(bytes).digest("hex") };
    const tools = { ffmpegPath: ffmpegBin, ffprobePath: ffprobeBin, artworkIndexDirectory: path.join(directory, "indexes") };
    const index = await loadHumanRegionArtworkIndex(asset, bytes, tools);
    const sizes = Array.from({ length: 36 }, (_, i) => ({ width: i + 1, height: 2 }));
    const produce = vi.fn(async (missing: { width: number; height: number }[]) => missing.map(size => new Uint8Array(size.width * size.height).fill(254)));
    for (let i = 0; i < sizes.length; i += 12) await index.alphaBatch(sizes.slice(i, i + 12), produce);
    expect(produce).toHaveBeenCalledTimes(3);
    const reloaded = await loadHumanRegionArtworkIndex(asset, bytes, tools);
    const reused = await reloaded.alphaBatch(sizes.slice(0, 12), produce);
    expect(produce).toHaveBeenCalledTimes(3);
    expect(reused[0]).toEqual(new Uint8Array(2).fill(254));
    reused[0].fill(0);
    expect(await reloaded.alpha(1, 2, async () => { throw Error("must reuse"); })).toEqual(new Uint8Array(2).fill(254));
    const mixed = await reloaded.alphaBatch([sizes[0], { width: 40, height: 2 }, sizes[0]], produce);
    expect(produce.mock.calls.at(-1)![0]).toEqual([{ width: 40, height: 2 }]);
    expect(mixed).toHaveLength(3);
    await expect(reloaded.alphaBatch([{ width: 41, height: 2 }], async () => [new Uint8Array(1)])).rejects.toThrow();
    const repair = vi.fn(async () => [new Uint8Array(82).fill(255)]);
    expect((await reloaded.alphaBatch([{ width: 41, height: 2 }], repair))[0]).toHaveLength(82);
    expect(repair).toHaveBeenCalledTimes(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("admits reviewed local library artwork to the real cover pool without admitting unknown assets", () => {
  expect(isHumanRegionStickerId("fluent-031b8379abbc14775ef8879995f1935aadb49799")).toBe(true);
  expect(isHumanRegionStickerId("fluent-052f235f47d4b51d38230872b15c7aa990c27176")).toBe(true);
  expect(isCoverPoolStickerId("fluent-031b8379abbc14775ef8879995f1935aadb49799")).toBe(false);
  expect(isHumanRegionStickerId("fluent-unknown")).toBe(false);
  expect(isHumanRegionStickerId("uploaded-frame-" + "a".repeat(64))).toBe(false);
});

it("does not inspect or limit coverage artwork when every saved source has no target", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-no-target-artwork-"));
  try {
    const tools = new FfmpegAdapter(ffmpegBin, ffprobeBin), probe = vi.spyOn(tools, "probe");
    const media = { id: randomUUID(), fingerprint: "saved" } as MediaItem;
    const draft: HumanRegionIntent = { id: randomUUID(), projectId: randomUUID(), revision: 0, assistedArtwork: "human-region-v1", admission: "manual-production-v1",
      media: [{ mediaId: media.id, sourceFingerprint: media.fingerprint, disposition: "no_cover", identities: [], segments: [] }] };
    const assets = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`uploaded-${index.toString(16).padStart(64, "0")}`,
      { assetPath: path.join(directory, "missing.png"), assetFingerprint: "sha256:" + "a".repeat(64) }])) as StickerAssets;
    const layers = await createHumanRegionCover({ draft, media: [media], assets, preset: DEFAULT_PRESET, tools, directory, random: false })(media, 1, "no-cover", new AbortController().signal);
    expect(layers).toEqual([]); expect(probe).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); }
});

it.each([
  { x: 0, y: 0 }, { x: 85, y: 0 }, { x: 0, y: 90 }, { x: 85, y: 90 },
])("finds an opaque translation at canvas corner $x/$y without extending visible occupancy", ({ x, y }) => {
  const tile = { width: 20, height: 20 }, alpha = new Uint8Array(400);
  for (let row = 2; row < 18; row++) alpha.fill(255, row * 20 + 2, row * 20 + 18);
  const target = { x, y, width: 15, height: 10 }, canvas = { width: 100, height: 100 };
  const scope = { x: x - 3, y: y - 2, width: 21, height: 14 };
  const placement = compactArtworkPlacement(alpha, tile, target, canvas, scope)!;
  expect(placement).toBeDefined();
  expect(Math.max(0, placement.x)).toBeGreaterThanOrEqual(Math.max(0, scope.x));
  expect(Math.max(0, placement.y)).toBeGreaterThanOrEqual(Math.max(0, scope.y));
  expect(Math.min(100, placement.x + 20)).toBeLessThanOrEqual(Math.min(100, scope.x + scope.width));
  expect(Math.min(100, placement.y + 20)).toBeLessThanOrEqual(Math.min(100, scope.y + scope.height));
  for (let row = y; row < y + 10; row++) for (let col = x; col < x + 15; col++) expect(alpha[(row - placement.y) * 20 + col - placement.x]).toBe(255);
  alpha.fill(254);
  expect(compactArtworkPlacement(alpha, tile, target, canvas, scope)).toBeUndefined();
});

it("refuses oversized middle artwork, holes and cancelled searches", () => {
  const alpha = new Uint8Array(400).fill(255), tile = { width: 20, height: 20 };
  const target = { x: 40, y: 40, width: 10, height: 10 }, canvas = { width: 100, height: 100 };
  expect(compactArtworkPlacement(alpha, tile, target, canvas, { x: 38, y: 38, width: 14, height: 14 })).toBeUndefined();
  alpha[10 * 20 + 10] = 0;
  expect(compactArtworkPlacement(alpha, tile, target, canvas, { x: 35, y: 35, width: 20, height: 20 })).toBeUndefined();
  expect(() => compactArtworkPlacement(alpha, tile, target, canvas, { x: 35, y: 35, width: 20, height: 20 }, AbortSignal.abort())).toThrow();
});

it("covers mixed saved boxes independently in creator mode and preserves every time range across versions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-mixed-manual-"));
  try {
    const tools = new FfmpegAdapter(ffmpegBin, ffprobeBin), sourcePath = path.join(directory, "source.mp4");
    const generated = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=24", "-t", "2", "-c:v", "libx264", sourcePath]).promise;
    expect(generated.code, generated.stderr).toBe(0);
    const media: MediaItem[] = Array.from({ length: 2 }, () => ({ id: randomUUID(), sourcePath, fingerprint: "", displayName: "mixed boxes", durationMs: 2000,
      width: 160, height: 120, rotation: 0, sizeBytes: 0, importedAt: now(), probeStatus: "ready" }));
    for (const item of media) { item.fingerprint = await fingerprintFile(sourcePath); item.sizeBytes = (await stat(sourcePath)).size; }
    const boxes = [
      [{ x: .1, y: .1, width: .2, height: .1 }, { x: .7, y: .65, width: .1, height: .15 }],
      [{ x: .1, y: .8, width: .6, height: .1 }],
    ];
    const draft: HumanRegionIntent = { id: randomUUID(), projectId: randomUUID(), revision: 0, assistedArtwork: "human-region-v1", admission: "manual-production-v1",
      media: media.map((item, index) => {
        const identities = boxes[index].map(() => ({ id: randomUUID(), label: "saved target", semantics: "sticker" as const, origin: "human" as const }));
        return { mediaId: item.id, sourceFingerprint: item.fingerprint, disposition: "cover" as const, identities,
          segments: boxes[index].map((rectangle, i) => ({ id: randomUUID(), identityId: identities[i].id, origin: "human" as const,
            track: { startMs: 200, endMs: 1800, keyframes: [{ timeMs: 200, rectangle }] } })) };
      }) };
    const assets = {} as Record<string, { assetPath: string; assetFingerprint: string }>;
    for (const [i, width, height] of [[1, 60, 24], [2, 24, 40], [3, 100, 12]] as const) {
      const rgba = Buffer.alloc(width * height * 4);
      for (let p = 0; p < rgba.length; p += 4) rgba.set([220, i * 50, 30, 255], p);
      const assetPath = path.join(directory, `${i}.png`); await writeFile(assetPath, encodeRgbaPng(rgba, width, height));
      assets[`uploaded-${String(i).repeat(64)}`] = { assetPath, assetFingerprint: await fingerprintFile(assetPath) };
    }
    const prepare = createHumanRegionCover({ draft, media, assets: assets as StickerAssets, preset: { ...DEFAULT_PRESET, resolutionMode: "source" },
      tools, directory: path.join(directory, "frozen"), random: false });
    for (const version of [1, 2]) for (const [index, item] of media.entries()) {
      const layers = await prepare(item, version, "creator", new AbortController().signal);
      expect(layers).toHaveLength(boxes[index].length);
      expect(new Set(layers.map(layer => layer.cover!.stickerId)).size).toBe(layers.length);
      for (const layer of layers) {
        const binding = layer.cover!.humanRegion!, decoded = await decodeShapeCoverPng(await readFile(layer.assetPath), binding.projection, tools);
        const alpha = Uint8Array.from({ length: decoded.length / 4 }, (_, p) => decoded[p * 4 + 3]);
        expect(opaqueRegionCovered(alpha, binding.projection, binding.target)).toBe(true);
        expect(binding.range).toEqual({ startMs: 200, endMs: 1800 });
        expect(binding.admission).toBe("manual-production-v1");
      }
      expect(await prepare(item, version, "frozen-again", new AbortController().signal)).toEqual(layers);
    }
    // Four targets must be allowed to visit the whole pool; an unrelated fixed 512 cap misses later valid choices.
    const four = structuredClone(draft);
    four.media = [four.media[0]];
    four.media[0].identities = Array.from({ length: 4 }, () => ({ ...four.media[0].identities[0], id: randomUUID() }));
    four.media[0].segments = four.media[0].identities.map((identity, index) => ({ ...structuredClone(draft.media[0].segments[0]), id: randomUUID(), identityId: identity.id,
      track: { startMs: 200, endMs: 1800, keyframes: [{ timeMs: 200, rectangle: { x: .05 + index * .23, y: .1, width: .15, height: .1 } }] } }));
    const asset = assets[`uploaded-${"1".repeat(64)}`];
    const pool = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`uploaded-${index.toString(16).padStart(64, "0")}`, asset])) as StickerAssets;
    for (const letter of ["a", "b", "c", "d"]) (pool as Record<string, typeof asset>)[`uploaded-${letter.repeat(64)}`] = asset;
    const originalSearch = shapeSearch.searchHybridCornerShape;
    const attemptsByTarget = new Map<number, number>();
    const search = vi.spyOn(shapeSearch, "searchHybridCornerShape").mockImplementation((candidates, ...args) => {
      const target = args[0].findIndex(pixel => pixel > 0), attempts = (attemptsByTarget.get(target) ?? 0) + 1;
      attemptsByTarget.set(target, attempts);
      // Delay each target's first fit independently of randomized candidate order.
      return attempts <= 160 ? Promise.resolve(null) : originalSearch(candidates, ...args);
    });
    try {
      const layers = await createHumanRegionCover({ draft: four, media: [media[0]], assets: pool, preset: { ...DEFAULT_PRESET, resolutionMode: "source" },
        tools, directory: path.join(directory, "full-pool"), random: true })(media[0], 1, "late-candidates", new AbortController().signal);
      expect(layers).toHaveLength(4);
      expect(new Set(layers.map(layer => layer.cover!.stickerId)).size).toBe(4);
      expect(search.mock.calls.length).toBeGreaterThan(512);
    } finally { search.mockRestore(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60000);

it.each(["corner", "portrait"])("finds real catalog artwork for the saved %s target without changing the target or adding a background", async kind => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-catalog-compact-"));
  try {
    const tools = new FfmpegAdapter(ffmpegBin, ffprobeBin), sourcePath = path.join(directory, "source.mp4");
    const generated = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=540x960:r=24", "-t", "1", "-c:v", "libx264", sourcePath]).promise;
    expect(generated.code, generated.stderr).toBe(0);
    const media: MediaItem = { id: randomUUID(), sourcePath, fingerprint: await fingerprintFile(sourcePath), displayName: "saved corner", durationMs: 1000,
      width: 540, height: 960, rotation: 0, sizeBytes: (await stat(sourcePath)).size, importedAt: now(), probeStatus: "ready" };
    const id = randomUUID(), rectangle = kind === "corner" ? { x: 0, y: 0, width: .11197867533479523, height: .03164142861960811 }
      : { x: .04412602296231902, y: .003237555645487657, width: .06402170328846787, height: .06402266288951841 };
    const draft: HumanRegionIntent = { id: randomUUID(), projectId: randomUUID(), revision: 0, assistedArtwork: "human-region-v1", admission: "manual-production-v1",
      media: [{ mediaId: media.id, sourceFingerprint: media.fingerprint, disposition: "cover", identities: [{ id, label: "saved corner", semantics: "sticker", origin: "human" }],
        segments: [{ id, identityId: id, origin: "human", track: { startMs: 0, endMs: 1000, keyframes: [{ timeMs: 0, rectangle }] } }] }] };
    const catalog = await loadBundledStickerAssets(path.resolve("resources/stickers/downloaded"));
    const phoneId = "fluent-052f235f47d4b51d38230872b15c7aa990c27176";
    const offline = vi.fn(async (): Promise<Response> => { throw Error("unexpected asset network"); });
    const library = new AssetLibrary(path.join(directory, "library"), offline, LIBRARY_STICKERS.filter(item => item.id === phoneId));
    const options = DecorationSchema.parse({ mode: "random", sticker: "none", frame: { mode: "none" }, displayText: { enabled: false, x: .5, y: .1 } });
    const empty = {} as StickerAssets;
    expect((await library.prepare(options, empty))[phoneId]).toBeUndefined();
    const prepared = await library.prepare(options, empty, [media.id], true);
    expect(prepared[phoneId]).toBeDefined(); expect(offline).not.toHaveBeenCalled();
    const assets = kind === "corner" ? { "local-custom-006": catalog["local-custom-006"] } : prepared;
    const layers = await createHumanRegionCover({ draft, media: [media], preset: DEFAULT_PRESET, assets: assets as unknown as StickerAssets,
      tools, directory: path.join(directory, "frozen"), random: false })(media, 1, "catalog", new AbortController().signal);
    const binding = layers[0].cover!.humanRegion!;
    expect(binding.placement.width).toBeLessThanOrEqual(binding.target.width + 2 * Math.floor(binding.target.width / 4));
    const decoded = await decodeShapeCoverPng(await readFile(layers[0].assetPath), binding.projection, tools);
    expect(opaqueRegionCovered(Uint8Array.from({ length: decoded.length / 4 }, (_, p) => decoded[p * 4 + 3]), binding.projection, binding.target)).toBe(true);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60000);
