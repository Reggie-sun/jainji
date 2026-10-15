import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { DouyinUploadService } from "../src/main/douyin-upload-service";
import { DouyinUploadStore } from "../src/main/douyin-upload-store";
import type { FrozenQianchuanAccount, QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";

const target: FrozenQianchuanAccount = { product: "蝴蝶贴", advertiserId: "12345", adId: "67890", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) };
const request = () => ({ product: target.product, expectedAdvertiserId: target.advertiserId, requestId: randomUUID() });
function fixture() {
  const preflight = vi.fn(async () => target), freeze = vi.fn(async () => target);
  const accounts = { preflight, freeze } as unknown as QianchuanAccountConfigReader;
  const service = new DouyinUploadService(new DouyinUploadStore("/unused-integration-fixture"), {
    accounts, loadBatch: async () => { throw new Error("no production"); }, browser: () => { throw new Error("no upload"); },
  });
  return { service, preflight, freeze };
}
it("reserves the original resource owner before awaiting and excludes all other account operations", async () => {
  const { service } = fixture(), input = request();
  let release!: () => void;
  const pending = service.withAccountOperation(input, 7, async () => new Promise<void>(resolve => { release = resolve; }));
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(service.busy).toBe(true);
  await expect(service.withAccountOperation(request(), 8, async () => undefined)).rejects.toThrow("尚未空闲");
  await expect(service.saveAccount({})).rejects.toThrow("报表或投放");
  await expect(service.openAccountBrowser({})).rejects.toThrow("报表或投放");
  await expect(service.refreshAccounts()).rejects.toThrow("报表或投放");
  await expect(service.configure({})).rejects.toThrow("报表或投放");
  expect(() => service.queryBackend({})).toThrow("尚未空闲");
  release(); await pending;
  expect(service.busy).toBe(false);
});
it("binds cancellation to its sender and keeps the lease until cancelled work drains", async () => {
  const { service, freeze } = fixture(), input = request();
  let release!: () => void, observed!: AbortSignal;
  const pending = service.withAccountOperation(input, 7, async signal => {
    observed = signal; await new Promise<void>(resolve => { release = resolve; }); return "late";
  });
  void pending.catch(() => undefined);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  service.cancelAccountOperation({ requestId: input.requestId }, 8);
  expect(observed.aborted).toBe(false);
  service.cancelAccountOperation({ requestId: input.requestId }, 7);
  expect(observed.aborted).toBe(true); expect(service.busy).toBe(true);
  release(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(freeze).not.toHaveBeenCalled(); expect(service.busy).toBe(false);
});
it("rejects a stale advertiser before work and rejects configuration drift after work", async () => {
  const f = fixture(), work = vi.fn(async () => "value");
  await expect(f.service.withAccountOperation({ ...request(), expectedAdvertiserId: "999" }, 7, work)).rejects.toThrow("变化");
  expect(work).not.toHaveBeenCalled();
  f.freeze.mockResolvedValue({ ...target, configDigest: "e".repeat(64) });
  await expect(f.service.withAccountOperation(request(), 7, work)).rejects.toThrow("变化");
  expect(f.service.busy).toBe(false);
});
it("the original stop cancels and drains a report without touching upload state", async () => {
  const { service } = fixture(); let entered = false;
  const pending = service.withAccountOperation(request(), 7, async signal => {
    entered = true;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    signal.throwIfAborted();
  });
  void pending.catch(() => undefined);
  await vi.waitFor(() => expect(entered).toBe(true));
  await expect(service.stop()).resolves.toBe(true);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(service.store.tasks()).toEqual([]); expect(service.busy).toBe(false);
});

it("does not enter the live child-account directory while a report owns the account lease", async () => {
  const accounts = new QianchuanAccountSettings("/unused-integration-directory-fixture");
  vi.spyOn(accounts, "preflight").mockResolvedValue(target);
  vi.spyOn(accounts, "freeze").mockResolvedValue(target);
  const directory = vi.spyOn(accounts, "listSubaccounts").mockResolvedValue({ current: { advertiserId: target.advertiserId, name: "fixture" }, accounts: [{ advertiserId: target.advertiserId, name: "fixture" }] } as any);
  const service = new DouyinUploadService(new DouyinUploadStore("/unused-integration-fixture"), {
    accounts, loadBatch: async () => { throw new Error("no production"); }, browser: () => { throw new Error("no upload"); },
  });
  let release!: () => void;
  const pending = service.withAccountOperation(request(), 7, async () => new Promise<void>(resolve => { release = resolve; }));
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  try {
    await expect(service.listSubaccounts({ product: target.product, expectedAdvertiserId: target.advertiserId })).rejects.toThrow("报表或投放");
    expect(directory).not.toHaveBeenCalled();
  } finally { release(); await pending; }
});
