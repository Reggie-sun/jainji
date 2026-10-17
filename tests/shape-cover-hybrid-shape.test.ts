import { expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import * as alphaTools from "../src/main/shape-cover-alpha.js";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeShapeCoverPng, rasterizeShapeCoverAlpha, rasterizeShapeCoverAlphaBatch, trimShapeCoverArtwork } from "../src/main/shape-cover-alpha.js";
import { freezeShapeCoverRaster } from "../src/main/shape-cover-freeze.js";
import { searchHybridCornerShape, HYBRID_SHAPE_SEARCH } from "../src/main/shape-cover-hybrid-shape.js";
import { discoveryHash } from "../src/main/source-fact-discovery-evidence.js";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin.js";
import { loadHumanRegionArtworkIndex, prepareHumanRegionArtworkIndex } from "../src/main/human-region-artwork-index.js";
import * as artworkIndex from "../src/main/human-region-artwork-index.js";
import { UploadedStickers } from "../src/main/uploaded-stickers.js";

const tools = { ffmpegPath: ffmpegBin, ffprobePath: ffprobeBin };
it("validates cached PNGs locally without starting a media decode", async () => {
  const root = await mkdtemp(join(tmpdir(), "cached-artwork-local-decode-"));
  try {
    const indexed = { ...tools, artworkIndexDirectory: root };
    const bytes = await encodeShapeCoverPng(Buffer.alloc(4 * 3 * 4, 255), { width: 4, height: 3 }, tools);
    const asset = { assetPath: join(root, "unused.png"), assetFingerprint: `sha256:${discoveryHash(bytes)}` };
    await loadHumanRegionArtworkIndex(asset, bytes, indexed);
    const decode = vi.spyOn(alphaTools, "decodeShapeCoverPng");
    expect((await loadHumanRegionArtworkIndex(asset, bytes, indexed)).trimmed.bytes).toEqual(bytes);
    expect(decode).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); }
});

it("rebuilds a cache with duplicate PNG headers before its dimensions can override the preflight", async () => {
  const root = await mkdtemp(join(tmpdir(), "cached-artwork-header-"));
  try {
    const indexed = { ...tools, artworkIndexDirectory: root };
    const bytes = await encodeShapeCoverPng(Buffer.alloc(4 * 3 * 4, 255), { width: 4, height: 3 }, tools);
    const asset = { assetPath: join(root, "unused.png"), assetFingerprint: `sha256:${discoveryHash(bytes)}` };
    await loadHumanRegionArtworkIndex(asset, bytes, indexed);
    const file = join(root, (await readdir(root))[0]), data = JSON.parse(await readFile(file, "utf8"));
    const png = Buffer.from(data.trimmedPng.base64, "base64");
    const duplicate = Buffer.concat([png.subarray(0, 33), png.subarray(8, 33), png.subarray(33)]);
    data.trimmedPng.base64 = duplicate.toString("base64"); data.trimmedPng.sha256 = discoveryHash(duplicate);
    await writeFile(file, JSON.stringify(data));
    const trim = vi.spyOn(alphaTools, "trimShapeCoverArtwork");
    await loadHumanRegionArtworkIndex(asset, bytes, indexed);
    expect(trim).toHaveBeenCalledTimes(1);
  } finally { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); }
});

it("batch alpha rasters exactly match scalar FFmpeg output in one decode", async () => {
  const sourceSize = { width: 19, height: 13 }, rgba = Buffer.alloc(sourceSize.width * sourceSize.height * 4);
  for (let y = 0; y < sourceSize.height; y++) for (let x = 0; x < sourceSize.width; x++) {
    const pixel = (y * sourceSize.width + x) * 4;
    rgba[pixel] = (x * 37 + y * 11) % 256; rgba[pixel + 1] = (x * 13 + y * 29) % 256; rgba[pixel + 2] = (x * 3 + y * 17) % 256;
    rgba[pixel + 3] = (x + 2 * y) % 7 === 0 ? 0 : (x + y) % 4 === 0 ? 83 : (x + y) % 3 === 0 ? 173 : 255;
  }
  const bytes = await encodeShapeCoverPng(rgba, sourceSize, tools);
  const sizes = [{ width: 13, height: 7 }, { width: 8, height: 11 }, { width: 1, height: 1 }, { width: 17, height: 5 }, { width: 9, height: 13 }];
  const batched = await rasterizeShapeCoverAlphaBatch(bytes, sizes, tools);
  expect(batched).toHaveLength(sizes.length);
  for (let index = 0; index < sizes.length; index++) {
    const size = sizes[index];
    const scalar = await rasterizeShapeCoverAlpha(bytes, size, { ...size, x: 0, y: 0 }, tools);
    expect(batched[index]).toEqual(scalar.alpha);
    expect((await rasterizeShapeCoverAlphaBatch(bytes, [size], tools))[0]).toEqual(scalar.alpha);
  }
});

