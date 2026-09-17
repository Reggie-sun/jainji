import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { ProjectWorkspaceSchema } from "../src/shared/project-workspace";

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

it("stores a resumable workspace without duplicating the manual display text", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-workspace-"));
  directories.push(directory);
  const source = path.join(directory, "source.mp4");
  const projectFile = path.join(directory, "project.json");
  await writeFile(source, "video");
  const ffmpeg = new FfmpegAdapter("unused", "unused");
  vi.spyOn(ffmpeg, "probe").mockResolvedValue({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360 }], format: { duration: "2" } });
  const service = new ApplicationService(ffmpeg, { resolve: async () => null });
  const [media] = await service.addMedia([source]);
  service.setProductPriceDraft("19.9元2支");
  const workspace = ProjectWorkspaceSchema.parse({
    step: "templates",
    selectedMediaIds: [media.id],
    ruleId: "ocean-blue",
    brief: "突出清爽感",
    decorations: { mode: "manual", productPrice: "不应重复保存", priceStyle: "ice", sticker: "heart", fontFamily: "Noto Sans CJK SC" },
    requestedCount: 10,
    exportFormat: "mov",
    exportSettings: { resolutionMode: "1080p", frameRateMode: "30", quality: "high" },
    outputDirectoryMode: "manual",
    outputDirectory: directory,
  });

  await service.saveProject(projectFile, "做到一半的项目", workspace);
  const saved = JSON.parse(await readFile(projectFile, "utf8"));
  expect(saved.workspaceDraft).toEqual(workspace);
  expect(saved.workspaceDraft.decorations.productPrice).toBeUndefined();
  expect(saved.templates[0].productPriceDraft).toBe("19.9元2支");

  const reopened = new ApplicationService(ffmpeg, { resolve: async () => null });
  await reopened.loadProject(projectFile);
  expect(reopened.currentProject.workspaceDraft).toEqual(workspace);
  expect(reopened.view({ revision: 0, batches: [] }).project.workspaceDraft).toEqual(workspace);
});
