import path from "node:path";
import type { FontResolver } from "./paths.js";
import { canonicalPath } from "./paths.js";
import { ApplicationService } from "./application.js";
import { AgentController } from "./agent-controller.js";
import { ProjectStore } from "./store.js";
import type { RecentProjects } from "./recent-projects.js";
import type { ExportQueue } from "./queue.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import type { AssetLibrary } from "./asset-library.js";
import type { StickerAssets } from "./builtin-stickers.js";
import type { ModelConnections } from "./model-connections.js";
import { hybridProductRoutes } from "./hybrid-cover-connections.js";
import type { SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";
import type { BatchProjectOption } from "../shared/batch-production.js";
import { DecorationSchema, requiresDisplayText } from "../shared/decorations.js";
import { createAutomaticOutputDirectory } from "./automatic-output-directory.js";
import { BatchProductionController } from "./batch-production-controller.js";
import type { DouyinUploadService } from "./douyin-upload-service.js";
import { TemplateAccountSelectionSchema } from "../shared/batch-upload.js";

export function createBatchProductionRuntime(input: {
  root: string; registry: RecentProjects; queue: ExportQueue; ffmpeg: FfmpegAdapter;
  fontResolver: FontResolver; library: AssetLibrary; stickers: StickerAssets; connections: ModelConnections;
  knowledgeStore?: SourceStickerKnowledgeStore; approvedDirectories: Set<string>; changed(): void;
  upload?: DouyinUploadService;
}) {
  const controller = new BatchProductionController(path.join(input.root, "batch-production"), {
    name: id => input.registry.list().find(item => item.id === id)?.name ?? "已保存模板",
    loadProject: id => new ProjectStore(input.registry.resolve(id)).readSnapshot(),
    queue: projectId => input.queue.snapshot(projectId),
    taskStatuses: () => input.queue.taskStatuses(),
    cancelExport: id => input.queue.cancel(id),
    changed: input.changed,
    preflightUpload: (selection, count) => input.upload?.preflight(selection, count) ?? Promise.resolve(undefined),
    uploadAccounts: projectId => input.upload?.status(projectId).accounts ?? [],
    uploadBinding: (recentProjectId, projectId) => input.upload?.templateAccount(recentProjectId, projectId) ?? Promise.resolve(undefined),
    uploadStatus: (projectId, taskIds) => input.upload?.capturedStatus(projectId, taskIds),
    cancelUploads: (projectId, taskIds) => input.upload?.cancelExports(projectId, taskIds) ?? Promise.resolve(),
    outputDirectory: async (project, ids, requested) => {
      if (requested) {
        const directory = await canonicalPath(requested);
        if (!input.approvedDirectories.has(directory)) throw new Error("请为该模板通过系统对话框选择成片目录。");
        return directory;
      }
      const directory = await createAutomaticOutputDirectory(ids.map(id => project.mediaItems.find(item => item.id === id)!.sourcePath));
      const approved = await canonicalPath(directory);
      input.approvedDirectories.add(approved);
      return approved;
    },
    session: async (projectPath, authorization) => {
      // A private copy gives the canonical services a stable project without switching the editor.
      const service = new ApplicationService(input.ffmpeg, input.fontResolver);
      await service.loadProject(projectPath);
      const agent = new AgentController(service, input.queue, input.ffmpeg, () => { controller.wake(); input.changed(); }, input.stickers,
        input.library, input.connections.provider, input.connections.visionProvider, input.connections.reviewerProvider, input.knowledgeStore,
        (batch, selection, frozen) => input.upload?.registerBatch(batch, selection, frozen) ?? Promise.resolve(),
        async (selection, count) => {
          if (!authorization || selection.accountProduct !== authorization.target.product || count !== authorization.expectedCount) throw new Error("批量上传授权与本项制作不一致。");
          return authorization;
        }, hybridProductRoutes(input.connections, input.ffmpeg));
      return {
        get busy() { return agent.busy; },
        start: request => agent.start(request, input.approvedDirectories),
        snapshot: () => agent.snapshot(),
        cancel: () => agent.cancel(),
        persist: async snapshot => {
          await service.syncQueue(snapshot);
          const run = agent.snapshot();
          if (run) await service.rememberLatestProduction(run);
        },
      };
    },
  });

  async function listProjects(): Promise<BatchProjectOption[]> {
    return Promise.all(input.registry.list().map(async item => {
      try {
        const project = await new ProjectStore(input.registry.resolve(item.id)).readSnapshot();
        let uploadBinding: BatchProjectOption["uploadBinding"], uploadBindingError: string | undefined;
        try { uploadBinding = await input.upload?.templateAccount(item.id, project.id); }
        catch (error) { uploadBindingError = error instanceof Error ? error.message : "模板账号关联无法读取，请核查账号设置。"; }
        const workspace = project.workspaceDraft;
        const template = project.templates.find(template => template.id === project.activeTemplateId) ?? project.templates[0];
        const mediaIds = [...new Set(workspace?.selectedMediaIds ?? project.mediaItems.filter(media => media.probeStatus === "ready").map(media => media.id))];
        const sourceCount = mediaIds.length;
        const decorations = DecorationSchema.parse({ ...workspace?.decorations, productPrice: template.productPriceDraft ?? "" });
        return { recentProjectId: item.id, projectId: project.id, name: project.name, sourceCount, requestedCount: workspace?.requestedCount ?? Math.max(1, sourceCount),
          productPrice: decorations.productPrice ?? "", coverEnabled: true,
          displayMode: decorations.displayMode === "full" ? "full" as const : "first-5s" as const, mode: decorations.mode ?? "manual",
          coverMode: project.coverSticker?.trackingMode,
          uploadBinding, uploadBindingError,
          displayTextRequiredByMedia: mediaIds.map(id => requiresDisplayText(decorations, [id])) };
      } catch {
        return { recentProjectId: item.id, name: item.name, sourceCount: 0, requestedCount: 1, productPrice: "", coverEnabled: false,
          displayMode: "full" as const, mode: "random" as const, error: "项目文件无法读取，请先在制作页面重新打开或导入。" };
      }
    }));
  }
  async function saveUploadAccount(value: unknown) {
    const selection = TemplateAccountSelectionSchema.parse(value);
    const project = await new ProjectStore(input.registry.resolve(selection.recentProjectId)).readSnapshot();
    if (project.id !== selection.expectedProjectId) throw new Error("模板项目已变化，请刷新模板后重新选择账号。");
    if (!input.upload) throw new Error("千川账号设置不可用。");
    return input.upload.saveTemplateAccount({ recentProjectId: selection.recentProjectId, projectId: project.id,
      accountProduct: selection.accountProduct, advertiserId: selection.expectedAdvertiserId });
  }
  return { controller, listProjects, saveUploadAccount };
}
