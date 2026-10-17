import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { createHumanRegionCover, type HumanRegionIntent } from "../src/main/human-region-cover";
import { encodeRgbaPng, type StickerAssets } from "../src/main/builtin-stickers";
import { DEFAULT_PRESET, now, type MediaItem } from "../src/main/domain";
import { FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { decodeShapeCoverPng } from "../src/main/shape-cover-alpha";
import { opaqueRegionCovered } from "../src/main/human-region-geometry";
import * as shapeSearch from "../src/main/shape-cover-hybrid-shape";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin";

type Fixture = { tools: FfmpegAdapter; media: MediaItem; draft: HumanRegionIntent; assetId: string; assetPath: string };
const stickerId = `uploaded-${"a".repeat(64)}`;

async function fixture(directory: string, target = { x: .1, y: .1, width: .2, height: .1 }): Promise<Fixture> {
  const tools = new FfmpegAdapter(ffmpegBin, ffprobeBin);
  tools.artworkIndexDirectory = path.join(directory, "artwork-index");
  const sourcePath = path.join(directory, "source.mp4");
  const generated = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=24", "-t", "1", "-c:v", "libx264", sourcePath]).promise;
  expect(generated.code, generated.stderr).toBe(0);
  const media: MediaItem = { id: randomUUID(), sourcePath, fingerprint: await fingerprintFile(sourcePath), displayName: "placement cache",
    durationMs: 1000, width: 160, height: 120, rotation: 0, sizeBytes: (await stat(sourcePath)).size, importedAt: now(), probeStatus: "ready" };
  const identityId = randomUUID(), segmentId = randomUUID();
  const draft: HumanRegionIntent = { id: randomUUID(), projectId: randomUUID(), revision: 0, assistedArtwork: "human-region-v1", admission: "manual-production-v1",
    media: [{ mediaId: media.id, sourceFingerprint: media.fingerprint, disposition: "cover", identities: [{ id: identityId, label: "manual target", semantics: "sticker", origin: "human" }],
      segments: [{ id: segmentId, identityId, origin: "human", track: { startMs: 0, endMs: 1000, keyframes: [{ timeMs: 0, rectangle: target }] } }] }] };
  const assetPath = path.join(directory, "sticker.png");
  await writeFile(assetPath, encodeRgbaPng(Buffer.alloc(80 * 40 * 4, 255), 80, 40));
  return { tools, media, draft, assetId: stickerId, assetPath };
}

async function sticker(assetPath: string, color: readonly [number, number, number] = [255, 255, 255]) {
  const rgba = Buffer.alloc(80 * 40 * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([color[0], color[1], color[2], 255], offset);
  await writeFile(assetPath, encodeRgbaPng(rgba, 80, 40));
  return { assetPath, assetFingerprint: await fingerprintFile(assetPath) };
}

function withDraft(f: Fixture, patch: { rectangle?: { x: number; y: number; width: number; height: number }; range?: { startMs: number; endMs: number } } = {}) {
  const draft = structuredClone(f.draft);
  draft.id = randomUUID(); draft.revision += 1;
  const track = draft.media[0].segments[0].track;
  if (patch.rectangle) track.keyframes[0].rectangle = patch.rectangle;
  if (patch.range) {
    track.startMs = patch.range.startMs; track.endMs = patch.range.endMs;
    track.keyframes[0].timeMs = patch.range.startMs;
  }
  return draft;
}

function assets(f: Fixture, asset: { assetPath: string; assetFingerprint: string }): StickerAssets {
  return { [f.assetId]: asset } as StickerAssets;
}

async function produce(f: Fixture, draft: HumanRegionIntent, pool: StickerAssets, output: string, options: { version?: number; runId?: string; random?: boolean; preset?: typeof DEFAULT_PRESET } = {}) {
  const prepare = createHumanRegionCover({ draft, media: [f.media], preset: options.preset ?? { ...DEFAULT_PRESET, resolutionMode: "source" },
    assets: pool, tools: f.tools, directory: output, random: options.random ?? false });
  return prepare(f.media, options.version ?? 1, options.runId ?? randomUUID(), new AbortController().signal);
}

async function assertCovered(f: Fixture, layer: Awaited<ReturnType<typeof produce>>[number]) {
  const binding = layer.cover!.humanRegion!;
  const rgba = await decodeShapeCoverPng(await readFile(layer.assetPath), binding.projection, f.tools);
  expect(opaqueRegionCovered(Uint8Array.from({ length: rgba.length / 4 }, (_, pixel) => rgba[pixel * 4 + 3]), binding.projection, binding.target)).toBe(true);
}

it("reuses a successful placement across creators while freezing the current draft and range", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-placement-reuse-"));
  const original = shapeSearch.searchHybridCornerShape;
  const search = vi.spyOn(shapeSearch, "searchHybridCornerShape").mockImplementation((...args) => original(...args));
  try {
    const f = await fixture(directory), asset = await sticker(f.assetPath), pool = assets(f, asset);
    const first = await produce(f, f.draft, pool, path.join(directory, "first-output"), { runId: "placement-first" });
    expect(first).toHaveLength(1);
    expect(search.mock.calls.length).toBeGreaterThan(0);
    await assertCovered(f, first[0]);
    const callsAfterFirst = search.mock.calls.length;

    const currentDraft = withDraft(f, { range: { startMs: 200, endMs: 800 } });
    const second = await produce(f, currentDraft, pool, path.join(directory, "second-output"), { runId: "placement-second" });
    expect(second).toHaveLength(1);
    expect(search).toHaveBeenCalledTimes(callsAfterFirst);
    expect(second[0].assetPath).not.toBe(first[0].assetPath);
    const firstBinding = first[0].cover!.humanRegion!, secondBinding = second[0].cover!.humanRegion!;
    expect(firstBinding.draftId).toBe(f.draft.id);
    expect(firstBinding.range).toEqual({ startMs: 0, endMs: 1000 });
    expect(secondBinding.draftId).toBe(currentDraft.id);
    expect(secondBinding.revision).toBe(currentDraft.revision);
    expect(secondBinding.range).toEqual({ startMs: 200, endMs: 800 });
    expect(secondBinding.bindingDigest).not.toBe(firstBinding.bindingDigest);
    await assertCovered(f, second[0]);
    const placementFiles = await readdir(path.join(f.tools.artworkIndexDirectory!, "placements"));
    expect(placementFiles.some(name => name.endsWith(".json"))).toBe(true);
  } finally { search.mockRestore(); await rm(directory, { recursive: true, force: true }); }
}, 60000);

it("misses changed targets, output sizes, or sticker fingerprints and repairs corrupt placement JSON", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-placement-invalidation-"));
  const original = shapeSearch.searchHybridCornerShape;
  const search = vi.spyOn(shapeSearch, "searchHybridCornerShape").mockImplementation((...args) => original(...args));
  try {
    const f = await fixture(directory), asset = await sticker(f.assetPath), pool = assets(f, asset);
    await produce(f, f.draft, pool, path.join(directory, "base-output"), { runId: "base" });
    let calls = search.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    const placementDir = path.join(f.tools.artworkIndexDirectory!, "placements");
    const files = await readdir(placementDir);
    expect(files.filter(name => name.endsWith(".json")).length).toBeGreaterThan(0);
    for (const name of files.filter(name => name.endsWith(".json"))) await writeFile(path.join(placementDir, name), "{corrupt");
    await produce(f, withDraft(f), pool, path.join(directory, "repair-output"), { runId: "repair" });
    expect(search.mock.calls.length).toBeGreaterThan(calls);
    calls = search.mock.calls.length;
    const repaired = await readdir(placementDir);
    for (const name of repaired.filter(item => item.endsWith(".json"))) {
      const record = await readFile(path.join(placementDir, name));
      expect(() => JSON.parse(record.toString())).not.toThrow();
    }

    await produce(f, withDraft(f, { rectangle: { x: .24, y: .12, width: .2, height: .1 } }), pool, path.join(directory, "changed-target"), { runId: "target" });
    expect(search.mock.calls.length).toBeGreaterThan(calls); calls = search.mock.calls.length;

    await produce(f, withDraft(f), pool, path.join(directory, "changed-output"), { runId: "output", preset: { ...DEFAULT_PRESET, resolutionMode: "720p" } });
    expect(search.mock.calls.length).toBeGreaterThan(calls); calls = search.mock.calls.length;

    const changedAsset = await sticker(path.join(directory, "replacement.png"), [240, 20, 20]);
    await produce(f, withDraft(f), assets(f, changedAsset), path.join(directory, "changed-asset"), { runId: "asset" });
    expect(search.mock.calls.length).toBeGreaterThan(calls);
  } finally { search.mockRestore(); await rm(directory, { recursive: true, force: true }); }
}, 120000);

