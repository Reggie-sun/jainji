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
import { MaterialNameSchema } from "../shared/material-names.js";
import { CoverStickerSchema, type CoverSticker } from "../shared/cover-sticker.js";

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
    hasUnsavedChanges: boolean;
    updatedAt: string;
    mediaItems: MediaView[];
    template: EditTemplate;
    coverSticker?: CoverSticker;
  };
  queue: PublicQueueSnapshot;
  templateReadiness: { ready: boolean; missing: string[] };
}

export class ApplicationService {
  private project: Project = createDefaultProject();
  private projectFile?: ProjectStore;
  private dirty = true;
  private mutationVersion = 0;
  private queueSyncWork?: Promise<void>;
  private pendingQueueSave?: { project: Project; snapshot: Project; store: ProjectStore; version: number };
  private readonly mediaCatalog: MediaCatalog;

  constructor(ffmpeg: FfmpegAdapter, private readonly fontResolver: FontResolver) {
    this.mediaCatalog = new MediaCatalog(ffmpeg);
  }

  get currentProject(): Project { return this.project; }
  get hasUnsavedChanges(): boolean { return this.dirty; }
  get projectPath(): string | undefined { return this.projectFile?.path; }

  setCoverSticker(input: unknown): void {
    this.project.coverSticker = CoverStickerSchema.parse(input);
    this.touch();
  }

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

  renameProject(nameInput: string): void {
    const name = MaterialNameSchema.parse(nameInput);
    if (this.project.name === name) return;
    this.project.name = name;
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

  async saveProject(filePath: string, nameInput?: string): Promise<Project> {
    const name = nameInput === undefined ? this.project.name : MaterialNameSchema.parse(nameInput);
    await this.assertNotSource(filePath);
    this.renameProject(name);
    const store = new ProjectStore(filePath);
    const version = this.mutationVersion;
    // This explicit save includes the latest state and supersedes older pending autosaves.
    this.pendingQueueSave = undefined;
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

  syncQueue(queue: QueueSnapshot): Promise<void> {
    try {
      let changed = false;
      for (const state of queue.batches) {
        if (state.batch.projectId !== this.project.id) continue;
        const index = this.project.exportBatches.findIndex((batch) => batch.id === state.batch.id);
        if (index < 0) this.project.exportBatches.push(structuredClone(state.batch));
        else this.project.exportBatches[index] = structuredClone(state.batch);
        changed = true;
      }
      if (!changed) return Promise.resolve();
      this.touch();
      if (!this.projectFile) return Promise.resolve();
      // Progress may arrive faster than atomic disk writes. Keep one active save
      // and the latest pending state, rather than retaining a project per event.
      this.pendingQueueSave = { project: this.project, snapshot: structuredClone(this.project), store: this.projectFile, version: this.mutationVersion };
      this.queueSyncWork ??= Promise.resolve().then(async () => {
        try {
          let failure: { error: unknown } | undefined;
          while (this.pendingQueueSave) {
            const { project, snapshot, store, version } = this.pendingQueueSave;
            this.pendingQueueSave = undefined;
            // New/open/save-as supersedes the old automatic-save destination.
            if (this.project !== project || this.projectFile !== store) continue;
            try { await store.save(snapshot); }
            catch (error) {
              failure ??= { error };
              continue;
            }
            if (this.project === project && this.projectFile === store && this.mutationVersion === version) this.dirty = false;
          }
          if (failure) throw failure.error;
        } finally {
          this.queueSyncWork = undefined;
        }
      });
      return this.queueSyncWork;
    } catch (error) {
      return Promise.reject(error);
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
        hasUnsavedChanges: this.dirty,
        updatedAt: this.project.updatedAt,
        mediaItems: this.project.mediaItems.map(toMediaView),
        template: cloneTemplate(this.activeTemplate),
        coverSticker: this.project.coverSticker && structuredClone(this.project.coverSticker),
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

export function createStickerLayer(assetPath: string, assetFingerprint: string): EditTemplate["layers"][number] {
  return {
    id: randomUUID(), type: "sticker", assetPath: path.resolve(assetPath), assetFingerprint,
    x: 0.08, y: 0.08, width: 0.25, rotationDeg: 0, opacity: 1, zIndex: 0, visible: true,
  };
}
