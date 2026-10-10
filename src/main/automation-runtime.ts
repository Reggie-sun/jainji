import path from "node:path";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { AutomationRequestSchema, type AutomationRequest, type AutomationTask, type AutomationRun } from "../shared/automation.js";
import { type BatchProductionStart } from "../shared/batch-production.js";
import { DEFAULT_COVER_STICKER } from "../shared/cover-sticker.js";
import { FrozenAccountSchema, type UploadIdentity, type QianchuanUploadSelection } from "../shared/douyin-upload.js";
import type { QianchuanProduct } from "../shared/qianchuan-account.js";
import type { QianchuanLibraryClear, QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";
import { ProjectSchema, type Project } from "./domain.js";
import type { BatchProductionController } from "./batch-production-controller.js";
import type { ExportQueue } from "./queue.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { canonicalPath, fingerprintFile } from "./paths.js";
import { automationDigest, readAutomationFile, writeAutomationFile } from "./automation-files.js";

const recipeSchema = z.object({ version: z.literal(1), id: z.string().uuid(), request: AutomationRequestSchema,
  projects: z.array(z.object({ recentProjectId: z.string().uuid(), project: ProjectSchema }).strict()).max(250),
  accounts: z.array(FrozenAccountSchema).max(6), modelBinding: z.string().optional(),
}).strict();
type Recipe = z.infer<typeof recipeSchema>;
interface Dependencies {
  loadProject(id: string): Promise<Project>;
  account(product: QianchuanProduct): Promise<FrozenQianchuanAccount>;
  modelBinding(): string;
  approvedDirectories: Set<string>;
  controller: BatchProductionController;
  queue: Pick<ExportQueue, "snapshot">;
  task(id: string): AutomationTask | undefined;
  produce(input: BatchProductionStart, projects: ReadonlyMap<string, Project>, signal: AbortSignal): Promise<void>;
  clear(input: QianchuanLibraryClear, signal: AbortSignal): Promise<QianchuanLibraryResult[]>;
  upload(groups: { selection: QianchuanUploadSelection; target: FrozenQianchuanAccount; exports: UploadIdentity[] }[], signal: AbortSignal): Promise<void>;
}
const actions = (request: AutomationRequest) => ({ cleanup: request.cleanup, production: request.production, upload: request.upload, uploadFrom: request.uploadFrom });
const identity = (account: FrozenQianchuanAccount) => automationDigest(FrozenAccountSchema.parse(account));

/** Sealed recipes adapt scheduled triggers into the original production owners. */
export class AutomationRuntime {
  constructor(private readonly root: string, private readonly dependencies: Dependencies) {}
  private file(id: string): string { return path.join(this.root, "recipes", `${z.string().uuid().parse(id)}.json`); }
  async prepare(request: AutomationRequest, id: string): Promise<{ binding: string; summary: string }> {
    const projects: Recipe["projects"] = [], accounts = new Map<QianchuanProduct, FrozenQianchuanAccount>();
    const bindAccount = async (product: QianchuanProduct, advertiserId: string) => {
      const target = await this.dependencies.account(product);
      if (target.advertiserId !== advertiserId) throw new Error("账号身份已变化，请重新选择。");
      accounts.set(product, target);
    };
    for (const account of request.cleanup?.accounts ?? []) await bindAccount(account.product, account.expectedAdvertiserId);
    for (const entry of request.production?.entries ?? []) {
      const project = ProjectSchema.parse(await this.dependencies.loadProject(entry.recentProjectId));
      project.exportBatches = []; delete project.latestProduction; delete project.reviewDrafts;
      const ids = project.workspaceDraft?.selectedMediaIds ?? project.mediaItems.filter(media => media.probeStatus === "ready").map(media => media.id);
      if (!ids.length || ids.some(id => !project.mediaItems.some(media => media.id === id && media.probeStatus === "ready"))) throw new Error("模板素材未就绪，请重新保存模板。");
      if (entry.coverEnabled && entry.coverMethod !== "real-artwork" && project.coverSticker?.trackingMode === "assisted" && !project.coverSticker.manualRegionInput) throw new Error("半自动覆盖需要人工预览批准，不能直接定时执行。");
      if (entry.outputDirectory && !this.dependencies.approvedDirectories.has(await canonicalPath(entry.outputDirectory))) throw new Error("请先通过系统对话框选择成片目录。");
      if (entry.douyinUpload) {
        if (!entry.douyinUpload.plan) throw new Error("请明确选择定时上传计划。");
        await bindAccount(entry.douyinUpload.accountProduct, entry.douyinUpload.plan.advertiserId);
      }
      projects.push({ recentProjectId: entry.recentProjectId, project });
    }
    if (request.uploadFrom) {
      const source = this.dependencies.task(request.uploadFrom);
      if (!source?.request.production || source.request.upload) throw new Error("上传来源必须是独立制作任务。");
      const recipe = await this.read(source);
      if (recipe.request.production!.entries.some(entry => !entry.douyinUpload?.plan)) throw new Error("来源制作任务尚未固定上传账号及计划，请重新保存带上传目标的制作任务。");
    }
    const usesModel = projects.some(({ project, recentProjectId }) => {
      const entry = request.production!.entries.find(entry => entry.recentProjectId === recentProjectId)!;
      return (entry.mode ?? project.workspaceDraft?.decorations?.mode) === "agent" || entry.coverEnabled && entry.coverMethod !== "real-artwork" && (project.coverSticker ?? DEFAULT_COVER_STICKER).trackingMode === "agent";
    });
    if (new Set(projects.map(value => value.project.id)).size !== projects.length) throw new Error("同一个项目不能以多个模板条目重复绑定。");
    const recipe = recipeSchema.parse({ version: 1, id, request, projects, accounts: [...accounts.values()], ...(usesModel ? { modelBinding: this.dependencies.modelBinding() } : {}) });
    await this.verify(recipe);
    const summary = [
      ...(request.cleanup?.accounts.map(account => `清理账户 ${account.expectedAdvertiserId} · 计划 ${(account.plans?.map(plan => plan.adId) ?? [account.expectedAdId]).join("、")}`) ?? []),
      ...projects.map(({ project, recentProjectId }) => {
        const entry = request.production!.entries.find(entry => entry.recentProjectId === recentProjectId)!;
        const sources = [...new Set(project.mediaItems.map(media => path.dirname(media.sourcePath)))];
        return `${project.name} · ${entry.requestedCount} 条 · 素材 ${sources.join("、")}${entry.douyinUpload?.plan ? ` · 上传账户 ${entry.douyinUpload.plan.advertiserId} / 计划 ${entry.douyinUpload.plan.adId}` : ""}`;
      }),
      ...(request.uploadFrom ? [`上传来源：${this.dependencies.task(request.uploadFrom)!.request.name}`] : []),
    ].join("\n");
    if (summary.length > 8000) throw new Error("定时任务配置过多，请拆分任务。");
    await writeAutomationFile(this.file(id), recipe, true);
    return { binding: automationDigest(recipe), summary };
  }
  private async read(task: AutomationTask): Promise<Recipe> {
    const recipe = await readAutomationFile(this.file(task.id), value => recipeSchema.parse(value));
    if (recipe.id !== task.id || automationDigest(recipe) !== task.binding || automationDigest(actions(recipe.request)) !== automationDigest(actions(task.request))) throw new Error("定时任务固定配置不一致，已停止。");
    return recipe;
  }
  private async verify(recipe: Recipe, signal?: AbortSignal): Promise<void> {
    if (recipe.modelBinding && recipe.modelBinding !== this.dependencies.modelBinding()) throw new Error("模型连接已变化，请重新保存定时任务。");
    for (const entry of recipe.request.production?.entries ?? []) {
      if (entry.outputDirectory && await canonicalPath(entry.outputDirectory) !== entry.outputDirectory) throw new Error("固定成片目录的实际位置已变化，请重新选择目录并保存任务。");
      signal?.throwIfAborted();
    }
    for (const account of recipe.accounts) {
      if (identity(await this.dependencies.account(account.product)) !== identity(account)) throw new Error("定时任务绑定的账号、连接或计划配置已变化，请重新保存任务。");
      signal?.throwIfAborted();
    }
    for (const { project } of recipe.projects) {
      const ids = project.workspaceDraft?.selectedMediaIds ?? project.mediaItems.filter(media => media.probeStatus === "ready").map(media => media.id);
      for (const media of project.mediaItems.filter(media => ids.includes(media.id))) {
        if (await fingerprintFile(media.sourcePath, { signal }) !== media.fingerprint) throw new Error(`模板“${project.name}”的源素材已变化，请重新保存定时任务。`);
        signal?.throwIfAborted();
      }
    }
  }
  async execute(task: AutomationTask, signal: AbortSignal): Promise<Pick<AutomationRun, "exports" | "productionRunId">> {
    const recipe = await this.read(task); await this.verify(recipe, signal); signal.throwIfAborted();
    if (recipe.request.cleanup) {
      const results = await this.dependencies.clear(recipe.request.cleanup, signal);
      if (results.length !== recipe.request.cleanup.accounts.length || results.some(result => result.state !== "CLEARED")) throw new Error(`清理未全部完成，后续步骤已停止：${results.map(result => result.message).join("；")}`);
    }
    signal.throwIfAborted();
    let result: Pick<AutomationRun, "exports" | "productionRunId"> = {};
    if (recipe.request.production) {
      await this.verify(recipe, signal); signal.throwIfAborted();
      for (const entry of recipe.request.production.entries) if (entry.outputDirectory) this.dependencies.approvedDirectories.add(await canonicalPath(entry.outputDirectory));
      const entries = recipe.request.production.entries.map(({ douyinUpload: _upload, ...entry }) => entry);
      await this.dependencies.produce({ entries }, new Map(recipe.projects.map(value => [value.recentProjectId, value.project])), signal);
      const started = this.dependencies.controller.snapshot()!;
      try {
        while (this.dependencies.controller.busy) await delay(250, undefined, { signal });
        signal.throwIfAborted();
      } catch (error) { await this.dependencies.controller.cancel(); throw error; }
      const finished = this.dependencies.controller.snapshot();
      if (finished?.id !== started.id || finished.status !== "finished" || finished.jobs.length !== entries.length || finished.jobs.some(job => job.status !== "completed" || job.completedCount !== job.requestedCount)) throw new Error("制作或导出未全部成功，定时上传未启动。");
      const wanted = new Set(finished.jobs.flatMap(job => job.completedTaskIds ?? []));
      const exports = this.dependencies.queue.snapshot().batches.flatMap(({ batch }) => batch.tasks.filter(value => wanted.has(value.id) && value.status === "completed" && value.outputArtifact)
        .map(value => ({ project_id: batch.projectId!, batch_id: batch.id, export_task_id: value.id })));
      if (!wanted.size || exports.length !== wanted.size) throw new Error("无法确认本轮全部成片记录，未上传。");
      result = { productionRunId: finished.id, exports };
    }
    signal.throwIfAborted();
    if (recipe.request.upload) {
      let sourceRecipe = recipe, sourceRun = task.lastRun!.id;
      if (recipe.request.uploadFrom) {
        const source = this.dependencies.task(recipe.request.uploadFrom);
        if (!source?.lastRun || source.lastRun.state !== "COMPLETED" || !source.lastRun.exports?.length || !source.lastRun.productionRunId) throw new Error("来源任务没有完整成功的新成片，未上传。");
        sourceRecipe = await this.read(source); await this.verify(sourceRecipe, signal);
        result = { exports: source.lastRun.exports, productionRunId: source.lastRun.productionRunId }; sourceRun = source.lastRun.id;
      }
      if (!result.exports?.length) throw new Error("本轮没有可上传的成片。");
      const groups = sourceRecipe.projects.map(({ project, recentProjectId }) => {
        const selection = sourceRecipe.request.production!.entries.find(entry => entry.recentProjectId === recentProjectId)!.douyinUpload;
        if (!selection?.plan) throw new Error("制作任务没有固定上传目标。");
        const target = sourceRecipe.accounts.find(account => account.product === selection.accountProduct)!;
        return { selection, target, exports: result.exports!.filter(identity => identity.project_id === project.id) };
      });
      if (groups.some(group => !group.exports.length) || groups.reduce((sum, group) => sum + group.exports.length, 0) !== result.exports.length) throw new Error("上传产物归属不一致。");
      // A source run can be consumed once, even by different upload schedules or after restart.
      signal.throwIfAborted();
      await writeAutomationFile(path.join(this.root, "upload-claims", `${sourceRun}.json`), { taskId: task.id, runId: task.lastRun!.id, sourceRun, exports: result.exports }, true)
        .catch(() => { throw new Error("来源成片已启动过上传或登记结果未知，禁止自动重传。"); });
      await this.dependencies.upload(groups, signal);
    }
    return result;
  }
}
