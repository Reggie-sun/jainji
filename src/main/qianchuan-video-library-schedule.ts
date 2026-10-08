import { randomUUID } from "node:crypto";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readPrivateJson } from "./qianchuan-account-config.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { QianchuanLibraryScheduleSettingsSchema, type QianchuanLibraryScheduleRun, type QianchuanLibraryScheduleSettings, type QianchuanLibraryScheduleStatus } from "../shared/qianchuan-video-library-schedule.js";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account.js";
import { QianchuanLibraryAccountSchema, type QianchuanLibraryClear, type QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";
import type { QianchuanScheduledLaunch } from "./qianchuan-scheduled-launch.js";

const resultSchema = z.object({ product: QianchuanLibraryAccountSchema.shape.product, advertiserId: QianchuanLibraryAccountSchema.shape.expectedAdvertiserId, state: z.enum(["CLEARED", "PARTIAL", "BLOCKED"]), deletedCount: z.number().int().nonnegative(), message: z.string().max(2000) }).strict();
const runSchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startedAt: z.string().datetime(), finishedAt: z.string().datetime().optional(),
  state: z.enum(["RUNNING", "COMPLETED", "BLOCKED", "SKIPPED"]), message: z.string().max(2000), results: z.array(resultSchema).max(6) }).strict();
