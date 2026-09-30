import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { DouyinUploadStore, frozenInputDigest, uploadTaskId, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";
import { DouyinUploadPanel } from "../src/renderer/DouyinUploadPanel";
import { QIANCHUAN_PRODUCTS, type QianchuanProduct } from "../src/shared/qianchuan-account";
import { uploadFailure, type UploadAuthorization } from "../src/shared/douyin-upload";

const roots = new Set<string>();
afterEach(async () => { await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true }))); roots.clear(); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-paused-status-")); roots.add(root);
  const file = path.join(root, "accounts.json"), accounts = new QianchuanAccountConfigReader();
  await writeFile(file, JSON.stringify({ version: 1, accounts: QIANCHUAN_PRODUCTS.map((product, index) => ({ product,
    ...(product === "眼贴" ? { productName: "晚安油" } : {}), advertiserId: `${3000 + index}`, adId: `${4000 + index}`, cdpEndpoint: `http://127.0.0.1:${13000 + index}`,
  })) }), { mode: 0o600 });
  const store = new DouyinUploadStore(path.join(root, "private")); await store.load();
  const port: UploadBrowserPort = { connect: vi.fn(), open: vi.fn(), upload: vi.fn(), ready: vi.fn(), readOnlyCheck: vi.fn(), stop: vi.fn() };
  let readiness: string | undefined;
  const dependencies = { accounts, browser: vi.fn(() => port), loadBatch: vi.fn(), readiness: () => readiness };
  let service = new DouyinUploadService(store, dependencies); await service.chooseConfig(file); await service.configure({ enabled: true });
  async function batch(count: number, product: QianchuanProduct = "眼贴", blocked = false, fenced = false) {
    const projectId = randomUUID(), batchId = randomUUID();
    const authorization: UploadAuthorization = (await service.preflight({ enabled: true, accountProduct: product }, count))!;
    const records: UploadTaskRecord[] = [];
    for (let index = 0; index < count; index++) {
      const identity = { project_id: projectId, batch_id: batchId, export_task_id: randomUUID() };
      const input = { ...identity, video_path: path.join(root, `${identity.export_task_id}.mp4`),
        artifact_sha256: createHash("sha256").update(identity.export_task_id).digest("hex"), size_bytes: 1 };
      await store.saveIntents([{ ...identity, selection: { enabled: true, accountProduct: product }, config: store.config, authorization }]);
      const record: UploadTaskRecord = { input, config: store.config, authorization, inputDigest: frozenInputDigest(input, authorization), snapshotPath: path.join(root, "snapshot.mp4"),
        result: { ...identity, upload_task_id: uploadTaskId(input, authorization.target), artifact_sha256: input.artifact_sha256, file_name: path.basename(input.video_path),
          accountProduct: product, advertiserId: authorization.target.advertiserId, adId: authorization.target.adId,
          state: "PENDING", upload_outcome: "NOT_SELECTED", retryable: false, retry_count: 0, attempt_count: 1, timestamp: new Date().toISOString() } };
      await store.saveTask(record);
      if (fenced) await store.markSelecting(record.result.upload_task_id, { targetId: "original-tab", pageBatchId: authorization.pageBatchId, modalSessionId: randomUUID() }, index + 1);
      if (blocked) {
        const task = store.task(record.result.upload_task_id)!;
        task.result = { ...task.result, state: "NEEDS_HUMAN", failure: uploadFailure(fenced ? "UPLOAD_OUTCOME_UNKNOWN" : "PAGE_CONTRACT_CHANGED", "page", "原上传弹窗不可核实。", "核查原页面；禁止重传未知文件。", true).failure };
        await store.saveTask(task);
      }
      records.push(store.task(record.result.upload_task_id)!);
    }
    return { projectId, records };
  }
  async function restart() { service = new DouyinUploadService(store, dependencies); await service.restoreConfig(); await service.beginProduction(); return service; }
  return { root, store, port, dependencies, batch, restart, get service() { return service; }, readiness: (value: string | undefined) => { readiness = value; } };
}

