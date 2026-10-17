import { expect, it, vi } from "vitest";
import * as shapeSearch from "../src/main/shape-cover-hybrid-shape";
import { humanRegionArtworkScope, opaqueRegionCovered, projectHumanRectangle } from "../src/main/human-region-geometry";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHumanRegionCover, type HumanRegionIntent } from "../src/main/human-region-cover";
import { encodeRgbaPng, type StickerAssets } from "../src/main/builtin-stickers";
import { DEFAULT_PRESET, now, type MediaItem } from "../src/main/domain";
import { FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { decodeShapeCoverPng } from "../src/main/shape-cover-alpha";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin";
import { ProviderError } from "../src/main/agent-provider";

it.each([false, true])("stops at the first suitable manual-cover sticker after skipping a non-fit (random=%s)", async random => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-first-fit-"));
  try {
    const tools = new FfmpegAdapter(ffmpegBin, ffprobeBin), sourcePath = path.join(directory, "source.mp4");
    const generated = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=24", "-t", "1", "-c:v", "libx264", sourcePath]).promise;
    expect(generated.code, generated.stderr).toBe(0);
    const media: MediaItem = { id: randomUUID(), sourcePath, fingerprint: await fingerprintFile(sourcePath), displayName: "first fit", durationMs: 1000,
      width: 160, height: 120, rotation: 0, sizeBytes: (await stat(sourcePath)).size, importedAt: now(), probeStatus: "ready" };
    const id = randomUUID();
    const draft: HumanRegionIntent = { id: randomUUID(), projectId: randomUUID(), revision: 0, assistedArtwork: "human-region-v1", admission: "manual-production-v1",
      media: [{ mediaId: media.id, sourceFingerprint: media.fingerprint, disposition: "cover", identities: [{ id, label: "target", semantics: "sticker", origin: "human" }],
        segments: [{ id, identityId: id, origin: "human", track: { startMs: 0, endMs: 1000,
          keyframes: [{ timeMs: 0, rectangle: { x: .1, y: .1, width: .2, height: .1 } }] } }] }] };
    const assetPath = path.join(directory, "solid.png");
    await writeFile(assetPath, encodeRgbaPng(Buffer.alloc(40 * 16 * 4, 255), 40, 16));
    const asset = { assetPath, assetFingerprint: await fingerprintFile(assetPath) };
    const assets = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`uploaded-${i.toString(16).padStart(64, "0")}`, asset])) as StickerAssets;
    const original = shapeSearch.searchHybridCornerShape;
    let attempts = 0;
    const search = vi.spyOn(shapeSearch, "searchHybridCornerShape").mockImplementation((...args) => {
      if (++attempts === 1) return Promise.resolve(null);
      if (attempts > 2) throw Error("inspected another sticker after a suitable match");
      return original(...args);
    });
    try {
      const prepare = createHumanRegionCover({ draft, media: [media], preset: { ...DEFAULT_PRESET, resolutionMode: "source" }, assets,
        tools, directory: path.join(directory, "frozen"), random });
      const layers = await prepare(media, 1, "first-fit", new AbortController().signal);
      expect(search).toHaveBeenCalledTimes(2);
      expect(layers[0].cover!.stickerId).toBe(search.mock.calls[1][0][0].id);
      const binding = layers[0].cover!.humanRegion!;
      const rgba = await decodeShapeCoverPng(await readFile(layers[0].assetPath), binding.projection, tools);
      expect(opaqueRegionCovered(Uint8Array.from({ length: rgba.length / 4 }, (_, p) => rgba[p * 4 + 3]), binding.projection, binding.target)).toBe(true);
      expect(await prepare(media, 1, "frozen-retry", new AbortController().signal)).toEqual(layers);
      expect(search).toHaveBeenCalledTimes(2);
    } finally { search.mockRestore(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60000);

it("varies equally fitting random cover artwork across media instead of reusing the first sorted IDs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-diversity-"));
  try {
    const tools = new FfmpegAdapter(ffmpegBin, ffprobeBin), sourcePath = path.join(directory, "source.mp4");
    const generated = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=24", "-t", "1", "-c:v", "libx264", sourcePath]).promise;
    expect(generated.code, generated.stderr).toBe(0);
    const media: MediaItem[] = Array.from({ length: 8 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, sourcePath,
      fingerprint: "", displayName: "equal-fit", durationMs: 1000, width: 160, height: 120, rotation: 0, sizeBytes: 0, importedAt: now(), probeStatus: "ready" }));
    const fingerprint = await fingerprintFile(sourcePath), sizeBytes = (await stat(sourcePath)).size;
    media.forEach(item => Object.assign(item, { fingerprint, sizeBytes }));
    const identity = "00000000-0000-4000-8000-999999999999";
    const draft: HumanRegionIntent = { id: randomUUID(), projectId: randomUUID(), revision: 0, assistedArtwork: "human-region-v1", admission: "manual-production-v1",
      media: media.map(item => ({ mediaId: item.id, sourceFingerprint: fingerprint, disposition: "cover",
        identities: [{ id: identity, label: "target", semantics: "sticker", origin: "human" }],
        segments: [{ id: identity, identityId: identity, origin: "human", track: { startMs: 0, endMs: 1000,
          keyframes: [{ timeMs: 0, rectangle: { x: .1, y: .1, width: .2, height: .1 } }] } }] })) };
    const assetPath = path.join(directory, "solid.png");
    await writeFile(assetPath, encodeRgbaPng(Buffer.alloc(40 * 16 * 4, 255), 40, 16));
    const asset = { assetPath, assetFingerprint: await fingerprintFile(assetPath) };
    const assets = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`uploaded-${i.toString(16).padStart(64, "0")}`, asset])) as StickerAssets;
    const prepare = createHumanRegionCover({ draft, media, preset: { ...DEFAULT_PRESET, resolutionMode: "source" }, assets,
      tools, directory: path.join(directory, "frozen"), random: true });
    const selected = [];
    for (const item of media) {
      const layers = await prepare(item, 1, "fixed-diversity-run", new AbortController().signal);
      selected.push(layers[0].cover!.stickerId);
      expect(await prepare(item, 1, "same-version", new AbortController().signal)).toEqual(layers);
    }
    expect(new Set(selected).size).toBeGreaterThan(1);
    expect(selected.some(id => parseInt(id.slice(9), 16) >= 8)).toBe(true);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60000);

