import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AutomationRequestSchema, AutomationTaskSchema, type AutomationRequest, type AutomationRun, type AutomationTask, type AutomationStatus } from "../shared/automation.js";
import { readAutomationFile, writeAutomationFile } from "./automation-files.js";
import { localScheduleDay, nextLibraryClearTime } from "./qianchuan-video-library-schedule.js";

const stateSchema = z.object({ version: z.literal(1), tasks: z.array(AutomationTaskSchema).max(100) }).strict()
  .refine(value => new Set(value.tasks.map(task => task.id)).size === value.tasks.length);
interface Dependencies {
  prepare(request: AutomationRequest, id: string): Promise<{ binding: string; summary: string }>;
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
  constructor(private readonly root: string, private readonly dependencies: Dependencies) {}
  get busy(): boolean { return !!this.active; }
  get enabled(): boolean { return this.tasks.some(task => task.request.enabled); }
  private now(): Date { return this.dependencies.now?.() ?? new Date(); }
  snapshot(): AutomationStatus {
    return structuredClone({ tasks: this.tasks.map(task => ({ ...task, nextRunAt: task.request.enabled && !this.error
      ? nextLibraryClearTime(this.now(), task.request.time, task.lastRun?.day).toISOString() : undefined })),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, running: this.busy, error: this.error });
  }
  task(id: string): AutomationTask | undefined { return structuredClone(this.tasks.find(task => task.id === id)); }
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
    const value = z.object({ id: z.string().uuid(), enabled: z.boolean(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict().parse(input);
    return this.serialize(async () => {
      this.assertEditable(); const tasks = structuredClone(this.tasks), task = tasks.find(task => task.id === value.id);
      if (!task) throw new Error("定时任务不存在。");
      task.request.enabled = value.enabled; task.request.time = value.time;
      await this.persist(tasks); this.tasks = tasks; this.dependencies.changed(); return this.snapshot();
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
  async tick(): Promise<void> {
    if (!this.started || this.error || this.active) return;
    const work = this.serialize(async () => {
      if (!this.started || this.error || this.active) return;
      for (const task of this.tasks) {
        if (!this.started || this.error) break;
        const now = this.now(), day = localScheduleDay(now);
        if (!task.request.enabled || task.lastRun && task.lastRun.day >= day) continue;
        const due = new Date(now), [hour, minute] = task.request.time.split(":").map(Number);
        due.setHours(hour!, minute!, 0, 0);
        if (now < due || new Date(task.createdAt) > due) continue;
        const skip = now.getTime() - due.getTime() > 60000 || this.dependencies.busy();
        const run: AutomationRun = { id: randomUUID(), day, startedAt: now.toISOString(), state: skip ? "SKIPPED" : "RUNNING",
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
