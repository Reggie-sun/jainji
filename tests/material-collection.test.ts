import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-collection-"));
  directories.push(directory);
  const source = path.join(directory, "original.mp4");
  await writeFile(source, "original video bytes");
  const adapter = new FfmpegAdapter("unused", "unused");
  vi.spyOn(adapter, "probe").mockResolvedValue({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360 }], format: { duration: "2" } });
  const createService = () => new ApplicationService(adapter, { resolve: async () => null });
  const service = createService();
  const [media] = await service.addMedia([source]);
  return { directory, source, service, media, createService };
}

describe("named material collections", () => {
  it("keeps collection name and media references after saving and reopening in a fresh service", async () => {
    const { directory, source, service, media, createService } = await fixture();
    const file = path.join(directory, "collection.json");
    await service.saveProject(file, "  夏季新品  ");
    expect(service.hasUnsavedChanges).toBe(false);
    const reopened = createService();
    await reopened.loadProject(file);
    expect(reopened.currentProject.name).toBe("夏季新品");
    expect(reopened.getMedia(media.id)).toMatchObject({ displayName: "original.mp4", sourcePath: source, fingerprint: media.fingerprint, probeStatus: "ready" });
    expect(await readFile(source, "utf8")).toBe("original video bytes");
    reopened.renameProject("新品细节素材集");
    expect(reopened.hasUnsavedChanges).toBe(true);
    await reopened.saveProject(file);
    await service.loadProject(file);
    expect(service.currentProject.name).toBe("新品细节素材集");
  });

  it("retains the saved name while marking a missing original as unavailable", async () => {
    const { directory, source, service, media, createService } = await fixture();
    const file = path.join(directory, "collection.json");
    await service.saveProject(file, "素材集");
    await rm(source);
    const reopened = createService();
    await reopened.loadProject(file);
    expect(reopened.currentProject.name).toBe("素材集");
    expect(reopened.getMedia(media.id)).toMatchObject({ displayName: "original.mp4", probeStatus: "invalid" });
  });

  it("rejects invalid names without modifying the media or saved project", async () => {
    const { directory, service, media } = await fixture();
    const file = path.join(directory, "collection.json");
    await service.saveProject(file, "有效名称");
    const saved = await readFile(file, "utf8");
    for (const name of ["   ", "x".repeat(121)]) {
      expect(() => service.renameProject(name)).toThrow();
      await expect(service.saveProject(file, name)).rejects.toThrow();
    }
    expect(service.getMedia(media.id)?.displayName).toBe("original.mp4");
    expect(service.currentProject.name).toBe("有效名称");
    expect(await readFile(file, "utf8")).toBe(saved);
    expect(service.hasUnsavedChanges).toBe(false);
  });
});
