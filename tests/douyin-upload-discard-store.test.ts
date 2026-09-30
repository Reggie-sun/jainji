import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DouyinUploadStore, frozenInputDigest, uploadTaskId } from "../src/main/douyin-upload-store.js";
import { QianchuanUploadConfigSchema, uploadFailure, type UploadAuthorization } from "../src/shared/douyin-upload.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(count = 60) {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-abandon-")); roots.push(root);
  const store = new DouyinUploadStore(root); await store.load();
  const project_id = randomUUID(), batch_id = randomUUID();
  const authorization: UploadAuthorization = { target: { product: "蝴蝶贴", cdpEndpoint: "http://127.0.0.1:9222", advertiserId: "1876024170199244", adId: "1876036593854788", configDigest: "a".repeat(64) }, pageBatchId: randomUUID(), expectedCount: count };
  const config = QianchuanUploadConfigSchema.parse({ enabled: true });
  for (let index = 0; index < count; index++) {
    const input = { project_id, batch_id, export_task_id: randomUUID(), video_path: `/tmp/abandon-${index}.mp4`, artifact_sha256: createHash("sha256").update(String(index)).digest("hex"), size_bytes: 10 };
    const task = { input, inputDigest: frozenInputDigest(input, authorization), authorization, config, snapshotPath: `/tmp/snapshot-${index}.mp4`, result: {
      project_id, batch_id, export_task_id: input.export_task_id, artifact_sha256: input.artifact_sha256, upload_task_id: uploadTaskId(input, authorization.target), file_name: path.basename(input.video_path), accountProduct: authorization.target.product,
      advertiserId: authorization.target.advertiserId, adId: authorization.target.adId, state: "PENDING" as const, upload_outcome: "NOT_SELECTED" as const,
      retryable: false, retry_count: 0, attempt_count: index === 0 ? 1 : 0, timestamp: new Date().toISOString(),
    } };
    await store.saveIntents([{ project_id, batch_id, export_task_id: input.export_task_id, selection: { enabled: true, accountProduct: "蝴蝶贴" }, authorization, config }]);
    await store.saveTask(task);
  }
  const [selected, blocked] = store.tasks();
  await store.markSelecting(selected!.result.upload_task_id, { targetId: "original-tab", pageBatchId: authorization.pageBatchId, modalSessionId: randomUUID() }, 1);
  const unknown = store.task(selected!.result.upload_task_id)!; unknown.result.state = "NEEDS_HUMAN"; unknown.result.failure = uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "具体原页面错误", "核查原页", true).failure; await store.saveTask(unknown);
  const failed = store.task(blocked!.result.upload_task_id)!;
  failed.result = { ...failed.result, state: "NEEDS_HUMAN", failure: { category: "page", code: "PAGE_CONTRACT_CHANGED", message: "原页面不可核查", next_action: "人工核查", requires_human: true, retryable: false } };
  await store.saveTask(failed);
  return { root, store, authorization, selected: selected!.result.upload_task_id, blocked: blocked!.result.upload_task_id };
}