it("reports a genuinely impossible last target without exhausting unrelated sticker combinations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-no-fit-prune-"));
  try {
    const tools = new FfmpegAdapter(ffmpegBin, ffprobeBin), sourcePath = path.join(directory, "source.mp4");
    const generated = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=24", "-t", "1", "-c:v", "libx264", sourcePath]).promise;
    expect(generated.code, generated.stderr).toBe(0);
    const media: MediaItem = { id: randomUUID(), sourcePath, fingerprint: await fingerprintFile(sourcePath), displayName: "no fit", durationMs: 1000,
      width: 160, height: 120, rotation: 0, sizeBytes: (await stat(sourcePath)).size, importedAt: now(), probeStatus: "ready" };
    const ids = Array.from({ length: 6 }, () => randomUUID());
    const draft: HumanRegionIntent = { id: randomUUID(), projectId: randomUUID(), revision: 0, assistedArtwork: "human-region-v1", admission: "manual-production-v1",
      media: [{ mediaId: media.id, sourceFingerprint: media.fingerprint, disposition: "cover",
        identities: ids.map(id => ({ id, label: "target", semantics: "sticker", origin: "human" })),
        segments: ids.map((id, index) => ({ id, identityId: id, origin: "human", track: { startMs: 0, endMs: 1000,
          keyframes: [{ timeMs: 0, rectangle: { x: .1, y: index === 5 ? .8 : .1, width: .2, height: .1 } }] } })) }] };
    const assetPath = path.join(directory, "solid.png"); await writeFile(assetPath, encodeRgbaPng(Buffer.alloc(40 * 16 * 4, 255), 40, 16));
    const asset = { assetPath, assetFingerprint: await fingerprintFile(assetPath) };
    const assets = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`uploaded-${i.toString(16).padStart(64, "0")}`, asset])) as StickerAssets;
    const original = shapeSearch.searchHybridCornerShape;
    let positive: ReturnType<typeof original> | undefined;
    const search = vi.spyOn(shapeSearch, "searchHybridCornerShape").mockImplementation((candidates, ...args) => {
      if (args[0][100 * 160 + 20]) return Promise.resolve(null);
      positive ??= original(candidates, ...args);
      return positive;
    });
    try {
      const prepare = createHumanRegionCover({ draft, media: [media], preset: { ...DEFAULT_PRESET, resolutionMode: "source" }, assets,
        tools, directory: path.join(directory, "frozen"), random: true });
      await expect(prepare(media, 1, "no-fit", new AbortController().signal)).rejects.toThrow(/没有贴纸/);
      expect(search.mock.calls.length).toBeLessThanOrEqual(72);
      expect(await readdir(path.join(directory, "frozen"))).toEqual([]);
    } finally { search.mockRestore(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60000);

it("keeps reassignment when the only artwork for a later target is temporarily used by an earlier target", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-reassign-cover-"));
  try {
    const tools = new FfmpegAdapter(ffmpegBin, ffprobeBin), sourcePath = path.join(directory, "source.mp4");
    const generated = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=24", "-t", "1", "-c:v", "libx264", sourcePath]).promise;
    expect(generated.code, generated.stderr).toBe(0);
    const media: MediaItem = { id: "00000000-0000-4000-8000-000000000001", sourcePath, fingerprint: await fingerprintFile(sourcePath), displayName: "reassign", durationMs: 1000,
      width: 160, height: 120, rotation: 0, sizeBytes: (await stat(sourcePath)).size, importedAt: now(), probeStatus: "ready" };
    const ids = ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"];
    const draft: HumanRegionIntent = { id: randomUUID(), projectId: randomUUID(), revision: 0, assistedArtwork: "human-region-v1", admission: "manual-production-v1",
      media: [{ mediaId: media.id, sourceFingerprint: media.fingerprint, disposition: "cover",
        identities: ids.map(id => ({ id, label: "target", semantics: "sticker", origin: "human" })),
        segments: ids.map((id, index) => ({ id, identityId: id, origin: "human", track: { startMs: 0, endMs: 1000,
          keyframes: [{ timeMs: 0, rectangle: { x: .1, y: index ? .8 : .1, width: .2, height: .1 } }] } })) }] };
    const assetPath = path.join(directory, "solid.png"); await writeFile(assetPath, encodeRgbaPng(Buffer.alloc(40 * 16 * 4, 255), 40, 16));
    const asset = { assetPath, assetFingerprint: await fingerprintFile(assetPath) }, first = `uploaded-${"1".repeat(64)}`, second = `uploaded-${"2".repeat(64)}`;
    const assets = { [first]: asset, [second]: asset } as StickerAssets, original = shapeSearch.searchHybridCornerShape;
    const search = vi.spyOn(shapeSearch, "searchHybridCornerShape").mockImplementation((candidates, ...args) =>
      args[0][100 * 160 + 20] && candidates[0].id === second ? Promise.resolve(null) : original(candidates, ...args));
    try {
      const layers = await createHumanRegionCover({ draft, media: [media], preset: { ...DEFAULT_PRESET, resolutionMode: "source" }, assets,
        tools, directory: path.join(directory, "frozen"), random: true })(media, 1, "reassign-first", new AbortController().signal);
      // This seed initially gives the earlier target the later target's only fit.
      expect(search.mock.calls[0][0][0].id).toBe(first);
      expect(search.mock.calls[1][1][100 * 160 + 20]).toBe(1);
      expect(layers.map(layer => layer.cover!.stickerId)).toEqual([second, first]);
    } finally { search.mockRestore(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60000);

it("requires every target pixel to be originally fully opaque, including holes and translucent edges", () => {
  const size = { width: 6, height: 6 }, target = { x: 1, y: 1, width: 4, height: 4 };
  const alpha = new Uint8Array(36).fill(255);
  expect(opaqueRegionCovered(alpha, size, target)).toBe(true);
  alpha[14] = 254;
  expect(opaqueRegionCovered(alpha, size, target)).toBe(false);
  alpha[14] = 0;
  expect(opaqueRegionCovered(alpha, size, target)).toBe(false);
  alpha[14] = 255; alpha[0] = 0;
  expect(opaqueRegionCovered(alpha, size, target)).toBe(true);
});

it.each([100, 14])("uses the first bounded fit for a bottom strip with an earlier %spx-tall candidate", async (height) => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-compact-cover-"));
  try {
    const sourcePath = path.join(directory, "source.mp4"), tools = new FfmpegAdapter(ffmpegBin, ffprobeBin);
    const generated = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=24", "-t", "1", "-c:v", "libx264", sourcePath]).promise;
    expect(generated.code, generated.stderr).toBe(0);
    const media: MediaItem = { id: randomUUID(), sourcePath, fingerprint: await fingerprintFile(sourcePath), displayName: "strip", durationMs: 1000,
      width: 160, height: 120, rotation: 0, sizeBytes: (await stat(sourcePath)).size, importedAt: now(), probeStatus: "ready" };
    const identityId = randomUUID(), segmentId = randomUUID();
    const draft: HumanRegionIntent = { id: randomUUID(), projectId: randomUUID(), revision: 0, assistedArtwork: "human-region-v1", admission: "manual-production-v1",
      media: [{ mediaId: media.id, sourceFingerprint: media.fingerprint, disposition: "cover", identities: [{ id: identityId, label: "strip", semantics: "sticker", origin: "human" }],
        segments: [{ id: segmentId, identityId, origin: "human", track: { startMs: 0, endMs: 1000, keyframes: [{ timeMs: 0, rectangle: { x: .1, y: .9, width: .75, height: .1 } }] } }] }] };
    const assets = {} as Record<string, { assetPath: string; assetFingerprint: string }>;
    for (const [letter, h] of [["1", height], ["f", 12]] as const) {
      const assetPath = path.join(directory, `${letter}.png`), rgba = Buffer.alloc(100 * h * 4);
      for (let p = 0; p < rgba.length; p += 4) rgba.set([240, 30, 40, 255], p);
      await writeFile(assetPath, encodeRgbaPng(rgba, 100, h));
      assets[`uploaded-${letter.repeat(64)}`] = { assetPath, assetFingerprint: await fingerprintFile(assetPath) };
    }
    const preset = { ...DEFAULT_PRESET, resolutionMode: "source" as const };
    const prepare = createHumanRegionCover({ draft, media: [media], preset, assets: assets as StickerAssets, tools, directory: path.join(directory, "frozen"), random: false });
    const layers = await prepare(media, 1, "compact", new AbortController().signal), layer = layers[0];
    expect(layer.cover!.stickerId).toBe(`uploaded-${(height === 100 ? "f" : "1").repeat(64)}`);
    const binding = layer.cover!.humanRegion!, target = binding.target, visible = binding.visualBounds, scope = humanRegionArtworkScope(target);
    expect(visible.y).toBeGreaterThanOrEqual(Math.max(0, scope.y));
    expect(visible.y + visible.height).toBeLessThanOrEqual(Math.min(binding.projection.height, scope.y + scope.height));
    expect(binding.placement.height).toBeLessThanOrEqual(target.height * 3);
    const png = await readFile(layer.assetPath), rgba = await decodeShapeCoverPng(png, binding.projection, tools);
    const alpha = Uint8Array.from({ length: rgba.length / 4 }, (_, p) => rgba[p * 4 + 3]);
    expect(opaqueRegionCovered(alpha, binding.projection, target)).toBe(true);
    expect(await prepare(media, 1, "same-version", new AbortController().signal)).toEqual(layers);
    expect((await readdir(path.join(directory, "frozen"))).filter(name => name.endsWith(".png"))).toHaveLength(1);
    // A fresh version keeps the existing rotation rule, but never admits the huge square.
    const next = await prepare(media, 2, "next-version", new AbortController().signal);
    expect(next[0].cover!.stickerId).toBe(`uploaded-${"f".repeat(64)}`);
    if (height === 100) {
      const onlyHuge = createHumanRegionCover({ draft, media: [media], preset, assets: { [`uploaded-${"1".repeat(64)}`]: assets[`uploaded-${"1".repeat(64)}`] } as StickerAssets,
        tools, directory: path.join(directory, "no-fit"), random: true });
      await expect(onlyHuge(media, 1, "no-fit", new AbortController().signal)).rejects.toThrow(/没有贴纸/);
      await expect(onlyHuge(media, 1, "no-fit", new AbortController().signal)).rejects.toBeInstanceOf(ProviderError);
      expect(await readdir(path.join(directory, "no-fit"))).toEqual([]);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60000);

it("projects the user's whole region through measured scale and padding with outward pixel support", () => {
  const p = { width: 1280, height: 720, scaledWidth: 720, scaledHeight: 720, padLeft: 280, padTop: 0 };
  expect(projectHumanRectangle({ x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, { width: 1000, height: 1000 }, p))
    .toEqual({ x: 350, y: 142, width: 148, height: 220 });
  expect(() => projectHumanRectangle({ x: -0.1, y: 0, width: 0.2, height: 0.3 }, { width: 1000, height: 1000 }, p)).toThrow();
});