describe("paused Qianchuan status projection", () => {
  it("shows only current production without same-account historical blockers or durable changes", async () => {
    const f = await fixture(), old = await f.batch(8, "眼贴", true); await f.restart(); const current = await f.batch(12);
    const before = await readFile(path.join(f.store.root, "state.json"));
    const status = f.service.status(current.projectId);
    expect(status.ready).toBe(true);
    expect(status.message).not.toContain("暂停"); expect(status.message).toContain("停在确定前");
    expect(status.tasks).toHaveLength(12); expect(status.tasks.every(task => task.state === "PENDING" && task.upload_outcome === "NOT_SELECTED")).toBe(true);
    expect(status.tasks.some(task => task.project_id === old.projectId)).toBe(false);
    const html = renderToStaticMarkup(createElement(DouyinUploadPanel, { projectId: current.projectId, status, onState: () => {} }));
    expect(html).toContain(status.message); expect(html).toContain("待上传 12 条");
    expect(f.service.status(old.projectId).tasks).toEqual([]);
    await f.service.runPending(); expect(f.dependencies.browser).not.toHaveBeenCalled();
    expect(await readFile(path.join(f.store.root, "state.json"))).toEqual(before);
  });

  it("rejects historical continue without touching the current batch", async () => {
    const f = await fixture(), old = await f.batch(2, "眼贴", true); await f.restart(); const current = await f.batch(1);
    await expect(f.service.resume(old.records[0]!.result.upload_task_id)).rejects.toThrow("不属于本次制作");
    expect(f.dependencies.browser).not.toHaveBeenCalled(); expect(f.service.status(current.projectId).tasks[0]!.state).toBe("PENDING");
  });

  it("does not inherit historical pause from another account", async () => {
    const f = await fixture(); await f.batch(2, "肥皂", true); await f.restart(); const current = await f.batch(1);
    const status = f.service.status(current.projectId);
    expect(status.ready).toBe(true); expect(status.message).not.toContain("暂停"); expect(status.message).not.toContain("2 条");
    expect(status.message).not.toContain("晚安油（账户"); expect(f.dependencies.browser).not.toHaveBeenCalled();
  });

  it("preserves unknown outcome, original failure and selection fence bytes during repeated status reads", async () => {
    const f = await fixture(), old = await f.batch(1, "眼贴", true, true); await f.restart(); const current = await f.batch(1);
    const id = old.records[0]!.result.upload_task_id, fencePath = path.join(f.store.root, "selection-fences", `${id}.json`);
    const before = await readFile(fencePath), result = f.store.task(id)!.result;
    for (let index = 0; index < 3; index++) expect(f.service.status(current.projectId).ready).toBe(true);
    expect(await readFile(fencePath)).toEqual(before); expect(f.store.task(id)!.result).toEqual(result);
    expect(f.dependencies.browser).not.toHaveBeenCalled();
  });

  it("keeps exact captured-job records readable after changing production without restoring control authority", async () => {
    const f = await fixture(), old = await f.batch(1, "眼贴", true, true), pending = await f.batch(1);
    await f.restart(); const current = await f.batch(1, "肥皂");
    const id = old.records[0]!.result.upload_task_id, exportId = old.records[0]!.input.export_task_id;
    const fencePath = path.join(f.store.root, "selection-fences", `${id}.json`);
    const before = await readFile(path.join(f.store.root, "state.json")), fence = await readFile(fencePath);
    const detail = f.service.capturedStatus(old.projectId, [exportId, pending.records[0]!.input.export_task_id]);
    expect(detail).toMatchObject({ historical: true, accounts: expect.arrayContaining([expect.objectContaining({ productName: "晚安油" })]) });
    expect(detail.message).toContain("此前制作"); expect(detail.tasks).toEqual([f.store.task(id)!.result]);
    expect(detail).not.toHaveProperty("ready"); expect(detail).not.toHaveProperty("batches");
    expect(f.service.capturedStatus(old.projectId, [pending.records[0]!.input.export_task_id]).tasks).toEqual([]);
    expect(f.service.capturedStatus(pending.projectId, [pending.records[0]!.input.export_task_id]).tasks[0]).toMatchObject({ state: "PENDING", upload_outcome: "NOT_SELECTED" });
    expect(f.service.status(old.projectId).tasks).toEqual([]);
    await expect(f.service.resume(id)).rejects.toThrow("不属于本次制作");
    expect(f.service.status(current.projectId).ready).toBe(true);
    expect(await readFile(path.join(f.store.root, "state.json"))).toEqual(before); expect(await readFile(fencePath)).toEqual(fence);
    expect(f.dependencies.browser).not.toHaveBeenCalled();
  });

  it("reports stopped state and restores normal readiness only when that stop is explicitly released", async () => {
    const f = await fixture(), current = await f.batch(1);
    expect(f.service.status(current.projectId).ready).toBe(true);
    await f.service.stop(); expect(f.service.status(current.projectId).ready).toBe(false);
    expect(f.service.status(current.projectId).message).toContain("停止"); expect(f.service.status(current.projectId).message).toContain("安全继续");
    await f.service.configure({ enabled: true }); expect(f.service.status(current.projectId).ready).toBe(true);
    expect(f.dependencies.browser).not.toHaveBeenCalled();
  });

  it("keeps disabled settings, platform readiness and unavailable storage ahead of pause diagnostics", async () => {
    const f = await fixture(); await f.batch(1, "肥皂", true); const current = await f.batch(1); await f.restart();
    f.readiness("千川页面合同未核实。"); expect(f.service.status(current.projectId)).toMatchObject({ ready: false, message: "千川页面合同未核实。" });
    await f.service.configure({ enabled: false }); expect(f.service.status(current.projectId).message).toBe("自动上传已关闭。");
    vi.spyOn(f.store, "unavailable", "get").mockReturnValue(true);
    expect(f.service.status(current.projectId)).toMatchObject({ ready: false, message: "上传存储不可用，已阻断浏览器操作。" });
  });
});
