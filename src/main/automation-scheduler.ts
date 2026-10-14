import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AutomationConfigureSchema, AutomationRequestSchema, AutomationTaskSchema, AutomationCleanupMigrationSchema, type AutomationCleanupMigration, type AutomationRequest, type AutomationRun, type AutomationTask, type AutomationStatus } from "../shared/automation.js";
import { automationDigest, readAutomationFile, writeAutomationFile } from "./automation-files.js";
import { localScheduleDay, nextLibraryClearTime } from "./qianchuan-video-library-schedule.js";

const stateSchema = z.object({ version: z.literal(1), tasks: z.array(AutomationTaskSchema).max(100) }).strict()
  .refine(value => new Set(value.tasks.map(task => task.id)).size === value.tasks.length);
const claimedDay = (task: AutomationTask): string | undefined => (task.lastRun?.scheduleRevision ?? 0) === (task.scheduleRevision ?? 0) ? task.lastRun?.day : undefined;
interface Dependencies {
  prepare(request: AutomationRequest, id: string): Promise<{ binding: string; summary: string }>;
  configure(task: AutomationTask): Promise<void>;
  configurationIssue(task: AutomationTask): Promise<string | undefined>;
  execute(task: AutomationTask, signal: AbortSignal): Promise<Pick<AutomationRun, "exports" | "productionRunId">>;
  busy(): boolean;
  changed(): void;
  now?(): Date;
}

