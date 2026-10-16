import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { QianguanjiaQueries } from "../src/main/qianguanjia-queries";
import type { QianguanjiaReadonlyAdapter } from "../src/main/qianchuan-qianguanjia-adapter";
import { requiresMembership } from "../src/main/membership-ipc";

function fixture() {
  const list = vi.fn(async (_signal: AbortSignal) => ({ source: "qianguanjia" as const, observedAt: "2026-10-14T10:00:00Z", accounts: [] }));
  const home = vi.fn(async (_signal: AbortSignal) => ({ source: "qianguanjia" as const, scope: "supplier-home-aggregate" as const, observedAt: "2026-10-14T10:00:00Z", date: "2026-10-14", groups: {} }));
  const close = vi.fn(async () => {});
  const discover = vi.fn(async () => ({ targets: [{ websocket: "ws://127.0.0.1:1234/devtools/browser/test", targetId: "page1", label: "千管家首页" }], unavailableBrowsers: 0 }));
  const connect = vi.fn(async () => ({ adapter: { listAdvertisers: list, todayHomeSummary: home } as unknown as QianguanjiaReadonlyAdapter, close }));
  const service = new QianguanjiaQueries({ discover, connect });
  return { service, list, home, close, discover, connect };
}
async function select(service: QianguanjiaQueries, senderId = 10) {
  const result = await service.run({ kind: "discover", requestId: randomUUID() }, senderId);
  if (result.kind !== "discover") throw new Error();
  expect(JSON.stringify(result)).not.toMatch(/websocket|ws:|targetId/);
  return result.sessions[0]!.sessionId;
}
it("uses one pinned connection for directory and home and detaches on disconnect", async () => {
  const f = fixture(), sessionId = await select(f.service);
  await f.service.run({ kind: "accounts", sessionId, requestId: randomUUID() }, 10);
  await f.service.run({ kind: "home", sessionId, requestId: randomUUID() }, 10);
  expect(f.connect).toHaveBeenCalledTimes(1);
  expect(f.list).toHaveBeenCalledTimes(1); expect(f.home).toHaveBeenCalledTimes(1);
  await f.service.disconnect(10); expect(f.close).toHaveBeenCalledOnce();
  await expect(f.service.run({ kind: "accounts", sessionId, requestId: randomUUID() }, 10)).rejects.toThrow(/重新发现/);
});
it("rejects arbitrary URL, writes and other sender's session before connecting", async () => {
  const f = fixture(), sessionId = await select(f.service);
  for (const input of [{ kind: "accounts", sessionId, requestId: randomUUID(), url: "https://evil.invalid" }, { kind: "budget", sessionId, requestId: randomUUID() }]) {
    await expect(f.service.run(input, 10)).rejects.toThrow(/参数/);
  }
  await expect(f.service.run({ kind: "accounts", sessionId, requestId: randomUUID() }, 11)).rejects.toThrow(/未完成/);
  expect(f.connect).not.toHaveBeenCalled(); await f.service.stop();
});
it("scopes cancellation to sender and request and drops sessions after cancellation", async () => {
  const f = fixture(), sessionId = await select(f.service), requestId = randomUUID();
  let reading: AbortSignal | undefined;
  f.list.mockImplementation(signal => new Promise((_resolve, reject) => { reading = signal; signal.addEventListener("abort", () => reject(new Error("private-secret-token")), { once: true }); }));
  const work = f.service.run({ kind: "accounts", sessionId, requestId }, 10);
  const rejected = expect(work).rejects.toThrow(/已取消/);
  await vi.waitFor(() => expect(reading).toBeDefined());
  f.service.cancel({ requestId }, 11); f.service.cancel({ requestId: randomUUID() }, 10);
  expect(reading!.aborted).toBe(false);
  await expect(f.service.run({ kind: "discover", requestId: randomUUID() }, 10)).rejects.toThrow(/正在读取/);
  f.service.cancel({ requestId }, 10); await rejected;
  expect(reading!.aborted).toBe(true); expect(f.close).toHaveBeenCalled();
  await expect(f.service.run({ kind: "home", sessionId, requestId: randomUUID() }, 10)).rejects.toThrow(/重新发现/);
});
it("keeps cancellation and detach available after membership failure", () => {
  expect(requiresMembership("qianguanjia.query")).toBe(true);
  expect(requiresMembership("qianguanjia.cancel")).toBe(false);
  expect(requiresMembership("qianguanjia.disconnect")).toBe(false);
});
it("returns cancellation even if the CDP connection never settles", async () => {
  const f = fixture(), sessionId = await select(f.service), requestId = randomUUID();
  f.connect.mockImplementation(() => new Promise(() => {}));
  const work = f.service.run({ kind: "accounts", sessionId, requestId }, 10);
  const result = Promise.race([work.then(() => "resolved", error => error.message), new Promise<string>(resolve => setTimeout(() => resolve("hung"), 200))]);
  await vi.waitFor(() => expect(f.connect).toHaveBeenCalled());
  f.service.cancel({ requestId }, 10);
  expect(await result).toMatch(/已取消/);
});
it("settles a stalled browser read and hides cleanup errors", async () => {
  const f = fixture(), sessionId = await select(f.service), requestId = randomUUID();
  f.list.mockImplementation(() => new Promise(() => {}));
  f.close.mockRejectedValue(new Error("private-secret-token"));
  const work = f.service.run({ kind: "accounts", sessionId, requestId }, 10);
  const result = Promise.race([work.then(() => "resolved", error => error.message), new Promise<string>(resolve => setTimeout(() => resolve("hung"), 200))]);
  await vi.waitFor(() => expect(f.list).toHaveBeenCalled());
  f.service.cancel({ requestId }, 10);
  expect(await result).toMatch(/已取消/);
  expect(await result).not.toContain("private-secret-token");
});
it("routes historical reads with pinned session and rejects invalid dates, writes and unknown accounts at the provider", async () => {
  const f=fixture(),sessionId=await select(f.service);
  const analysis=vi.fn(async (input:unknown)=>({source:'qianguanjia',scope:'supplier-product-account-report',observedAt:'2026-10-16T01:00:00Z',startDate:'2026-10-15',endDate:'2026-10-15',advertiserIds:['123'],page:1,limit:20,total:0,availability:'provided',rows:[]}));
  f.connect.mockImplementation(async()=>({adapter:{listAdvertisers:f.list,todayHomeSummary:f.home,analysis} as unknown as QianguanjiaReadonlyAdapter,close:f.close}));
  const input={kind:'report',sessionId,requestId:randomUUID(),startDate:'2026-10-15',endDate:'2026-10-15',advertiserIds:['123'],page:1,limit:20};
  for(const patch of [{startDate:'2026-02-30'},{endDate:'2026-12-15'},{advertiserIds:['123','123']},{page:0},{url:'https://evil.invalid'}]) await expect(f.service.run({...input,...patch},10)).rejects.toThrow(/参数/);
  expect(f.connect).not.toHaveBeenCalled();
  expect(await f.service.run(input,10)).toMatchObject({kind:'report',sessionId,data:{total:0}});
  expect(analysis).toHaveBeenCalledWith({kind:'report',startDate:'2026-10-15',endDate:'2026-10-15',advertiserIds:['123'],page:1,limit:20},expect.any(AbortSignal));
  await f.service.stop();
});
it("reads local materials independently of a supplier login and never connects a browser",async()=>{
 const f=fixture();f.service.setLocalMaterialReader(()=>[]);
 expect(await f.service.run({kind:'local-materials',requestId:randomUUID()},10)).toMatchObject({kind:'local-materials',tasks:[]});
 expect(f.discover).not.toHaveBeenCalled();expect(f.connect).not.toHaveBeenCalled();
});
it("fails closed when the local ledger projection is unavailable or contains private record fields",async()=>{
 const f=fixture();
 await expect(f.service.run({kind:'local-materials',requestId:randomUUID()},10)).rejects.toThrow(/未完成/);
 f.service.setLocalMaterialReader(()=>[{snapshotPath:'/private/path',config:{token:'private-secret'}} as any]);
 await expect(f.service.run({kind:'local-materials',requestId:randomUUID()},10)).rejects.toThrow(/^千管家读取未完成/);
 expect(f.connect).not.toHaveBeenCalled();
});
it("does not invalidate an unrelated supplier connection after a local ledger failure",async()=>{
 const f=fixture(),sessionId=await select(f.service);
 await f.service.run({kind:'accounts',sessionId,requestId:randomUUID()},10);
 await expect(f.service.run({kind:'local-materials',requestId:randomUUID()},10)).rejects.toThrow(/未完成/);
 expect(f.close).not.toHaveBeenCalled();
 await f.service.run({kind:'home',sessionId,requestId:randomUUID()},10);
 expect(f.connect).toHaveBeenCalledTimes(1);await f.service.stop();
});
