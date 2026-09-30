import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { DouyinUploadStore, frozenInputDigest, uploadTaskId } from "../src/main/douyin-upload-store";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { closureFixture } from "./helpers/douyin-closure";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const f = await closureFixture(); roots.push(f.root);
  const browser = vi.fn<() => UploadBrowserPort>(() => { throw new Error("browser forbidden"); }), loadBatch = vi.fn(async () => { throw new Error("media forbidden"); });
  return { ...f, browser, loadBatch, service: new DouyinUploadService(f.store, { browser, loadBatch }) };
}
it("closure is offline, preserves results, rejects stale actions, and never wakes another batch", async () => {
  const f = await fixture(), other = await f.batch(1, randomUUID()), before = f.store.tasks();
  await expect(f.service.requestResume(other[0]!.result.upload_task_id)).rejects.toThrow(f.project_id);
  await f.service.closeBatch(f.id);
  expect(f.store.tasks()).toEqual(before); expect(f.service.status(f.project_id).tasks).toEqual([]);
  expect(f.service.status(f.project_id).closedBatches?.[0]).toMatchObject({ readyCount: 1, unknownCount: 1, notSelectedCount: 1 });
  await expect(f.service.requestResume(f.id)).rejects.toThrow(/已结束/);
  await expect(f.service.retarget(f.id, "789")).rejects.toThrow(); await expect(f.service.discard(f.id)).rejects.toThrow(/已结束/);
  await f.service.cancel(f.unknownId); await f.service.cancelExports(f.project_id, f.tasks.map(task => task.input.export_task_id));
  await f.service.runPending();
  const reopened = new DouyinUploadStore(f.root); await reopened.load();
  const service = new DouyinUploadService(reopened, { browser: f.browser, loadBatch: f.loadBatch });
  await service.reconcile(); await service.runPending();
  await service.beginProduction();
  const captured = service.capturedStatus(f.project_id, f.tasks.map(task => task.input.export_task_id));
  expect(captured.historical).toBe(true); expect(captured.tasks).toEqual([]);
  expect(captured.closedBatches?.[0]).toMatchObject({ readyCount: 1, unknownCount: 1, notSelectedCount: 1 });
  expect(captured.closedBatches?.[0]?.tasks).toEqual(before.filter(task => task.input.project_id === f.project_id && task.authorization.pageBatchId === f.tasks[0]!.authorization.pageBatchId).map(task => task.result));
  expect(service.capturedStatus(f.project_id, [f.tasks[0]!.input.export_task_id]).closedBatches).toEqual([]);
  expect(reopened.tasks()).toEqual(before); expect(f.browser).not.toHaveBeenCalled(); expect(f.loadBatch).not.toHaveBeenCalled();
});
it("concurrent resume/retarget/discard/closure refuse; stop generation veto leaves records unclosed", async () => {
  const f = await fixture(); let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const close = f.store.closeBatch.bind(f.store);
  vi.spyOn(f.store, "closeBatch").mockImplementation(async (id, check) => { enter(); await gate; return close(id, check); });
  const closing = f.service.closeBatch(f.id), rejected = expect(closing).rejects.toThrow(/控制已变化/); await entered;
  await expect(f.service.requestResume(f.unknownId)).rejects.toThrow(/正在结束/);
  await expect(f.service.cancel(f.unknownId)).rejects.toThrow(/正在结束/);
  await expect(f.service.retarget(f.unknownId, "789")).rejects.toThrow(/正在结束/);
  await expect(f.service.discard(f.unknownId)).rejects.toThrow(/仍在运行/);
  await expect(f.service.closeBatch(f.unknownId)).rejects.toThrow(/仍在运行/);
  await f.service.stop(); release(); await rejected;
  expect(f.store.closedBatches()).toEqual([]); expect(f.browser).not.toHaveBeenCalled();
});
it("other batch aliases referencing a closed READY original retain exact evidence and have no selection permission", async () => {
  const f = await fixture(), original = f.store.task(f.id)!, other = (await f.batch(1))[0]!;
  const input = { ...other.input, artifact_sha256: original.input.artifact_sha256 };
  // Create the alias through the existing task identity, not by changing a persisted input.
  const aliasInput = { ...input, export_task_id: randomUUID() }, authorization = { ...other.authorization, pageBatchId: randomUUID() };
  await f.store.saveIntents([{ project_id: aliasInput.project_id, batch_id: aliasInput.batch_id, export_task_id: aliasInput.export_task_id, config: original.config, authorization, selection: { enabled: true, accountProduct: "热敷贴" } }]);
  const alias = { ...original, input: aliasInput, authorization, inputDigest: frozenInputDigest(aliasInput, authorization), result: { ...original.result, batch_id: aliasInput.batch_id, export_task_id: aliasInput.export_task_id, upload_task_id: uploadTaskId(aliasInput, authorization.target), file_name: other.result.file_name, duplicate_of: f.id } };
  await f.store.saveTask(alias); await f.service.closeBatch(f.id);
  expect(f.store.task(alias.result.upload_task_id)).toEqual(alias);
  await expect(f.service.requestResume(alias.result.upload_task_id)).rejects.toThrow(/别名/);
  const reopened = new DouyinUploadStore(f.root); await reopened.load(); expect(reopened.task(alias.result.upload_task_id)).toEqual(alias);
  await expect(reopened.markSelecting(alias.result.upload_task_id, { ...original.result.readyEvidence!.pageOwnership, pageBatchId: authorization.pageBatchId }, 1)).rejects.toThrow();
  expect(f.browser).not.toHaveBeenCalled();
});

