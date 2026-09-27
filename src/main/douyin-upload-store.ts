import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicWriteJson } from "./store.js";
import { DouyinUploadConfigSchema, DouyinUploadSelectionSchema, FinalArtifactInputSchema, UploadIdentitySchema, UploadIdSchema, UploadResultSchema, uploadFailure, type DouyinUploadConfig, type FinalArtifactInput, type UploadIdentity } from "../shared/douyin-upload.js";

export const UploadIntentSchema = UploadIdentitySchema.extend({ selection: DouyinUploadSelectionSchema, config: DouyinUploadConfigSchema }).strict();
export type UploadIntent = z.infer<typeof UploadIntentSchema>;
const TaskSchema = z.object({
  input: FinalArtifactInputSchema, inputDigest: UploadIdSchema, config: DouyinUploadConfigSchema, snapshotPath: z.string(),
  revisions: z.array(z.object({ caption: z.string().optional(), timestamp: z.string().datetime() }).strict()), result: UploadResultSchema,
}).strict();
export type UploadTaskRecord = z.infer<typeof TaskSchema>;
const StateSchema = z.object({ version: z.literal(1), config: DouyinUploadConfigSchema, intents: z.array(UploadIntentSchema), tasks: z.array(TaskSchema) }).strict();
const MarkerSchema = z.object({ version: z.literal(1), upload_task_id: UploadIdSchema, artifact_sha256: UploadIdSchema, input_digest: UploadIdSchema, timestamp: z.string().datetime() }).strict();
type State = z.infer<typeof StateSchema>;
type Marker = z.infer<typeof MarkerSchema>;