it("fails stale asset bytes before returning a persisted placement hit", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-placement-stale-"));
  const original = shapeSearch.searchHybridCornerShape;
  const search = vi.spyOn(shapeSearch, "searchHybridCornerShape").mockImplementation((...args) => original(...args));
  try {
    const f = await fixture(directory), asset = await sticker(f.assetPath), pool = assets(f, asset);
    await produce(f, f.draft, pool, path.join(directory, "first-output"), { runId: "stale-first" });
    const callsAfterFirst = search.mock.calls.length;
    await writeFile(f.assetPath, encodeRgbaPng(Buffer.alloc(80 * 40 * 4, 0), 80, 40));
    await expect(produce(f, withDraft(f), pool, path.join(directory, "second-output"), { runId: "stale-second" })).rejects.toThrow(/HYBRID_CATALOG_BINDING|fingerprint/i);
    expect(search).toHaveBeenCalledTimes(callsAfterFirst);
  } finally { search.mockRestore(); await rm(directory, { recursive: true, force: true }); }
}, 60000);

it("keeps random version rotation independent of cached placement hints", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-placement-random-"));
  const original = shapeSearch.searchHybridCornerShape;
  const search = vi.spyOn(shapeSearch, "searchHybridCornerShape").mockImplementation((...args) => original(...args));
  try {
    const f = await fixture(directory), firstAsset = await sticker(f.assetPath), secondPath = path.join(directory, "second.png");
    const secondAsset = await sticker(secondPath, [20, 180, 240]);
    const secondId = `uploaded-${"b".repeat(64)}`;
    const pool = { [f.assetId]: firstAsset, [secondId]: secondAsset } as StickerAssets;
    const prepare = createHumanRegionCover({ draft: f.draft, media: [f.media], preset: { ...DEFAULT_PRESET, resolutionMode: "source" },
      assets: pool, tools: f.tools, directory: path.join(directory, "frozen"), random: true });
    const first = await prepare(f.media, 1, "rotation-run", new AbortController().signal);
    const second = await prepare(f.media, 2, "rotation-run", new AbortController().signal);
    expect(first).toHaveLength(1); expect(second).toHaveLength(1);
    expect(first[0].cover!.stickerId).not.toBe(second[0].cover!.stickerId);
    expect(search.mock.calls.length).toBeGreaterThanOrEqual(2);
  } finally { search.mockRestore(); await rm(directory, { recursive: true, force: true }); }
}, 90000);
