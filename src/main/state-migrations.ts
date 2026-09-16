export interface PersistenceSchemaVersions {
  project: number;
  queue: number;
  batch: number;
  template: number;
}

export interface StateMigrationResult {
  value: unknown;
  migrated: boolean;
}

/** Signals a format that this build must leave untouched. */
export class FutureSchemaVersionError extends Error {
  constructor(public readonly version: number) {
    super(`Unsupported future schema version ${version}`);
    this.name = "FutureSchemaVersionError";
  }
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function schemaVersionOf(value: unknown): number | undefined {
  const record = recordOf(value);
  return typeof record?.schemaVersion === "number" ? record.schemaVersion : undefined;
}

function assertSupported(value: unknown, maxVersion: number): void {
  const version = schemaVersionOf(value);
  if (version !== undefined && version > maxVersion) throw new FutureSchemaVersionError(version);
}

function preflightTemplate(value: unknown, versions: PersistenceSchemaVersions): void {
  assertSupported(value, versions.template);
}

function preflightBatch(value: unknown, versions: PersistenceSchemaVersions): void {
  assertSupported(value, versions.batch);
  const batch = recordOf(value);
  if (batch) preflightTemplate(batch.templateSnapshot, versions);
}

function migrateBatch(value: unknown, versions: PersistenceSchemaVersions): StateMigrationResult {
  const batch = recordOf(value);
  if (!batch || schemaVersionOf(batch) !== 1 || versions.batch === 1) return { value, migrated: false };
  return { value: { ...batch, schemaVersion: versions.batch }, migrated: true };
}

/**
 * Converts the known project v1 envelope and its export-batch envelopes.
 * Frozen templates deliberately retain their own schema version and render data.
 */
export function migrateProjectState(value: unknown, versions: PersistenceSchemaVersions): StateMigrationResult {
  assertSupported(value, versions.project);
  const project = recordOf(value);
  if (!project) return { value, migrated: false };

  const batches = Array.isArray(project.exportBatches) ? project.exportBatches : undefined;
  for (const batch of batches ?? []) preflightBatch(batch, versions);
  for (const template of Array.isArray(project.templates) ? project.templates : []) preflightTemplate(template, versions);

  let migrated = false;
  const migratedBatches = batches?.map((batch) => {
    const result = migrateBatch(batch, versions);
    migrated ||= result.migrated;
    return result.value;
  });
  const version = schemaVersionOf(project);
  const nextProject = version === 1 && versions.project !== 1
    ? { ...project, schemaVersion: versions.project }
    : project;
  migrated ||= nextProject !== project;
  return { value: migrated ? { ...nextProject, ...(migratedBatches ? { exportBatches: migratedBatches } : {}) } : project, migrated };
}

/** Converts the known standalone queue job v1 envelope and its nested batch. */
export function migrateQueueState(value: unknown, versions: PersistenceSchemaVersions): StateMigrationResult {
  assertSupported(value, versions.queue);
  const state = recordOf(value);
  if (!state) return { value, migrated: false };
  preflightBatch(state.batch, versions);

  const batch = migrateBatch(state.batch, versions);
  const version = schemaVersionOf(state);
  const nextState = version === 1 && versions.queue !== 1
    ? { ...state, schemaVersion: versions.queue }
    : state;
  const migrated = batch.migrated || nextState !== state;
  return { value: migrated ? { ...nextState, ...(batch.migrated ? { batch: batch.value } : {}) } : state, migrated };
}
