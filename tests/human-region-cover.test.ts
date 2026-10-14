import { expect, it } from "vitest";
import { opaqueRegionCovered, projectHumanRectangle } from "../src/main/human-region-geometry";
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

it.each([100, 14])("selects compact artwork for a bottom strip instead of the earlier %spx-tall artwork", async (height) => {
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
    const prepare = createHumanRegionCover({ draft, media: [media], preset, assets: assets as StickerAssets, tools, directory: path.join(directory, "frozen"), random: true });
    const layers = await prepare(media, 1, "compact", new AbortController().signal), layer = layers[0];
    expect(layer.cover!.stickerId).toBe(`uploaded-${"f".repeat(64)}`);
    const binding = layer.cover!.humanRegion!, target = binding.target, visible = binding.visualBounds;
    expect(visible.y).toBeGreaterThanOrEqual(target.y - Math.floor(target.height / 4));
    expect(visible.height).toBeLessThanOrEqual(target.height + 2 * Math.floor(target.height / 4));
    const png = await readFile(layer.assetPath), rgba = await decodeShapeCoverPng(png, binding.projection, tools);
    const alpha = Uint8Array.from({ length: rgba.length / 4 }, (_, p) => rgba[p * 4 + 3]);
    expect(opaqueRegionCovered(alpha, binding.projection, target)).toBe(true);
    expect(await prepare(media, 1, "same-version", new AbortController().signal)).toEqual(layers);
    expect((await readdir(path.join(directory, "frozen"))).filter(name => name.endsWith(".png"))).toHaveLength(1);
    // A fresh version keeps the existing rotation rule, but never admits the huge square.
    const next = await prepare(media, 2, "next-version", new AbortController().signal);
    expect(next[0].cover!.stickerId).toBe(`uploaded-${(height === 100 ? "f" : "1").repeat(64)}`);
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
