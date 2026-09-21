import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { ProjectStore } from "../src/main/store";
import type { CoverSticker } from "../src/shared/cover-sticker";
import type { MediaItem } from "../src/main/domain";

it("persists manual cover settings through the agent-driven save sequence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-save-"));
  const service = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source", fingerprint: "fixture", sizeBytes: 1, durationMs: 1_000, width: 640, height: 480, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
  service.currentProject.mediaItems.push(media);
  const region = { id: crypto.randomUUID(), rectangle: { x: 0, y: 0, width: 0.2, height: 0.1 } };
  const settings: CoverSticker = {
    enabled: true, trackingMode: "manual",
    stickerIds: [`uploaded-${"a".repeat(64)}`],
    rectangle: region.rectangle, regions: [region],
    mediaRegions: { [media.id]: [{ id: crypto.randomUUID(), rectangle: { x: 0.1, y: 0.05, width: 0.25, height: 0.12 } }] },
  };
  service.setCoverSticker(settings);
  expect(service.hasUnsavedChanges).toBe(true);
  const filePath = path.join(directory, "project.jianji-project.json");
  await service.saveProject(filePath);
  expect(service.hasUnsavedChanges).toBe(false);
  const loaded = await new ProjectStore(filePath).load();
  expect(loaded.project.coverSticker).toEqual(settings);
});