import { afterEach, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DouyinUploadStore } from "../src/main/douyin-upload-store";
import { closureFixture } from "./helpers/douyin-closure";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() { const f = await closureFixture(); roots.push(f.root); return f; }

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

it("rejects incomplete intents, active members and closure sync failure without committing closure", async () => {
  const f = await fixture(), raw = JSON.parse(await readFile(path.join(f.root, "state.json"), "utf8"));
  const missing = f.tasks.find(task => task.result.upload_outcome === "NOT_SELECTED")!;
  raw.tasks = raw.tasks.filter((task: typeof f.tasks[number]) => task.result.upload_task_id !== missing.result.upload_task_id);
  raw.intents = raw.intents.filter((intent: { export_task_id: string }) => intent.export_task_id !== missing.input.export_task_id);
  await writeFile(path.join(f.root, "state.json"), JSON.stringify(raw), { mode: 0o600 });
  const partial = new DouyinUploadStore(f.root); await partial.load(); expect(partial.canCloseBatch(f.id)).toBe(false); await expect(partial.closeBatch(f.id)).rejects.toThrow();
  const g = await fixture(), pending = g.store.tasks().find(task => task.result.upload_outcome === "NOT_SELECTED")!;
  pending.result.state = "CONNECTING_BROWSER"; await g.store.saveTask(pending); await expect(g.store.closeBatch(g.id)).rejects.toThrow();
  pending.result.state = "PENDING"; await g.store.saveTask(pending);
  const before = await readFile(path.join(g.root, "state.json"));
  const broken = new DouyinUploadStore(g.root, { syncDirectory: async () => { throw new Error("sync failure"); } }); await broken.load();
  await expect(broken.closeBatch(g.id)).rejects.toThrow(); expect(broken.unavailable).toBe(true);
  expect(await readFile(path.join(g.root, "state.json"))).toEqual(before); expect(broken.hasMarker(g.id)).toBe(true);
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
