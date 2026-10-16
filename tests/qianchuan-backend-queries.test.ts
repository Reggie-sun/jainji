import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { QianchuanBackendQueries } from "../src/main/qianchuan-backend-queries";
import type { QianchuanAccountConfigReader, FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
import { QIANCHUAN_QUERY_METRICS, type QianchuanBackendQuery, type QianchuanBackendResult } from "../src/shared/qianchuan-backend";
import { DouyinUploadService } from "../src/main/douyin-upload-service";
import { DouyinUploadStore } from "../src/main/douyin-upload-store";

const target: FrozenQianchuanAccount = { product: "蝴蝶贴", advertiserId: "12345", adId: "67890", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) };
const query = () => ({ product: target.product, expectedAdvertiserId: target.advertiserId, kind: "plan" as const, adId: target.adId, requestId: randomUUID() });
const result: QianchuanBackendResult = { advertiserId: target.advertiserId, observedAt: new Date().toISOString(), kind: "plan", adId: target.adId, name: "示例", budget: "100", roiGoal: "2", products: [] };
type Read = (target: FrozenQianchuanAccount, query: QianchuanBackendQuery, signal: AbortSignal) => Promise<QianchuanBackendResult>;
function fixture(readQuery: Read = async () => structuredClone(result)) {
  const read = vi.fn(readQuery);
  const preflight = vi.fn(async () => target), prepare = vi.fn(async () => target);
  const prepareCatalog = vi.fn(async () => target), freeze = vi.fn(async () => target);
  const accounts = { preflight, prepare, prepareCatalog, freeze } as unknown as QianchuanAccountConfigReader;
  return { accounts, preflight, prepare, prepareCatalog, freeze, read, queries: new QianchuanBackendQueries(accounts, read) };
}
it("freezes the saved account before returning and never creates upload work", async () => {
  const f = fixture(), input = query();
  await expect(f.queries.run(input, 7)).resolves.toEqual(result);
  expect(f.prepareCatalog).toHaveBeenCalledWith(target.product, true);
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.freeze).toHaveBeenCalledWith(target.product, target.configDigest);
  expect(f.read).toHaveBeenCalledWith(target, input, expect.any(AbortSignal));
  expect(f.queries.busy).toBe(false);
});
const remoteTarget: FrozenQianchuanAccount = { ...target,
  egress: { mode: "remote-browser", group: "example", sshHost: "example-vps", localPort: 42001, expectedIp: "203.0.113.8" } };
