import { describe, expect, it } from "vitest";
import { CoverTrackSchema, interpolateCoverRectangle, type CoverTrack } from "../src/shared/cover-sticker";
import { resolveCoverSticker, coverLayerForMedia } from "../src/main/cover-sticker";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { ProjectSchema, type MediaItem } from "../src/main/domain";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const mediaId = crypto.randomUUID();
const track: CoverTrack = { startMs: 250, endMs: 1750, keyframes: [
  { timeMs: 0, rectangle: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  { timeMs: 1000, rectangle: { x: 0.5, y: 0.4, width: 0.4, height: 0.4 } },
] };
const stickerId = `uploaded-${"a".repeat(64)}`;
const options = { enabled: true, stickerIds: [stickerId], rectangle: track.keyframes[0].rectangle, tracks: { [mediaId]: track } };
const source: MediaItem = { id: mediaId, sourcePath: "/tmp/source.mp4", displayName: "source", fingerprint: "fixture", sizeBytes: 1, width: 800, height: 600, durationMs: 2000, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };

describe("per-material cover keyframes", () => {
  it("persists material-specific tracks when a project is saved and reopened", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-track-project-"));
    try {
      const service = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
      service.currentProject.mediaItems.push(source);
      service.setCoverSticker(options);
      const file = path.join(directory, "project.json");
      await service.saveProject(file);
      service.newProject();
      await service.loadProject(file);
      expect(service.currentProject.coverSticker?.tracks?.[mediaId]).toEqual(track);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("interpolates position and scale and holds endpoints", () => {
    expect(interpolateCoverRectangle(track.keyframes, 500).x).toBeCloseTo(0.3);
    expect(interpolateCoverRectangle(track.keyframes, 500).y).toBeCloseTo(0.25);
    expect(interpolateCoverRectangle(track.keyframes, 500).width).toBeCloseTo(0.3);
    expect(interpolateCoverRectangle(track.keyframes, -1)).toEqual(track.keyframes[0].rectangle);
    expect(interpolateCoverRectangle(track.keyframes, 2000)).toEqual(track.keyframes[1].rectangle);
  });
  it("rejects duplicate times, malformed intervals, offscreen boxes and aspect changes", () => {
    expect(CoverTrackSchema.parse(track)).toEqual(track);
    for (const invalid of [
      { ...track, endMs: 100 }, { ...track, keyframes: [] },
      { ...track, keyframes: [track.keyframes[0], track.keyframes[0]] },
      { ...track, keyframes: [...track.keyframes].reverse() },
      { ...track, keyframes: [track.keyframes[0], { timeMs: 1000, rectangle: { ...track.keyframes[1].rectangle, width: 0.5 } }] },
      { ...track, keyframes: [{ timeMs: 0, rectangle: { x: 0.9, y: 0, width: 0.2, height: 0.2 } }] },
    ]) expect(CoverTrackSchema.safeParse(invalid).success).toBe(false);
  });
  it("freezes only the matching material track and maps every keyframe through padding", () => {
    const frozen = resolveCoverSticker(options, { [stickerId]: { assetPath: "/tmp/cover.png", assetFingerprint: "fixture" } }, [])!;
    const layer = coverLayerForMedia(frozen, source, { width: 1280, height: 720 });
    expect(layer.cover?.motion?.keyframes[0].rectangle.x).toBeCloseTo(0.2);
    expect(layer.cover?.motion?.keyframes[1].rectangle.width).toBeCloseTo(0.3);
    expect(layer.cover?.motion).toMatchObject({ startMs: 250, endMs: 1750 });
    expect(coverLayerForMedia(frozen, { ...source, id: crypto.randomUUID() }, { width: 1280, height: 720 }).cover?.motion).toBeUndefined();
    const before = structuredClone(layer);
    frozen.tracks![mediaId].keyframes[0].rectangle.x = 0.2;
    expect(layer).toEqual(before);
    expect(track.keyframes[0].rectangle.x).toBe(0.1);
  });
  it("validates material ownership and duration at settings and project load boundaries", () => {
    const service = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
    expect(() => service.setCoverSticker(options)).toThrow("素材不存在");
    service.currentProject.mediaItems.push(source);
    service.setCoverSticker(options);
    expect(ProjectSchema.parse(service.currentProject).coverSticker).toEqual(options);
    const long = { ...options, tracks: { [mediaId]: { ...track, endMs: 3000 } } };
    expect(() => service.setCoverSticker(long)).toThrow("超出素材时长");
    expect(() => ProjectSchema.parse({ ...service.currentProject, coverSticker: long })).toThrow("超出素材时长");
    service.removeMedia(mediaId);
    expect(service.currentProject.coverSticker?.tracks?.[mediaId]).toBeUndefined();
  });
});
