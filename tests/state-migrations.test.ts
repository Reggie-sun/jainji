import { chmod, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BATCH_SCHEMA_VERSION, createDefaultProject, DEFAULT_PRESET, PROJECT_SCHEMA_VERSION, QUEUE_SCHEMA_VERSION } from "../src/main/domain";
import { FutureSchemaVersionError, migrateProjectState, migrateQueueState, type PersistenceSchemaVersions } from "../src/main/state-migrations";
import { atomicWriteJson, JobStore, ProjectStore, StoreError } from "../src/main/store";

const versions: PersistenceSchemaVersions = { project: 3, queue: 2, batch: 2, template: 1 };

function legacyBatch(project: ReturnType<typeof createDefaultProject>) {
  const id = crypto.randomUUID();
  const mediaId = crypto.randomUUID();
  return {
    schemaVersion: 1,
    id,
    projectId: project.id,
    templateSnapshot: structuredClone(project.templates[0]),
    mediaIds: [mediaId],
    outputDirectory: "/tmp/jianji-output",
    preset: DEFAULT_PRESET,
    status: "active",
    estimatedBytes: 0,
    createdAt: project.updatedAt,
    tasks: [{ id: crypto.randomUUID(), batchId: id, mediaId, status: "queued", progress: 0, attempt: 0, createdAt: project.updatedAt, attempts: [] }],
  };
}