it("prepares the original VPS browser for an explicit query instead of requiring it already open", async () => {
  const f = fixture(), connected = { ...remoteTarget, cdpEndpoint: "http://127.0.0.1:42002" };
  f.preflight.mockResolvedValue(remoteTarget);
  f.prepare.mockResolvedValue(connected); f.freeze.mockResolvedValue(connected);
  f.prepareCatalog.mockRejectedValue(new Error("远端浏览器连接不可用"));
  await expect(f.queries.run(query(), 7)).resolves.toEqual(result);
  expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.prepare).toHaveBeenCalledWith(target.product);
  expect(f.prepareCatalog).not.toHaveBeenCalled();
  expect(f.read).toHaveBeenCalledWith(connected, expect.any(Object), expect.any(AbortSignal));
  expect(f.freeze).toHaveBeenCalledWith(target.product, remoteTarget.configDigest);
});
it.each([false,true])('existing-only reads never launch local or VPS Chrome (remote=%s)',async remote=>{
 const f=fixture(),binding=remote?remoteTarget:target;
 f.preflight.mockResolvedValue(binding);f.prepareCatalog.mockResolvedValue(binding);f.freeze.mockResolvedValue(binding);
 const input={...query(),browserAccess:'existing-only'};
 await expect(f.queries.run(input,7)).resolves.toEqual(result);
 expect(f.prepareCatalog).toHaveBeenCalledWith(target.product,false);expect(f.prepare).not.toHaveBeenCalled();
 expect(f.read).toHaveBeenCalledWith(binding,input,expect.any(AbortSignal));
});
it.each([false,true])('existing-only failure never retries or opens absent browser (remote=%s)',async remote=>{
 const f=fixture();f.preflight.mockResolvedValue(remote?remoteTarget:target);
 f.prepareCatalog.mockRejectedValue(new Error('existing browser unavailable'));
 await expect(f.queries.run({...query(),browserAccess:'existing-only'},7)).rejects.toThrow('existing browser unavailable');
 expect(f.prepare).not.toHaveBeenCalled();expect(f.prepareCatalog).toHaveBeenCalledTimes(1);expect(f.read).not.toHaveBeenCalled();expect(f.queries.busy).toBe(false);
});
it("rejects a stale selected advertiser before opening any browser", async () => {
  const f = fixture(); f.preflight.mockResolvedValue({ ...remoteTarget, advertiserId: "999" });
  await expect(f.queries.run(query(), 7)).rejects.toThrow("变化");
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.prepareCatalog).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled(); expect(f.queries.busy).toBe(false);
});
it.each(["digest", "egress"])("rejects %s drift during VPS preparation before querying", async field => {
  const f = fixture(); f.preflight.mockResolvedValue(remoteTarget);
  f.prepare.mockResolvedValue(field === "digest" ? { ...remoteTarget, configDigest: "e".repeat(64) } :
    { ...remoteTarget, egress: { ...remoteTarget.egress!, sshHost: "another-vps" } });
  await expect(f.queries.run(query(), 7)).rejects.toThrow("变化");
  expect(f.read).not.toHaveBeenCalled(); expect(f.queries.busy).toBe(false);
});
it("does not fall back locally or retry when VPS preparation requires explicit reconnection", async () => {
  const f = fixture(); f.preflight.mockResolvedValue(remoteTarget);
  f.prepare.mockRejectedValue(new Error("远端浏览器连接不可用，请明确重连。"));
  await expect(f.queries.run(query(), 7)).rejects.toThrow("明确重连");
  expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.prepareCatalog).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled(); expect(f.queries.busy).toBe(false);
});
it("drains cancelled VPS preparation without issuing a backend read", async () => {
  let resolve!: (value: FrozenQianchuanAccount) => void;
  const f = fixture(), input = query(); f.preflight.mockResolvedValue(remoteTarget);
  f.prepare.mockImplementation(() => new Promise<FrozenQianchuanAccount>(done => { resolve = done; }));
  const pending = f.queries.run(input, 7); void pending.catch(() => undefined);
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  f.queries.cancel({ requestId: input.requestId }, 7); expect(f.queries.busy).toBe(true);
  resolve(remoteTarget); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(f.read).not.toHaveBeenCalled(); expect(f.freeze).not.toHaveBeenCalled();
  expect(f.queries.busy).toBe(false);
});
it("opens a proven absent account browser for an explicit report without creating upload work", async () => {
  const f = fixture(), input = { product: target.product, expectedAdvertiserId: target.advertiserId,
    requestId: randomUUID(), kind: "report" as const, startDate: "2026-10-13", endDate: "2026-10-13" };
  f.prepareCatalog.mockImplementation(async (...args: unknown[]) => {
    if (args[1] !== true) throw new Error("请先打开该账号的千川浏览器，登录后刷新计划。");
    return target;
  });
  const report = { advertiserId: target.advertiserId, observedAt: result.observedAt, kind: "report" as const,
    startTime: "2026-10-13 00:00:00", endTime: "2026-10-13 12:00:00",
    metrics: Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, { value: "0", display: "0" }])) } as QianchuanBackendResult;
  f.read.mockResolvedValue(report);
  const store = new DouyinUploadStore("/unused-fixture");
  const service = new DouyinUploadService(store, { accounts: f.accounts, readBackendQuery: f.read,
    loadBatch: async () => { throw new Error("must not create a queue"); }, browser: () => { throw new Error("must not upload"); } });
  await expect(service.queryBackend(input, 7)).resolves.toEqual(report);
  expect(f.prepareCatalog).toHaveBeenCalledTimes(1);
  expect(f.read).toHaveBeenCalledWith(target, input, expect.any(AbortSignal));
  expect(f.freeze).toHaveBeenCalledWith(target.product, target.configDigest);
  expect(store.tasks()).toEqual([]);
  expect(service.busy).toBe(false);
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


it('drains cancellation during existing-only preparation and never falls back to opening a browser',async()=>{
 const f=fixture(),input={...query(),browserAccess:'existing-only' as const};
 let release!:(value:FrozenQianchuanAccount)=>void;
 f.prepareCatalog.mockImplementation(()=>new Promise<FrozenQianchuanAccount>(resolve=>{release=resolve}));
 const pending=f.queries.run(input,7);void pending.catch(()=>undefined);
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 f.queries.cancel({requestId:input.requestId},7);expect(f.queries.busy).toBe(true);
 expect(()=>f.queries.run({...query(),browserAccess:'existing-only'},8)).toThrow('正在进行');
 release(target);await expect(pending).rejects.toMatchObject({name:'AbortError'});
 expect(f.prepareCatalog).toHaveBeenCalledWith(target.product,false);expect(f.prepare).not.toHaveBeenCalled();
 expect(f.read).not.toHaveBeenCalled();expect(f.freeze).not.toHaveBeenCalled();expect(f.queries.busy).toBe(false);
});