export function uploadTaskId(input: FinalArtifactInput): string {
  return digest({ schema: "jianji-douyin-upload/1", project_id: input.project_id, batch_id: input.batch_id, export_task_id: input.export_task_id, artifact_sha256: input.artifact_sha256 });
}
export function frozenInputDigest(input: FinalArtifactInput): string {
  return digest({ ...input, metadata: input.metadata ? Object.fromEntries(Object.entries(input.metadata).sort(([a], [b]) => a.localeCompare(b))) : undefined });
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function intentKey(identity: UploadIdentity): string { return JSON.stringify([identity.project_id, identity.batch_id, identity.export_task_id]); }
export async function strictSyncDirectory(directory: string): Promise<void> {
  // Windows directory durability/ACL has not been qualified. Do not grant publication permission there.
  if (process.platform === "win32") throw new Error("Windows upload persistence is not qualified");
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function secureUploadDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const information = await lstat(directory);
  if (!information.isDirectory() || information.isSymbolicLink() || process.platform !== "win32" && (information.mode & 0o077)) throw new Error("Upload directory must be private");
}
async function privateFile(file: string): Promise<void> {
  const information = await lstat(file);
  if (!information.isFile() || information.isSymbolicLink() || process.platform !== "win32" && (information.mode & 0o077)) throw new Error("Upload record must be a private regular file");
}

/** One local ledger; backups never restore publish permission. Markers are append-only. */
export class DouyinUploadStore {
  private data: State = { version: 1, config: DouyinUploadConfigSchema.parse({}), intents: [], tasks: [] };
  private markers = new Map<string, Marker>();
  private chain: Promise<unknown> = Promise.resolve();
  private loaded = false;
  private blocked = false;
  constructor(readonly root: string, private readonly durability: { syncDirectory?: (directory: string) => Promise<void> } = {}) {}
  private get statePath(): string { return path.join(this.root, "state.json"); }
  private get markerDirectory(): string { return path.join(this.root, "markers"); }
  get config(): DouyinUploadConfig { return structuredClone(this.data.config); }
  intents(): UploadIntent[] { return structuredClone(this.data.intents); }
  tasks(): UploadTaskRecord[] { return structuredClone(this.data.tasks); }
  task(id: string): UploadTaskRecord | undefined { const value = this.data.tasks.find(task => task.result.upload_task_id === id); return value && structuredClone(value); }
  hasMarker(id: string): boolean { return this.markers.has(id); }
  get unavailable(): boolean { return this.blocked; }

  async load(): Promise<void> {
    try {
      await secureUploadDirectory(this.root);
      await secureUploadDirectory(this.markerDirectory);
      // Always inspect markers before interpreting mutable task JSON.
      const markers = new Map<string, Marker>();
      for (const name of await readdir(this.markerDirectory)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error("Unknown marker entry");
        await privateFile(path.join(this.markerDirectory, name));
        const marker = MarkerSchema.parse(JSON.parse(await readFile(path.join(this.markerDirectory, name), "utf8")));
        if (name !== `${marker.upload_task_id}.json`) throw new Error("Marker identity mismatch");
        markers.set(marker.upload_task_id, marker);
      }
      let data: State;
      try { await privateFile(this.statePath); data = StateSchema.parse(JSON.parse(await readFile(this.statePath, "utf8"))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || markers.size || (await readdir(this.root)).some(name => name.startsWith("state.json"))) throw error;
        data = { version: 1, config: DouyinUploadConfigSchema.parse({}), intents: [], tasks: [] };
      }
      const identities = new Set<string>();
      const ids = new Set<string>();
      for (const task of data.tasks) {
        const id = task.result.upload_task_id;
        if (id !== uploadTaskId(task.input) || task.inputDigest !== frozenInputDigest(task.input) || ids.has(id) || identities.has(intentKey(task.input)) ||
          intentKey(task.result) !== intentKey(task.input) || task.result.artifact_sha256 !== task.input.artifact_sha256) throw new Error("Task binding mismatch");
        ids.add(id); identities.add(intentKey(task.input));
        const marker = markers.get(id);
        if (marker && (marker.artifact_sha256 !== task.input.artifact_sha256 || marker.input_digest !== task.inputDigest)) throw new Error("Marker binding mismatch");
        if (task.result.publish_outcome !== "NOT_SUBMITTED" && !marker && !task.result.duplicate_of) throw new Error("Missing submit fence");
        if (marker && task.result.state !== "SUCCEEDED" && !(task.result.state === "FAILED_TERMINAL" && task.result.publish_outcome === "REJECTED_KNOWN")) {
          task.result = { ...task.result, state: "NEEDS_HUMAN", publish_outcome: "MAY_HAVE_SUBMITTED", retryable: false,
            failure: uploadFailure("PUBLISH_OUTCOME_UNKNOWN", "publish", "存在发布提交记录，需要核查原结果。", "在后台核查同一条内容；不能重新发布。", true).failure };
        } else if (!marker && !["SUCCEEDED", "FAILED_TERMINAL", "CANCELLED", "PENDING", "NEEDS_HUMAN", "FAILED_RETRYABLE"].includes(task.result.state)) {
          task.result.state = "CANCELLED";
          task.result.failure = uploadFailure("STOPPED", "cancel", "上次操作已中断。", "确认浏览器后明确继续。", false).failure;
        }
      }
      for (const id of markers.keys()) if (!ids.has(id)) throw new Error("Orphan submit marker");
      for (const task of data.tasks) if (task.result.duplicate_of && !ids.has(task.result.duplicate_of)) throw new Error("Missing duplicate original");
      this.data = data; this.markers = markers; this.loaded = true;
    } catch { this.blocked = true; throw uploadFailure("STORE_UNAVAILABLE", "store", "上传记录损坏、版本未知或权限不安全，已停用上传。", "保留全部上传记录并检查本机存储；不要清除提交标记。", true); }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.catch(() => undefined).then(work); this.chain = next; return next;
  }
  private assertReady(): void { if (!this.loaded || this.blocked) throw uploadFailure("STORE_UNAVAILABLE", "store", "上传存储不可用。", "检查本机上传记录和目录权限。", true); }
  private async commit(data: State): Promise<void> {
    this.assertReady();
    try {
      const parsed = StateSchema.parse(data);
      await atomicWriteJson(this.statePath, parsed);
      await strictSyncDirectory(this.root);
      this.data = parsed;
    } catch { this.blocked = true; throw uploadFailure("STORE_UNAVAILABLE", "store", "上传记录无法可靠保存，已停止操作。", "检查磁盘和权限；保留提交记录。", true); }
  }
  setConfig(config: DouyinUploadConfig): Promise<void> { return this.serial(() => this.commit({ ...this.data, config: DouyinUploadConfigSchema.parse(config) })); }
  saveIntent(intent: UploadIntent): Promise<void> {
    return this.serial(async () => {
      this.assertReady(); intent = UploadIntentSchema.parse(intent);
      const existing = this.data.intents.find(value => intentKey(value) === intentKey(intent));
      if (existing) { if (JSON.stringify(existing) !== JSON.stringify(intent)) throw uploadFailure("INPUT_CONFLICT", "input", "本次上传授权字段已冻结。", "使用原任务字段。", false); return; }
      await this.commit({ ...this.data, intents: [...this.data.intents, intent] });
    });
  }
  saveTask(task: UploadTaskRecord): Promise<void> {
    return this.serial(async () => {
      this.assertReady(); const id = task.result.upload_task_id;
      if (id !== uploadTaskId(task.input) || task.inputDigest !== frozenInputDigest(task.input)) throw new Error("Task identity mismatch");
      const old = this.data.tasks.find(value => value.result.upload_task_id === id);
      if (old?.result.state === "SUCCEEDED" && JSON.stringify(old) !== JSON.stringify(task)) throw new Error("Success is immutable");
      if (this.hasMarker(id) && (task.result.publish_outcome === "NOT_SUBMITTED" || old?.inputDigest !== task.inputDigest)) throw new Error("Submit fence cannot be reversed");
      const others = this.data.tasks.filter(value => value.result.upload_task_id !== id);
      if (others.some(value => intentKey(value.input) === intentKey(task.input))) throw new Error("Export already bound");
      await this.commit({ ...this.data, tasks: [...others, task] });
    });
  }
  markSubmitting(id: string): Promise<void> {
    return this.serial(async () => {
      this.assertReady(); const task = this.task(id);
      if (!task || task.result.publish_outcome !== "NOT_SUBMITTED" || this.hasMarker(id)) throw new Error("Publication permission unavailable");
      if (this.data.tasks.some(other => other.result.upload_task_id !== id && other.input.artifact_sha256 === task.input.artifact_sha256 && (this.hasMarker(other.result.upload_task_id) || other.result.state === "SUCCEEDED"))) throw new Error("Bytes already submitted");
      const marker: Marker = { version: 1, upload_task_id: id, artifact_sha256: task.input.artifact_sha256, input_digest: task.inputDigest, timestamp: new Date().toISOString() };
      const file = path.join(this.markerDirectory, `${id}.json`);
      let handle;
      try {
        // Sync parent directories before creating the fence; unsupported platforms fail closed.
        await strictSyncDirectory(path.dirname(this.root));
        await strictSyncDirectory(this.root);
        handle = await open(file, "wx", 0o600);
        this.markers.set(id, marker); // Even failed writes may have created a permanent fence.
        await handle.writeFile(`${JSON.stringify(marker)}\n`, "utf8");
        await handle.sync(); await handle.close(); handle = undefined;
        await (this.durability.syncDirectory ?? strictSyncDirectory)(this.markerDirectory);
        task.result = { ...task.result, state: "SUBMITTING", publish_outcome: "MAY_HAVE_SUBMITTED", retryable: false, failure: undefined, timestamp: marker.timestamp };
        await this.commit({ ...this.data, tasks: this.data.tasks.map(value => value.result.upload_task_id === id ? task : value) });
      } catch {
        this.blocked = true;
        throw uploadFailure("STORE_UNAVAILABLE", "store", "提交屏障保存或同步失败，禁止发布。", "保留标记并人工核查存储。", true);
      } finally { await handle?.close().catch(() => undefined); }
    });
  }
}