it("batch alpha preflights bounds and rejects animated or cancelled media", async () => {
  const bytes = await encodeShapeCoverPng(Buffer.alloc(8 * 8 * 4, 255), { width: 8, height: 8 }, tools);
  await expect(rasterizeShapeCoverAlphaBatch(bytes, [{ width: 0, height: 1 }], tools)).rejects.toThrow(/invalid/i);
  await expect(rasterizeShapeCoverAlphaBatch(bytes, Array.from({ length: 17 }, () => ({ width: 1, height: 1 })), tools)).rejects.toThrow(/invalid/i);
  await expect(rasterizeShapeCoverAlphaBatch(bytes, [{ width: 4096, height: 4096 }, { width: 1, height: 4096 }], tools)).rejects.toThrow(/invalid|exceeds/i);
  await expect(rasterizeShapeCoverAlphaBatch(bytes, [{ width: 1, height: 1 }], { ...tools, signal: AbortSignal.abort() })).rejects.toThrow();

  const animated = execFileSync(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:s=8x8:r=2",
    "-frames:v", "2", "-c:v", "mjpeg", "-f", "image2pipe", "pipe:1"], { maxBuffer: 1024 * 1024 });
  await expect(rasterizeShapeCoverAlphaBatch(animated, [{ width: 8, height: 8 }], tools)).rejects.toThrow();
});

it("builds the cover index on import and reuses exact alpha across independent searches", async () => {
  const root = await mkdtemp(join(tmpdir(), "sticker-durable-index-"));
  const indexed = { ...tools, artworkIndexDirectory: join(root, "indexes") };
  const trim = vi.spyOn(alphaTools, "trimShapeCoverArtwork"), rasterize = vi.spyOn(alphaTools, "rasterizeShapeCoverArtwork"), loadIndex = vi.spyOn(artworkIndex, "loadHumanRegionArtworkIndex");
  try {
    const bytes = await encodeShapeCoverPng(Buffer.alloc(16 * 8 * 4, 255), { width: 16, height: 8 }, tools);
    const source = join(root, "upload.png"); await writeFile(source, bytes);
    const store = new UploadedStickers(join(root, "uploads"), png => png, "sticker", asset => prepareHumanRegionArtworkIndex(asset, indexed));
    const imported = await store.importFile(source);
    expect(trim).toHaveBeenCalledTimes(1);
    expect(await readdir(indexed.artworkIndexDirectory)).toHaveLength(1);
    const size = { width: 80, height: 60 }, scope = { x: 0, y: 0, width: 80, height: 60 };
    const old = new Uint8Array(4800); for (let y = 10; y < 18; y++) old.fill(1, y * 80 + 10, y * 80 + 26);
    const first = await searchHybridCornerShape([imported], old, size, scope, 1, indexed, "compact-artwork", new Map());
    const measurements = rasterize.mock.calls.length;
    const cache = new Map();
    const second = await searchHybridCornerShape([imported], old, size, scope, 1, indexed, "compact-artwork", cache);
    expect(first).not.toBeNull(); expect(second!.placement).toEqual(first!.placement);
    expect(second!.raster.rgba).toEqual(first!.raster.rgba);
    expect(trim).toHaveBeenCalledTimes(1);
    expect(rasterize.mock.calls.length).toBe(measurements);
    const indexLoads = loadIndex.mock.calls.length;
    await searchHybridCornerShape([imported], old, size, scope, 1, indexed, "compact-artwork", cache);
    expect(loadIndex.mock.calls.length).toBe(indexLoads);
    const index = await loadHumanRegionArtworkIndex(imported.asset, bytes, indexed);
    const produce = vi.fn(async () => new Uint8Array(35).fill(254));
    expect(await index.alpha(7, 5, produce)).toEqual(new Uint8Array(35).fill(254));
    const reloaded = await loadHumanRegionArtworkIndex(imported.asset, bytes, indexed);
    expect(await reloaded.alpha(7, 5, produce)).toEqual(new Uint8Array(35).fill(254));
    expect(produce).toHaveBeenCalledTimes(1);
    await writeFile(imported.asset.assetPath, Buffer.from("changed"));
    await expect(searchHybridCornerShape([imported], old, size, scope, 1, indexed, "compact-artwork", new Map())).rejects.toThrow("HYBRID_CATALOG_BINDING");
  } finally { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); }
}, 60000);

