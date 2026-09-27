import { constants } from "node:fs";
import { appendFile, chmod, copyFile, lstat, open, realpath, readdir, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { QueueState } from "./domain.js";
import type { ExportBatchIdentity } from "./queue.js";
import { fingerprintFile, isPathWithinDirectory, pathsEqual } from "./paths.js";
import { DouyinUploadStore, frozenInputDigest, intentKey, secureUploadDirectory, strictSyncDirectory, uploadTaskId, sameTargetBytes, type UploadTaskRecord } from "./douyin-upload-store.js";
import { QianchuanAccountConfigReader } from "./qianchuan-account-config.js";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account.js";
import { QianchuanUploadConfigSchema, QianchuanUploadSelectionSchema, UploadError, UploadIdentitySchema, QianchuanUploadResultSchema, ReadyEvidenceSchema, UploadAuthorizationSchema, uploadFailure, type QianchuanUploadConfig, type QianchuanUploadSelection, type DouyinUploadStatus, type UploadIdentity, type UploadAuthorization, type PageOwnership, type ReadyEvidence, type QianchuanUploadResult } from "../shared/douyin-upload.js";

export interface BatchSelectedFile { fileName: string; index: number; }
export interface UploadBrowserPort {
  connect(task: UploadTaskRecord, signal: AbortSignal): Promise<void>;
  open(task: UploadTaskRecord, selected: BatchSelectedFile[], signal: AbortSignal): Promise<{ pageOwnership: PageOwnership; selectedIndex: number }>;
  upload(task: UploadTaskRecord, signal: AbortSignal): Promise<void>;
  ready(task: UploadTaskRecord, signal: AbortSignal): Promise<ReadyEvidence>;
  readOnlyCheck(task: UploadTaskRecord, ownership: PageOwnership, selected: BatchSelectedFile[], signal: AbortSignal): Promise<ReadyEvidence>;
  stop(): Promise<void>;
}
interface Dependencies {
  loadBatch(id: string): Promise<QueueState>; browser(): UploadBrowserPort;
  accounts?: QianchuanAccountConfigReader; changed?(): void;
  readiness?(config: QianchuanUploadConfig): string | undefined;
}
const timestamp = () => new Date().toISOString();
const unknown = () => uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "上传结果未知，禁止重新选文件。", "在 Chrome 核查原批次页面；页面丢失时需人工处理。", true);

