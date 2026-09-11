import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  cloneTemplate,
  createDefaultProject,
  EditTemplateSchema,
  now,
  ProjectSchema,
  type EditTemplate,
  type ExportBatch,
  type MediaItem,
  type Project,
} from "./domain.js";
import { FfmpegAdapter } from "./ffmpeg.js";
import { MediaCatalog, toMediaView, type MediaView } from "./media.js";
import { pathsEqual, validateTemplateResources, type FontResolver } from "./paths.js";
import { ProjectStore } from "./store.js";
import type { QueueSnapshot } from "./queue.js";

export type PublicExportBatch = Omit<ExportBatch, "templateSnapshot" | "mediaSnapshots">;
export interface PublicQueueState {
  revision: number;
  updatedAt: string;
  batch: PublicExportBatch;
}
export interface PublicQueueSnapshot {
  revision: number;
  batches: PublicQueueState[];
}

export interface AppState {
  project: {
    id: string;
    name: string;
    updatedAt: string;
    mediaItems: MediaView[];
    template: EditTemplate;
  };
  queue: PublicQueueSnapshot;
  templateReadiness: { ready: boolean; missing: string[] };
}

export class ApplicationService {
  private project: Project = createDefaultProject();
  private projectFile?: ProjectStore;
  private dirty = true;
  private mutationVersion = 0;
  private readonly mediaCatalog: MediaCatalog;

  constructor(ffmpeg: FfmpegAdapter, private readonly fontResolver: FontResolver) {
    this.mediaCatalog = new MediaCatalog(ffmpeg);
  }

  get currentProject(): Project { return this.project; }
  get hasUnsavedChanges(): boolean { return this.dirty; }
  get projectPath(): string | undefined { return this.projectFile?.path; }

  newProject(name = "我的简辑项目"): Project {
    this.project = createDefaultProject(name);
    this.projectFile = undefined;
    this.dirty = true;
    this.mutationVersion += 1;
    return structuredClone(this.project);
  }

  async addMedia(paths: readonly string[]): Promise<MediaItem[]> {
    const uniquePaths = [...new Set(paths.map((sourcePath) => path.resolve(sourcePath)))];
    const known = new Set(this.project.mediaItems.map((item) => item.sourcePath));
    const additions = await this.mediaCatalog.probePaths(uniquePaths.filter((sourcePath) => !known.has(sourcePath)));
    this.project.mediaItems.push(...additions);
    this.touch();
    return additions;
  }

  removeMedia(mediaId: string): void {
    this.project.mediaItems = this.project.mediaItems.filter((item) => item.id !== mediaId);
    this.touch();
  }

  async revalidateMedia(): Promise<void> {
    for (const item of this.project.mediaItems) {
      try {
        const refreshed = await this.mediaCatalog.probeOne(item.sourcePath);
        if (refreshed.probeStatus !== "ready" || refreshed.fingerprint !== item.fingerprint) {
          item.probeStatus = "invalid";
          item.errorCode = "input_invalid";
          item.errorMessage = refreshed.probeStatus === "invalid" ? refreshed.errorMessage ?? "文件无法读取，请重新导入。" : "文件已移动或修改，请重新导入。";
          continue;
        }
        Object.assign(item, refreshed, { id: item.id, importedAt: item.importedAt });
      } catch {
        item.probeStatus = "invalid";
        item.errorCode = "input_invalid";
        item.errorMessage = "原始素材不存在或不可读取。";
      }
    }
  }

  updateTemplate(templateInput: EditTemplate): EditTemplate {
    const template = EditTemplateSchema.parse(templateInput);
    const index = this.project.templates.findIndex((item) => item.id === template.id);
    if (index < 0) this.project.templates.push(cloneTemplate(template));
    else this.project.templates[index] = cloneTemplate(template);
    this.project.activeTemplateId = template.id;
    this.touch();
    return cloneTemplate(template);
  }

  async templateReadiness(template = this.activeTemplate): Promise<{ ready: boolean; missing: string[] }> {
    const missing = await validateTemplateResources(template, this.fontResolver);
    return { ready: missing.length === 0, missing };
  }

  async saveTemplate(filePath: string, templateInput = this.activeTemplate): Promise<EditTemplate> {
    await this.assertNotSource(filePath);
    const template = EditTemplateSchema.parse({
      ...templateInput,
      version: templateInput.version + 1,
      updatedAt: now(),
    });
    await import("./store.js").then(({ atomicWriteJson }) => atomicWriteJson(filePath, template));
    this.updateTemplate(template);
    return template;
  }