it("same-target bytes of a closed NOT_SELECTED member cannot be selected through a new batch", async () => {
  const f = await fixture(), original = f.store.tasks().find(task => task.result.upload_outcome === "NOT_SELECTED")!;
  await f.service.closeBatch(f.id);
  const input = { ...original.input, batch_id: randomUUID(), export_task_id: randomUUID() }, authorization = { ...original.authorization, pageBatchId: randomUUID(), expectedCount: 1 };
  await f.store.saveIntents([{ project_id: input.project_id, batch_id: input.batch_id, export_task_id: input.export_task_id, config: original.config, authorization, selection: { enabled: true, accountProduct: "热敷贴" } }]);
  const next = { ...original, input, authorization, inputDigest: frozenInputDigest(input, authorization), result: { ...original.result, batch_id: input.batch_id, export_task_id: input.export_task_id, upload_task_id: uploadTaskId(input, authorization.target), attempt_count: 1 } };
  await f.store.saveTask(next);
  await expect(f.store.markSelecting(next.result.upload_task_id, { targetId: "new", pageBatchId: authorization.pageBatchId, modalSessionId: randomUUID() }, 1)).rejects.toThrow(/permission unavailable/);
  await f.service.resume(next.result.upload_task_id);
  expect(f.store.task(next.result.upload_task_id)!.result.failure?.message).toContain("已结束");
  expect(f.store.hasMarker(next.result.upload_task_id)).toBe(false); expect(f.browser).not.toHaveBeenCalled();
});

it("trusted continue acceptance returns before browser processing finishes, while initial rejection reaches the caller", async () => {
  const f = await fixture(); await f.service.closeBatch(f.id);
  const next = (await f.batch(1))[0]!, accounts = new QianchuanAccountConfigReader();
  vi.spyOn(accounts, "preflight").mockResolvedValue(next.authorization.target);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const port: UploadBrowserPort = { connect: async () => { await gate; throw new Error("isolated connection failed"); }, stop: async () => { release(); },
    open: vi.fn(), upload: vi.fn(), ready: vi.fn(), readOnlyCheck: vi.fn() };
  const service = new DouyinUploadService(f.store, { accounts, browser: () => port, loadBatch: f.loadBatch });
  await service.requestResume(next.result.upload_task_id);
  await vi.waitFor(() => expect(f.store.task(next.result.upload_task_id)!.result.state).toBe("CONNECTING_BROWSER"));
  expect(f.store.hasMarker(next.result.upload_task_id)).toBe(false);
  release(); await vi.waitFor(() => expect(f.store.task(next.result.upload_task_id)!.result.state).toBe("NEEDS_HUMAN"));
  await expect(service.requestResume(f.id)).rejects.toThrow(/已结束/);
});