export class DouyinUploadService {
  private admission: Promise<unknown> = Promise.resolve();
  private control: Promise<unknown> = Promise.resolve();
  private active?: { id: string; controller: AbortController; port: UploadBrowserPort };
  private runner?: Promise<void>;
  private paused = false;
  private stopped = false;
  private stopping = false;
  private initializationFailure?: string;
  private summaries: QianchuanAccountSummary[] = [];
  private readonly eligible = new Set<string>();
  private readonly currentIntents = new Set<string>();
  private readonly sessions = new Map<string, UploadBrowserPort>();
  private controlGeneration = 0;
  private readonly accounts: QianchuanAccountConfigReader;
  constructor(readonly store: DouyinUploadStore, private readonly dependencies: Dependencies) {
    this.accounts = dependencies.accounts ?? new QianchuanAccountConfigReader();
    this.paused = store.tasks().some(task => task.result.state === "NEEDS_HUMAN");
  }
  status(projectId: string): DouyinUploadStatus {
    const { accountConfigPath, ...config } = this.store.config;
    const message = this.store.unavailable ? "上传存储不可用，已阻断浏览器操作。" : this.initializationFailure ?? (!config.enabled ? "自动上传已关闭。" : this.dependencies.readiness?.(this.store.config) ?? (!this.summaries.some(account => account.available) ? "请授权可用的千川账号配置。" : "成片上传至所选计划，停在确定前。"));
    const tasks = this.store.tasks().filter(task => task.input.project_id === projectId).map(task => {
      let result = task.result;
      if (this.store.unavailable && this.store.hasMarker(result.upload_task_id) && result.state !== "WAITING_FOR_CONFIRMATION") result = { ...result, state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", readyEvidence: undefined, retryable: false, failure: unknown().failure };
      return QianchuanUploadResultSchema.parse(result);
    });
    return { config, configSelected: Boolean(accountConfigPath), accounts: structuredClone(this.summaries), ready: config.enabled && !this.store.unavailable && this.summaries.some(account => account.available) && !this.dependencies.readiness?.(this.store.config), message, tasks, legacyTasks: this.store.legacyTasks().filter(task => task.project_id === projectId) };
  }
  private changed(): void { this.dependencies.changed?.(); }
  async restoreConfig(): Promise<void> {
    if (this.store.config.accountConfigPath) {
      try { this.summaries = await this.accounts.authorizeFile(this.store.config.accountConfigPath); }
      catch { this.summaries = []; this.initializationFailure = "账号配置不可用，请重新通过文件选择器授权。"; }
    }
  }
  /** Only the trusted main-process file dialog may call this with a path. */
  async chooseConfig(file: string): Promise<void> {
    const summary = await this.accounts.authorizeFile(file);
    await this.store.setConfig({ ...this.store.config, accountConfigPath: file });
    this.summaries = summary; this.initializationFailure = undefined; this.changed();
  }
  async refreshAccounts(): Promise<void> {
    try { this.summaries = await this.accounts.refresh(); this.initializationFailure = undefined; }
    catch { this.summaries = []; this.initializationFailure = "账号配置不可用，请检查文件权限和映射。"; }
    this.changed();
  }
  async configure(input: unknown): Promise<void> {
    const publicSettings = QianchuanUploadConfigSchema.omit({ accountConfigPath: true }).parse(input);
    if (!publicSettings.enabled) await this.stop();
    const config = QianchuanUploadConfigSchema.parse({ ...publicSettings, accountConfigPath: this.store.config.accountConfigPath });
    if (config.accountConfigPath) this.summaries = await this.accounts.refresh();
    await this.store.setConfig(config); if (config.enabled) this.stopped = false;
    this.changed();
  }
  async preflight(selection: QianchuanUploadSelection | undefined, expectedCount: number): Promise<UploadAuthorization | undefined> {
    if (!selection) return undefined;
    const parsed = QianchuanUploadSelectionSchema.parse(selection);
    if (!this.store.config.enabled || this.store.unavailable) throw new Error("请先启用千川上传并授权账号配置。");
    if (this.dependencies.readiness?.(this.store.config)) throw new Error(this.dependencies.readiness(this.store.config));
    const target = await this.accounts.preflight(parsed.accountProduct);
    return UploadAuthorizationSchema.parse({ target, pageBatchId: randomUUID(), expectedCount });
  }
  async registerBatch(batch: ExportBatchIdentity, selection?: QianchuanUploadSelection, authorization?: UploadAuthorization): Promise<void> {
    if (!selection) return;
    const generation = this.controlGeneration;
    try {
      const parsed = QianchuanUploadSelectionSchema.parse(selection);
      if (!batch.projectId || !authorization || parsed.accountProduct !== authorization.target.product) throw new Error("Missing main-process preflight");
      const target = await this.accounts.freeze(parsed.accountProduct, authorization.target.configDigest);
      if (JSON.stringify(target) !== JSON.stringify(authorization.target)) throw new Error("Changed account mapping");
      const already = this.store.intents().filter(intent => intent.authorization.pageBatchId === authorization.pageBatchId);
      const newIds = batch.tasks.filter(task => !already.some(intent => intent.export_task_id === task.id && intent.batch_id === batch.id));
      if (already.length + newIds.length > authorization.expectedCount) throw new Error("Batch count changed");
      await this.store.saveIntents(batch.tasks.map(task => ({ ...UploadIdentitySchema.parse({ project_id: batch.projectId, batch_id: batch.id, export_task_id: task.id }), selection: parsed, authorization, config: this.store.config })));
      if (generation === this.controlGeneration && !this.stopping && this.store.config.enabled) {
        this.stopped = false;
        for (const task of batch.tasks) this.currentIntents.add(intentKey({ project_id: batch.projectId, batch_id: batch.id, export_task_id: task.id }));
      }
    } catch { this.initializationFailure = "上传初始化失败或账号配置已变化；导出继续，未保存授权的任务不会上传。"; this.changed(); }
  }
  async committed(identity: UploadIdentity): Promise<void> {
    try { await this.enqueueFinalArtifact(identity); if (!this.stopping && !this.stopped) void this.runPending().catch(() => this.changed()); }
    catch (error) { this.initializationFailure = error instanceof UploadError ? error.failure.message : "成片上传准入失败；导出结果保持完成。"; this.changed(); }
  }
  enqueueFinalArtifact(identity: UploadIdentity, recovery = false): Promise<UploadTaskRecord | undefined> {
    const generation = this.controlGeneration;
    const work = this.admission.catch(() => undefined).then(async () => {
      identity = UploadIdentitySchema.parse(identity);
      const intent = this.store.intents().find(value => intentKey(value) === intentKey(identity)); if (!intent) return undefined;
      const state = await this.dependencies.loadBatch(identity.batch_id).catch(() => { throw uploadFailure("EXPORT_NOT_COMMITTED", "input", "无法重读正式导出记录。", "检查本机导出记录。", true); });
      const task = state.batch.tasks.find(value => value.id === identity.export_task_id), artifact = task?.outputArtifact;
      if (state.batch.projectId !== identity.project_id || !task || task.status !== "completed" || !artifact || artifact.taskId !== task.id || !task.outputPath || !(await pathsEqual(artifact.path, task.outputPath)) || !isPathWithinDirectory(state.batch.outputDirectory, artifact.path)) throw uploadFailure("EXPORT_NOT_COMMITTED", "input", "仅允许已保存完成的正式成片。", "等待正式导出完成。", false);
      if (path.extname(artifact.path).toLowerCase() !== ".mp4") throw uploadFailure("UNSUPPORTED_FORMAT", "input", "千川上传仅支持 MP4。", "新制作时选择 MP4；不会自动转码。", false);
      const info = await lstat(artifact.path), resolved = await realpath(artifact.path), directory = await realpath(state.batch.outputDirectory);
      if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size !== artifact.sizeBytes || !isPathWithinDirectory(directory, resolved)) throw uploadFailure("ARTIFACT_CHANGED", "input", "成片路径、类型或大小与正式记录不一致。", "核查原文件。", false);
      const hash = (await fingerprintFile(resolved)).replace(/^sha256:/, "");
      const existing = this.store.tasks().find(value => intentKey(value.input) === intentKey(identity));
      if (existing) { if (existing.input.artifact_sha256 !== hash) throw uploadFailure("ARTIFACT_CHANGED", "input", "同一正式任务的视频字节已变化。", "核查原成片，不能重传替换文件。", false); return existing; }
      const input = { ...identity, video_path: resolved, artifact_sha256: hash, size_bytes: info.size }, target = intent.authorization.target;
      const id = uploadTaskId(input, target), snapshots = path.join(this.store.root, "snapshots"); await secureUploadDirectory(snapshots);
      const snapshotDirectory = path.join(snapshots, hash); await secureUploadDirectory(snapshotDirectory);
      const snapshotPath = path.join(snapshotDirectory, path.basename(resolved));
      try { await copyFile(resolved, snapshotPath, constants.COPYFILE_EXCL); await chmod(snapshotPath, 0o400); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const snapshot = await open(snapshotPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await snapshot.sync(); } finally { await snapshot.close(); }
      await strictSyncDirectory(snapshotDirectory); await strictSyncDirectory(snapshots);
      const record: UploadTaskRecord = { input, inputDigest: frozenInputDigest(input, intent.authorization), config: intent.config, authorization: intent.authorization, snapshotPath,
        result: { ...identity, upload_task_id: id, artifact_sha256: hash, file_name: path.basename(resolved), accountProduct: target.product, advertiserId: target.advertiserId, adId: target.adId, state: "PENDING", upload_outcome: "NOT_SELECTED", retryable: false, retry_count: 0, attempt_count: 0, timestamp: timestamp() } };
      await this.snapshotValid(record); await this.store.saveTask(record);
      if (!recovery && this.currentIntents.has(intentKey(identity)) && generation === this.controlGeneration && !this.stopping && !this.stopped && !this.paused) this.eligible.add(id);
      this.changed(); return record;
    });
    this.admission = work; return work;
  }
  async reconcile(): Promise<void> {
    for (const intent of this.store.intents()) {
      if (this.store.tasks().some(value => intentKey(value.input) === intentKey(intent))) continue;
      try { await this.enqueueFinalArtifact(UploadIdentitySchema.parse({ project_id: intent.project_id, batch_id: intent.batch_id, export_task_id: intent.export_task_id }), true); }
      catch (error) { if (!(error instanceof UploadError) || error.failure.code !== "EXPORT_NOT_COMMITTED") this.initializationFailure = "部分已授权任务无法恢复准入，请检查本机记录。"; }
    }
    this.changed();
  }
  runPending(): Promise<void> {
    if (this.runner) return this.runner;
    if (this.stopped || this.stopping || this.paused || !this.store.config.enabled || this.store.unavailable) return Promise.resolve();
    this.runner = (async () => {
      while (!this.stopped && !this.stopping && !this.paused && this.store.config.enabled && !this.store.unavailable) {
        const task = this.store.tasks().find(value => value.result.state === "PENDING" && this.eligible.has(value.result.upload_task_id)); if (!task) break;
        this.eligible.delete(task.result.upload_task_id); await this.execute(task.result.upload_task_id);
      }
    })().finally(() => { this.runner = undefined; if (this.eligible.size && !this.paused && !this.stopped && !this.stopping && !this.store.unavailable) void this.runPending().catch(() => this.changed()); });
    return this.runner;
  }
  resume(id: string): Promise<void> {
    const generation = this.controlGeneration;
    const work = this.control.catch(() => undefined).then(async () => {
      if (generation !== this.controlGeneration || this.stopping || this.store.unavailable || !this.store.config.enabled || this.active) return;
      const task = this.requireTask(id);
      if (task.result.duplicate_of || task.result.state === "FAILED_TERMINAL") return;
      if (this.store.tasks().some(other => other.result.upload_task_id !== id && other.authorization.target.advertiserId === task.authorization.target.advertiserId && other.result.state === "NEEDS_HUMAN" && !other.result.duplicate_of)) throw new Error("该账号存在未解决的任务，请先核查原页面。");
      this.stopped = false; this.paused = false;
      await this.execute(id); await this.runPending();
    }); this.control = work; return work;
  }
  async cancel(id: string): Promise<void> {
    const task = this.requireTask(id); this.eligible.delete(id);
    if (this.active?.id === id) {
      this.active.controller.abort();
      await this.bounded(() => this.active!.port.stop(), 5000, new AbortController().signal).catch(() => { this.paused = true; });
      await this.bounded(async () => { await this.runner; }, 15000, new AbortController().signal).catch(() => { this.paused = true; });
      return;
    }
    if (task.result.state === "WAITING_FOR_CONFIRMATION" || task.result.duplicate_of) return;
    task.result = { ...task.result, state: this.store.hasMarker(id) ? "NEEDS_HUMAN" : "CANCELLED", upload_outcome: this.store.hasMarker(id) ? "MAY_HAVE_UPLOADED" : "NOT_SELECTED", readyEvidence: undefined, retryable: false, failure: this.store.hasMarker(id) ? unknown().failure : uploadFailure("STOPPED", "cancel", "上传已停止。", "明确继续才会处理。", false).failure };
    await this.save(task);
  }
  async stop(): Promise<void> {
    this.controlGeneration++; this.stopping = true; this.stopped = true; this.eligible.clear(); this.currentIntents.clear(); this.active?.controller.abort();
    try {
      await Promise.all([...this.sessions.values()].map(port => this.bounded(() => port.stop(), 5000, new AbortController().signal).catch(() => { this.paused = true; })));
      this.sessions.clear(); await this.bounded(async () => { await this.runner; await this.admission.catch(() => undefined); }, 15000, new AbortController().signal).catch(() => { this.paused = true; });
    } finally { this.stopping = false; }
  }
  private requireTask(id: string): UploadTaskRecord { const task = this.store.task(id); if (!task) throw new Error("找不到千川上传任务。"); return task; }
  private async save(task: UploadTaskRecord): Promise<void> { await this.store.saveTask(task); this.changed(); if (task.config.captureFailureDiagnostics) await this.log(task).catch(() => undefined); }
  private async phase(task: UploadTaskRecord, state: QianchuanUploadResult["state"]): Promise<void> { task.result = { ...task.result, state, readyEvidence: undefined, failure: undefined, retryable: false, timestamp: timestamp() }; await this.save(task); }
  private selectedFiles(task: UploadTaskRecord): BatchSelectedFile[] {
    return this.store.tasks().filter(value => value.authorization.pageBatchId === task.authorization.pageBatchId && this.store.hasMarker(value.result.upload_task_id)).map(value => ({ fileName: value.result.file_name, index: this.store.fence(value.result.upload_task_id)!.selectedIndex })).sort((a, b) => a.index - b.index);
  }
  private async execute(id: string): Promise<void> {
    let task = this.requireTask(id);
    if (!this.store.hasMarker(id)) {
      const duplicate = this.store.tasks().find(other => other.result.upload_task_id !== id && sameTargetBytes(task, other) && this.store.hasMarker(other.result.upload_task_id));
      if (duplicate) {
        task.result = { ...task.result, duplicate_of: duplicate.result.upload_task_id, state: duplicate.result.state === "WAITING_FOR_CONFIRMATION" ? "WAITING_FOR_CONFIRMATION" : "NEEDS_HUMAN", upload_outcome: duplicate.result.state === "WAITING_FOR_CONFIRMATION" ? "READY" : "MAY_HAVE_UPLOADED", readyEvidence: duplicate.result.readyEvidence, failure: duplicate.result.readyEvidence ? undefined : unknown().failure };
        await this.save(task); if (!duplicate.result.readyEvidence) { this.paused = true; this.eligible.clear(); } return;
      }
    }
    const controller = new AbortController(), key = task.authorization.pageBatchId;
    const port = this.sessions.get(key) ?? this.dependencies.browser(); this.sessions.set(key, port); this.active = { id, controller, port };
    try {
      const t = task.config.timeouts;
      if (!this.store.hasMarker(id)) { task.result.attempt_count++; await this.phase(task, "CONNECTING_BROWSER"); }
      await this.bounded(signal => port.connect(task, signal), t.connect, controller.signal);
      let evidence: ReadyEvidence;
      if (this.store.hasMarker(id)) {
        const fence = this.store.fence(id)!;
        evidence = await this.bounded(signal => port.readOnlyCheck(task, fence.pageOwnership, this.selectedFiles(task), signal), t.confirmation, controller.signal);
      } else {
        await this.phase(task, "OPENING_UPLOAD_PAGE");
        const prepared = await this.bounded(signal => port.open(task, this.selectedFiles(task), signal), t.navigation, controller.signal);
        await this.snapshotValid(task); controller.signal.throwIfAborted();
        await this.store.markSelecting(id, prepared.pageOwnership, prepared.selectedIndex); task = this.requireTask(id); this.changed(); controller.signal.throwIfAborted();
        await this.bounded(signal => port.upload(task, signal), t.fileInput, controller.signal);
        await this.phase(task, "WAITING_UPLOAD_COMPLETE");
        evidence = await this.bounded(signal => port.ready(task, signal), t.processing, controller.signal);
      }
      await this.snapshotValid(task); controller.signal.throwIfAborted();
      task.result = { ...task.result, state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY", readyEvidence: ReadyEvidenceSchema.parse(evidence), failure: undefined, retryable: false, timestamp: timestamp() };
      await this.save(task);
    } catch (error) {
      const fenced = this.store.hasMarker(id), failure = fenced ? unknown().failure : controller.signal.aborted ? uploadFailure("STOPPED", "cancel", "上传已停止。", "确认后明确继续。", false).failure : error instanceof UploadError ? error.failure : uploadFailure("PAGE_CONTRACT_CHANGED", "page", "页面操作无法确认，自动操作已停止。", "检查页面结构与任务归属。", true).failure;
      task = this.requireTask(id);
      task.result = { ...task.result, state: fenced || failure.requires_human ? "NEEDS_HUMAN" : controller.signal.aborted ? "CANCELLED" : failure.retryable ? "FAILED_RETRYABLE" : "FAILED_TERMINAL", upload_outcome: fenced ? "MAY_HAVE_UPLOADED" : "NOT_SELECTED", readyEvidence: undefined, failure, retryable: !fenced && failure.retryable, timestamp: timestamp() };
      this.paused = true; this.eligible.clear();
      if (!this.store.unavailable) await this.save(task); else { this.initializationFailure = "上传存储失败；保留屏障，上传结果按未知处理。"; this.changed(); }
      await this.bounded(() => port.stop(), 5000, new AbortController().signal).catch(() => undefined); this.sessions.delete(key);
    } finally { if (this.active?.port === port) this.active = undefined; }
  }
  private async snapshotValid(task: UploadTaskRecord): Promise<void> {
    const info = await lstat(task.snapshotPath);
    if (!isPathWithinDirectory(path.join(this.store.root, "snapshots"), task.snapshotPath) || !info.isFile() || info.isSymbolicLink() || info.mode & 0o7377 || info.size !== task.input.size_bytes || (await fingerprintFile(task.snapshotPath)).replace(/^sha256:/, "") !== task.input.artifact_sha256) throw uploadFailure("ARTIFACT_CHANGED", "input", "上传快照已变化，禁止上传。", "核查私有快照。", false);
  }
  private async bounded<T>(operation: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent: AbortSignal): Promise<T> {
    const controller = new AbortController(), aborted = () => controller.abort(); parent.addEventListener("abort", aborted, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined, listener: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      listener = () => reject(uploadFailure(parent.aborted ? "STOPPED" : "TIMEOUT", parent.aborted ? "cancel" : "browser", "操作已停止或阶段超时。", "人工检查后明确继续。", false));
      controller.signal.addEventListener("abort", listener, { once: true }); timer = setTimeout(aborted, milliseconds);
      if (parent.aborted) aborted();
    });
    try { controller.signal.throwIfAborted(); const result = await Promise.race([operation(controller.signal), timeout]); controller.signal.throwIfAborted(); return result; }
    finally { if (timer) clearTimeout(timer); parent.removeEventListener("abort", aborted); if (listener) controller.signal.removeEventListener("abort", listener); }
  }
  private async log(task: UploadTaskRecord): Promise<void> {
    const directory = path.join(this.store.root, "logs"); await secureUploadDirectory(directory); let total = 0;
    for (const name of await readdir(directory)) { const file = path.join(directory, name), info = await stat(file); if (Date.now() - info.mtimeMs > 7 * 86400000) await unlink(file); else total += info.size; }
    const line = JSON.stringify({ task: task.result.upload_task_id, state: task.result.state, outcome: task.result.upload_outcome, reason: task.result.failure?.code, timestamp: task.result.timestamp });
    if (total + Buffer.byteLength(line) < 100 * 1024 * 1024) await appendFile(path.join(directory, `${timestamp().slice(0, 10)}.jsonl`), `${line}\n`, { mode: 0o600 });
  }
}
