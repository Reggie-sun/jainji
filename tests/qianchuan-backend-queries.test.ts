import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { QianchuanBackendQueries } from "../src/main/qianchuan-backend-queries";
import type { QianchuanAccountConfigReader, FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
import type { QianchuanBackendQuery, QianchuanBackendResult } from "../src/shared/qianchuan-backend";
import { DouyinUploadService } from "../src/main/douyin-upload-service";
import { DouyinUploadStore } from "../src/main/douyin-upload-store";

const target: FrozenQianchuanAccount = { product: "蝴蝶贴", advertiserId: "12345", adId: "67890", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) };
const query = () => ({ product: target.product, expectedAdvertiserId: target.advertiserId, kind: "plan" as const, adId: target.adId, requestId: randomUUID() });
const result: QianchuanBackendResult = { advertiserId: target.advertiserId, observedAt: new Date().toISOString(), kind: "plan", adId: target.adId, name: "示例", budget: "100", roiGoal: "2", products: [] };
type Read = (target: FrozenQianchuanAccount, query: QianchuanBackendQuery, signal: AbortSignal) => Promise<QianchuanBackendResult>;
function fixture(readQuery: Read = async () => structuredClone(result)) {
  const read = vi.fn(readQuery);
  const prepareCatalog = vi.fn(async () => target), freeze = vi.fn(async () => target);
  const accounts = { prepareCatalog, freeze } as unknown as QianchuanAccountConfigReader;
  return { accounts, prepareCatalog, freeze, read, queries: new QianchuanBackendQueries(accounts, read) };
}
it("freezes the saved account before returning and never creates upload work", async () => {
  const f = fixture(), input = query();
  await expect(f.queries.run(input, 7)).resolves.toEqual(result);
  expect(f.prepareCatalog).toHaveBeenCalledWith(target.product);
  expect(f.freeze).toHaveBeenCalledWith(target.product, target.configDigest);
  expect(f.read).toHaveBeenCalledWith(target, input, expect.any(AbortSignal));
  expect(f.queries.busy).toBe(false);
});
it.each(["before", "after"])("rejects account drift %s the read", async when => {
  const f = fixture();
  if (when === "before") f.prepareCatalog.mockResolvedValue({ ...target, advertiserId: "999" });
  else f.freeze.mockResolvedValue({ ...target, cdpEndpoint: "http://127.0.0.1:42002" });
  await expect(f.queries.run(query(), 7)).rejects.toThrow("变化");
  expect(f.read).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
  expect(f.queries.busy).toBe(false);
});
it("cancellation belongs to the initiating renderer and drains before releasing busy", async () => {
  let release!: () => void;
  const f = fixture(async (_target, _query, signal) => {
    await new Promise<void>(resolve => { release = resolve; }); signal.throwIfAborted(); return result;
  }), input = query();
  const pending = f.queries.run(input, 7); void pending.catch(() => undefined);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(() => f.queries.run(query(), 7)).toThrow("正在进行");
  f.queries.cancel({ requestId: input.requestId }, 8);
  expect(f.queries.busy).toBe(true);
  f.queries.cancel({ requestId: input.requestId }, 7);
  expect(f.queries.busy).toBe(true); release();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(f.freeze).not.toHaveBeenCalled(); expect(f.queries.busy).toBe(false);
});
it("stop cancels the active read without retry or result caching", async () => {
  const f = fixture(async (_target, _query, signal) => {
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    signal.throwIfAborted(); return result;
  });
  const pending = f.queries.run(query(), 7); void pending.catch(() => undefined);
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(1));
  await f.queries.stop(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(f.read).toHaveBeenCalledTimes(1); expect(f.queries.busy).toBe(false);
});
it("service holds its existing busy gate and stop drains backend reads", async () => {
  const f = fixture(async (_target, _query, signal) => {
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    signal.throwIfAborted(); return result;
  });
  const store = new DouyinUploadStore("/unused-fixture");
  const service = new DouyinUploadService(store, { accounts: f.accounts, readBackendQuery: f.read,
    loadBatch: async () => { throw new Error("must not create a queue"); }, browser: () => { throw new Error("must not upload"); } });
  const pending = service.queryBackend(query(), 7); void pending.catch(() => undefined);
  expect(service.busy).toBe(true);
  expect(() => service.queryBackend(query(), 8)).toThrow("尚未空闲");
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(1));
  await expect(service.stop()).resolves.toBe(true);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(service.busy).toBe(false); expect(store.tasks()).toEqual([]);
});