/** Trigger ledger only. Production, deletion and upload retain their original owners. */
export class AutomationScheduler {
  private tasks: AutomationTask[] = [];
  private error?: string;
  private timer?: ReturnType<typeof setInterval>;
  private control: Promise<unknown> = Promise.resolve();
  private active?: AbortController;
  private work?: Promise<void>;
  private started = false;
  private configurationIssues = new Map<string, string>();
  private inspectionGeneration = 0;
  constructor(private readonly root: string, private readonly dependencies: Dependencies) {}
  get busy(): boolean { return !!this.active; }
  get enabled(): boolean { return this.tasks.some(task => task.request.enabled); }
  private now(): Date { return this.dependencies.now?.() ?? new Date(); }
  snapshot(): AutomationStatus {
    return structuredClone({ tasks: this.tasks.map(task => ({ ...task, configurationIssue: this.configurationIssues.get(task.id), nextRunAt: task.request.enabled && !this.error && !this.configurationIssues.has(task.id)
      ? nextLibraryClearTime(new Date(Math.max(this.now().getTime(), Date.parse(task.scheduleUpdatedAt ?? task.createdAt))), task.request.time, claimedDay(task)).toISOString() : undefined })),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, running: this.busy, error: this.error });
  }
  task(id: string): AutomationTask | undefined { return structuredClone(this.tasks.find(task => task.id === id)); }
  async refreshConfiguration(): Promise<void> {
    const generation = ++this.inspectionGeneration, tasks = structuredClone(this.tasks), digest = automationDigest(tasks);
    const issues = new Map<string, string>();
    for (const task of tasks) {
      const issue = await this.dependencies.configurationIssue(task);
      if (issue) issues.set(task.id, issue);
    }
    if (generation !== this.inspectionGeneration || digest !== automationDigest(this.tasks)) return;
    if (automationDigest([...issues]) !== automationDigest([...this.configurationIssues])) {
      this.configurationIssues = issues; this.dependencies.changed();
    }
  }
  async load(): Promise<void> {
    try {
      try { await lstat(path.join(this.root, "tasks.json")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      this.tasks = (await readAutomationFile(path.join(this.root, "tasks.json"), input => stateSchema.parse(input))).tasks;
      for (const task of this.tasks) if (task.lastRun?.state === "RUNNING") {
        task.lastRun.state = "BLOCKED"; task.lastRun.message = "上次执行中断，结果可能未知；不会自动恢复或重试。";
      }
    } catch { this.error = "定时任务记录不可用，已停止自动执行。"; }
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => { void this.tick(); }, 1000); this.timer.unref?.();
  }
  async stop(): Promise<void> {
    this.started = false; if (this.timer) clearInterval(this.timer); this.timer = undefined;
    await this.cancelCurrent();
  }
  async cancelCurrent(): Promise<void> { this.active?.abort(); await this.work; }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const work = this.control.catch(() => undefined).then(action); this.control = work; return work;
  }
  private assertEditable(): void {
    if (this.error || this.active) throw new Error(this.error ?? "定时任务正在执行，请等待结束。");
  }
  blockCleanupMigration(): void { this.error = "旧清理任务合并未完成，自动执行已停止；请核查原任务及迁移记录后重新启动。"; }
  async prepareCleanupMigration(request: AutomationRequest, source?: AutomationTask, lastRun?: AutomationRun): Promise<AutomationTask> {
    return this.serialize(async () => {
      this.assertEditable();
      if (!request.cleanup || request.production || request.upload || request.uploadFrom) throw new Error("只能迁移独立清理任务。");
      const id = randomUUID(), prepared = await this.dependencies.prepare(AutomationRequestSchema.parse(request), id);
      return AutomationTaskSchema.parse({ id, request, ...prepared, createdAt: source?.createdAt ?? this.now().toISOString(), lastRun });
    });
  }
  async installCleanupMigration(input: AutomationCleanupMigration): Promise<void> {
    await this.serialize(async () => {
      this.assertEditable();
      const { task, source } = AutomationCleanupMigrationSchema.parse(input);
      if (!task.request.cleanup || task.request.production || task.request.upload || task.request.uploadFrom) throw new Error("只能迁移独立清理任务。");
      const installed = this.tasks.find(value => value.id === task.id);
      if (installed) {
        if (automationDigest(installed) !== automationDigest(task) || source && this.tasks.some(value => value.id === source.id)) throw new Error("合并任务身份不一致。");
        return;
      }
      const current = source && this.tasks.find(value => value.id === source.id);
      if (source && (!current || automationDigest(current) !== automationDigest(source))) throw new Error("原清理任务已变化，未覆盖。");
      const tasks = [...this.tasks.filter(value => value.id !== source?.id), task];
      await this.persist(tasks); this.tasks = tasks; this.dependencies.changed();
    });
  }
  async create(input: unknown): Promise<AutomationStatus> {
    return this.serialize(async () => {
      this.assertEditable();
      if (this.tasks.length >= 100) throw new Error("最多保存 100 个定时任务。");
      const request = AutomationRequestSchema.parse(input), id = randomUUID();
      if (request.uploadFrom && !this.tasks.some(task => task.id === request.uploadFrom && task.request.production && !task.request.upload)) throw new Error("请选择独立制作任务作为上传来源。");
      const prepared = await this.dependencies.prepare(request, id);
      const task = AutomationTaskSchema.parse({ id, request, ...prepared, createdAt: this.now().toISOString() });
      await this.persist([...this.tasks, task]); this.tasks.push(task); this.dependencies.changed(); return this.snapshot();
    });
  }
  async configure(input: unknown): Promise<AutomationStatus> {
    const value = AutomationConfigureSchema.parse(input);
    this.assertEditable();
    return this.serialize(async () => {
      this.assertEditable(); const tasks = structuredClone(this.tasks), task = tasks.find(task => task.id === value.id);
      if (!task) throw new Error("定时任务不存在。");
      if (value.enabled) await this.dependencies.configure(structuredClone(task));
      if (task.request.time !== value.time) {
        task.scheduleRevision = (task.scheduleRevision ?? 0) + 1; task.scheduleUpdatedAt = this.now().toISOString();
      }
      task.request.enabled = value.enabled; task.request.time = value.time;
      await this.persist(tasks); this.tasks = tasks;
      if (value.enabled) this.configurationIssues.delete(task.id);
      this.dependencies.changed(); return this.snapshot();
    });
  }
  async remove(id: string): Promise<AutomationStatus> {
    z.string().uuid().parse(id);
    return this.serialize(async () => {
      this.assertEditable();
      if (this.tasks.some(task => task.request.uploadFrom === id)) throw new Error("请先删除引用本任务的定时上传。");
      await this.persist(this.tasks.filter(task => task.id !== id)); this.tasks = this.tasks.filter(task => task.id !== id);
      this.dependencies.changed(); return this.snapshot();
    });
  }
  async requestSystemLaunch(id: string, time: string, receivedAt: Date): Promise<void> { await this.tick({ id, time, receivedAt }); }
  async tick(systemRequest?: { id: string; time: string; receivedAt: Date }): Promise<void> {
    if (!this.started || this.error || this.active) return;
    const work = this.serialize(async () => {
      if (!this.started || this.error || this.active) return;
      for (const task of this.tasks) {
        if (!this.started || this.error) break;
        const now = this.now(), day = localScheduleDay(now);
        if (systemRequest && (task.id !== systemRequest.id || task.request.time !== systemRequest.time)) continue;
        const lastDay = claimedDay(task);
        if (!task.request.enabled || lastDay && lastDay >= day) continue;
        const due = new Date(now), [hour, minute] = task.request.time.split(":").map(Number);
        due.setHours(hour!, minute!, 0, 0);
        if (systemRequest && (!Number.isFinite(systemRequest.receivedAt.getTime()) || systemRequest.receivedAt < due ||
          systemRequest.receivedAt.getTime() - due.getTime() > 60000 || now < systemRequest.receivedAt ||
          now.getTime() - systemRequest.receivedAt.getTime() > 30 * 60000 || localScheduleDay(systemRequest.receivedAt) !== day)) continue;
        if (now < due || new Date(task.createdAt) > due || task.scheduleUpdatedAt && new Date(task.scheduleUpdatedAt) > due) continue;
        const skip = !systemRequest && now.getTime() - due.getTime() > 60000 || this.dependencies.busy();
        const run: AutomationRun = { id: randomUUID(), day, scheduleRevision: task.scheduleRevision ?? 0, startedAt: now.toISOString(), state: skip ? "SKIPPED" : "RUNNING",
          message: skip ? "错过执行时间或已有任务运行，已跳过；不会自动补跑。" : "正在执行固定配置的定时任务。" };
        const candidate = this.tasks.map(value => value.id === task.id ? { ...value, lastRun: run } : value);
        if (!skip) this.active = new AbortController();
        try { await this.persist(candidate); }
        catch (error) { this.active = undefined; throw error; }
        task.lastRun = run;
        this.dependencies.changed();
        if (skip) continue;
        try {
          this.active!.signal.throwIfAborted();
          const result = await this.dependencies.execute(structuredClone(task), this.active!.signal);
          this.active!.signal.throwIfAborted();
          task.lastRun = { ...run, ...result, state: "COMPLETED", finishedAt: this.now().toISOString(), message: "本次定时任务已完成。" };
        } catch (error) {
          task.lastRun = { ...run, state: "BLOCKED", finishedAt: this.now().toISOString(), message: error instanceof Error ? error.message.slice(0, 2000) : "执行未完成，已停止后续步骤。" };
        }
        try { await this.persist(this.tasks); }
        finally { this.active = undefined; this.dependencies.changed(); }
      }
    }).catch(() => { this.dependencies.changed(); });
    this.work = work; await work;
  }
  private async persist(tasks: AutomationTask[]): Promise<void> {
    const state = stateSchema.parse({ version: 1, tasks });
    try {
      await writeAutomationFile(path.join(this.root, "tasks.json"), state);
    } catch (error) { this.error = "定时记录保存结果未知，自动执行已停止；请核查后重启。"; throw error; }
  }
}
