import { copyFile, lstat, mkdir, open, opendir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  BATCH_SCHEMA_VERSION,
  PROJECT_SCHEMA_VERSION,
  QUEUE_SCHEMA_VERSION,
  SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  type QueueState,
  type Project,
  QueueStateSchema,
  ExportBatchSchema,
  ProjectSchema,
} from "./domain.js";
import {
  FutureSchemaVersionError,
  migrateProjectState,
  migrateQueueState,
  type StateMigrationResult,
} from "./state-migrations.js";

export class StoreError extends Error {
  constructor(public readonly code: "corrupt" | "future_schema" | "unavailable", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StoreError";
  }
}

function schemaVersionOf(value: unknown): number | undefined {
  return typeof value === "object" && value !== null && "schemaVersion" in value && typeof value.schemaVersion === "number"
    ? value.schemaVersion
    : undefined;
}

async function fsyncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, "r+");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function fsyncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch {
    // Some filesystems do not allow directory fsync; the file itself is still durable.
  }
}

const writeChains = new Map<string, Promise<void>>();

/** Atomic JSON persistence with a previous-valid backup. */
export function atomicWriteJson(filePath: string, value: unknown, signal?: AbortSignal): Promise<void> {
  const key = path.resolve(filePath);
  const previous = writeChains.get(key) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(() => atomicWriteJsonNow(filePath, value, signal));
  const tracked = write.finally(() => {
    if (writeChains.get(key) === tracked) writeChains.delete(key);
  });
  writeChains.set(key, tracked);
  return tracked;
}

async function atomicWriteJsonNow(filePath: string, value: unknown, signal?: AbortSignal): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await fsyncFile(temporary);
    if (await exists(filePath)) {
      await copyFile(filePath, `${filePath}.bak`);
      await fsyncFile(`${filePath}.bak`);
    }
    signal?.throwIfAborted();
    await rename(temporary, filePath);
    await fsyncDirectory(directory);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try { await readFile(filePath); return true; } catch { return false; }
}

async function readJson(filePath: string): Promise<unknown> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw new StoreError(missing ? "corrupt" : "unavailable", `Cannot read JSON state: ${path.basename(filePath)}`, { cause: error });
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new StoreError("corrupt", `Cannot read JSON state: ${path.basename(filePath)}`, { cause: error });
  }
}

async function isolateCorrupt(filePath: string): Promise<void> {
  const quarantine = `${filePath}.corrupt-${Date.now()}`;
  await rename(filePath, quarantine).catch(() => undefined);
}

async function preserveMigrationBackup(filePath: string, sourcePath: string): Promise<string> {
  const backupPath = `${filePath}.migration-v1-${Date.now()}-${randomUUID()}.backup`;
  try {
    await copyFile(sourcePath, backupPath);
    await fsyncFile(backupPath);
    await fsyncDirectory(path.dirname(backupPath));
    return backupPath;
  } catch (error) {
    throw new StoreError("unavailable", `Cannot preserve migration backup: ${path.basename(filePath)}`, { cause: error });
  }
}

export async function readValidatedJson<T>(
  filePath: string,
  parse: (value: unknown) => T,
  options: {
    useBackup?: boolean;
    maxVersion?: number;
    migrate?: (value: unknown) => StateMigrationResult;
  } = {},
): Promise<{ value: T; source: "primary" | "backup"; migrationBackupPath?: string }> {
  const candidates = [filePath, ...(options.useBackup === false ? [] : [`${filePath}.bak`])];
  let primaryError: unknown;
  for (const [index, candidate] of candidates.entries()) {
    try {
      const raw = await readJson(candidate);
      const version = schemaVersionOf(raw);
      if (version !== undefined && version > (options.maxVersion ?? SCHEMA_VERSION)) {
        throw new StoreError("future_schema", `Unsupported future schema version ${version}`);
      }
      const migration = options.migrate?.(raw) ?? { value: raw, migrated: false };
      const value = parse(migration.value);
      let migrationBackupPath: string | undefined;
      try {
        migrationBackupPath = migration.migrated
          ? await preserveMigrationBackup(filePath, candidate)
          : undefined;
        if (index > 0 || migration.migrated) {
          if (index > 0 && await exists(filePath)) await isolateCorrupt(filePath);
          await atomicWriteJson(filePath, value);
        }
      } catch (error) {
        if (error instanceof StoreError) throw error;
        throw new StoreError("unavailable", `Cannot rewrite JSON state: ${path.basename(filePath)}`, { cause: error });
      }
      return { value, source: index === 0 ? "primary" : "backup", ...(migrationBackupPath ? { migrationBackupPath } : {}) };
    } catch (error) {
      if (index === 0) primaryError = error;
      if (error instanceof FutureSchemaVersionError) {
        throw new StoreError("future_schema", error.message, { cause: error });
      }
      if (error instanceof StoreError && error.code !== "corrupt") throw error;
    }
  }
  if (await exists(filePath)) await isolateCorrupt(filePath);
  throw new StoreError("corrupt", `No valid state found for ${path.basename(filePath)}`, { cause: primaryError });
}

export class ProjectStore {
  constructor(private readonly filePath: string) {}

