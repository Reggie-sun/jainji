import { constants } from "node:fs";
import { appendFile, chmod, copyFile, lstat, realpath, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { QueueState } from "./domain.js";
import type { ExportBatchIdentity } from "./queue.js";
import { fingerprintFile, isPathWithinDirectory, pathsEqual } from "./paths.js";
import { DouyinUploadStore, frozenInputDigest, intentKey, secureUploadDirectory, uploadTaskId, type UploadTaskRecord } from "./douyin-upload-store.js";
import { DouyinUploadConfigSchema, DouyinUploadSelectionSchema, UploadError, UploadIdentitySchema, UploadResultSchema, UploadSuccessSchema, uploadFailure, type DouyinUploadConfig, type DouyinUploadSelection, type DouyinUploadStatus, type UploadIdentity, type UploadState, type UploadSuccess } from "../shared/douyin-upload.js";

/** Each operation must observe AbortSignal; stop detaches and fences all subsequent actions. */
export interface UploadBrowserPort {
  connect(task: UploadTaskRecord, signal: AbortSignal): Promise<void>;
  open(task: UploadTaskRecord, signal: AbortSignal): Promise<void>;
  upload(task: UploadTaskRecord, signal: AbortSignal): Promise<void>;
  ready(task: UploadTaskRecord, signal: AbortSignal): Promise<void>;
  fill(task: UploadTaskRecord, signal: AbortSignal): Promise<void>;
  publish(task: UploadTaskRecord, signal: AbortSignal): Promise<void>;
  verify(task: UploadTaskRecord, signal: AbortSignal): Promise<UploadSuccess>;
  stop(): Promise<void>;
}
interface Dependencies {
  loadBatch(id: string): Promise<QueueState>;
  browser(): UploadBrowserPort;
  changed?(): void;
  readiness?(config: DouyinUploadConfig): string | undefined;
  retryDelay?(milliseconds: number, signal: AbortSignal): Promise<void>;
}
const timestamp = () => new Date().toISOString();
const unknown = () => uploadFailure("PUBLISH_OUTCOME_UNKNOWN", "publish", "发布结果未知，不能重新发布。", "在创作者后台核查原内容，继续仅作只读核查。", true);

export class DouyinUploadService {
  private admission: Promise<unknown> = Promise.resolve();
  private active?: { id: string; controller: AbortController; port: UploadBrowserPort };
  private runner?: Promise<void>;
  private paused = false;
  private stopped = false;
  private stopping = false;
  private initializationFailure?: string;
  private control: Promise<unknown> = Promise.resolve();
  private readonly eligible = new Set<string>();
  private controlGeneration = 0;
  constructor(readonly store: DouyinUploadStore, private readonly dependencies: Dependencies) {
    this.paused = store.tasks().some(task => task.result.state === "NEEDS_HUMAN" && (store.hasMarker(task.result.upload_task_id) || ["account", "page"].includes(task.result.failure?.category ?? "")));
  }
  status(projectId: string): DouyinUploadStatus {
    const config = this.store.config;
    const message = this.store.unavailable ? "上传存储不可用，已阻断浏览器操作。" : this.initializationFailure ?? (!config.enabled ? "自动上传已关闭。" : this.dependencies.readiness?.(config) ?? "Chrome 需由用户启动并登录；恢复任务需明确继续。");
    return { config, ready: config.enabled && !this.store.unavailable && !this.dependencies.readiness?.(config), message, tasks: this.store.tasks().filter(task => task.input.project_id === projectId).map(task => UploadResultSchema.parse(this.store.unavailable && this.store.hasMarker(task.result.upload_task_id) && task.result.state !== "SUCCEEDED" ? { ...task.result, state: "NEEDS_HUMAN", publish_outcome: "MAY_HAVE_SUBMITTED", failure: unknown().failure, retryable: false } : task.result)) };
  }
  private changed(): void { this.dependencies.changed?.(); }
  async configure(input: unknown): Promise<void> {
    const config = DouyinUploadConfigSchema.parse(input);
    if (!config.enabled) await this.stop();
    await this.store.setConfig(config);
    if (config.enabled) this.stopped = false;
    this.changed(); // Enabling does not implicitly resume old tasks.
  }
  async registerIntent(identity: UploadIdentity, selection?: DouyinUploadSelection): Promise<void> {
    if (!selection) return;
    await this.store.saveIntent({ ...UploadIdentitySchema.parse(identity), selection: DouyinUploadSelectionSchema.parse(selection), config: this.store.config });
  }
  /** Initialization failure is visible, but cannot fail an already-created export. */
  async registerBatch(batch: ExportBatchIdentity, selection?: DouyinUploadSelection): Promise<void> {
    if (!selection) return;
    try { if (!batch.projectId) throw new Error("Missing project identity"); for (const task of batch.tasks) await this.registerIntent({ project_id: batch.projectId, batch_id: batch.id, export_task_id: task.id }, selection); }
    catch { this.initializationFailure = "上传初始化失败；本次导出继续，未保存授权的任务不会上传。"; this.changed(); }
  }
  async committed(identity: UploadIdentity): Promise<void> {
    try { await this.enqueueFinalArtifact(identity); if (!this.stopping && !this.stopped) void this.runPending().catch(() => { this.changed(); }); }
    catch (error) { this.initializationFailure = error instanceof UploadError ? error.failure.message : "成片上传准入失败；导出结果保持完成。"; this.changed(); }
  }
  enqueueFinalArtifact(identity: UploadIdentity, recovery = false): Promise<UploadTaskRecord | undefined> {
    const generation = this.controlGeneration;
    const work = this.admission.catch(() => undefined).then(async () => {
      identity = UploadIdentitySchema.parse(identity);
      const intent = this.store.intents().find(value => intentKey(value) === intentKey(identity));
      if (!intent) return undefined;
      const state = await this.dependencies.loadBatch(identity.batch_id).catch(() => { throw uploadFailure("EXPORT_NOT_COMMITTED", "input", "无法重读正式导出记录。", "检查该导出的本机记录。", true); });
      const task = state.batch.tasks.find(task => task.id === identity.export_task_id);
      const artifact = task?.outputArtifact;
      if (state.batch.projectId !== identity.project_id || !task || task.status !== "completed" || !artifact || artifact.taskId !== task.id || !task.outputPath || !(await pathsEqual(artifact.path, task.outputPath)) || !isPathWithinDirectory(state.batch.outputDirectory, artifact.path))
        throw uploadFailure("EXPORT_NOT_COMMITTED", "input", "仅允许已保存完成的正式成片。", "等待正式导出完成。", false);
      if (path.extname(artifact.path).toLowerCase() !== ".mp4") throw uploadFailure("UNSUPPORTED_FORMAT", "input", "自动上传仅支持 MP4。", "新制作时选择 MP4；不会自动转码。", false);
      const information = await lstat(artifact.path).catch(() => { throw uploadFailure("ARTIFACT_UNAVAILABLE", "input", "成片文件不可读。", "检查原导出文件。", false); });
      const resolved = await realpath(artifact.path), directory = await realpath(state.batch.outputDirectory);
      if (!information.isFile() || information.isSymbolicLink() || information.size <= 0 || information.size !== artifact.sizeBytes || !isPathWithinDirectory(directory, resolved))
        throw uploadFailure("ARTIFACT_CHANGED", "input", "成片路径、类型或大小与正式记录不一致。", "核查原文件，禁止使用替换文件。", false);
      const hash = (await fingerprintFile(resolved)).replace(/^sha256:/, "");
      const existing = this.store.tasks().find(value => intentKey(value.input) === intentKey(identity));
      if (existing) {
        if (existing.input.artifact_sha256 !== hash) throw uploadFailure("ARTIFACT_CHANGED", "input", "同一导出任务的视频字节已经变化。", "核查原成片；不能重新发布替换文件。", false);
        return existing;
      }
      const input = { ...identity, video_path: resolved, artifact_sha256: hash, size_bytes: information.size, ...(intent.selection.caption !== undefined ? { caption: intent.selection.caption } : {}) };
      const id = uploadTaskId(input), snapshots = path.join(this.store.root, "snapshots");
      await secureUploadDirectory(snapshots);
      const snapshotPath = path.join(snapshots, `${hash}.mp4`);
      try { await copyFile(resolved, snapshotPath, constants.COPYFILE_EXCL); await chmod(snapshotPath, 0o400); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const snapshotInfo = await lstat(snapshotPath);
      if (!snapshotInfo.isFile() || snapshotInfo.isSymbolicLink() || (process.platform !== "win32" && (snapshotInfo.mode & 0o077))) throw uploadFailure("ARTIFACT_CHANGED", "input", "上传快照不是私有普通文件。", "停止并检查快照权限。", false);
      if ((await fingerprintFile(snapshotPath)).replace(/^sha256:/, "") !== hash || (await stat(snapshotPath)).size !== information.size)
        throw uploadFailure("ARTIFACT_CHANGED", "input", "私有上传快照与成片不一致。", "停止上传并核查磁盘。", false);
      const record: UploadTaskRecord = { input, inputDigest: frozenInputDigest(input), config: intent.config, snapshotPath, revisions: [],
        result: { ...identity, upload_task_id: id, artifact_sha256: hash, file_name: path.basename(resolved), state: "PENDING", publish_outcome: "NOT_SUBMITTED", retryable: false, retry_count: 0, attempt_count: 0, timestamp: timestamp() } };
      await this.store.saveTask(record);
      if (!recovery && generation === this.controlGeneration && !this.stopping && !this.stopped) this.eligible.add(id);
      this.changed(); return record;
    });
    this.admission = work; return work;
  }
  async reconcile(): Promise<void> {
    for (const intent of this.store.intents()) {
      if (this.store.tasks().some(value => intentKey(value.input) === intentKey(intent))) continue;
      try { await this.enqueueFinalArtifact(UploadIdentitySchema.parse({ project_id: intent.project_id, batch_id: intent.batch_id, export_task_id: intent.export_task_id }), true); }
      catch (error) { if (!(error instanceof UploadError) || error.failure.code !== "EXPORT_NOT_COMMITTED") this.initializationFailure = "部分已授权任务无法恢复上传准入，请检查成片和记录。"; }
    }
    this.changed(); // No browser wake-up at startup.
  }
  runPending(): Promise<void> {
    if (this.runner) return this.runner;
    if (this.stopped || this.stopping || this.paused || !this.store.config.enabled || this.store.unavailable) return Promise.resolve();
    this.runner = (async () => {
      for (;;) {
        if (this.stopped || this.stopping || this.paused || !this.store.config.enabled || this.store.unavailable) break;
        const task = this.store.tasks().find(value => value.result.state === "PENDING" && this.eligible.has(value.result.upload_task_id)); if (!task) break;
        this.eligible.delete(task.result.upload_task_id);
        await this.execute(task.result.upload_task_id);
      }
    })().finally(() => {
      this.runner = undefined;
      if (this.store.tasks().some(task => task.result.state === "PENDING" && this.eligible.has(task.result.upload_task_id))) void this.runPending().catch(() => this.changed());
    });
    return this.runner;
  }
  resume(id: string): Promise<void> {
    const generation = this.controlGeneration;
    const work = this.control.catch(() => undefined).then(() => generation === this.controlGeneration ? this.resumeOne(id) : undefined); this.control = work; return work;
  }
  private async resumeOne(id: string): Promise<void> {
    if (this.active?.id === id || this.stopping || this.store.unavailable || !this.store.config.enabled) return;
    const task = this.requireTask(id);
    if (["SUCCEEDED", "FAILED_TERMINAL"].includes(task.result.state) || task.result.duplicate_of) return;
    // Other unresolved account/page/submit blockers continue to pause the queue.
    this.stopped = false;
    this.paused = true;
    await this.runner;
    const current = this.requireTask(id);
    if (["SUCCEEDED", "FAILED_TERMINAL"].includes(current.result.state) || current.result.duplicate_of) return;
    const work = this.execute(id); this.runner = work;
    try { await work; } finally { this.runner = undefined; }
    this.paused = this.store.tasks().some(value => value.result.state === "NEEDS_HUMAN" && (this.store.hasMarker(value.result.upload_task_id) || ["account", "page"].includes(value.result.failure?.category ?? "")));
  }
  async cancel(id: string): Promise<void> {
    this.controlGeneration++;
    let task = this.requireTask(id);
    if (task.result.state === "SUCCEEDED" || task.result.duplicate_of) return;
    if (this.active?.id === id) { this.active.controller.abort(); await this.runner; return; }
    task.result = { ...task.result, state: this.store.hasMarker(id) ? "NEEDS_HUMAN" : "CANCELLED", failure: this.store.hasMarker(id) ? unknown().failure : uploadFailure("STOPPED", "cancel", "上传已停止。", "明确继续后重新检查。", false).failure, retryable: false, timestamp: timestamp() };
    await this.save(task);
  }
  async reviseCaption(id: string, caption: string): Promise<void> {
    if (this.runner) throw new Error("请先停止正在执行的上传。");
    const task = this.requireTask(id);
    if (this.store.hasMarker(id) || task.result.duplicate_of || task.result.state === "SUCCEEDED") throw new Error("已提交任务的字段不能修改。");
    const parsed = DouyinUploadSelectionSchema.parse({ enabled: true, caption });
    task.revisions.push({ caption: task.input.caption, timestamp: timestamp() });
    task.input.caption = parsed.caption; task.inputDigest = frozenInputDigest(task.input);
    await this.save(task); // Explicit resume still required.
  }
  async confirm(id: string, evidence: UploadSuccess): Promise<void> {
    if (this.runner) throw new Error("请先停止自动核查。");
    const task = this.requireTask(id);
    if (!this.store.hasMarker(id) || task.result.duplicate_of || task.result.state === "SUCCEEDED") throw new Error("只有已提交且结果未知的任务可以人工确认。");
    const success = UploadSuccessSchema.parse(evidence);
    if (success.confirmation_source !== "human") throw new Error("人工确认来源无效。");
    await this.accept(task, success);
  }
  async stop(): Promise<void> {
    this.controlGeneration++;
    this.stopping = true; this.stopped = true;
    this.eligible.clear();
    try {
      this.active?.controller.abort();
      await this.bounded(() => this.active?.port.stop() ?? Promise.resolve(), 5000, new AbortController().signal).catch(() => { this.paused = true; });
      await this.bounded(async () => { await this.runner; await this.admission.catch(() => undefined); }, 15_000, new AbortController().signal).catch(() => {
        this.paused = true; this.initializationFailure = "上传停止等待超过期限，已禁止后续操作；请核查本机记录。"; this.changed();
      });
    }
    finally { this.stopping = false; }
  }
  private requireTask(id: string): UploadTaskRecord { const task = this.store.task(id); if (!task) throw new Error("找不到上传任务。"); return task; }
  private async save(task: UploadTaskRecord): Promise<void> {
    await this.store.saveTask(task); this.changed();
    await this.log(task).catch(() => undefined);
  }
  private async phase(task: UploadTaskRecord, state: UploadState): Promise<void> {
    task.result = { ...task.result, state, failure: undefined, retryable: false, timestamp: timestamp() }; await this.save(task);
  }
  private async accept(task: UploadTaskRecord, success: UploadSuccess): Promise<void> {
    task.result = { ...task.result, state: "SUCCEEDED", publish_outcome: "ACCEPTED", success: UploadSuccessSchema.parse(success), failure: undefined, retryable: false, timestamp: timestamp() };
    await this.save(task);
  }
  private async snapshotValid(task: UploadTaskRecord): Promise<void> {
    const info = await lstat(task.snapshotPath).catch(() => { throw uploadFailure("ARTIFACT_UNAVAILABLE", "input", "上传快照不可读。", "核查私有上传快照。", false); });
    if (!isPathWithinDirectory(path.join(this.store.root, "snapshots"), task.snapshotPath) || !info.isFile() || info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o077)) || info.size !== task.input.size_bytes || (await fingerprintFile(task.snapshotPath)).replace(/^sha256:/, "") !== task.input.artifact_sha256)
      throw uploadFailure("ARTIFACT_CHANGED", "input", "上传快照已变化，禁止上传。", "核查私有上传快照。", false);
  }
  private async bounded<T>(operation: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const aborted = () => controller.abort(); parent.addEventListener("abort", aborted, { once: true });
    if (parent.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listener: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      listener = () => reject(uploadFailure(parent.aborted ? "STOPPED" : "TIMEOUT", parent.aborted ? "cancel" : "browser", "操作已停止或阶段超时。", "检查浏览器后明确继续。", false));
      controller.signal.addEventListener("abort", listener, { once: true });
      timer = setTimeout(() => controller.abort(), milliseconds);
    });
    try { controller.signal.throwIfAborted(); return await Promise.race([operation(controller.signal), timeout]); }
    finally { clearTimeout(timer); parent.removeEventListener("abort", aborted); if (listener) controller.signal.removeEventListener("abort", listener); controller.abort(); }
  }
  private async execute(id: string): Promise<void> {
    let task = this.requireTask(id);
    const duplicate = this.store.tasks().find(other => other.result.upload_task_id !== id && other.input.artifact_sha256 === task.input.artifact_sha256 && !other.result.duplicate_of && (this.store.hasMarker(other.result.upload_task_id) || other.result.state === "SUCCEEDED"));
    if (duplicate && !this.store.hasMarker(id)) {
      if ((duplicate.input.caption ?? "") !== (task.input.caption ?? "") || JSON.stringify(duplicate.input.metadata) !== JSON.stringify(task.input.metadata)) {
        task.result = { ...task.result, state: "FAILED_TERMINAL", failure: uploadFailure("INPUT_CONFLICT", "input", "同字节视频已绑定不同发布字段，禁止重复发布。", "核查原任务的发布结果。", false).failure, retryable: false, timestamp: timestamp() }; await this.save(task); return;
      }
      task.result = { ...duplicate.result, ...{ project_id: task.input.project_id, batch_id: task.input.batch_id, export_task_id: task.input.export_task_id, upload_task_id: id, file_name: task.result.file_name }, duplicate_of: duplicate.result.upload_task_id, timestamp: timestamp() };
      await this.save(task); if (duplicate.result.state !== "SUCCEEDED") this.paused = true; return;
    }
    const controller = new AbortController();
    // Manual resume has one new bounded attempt; automatic retries use the persisted lifetime budget.
    for (;;) {
      const port = this.dependencies.browser(); this.active = { id, controller, port };
      task.result.attempt_count = (task.result.attempt_count ?? 0) + 1;
      try {
        const t = task.config.timeouts;
        await this.phase(task, this.store.hasMarker(id) ? "VERIFYING" : "CONNECTING_BROWSER");
        await this.bounded(signal => port.connect(task, signal), t.connect, controller.signal);
        if (!this.store.hasMarker(id)) {
          await this.phase(task, "OPENING_UPLOAD_PAGE"); await this.bounded(signal => port.open(task, signal), t.navigation, controller.signal);
          await this.bounded(() => this.snapshotValid(task), t.fileInput, controller.signal); controller.signal.throwIfAborted();
          await this.phase(task, "UPLOADING"); await this.bounded(signal => port.upload(task, signal), t.fileInput, controller.signal);
          await this.phase(task, "WAITING_UPLOAD_COMPLETE"); await this.bounded(signal => port.ready(task, signal), t.processing, controller.signal);
          await this.bounded(signal => port.fill(task, signal), t.action, controller.signal);
          await this.bounded(() => this.snapshotValid(task), t.fileInput, controller.signal); controller.signal.throwIfAborted();
          await this.store.markSubmitting(id); task = this.requireTask(id); this.changed();
          controller.signal.throwIfAborted();
          await this.bounded(signal => port.publish(task, signal), t.action, controller.signal);
        }
        await this.phase(task, "VERIFYING");
        const success = await this.bounded(signal => port.verify(task, signal), t.confirmation, controller.signal);
        controller.signal.throwIfAborted(); await this.accept(task, success); break;
      } catch (error) {
        const fenced = this.store.hasMarker(id);
        const knownRejection = fenced && error instanceof UploadError && error.failure.code === "CONTENT_REJECTED";
        const failure = fenced && !knownRejection ? unknown().failure : controller.signal.aborted ? uploadFailure("STOPPED", "cancel", "上传已停止。", "确认浏览器后明确继续。", false).failure : error instanceof UploadError ? error.failure : uploadFailure("PAGE_CONTRACT_CHANGED", "page", "页面操作无法确认，已停止自动操作。", "检查上传页，不会自动重试。", true).failure;
        task = this.requireTask(id);
        task.result = { ...task.result, state: knownRejection ? "FAILED_TERMINAL" : fenced || failure.requires_human ? "NEEDS_HUMAN" : controller.signal.aborted ? "CANCELLED" : failure.retryable ? "FAILED_RETRYABLE" : "FAILED_TERMINAL",
          publish_outcome: knownRejection ? "REJECTED_KNOWN" : fenced ? "MAY_HAVE_SUBMITTED" : "NOT_SUBMITTED", success: undefined, failure, retryable: !fenced && failure.retryable, timestamp: timestamp() };
        if (fenced && !knownRejection || ["account", "page"].includes(failure.category)) this.paused = true;
        if (!this.store.unavailable) await this.save(task); else { this.initializationFailure = "上传存储失败，结果按未知处理；保留全部记录。"; this.changed(); }
        await this.bounded(() => port.stop(), 5000, new AbortController().signal).catch(() => { this.paused = true; });
        if (!fenced && failure.retryable && !controller.signal.aborted && task.result.retry_count < 2 && !this.store.unavailable) {
          task.result.retry_count++; await this.save(task);
          try { await (this.dependencies.retryDelay ?? ((ms, signal) => delay(ms, undefined, { signal })))(task.result.retry_count === 1 ? 2000 : 5000, controller.signal); }
          catch { task.result.state = "CANCELLED"; task.result.retryable = false; await this.save(task); break; }
          continue;
        }
        break;
      } finally {
        await this.bounded(() => port.stop(), 5000, new AbortController().signal).catch(() => { this.paused = true; });
        if (this.active?.port === port) this.active = undefined;
      }
    }
  }
  private async log(task: UploadTaskRecord): Promise<void> {
    const directory = path.join(this.store.root, "logs"); await secureUploadDirectory(directory);
    let total = 0;
    for (const name of await readdir(directory)) {
      const file = path.join(directory, name), info = await stat(file);
      if (Date.now() - info.mtimeMs > 7 * 86_400_000) await unlink(file); else total += info.size;
    }
    const line = JSON.stringify({ ...task.result, video_path: task.input.video_path, cdp_endpoint: task.config.cdpEndpoint, page_url: task.config.uploadPageUrl });
    if (total + Buffer.byteLength(line) < 100 * 1024 * 1024) await appendFile(path.join(directory, `${timestamp().slice(0, 10)}.jsonl`), `${line}\n`, { mode: 0o600 });
  }
}