const stateSchema = z.object({ version: z.literal(1), settings: QianchuanLibraryScheduleSettingsSchema, lastRun: runSchema.optional() }).strict();
interface Dependencies {
  accounts(): QianchuanAccountSummary[];
  clear(input: QianchuanLibraryClear): Promise<QianchuanLibraryResult[]>;
  changed(): void;
  automaticLaunch?: QianchuanScheduledLaunch;
}
export function localScheduleDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function nextLibraryClearTime(now: Date, time: string, lastDay?: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  const next = new Date(now); next.setHours(hour!, minute!, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  // A clock rollback or reconfiguration must not replay a claimed day.
  if (lastDay && localScheduleDay(next) <= lastDay) {
    const [year, month, day] = lastDay.split("-").map(Number);
    next.setFullYear(year!, month! - 1, day! + 1);
  }
  return next;
}

/** One persistent daily trigger; actual deletion stays in the original upload service. */
export class QianchuanVideoLibrarySchedule {
  private settings: QianchuanLibraryScheduleSettings = { confirmation: "DELETE_ALL_VIDEOS", enabled: false, time: "00:30", accounts: [] };
  private lastRun?: QianchuanLibraryScheduleRun;
  private error?: string;
  private next?: Date;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private started = false;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  constructor(private readonly root: string, private readonly dependencies: Dependencies) { this.file = path.join(root, "video-library-schedule.json"); }
  snapshot(): QianchuanLibraryScheduleStatus {
    return structuredClone({ settings: this.settings, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      nextRunAt: this.next?.toISOString(), lastRun: this.lastRun, error: this.error, automaticLaunch: this.dependencies.automaticLaunch?.snapshot() });
  }
  async load(): Promise<void> {
    try {
      try { await lstat(this.file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      const { value } = await readPrivateJson(this.file, input => stateSchema.parse(input));
      this.settings = value.settings;
      this.lastRun = value.lastRun;
      if (this.lastRun?.state === "RUNNING") {
        this.lastRun = { ...this.lastRun, state: "BLOCKED", message: "上次定时清空中断，结果未知；当天不会自动重试。" };
      }
    } catch { this.error = "定时清空记录不可用，自动删除已停止，请核查设置文件。"; }
  }
  start(): void {
    this.started = true; this.plan();
  }
  initializeAutomaticLaunch(): Promise<void> {
    return this.serialize(async () => {
      if (this.error) return;
      try { await this.dependencies.automaticLaunch?.configure(this.settings); }
      catch { /* The status exposes OS setup failure; the existing in-app timer remains available. */ }
    });
  }
  async requestSystemLaunch(time: string, receivedAt: Date): Promise<void> {
    await this.tick({ time, receivedAt });
  }
  stop(): void {
    this.started = false; if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.next = undefined;
  }
  private plan(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.next = this.started && this.settings.enabled && !this.error ? nextLibraryClearTime(new Date(), this.settings.time, this.lastRun?.day) : undefined;
    this.arm(); this.dependencies.changed();
  }
  private arm(): void {
    if (!this.started || !this.next || this.running || this.error) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick().catch(() => undefined); }, Math.max(1, Math.min(30000, this.next.getTime() - Date.now())));
    this.timer.unref?.();
  }
  private async persist(settings: QianchuanLibraryScheduleSettings, lastRun?: QianchuanLibraryScheduleRun): Promise<void> {
    await secureUploadDirectory(this.root);
    const temporary = path.join(this.root, `library-schedule-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(`${JSON.stringify({ version: 1, settings, lastRun }, null, 2)}\n`); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, this.file); await strictSyncDirectory(this.root);
    } catch (error) {
      this.error = "定时清空记录保存结果未知，自动删除已停止，请重启后核查。";
      this.next = undefined; if (this.timer) clearTimeout(this.timer); this.timer = undefined;
      throw error;
    } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const work = this.writes.catch(() => undefined).then(action); this.writes = work; return work;
  }
  save(input: unknown): Promise<QianchuanLibraryScheduleStatus> {
    return this.serialize(async () => {
      if (this.running || this.error) throw new Error(this.error ?? "定时清空正在执行，请等待结束后设置。");
      const settings = QianchuanLibraryScheduleSettingsSchema.parse(input);
      if (settings.enabled) {
        const accounts = this.dependencies.accounts();
        if (settings.accounts.some(target => !accounts.some(account => account.available && account.product === target.product && account.advertiserId === target.expectedAdvertiserId && (!settings.includePlanMaterials || account.adId === target.expectedAdId)))) {
          throw new Error("清空账号已变化，请重新选择当前已配置账号。");
        }
      }
      await this.persist(settings, this.lastRun); this.settings = settings;
      try { await this.dependencies.automaticLaunch?.configure(settings); }
      finally { this.plan(); }
      return this.snapshot();
    });
  }
  async tick(systemRequest?: { time: string; receivedAt: Date }): Promise<void> {
    const claimed = await this.serialize(async () => {
      if (!this.started || !this.settings.enabled || this.error || this.running || !this.next) return false;
      const now = new Date();
      if (systemRequest) {
        const { time, receivedAt } = systemRequest;
        if (!Number.isFinite(receivedAt.getTime()) || time !== this.settings.time) return false;
        const due = new Date(receivedAt); const [hour, minute] = time.split(":").map(Number);
        due.setHours(hour!, minute!, 0, 0);
        if (receivedAt < due || receivedAt.getTime() - due.getTime() > 60000 || now < receivedAt ||
          now.getTime() - receivedAt.getTime() > 30 * 60000 || localScheduleDay(now) !== localScheduleDay(due) ||
          (this.lastRun && this.lastRun.day >= localScheduleDay(due))) return false;
        if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.next = due;
      }
      if (now < this.next) { this.arm(); return false; }
      const due = this.next;
      const late = (!systemRequest && now.getTime() - due.getTime() > 60000) || localScheduleDay(now) !== localScheduleDay(due);
      const run: QianchuanLibraryScheduleRun = { day: localScheduleDay(due), startedAt: now.toISOString(), state: late ? "SKIPPED" : "RUNNING",
        message: late ? "软件或电脑未在定时时间运行，已跳过；不会补删。" : "正在并行清空定时绑定的账号。", results: [] };
      // The day is durably claimed before any browser mutation; a restart never retries it.
      await this.persist(this.settings, run); this.lastRun = run; this.next = undefined;
      if (late) { this.plan(); return false; }
      this.running = true; this.dependencies.changed(); return true;
    }).catch(() => { this.dependencies.changed(); return false; });
    if (!claimed) return;
    try {
      const results = (await this.dependencies.clear({ confirmation: this.settings.includePlanMaterials ? "DELETE_VIDEOS_AND_PLAN_MATERIALS" : "DELETE_ALL_VIDEOS", accounts: structuredClone(this.settings.accounts) }))
        .map(({ product, advertiserId, state, deletedCount, message }) => ({ product, advertiserId, state, deletedCount, message }));
      this.lastRun = { ...this.lastRun!, finishedAt: new Date().toISOString(), results,
        state: results.every(result => result.state === "CLEARED") ? "COMPLETED" : "BLOCKED",
        message: results.every(result => result.state === "CLEARED") ? "定时清空已完成。" : "部分账号未清空，当天不会自动重试，请查看账号结果。" };
    } catch (error) {
      this.lastRun = { ...this.lastRun!, finishedAt: new Date().toISOString(), state: "BLOCKED", message: error instanceof Error ? error.message.slice(0, 1000) : "定时清空未执行，当天不会自动重试。" };
    }
    try { await this.persist(this.settings, this.lastRun); }
    catch { /* The durable RUNNING claim still fences this day's unknown outcome. */ }
    finally { this.running = false; this.plan(); }
  }
}