  async loadTemplate(filePath: string): Promise<EditTemplate> {
    const { readValidatedJson } = await import("./store.js");
    const { value } = await readValidatedJson(filePath, (value) => EditTemplateSchema.parse(value));
    this.updateTemplate(value);
    return cloneTemplate(value);
  }

  async saveProject(filePath: string): Promise<Project> {
    await this.assertNotSource(filePath);
    const store = new ProjectStore(filePath);
    const version = this.mutationVersion;
    await store.save(this.project);
    this.projectFile = store;
    if (this.mutationVersion === version) this.dirty = false;
    return structuredClone(this.project);
  }

  async loadProject(filePath: string): Promise<Project> {
    const store = new ProjectStore(filePath);
    const loaded = await store.load();
    this.project = loaded.project;
    this.projectFile = store;
    this.mutationVersion += 1;
    await this.revalidateMedia();
    ProjectSchema.parse(this.project);
    this.dirty = false;
    return structuredClone(this.project);
  }

  async syncQueue(queue: QueueSnapshot): Promise<void> {
    let changed = false;
    for (const state of queue.batches) {
      if (state.batch.projectId !== this.project.id) continue;
      const index = this.project.exportBatches.findIndex((batch) => batch.id === state.batch.id);
      if (index < 0) this.project.exportBatches.push(structuredClone(state.batch));
      else this.project.exportBatches[index] = structuredClone(state.batch);
      changed = true;
    }
    if (!changed) return;
    this.touch();
    const version = this.mutationVersion;
    if (this.projectFile) {
      await this.projectFile.save(this.project);
      if (this.mutationVersion === version) this.dirty = false;
    }
  }

  get activeTemplate(): EditTemplate {
    return this.project.templates.find((template) => template.id === this.project.activeTemplateId) ?? this.project.templates[0];
  }

  getMedia(mediaId: string): MediaItem | undefined { return this.project.mediaItems.find((item) => item.id === mediaId); }

  view(queue: QueueSnapshot): AppState {
    return {
      project: {
        id: this.project.id,
        name: this.project.name,
        updatedAt: this.project.updatedAt,
        mediaItems: this.project.mediaItems.map(toMediaView),
        template: cloneTemplate(this.activeTemplate),
      },
      queue: toPublicQueue(queue, this.project.id),
      templateReadiness: { ready: false, missing: [] },
    };
  }

  async state(queue: QueueSnapshot): Promise<AppState> {
    const value = this.view(queue);
    value.templateReadiness = await this.templateReadiness(value.project.template);
    return value;
  }

  private touch(): void { this.project.updatedAt = now(); ProjectSchema.parse(this.project); this.mutationVersion += 1; this.dirty = true; }

  private async assertNotSource(filePath: string): Promise<void> {
    for (const media of this.project.mediaItems) {
      if (await pathsEqual(filePath, media.sourcePath)) throw new Error("项目或模板文件不能覆盖原始素材。");
    }
  }
}

function toPublicQueue(queue: QueueSnapshot, projectId: string): PublicQueueSnapshot {
  return {
    revision: queue.revision,
    batches: queue.batches
      .filter((state) => state.batch.projectId === projectId)
      .map((state) => {
        const { templateSnapshot: _templateSnapshot, mediaSnapshots: _mediaSnapshots, ...batch } = state.batch;
        return { revision: state.revision, updatedAt: state.updatedAt, batch };
      }),
  };
}

export function createTextLayer(): EditTemplate["layers"][number] {
  return {
    id: randomUUID(), type: "text", content: "新文字", fontFamily: "DejaVu Sans", fontSizeRatio: 0.08,
    color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidthRatio: 0.006,
    x: 0.08, y: 0.08, width: 0.8, opacity: 1, zIndex: 0, visible: true,
  };
}

export function createStickerLayer(assetPath: string, assetFingerprint: string): EditTemplate["layers"][number] {
  return {
    id: randomUUID(), type: "sticker", assetPath: path.resolve(assetPath), assetFingerprint,
    x: 0.08, y: 0.08, width: 0.25, rotationDeg: 0, opacity: 1, zIndex: 0, visible: true,
  };
}
