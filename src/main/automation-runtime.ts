import path from "node:path";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { AutomationRequestSchema, type AutomationRequest, type AutomationTask, type AutomationRun } from "../shared/automation.js";
import { type BatchProductionStart } from "../shared/batch-production.js";
import { FrozenAccountSchema, UploadIdentitySchema, type UploadIdentity, type QianchuanUploadSelection } from "../shared/douyin-upload.js";
import type { FissionSchedule } from "../shared/video-fission.js";
import type { QianchuanProduct } from "../shared/qianchuan-account.js";
import type { QianchuanLibraryClear, QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";
import { ProjectSchema, type Project } from "./domain.js";
import type { BatchProductionController } from "./batch-production-controller.js";
import type { ExportQueue } from "./queue.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { canonicalPath, fingerprintFile } from "./paths.js";
import { automationDigest, readAutomationFile, writeAutomationFile } from "./automation-files.js";
import { uploadProducingExports, type AutomationProductionUploadBinding } from "./automation-production-upload.js";
import { AutomationModelRolesSchema, automationModelRoles, type AutomationModelRole } from "./automation-model-binding.js";

const recipeSchema = z.object({ version: z.literal(1), id: z.string().uuid(), request: AutomationRequestSchema,
  projects: z.array(z.object({ recentProjectId: z.string().uuid(), project: ProjectSchema }).strict()).max(250),
  fissionProject: ProjectSchema.optional(),
  // Legacy fields remain readable and digest-bound, but never select models for a new execution.
  accounts: z.array(FrozenAccountSchema).max(6), modelBinding: z.string().optional(), modelRoles: AutomationModelRolesSchema.optional(),
}).strict().refine(recipe => (!recipe.modelRoles || !!recipe.modelBinding) &&
  (recipe.request.fission ? recipe.fissionProject?.id === recipe.request.fission.projectId : !recipe.fissionProject));
type Recipe = z.infer<typeof recipeSchema>;
interface Dependencies {
  loadProject(id: string): Promise<Project>;
  account(product: QianchuanProduct): Promise<FrozenQianchuanAccount>;
  modelBinding(roles: AutomationModelRole[]): string;
  approvedDirectories: Set<string>;
  controller: BatchProductionController;
  queue: Pick<ExportQueue, "snapshot" | "waitForPersistence">;
  task(id: string): AutomationTask | undefined;
  produce(input: BatchProductionStart, projects: ReadonlyMap<string, Project>, signal: AbortSignal): Promise<void>;
  fission?: {
    loadProject(id: string): Promise<Project>;
    execute(input: FissionSchedule, project: Project, signal: AbortSignal): Promise<UploadIdentity[]>;
  };
  clear(input: QianchuanLibraryClear, signal: AbortSignal): Promise<QianchuanLibraryResult[]>;
  upload(groups: { selection: QianchuanUploadSelection; target: FrozenQianchuanAccount; exports: UploadIdentity[] }[], signal: AbortSignal, retainBrowser?: boolean): Promise<void>;
  finishUploadAccount(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<void>;
  releaseUploadAccounts(): void;
}
const actions = (request: AutomationRequest) => ({ cleanup: request.cleanup, production: request.production, fission: request.fission, upload: request.upload, uploadFrom: request.uploadFrom });
const identity = (account: FrozenQianchuanAccount) => automationDigest(FrozenAccountSchema.parse(account));

/** Sealed recipes adapt scheduled triggers into the original production owners. */
export class AutomationRuntime {
  constructor(private readonly root: string, private readonly dependencies: Dependencies) {}
  private file(id: string): string { return path.join(this.root, "recipes", `${z.string().uuid().parse(id)}.json`); }
  async prepare(request: AutomationRequest, id: string): Promise<{ binding: string; summary: string }> {
    request = AutomationRequestSchema.parse(request);
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
    let fissionProject: Project | undefined;
    if (request.fission) {
      if (!this.dependencies.fission) throw new Error("当前版本未加载定时裂变服务。");
      fissionProject = ProjectSchema.parse(await this.dependencies.fission.loadProject(request.fission.projectId));
      if (fissionProject.id !== request.fission.projectId || request.fission.mediaIds.some(id => !fissionProject!.mediaItems.some(m => m.id === id && m.probeStatus === "ready"))) throw new Error("裂变素材未就绪，请重新选择。");
      fissionProject.mediaItems = request.fission.mediaIds.map(id => fissionProject!.mediaItems.find(m => m.id === id)!);
      fissionProject.exportBatches = []; delete fissionProject.latestProduction; delete fissionProject.reviewDrafts;
      if (request.fission.outputDirectory && !this.dependencies.approvedDirectories.has(await canonicalPath(request.fission.outputDirectory))) throw new Error("请先通过系统对话框选择成片目录。");
      const selection = request.fission.douyinUpload;
      if (selection?.plan) await bindAccount(selection.accountProduct, selection.plan.advertiserId);
      else if (selection) throw new Error("请明确选择定时上传计划。");
    }
    if (request.uploadFrom) {
      const source = this.dependencies.task(request.uploadFrom);
      if (!source?.request.production || source.request.upload) throw new Error("上传来源必须是独立制作任务。");
      const recipe = await this.read(source);
      if (recipe.request.production!.entries.some(entry => !entry.douyinUpload?.plan)) throw new Error("来源制作任务尚未固定上传账号及计划，请重新保存带上传目标的制作任务。");
    }
    if (new Set(projects.map(value => value.project.id)).size !== projects.length) throw new Error("同一个项目不能以多个模板条目重复绑定。");
    const recipe = recipeSchema.parse({ version: 1, id, request, projects, ...(fissionProject ? { fissionProject } : {}), accounts: [...accounts.values()] });
    await this.verify(recipe, undefined, this.currentModelBinding(recipe));
    const summary = [
      ...(request.cleanup?.accounts.map(account => `清理账户 ${account.expectedAdvertiserId}${request.cleanup!.confirmation === "DELETE_ALL_VIDEOS" ? " · 视频库全部视频" : ` · 计划 ${(account.plans?.map(plan => plan.adId) ?? [account.expectedAdId]).join("、")}`}`) ?? []),
      ...projects.map(({ project, recentProjectId }) => {
        const entry = request.production!.entries.find(entry => entry.recentProjectId === recentProjectId)!;
        const sources = [...new Set(project.mediaItems.map(media => path.dirname(media.sourcePath)))];
        return `${project.name} · ${entry.requestedCount} 条 · 素材 ${sources.join("、")}${entry.douyinUpload?.plan ? ` · 上传账户 ${entry.douyinUpload.plan.advertiserId} / 计划 ${entry.douyinUpload.plan.adId}` : ""}`;
      }),
      ...(request.fission && fissionProject ? [`视频裂变 · ${request.fission.mediaIds.length} 条源素材 / ${request.fission.total} 条成片 · 素材 ${[...new Set(fissionProject.mediaItems.map(m => path.dirname(m.sourcePath)))].join("、")} · 输出 ${request.fission.outputDirectory ?? "每次自动创建裂变目录"}${request.fission.douyinUpload?.plan ? ` · 上传账户 ${request.fission.douyinUpload.plan.advertiserId} / 计划 ${request.fission.douyinUpload.plan.adId}` : ""}`] : []),
      ...(request.uploadFrom ? [`上传来源：${this.dependencies.task(request.uploadFrom)!.request.name}`] : []),
    ].join("\n");
    if (summary.length > 8000) throw new Error("定时任务配置过多，请拆分任务。");
    await writeAutomationFile(this.file(id), recipe, true);
    return { binding: automationDigest(recipe), summary };
  }
  private async read(task: AutomationTask): Promise<Recipe> {
    const recipe = await readAutomationFile(this.file(task.recipeId ?? task.id), value => recipeSchema.parse(value));
    if (recipe.id !== task.id || automationDigest(recipe) !== task.binding || automationDigest(actions(recipe.request)) !== automationDigest(actions(task.request))) throw new Error("定时任务固定配置不一致，已停止。");
    return recipe;
  }
  private async verify(recipe: Recipe, signal?: AbortSignal, modelBinding?: string): Promise<void> {
    const verifyModel = () => {
      if (modelBinding !== undefined && modelBinding !== this.currentModelBinding(recipe)) throw new Error("模型配置已在本次执行中变化，已停止后续步骤。");
    };
    verifyModel();
    const fission = recipe.request.fission;
    if (fission) {
      if (!this.dependencies.fission) throw new Error("当前版本未加载定时裂变服务。");
      if (fission.outputDirectory && await canonicalPath(fission.outputDirectory) !== fission.outputDirectory) throw new Error("固定成片目录的实际位置已变化，请重新选择目录并保存任务。");
      for (const id of fission.mediaIds) {
        const media = recipe.fissionProject!.mediaItems.find(m => m.id === id);
        if (!media || media.probeStatus !== "ready" || await fingerprintFile(media.sourcePath, { signal }) !== media.fingerprint) throw new Error("裂变源素材已变化，请重新保存定时任务。");
        signal?.throwIfAborted();
      }
    }
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
    verifyModel();
  }
  private currentModelBinding(recipe: Recipe): string | undefined {
    const roles = automationModelRoles(recipe.request, recipe.projects);
    return roles.length ? this.dependencies.modelBinding(roles) : undefined;
  }
  async configurationIssue(task: AutomationTask): Promise<string | undefined> {
    try {
      this.currentModelBinding(await this.read(task));
      if (task.request.uploadFrom) {
        const source = this.dependencies.task(task.request.uploadFrom);
        if (!source) throw new Error("来源制作任务不存在。");
        await this.read(source);
      }
      return undefined;
    } catch (error) { return error instanceof Error ? error.message.slice(0, 2000) : "当前模型配置暂不可用。"; }
  }
  async configure(task: AutomationTask): Promise<void> {
    const recipe = await this.read(task);
    await this.verify(recipe, undefined, this.currentModelBinding(recipe));
    if (recipe.request.uploadFrom) {
      const source = this.dependencies.task(recipe.request.uploadFrom);
      if (!source) throw new Error("来源制作任务不存在。");
      await this.verify(await this.read(source));
    }
  }
  async verifyCleanupMigration(task: AutomationTask): Promise<void> {
    await this.verify(await this.read(task));
  }
  private async claimUpload(task: AutomationTask, sourceRun: string, exports?: UploadIdentity[]): Promise<void> {
    await writeAutomationFile(path.join(this.root, "upload-claims", `${z.string().uuid().parse(sourceRun)}.json`),
      { taskId: task.id, runId: task.lastRun!.id, sourceRun, ...(exports ? { exports } : { streaming: true }) }, true)
      .catch(() => { throw new Error("来源成片已启动过上传或登记结果未知，禁止自动重传。"); });
  }
  async execute(task: AutomationTask, signal: AbortSignal): Promise<Pick<AutomationRun, "exports" | "productionRunId">> {
    try { return await this.executeRun(task, signal); }
    finally { this.dependencies.releaseUploadAccounts(); }
  }
  private async executeRun(task: AutomationTask, signal: AbortSignal): Promise<Pick<AutomationRun, "exports" | "productionRunId">> {
    const recipe = await this.read(task), modelBinding = this.currentModelBinding(recipe);
    await this.verify(recipe, signal, modelBinding); signal.throwIfAborted();
    if (recipe.request.cleanup) {
      const results = await this.dependencies.clear(recipe.request.cleanup, signal);
      if (results.length !== recipe.request.cleanup.accounts.length || results.some(result => result.state !== "CLEARED")) throw new Error(`清理未全部完成，后续步骤已停止：${results.map(result => result.message).join("；")}`);
    }
    signal.throwIfAborted();
    let result: Pick<AutomationRun, "exports" | "productionRunId"> = {};
    const streaming = !!recipe.request.production && recipe.request.upload;
    if (recipe.request.fission) {
      await this.verify(recipe, signal, modelBinding); signal.throwIfAborted();
      // Claim before generation, so an interrupted upload occurrence cannot regenerate/resend.
      if (recipe.request.upload) await this.claimUpload(task, task.lastRun!.id);
      signal.throwIfAborted();
      const { douyinUpload: _target, ...input } = recipe.request.fission;
      const exports = await this.dependencies.fission!.execute(input, recipe.fissionProject!, signal);
      signal.throwIfAborted();
      const validated = z.array(UploadIdentitySchema).length(input.total).safeParse(exports);
      if (!validated.success || new Set(exports.map(e => e.export_task_id)).size !== input.total || exports.some(e => e.project_id !== input.projectId)) throw new Error("裂变成片数量或归属不一致，未上传。");
      result = { exports: validated.data };
    }
    if (recipe.request.production) {
      await this.verify(recipe, signal, modelBinding); signal.throwIfAborted();
      for (const entry of recipe.request.production.entries) if (entry.outputDirectory) this.dependencies.approvedDirectories.add(await canonicalPath(entry.outputDirectory));
      const entries = recipe.request.production.entries.map(({ douyinUpload: _upload, ...entry }) => entry);
      const bindings: AutomationProductionUploadBinding[] = streaming ? recipe.projects.map(({ project, recentProjectId }) => {
        const entry = recipe.request.production!.entries.find(entry => entry.recentProjectId === recentProjectId)!;
        const selection = entry.douyinUpload, target = recipe.accounts.find(account => account.product === selection?.accountProduct);
        if (!selection?.plan || !target) throw new Error("制作任务没有固定上传目标。");
        return { recentProjectId, projectId: project.id, requestedCount: entry.requestedCount, selection, target };
      }) : [];
      if (streaming) { signal.throwIfAborted(); await this.claimUpload(task, task.lastRun!.id); signal.throwIfAborted(); }
      await this.dependencies.produce({ entries }, new Map(recipe.projects.map(value => [value.recentProjectId, value.project])), signal);
      const started = this.dependencies.controller.snapshot();
      let uploaded: UploadIdentity[] | undefined;
      try {
        if (!started) throw new Error("无法确认本轮制作运行，已停止。");
        if (streaming) uploaded = await uploadProducingExports({ runId: started.id, bindings, controller: this.dependencies.controller,
          queue: this.dependencies.queue, upload: (groups, signal) => this.dependencies.upload(groups, signal, true),
          finishAccount: (target, signal) => this.dependencies.finishUploadAccount(target, signal) }, signal);
        else while (this.dependencies.controller.busy) await delay(250, undefined, { signal });
        signal.throwIfAborted();
      } catch (error) {
        if (started && this.dependencies.controller.snapshot()?.id === started.id) await this.dependencies.controller.cancel();
        throw error;
      }
      const finished = this.dependencies.controller.snapshot();
      if (finished?.id !== started.id || finished.status !== "finished" || finished.jobs.length !== entries.length || finished.jobs.some(job => job.status !== "completed" || job.completedCount !== job.requestedCount)) {
        throw new Error(streaming ? `制作或导出未全部成功；已上传 ${uploaded!.length} 条成功成片，未自动重试。` : "制作或导出未全部成功，定时上传未启动。");
      }
      const wanted = new Set(finished.jobs.flatMap(job => job.completedTaskIds ?? []));
      const exports = this.dependencies.queue.snapshot().batches.flatMap(({ batch }) => batch.tasks.filter(value => wanted.has(value.id) && value.status === "completed" && value.outputArtifact)
        .map(value => ({ project_id: batch.projectId!, batch_id: batch.id, export_task_id: value.id })));
      if (!wanted.size || exports.length !== wanted.size) throw new Error(streaming ? "无法确认本轮全部成片记录；已上传记录保留，未自动重试。" : "无法确认本轮全部成片记录，未上传。");
      if (uploaded && (uploaded.length !== wanted.size || uploaded.some(value => !wanted.has(value.export_task_id)))) throw new Error("本轮成片与上传记录不一致，未自动重试。");
      result = { productionRunId: finished.id, exports };
    }
    signal.throwIfAborted();
    if (recipe.request.upload && !streaming) {
      let sourceRecipe = recipe, sourceRun = task.lastRun!.id;
      if (recipe.request.uploadFrom) {
        const source = this.dependencies.task(recipe.request.uploadFrom);
        if (!source?.lastRun || source.lastRun.state !== "COMPLETED" || !source.lastRun.exports?.length || !source.lastRun.productionRunId) throw new Error("来源任务没有完整成功的新成片，未上传。");
        sourceRecipe = await this.read(source); await this.verify(sourceRecipe, signal);
        result = { exports: source.lastRun.exports, productionRunId: source.lastRun.productionRunId }; sourceRun = source.lastRun.id;
      }
      if (!result.exports?.length) throw new Error("本轮没有可上传的成片。");
      const groups = sourceRecipe.request.fission ? (() => {
        const selection = sourceRecipe.request.fission.douyinUpload;
        const target = sourceRecipe.accounts.find(account => account.product === selection?.accountProduct);
        if (!selection?.plan || !target) throw new Error("裂变任务没有固定上传目标。");
        return [{ selection, target, exports: result.exports! }];
      })() : sourceRecipe.projects.map(({ project, recentProjectId }) => {
        const selection = sourceRecipe.request.production!.entries.find(entry => entry.recentProjectId === recentProjectId)!.douyinUpload;
        if (!selection?.plan) throw new Error("制作任务没有固定上传目标。");
        const target = sourceRecipe.accounts.find(account => account.product === selection.accountProduct)!;
        return { selection, target, exports: result.exports!.filter(identity => identity.project_id === project.id) };
      });
      if (groups.some(group => !group.exports.length) || groups.reduce((sum, group) => sum + group.exports.length, 0) !== result.exports.length) throw new Error("上传产物归属不一致。");
      // A source run can be consumed once, even by different upload schedules or after restart.
      signal.throwIfAborted();
      if (!recipe.request.fission) await this.claimUpload(task, sourceRun, result.exports);
      await this.dependencies.upload(groups, signal);
    }
    return result;
  }
}