describe("explicit deletion of an unknown Qianchuan batch", () => {
  it("preserves existing unknown diagnostics when loading another batch for deletion", async () => {
    const f = await fixture(3), before = f.store.tasks();
    const reopened = new DouyinUploadStore(f.root); await reopened.load();
    expect(reopened.tasks()).toEqual(before);
  });
  it("discards all 60 tasks while preserving outcomes and fence bytes across restart", async () => {
    const { root, store, authorization, selected } = await fixture();
    const before = store.tasks(), fenceBefore = await readFile(path.join(root, "selection-fences", `${selected}.json`));
    await store.discardBatch(selected);
    expect(store.tasks()).toHaveLength(60);
    for (const task of store.tasks()) {
      const old = before.find(value => value.result.upload_task_id === task.result.upload_task_id)!;
      expect(task).toEqual({ ...old, result: { ...old.result, state: "DISCARDED" } });
    }
    expect(await readFile(path.join(root, "selection-fences", `${selected}.json`))).toEqual(fenceBefore);
    const reopened = new DouyinUploadStore(root); await reopened.load();
    expect(reopened.tasks().every(task => task.result.state === "DISCARDED")).toBe(true);
    expect(JSON.parse(await readFile(path.join(root, "discard-history", `${authorization.pageBatchId}.json`), "utf8")).tasks).toEqual(before);
    await expect(store.discardBatch(selected)).rejects.toThrow();
    const old = store.task(selected)!; old.result.state = "NEEDS_HUMAN";
    await expect(store.saveTask(old)).rejects.toThrow();
    const unselected = store.tasks().find(task => task.result.upload_outcome === "NOT_SELECTED")!;
    unselected.result.attempt_count = 1;
    await expect(store.markSelecting(unselected.result.upload_task_id, { targetId: "new-tab", pageBatchId: authorization.pageBatchId, modalSessionId: randomUUID() }, 2)).rejects.toThrow();
  });

  it("rejects partially admitted batches and running tasks without writing deletion history", async () => {
    const f = await fixture(3), before = await readFile(path.join(f.root, "state.json"));
    const pending = f.store.tasks().find(task => task.result.state === "PENDING")!;
    pending.result.state = "CONNECTING_BROWSER"; await f.store.saveTask(pending);
    await expect(f.store.discardBatch(f.selected)).rejects.toThrow();
    pending.result.state = "PENDING"; await f.store.saveTask(pending);
    const raw = JSON.parse(before.toString()); raw.tasks.pop();
    await writeFile(path.join(f.root, "state.json"), JSON.stringify(raw), { mode: 0o600 });
    const partial = new DouyinUploadStore(f.root); await partial.load();
    await expect(partial.discardBatch(f.selected)).rejects.toThrow();
  });

  it("retains permanent same-target hash deduplication after deletion", async () => {
    const f = await fixture(3); await f.store.discardBatch(f.selected);
    const old = f.store.task(f.selected)!;
    const authorization = { ...old.authorization, pageBatchId: randomUUID(), expectedCount: 1 };
    const input = { ...old.input, export_task_id: randomUUID() };
    const task = { ...old, input, authorization, inputDigest: frozenInputDigest(input, authorization), result: { ...old.result, export_task_id: input.export_task_id, upload_task_id: uploadTaskId(input, authorization.target), state: "PENDING" as const, upload_outcome: "NOT_SELECTED" as const, attempt_count: 1, failure: undefined } };
    await f.store.saveIntents([{ project_id: input.project_id, batch_id: input.batch_id, export_task_id: input.export_task_id, selection: { enabled: true, accountProduct: "蝴蝶贴" }, config: old.config, authorization }]);
    await f.store.saveTask(task);
    await expect(f.store.markSelecting(task.result.upload_task_id, { targetId: "new", pageBatchId: authorization.pageBatchId, modalSessionId: randomUUID() }, 1)).rejects.toThrow(/permission unavailable/);
  });

  it("refuses READY records, synchronisation failure and a control veto", async () => {
    const f = await fixture(3), unknown = f.store.task(f.selected)!, fence = f.store.fence(f.selected)!;
    unknown.result = { ...unknown.result, state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY", readyEvidence: { advertiserId: unknown.result.advertiserId, adId: unknown.result.adId, fileName: unknown.result.file_name, selectedCount: 1, observedAt: new Date().toISOString(), pageOwnership: fence.pageOwnership }, failure: undefined };
    await f.store.saveTask(unknown); await expect(f.store.discardBatch(f.selected)).rejects.toThrow();
    const veto = await fixture(3), before = await readFile(path.join(veto.root, "state.json"));
    await expect(veto.store.discardBatch(veto.selected, async () => { throw new Error("control changed"); })).rejects.toThrow(/control changed/);
    expect(await readFile(path.join(veto.root, "state.json"))).toEqual(before);
    await veto.store.discardBatch(veto.selected);
    const failed = await fixture(3), ledger = await readFile(path.join(failed.root, "state.json"));
    const broken = new DouyinUploadStore(failed.root, { syncDirectory: async () => { throw new Error("sync failure"); } }); await broken.load();
    await expect(broken.discardBatch(failed.selected)).rejects.toThrow();
    expect(broken.unavailable).toBe(true); expect(await readFile(path.join(failed.root, "state.json"))).toEqual(ledger);
    expect(broken.hasMarker(failed.selected)).toBe(true);
  });
});