it("repairs damaged indexes, invalidates decoder identity, and never writes after cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "sticker-index-repair-"));
  const indexed = { ...tools, artworkIndexDirectory: join(root, "indexes") };
  const trim = vi.spyOn(alphaTools, "trimShapeCoverArtwork");
  try {
    const bytes = await encodeShapeCoverPng(Buffer.alloc(8 * 8 * 4, 255), { width: 8, height: 8 }, tools);
    const asset = { assetPath: join(root, "asset.png"), assetFingerprint: `sha256:${discoveryHash(bytes)}` }; await writeFile(asset.assetPath, bytes);
    await prepareHumanRegionArtworkIndex(asset, indexed);
    const [name] = await readdir(indexed.artworkIndexDirectory), file = join(indexed.artworkIndexDirectory, name);
    await writeFile(file, "{truncated");
    const repaired = await loadHumanRegionArtworkIndex(asset, bytes, indexed);
    expect(repaired.trimmed.trimBox).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    expect(trim).toHaveBeenCalledTimes(2);
    const malformed = JSON.parse((await readFile(file)).toString());
    const truncated = Buffer.from(malformed.trimmedPng.base64, "base64").subarray(0, 33);
    malformed.trimmedPng.base64 = truncated.toString("base64");
    malformed.trimmedPng.sha256 = discoveryHash(truncated);
    await writeFile(file, JSON.stringify(malformed));
    await loadHumanRegionArtworkIndex(asset, bytes, indexed);
    expect(trim).toHaveBeenCalledTimes(3);
    const staleDecoder = JSON.parse((await readFile(file)).toString());
    staleDecoder.decoder.ffmpeg.mtimeMs -= 1;
    await writeFile(file, JSON.stringify(staleDecoder));
    await loadHumanRegionArtworkIndex(asset, bytes, indexed);
    expect(trim).toHaveBeenCalledTimes(4);
    await expect(loadHumanRegionArtworkIndex({ ...asset, assetFingerprint: `sha256:${"f".repeat(64)}` }, bytes, indexed)).rejects.toThrow();
    const saved = await readFile(file);
    await expect(loadHumanRegionArtworkIndex(asset, bytes, { ...indexed, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(await readFile(file)).toEqual(saved);
    await expect(loadHumanRegionArtworkIndex(asset, bytes, { ...indexed, ffprobePath: join(root, "missing") })).rejects.toThrow();
  } finally { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); }
}, 60000);

it("keeps valid ordinary uploads usable when cover indexing is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "sticker-index-optional-"));
  try {
    const bytes = await encodeShapeCoverPng(Buffer.alloc(8 * 8 * 4, 255), { width: 8, height: 8 }, tools);
    const source = join(root, "upload.png"); await writeFile(source, bytes);
    const unavailable = { ffmpegPath: join(root, "missing-ffmpeg"), ffprobePath: join(root, "missing-ffprobe"), artworkIndexDirectory: join(root, "indexes") };
    const store = new UploadedStickers(join(root, "uploads"), png => png, "sticker", asset => prepareHumanRegionArtworkIndex(asset, unavailable));
    const imported = await store.importFile(source);
    expect((await store.load())[imported.id]).toEqual(imported.asset);
    const indexed = await loadHumanRegionArtworkIndex(imported.asset, bytes, { ...tools, artworkIndexDirectory: source });
    expect(indexed.trimmed.trimBox.width).toBe(8);
    // Preparation is optional for ordinary uploads, cancellation remains binding.
    await expect(prepareHumanRegionArtworkIndex(imported.asset, { ...unavailable, signal: AbortSignal.abort() })).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);

it("reuses measured artwork sizes across targets while rechecking the asset bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "h3-raster-cache-"));
  const rasterize = vi.spyOn(alphaTools, "rasterizeShapeCoverArtwork");
  try {
    const bytes = await encodeShapeCoverPng(Buffer.alloc(16 * 8 * 4, 255), { width: 16, height: 8 }, tools);
    const assetPath = join(root, "fixture.png"); await writeFile(assetPath, bytes);
    const candidate = { id: "heart", asset: { assetPath, assetFingerprint: `sha256:${discoveryHash(bytes)}` } };
    const size = { width: 80, height: 60 }, scope = { x: 0, y: 0, width: 80, height: 60 }, cache = new Map();
    const old = new Uint8Array(4800); for (let y = 10; y < 18; y++) old.fill(1, y * 80 + 10, y * 80 + 26);
    const first = await searchHybridCornerShape([candidate], old, size, scope, 1, tools, "compact-artwork", cache);
    const measured = rasterize.mock.calls.length;
    const second = await searchHybridCornerShape([candidate], old, size, scope, 1, tools, "compact-artwork", cache);
    expect(first).not.toBeNull(); expect(second!.placement).toEqual(first!.placement);
    expect(second!.raster.rgba).toEqual(first!.raster.rgba);
    // A second target/search must not run the same FFmpeg size ladder again.
    expect(measured).toBeGreaterThan(1);
    expect(rasterize.mock.calls.length - measured).toBe(0);
    await writeFile(assetPath, Buffer.from("changed"));
    await expect(searchHybridCornerShape([candidate], old, size, scope, 1, tools, "compact-artwork", cache)).rejects.toThrow("HYBRID_CATALOG_BINDING");
    await expect(searchHybridCornerShape([candidate], old, size, scope, 1, { ...tools, signal: AbortSignal.abort() }, "compact-artwork", cache)).rejects.toThrow();
  } finally { rasterize.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 60000);
it("transparent trim preserves every visual pixel, including partial alpha", async () => {
  const size = { width: 12, height: 10 }, rgba = Buffer.alloc(480);
  for (let y = 2; y < 8; y++) for (let x = 3; x < 10; x++) { const p = (y * 12 + x) * 4; rgba[p] = 200; rgba[p + 3] = x === 3 ? 128 : 255; }
  const trimmed = await trimShapeCoverArtwork(await encodeShapeCoverPng(rgba, size, tools), tools);
  expect(trimmed.trimBox).toEqual({ x: 3, y: 2, width: 7, height: 6 });
  expect(trimmed.sha256).toHaveLength(64);
});
it("final decoded PNG rejects even one uncovered pixel and alpha=254", async () => {
  const size = { width: 8, height: 8 }, old = new Uint8Array(64), alpha = new Uint8Array(64), rgba = Buffer.alloc(256);
  old[27] = 1; alpha[27] = 254; rgba[27 * 4 + 3] = 254;
  await expect(freezeShapeCoverRaster({ alpha, rgba }, old, size, 0, tools)).rejects.toThrow(/uncovered/);
  alpha[27] = 255; rgba[27 * 4 + 3] = 255;
  const frozen = await freezeShapeCoverRaster({ alpha, rgba }, old, size, 0, tools);
  expect(frozen.coverage).toEqual({ oldPixels: 1, uncoveredPixels: 0, coverageFraction: 1 });
  expect(frozen.decoded[27 * 4 + 3]).toBe(255);
});
it("search is deterministic and a fully transparent pool cannot become a rectangle fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "h3-shape-")), size = { width: 32, height: 32 }, scope = { x: 0, y: 0, width: 16, height: 16 };
  try {
    const bytes = await encodeShapeCoverPng(Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 }, tools), assetPath = join(root, "fixture.png");
    await writeFile(assetPath, bytes); const candidate = { id: "heart", asset: { assetPath, assetFingerprint: `sha256:${discoveryHash(bytes)}` } };
    const old = new Uint8Array(1024); for (let y = 5; y < 9; y++) for (let x = 5; x < 9; x++) old[y * 32 + x] = 1;
    const a = await searchHybridCornerShape([candidate], old, size, scope, 1, tools), b = await searchHybridCornerShape([candidate], old, size, scope, 1, tools);
    expect(a).not.toBeNull(); expect(a!.placement).toEqual(b!.placement); expect(a!.alphaSha256).toBe(b!.alphaSha256);
    expect(Object.isFrozen(HYBRID_SHAPE_SEARCH.sizeFactors)).toBe(true);
    await expect(searchHybridCornerShape([candidate], old, size, scope, 1, { ...tools, ffprobePath: join(root, "missing-probe") })).rejects.toThrow(/ENOENT/);
    const empty = await encodeShapeCoverPng(Buffer.alloc(16 * 16 * 4), { width: 16, height: 16 }, tools); await writeFile(assetPath, empty);
    expect(await searchHybridCornerShape([{ ...candidate, asset: { assetPath, assetFingerprint: `sha256:${discoveryHash(empty)}` } }], old, size, scope, 1, tools)).toBeNull();
    await expect(searchHybridCornerShape([candidate], old, size, scope, 1, tools)).rejects.toThrow("HYBRID_CATALOG_BINDING");
    await expect(searchHybridCornerShape(Array(257).fill(candidate), old, size, scope, 1, tools)).rejects.toThrow("HYBRID_SEARCH_LIMIT");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
