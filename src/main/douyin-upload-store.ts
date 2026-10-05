import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicWriteJson } from "./store.js";
import { ClosedUploadBatchSchema, type ClosedUploadBatch } from "../shared/douyin-upload.js";
import { LegacyMarkerSchema, validateLegacy } from "./douyin-upload-legacy.js";
import { FinalArtifactInputSchema, UploadIdentitySchema, UploadIdSchema, QianchuanUploadConfigSchema, QianchuanUploadSelectionSchema, QianchuanUploadResultSchema, UploadAuthorizationSchema, PageOwnershipSchema, uploadFailure, type UploadIdentity, type QianchuanUploadConfig, type PageOwnership, type UploadAuthorization } from "../shared/douyin-upload.js";

export const UploadIntentSchema = UploadIdentitySchema.extend({ selection: QianchuanUploadSelectionSchema, config: QianchuanUploadConfigSchema, authorization: UploadAuthorizationSchema }).strict();
export type UploadIntent = z.infer<typeof UploadIntentSchema>;
export const UploadInputSchema = FinalArtifactInputSchema.omit({ caption: true, metadata: true });
const TaskSchema = z.object({ input: UploadInputSchema, inputDigest: UploadIdSchema, config: QianchuanUploadConfigSchema, authorization: UploadAuthorizationSchema, snapshotPath: z.string().min(1), result: QianchuanUploadResultSchema }).strict();
export type UploadTaskRecord = z.infer<typeof TaskSchema>;
const V2StateSchema = z.object({ version: z.literal(2), config: QianchuanUploadConfigSchema, intents: z.array(UploadIntentSchema), tasks: z.array(TaskSchema), legacy: z.boolean() }).strict();
const StateSchema = V2StateSchema.extend({ version: z.literal(3), closedBatches: z.array(ClosedUploadBatchSchema) }).strict();
const FenceSchema = z.object({ version: z.literal(2), upload_task_id: UploadIdSchema, artifact_sha256: UploadIdSchema, input_digest: UploadIdSchema,
  advertiserId: z.string(), adId: z.string(), pageOwnership: PageOwnershipSchema, selectedIndex: z.number().int().min(1).max(250), attempt: z.number().int().min(1), timestamp: z.string().datetime() }).strict();
type Fence = z.infer<typeof FenceSchema>;
type State = z.infer<typeof StateSchema>;
type UploadInput = z.infer<typeof UploadInputSchema>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function uploadTaskId(input: UploadInput, target: UploadIntent["authorization"]["target"]): string {
  return digest({ schema: "jianji-qianchuan-upload/2", project_id: input.project_id, batch_id: input.batch_id, export_task_id: input.export_task_id, artifact_sha256: input.artifact_sha256, advertiserId: target.advertiserId, adId: target.adId });
}
export function frozenInputDigest(input: UploadInput, authorization: UploadIntent["authorization"]): string { return digest({ input, authorization }); }
export function intentKey(identity: UploadIdentity): string { return JSON.stringify([identity.project_id, identity.batch_id, identity.export_task_id]); }
export function sameTargetBytes(left: UploadTaskRecord, right: UploadTaskRecord): boolean {
  return left.input.artifact_sha256 === right.input.artifact_sha256 && left.authorization.target.advertiserId === right.authorization.target.advertiserId && left.authorization.target.adId === right.authorization.target.adId;
}
export async function strictSyncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") throw new Error("Windows upload durability is not qualified");
  const handle = await open(directory, "r"); try { await handle.sync(); } finally { await handle.close(); }
}
export async function secureUploadDirectory(directory: string): Promise<void> {
  if (process.platform === "win32" || !process.getuid) throw new Error("Upload permissions not qualified");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o7077 || info.uid !== process.getuid() || await realpath(directory) !== path.resolve(directory)) throw new Error("Upload directory must be private");
}
async function privateBytes(file: string, sync = false): Promise<Buffer> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o7177 || info.uid !== process.getuid?.()) throw new Error("Upload record must be private");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== info.dev || before.ino !== info.ino || before.mode !== info.mode || before.uid !== info.uid || before.size !== info.size) throw new Error("Upload record changed");
    const bytes = await handle.readFile(), after = await handle.stat(), current = await lstat(file);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.mode !== before.mode || current.dev !== after.dev || current.ino !== after.ino || current.isSymbolicLink() || bytes.length !== before.size) throw new Error("Upload record changed");
    if (sync) await handle.sync();
    return bytes;
  } finally { await handle.close(); }
}
const empty = (): State => ({ version: 3, config: QianchuanUploadConfigSchema.parse({}), intents: [], tasks: [], legacy: false, closedBatches: [] });
const closureBytes = (data: State, batchId: string) => Buffer.from(`${JSON.stringify({ version: 1, action: "close-batch", intents: data.intents.filter(intent => intent.authorization.pageBatchId === batchId), tasks: data.tasks.filter(task => task.authorization.pageBatchId === batchId) }, null, 2)}\n`);

