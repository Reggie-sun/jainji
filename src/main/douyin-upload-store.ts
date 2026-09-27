import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicWriteJson } from "./store.js";
import { LegacyMarkerSchema, validateLegacy } from "./douyin-upload-legacy.js";
import { FinalArtifactInputSchema, UploadIdentitySchema, UploadIdSchema, QianchuanUploadConfigSchema, QianchuanUploadSelectionSchema, QianchuanUploadResultSchema, UploadAuthorizationSchema, PageOwnershipSchema, uploadFailure, type UploadIdentity, type QianchuanUploadConfig, type PageOwnership } from "../shared/douyin-upload.js";

export const UploadIntentSchema = UploadIdentitySchema.extend({ selection: QianchuanUploadSelectionSchema, config: QianchuanUploadConfigSchema, authorization: UploadAuthorizationSchema }).strict();
export type UploadIntent = z.infer<typeof UploadIntentSchema>;
export const UploadInputSchema = FinalArtifactInputSchema.omit({ caption: true, metadata: true });
const TaskSchema = z.object({ input: UploadInputSchema, inputDigest: UploadIdSchema, config: QianchuanUploadConfigSchema, authorization: UploadAuthorizationSchema, snapshotPath: z.string().min(1), result: QianchuanUploadResultSchema }).strict();
export type UploadTaskRecord = z.infer<typeof TaskSchema>;
const StateSchema = z.object({ version: z.literal(2), config: QianchuanUploadConfigSchema, intents: z.array(UploadIntentSchema), tasks: z.array(TaskSchema), legacy: z.boolean() }).strict();
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
async function privateBytes(file: string): Promise<Buffer> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o7177 || info.uid !== process.getuid?.()) throw new Error("Upload record must be private");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== info.dev || before.ino !== info.ino || before.mode !== info.mode || before.uid !== info.uid || before.size !== info.size) throw new Error("Upload record changed");
    const bytes = await handle.readFile(), after = await handle.stat(), current = await lstat(file);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.mode !== before.mode || current.dev !== after.dev || current.ino !== after.ino || current.isSymbolicLink() || bytes.length !== before.size) throw new Error("Upload record changed");
    return bytes;
  } finally { await handle.close(); }
}
const empty = (): State => ({ version: 2, config: QianchuanUploadConfigSchema.parse({}), intents: [], tasks: [], legacy: false });

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
  private get legacyPath(): string { return path.join(this.root, "legacy-v1.json"); }
  get config(): QianchuanUploadConfig { return structuredClone(this.data.config); }
  intents(): UploadIntent[] { return structuredClone(this.data.intents); }
  tasks(): UploadTaskRecord[] { return structuredClone(this.data.tasks); }
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
        if (oldMarkers.size || names.includes("legacy-v1.json") || names.some(name => name.startsWith("state.json")) || (await readdir(this.fenceDirectory)).length) throw new Error("Missing ledger with history");
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
          data = StateSchema.parse(value);
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
      for (const task of data.tasks) {
        const fence = fences.get(task.result.upload_task_id);
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
    const ids = new Set<string>(), identities = new Set<string>(), intents = new Map<string, UploadIntent>();
    for (const intent of data.intents) {
      const key = intentKey(intent);
      if (intents.has(key) || intent.selection.accountProduct !== intent.authorization.target.product) throw new Error("Intent binding mismatch");
      for (const other of intents.values()) if (other.authorization.pageBatchId === intent.authorization.pageBatchId && (other.project_id !== intent.project_id || JSON.stringify(other.authorization) !== JSON.stringify(intent.authorization))) throw new Error("Batch target mismatch");
      intents.set(key, intent);
    }
    for (const intent of intents.values()) if ([...intents.values()].filter(other => other.authorization.pageBatchId === intent.authorization.pageBatchId).length > intent.authorization.expectedCount) throw new Error("Batch count mismatch");
    const groups = new Map<string, Fence[]>();
    for (const task of data.tasks) {
      const id = task.result.upload_task_id, target = task.authorization.target, intent = intents.get(intentKey(task.input)), fence = fences.get(id);
      if (ids.has(id) || identities.has(intentKey(task.input)) || id !== uploadTaskId(task.input, target) || task.inputDigest !== frozenInputDigest(task.input, task.authorization) || intentKey(task.result) !== intentKey(task.input) || task.result.artifact_sha256 !== task.input.artifact_sha256 || task.result.accountProduct !== target.product || task.result.advertiserId !== target.advertiserId || task.result.adId !== target.adId || !intent || JSON.stringify(intent.authorization) !== JSON.stringify(task.authorization) || JSON.stringify(intent.config) !== JSON.stringify(task.config)) throw new Error("Task binding mismatch");
      ids.add(id); identities.add(intentKey(task.input));
      if (task.result.file_name !== path.basename(task.input.video_path)) throw new Error("Task filename mismatch");
      if (fence && (fence.input_digest !== task.inputDigest || fence.artifact_sha256 !== task.input.artifact_sha256 || fence.advertiserId !== target.advertiserId || fence.adId !== target.adId || fence.pageOwnership.pageBatchId !== task.authorization.pageBatchId || fence.attempt !== task.result.attempt_count)) throw new Error("Fence binding mismatch");
      if (fence) {
        if (fence.selectedIndex > task.authorization.expectedCount) throw new Error("Fence exceeds batch count");
        const group = groups.get(task.authorization.pageBatchId) ?? []; group.push(fence); groups.set(task.authorization.pageBatchId, group);
      }
      if (task.result.upload_outcome !== "NOT_SELECTED" && !fence && !task.result.duplicate_of) throw new Error("Missing selection fence");
      if (task.result.readyEvidence && fence && (JSON.stringify(task.result.readyEvidence.pageOwnership) !== JSON.stringify(fence.pageOwnership) || task.result.readyEvidence.selectedCount < fence.selectedIndex || task.result.readyEvidence.selectedCount > [...fences.values()].filter(other => other.pageOwnership.pageBatchId === fence.pageOwnership.pageBatchId).length)) throw new Error("Ready ownership mismatch");
    }
    for (const group of groups.values()) {
      group.sort((left, right) => left.selectedIndex - right.selectedIndex);
      if (group.some((fence, index) => fence.selectedIndex !== index + 1 || JSON.stringify(fence.pageOwnership) !== JSON.stringify(group[0].pageOwnership))) throw new Error("Batch page ownership mismatch");
    }
    for (const id of fences.keys()) if (!ids.has(id)) throw new Error("Orphan selection fence");
    for (const task of data.tasks) if (task.result.duplicate_of) {
      const original = data.tasks.find(other => other.result.upload_task_id === task.result.duplicate_of);
      if (!original || original.result.duplicate_of || !sameTargetBytes(task, original) || !fences.has(original.result.upload_task_id) || task.result.readyEvidence && JSON.stringify(task.result.readyEvidence) !== JSON.stringify(original.result.readyEvidence)) throw new Error("Invalid duplicate evidence");
    }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> { const next = this.chain.catch(() => undefined).then(work); this.chain = next; return next; }
  private assertReady(): void { if (!this.loaded || this.blocked) throw uploadFailure("STORE_UNAVAILABLE", "store", "上传存储不可用。", "检查本机记录和权限。", true); }
  private async commit(data: State): Promise<void> {
    this.assertReady();
    try { const parsed = StateSchema.parse(data); this.validate(parsed, this.fences); await atomicWriteJson(this.statePath, parsed); await strictSyncDirectory(this.root); this.data = parsed; }
    catch { this.blocked = true; throw uploadFailure("STORE_UNAVAILABLE", "store", "上传记录无法可靠保存，已停止操作。", "保留全部文件选择屏障并检查磁盘。", true); }
  }
  setConfig(config: QianchuanUploadConfig): Promise<void> { return this.serial(() => this.commit({ ...this.data, config: QianchuanUploadConfigSchema.parse(config) })); }
  saveIntents(intents: UploadIntent[]): Promise<void> {
    return this.serial(async () => {
      this.assertReady(); const next = structuredClone(this.data);
      for (const input of intents) {
        const intent = UploadIntentSchema.parse(input), existing = next.intents.find(value => intentKey(value) === intentKey(intent));
        if (existing && JSON.stringify(existing) !== JSON.stringify(intent)) throw uploadFailure("INPUT_CONFLICT", "input", "本次上传目标已冻结。", "保留原任务目标。", false);
        if (!existing) next.intents.push(intent);
      }
      await this.commit(next);
    });
  }
  saveTask(task: UploadTaskRecord): Promise<void> {
    return this.serial(async () => {
      this.assertReady(); const id = task.result.upload_task_id, old = this.data.tasks.find(value => value.result.upload_task_id === id);
      if (old && (old.inputDigest !== task.inputDigest || JSON.stringify(old.authorization) !== JSON.stringify(task.authorization) || JSON.stringify(old.config) !== JSON.stringify(task.config))) throw new Error("Frozen task changed");
      if (this.hasMarker(id) && (task.result.upload_outcome === "NOT_SELECTED" || old?.result.attempt_count !== task.result.attempt_count)) throw new Error("Selection fence cannot be reversed");
      const tasks = this.data.tasks.filter(value => value.result.upload_task_id !== id).map(value => {
        if (value.result.duplicate_of !== id) return value;
        return { ...value, result: { ...value.result, state: task.result.readyEvidence ? "WAITING_FOR_CONFIRMATION" as const : "NEEDS_HUMAN" as const, upload_outcome: task.result.readyEvidence ? "READY" as const : "MAY_HAVE_UPLOADED" as const, readyEvidence: task.result.readyEvidence, failure: task.result.readyEvidence ? undefined : task.result.failure, retryable: false, timestamp: task.result.timestamp } };
      });
      await this.commit({ ...this.data, tasks: [...tasks, task] });
    });
  }
  markSelecting(id: string, pageOwnership: PageOwnership, selectedIndex: number): Promise<void> {
    return this.serial(async () => {
      this.assertReady(); const task = this.task(id);
      if (!task || task.result.upload_outcome !== "NOT_SELECTED" || task.result.duplicate_of || this.hasMarker(id) || this.data.tasks.some(other => other.result.upload_task_id !== id && sameTargetBytes(task, other) && this.hasMarker(other.result.upload_task_id))) throw new Error("File selection permission unavailable");
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
}
