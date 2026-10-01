import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { ProjectWorkspaceSchema } from "../src/shared/project-workspace";
import { ProjectStore } from "../src/main/store";

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

it("persists a changed production mode without reopening the save dialog", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-mode-"));
  directories.push(directory);
  const file = path.join(directory, "project.json");
  const service = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  service.setProductPriceDraft("手动文字");
  const workspace = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: [], ruleId: "clean", brief: "",
    decorations: { mode: "agent" }, exportFormat: "mp4", exportSettings: { resolutionMode: "720p", frameRateMode: "source", quality: "balanced" }, outputDirectoryMode: "automatic" });
  await service.saveProject(file, "模式测试", workspace);
  await service.setWorkspaceDraft(service.currentProject.id, ProjectWorkspaceSchema.parse({ ...workspace, decorations: { mode: "random" } }));
  const reopened = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  await reopened.loadProject(file);
  expect(reopened.currentProject.workspaceDraft?.decorations.mode).toBe("random");
  expect(reopened.activeTemplate.productPriceDraft).toBe("手动文字");
  expect(reopened.currentProject.workspaceDraft?.decorations).not.toHaveProperty("productPrice");
  const before = structuredClone(service.currentProject.workspaceDraft);
  await expect(service.setWorkspaceDraft(crypto.randomUUID(), workspace)).rejects.toThrow("项目已切换");
  expect(service.currentProject.workspaceDraft).toEqual(before);
  vi.spyOn(ProjectStore.prototype, "save").mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(service.setWorkspaceDraft(service.currentProject.id, workspace)).rejects.toThrow("disk unavailable");
});

it("retains the frozen model-use flag after reopening a failed production", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-mode-history-"));
  directories.push(directory);
  const file = path.join(directory, "project.json");
  const service = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  await service.saveProject(file);
  await service.rememberLatestProduction({ id: crypto.randomUUID(), projectId: service.currentProject.id, ruleId: "clean", status: "finished", usesModel: false,
    items: [{ id: crypto.randomUUID(), mediaId: crypto.randomUUID(), version: 1, name: "本地失败", status: "failed", error: "fixture" }] });
  const reopened = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  await reopened.loadProject(file);
  expect(reopened.currentProject.latestProduction?.usesModel).toBe(false);
});
