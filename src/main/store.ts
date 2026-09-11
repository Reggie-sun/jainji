import { copyFile, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { SCHEMA_VERSION, type QueueState, type Project, QueueStateSchema, ProjectSchema } from "./domain.js";

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
  const handle = await open(filePath, "r");
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
export function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const key = path.resolve(filePath);
  const previous = writeChains.get(key) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(() => atomicWriteJsonNow(filePath, value));
  const tracked = write.finally(() => {
    if (writeChains.get(key) === tracked) writeChains.delete(key);
  });
  writeChains.set(key, tracked);
  return tracked;
}

async function atomicWriteJsonNow(filePath: string, value: unknown): Promise<void> {
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
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new StoreError("corrupt", `Cannot read JSON state: ${path.basename(filePath)}`, { cause: error });
  }
}

async function isolateCorrupt(filePath: string): Promise<void> {
  const quarantine = `${filePath}.corrupt-${Date.now()}`;
  await rename(filePath, quarantine).catch(() => undefined);
}

export async function readValidatedJson<T>(
  filePath: string,
  parse: (value: unknown) => T,
  options: { useBackup?: boolean } = {},
): Promise<{ value: T; source: "primary" | "backup" }> {
  const candidates = [filePath, ...(options.useBackup === false ? [] : [`${filePath}.bak`])];
  let primaryError: unknown;
  for (const [index, candidate] of candidates.entries()) {
    try {
      const raw = await readJson(candidate);
      const version = schemaVersionOf(raw);
      if (version !== undefined && version > SCHEMA_VERSION) {
        throw new StoreError("future_schema", `Unsupported future schema version ${version}`);
      }
      const value = parse(raw);
      if (index > 0) {
        if (await exists(filePath)) await isolateCorrupt(filePath);
        await atomicWriteJson(filePath, value);
      }
      return { value, source: index === 0 ? "primary" : "backup" };
    } catch (error) {
      if (index === 0) primaryError = error;
      if (error instanceof StoreError && error.code === "future_schema") throw error;
    }
  }
  if (await exists(filePath)) await isolateCorrupt(filePath);
  throw new StoreError("corrupt", `No valid state found for ${path.basename(filePath)}`, { cause: primaryError });
}

export class ProjectStore {
  constructor(private readonly filePath: string) {}

  async save(project: Project): Promise<void> {
    await atomicWriteJson(this.filePath, ProjectSchema.parse(project));
  }

  async load(): Promise<{ project: Project; source: "primary" | "backup" }> {
    const result = await readValidatedJson(this.filePath, (value) => ProjectSchema.parse(value));
    return { project: result.value, source: result.source };
  }

  get path(): string { return this.filePath; }
}

export class JobStore {
  constructor(private readonly jobsDirectory: string) {}

  async save(state: QueueState): Promise<void> {
    await atomicWriteJson(this.pathFor(state.batch.id), QueueStateSchema.parse(state));
  }

  async load(batchId: string): Promise<{ state: QueueState; source: "primary" | "backup" }> {
    const result = await readValidatedJson(this.pathFor(batchId), (value) => QueueStateSchema.parse(value));
    return { state: result.value, source: result.source };
  }

  async loadAll(): Promise<QueueState[]> {
    const { readdir } = await import("node:fs/promises");
    await mkdir(this.jobsDirectory, { recursive: true });
    const entries = await readdir(this.jobsDirectory, { withFileTypes: true });
    const states: QueueState[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try { states.push((await this.load(entry.name.slice(0, -5))).state); }
      catch (error) {
        if (error instanceof StoreError && error.code === "future_schema") throw error;
        // A single corrupt job must not prevent unrelated jobs from recovering.
      }
    }
    return states;
  }

  pathFor(batchId: string): string { return path.join(this.jobsDirectory, `${batchId}.json`); }
}