/** One ledger: new selection fences never grant creator publication permission. */
export class DouyinUploadStore {
  private data: State = empty();
  private fences = new Map<string, Fence>();
  private legacyResults: import("../shared/douyin-upload.js").UploadResult[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private loaded = false;
  private blocked = false;
  constructor(readonly root: string, private readonly durability: { syncDirectory?: (directory: string) => Promise<void> } = {}) {}
  private get statePath(): string { return path.join(this.root, "state.json"); }
  private get fenceDirectory(): string { return path.join(this.root, "selection-fences"); }
  private get retargetHistoryDirectory(): string { return path.join(this.root, "retarget-history"); }
  private get discardHistoryDirectory(): string { return path.join(this.root, "discard-history"); }
  private get closureHistoryDirectory(): string { return path.join(this.root, "batch-closure-history"); }
  private get legacyPath(): string { return path.join(this.root, "legacy-v1.json"); }
  get config(): QianchuanUploadConfig { return structuredClone(this.data.config); }
  intents(): UploadIntent[] { return structuredClone(this.data.intents); }
  tasks(): UploadTaskRecord[] { return structuredClone(this.data.tasks); }
  closedBatches(): ClosedUploadBatch[] { return structuredClone(this.data.closedBatches); }
  isClosed(batchId: string): boolean { return this.data.closedBatches.some(batch => batch.pageBatchId === batchId); }
  legacyTasks(): import("../shared/douyin-upload.js").UploadResult[] { return structuredClone(this.legacyResults); }
  task(id: string): UploadTaskRecord | undefined { const value = this.data.tasks.find(task => task.result.upload_task_id === id); return value && structuredClone(value); }
  hasMarker(id: string): boolean { return this.fences.has(id); }
  fence(id: string): Readonly<Fence> | undefined { const value = this.fences.get(id); return value && structuredClone(value); }
  get unavailable(): boolean { return this.blocked; }
  private async oldMarkers(): Promise<Map<string, z.infer<typeof LegacyMarkerSchema>>> {
    const directory = path.join(this.root, "markers"), markers = new Map<string, z.infer<typeof LegacyMarkerSchema>>();
    await secureUploadDirectory(directory);
    for (const name of await readdir(directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error("Unknown legacy marker");
      const marker = LegacyMarkerSchema.parse(JSON.parse((await privateBytes(path.join(directory, name))).toString("utf8")));
      if (name !== `${marker.upload_task_id}.json`) throw new Error("Legacy marker identity mismatch");
      markers.set(marker.upload_task_id, marker);
    }
    return markers;
  }
  async load(): Promise<void> {
    try {
      await secureUploadDirectory(this.root); await secureUploadDirectory(this.fenceDirectory);
      const oldMarkers = await this.oldMarkers();
      let original: Buffer | undefined;
      try { original = await privateBytes(this.statePath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      let data: State; const names = await readdir(this.root);
      if (!original) {
        if (oldMarkers.size || names.includes("legacy-v1.json") || names.includes("retarget-history") || names.includes("discard-history") || names.includes("batch-closure-history") || names.some(name => name.startsWith("state.json")) || (await readdir(this.fenceDirectory)).length) throw new Error("Missing ledger with history");
        data = empty();
      } else {
        const value = JSON.parse(original.toString("utf8"));
        if (value.version === 1) {
          if ((await readdir(this.fenceDirectory)).length) throw new Error("V1 ledger with v2 fences");
          const legacy = validateLegacy(value, oldMarkers); let handle;
          try { handle = await open(this.legacyPath, "wx", 0o600); await handle.writeFile(original); await handle.sync(); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await privateBytes(this.legacyPath)).equals(original)) throw error; }
          finally { await handle?.close(); }
          const retained = await open(this.legacyPath, "r"); try { await retained.sync(); } finally { await retained.close(); }
          await strictSyncDirectory(this.root);
          data = { ...empty(), legacy: true };
          await atomicWriteJson(this.statePath, data); await strictSyncDirectory(this.root);
          this.legacyResults = legacy.tasks.map(task => task.result);
        } else {
          data = value.version === 2 ? { ...V2StateSchema.parse(value), version: 3, closedBatches: [] } : StateSchema.parse(value);
          if (data.legacy) this.legacyResults = validateLegacy(JSON.parse((await privateBytes(this.legacyPath)).toString("utf8")), oldMarkers).tasks.map(task => task.result);
          else if (oldMarkers.size || names.includes("legacy-v1.json")) throw new Error("Unbound legacy history");
        }
      }
      const fences = new Map<string, Fence>();
      for (const name of await readdir(this.fenceDirectory)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error("Unknown selection fence");
        const fence = FenceSchema.parse(JSON.parse((await privateBytes(path.join(this.fenceDirectory, name))).toString("utf8")));
        if (name !== `${fence.upload_task_id}.json`) throw new Error("Selection fence identity mismatch");
        fences.set(fence.upload_task_id, fence);
      }
      this.validate(data, fences);
      await this.validateClosureArchives(data);
      if (original && JSON.parse(original.toString("utf8")).version === 2) { await atomicWriteJson(this.statePath, data); await strictSyncDirectory(this.root); }
      for (const task of data.tasks) {
        if (task.result.state === "DISCARDED" || data.closedBatches.some(batch => batch.pageBatchId === task.authorization.pageBatchId)) continue;
        const fence = fences.get(task.result.upload_task_id);
        if (fence && task.result.state === "NEEDS_HUMAN" && task.result.upload_outcome === "MAY_HAVE_UPLOADED" && !task.result.retryable) continue;
        if (fence && task.result.state !== "WAITING_FOR_CONFIRMATION") task.result = { ...task.result, state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", retryable: false, readyEvidence: undefined,
          failure: uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "存在文件选择记录，上传结果需要人工核查。", "只读核查原任务页面；禁止重新选文件。", true).failure };
        else if (!fence && !task.result.duplicate_of && !["PENDING", "FAILED_TERMINAL", "CANCELLED", "NEEDS_HUMAN", "FAILED_RETRYABLE"].includes(task.result.state)) {
          task.result.state = "CANCELLED"; task.result.retryable = false;
          task.result.failure = uploadFailure("STOPPED", "cancel", "上次上传已中断。", "检查浏览器后明确继续。", false).failure;
        }
      }
      this.data = data; this.fences = fences; this.loaded = true;
    } catch { this.blocked = true; throw uploadFailure("STORE_UNAVAILABLE", "store", "上传记录损坏、版本未知或权限不安全，已停用上传。", "保留全部旧标记及文件选择屏障；检查本机存储。", true); }
  }
  private validate(data: State, fences: Map<string, Fence>): void {
    const closedIds = new Set<string>();
    for (const closed of data.closedBatches) {
      const tasks = data.tasks.filter(task => task.authorization.pageBatchId === closed.pageBatchId), first = tasks[0];
      if (closedIds.has(closed.pageBatchId) || !first || !this.canClose(data, closed.pageBatchId) || first.input.project_id !== closed.projectId ||
        first.authorization.target.advertiserId !== closed.advertiserId || first.authorization.target.adId !== closed.adId || first.authorization.expectedCount !== closed.expectedCount ||
        JSON.stringify(tasks.map(task => task.result.upload_task_id).sort()) !== JSON.stringify(closed.taskIds) || createHash("sha256").update(closureBytes(data, closed.pageBatchId)).digest("hex") !== closed.archiveSha256) throw new Error("Closed batch binding mismatch");
      closedIds.add(closed.pageBatchId);
    }
    const ids = new Set<string>(), identities = new Set<string>(), intents = new Map<string, UploadIntent>();
    const batches = new Map<string, { projectId: string; authorization: string; count: number }>();
    for (const intent of data.intents) {
      const key = intentKey(intent);
      if (intents.has(key) || intent.selection.accountProduct !== intent.authorization.target.product) throw new Error("Intent binding mismatch");
      const authorization = JSON.stringify(intent.authorization), batch = batches.get(intent.authorization.pageBatchId);
      if (batch && (batch.projectId !== intent.project_id || batch.authorization !== authorization)) throw new Error("Batch target mismatch");
      const count = (batch?.count ?? 0) + 1;
      if (count > intent.authorization.expectedCount) throw new Error("Batch count mismatch");
      batches.set(intent.authorization.pageBatchId, { projectId: intent.project_id, authorization, count });
      intents.set(key, intent);
    }
    const groups = new Map<string, Fence[]>(), fenceCounts = new Map<string, number>(), tasksById = new Map<string, UploadTaskRecord>();
    for (const fence of fences.values()) fenceCounts.set(fence.pageOwnership.pageBatchId, (fenceCounts.get(fence.pageOwnership.pageBatchId) ?? 0) + 1);
    for (const task of data.tasks) {
      const id = task.result.upload_task_id, target = task.authorization.target, intent = intents.get(intentKey(task.input)), fence = fences.get(id);
      if (ids.has(id) || identities.has(intentKey(task.input)) || id !== uploadTaskId(task.input, target) || task.inputDigest !== frozenInputDigest(task.input, task.authorization) || intentKey(task.result) !== intentKey(task.input) || task.result.artifact_sha256 !== task.input.artifact_sha256 || task.result.accountProduct !== target.product || task.result.advertiserId !== target.advertiserId || task.result.adId !== target.adId || !intent || JSON.stringify(intent.authorization) !== JSON.stringify(task.authorization) || JSON.stringify(intent.config) !== JSON.stringify(task.config)) throw new Error("Task binding mismatch");
      ids.add(id); identities.add(intentKey(task.input)); tasksById.set(id, task);
      if (task.result.file_name !== path.basename(task.input.video_path)) throw new Error("Task filename mismatch");
      if (fence && (fence.input_digest !== task.inputDigest || fence.artifact_sha256 !== task.input.artifact_sha256 || fence.advertiserId !== target.advertiserId || fence.adId !== target.adId || fence.pageOwnership.pageBatchId !== task.authorization.pageBatchId || fence.attempt !== task.result.attempt_count)) throw new Error("Fence binding mismatch");
      if (fence) {
        if (fence.selectedIndex > task.authorization.expectedCount) throw new Error("Fence exceeds batch count");
        const group = groups.get(task.authorization.pageBatchId) ?? []; group.push(fence); groups.set(task.authorization.pageBatchId, group);
      }
      if (task.result.upload_outcome !== "NOT_SELECTED" && !fence && !task.result.duplicate_of) throw new Error("Missing selection fence");
      if (task.result.readyEvidence && fence && (JSON.stringify(task.result.readyEvidence.pageOwnership) !== JSON.stringify(fence.pageOwnership) || task.result.readyEvidence.selectedCount < fence.selectedIndex || task.result.readyEvidence.selectedCount > fenceCounts.get(fence.pageOwnership.pageBatchId)!)) throw new Error("Ready ownership mismatch");
    }
    for (const group of groups.values()) {
      group.sort((left, right) => left.selectedIndex - right.selectedIndex);
      if (group.some((fence, index) => fence.selectedIndex !== index + 1 || JSON.stringify(fence.pageOwnership) !== JSON.stringify(group[0].pageOwnership))) throw new Error("Batch page ownership mismatch");
    }
    for (const id of fences.keys()) if (!ids.has(id)) throw new Error("Orphan selection fence");
    for (const task of data.tasks) if (task.result.duplicate_of) {
      const original = tasksById.get(task.result.duplicate_of);
      if (!original || original.result.duplicate_of || !sameTargetBytes(task, original) || !fences.has(original.result.upload_task_id) || task.result.readyEvidence && JSON.stringify(task.result.readyEvidence) !== JSON.stringify(original.result.readyEvidence)) throw new Error("Invalid duplicate evidence");
    }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> { const next = this.chain.catch(() => undefined).then(work); this.chain = next; return next; }
  private assertReady(): void { if (!this.loaded || this.blocked) throw uploadFailure("STORE_UNAVAILABLE", "store", "上传存储不可用。", "检查本机记录和权限。", true); }
  private assertOpen(batchId: string): void { if (this.isClosed(batchId)) throw new Error("本批本地上传已结束，不能修改或恢复。"); }
  canCloseBatch(batchId: string): boolean { return !this.unavailable && !this.isClosed(batchId) && this.canClose(this.data, batchId); }
  private canClose(data: State, batchId: string): boolean {
    const tasks = data.tasks.filter(task => task.authorization.pageBatchId === batchId), first = tasks[0];
    const intents = data.intents.filter(intent => intent.authorization.pageBatchId === batchId);
    return Boolean(first && tasks.length === first.authorization.expectedCount && intents.length === tasks.length &&
      tasks.every(task => task.input.project_id === first.input.project_id && JSON.stringify(task.authorization) === JSON.stringify(first.authorization) && !task.result.duplicate_of &&
        ["PENDING", "WAITING_FOR_CONFIRMATION", "NEEDS_HUMAN", "FAILED_RETRYABLE", "FAILED_TERMINAL", "CANCELLED"].includes(task.result.state)) &&
      intents.every(intent => intent.project_id === first.input.project_id && JSON.stringify(intent.authorization) === JSON.stringify(first.authorization) && tasks.some(task => intentKey(task.input) === intentKey(intent))));
  }
  private async validateClosureArchives(data: State): Promise<void> {
    if (!data.closedBatches.length) return;
    await secureUploadDirectory(this.closureHistoryDirectory);
    for (const batch of data.closedBatches) {
      const bytes = await privateBytes(path.join(this.closureHistoryDirectory, `${batch.pageBatchId}.json`));
      if (!bytes.equals(closureBytes(data, batch.pageBatchId))) throw new Error("Closed batch archive mismatch");
    }
  }
  private async commit(data: State): Promise<void> {
    this.assertReady();
    try { const parsed = StateSchema.parse(data); this.validate(parsed, this.fences); await this.validateClosureArchives(parsed); await atomicWriteJson(this.statePath, parsed); await strictSyncDirectory(this.root); this.data = parsed; }
    catch { this.blocked = true; throw uploadFailure("STORE_UNAVAILABLE", "store", "上传记录无法可靠保存，已停止操作。", "保留全部文件选择屏障并检查磁盘。", true); }
  }
  setConfig(config: QianchuanUploadConfig): Promise<void> { return this.serial(() => this.commit({ ...this.data, config: QianchuanUploadConfigSchema.parse(config) })); }
  saveIntents(intents: UploadIntent[]): Promise<void> {
    return this.serial(async () => {
      this.assertReady(); const next = structuredClone(this.data);
      for (const input of intents) {
        const intent = UploadIntentSchema.parse(input), existing = next.intents.find(value => intentKey(value) === intentKey(intent));
        this.assertOpen(intent.authorization.pageBatchId);
        if (existing && JSON.stringify(existing) !== JSON.stringify(intent)) throw uploadFailure("INPUT_CONFLICT", "input", "本次上传目标已冻结。", "保留原任务目标。", false);
        if (!existing) next.intents.push(intent);
      }
      await this.commit(next);
    });
  }
  saveTask(task: UploadTaskRecord): Promise<void> {
    return this.serial(async () => {
      this.assertReady(); const id = task.result.upload_task_id, old = this.data.tasks.find(value => value.result.upload_task_id === id);
      this.assertOpen(task.authorization.pageBatchId); if (old) this.assertOpen(old.authorization.pageBatchId);
      if (old && (old.inputDigest !== task.inputDigest || JSON.stringify(old.authorization) !== JSON.stringify(task.authorization) || JSON.stringify(old.config) !== JSON.stringify(task.config))) throw new Error("Frozen task changed");
      if (task.result.state === "DISCARDED" && old?.result.state !== "DISCARDED" || old?.result.state === "DISCARDED" && JSON.stringify(old) !== JSON.stringify(task)) throw new Error("Discarded tasks can only be set by whole-batch deletion and cannot be restored");
      if (this.hasMarker(id) && (task.result.upload_outcome === "NOT_SELECTED" || old?.result.attempt_count !== task.result.attempt_count)) throw new Error("Selection fence cannot be reversed");
      const tasks = this.data.tasks.filter(value => value.result.upload_task_id !== id).map(value => {
        if (value.result.duplicate_of !== id || value.result.state === "DISCARDED" || this.isClosed(value.authorization.pageBatchId)) return value;
        return { ...value, result: { ...value.result, state: task.result.readyEvidence ? "WAITING_FOR_CONFIRMATION" as const : "NEEDS_HUMAN" as const, upload_outcome: task.result.readyEvidence ? "READY" as const : "MAY_HAVE_UPLOADED" as const, readyEvidence: task.result.readyEvidence, failure: task.result.readyEvidence ? undefined : task.result.failure, retryable: false, timestamp: task.result.timestamp } };
      });
      await this.commit({ ...this.data, tasks: [...tasks, task] });
    });
  }
  retargetBatch(id: string, authorization: UploadAuthorization, beforeCommit?: () => Promise<void>): Promise<UploadTaskRecord[]> {
    return this.serial(async () => {
      this.assertReady();
      const nextAuthorization = UploadAuthorizationSchema.parse(authorization), selected = this.data.tasks.find(task => task.result.upload_task_id === id);
      if (!selected) throw uploadFailure("INPUT_CONFLICT", "account", "找不到待改传任务。", "刷新上传记录后重新选择整批任务。", true);
      this.assertOpen(selected.authorization.pageBatchId);
      const oldAuthorization = selected.authorization, oldBatchId = oldAuthorization.pageBatchId;
      const batchTasks = this.data.tasks.filter(task => task.authorization.pageBatchId === oldBatchId);
      const batchIntents = this.data.intents.filter(intent => intent.authorization.pageBatchId === oldBatchId);
      const identities = new Set(batchTasks.map(task => intentKey(task.input)));
      const rejected = () => uploadFailure("INPUT_CONFLICT", "account", "本批任务不满足改传当前计划的条件。", "仅可整批改传同账号、同产品、同 CDP 的未选文件任务；含围栏、别名或目标冲突时需人工核查。", true);

      if (nextAuthorization.expectedCount !== oldAuthorization.expectedCount || nextAuthorization.pageBatchId === oldBatchId ||
        nextAuthorization.target.product !== oldAuthorization.target.product || nextAuthorization.target.advertiserId !== oldAuthorization.target.advertiserId ||
        nextAuthorization.target.cdpEndpoint !== oldAuthorization.target.cdpEndpoint || nextAuthorization.target.adId === oldAuthorization.target.adId ||
        this.data.tasks.some(task => task.authorization.pageBatchId === nextAuthorization.pageBatchId) ||
        this.data.intents.some(intent => intent.authorization.pageBatchId === nextAuthorization.pageBatchId) ||
        batchTasks.length !== oldAuthorization.expectedCount || batchIntents.length !== oldAuthorization.expectedCount ||
        identities.size !== batchTasks.length || batchTasks.some(task => JSON.stringify(task.authorization) !== JSON.stringify(oldAuthorization) ||
          task.result.upload_outcome !== "NOT_SELECTED" || !["PENDING", "FAILED_RETRYABLE", "NEEDS_HUMAN"].includes(task.result.state) || task.result.duplicate_of ||
          this.hasMarker(task.result.upload_task_id)) ||
        batchIntents.some(intent => JSON.stringify(intent.authorization) !== JSON.stringify(oldAuthorization) || !identities.has(intentKey(intent))) ||
        [...this.fences.values()].some(fence => fence.pageOwnership.pageBatchId === oldBatchId || batchTasks.some(task => task.result.upload_task_id === fence.upload_task_id || sameTargetBytes(task, this.data.tasks.find(other => other.result.upload_task_id === fence.upload_task_id)!))) ||
        this.data.tasks.some(task => task.result.duplicate_of && (identities.has(intentKey(task.result)) || batchTasks.some(candidate => task.result.duplicate_of === candidate.result.upload_task_id)))) throw rejected();

      const movedById = new Map<string, UploadTaskRecord>(), newIds = new Set<string>(), newTargetBytes = new Set<string>();
      for (const task of batchTasks) {
        const nextId = uploadTaskId(task.input, nextAuthorization.target);
        const targetBytes = JSON.stringify([task.input.artifact_sha256, nextAuthorization.target.advertiserId, nextAuthorization.target.adId]);
        const moved: UploadTaskRecord = {
          ...task, inputDigest: frozenInputDigest(task.input, nextAuthorization), authorization: nextAuthorization,
          result: { ...task.result, upload_task_id: nextId, accountProduct: nextAuthorization.target.product,
            advertiserId: nextAuthorization.target.advertiserId, adId: nextAuthorization.target.adId, state: "PENDING",
            upload_outcome: "NOT_SELECTED", retryable: false, failure: undefined, readyEvidence: undefined, timestamp: new Date().toISOString() },
        };
        if (newIds.has(nextId) || newTargetBytes.has(targetBytes) || this.data.tasks.some(other => !identities.has(intentKey(other.input)) &&
          (other.result.upload_task_id === nextId || sameTargetBytes(moved, other)))) throw rejected();
        newIds.add(nextId);
        newTargetBytes.add(targetBytes);
        movedById.set(task.result.upload_task_id, moved);
      }
      const movedIntents = batchIntents.map(intent => ({ ...intent, authorization: nextAuthorization, selection: intent.selection.plan ? {
        ...intent.selection, plan: { advertiserId: nextAuthorization.target.advertiserId, adId: nextAuthorization.target.adId, name: `计划 ${nextAuthorization.target.adId}` },
      } : intent.selection }));
      const archive = { version: 1 as const, intents: batchIntents, tasks: batchTasks, newAuthorization: nextAuthorization };
      const archivePath = path.join(this.retargetHistoryDirectory, `${oldBatchId}.json`), archiveBytes = Buffer.from(`${JSON.stringify(archive, null, 2)}\n`);
      try {
        await secureUploadDirectory(this.retargetHistoryDirectory);
        await strictSyncDirectory(this.root);
        let handle;
        try {
          handle = await open(archivePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          await handle.writeFile(archiveBytes); await handle.sync();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await privateBytes(archivePath, true)).equals(archiveBytes)) throw error;
        } finally { await handle?.close(); }
        await (this.durability.syncDirectory ?? strictSyncDirectory)(this.retargetHistoryDirectory);
      } catch {
        this.blocked = true;
        throw uploadFailure("STORE_UNAVAILABLE", "store", "整批改传历史无法可靠保存，上传记录已停用。", "保留原上传记录和全部文件选择屏障；检查本机存储。", true);
      }
      await beforeCommit?.();
      const next: State = {
        ...this.data,
        intents: this.data.intents.map(intent => movedIntents.find(value => intentKey(value) === intentKey(intent)) ?? intent),
        tasks: this.data.tasks.map(task => movedById.get(task.result.upload_task_id) ?? task),
      };
      await this.commit(next);
      return batchTasks.map(task => structuredClone(movedById.get(task.result.upload_task_id)!));
    });
  }
  discardBatch(id: string, beforeCommit?: () => Promise<void>): Promise<void> {
    return this.serial(async () => {
      this.assertReady();
      const selected = this.task(id);
      if (!selected) throw new Error("找不到待删除的上传任务。");
      this.assertOpen(selected.authorization.pageBatchId);
      const batchId = selected.authorization.pageBatchId;
      const tasks = this.data.tasks.filter(task => task.authorization.pageBatchId === batchId);
      const intents = this.data.intents.filter(intent => intent.authorization.pageBatchId === batchId);
      if (tasks.length !== selected.authorization.expectedCount || intents.length !== tasks.length ||
        tasks.some(task => !["PENDING", "NEEDS_HUMAN", "FAILED_RETRYABLE", "FAILED_TERMINAL", "CANCELLED"].includes(task.result.state))) throw new Error("仅可删除完整准入且未在运行、未上传完成的整批任务。");
      const archiveBytes = Buffer.from(`${JSON.stringify({ version: 1, action: "discard-batch", intents, tasks }, null, 2)}\n`);
      const archivePath = path.join(this.discardHistoryDirectory, `${batchId}.json`);
      try {
        await secureUploadDirectory(this.discardHistoryDirectory); await strictSyncDirectory(this.root);
        let handle;
        try {
          handle = await open(archivePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          await handle.writeFile(archiveBytes); await handle.sync();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await privateBytes(archivePath, true)).equals(archiveBytes)) throw error;
        } finally { await handle?.close(); }
        await (this.durability.syncDirectory ?? strictSyncDirectory)(this.discardHistoryDirectory);
      } catch {
        this.blocked = true;
        throw uploadFailure("STORE_UNAVAILABLE", "store", "删除历史无法可靠保存，上传记录已停用。", "保留上传账本和全部防重传记录；检查磁盘。", true);
      }
      await beforeCommit?.();
      await this.commit({ ...this.data, tasks: this.data.tasks.map(task => task.authorization.pageBatchId === batchId ? { ...task, result: { ...task.result, state: "DISCARDED" as const, retryable: false } } : task) });
    });
  }
  markSelecting(id: string, pageOwnership: PageOwnership, selectedIndex: number): Promise<void> {
    return this.serial(async () => {
      this.assertReady(); const task = this.task(id);
      if (task) this.assertOpen(task.authorization.pageBatchId);
      if (!task || task.result.state === "DISCARDED" || task.result.upload_outcome !== "NOT_SELECTED" || task.result.duplicate_of || this.hasMarker(id) || this.data.tasks.some(other => other.result.upload_task_id !== id && sameTargetBytes(task, other) && (this.hasMarker(other.result.upload_task_id) || this.isClosed(other.authorization.pageBatchId)))) throw new Error("File selection permission unavailable");
      const fence = FenceSchema.parse({ version: 2, upload_task_id: id, artifact_sha256: task.input.artifact_sha256, input_digest: task.inputDigest,
        advertiserId: task.authorization.target.advertiserId, adId: task.authorization.target.adId, pageOwnership, selectedIndex, attempt: task.result.attempt_count, timestamp: new Date().toISOString() });
      if (pageOwnership.pageBatchId !== task.authorization.pageBatchId || selectedIndex > task.authorization.expectedCount) throw new Error("Batch selection binding mismatch");
      const previous = [...this.fences.values()].filter(value => value.pageOwnership.pageBatchId === pageOwnership.pageBatchId);
      if (selectedIndex !== previous.length + 1 || previous.some(value => JSON.stringify(value.pageOwnership) !== JSON.stringify(pageOwnership))) throw new Error("Batch page ownership mismatch");
      let handle;
      try {
        await strictSyncDirectory(path.dirname(this.root)); await strictSyncDirectory(this.root);
        handle = await open(path.join(this.fenceDirectory, `${id}.json`), "wx", 0o600); this.fences.set(id, fence);
        await handle.writeFile(`${JSON.stringify(fence)}\n`); await handle.sync(); await handle.close(); handle = undefined;
        await (this.durability.syncDirectory ?? strictSyncDirectory)(this.fenceDirectory);
        task.result = { ...task.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED", retryable: false, failure: undefined, timestamp: fence.timestamp };
        await this.commit({ ...this.data, tasks: this.data.tasks.map(value => value.result.upload_task_id === id ? task : value) });
      } catch { this.blocked = true; throw uploadFailure("STORE_UNAVAILABLE", "store", "文件选择屏障保存或同步失败，禁止选文件。", "保留屏障并人工检查存储。", true); }
      finally { await handle?.close().catch(() => undefined); }
    });
  }

  closeBatch(id: string, beforeCommit?: () => Promise<void>): Promise<void> {
    return this.serial(async () => {
      this.assertReady(); const task = this.task(id);
      if (!task) throw new Error("找不到待结束的上传任务。");
      const pageBatchId = task.authorization.pageBatchId; this.assertOpen(pageBatchId);
      if (!this.canCloseBatch(pageBatchId)) throw new Error("仅可结束完整准入、无别名且未在运行的整批本地上传。");
      const bytes = closureBytes(this.data, pageBatchId), file = path.join(this.closureHistoryDirectory, `${pageBatchId}.json`);
      try {
        await secureUploadDirectory(this.closureHistoryDirectory); await strictSyncDirectory(this.root);
        let handle;
        try { handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); await handle.writeFile(bytes); await handle.sync(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await privateBytes(file, true)).equals(bytes)) throw error; }
        finally { await handle?.close(); }
        await (this.durability.syncDirectory ?? strictSyncDirectory)(this.closureHistoryDirectory);
      } catch {
        this.blocked = true; throw uploadFailure("STORE_UNAVAILABLE", "store", "批次结束历史无法可靠保存，上传记录已停用。", "保留全部历史及文件选择屏障；检查本机存储。", true);
      }
      await beforeCommit?.();
      const closure = ClosedUploadBatchSchema.parse({ projectId: task.input.project_id, pageBatchId, advertiserId: task.authorization.target.advertiserId, adId: task.authorization.target.adId,
        expectedCount: task.authorization.expectedCount, taskIds: this.data.tasks.filter(value => value.authorization.pageBatchId === pageBatchId).map(value => value.result.upload_task_id).sort(), archiveSha256: createHash("sha256").update(bytes).digest("hex"), closedAt: new Date().toISOString() });
      await this.commit({ ...this.data, closedBatches: [...this.data.closedBatches, closure] });
    });
  }
}
