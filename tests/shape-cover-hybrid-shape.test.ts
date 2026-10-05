import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeShapeCoverPng, trimShapeCoverArtwork } from "../src/main/shape-cover-alpha.js";
import { freezeShapeCoverRaster } from "../src/main/shape-cover-freeze.js";
import { searchHybridCornerShape, HYBRID_SHAPE_SEARCH } from "../src/main/shape-cover-hybrid-shape.js";
import { discoveryHash } from "../src/main/source-fact-discovery-evidence.js";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin.js";

const tools = { ffmpegPath: ffmpegBin, ffprobePath: ffprobeBin };
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
