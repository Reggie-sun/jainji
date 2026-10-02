import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanVideoLibrary } from "../src/main/qianchuan-video-library";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
import { QianchuanLibraryClearSchema } from "../src/shared/qianchuan-video-library";
import * as uploadStore from "../src/main/douyin-upload-store";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const target = { product: "蝴蝶贴", advertiserId: "1876024170199244", adId: "123", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) } as FrozenQianchuanAccount;
async function fixture(count = 45) {
  const root = await mkdtemp(path.join(tmpdir(), "library-clear-")); roots.push(root);
  let ids = Array.from({ length: count }, (_, index) => `${7000 + index}`);
  const snapshot = () => ({ total: ids.length, ids: ids.slice(0, 20) });
  const page = {
    open: vi.fn(async () => {}), read: vi.fn(async () => snapshot()), refresh: vi.fn(async () => snapshot()),
    deleteBatch: vi.fn(async (before: ReturnType<typeof snapshot>, beforeConfirm: () => Promise<void>) => {
      await beforeConfirm();
      const directory = path.join(root, "video-library-deletions");
      const audit = (await readdir(directory)).find(name => !name.endsWith(".json"))!;
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
it("clears shifting first pages once, synchronizes each intent before confirmation and proves an independently refreshed empty library", async () => {
  const f = await fixture();
  const result = await f.library.clear(target, async () => {});
  expect(result).toMatchObject({ state: "CLEARED", deletedCount: 45 });
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(3); expect(f.page.refresh).toHaveBeenCalledTimes(4);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect((await readdir(path.join(f.root, "video-library-deletions"))).some(name => name.endsWith(".pending.json"))).toBe(false);
});
it("records and verifies an empty library without selecting or confirming anything", async () => {
  const f = await fixture(0);
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "CLEARED", deletedCount: 0 });
  expect(f.page.deleteBatch).not.toHaveBeenCalled(); expect(f.page.refresh).toHaveBeenCalledTimes(1);
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
  expect(f.connect).toHaveBeenCalledTimes(1); expect(f.page.deleteBatch).toHaveBeenCalledTimes(1);
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