  /** Inspect a saved template without migration writes, backup recovery or quarantine. */
  async readSnapshot(): Promise<Project> {
    const raw = await readJson(this.filePath);
    return ProjectSchema.parse(migrateProjectState(raw, {
      project: PROJECT_SCHEMA_VERSION, queue: QUEUE_SCHEMA_VERSION,
      batch: BATCH_SCHEMA_VERSION, template: TEMPLATE_SCHEMA_VERSION,
    }).value);
  }

  async save(project: Project): Promise<void> {
    await atomicWriteJson(this.filePath, ProjectSchema.parse(project));
  }

  async load(): Promise<{ project: Project; source: "primary" | "backup"; migrationBackupPath?: string }> {
    const result = await readValidatedJson(
      this.filePath,
      (value) => ProjectSchema.parse(value),
      {
        maxVersion: PROJECT_SCHEMA_VERSION,
        migrate: (value) => migrateProjectState(value, {
          project: PROJECT_SCHEMA_VERSION,
          queue: QUEUE_SCHEMA_VERSION,
          batch: BATCH_SCHEMA_VERSION,
          template: TEMPLATE_SCHEMA_VERSION,
        }),
      },
    );
    return { project: result.value, source: result.source, ...(result.migrationBackupPath ? { migrationBackupPath: result.migrationBackupPath } : {}) };
  }

  get path(): string { return this.filePath; }
}

export class JobStore {
  constructor(private readonly jobsDirectory: string) {}

  private async canonicalDirectory(): Promise<void> {
    if (!(await lstat(this.jobsDirectory)).isDirectory() || await realpath(this.jobsDirectory) !== path.resolve(this.jobsDirectory)) {
      throw new StoreError("unavailable", "Canonical job directory required");
    }
  }

  /** Primary-only observation: no backups, migrations, quarantine, mkdir or lifecycle changes. */
  async readCanonical(batchId: string): Promise<QueueState> {
    ExportBatchSchema.shape.id.parse(batchId);
    await this.canonicalDirectory();
    const file = this.pathFor(batchId), limit = 4 * 1024 * 1024;
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size <= 0 || before.size > limit || (await lstat(file)).isSymbolicLink()) throw new StoreError("corrupt", "Invalid canonical job file");
      const buffer = Buffer.alloc(before.size + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const observed = await handle.read(buffer, bytes, buffer.length - bytes, null);
        if (observed.bytesRead === 0) break;
        bytes += observed.bytesRead;
      }
      const after = await handle.stat(), current = await lstat(file);
      if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || current.isSymbolicLink()
        || current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size || current.mtimeMs !== before.mtimeMs) throw new StoreError("corrupt", "Canonical job changed while reading");
      const state = QueueStateSchema.parse(JSON.parse(buffer.subarray(0, bytes).toString("utf8")));
      if (state.batch.id !== batchId || state.batch.tasks.some(task => task.batchId !== batchId)) throw new StoreError("corrupt", "Canonical job identity mismatch");
      return state;
    } finally { await handle.close(); }
  }

  /** Bounded primary inventory. Invalid entries cannot be skipped when proving uniqueness. */
  async canonicalBatchIds(): Promise<string[]> {
    await this.canonicalDirectory();
    const ids: string[] = [];
    let entries = 0;
    for await (const entry of await opendir(this.jobsDirectory)) {
      if (++entries > 16_384) throw new StoreError("unavailable", "Canonical job inventory limit");
      if (!entry.name.endsWith(".json")) continue;
      const id = ExportBatchSchema.shape.id.parse(entry.name.slice(0, -5));
      if (!entry.isFile() || ids.length >= 4096) throw new StoreError("corrupt", "Invalid canonical job inventory");
      ids.push(id);
    }
    return ids.sort();
  }

  async save(state: QueueState, signal?: AbortSignal): Promise<void> {
    await atomicWriteJson(this.pathFor(state.batch.id), QueueStateSchema.parse(state), signal);
  }

  async load(batchId: string): Promise<{ state: QueueState; source: "primary" | "backup"; migrationBackupPath?: string }> {
    const result = await readValidatedJson(
      this.pathFor(batchId),
      (value) => QueueStateSchema.parse(value),
      {
        maxVersion: QUEUE_SCHEMA_VERSION,
        migrate: (value) => migrateQueueState(value, {
          project: PROJECT_SCHEMA_VERSION,
          queue: QUEUE_SCHEMA_VERSION,
          batch: BATCH_SCHEMA_VERSION,
          template: TEMPLATE_SCHEMA_VERSION,
        }),
      },
    );
    return { state: result.value, source: result.source, ...(result.migrationBackupPath ? { migrationBackupPath: result.migrationBackupPath } : {}) };
  }

  async loadAll(): Promise<QueueState[]> {
    const { readdir } = await import("node:fs/promises");
    await mkdir(this.jobsDirectory, { recursive: true });
    const entries = await readdir(this.jobsDirectory, { withFileTypes: true });
    const states: QueueState[] = [];
    let processed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try { states.push((await this.load(entry.name.slice(0, -5))).state); }
      catch (error) {
        if (error instanceof StoreError && error.code === "corrupt") continue;
        throw error;
      }
      // Keep the main-process event loop responsive over large job archives.
      if (++processed % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return states;
  }

  pathFor(batchId: string): string { return path.join(this.jobsDirectory, `${batchId}.json`); }
}