describe("state migrations", () => {
  it("round trips optional frozen source provenance without requiring local knowledge or changing legacy templates", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-knowledge-migration-"));
    const legacy = createDefaultProject(), project = structuredClone(legacy);
    project.templates[0].sourceStickerKnowledge = { sourceKey: "a".repeat(64), revisionId: "frozen-revision", factsDigest: "b".repeat(64), verification: "sampled", persistence: "saved", reviewedRanges: [{ startMs: 0, endMs: 3000 }] };
    const store = new ProjectStore(path.join(directory, "project.json"));
    await store.save(project);
    expect((await store.load()).project.templates[0]).toEqual(project.templates[0]);
    await store.save(legacy);
    expect((await store.load()).project.templates[0]).toEqual(legacy.templates[0]);
    expect((await store.load()).project.templates[0].sourceStickerKnowledge).toBeUndefined();
  });
  it("migrates a v1 project and nested batch without changing frozen template data", () => {
    const template = { schemaVersion: 1, version: 7, layers: [{ render: "frozen" }] };
    const result = migrateProjectState({ schemaVersion: 1, templates: [template], exportBatches: [{ schemaVersion: 1, templateSnapshot: template }] }, versions);

    expect(result).toEqual({
      migrated: true,
      value: { schemaVersion: 3, templates: [template], exportBatches: [{ schemaVersion: 2, templateSnapshot: template }] },
    });
  });

  it("migrates a v2 project without inventing a workspace draft", () => {
    const project = { schemaVersion: 2, templates: [], exportBatches: [] };
    expect(migrateProjectState(project, versions)).toEqual({
      migrated: true,
      value: { ...project, schemaVersion: 3 },
    });
  });

  it("migrates a standalone v1 job and its nested batch", () => {
    const template = { schemaVersion: 1, version: 3, renderMetadata: { opaqueBackground: true } };
    const result = migrateQueueState({ schemaVersion: 1, revision: 4, batch: { schemaVersion: 1, templateSnapshot: template } }, versions);

    expect(result).toEqual({
      migrated: true,
      value: { schemaVersion: 2, revision: 4, batch: { schemaVersion: 2, templateSnapshot: template } },
    });
  });

  it("refuses a nested future batch before changing a project", () => {
    const project = { schemaVersion: 1, templates: [], exportBatches: [{ schemaVersion: 3, templateSnapshot: { schemaVersion: 1 } }] };
    expect(() => migrateProjectState(project, versions)).toThrow(FutureSchemaVersionError);
    expect(project.schemaVersion).toBe(1);
  });

  it("refuses a nested future batch before changing a standalone job", () => {
    const job = { schemaVersion: 1, batch: { schemaVersion: 3, templateSnapshot: { schemaVersion: 1 } } };
    expect(() => migrateQueueState(job, versions)).toThrow(FutureSchemaVersionError);
    expect(job.schemaVersion).toBe(1);
  });

  it("loads a v1 project and nested batch, preserving its frozen template and original backup", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-project-migration-"));
    const filePath = path.join(directory, "project.json");
    const project = createDefaultProject("legacy project");
    const batch = legacyBatch(project);
    const legacy = { ...project, schemaVersion: 1, exportBatches: [batch] };
    await atomicWriteJson(filePath, legacy);

    const result = await new ProjectStore(filePath).load();

    expect(result.source).toBe("primary");
    expect(result.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(result.project.exportBatches[0].schemaVersion).toBe(BATCH_SCHEMA_VERSION);
    expect(result.project.templates[0]).toEqual(legacy.templates[0]);
    expect(result.project.exportBatches[0].templateSnapshot).toEqual(batch.templateSnapshot);
    expect(result.migrationBackupPath).toBeDefined();
    expect(JSON.parse(await readFile(result.migrationBackupPath!, "utf8"))).toEqual(legacy);
    expect((await readdir(directory)).some((entry) => entry.includes(".corrupt-"))).toBe(false);
  });

  it("loads a standalone v1 job and nested batch, preserving its frozen template", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-job-migration-"));
    const project = createDefaultProject();
    const batch = legacyBatch(project);
    const store = new JobStore(path.join(directory, "jobs"));
    const legacy = { schemaVersion: 1, revision: 0, batch, updatedAt: project.updatedAt };
    await atomicWriteJson(store.pathFor(batch.id), legacy);

    const result = await store.load(batch.id);

    expect(result.state.schemaVersion).toBe(QUEUE_SCHEMA_VERSION);
    expect(result.state.batch.schemaVersion).toBe(BATCH_SCHEMA_VERSION);
    expect(result.state.batch.templateSnapshot).toEqual(batch.templateSnapshot);
    expect(JSON.parse(await readFile(result.migrationBackupPath!, "utf8"))).toEqual(legacy);
  });

  it("keeps one job when loadAll is repeated after migration", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-load-all-migration-"));
    const project = createDefaultProject();
    const batch = legacyBatch(project);
    const store = new JobStore(path.join(directory, "jobs"));
    await atomicWriteJson(store.pathFor(batch.id), { schemaVersion: 1, revision: 0, batch, updatedAt: project.updatedAt });

    expect((await store.loadAll()).map((state) => state.batch.id)).toEqual([batch.id]);
    expect((await store.loadAll()).map((state) => state.batch.id)).toEqual([batch.id]);
    const entries = await readdir(path.join(directory, "jobs"));
    expect(entries.filter((entry) => entry.endsWith(".json"))).toEqual([`${batch.id}.json`]);
    expect(entries.some((entry) => entry.includes(".migration-v1-") && entry.endsWith(".backup"))).toBe(true);
  });

  it("restores and migrates a v1 backup when its primary is corrupt", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-backup-migration-"));
    const filePath = path.join(directory, "project.json");
    const project = createDefaultProject();
    const legacy = { ...project, schemaVersion: 1, exportBatches: [legacyBatch(project)] };
    await writeFile(filePath, "{broken", "utf8");
    await writeFile(`${filePath}.bak`, `${JSON.stringify(legacy)}\n`, "utf8");

    const result = await new ProjectStore(filePath).load();

    expect(result.source).toBe("backup");
    expect(result.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(result.project.exportBatches[0].schemaVersion).toBe(BATCH_SCHEMA_VERSION);
    expect(JSON.parse(await readFile(result.migrationBackupPath!, "utf8"))).toEqual(legacy);
  });

  it.each(["primary", "backup"] as const)("refuses a nested future version from the %s without quarantine or fallback", async (source) => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-future-migration-"));
    const filePath = path.join(directory, "project.json");
    const project = createDefaultProject();
    const future = { ...project, schemaVersion: 1, exportBatches: [{ ...legacyBatch(project), schemaVersion: 3 }] };
    if (source === "primary") {
      await atomicWriteJson(filePath, future);
    } else {
      await writeFile(filePath, "{broken", "utf8");
      await writeFile(`${filePath}.bak`, `${JSON.stringify(future)}\n`, "utf8");
    }
    const beforePrimary = await readFile(filePath, "utf8");
    const beforeBackup = source === "backup" ? await readFile(`${filePath}.bak`, "utf8") : undefined;

    await expect(new ProjectStore(filePath).load()).rejects.toMatchObject({ code: "future_schema" } satisfies Partial<StoreError>);

    expect(await readFile(filePath, "utf8")).toBe(beforePrimary);
    if (beforeBackup !== undefined) expect(await readFile(`${filePath}.bak`, "utf8")).toBe(beforeBackup);
  });

  it.skipIf(process.platform === "win32")("reports a migration backup I/O failure without isolating or replacing the primary", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-migration-io-"));
    const filePath = path.join(directory, "project.json");
    const project = createDefaultProject();
    await atomicWriteJson(filePath, { ...project, schemaVersion: 1, exportBatches: [legacyBatch(project)] });
    const before = await readFile(filePath, "utf8");
    await chmod(directory, 0o500);
    try {
      await expect(new ProjectStore(filePath).load()).rejects.toMatchObject({ code: "unavailable" } satisfies Partial<StoreError>);
      expect(await readFile(filePath, "utf8")).toBe(before);
      expect((await readdir(directory)).some((entry) => entry.includes(".corrupt-"))).toBe(false);
    } finally {
      await chmod(directory, 0o700);
    }
  });

  it.skipIf(process.platform === "win32")("does not silently skip a job when its migration persistence is unavailable", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-load-all-io-"));
    const project = createDefaultProject();
    const batch = legacyBatch(project);
    const jobs = path.join(directory, "jobs");
    const store = new JobStore(jobs);
    await atomicWriteJson(store.pathFor(batch.id), { schemaVersion: 1, revision: 0, batch, updatedAt: project.updatedAt });
    await chmod(jobs, 0o500);
    try {
      await expect(store.loadAll()).rejects.toMatchObject({ code: "unavailable" } satisfies Partial<StoreError>);
    } finally {
      await chmod(jobs, 0o700);
    }
  });

  it("does not publish a cancelled atomic write", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-aborted-write-"));
    const filePath = path.join(directory, "state.json");
    await atomicWriteJson(filePath, { value: "before" });
    const signal = new AbortController(); signal.abort();
    await expect(atomicWriteJson(filePath, { value: "after" }, signal.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ value: "before" });
  });
});
