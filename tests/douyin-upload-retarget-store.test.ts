import { mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DouyinUploadStore, frozenInputDigest, uploadTaskId, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { QianchuanUploadConfigSchema, UploadAuthorizationSchema, uploadFailure, type UploadAuthorization } from "../src/shared/douyin-upload";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function authorization(overrides: Partial<UploadAuthorization> = {}): UploadAuthorization {
  return UploadAuthorizationSchema.parse({
    target: { product: "眼贴", cdpEndpoint: "http://127.0.0.1:9225", advertiserId: "123456", adId: "700", configDigest: "a".repeat(64) },
    pageBatchId: crypto.randomUUID(), expectedCount: 2, ...overrides,
  });
}

function makeBatch(oldAuthorization = authorization(), resultOverrides: Partial<UploadTaskRecord["result"]>[] = []): UploadTaskRecord[] {
  const config = QianchuanUploadConfigSchema.parse({}), projectId = crypto.randomUUID(), batchId = crypto.randomUUID();
  return Array.from({ length: oldAuthorization.expectedCount }, (_, index) => {
    const input = { project_id: projectId, batch_id: batchId, export_task_id: crypto.randomUUID(), video_path: `/tmp/retarget-${index}.mp4`, artifact_sha256: String(index + 1).repeat(64), size_bytes: 10 };
    const intentAuth = structuredClone(oldAuthorization);
    const id = uploadTaskId(input, intentAuth.target);
    return {
      input, inputDigest: frozenInputDigest(input, intentAuth), authorization: intentAuth, config, snapshotPath: `/tmp/snapshot-${index}.mp4`,
      result: {
        project_id: projectId, batch_id: batchId, export_task_id: input.export_task_id, upload_task_id: id, artifact_sha256: input.artifact_sha256,
        file_name: path.basename(input.video_path), accountProduct: intentAuth.target.product, advertiserId: intentAuth.target.advertiserId, adId: intentAuth.target.adId,
        state: "PENDING", upload_outcome: "NOT_SELECTED", retryable: false, retry_count: 0, attempt_count: 0, timestamp: new Date().toISOString(),
        ...resultOverrides[index],
      },
    } as UploadTaskRecord;
  });
}

async function fixture(tasks = makeBatch(), durability?: { syncDirectory?: (directory: string) => Promise<void> }) {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-retarget-")); roots.push(root);
  for (const task of tasks) {
    task.snapshotPath = path.join(root, `snapshot-${task.result.export_task_id}.mp4`);
    await writeFile(task.snapshotPath, `snapshot:${task.result.export_task_id}`);
  }
  const store = new DouyinUploadStore(root, durability); await store.load();
  for (const task of tasks) {
    await store.saveIntents([{ project_id: task.input.project_id, batch_id: task.input.batch_id, export_task_id: task.input.export_task_id, selection: { enabled: true, accountProduct: task.authorization.target.product }, config: task.config, authorization: task.authorization }]);
    await store.saveTask(task);
  }
  return { root, store, tasks };
}

function newAuthorization(old: UploadAuthorization): UploadAuthorization {
  return UploadAuthorizationSchema.parse({ ...old, target: { ...old.target, adId: "701", configDigest: "b".repeat(64) }, pageBatchId: crypto.randomUUID() });
}

describe("explicit Qianchuan batch retargeting", () => {
  it("moves a complete untouched batch atomically, keeps snapshots and counters, and retains exact original history across reload", async () => {
    const batch = makeBatch(authorization(), [
      { retry_count: 2, attempt_count: 3, state: "FAILED_RETRYABLE", retryable: true },
      { retry_count: 1, attempt_count: 1 },
    ]);
    const { root, store } = await fixture(batch), target = newAuthorization(batch[0].authorization), beforeIntents = store.intents().filter(value => value.authorization.pageBatchId === batch[0].authorization.pageBatchId);
    const beforeTasks = batch.map(task => store.task(task.result.upload_task_id)!);
    const archivePath = path.join(root, "retarget-history", `${batch[0].authorization.pageBatchId}.json`);
    const moved = await store.retargetBatch(batch[0].result.upload_task_id, target, async () => {
      expect(JSON.parse(await readFile(archivePath, "utf8"))).toMatchObject({ version: 1, intents: beforeIntents, tasks: beforeTasks, newAuthorization: target });
    });

    expect(moved).toHaveLength(2);
    expect(moved.map(task => task.authorization.pageBatchId)).toEqual([target.pageBatchId, target.pageBatchId]);
    for (let index = 0; index < moved.length; index++) {
      const original = beforeTasks[index], next = moved[index];
      expect(next.result.upload_task_id).not.toBe(original.result.upload_task_id);
      expect(next.result.upload_task_id).toBe(uploadTaskId(original.input, target.target));
      expect(next).toMatchObject({ input: original.input, config: original.config, snapshotPath: original.snapshotPath, result: {
        state: "PENDING", upload_outcome: "NOT_SELECTED", retryable: false, retry_count: original.result.retry_count, attempt_count: original.result.attempt_count,
        advertiserId: target.target.advertiserId, adId: target.target.adId, accountProduct: target.target.product,
      } });
      expect(next.inputDigest).toBe(frozenInputDigest(original.input, target));
      expect(next.result.failure).toBeUndefined(); expect(next.result.readyEvidence).toBeUndefined();
      expect(await readFile(next.snapshotPath)).toEqual(Buffer.from(`snapshot:${original.result.export_task_id}`));
    }
    const archiveBytes = await readFile(archivePath), archiveInfo = await stat(archivePath), directoryInfo = await stat(path.dirname(archivePath));
    expect(archiveInfo.mode & 0o777).toBe(0o600); expect(directoryInfo.mode & 0o777).toBe(0o700);
    const reopened = new DouyinUploadStore(root); await reopened.load();
    expect(reopened.tasks()).toEqual(moved); expect(await readFile(archivePath)).toEqual(archiveBytes);
  });

  it("rejects a partial page batch before creating history", async () => {
    const full = makeBatch(), partial = full.slice(0, 1), { root, store } = await fixture(partial);
    await expect(store.retargetBatch(partial[0].result.upload_task_id, newAuthorization(partial[0].authorization))).rejects.toThrow();
    expect(await readdir(root)).not.toContain("retarget-history"); expect(store.unavailable).toBe(false);
  });

  it("rejects a fenced batch and leaves its permanent fence and ledger target intact", async () => {
    const tasksWithAttempt = makeBatch(authorization(), [{ attempt_count: 1 }, {}]), { root, store, tasks } = await fixture(tasksWithAttempt);
    await store.markSelecting(tasks[0].result.upload_task_id, { targetId: "fixture-target", pageBatchId: tasks[0].authorization.pageBatchId, modalSessionId: crypto.randomUUID() }, 1);
    await expect(store.retargetBatch(tasks[1].result.upload_task_id, newAuthorization(tasks[0].authorization))).rejects.toThrow();
    expect(store.unavailable).toBe(false); expect(store.hasMarker(tasks[0].result.upload_task_id)).toBe(true);
    expect(store.task(tasks[1].result.upload_task_id)?.authorization).toEqual(tasks[1].authorization);
  });

  it("rejects cancelled tasks, duplicate aliases, cross-account targets, and destination task collisions without writing history", async () => {
    const cancelled = makeBatch(authorization(), [{ state: "CANCELLED", failure: uploadFailure("STOPPED", "cancel", "stopped", "inspect", false).failure }]);
    const cancelledFixture = await fixture(cancelled);
    await expect(cancelledFixture.store.retargetBatch(cancelled[0].result.upload_task_id, newAuthorization(cancelled[0].authorization))).rejects.toThrow();
    expect(await readdir(cancelledFixture.root)).not.toContain("retarget-history");

    const old = authorization({ expectedCount: 1 }), aliased = makeBatch(old), aliasFixture = await fixture([]);
    const selected = makeBatch(UploadAuthorizationSchema.parse({ ...old, pageBatchId: crypto.randomUUID() }))[0];
    selected.input = { ...aliased[0].input, project_id: crypto.randomUUID(), batch_id: crypto.randomUUID(), export_task_id: crypto.randomUUID() };
    selected.inputDigest = frozenInputDigest(selected.input, selected.authorization); selected.result = { ...selected.result,
      project_id: selected.input.project_id, batch_id: selected.input.batch_id, export_task_id: selected.input.export_task_id,
      upload_task_id: uploadTaskId(selected.input, selected.authorization.target), artifact_sha256: selected.input.artifact_sha256, file_name: path.basename(selected.input.video_path), attempt_count: 1 };
    const selectedIntent = { project_id: selected.input.project_id, batch_id: selected.input.batch_id, export_task_id: selected.input.export_task_id, selection: { enabled: true as const, accountProduct: old.target.product }, config: selected.config, authorization: selected.authorization };
    await aliasFixture.store.saveIntents([selectedIntent]); await aliasFixture.store.saveTask(selected);
    await aliasFixture.store.markSelecting(selected.result.upload_task_id, { targetId: "fixture-target", pageBatchId: selected.authorization.pageBatchId, modalSessionId: crypto.randomUUID() }, 1);
    aliased[0].result = { ...aliased[0].result, state: "NEEDS_HUMAN", upload_outcome: "NOT_SELECTED", duplicate_of: selected.result.upload_task_id };
    await aliasFixture.store.saveIntents([{ project_id: aliased[0].input.project_id, batch_id: aliased[0].input.batch_id, export_task_id: aliased[0].input.export_task_id, selection: { enabled: true, accountProduct: old.target.product }, config: aliased[0].config, authorization: old }]);
    await aliasFixture.store.saveTask(aliased[0]);
    await expect(aliasFixture.store.retargetBatch(aliased[0].result.upload_task_id, newAuthorization(old))).rejects.toThrow();
    expect(await readdir(aliasFixture.root)).not.toContain("retarget-history");

    const base = authorization({ expectedCount: 1 }), crossAccount = makeBatch(base), crossFixture = await fixture(crossAccount);
    const foreign = UploadAuthorizationSchema.parse({ ...newAuthorization(base), target: { ...base.target, advertiserId: "999", adId: "701" } });
    await expect(crossFixture.store.retargetBatch(crossAccount[0].result.upload_task_id, foreign)).rejects.toThrow();
    expect(await readdir(crossFixture.root)).not.toContain("retarget-history");

    const collisionBatch = makeBatch(base), collisionFixture = await fixture(collisionBatch), target = newAuthorization(base);
    const existing = makeBatch(target)[0]; existing.input.artifact_sha256 = collisionBatch[0].input.artifact_sha256;
    existing.inputDigest = frozenInputDigest(existing.input, target); existing.result.artifact_sha256 = existing.input.artifact_sha256;
    existing.result.upload_task_id = uploadTaskId(existing.input, target.target);
    await collisionFixture.store.saveIntents([{ project_id: existing.input.project_id, batch_id: existing.input.batch_id, export_task_id: existing.input.export_task_id, selection: { enabled: true, accountProduct: existing.authorization.target.product }, config: existing.config, authorization: target }]);
    await collisionFixture.store.saveTask(existing);
    await expect(collisionFixture.store.retargetBatch(collisionBatch[0].result.upload_task_id, target)).rejects.toThrow();
    expect(await readdir(collisionFixture.root)).not.toContain("retarget-history");

    const repeated = makeBatch(authorization());
    repeated[1].input.artifact_sha256 = repeated[0].input.artifact_sha256; repeated[1].inputDigest = frozenInputDigest(repeated[1].input, repeated[1].authorization);
    repeated[1].result.artifact_sha256 = repeated[1].input.artifact_sha256; repeated[1].result.upload_task_id = uploadTaskId(repeated[1].input, repeated[1].authorization.target);
    const repeatedFixture = await fixture(repeated);
    const refreshed = new DouyinUploadStore(repeatedFixture.root); await refreshed.load();
    expect(refreshed.tasks().map(task => task.input.artifact_sha256)).toEqual([repeated[0].input.artifact_sha256, repeated[0].input.artifact_sha256]);
    await expect(refreshed.retargetBatch(repeated[0].result.upload_task_id, newAuthorization(repeated[0].authorization))).rejects.toThrow();
    expect(await readdir(repeatedFixture.root)).not.toContain("retarget-history");
  });

  it("fails closed if the retained archive cannot be synced", async () => {
    const tasks = makeBatch(), initial = await fixture(tasks), stateBefore = await readFile(path.join(initial.root, "state.json"));
    const failing = new DouyinUploadStore(initial.root, { syncDirectory: async directory => { if (directory.endsWith("retarget-history")) throw new Error("archive directory fsync failed"); } });
    await failing.load();
    await expect(failing.retargetBatch(tasks[0].result.upload_task_id, newAuthorization(tasks[0].authorization))).rejects.toMatchObject({ failure: { code: "STORE_UNAVAILABLE" } });
    expect(failing.unavailable).toBe(true); expect(await readFile(path.join(initial.root, "state.json"))).toEqual(stateBefore);
    expect(JSON.parse(await readFile(path.join(initial.root, "retarget-history", `${tasks[0].authorization.pageBatchId}.json`), "utf8"))).toHaveProperty("version", 1);
  });

  it("resumes only the same durable archive after a pre-commit validation refusal", async () => {
    const tasks = makeBatch(), archiveSyncs: string[] = [], initial = await fixture(tasks, { syncDirectory: async directory => { archiveSyncs.push(directory); } });
    const target = newAuthorization(tasks[0].authorization);
    await expect(initial.store.retargetBatch(tasks[0].result.upload_task_id, target, async () => { throw new Error("mapping changed"); })).rejects.toThrow("mapping changed");
    expect(initial.store.unavailable).toBe(false); expect(initial.store.task(tasks[0].result.upload_task_id)?.authorization).toEqual(tasks[0].authorization);
    const moved = await initial.store.retargetBatch(tasks[0].result.upload_task_id, target);
    expect(moved).toHaveLength(2); expect(archiveSyncs).toEqual([path.join(initial.root, "retarget-history"), path.join(initial.root, "retarget-history")]);
  });

  it("blocks a conflicting archive and treats retarget history without a ledger as corruption", async () => {
    const tasks = makeBatch(), initial = await fixture(tasks), target = newAuthorization(tasks[0].authorization);
    await expect(initial.store.retargetBatch(tasks[0].result.upload_task_id, target, async () => { throw new Error("mapping changed"); })).rejects.toThrow("mapping changed");
    const changedTarget = UploadAuthorizationSchema.parse({ ...target, target: { ...target.target, adId: "702" }, pageBatchId: crypto.randomUUID() });
    await expect(initial.store.retargetBatch(tasks[0].result.upload_task_id, changedTarget)).rejects.toMatchObject({ failure: { code: "STORE_UNAVAILABLE" } });
    expect(initial.store.unavailable).toBe(true);

    const other = await fixture(); await mkdir(path.join(other.root, "retarget-history"), { mode: 0o700 }); await unlink(path.join(other.root, "state.json"));
    await expect(new DouyinUploadStore(other.root).load()).rejects.toThrow();
  });
});
