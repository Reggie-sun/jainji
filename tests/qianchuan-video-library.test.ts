import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanVideoLibrary } from "../src/main/qianchuan-video-library";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
import { QianchuanLibraryClearSchema } from "../src/shared/qianchuan-video-library";
import * as uploadStore from "../src/main/douyin-upload-store";
import { chromium, type Browser } from "playwright-core";
import * as transport from "../src/main/local-cdp-transport";
import { connectVideoLibrary } from "../src/main/qianchuan-video-library-browser";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const target = { product: "蝴蝶贴", advertiserId: "1876024170199244", adId: "123", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) } as FrozenQianchuanAccount;
async function fixture(count = 45) {
  const root = await mkdtemp(path.join(tmpdir(), "library-clear-")); roots.push(root);
  let ids = Array.from({ length: count }, (_, index) => `${7000 + index}`);
  const snapshot = () => ({ total: ids.length, ids: ids.slice(0, 20) });
  const page = {
    open: vi.fn(async () => {}), read: vi.fn(async () => snapshot()), refresh: vi.fn(async () => snapshot()),
    inventory: vi.fn(async () => ({ total: ids.length, ids: [...ids] })),
    deleteBatch: vi.fn(async (before: ReturnType<typeof snapshot>, beforeConfirm: () => Promise<void>) => {
      await beforeConfirm();
      const directory = path.join(root, "video-library-deletions");
      const audit = (await readdir(directory)).find(name => !name.includes("."))!;
      const intents = (await readdir(path.join(directory, audit))).filter(name => name.endsWith(".intent.json"));
      expect(intents.length).toBeGreaterThan(0);
      expect(JSON.parse(await readFile(path.join(directory, audit, intents[intents.length - 1]), "utf8")).before).toEqual(before);
      ids = ids.filter(id => !before.ids.includes(id));
    }),
  };
  const close = vi.fn(async () => {}), connect = vi.fn(async () => ({ page, close }));
  return { root, page, connect, close, library: new QianchuanVideoLibrary(root, connect), snapshot };
}
it("requires explicit confirmation and unique saved-account identities, rejects arbitrary browser input", () => {
  const input = { confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: target.product, expectedAdvertiserId: target.advertiserId }] };
  expect(QianchuanLibraryClearSchema.parse(input)).toEqual(input);
  for (const invalid of [{ ...input, confirmation: false }, { ...input, accounts: [...input.accounts, ...input.accounts] }, { ...input, cdpEndpoint: target.cdpEndpoint }, { ...input, accounts: [] }]) expect(() => QianchuanLibraryClearSchema.parse(invalid)).toThrow();
});
it("clears shifting first pages once, synchronizes each intent before confirmation and reuses the final refreshed empty result", async () => {
  const f = await fixture();
  const result = await f.library.clear(target, async () => {});
  expect(result).toMatchObject({ state: "CLEARED", deletedCount: 45 });
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(3); expect(f.page.refresh).toHaveBeenCalledTimes(3);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect((await readdir(path.join(f.root, "video-library-deletions"))).some(name => name.endsWith(".pending.json"))).toBe(false);
});
it("records and verifies an empty library without selecting or confirming anything", async () => {
  const f = await fixture(0);
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "CLEARED", deletedCount: 0 });
  expect(f.page.deleteBatch).not.toHaveBeenCalled(); expect(f.page.refresh).not.toHaveBeenCalled();
});
it("synchronizes the deletion directory and audit parent entries before confirmation", async () => {
  const f = await fixture(1), synced: string[] = [];
  const original = uploadStore.strictSyncDirectory;
  vi.spyOn(uploadStore, "strictSyncDirectory").mockImplementation(async directory => { await original(directory); synced.push(directory); });
  const remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementation(async (before, confirm) => {
    await remove(before, async () => {
      await confirm();
      const directory = path.join(f.root, "video-library-deletions");
      expect(synced[0]).toBe(f.root);
      expect(synced.filter(value => value === directory)).toHaveLength(2);
    });
  });
  expect((await f.library.clear(target, async () => {})).state).toBe("CLEARED");
});
it.each(["root", "audit"])("refuses confirmation when persisting the %s parent-directory entry fails", async kind => {
  const f = await fixture(1), original = uploadStore.strictSyncDirectory;
  let deletionSyncs = 0;
  vi.spyOn(uploadStore, "strictSyncDirectory").mockImplementation(async directory => {
    if (kind === "root" && directory === f.root || kind === "audit" && directory === path.join(f.root, "video-library-deletions") && ++deletionSyncs === 2) throw new Error("parent sync failed");
    await original(directory);
  });
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", deletedCount: 0, message: "parent sync failed" });
  expect(f.connect).not.toHaveBeenCalled(); expect(f.page.deleteBatch).not.toHaveBeenCalled();
});
it("aborts before confirmation if stop arrives while durable intent is synchronizing", async () => {
  const f = await fixture(1), controller = new AbortController(), original = uploadStore.strictSyncDirectory;
  let entered!: () => void, release!: () => void, auditSyncs = 0;
  const waiting = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(uploadStore, "strictSyncDirectory").mockImplementation(async directory => {
    if (path.dirname(directory) === path.join(f.root, "video-library-deletions") && ++auditSyncs === 2) { entered(); await hold; }
    await original(directory);
  });
  const work = f.library.clear(target, async () => {}, controller.signal);
  await waiting; controller.abort(); release();
  expect((await work).state).toBe("BLOCKED"); expect(f.snapshot().total).toBe(1);
});
it("preserves a confirmation-outcome fence across a new controller and refuses duplicate deletion", async () => {
  const f = await fixture();
  f.page.deleteBatch.mockImplementationOnce(async (_before, confirm) => { await confirm(); throw new Error("connection lost after click"); });
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", deletedCount: 0 });
  const restarted = new QianchuanVideoLibrary(f.root, f.connect);
  expect((await restarted.clear(target, async () => {})).message).toContain("删除屏障");
  expect(f.connect).toHaveBeenCalledTimes(2); expect(f.page.deleteBatch).toHaveBeenCalledTimes(1);
});
it("rejects partial or concurrent count changes and never deletes the next page", async () => {
  const f = await fixture();
  f.page.refresh.mockResolvedValueOnce({ total: 26, ids: ["9999"] });
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", deletedCount: 0 });
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(1);
  expect((await readdir(path.join(f.root, "video-library-deletions"))).some(name => name.endsWith(".pending.json"))).toBe(true);
});
it("refuses unavailable authority before connecting and can release only a never-confirmed attempt", async () => {
  const f = await fixture();
  expect(await f.library.clear(target, async () => { throw new Error("mapping changed"); })).toMatchObject({ state: "BLOCKED", deletedCount: 0, message: "mapping changed" });
  expect(f.connect).not.toHaveBeenCalled();
  expect((await readdir(path.join(f.root, "video-library-deletions"))).some(name => name.endsWith(".pending.json"))).toBe(false);
});
it("keeps known verified progress when a subsequent batch has unknown outcome", async () => {
  const f = await fixture();
  const original = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(original).mockImplementationOnce(async (_before, confirm) => { await confirm(); throw new Error("unknown"); });
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", deletedCount: 20 });
});
it("reports a proven empty library separately from a failed connection release and preserves its gate", async () => {
  const f = await fixture();
  f.close.mockRejectedValue(new Error("detach failed"));
  const result = await f.library.clear(target, async () => {});
  expect(result).toMatchObject({ state: "BLOCKED", deletedCount: 45, message: expect.stringContaining("已核验清空") });
  expect((await readdir(path.join(f.root, "video-library-deletions"))).some(name => name.endsWith(".pending.json"))).toBe(true);
  expect((await new QianchuanVideoLibrary(f.root, f.connect).clear(target, async () => {})).state).toBe("BLOCKED");
  expect(f.connect).toHaveBeenCalledTimes(1);
});
it("reconciles a lost first confirmation only from complete absence and exact count evidence, preserving the original intent", async () => {
  const f = await fixture(), remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(async (before, confirm) => { await remove(before, confirm); throw new Error("response lost"); });
  expect((await f.library.clear(target, async () => {})).state).toBe("BLOCKED");
  const directory = path.join(f.root, "video-library-deletions"), attempt = (await readdir(directory)).find(name => !name.includes("."))!;
  const intent = await readFile(path.join(directory, attempt, "0.intent.json"));
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "CLEARED", deletedCount: 45 });
  expect(f.page.inventory).toHaveBeenCalledTimes(1);
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(3);
  expect(await readFile(path.join(directory, attempt, "0.intent.json"))).toEqual(intent);
  expect(JSON.parse(await readFile(path.join(directory, attempt, "0.verified.json"), "utf8")).reconciled).toBe(true);
});
it("reconciles only the last unresolved intent after validating the complete prior audit chain", async () => {
  const f = await fixture(), remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(remove).mockImplementationOnce(async (before, confirm) => { await remove(before, confirm); throw new Error("lost second response"); });
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", deletedCount: 20 });
  const directory = path.join(f.root, "video-library-deletions"), attempt = (await readdir(directory)).find(name => !name.includes("."))!;
  const intent = await readFile(path.join(directory, attempt, "1.intent.json"));
  const verified = await readFile(path.join(directory, attempt, "0.verified.json"));
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "CLEARED", deletedCount: 45 });
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(3);
  expect(await readFile(path.join(directory, attempt, "1.intent.json"))).toEqual(intent);
  expect(await readFile(path.join(directory, attempt, "0.verified.json"))).toEqual(verified);
  expect(JSON.parse(await readFile(path.join(directory, attempt, "1.verified.json"), "utf8")).reconciled).toBe(true);
});
it.each(["page", "inventory"])("preserves prior verified progress when last-batch recovery fails in %s observation", async kind => {
  const f = await fixture(), remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(remove).mockImplementationOnce(async (before, confirm) => { await remove(before, confirm); throw new Error("lost second response"); });
  await f.library.clear(target, async () => {});
  if (kind === "page") f.page.open.mockRejectedValueOnce(new Error("page unavailable"));
  else f.page.inventory.mockRejectedValueOnce(new Error("inventory unavailable"));
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", deletedCount: 20 });
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(2);
  const directory = path.join(f.root, "video-library-deletions"), attempt = (await readdir(directory)).find(name => !name.includes("."))!;
  expect(await readdir(path.join(directory, attempt))).not.toContain("1.verified.json");
  expect(await readdir(directory)).toContain(target.advertiserId + ".pending.json");
});
it("refuses a last-batch recovery when a prior verified record disagrees with its intent", async () => {
  const f = await fixture(), remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(remove).mockImplementationOnce(async (before, confirm) => { await remove(before, confirm); throw new Error("lost"); });
  await f.library.clear(target, async () => {});
  const directory = path.join(f.root, "video-library-deletions"), attempt = (await readdir(directory)).find(name => !name.includes("."))!;
  const file = path.join(directory, attempt, "0.verified.json"), value = JSON.parse(await readFile(file, "utf8"));
  value.removedIds[0] = "9999"; await writeFile(file, JSON.stringify(value));
  expect((await f.library.clear(target, async () => {})).state).toBe("BLOCKED");
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(2); expect(f.page.inventory).not.toHaveBeenCalled();
});
it.each(["prior audit drift", "prior ID reappears"])("refuses last-batch recovery after %s without another confirmation", async kind => {
  const f = await fixture(), remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(remove).mockImplementationOnce(async (before, confirm) => { await remove(before, confirm); throw new Error("lost"); });
  await f.library.clear(target, async () => {});
  const directory = path.join(f.root, "video-library-deletions"), attempt = (await readdir(directory)).find(name => !name.includes("."))!;
  if (kind === "prior ID reappears") f.page.inventory.mockResolvedValue({ total: 5, ids: ["7000", "7041", "7042", "7043", "7044"] });
  let guards = 0;
  expect((await f.library.clear(target, async () => {
    if (kind === "prior audit drift" && ++guards === 3) {
      const file = path.join(directory, attempt, "0.verified.json");
      await writeFile(file, await readFile(file, "utf8") + " ");
    }
  })).state).toBe("BLOCKED");
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(2);
  expect(await readdir(path.join(directory, attempt))).not.toContain("1.verified.json");
});
it("observes stale rows at the expected new count without repeating the confirmation", async () => {
  const f = await fixture();
  f.page.refresh.mockResolvedValueOnce({ total: 25, ids: Array.from({ length: 20 }, (_, i) => String(7000 + i)) });
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "CLEARED", deletedCount: 45 });
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(3);
});
it("never resumes an ambiguous batch whose IDs remain anywhere in the complete library", async () => {
  const f = await fixture(), remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(async (before, confirm) => { await remove(before, confirm); throw new Error("response lost"); });
  await f.library.clear(target, async () => {});
  f.page.inventory.mockResolvedValue({ total: 25, ids: Array.from({length:25}, (_,i)=>String(7000+i)) });
  expect((await f.library.clear(target, async () => {})).state).toBe("BLOCKED");
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(1);
});
it("observes delayed count visibility without repeating confirmation", async () => {
  const f = await fixture(1);
  f.page.refresh.mockResolvedValueOnce({total:1,ids:["7000"]});
  expect(await f.library.clear(target, async () => {})).toMatchObject({state:"CLEARED",deletedCount:1});
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(1);
});
it("blocks reconciliation if its original audit changes during inventory", async () => {
  const f = await fixture(), remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(async (before, confirm) => { await remove(before, confirm); throw new Error("lost"); });
  await f.library.clear(target, async () => {});
  const inventory = f.page.inventory.getMockImplementation()!;
  f.page.inventory.mockImplementation(async () => {
    const directory = path.join(f.root,"video-library-deletions"), attempt = (await readdir(directory)).find(name=>!name.includes("."))!;
    const file = path.join(directory,attempt,"0.intent.json");
    const {writeFile} = await import("node:fs/promises"); await writeFile(file,await readFile(file,"utf8")+" ");
    return inventory();
  });
  expect((await f.library.clear(target,async()=>{})).state).toBe("BLOCKED");
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(1);
});
it("blocks reconciliation when the final configuration guard changes the original intent", async () => {
  const f = await fixture(), remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(async (before, confirm) => { await remove(before, confirm); throw new Error("lost"); });
  await f.library.clear(target, async () => {});
  const directory = path.join(f.root, "video-library-deletions"), attempt = (await readdir(directory)).find(name => !name.includes("."))!;
  const file = path.join(directory, attempt, "0.intent.json");
  let guards = 0;
  const result = await f.library.clear(target, async () => {
    if (++guards === 3) await writeFile(file, await readFile(file, "utf8") + " ");
  });
  expect(result.state).toBe("BLOCKED");
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(1);
  expect(await readdir(path.join(directory, attempt))).not.toContain("0.verified.json");
  expect(await readdir(directory)).toContain(target.advertiserId + ".pending.json");
});
it("rejects a correct count arriving after the observation deadline without confirming another batch", async () => {
  const f = await fixture(); let clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  f.page.refresh.mockImplementationOnce(async () => { clock += 31000; return f.snapshot(); });
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", deletedCount: 0 });
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(1);
});
it("keeps verified progress and reports a failed operation-lock directory sync", async () => {
  const f = await fixture(1), original = uploadStore.strictSyncDirectory;
  const directory = path.join(f.root, "video-library-deletions");
  vi.spyOn(uploadStore, "strictSyncDirectory").mockImplementation(async value => {
    if (value === directory && !(await readdir(directory)).some(name => name.endsWith(".operation.lock"))) throw new Error("lock sync failed");
    await original(value);
  });
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", deletedCount: 1, message: expect.stringContaining("操作锁释放失败") });
});
it("serializes active clearing before a second caller can reconcile or confirm", async () => {
  const f = await fixture(); let entered!:()=>void,release!:()=>void;
  const started = new Promise<void>(resolve=>{entered=resolve}),hold=new Promise<void>(resolve=>{release=resolve});
  const remove=f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(async(before,confirm)=>{entered();await hold;await remove(before,confirm)});
  const work=f.library.clear(target,async()=>{});await started;
  try {expect((await new QianchuanVideoLibrary(f.root,f.connect).clear(target,async()=>{})).state).toBe("BLOCKED");expect(f.connect).toHaveBeenCalledTimes(1)}
  finally {release()}
  expect((await work).state).toBe("CLEARED");
});
it("refuses recovery under a different current mapping digest", async () => {
  const f=await fixture();f.page.deleteBatch.mockImplementationOnce(async(_before,confirm)=>{await confirm();throw new Error("lost")});
  await f.library.clear(target,async()=>{});
  expect((await f.library.clear({...target,configDigest:"e".repeat(64)},async()=>{})).state).toBe("BLOCKED");
  expect(f.connect).toHaveBeenCalledTimes(1);expect(f.page.deleteBatch).toHaveBeenCalledTimes(1);
});
it("reuses the same matching library tab across connections and preserves upload pages", async () => {
  const original = {url:()=>"https://qianchuan.jinritemai.com/uni-prom?aavid="+target.advertiserId};
  const library = {url:()=>"https://qianchuan.jinritemai.com/tools/creative-management/video-library?aavid="+target.advertiserId,isClosed:()=>false,setDefaultTimeout:vi.fn()};
  const wrong = {url:()=>"https://qianchuan.jinritemai.com/tools/creative-management/video-library?aavid=999",isClosed:()=>false};
  const newPage=vi.fn(async()=>library),close=vi.fn(async()=>{}),context={pages:()=>[original,wrong,library],newPage};
  vi.spyOn(globalThis,"fetch").mockImplementation(async()=>new Response(JSON.stringify({webSocketDebuggerUrl:"ws://127.0.0.1:42001/devtools/browser/test"})));
  vi.spyOn(transport,"guardedTransport").mockResolvedValue({url:"ws://127.0.0.1:42002/relay",close:async()=>{}});
  vi.spyOn(chromium,"connectOverCDP").mockResolvedValue({contexts:()=>[context],close} as unknown as Browser);
  for(let i=0;i<2;i++){const connection=await connectVideoLibrary(target.cdpEndpoint,target.advertiserId,new AbortController().signal);await connection.close()}
  expect(newPage).not.toHaveBeenCalled();expect(library.setDefaultTimeout).toHaveBeenCalledTimes(2);expect(close).toHaveBeenCalledTimes(2);
});

it("resumes an already verified chain after selection failed before the next intent without rescanning inventory", async () => {
  const f = await fixture();
  const remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(remove).mockImplementationOnce(async () => { throw new Error("selection blocked"); });
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", deletedCount: 20 });
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "CLEARED", deletedCount: 45 });
  expect(f.page.inventory).not.toHaveBeenCalled();
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(4);
});
