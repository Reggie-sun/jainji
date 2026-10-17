import { afterEach, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DouyinUploadStore, frozenInputDigest, uploadTaskId } from "../src/main/douyin-upload-store";
import { closureFixture } from "./helpers/douyin-closure";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() { const f = await closureFixture(); roots.push(f.root); return f; }

async function acceptedBatch(f: Awaited<ReturnType<typeof fixture>>, count = 2) {
  const tasks = await f.batch(count), pageOwnership = { targetId: randomUUID(), pageBatchId: tasks[0]!.authorization.pageBatchId, modalSessionId: randomUUID() };
  await f.store.markSelecting(tasks.map(task => task.result.upload_task_id), pageOwnership, 1);
  const ready = tasks.map(task => ({ ...f.store.task(task.result.upload_task_id)!, result: { ...f.store.task(task.result.upload_task_id)!.result,
    state: "WAITING_FOR_CONFIRMATION" as const, upload_outcome: "READY" as const,
    readyEvidence: { advertiserId: "123", adId: "456", fileName: task.result.file_name, selectedCount: count, observedAt: new Date().toISOString(), pageOwnership } } }));
  await f.store.saveTasks(ready);
  const handle = f.store.beginAutomationAcceptance(ready);
  await f.store.saveTasks(ready.map(task => ({ ...task, result: { ...task.result, state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", readyEvidence: undefined } })));
  await f.store.acceptAutomation(handle, ready.map((task, index) => ({ ...task.result.readyEvidence, platformVideoId: String(9000 + index),
    attempt: task.result.attempt_count, requestSha256: "a".repeat(64), responseSha256: "b".repeat(64) })));
  return tasks[0]!.authorization.pageBatchId;
}

it("automatically archives only complete accepted batches, preserving original records, fences and restart protection", async () => {
  const f = await fixture(), pageBatchId = await acceptedBatch(f), before = f.store.tasks(), intents = f.store.intents();
  const ids = before.filter(task => task.authorization.pageBatchId === pageBatchId).map(task => task.result.upload_task_id);
  const fences = await Promise.all(ids.map(id => readFile(path.join(f.root, "selection-fences", `${id}.json`))));
  await f.store.closeAcceptedBatches();
  expect(f.store.closedBatches().map(batch => batch.pageBatchId)).toEqual([pageBatchId]);
  expect(f.store.isClosed(f.tasks[0]!.authorization.pageBatchId)).toBe(false);
  expect(f.store.tasks()).toEqual(before); expect(f.store.intents()).toEqual(intents);
  expect(await Promise.all(ids.map(id => readFile(path.join(f.root, "selection-fences", `${id}.json`))))).toEqual(fences);
  await f.store.closeAcceptedBatches();
  expect(f.store.closedBatches()).toHaveLength(1);
  const restored = new DouyinUploadStore(f.root); await restored.load();
  expect(restored.tasks()).toEqual(before); expect(restored.closedBatches()).toEqual(f.store.closedBatches());
  await expect(restored.saveTask(restored.task(ids[0]!)!)).rejects.toThrow(/已结束/);
});

it("vetoes automatic closure after control changes and rejects incomplete accepted history on restart", async () => {
  const f = await fixture(), pageBatchId = await acceptedBatch(f);
  await expect(f.store.closeAcceptedBatches(async () => { throw Error("control changed"); })).rejects.toThrow("control changed");
  expect(f.store.closedBatches()).toEqual([]);
  const statePath = path.join(f.root, "state.json"), raw = JSON.parse(await readFile(statePath, "utf8"));
  const missing = raw.tasks.find((task: typeof f.tasks[number]) => task.authorization.pageBatchId === pageBatchId);
  raw.tasks = raw.tasks.filter((task: typeof f.tasks[number]) => task.result.upload_task_id !== missing.result.upload_task_id);
  await writeFile(statePath, JSON.stringify(raw), { mode: 0o600 });
  // A missing admitted task must also lack a fence; otherwise the existing loader rejects the ledger.
  await rm(path.join(f.root, "selection-fences", `${missing.result.upload_task_id}.json`));
  const partial = new DouyinUploadStore(f.root);
  await expect(partial.load()).rejects.toMatchObject({ failure: { code: "STORE_UNAVAILABLE" } });
  expect(partial.unavailable).toBe(true);
  expect(JSON.parse(await readFile(statePath, "utf8")).closedBatches).toEqual([]);
});

it("fails closed if automatic archival cannot sync, retaining accepted results and every selection fence", async () => {
  const f = await fixture(), pageBatchId = await acceptedBatch(f), statePath = path.join(f.root, "state.json"), before = await readFile(statePath);
  const broken = new DouyinUploadStore(f.root, { syncDirectory: async () => { throw Error("archive sync failure"); } }); await broken.load();
  await expect(broken.closeAcceptedBatches()).rejects.toMatchObject({ failure: { code: "STORE_UNAVAILABLE" } });
  expect(broken.unavailable).toBe(true); expect(broken.isClosed(pageBatchId)).toBe(false);
  expect(await readFile(statePath)).toEqual(before);
  for (const task of f.store.tasks().filter(task => task.authorization.pageBatchId === pageBatchId)) {
    expect(broken.task(task.result.upload_task_id)?.result.upload_outcome).toBe("ACCEPTED");
    expect(broken.fence(task.result.upload_task_id)).toEqual(f.store.fence(task.result.upload_task_id));
  }
});

it("closes a complete READY/UNKNOWN/PENDING batch without changing records or fences, and survives restart", async () => {
  const f = await fixture(), before = f.store.tasks(), intents = f.store.intents();
  const fences = await Promise.all([f.id, f.unknownId].map(id => readFile(path.join(f.root, "selection-fences", `${id}.json`))));
  await f.store.closeBatch(f.id);
  expect(f.store.tasks()).toEqual(before); expect(f.store.intents()).toEqual(intents);
  const closure = f.store.closedBatches()[0]!;
  expect(closure.taskIds).toEqual(before.map(task => task.result.upload_task_id).sort());
  expect(closure).not.toHaveProperty("admittedCount");
  const bytes = await readFile(path.join(f.root, "batch-closure-history", `${closure.pageBatchId}.json`));
  expect(closure.archiveSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(JSON.parse(bytes.toString()).tasks).toEqual(before);
  const restored = new DouyinUploadStore(f.root); await restored.load();
  expect(restored.closedBatches()).toEqual([closure]); expect(restored.tasks()).toEqual(before);
  expect(await Promise.all([f.id, f.unknownId].map(id => readFile(path.join(f.root, "selection-fences", `${id}.json`))))).toEqual(fences);
  await expect(restored.closeBatch(f.id)).rejects.toThrow();
  const pending = before.find(task => task.result.upload_outcome === "NOT_SELECTED")!;
  await expect(restored.saveTask(pending)).rejects.toThrow(/已结束/);
  await expect(restored.discardBatch(f.id)).rejects.toThrow(/已结束/);
  await expect(restored.retargetBatch(f.id, { ...before[0]!.authorization, pageBatchId: randomUUID() })).rejects.toThrow(/已结束/);
  await expect(restored.markSelecting(pending.result.upload_task_id, { ...restored.fence(f.id)!.pageOwnership }, 3)).rejects.toThrow();
});

it("closes a partial admission when all frozen intents exist and preserves archived intents, actual tasks and fences", async () => {
  const f = await fixture(), originalTasks = f.store.tasks(), originalIntents = f.store.intents();
  const missing = originalTasks.find(task => task.result.upload_outcome === "NOT_SELECTED")!;
  const raw = JSON.parse(await readFile(path.join(f.root, "state.json"), "utf8"));
  raw.tasks = raw.tasks.filter((task: typeof f.tasks[number]) => task.result.upload_task_id !== missing.result.upload_task_id);
  await writeFile(path.join(f.root, "state.json"), JSON.stringify(raw), { mode: 0o600 });
  const partial = new DouyinUploadStore(f.root); await partial.load();
  const admitted = partial.tasks(), fenced = admitted.filter(task => partial.hasMarker(task.result.upload_task_id));
  const fencesBefore = await Promise.all(fenced.map(task => readFile(path.join(f.root, "selection-fences", `${task.result.upload_task_id}.json`))));
  expect(admitted).toHaveLength(2); expect(partial.intents()).toEqual(originalIntents);
  await partial.closeBatch(admitted[0]!.result.upload_task_id);
  expect(partial.tasks()).toEqual(admitted); expect(partial.intents()).toEqual(originalIntents);
  const closed = partial.closedBatches()[0]!;
  expect(closed).toMatchObject({ expectedCount: 3, admittedCount: 2, taskIds: admitted.map(task => task.result.upload_task_id).sort() });
  const bytes = await readFile(path.join(f.root, "batch-closure-history", `${closed.pageBatchId}.json`));
  expect(closed.archiveSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(JSON.parse(bytes.toString())).toEqual({ version: 1, action: "close-batch", intents: originalIntents, tasks: admitted });
  expect(await Promise.all(fenced.map(task => readFile(path.join(f.root, "selection-fences", `${task.result.upload_task_id}.json`))))).toEqual(fencesBefore);
  const restored = new DouyinUploadStore(f.root); await restored.load();
  expect(restored.closedBatches()).toEqual([closed]); expect(restored.tasks()).toEqual(admitted); expect(restored.intents()).toEqual(originalIntents);
  await expect(restored.saveTask(missing)).rejects.toThrow(/已结束/);
  await expect(restored.saveIntents([originalIntents.find(intent => intent.export_task_id === missing.input.export_task_id)!])).rejects.toThrow(/已结束/);
  await expect(restored.markSelecting(missing.result.upload_task_id, { targetId: "late", pageBatchId: closed.pageBatchId, modalSessionId: randomUUID() }, 3)).rejects.toThrow();
  const statePath = path.join(f.root, "state.json");
  for (const mutate of [
    (record: Record<string, unknown>) => { record.admittedCount = 1; },
    (record: Record<string, unknown>) => { delete record.admittedCount; },
  ]) {
    const corrupted = JSON.parse(await readFile(statePath, "utf8")); mutate(corrupted.closedBatches[0]);
    await writeFile(statePath, JSON.stringify(corrupted), { mode: 0o600 });
    await expect(new DouyinUploadStore(f.root).load()).rejects.toMatchObject({ failure: { code: "STORE_UNAVAILABLE" } });
  }
});

it("upgrades a validated v2 ledger with empty closures and unchanged identities/fences", async () => {
  const f = await fixture(), raw = JSON.parse(await readFile(path.join(f.root, "state.json"), "utf8"));
  raw.version = 2; delete raw.closedBatches;
  await writeFile(path.join(f.root, "state.json"), JSON.stringify(raw), { mode: 0o600 });
  const restored = new DouyinUploadStore(f.root); await restored.load();
  expect(restored.closedBatches()).toEqual([]); expect(restored.tasks()).toEqual(f.store.tasks());
  expect(JSON.parse(await readFile(path.join(f.root, "state.json"), "utf8")).version).toBe(3);
});

it("closes legacy partially registered intents without inventing members or restoring late admission", async () => {
  const f = await fixture(), raw = JSON.parse(await readFile(path.join(f.root, "state.json"), "utf8"));
  const missing = f.tasks.find(task => task.result.upload_outcome === "NOT_SELECTED")!;
  raw.tasks = raw.tasks.filter((task: typeof f.tasks[number]) => task.result.upload_task_id !== missing.result.upload_task_id);
  raw.intents = raw.intents.filter((intent: { export_task_id: string }) => intent.export_task_id !== missing.input.export_task_id);
  await writeFile(path.join(f.root, "state.json"), JSON.stringify(raw), { mode: 0o600 });
  const partial = new DouyinUploadStore(f.root); await partial.load();
  const tasks = partial.tasks(), intents = partial.intents();
  const fences = await Promise.all([f.id, f.unknownId].map(id => readFile(path.join(f.root, "selection-fences", `${id}.json`))));
  expect(partial.canCloseBatch(tasks[0]!.authorization.pageBatchId)).toBe(true); await partial.closeBatch(f.id);
  const closure = partial.closedBatches()[0]!;
  expect(closure).toMatchObject({ expectedCount: 3, admittedCount: 2, registeredIntentCount: 2 });
  expect(partial.tasks()).toEqual(tasks); expect(partial.intents()).toEqual(intents);
  const restored = new DouyinUploadStore(f.root); await restored.load();
  expect(restored.tasks()).toEqual(tasks); expect(restored.intents()).toEqual(intents);
  expect(restored.closedBatches()).toEqual([closure]);
  await expect(restored.saveTask(missing)).rejects.toThrow(/已结束/);
  await expect(restored.saveIntents([f.store.intents().find(intent => intent.export_task_id === missing.input.export_task_id)!])).rejects.toThrow(/已结束/);
  await expect(restored.markSelecting(f.id, restored.fence(f.id)!.pageOwnership, 3)).rejects.toThrow();
  expect(await Promise.all([f.id, f.unknownId].map(id => readFile(path.join(f.root, "selection-fences", `${id}.json`))))).toEqual(fences);
  const statePath = path.join(f.root, "state.json"), closedState = JSON.parse(await readFile(statePath, "utf8"));
  for (const count of [undefined, 1, 3]) {
    const corrupted = structuredClone(closedState); corrupted.closedBatches[0].registeredIntentCount = count;
    await writeFile(statePath, JSON.stringify(corrupted), { mode: 0o600 });
    await expect(new DouyinUploadStore(f.root).load()).rejects.toMatchObject({ failure: { code: "STORE_UNAVAILABLE" } });
  }
});

it("rejects an orphan task whose intent is missing, active members and uncertain closure sync", async () => {
  const f = await fixture(), raw = JSON.parse(await readFile(path.join(f.root, "state.json"), "utf8"));
  raw.intents = raw.intents.slice(1);
  await writeFile(path.join(f.root, "state.json"), JSON.stringify(raw), { mode: 0o600 });
  await expect(new DouyinUploadStore(f.root).load()).rejects.toMatchObject({ failure: { code: "STORE_UNAVAILABLE" } });
  const g = await fixture(), pending = g.store.tasks().find(task => task.result.upload_outcome === "NOT_SELECTED")!;
  pending.result.state = "CONNECTING_BROWSER"; await g.store.saveTask(pending); await expect(g.store.closeBatch(g.id)).rejects.toThrow();
  pending.result.state = "PENDING"; await g.store.saveTask(pending);
  const before = await readFile(path.join(g.root, "state.json"));
  const broken = new DouyinUploadStore(g.root, { syncDirectory: async () => { throw new Error("sync failure"); } }); await broken.load();
  await expect(broken.closeBatch(g.id)).rejects.toThrow(); expect(broken.unavailable).toBe(true);
  expect(await readFile(path.join(g.root, "state.json"))).toEqual(before); expect(broken.hasMarker(g.id)).toBe(true);
});

it("closes an alias only after its original batch is closed, preserving both batches and the original fence", async () => {
  const f = await fixture(), original = f.store.task(f.id)!, candidates = await f.batch();
  const alias = structuredClone(candidates[0]!);
  alias.input.artifact_sha256 = original.input.artifact_sha256;
  alias.inputDigest = frozenInputDigest(alias.input, alias.authorization);
  alias.result = { ...alias.result, state: original.result.state, upload_outcome: original.result.upload_outcome,
    artifact_sha256: alias.input.artifact_sha256, upload_task_id: uploadTaskId(alias.input, alias.authorization.target),
    duplicate_of: f.id, readyEvidence: original.result.readyEvidence };
  const raw = JSON.parse(await readFile(path.join(f.root, "state.json"), "utf8"));
  raw.tasks = raw.tasks.map((task: typeof alias) => task.result.upload_task_id === candidates[0]!.result.upload_task_id ? alias : task);
  await writeFile(path.join(f.root, "state.json"), JSON.stringify(raw), { mode: 0o600 });
  const restored = new DouyinUploadStore(f.root); await restored.load();
  const before = restored.tasks(), intents = restored.intents(), fence = await readFile(path.join(f.root, "selection-fences", `${f.id}.json`));
  expect(restored.canCloseBatch(alias.authorization.pageBatchId)).toBe(false);
  await expect(restored.closeBatch(alias.result.upload_task_id)).rejects.toThrow();
  await restored.closeBatch(f.id); await restored.closeBatch(alias.result.upload_task_id);
  expect(restored.tasks()).toEqual(before); expect(restored.intents()).toEqual(intents);
  expect(await readFile(path.join(f.root, "selection-fences", `${f.id}.json`))).toEqual(fence);
  const reloaded = new DouyinUploadStore(f.root); await reloaded.load();
  expect(reloaded.closedBatches()).toEqual(restored.closedBatches()); expect(reloaded.tasks()).toEqual(before);
  await expect(reloaded.saveTask(original)).rejects.toThrow(/已结束/);
  await expect(reloaded.saveTask(alias)).rejects.toThrow(/已结束/);
});

it("vetoed closure remains unclosed; a missing or altered referenced audit blocks load and later writes", async () => {
  const f = await fixture(), before = await readFile(path.join(f.root, "state.json"));
  await expect(f.store.closeBatch(f.id, async () => { throw new Error("control changed"); })).rejects.toThrow(/control changed/);
  expect(await readFile(path.join(f.root, "state.json"))).toEqual(before);
  await f.store.closeBatch(f.id);
  const file = path.join(f.root, "batch-closure-history", `${f.store.closedBatches()[0]!.pageBatchId}.json`);
  await writeFile(file, "{}", { mode: 0o600 });
  const restored = new DouyinUploadStore(f.root); await expect(restored.load()).rejects.toMatchObject({ failure: { code: "STORE_UNAVAILABLE" } });
  await expect(f.store.setConfig(f.store.config)).rejects.toThrow(); expect(f.store.unavailable).toBe(true);
});
