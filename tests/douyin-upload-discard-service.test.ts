import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DouyinUploadStore, frozenInputDigest, uploadTaskId } from "../src/main/douyin-upload-store";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { QianchuanUploadConfigSchema, type UploadAuthorization } from "../src/shared/douyin-upload";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "discard-service-")); roots.push(root);
  const store = new DouyinUploadStore(root); await store.load();
  const config = QianchuanUploadConfigSchema.parse({ enabled: true }); await store.setConfig(config);
  const project_id = randomUUID(), batch_id = randomUUID();
  const authorization: UploadAuthorization = { target: { product: "蝴蝶贴", cdpEndpoint: "http://127.0.0.1:9222", advertiserId: "123", adId: "456", configDigest: "a".repeat(64) }, pageBatchId: randomUUID(), expectedCount: 2 };
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const input = { project_id, batch_id, export_task_id: randomUUID(), video_path: `/tmp/formal-${i}.mp4`, artifact_sha256: String(i).repeat(64), size_bytes: 10 };
    await store.saveIntents([{ project_id, batch_id, export_task_id: input.export_task_id, selection: { enabled: true, accountProduct: "蝴蝶贴" }, authorization, config }]);
    const id = uploadTaskId(input, authorization.target); ids.push(id);
    await store.saveTask({ input, inputDigest: frozenInputDigest(input, authorization), authorization, config, snapshotPath: `/tmp/missing-${i}.mp4`, result: { project_id, batch_id, export_task_id: input.export_task_id, artifact_sha256: input.artifact_sha256, upload_task_id: id, file_name: path.basename(input.video_path), accountProduct: "蝴蝶贴", advertiserId: "123", adId: "456", state: "PENDING", upload_outcome: "NOT_SELECTED", retryable: false, retry_count: 0, attempt_count: i === 0 ? 1 : 0, timestamp: new Date().toISOString() } });
  }
  await store.markSelecting(ids[0]!, { targetId: "original", pageBatchId: authorization.pageBatchId, modalSessionId: randomUUID() }, 1);
  const task = store.task(ids[0]!)!; task.result.state = "NEEDS_HUMAN"; await store.saveTask(task);
  const browser = vi.fn<() => UploadBrowserPort>(() => { throw new Error("must not access browser"); });
  const loadBatch = vi.fn(async () => { throw new Error("must not load media"); });
  const service = new DouyinUploadService(store, { browser, loadBatch });
  return { root, store, service, browser, loadBatch, project_id, ids };
}
it("deletes offline without connecting, hides tasks, survives restart and refuses stale resume", async () => {
  const f = await fixture(); await f.service.discard(f.ids[0]!);
  expect(f.service.status(f.project_id).tasks).toEqual([]);
  expect(f.service.status(f.project_id).message).not.toContain("暂停");
  await expect(f.service.resume(f.ids[0]!)).rejects.toThrow(/已删除/);
  await expect(f.service.resume(f.ids[1]!)).rejects.toThrow(/已删除/);
  await f.service.cancel(f.ids[0]!); await f.service.cancelExports(f.project_id, f.store.tasks().map(task => task.input.export_task_id));
  await f.service.runPending();
  const reopened = new DouyinUploadStore(f.root); await reopened.load();
  const restored = new DouyinUploadService(reopened, { browser: f.browser, loadBatch: f.loadBatch });
  await restored.reconcile(); await restored.runPending();
  expect(restored.status(f.project_id).tasks).toEqual([]);
  expect(reopened.tasks().every(task => task.result.state === "DISCARDED")).toBe(true);
  expect(f.browser).not.toHaveBeenCalled(); expect(f.loadBatch).not.toHaveBeenCalled();
});
it("blocks concurrent continue, cancel and retarget, and a stop veto preserves the old batch", async () => {
  const f = await fixture();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const discard = f.store.discardBatch.bind(f.store);
  vi.spyOn(f.store, "discardBatch").mockImplementation(async (id, check) => { enter(); await gate; return discard(id, check); });
  const deleting = f.service.discard(f.ids[0]!); const rejection = expect(deleting).rejects.toThrow(/控制已变化/);
  await entered;
  await expect(f.service.resume(f.ids[1]!)).rejects.toThrow(/正在删除/);
  await expect(f.service.cancel(f.ids[1]!)).rejects.toThrow(/正在删除/);
  await expect(f.service.retarget(f.ids[1]!, "789")).rejects.toThrow(/正在删除/);
  await expect(f.service.discard(f.ids[1]!)).rejects.toThrow(/仍在运行/);
  await f.service.stop(); release(); await rejection;
  expect(f.store.tasks().some(task => task.result.state === "DISCARDED")).toBe(false);
  expect(f.browser).not.toHaveBeenCalled();
});
