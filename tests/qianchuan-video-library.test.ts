import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanVideoLibrary } from "../src/main/qianchuan-video-library";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
import { QianchuanLibraryClearSchema } from "../src/shared/qianchuan-video-library";
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
    deleteBatch: vi.fn(async (before: ReturnType<typeof snapshot>, beforeConfirm: () => Promise<void>) => {
      await beforeConfirm();
      expect(JSON.parse(await readFile(path.join(root, "video-library-deletions", target.advertiserId + ".pending.json"), "utf8")).advertiserId).toBe(target.advertiserId);
      ids = ids.filter(id => !before.ids.includes(id));
    }),
  };
  const close = vi.fn(async () => {}), connect = vi.fn(async () => ({ page, close }));
  return { root, page, connect, close, library: new QianchuanVideoLibrary(root, connect), snapshot };
}
it("requires explicit confirmation and unique saved-account identities", () => {
  const input = { confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: target.product, expectedAdvertiserId: target.advertiserId }] };
  expect(QianchuanLibraryClearSchema.parse(input)).toEqual(input);
  expect(() => QianchuanLibraryClearSchema.parse({ ...input, accounts: [...input.accounts, ...input.accounts] })).toThrow();
  expect(() => QianchuanLibraryClearSchema.parse({ ...input, cdpEndpoint: target.cdpEndpoint })).toThrow();
});
it("requires the expected saved plan for every plan-material cleanup and keeps legacy library input compatible", () => {
  const account = { product: target.product, expectedAdvertiserId: target.advertiserId, expectedAdId: target.adId };
  for (const confirmation of ["DELETE_PLAN_MATERIALS", "DELETE_VIDEOS_AND_PLAN_MATERIALS"]) {
    expect(QianchuanLibraryClearSchema.parse({ confirmation, accounts: [account] })).toEqual({ confirmation, accounts: [account] });
    expect(() => QianchuanLibraryClearSchema.parse({ confirmation, accounts: [{ product: target.product, expectedAdvertiserId: target.advertiserId }] })).toThrow();
  }
});
it("clears current pages and consumes the final zero once without an extra refresh or video backup", async () => {
  const f = await fixture();
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "CLEARED", deletedCount: 45 });
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(3); expect(f.page.refresh).toHaveBeenCalledTimes(3);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect((await readdir(path.join(f.root, "video-library-deletions"))).some(name => name.endsWith(".pending.json"))).toBe(false);
});
it("does not select, confirm or refresh an initially empty list", async () => {
  const f = await fixture(0);
  expect((await f.library.clear(target, async () => {})).state).toBe("CLEARED");
  expect(f.page.deleteBatch).not.toHaveBeenCalled(); expect(f.page.refresh).not.toHaveBeenCalled();
});
it("continues after a partially removed batch instead of requiring an exact selected-count decrease", async () => {
  const f = await fixture(), remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(async (before, confirm) => remove({ ...before, ids: before.ids.slice(0, 10) }, confirm));
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "CLEARED", deletedCount: 45 });
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(3);
});
it("stops when the platform makes no progress", async () => {
  const f = await fixture();
  f.page.deleteBatch.mockImplementationOnce(async (_before, confirm) => { await confirm(); });
  expect((await f.library.clear(target, async () => {})).state).toBe("BLOCKED");
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(1);
});
it("new explicit clear reads the remaining list and preserves historical audit bytes", async () => {
  const f = await fixture(), remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(async (before, confirm) => { await remove(before, confirm); throw new Error("response lost"); });
  expect((await f.library.clear(target, async () => {})).state).toBe("BLOCKED");
  const gate = path.join(f.root, "video-library-deletions", target.advertiserId + ".pending.json");
  const original = await readFile(gate);
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "CLEARED", deletedCount: 25 });
  expect(f.page.deleteBatch).toHaveBeenCalledTimes(3);
  expect(JSON.parse(original.toString()).advertiserId).toBe(target.advertiserId);
});
it("refuses a pending marker for a different account before another confirmation", async () => {
  const f = await fixture();
  f.page.deleteBatch.mockImplementationOnce(async (_before, confirm) => { await confirm(); throw new Error("lost"); });
  await f.library.clear(target, async () => {});
  const gate = path.join(f.root, "video-library-deletions", target.advertiserId + ".pending.json");
  const value = JSON.parse(await readFile(gate, "utf8")); value.advertiserId = "999"; await writeFile(gate, JSON.stringify(value));
  expect((await f.library.clear(target, async () => {})).state).toBe("BLOCKED");
});
it("rejects configuration drift before deletion", async () => {
  const f = await fixture();
  expect((await f.library.clear(target, async () => { throw new Error("mapping changed"); })).state).toBe("BLOCKED");
  expect(f.page.deleteBatch).not.toHaveBeenCalled();
});
it("keeps successful progress when a later batch fails", async () => {
  const f = await fixture(), remove = f.page.deleteBatch.getMockImplementation()!;
  f.page.deleteBatch.mockImplementationOnce(remove).mockImplementationOnce(async () => { throw new Error("platform unavailable"); });
  expect(await f.library.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", deletedCount: 20 });
});
it("reuses the same matching library tab across connections and preserves upload pages", async () => {
  const original = { url: () => "https://qianchuan.jinritemai.com/uni-prom?aavid=" + target.advertiserId };
  const library = { url: () => "https://qianchuan.jinritemai.com/tools/creative-management/video-library?aavid=" + target.advertiserId, isClosed: () => false, setDefaultTimeout: vi.fn() };
  const context = { pages: () => [original, library], newPage: vi.fn(async () => library) }, close = vi.fn(async () => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:42001/devtools/browser/test" })));
  vi.spyOn(transport, "guardedTransport").mockResolvedValue({ url: "ws://127.0.0.1:42002/relay", close: async () => {} });
  vi.spyOn(chromium, "connectOverCDP").mockResolvedValue({ contexts: () => [context], close } as unknown as Browser);
  for (let index = 0; index < 2; index++) { const connection = await connectVideoLibrary(target.cdpEndpoint, target.advertiserId, new AbortController().signal); await connection.close(); }
  expect(context.newPage).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(2);
});
