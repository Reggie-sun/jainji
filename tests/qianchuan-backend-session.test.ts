import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { readQianchuanBackendQuery } from "../src/main/qianchuan-backend-query";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
const mocks = vi.hoisted(() => ({ egress: vi.fn(async () => undefined), page: vi.fn() }));
vi.mock("../src/main/qianchuan-egress-browser.js", () => ({ verifyBrowserEgress: mocks.egress }));
vi.mock("../src/main/qianchuan-query-page.js", () => ({ withQianchuanQueryPage: mocks.page }));
const target: FrozenQianchuanAccount = { product: "眼贴", advertiserId: "12345", adId: "67890", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) };
const query = () => ({ kind: "plan" as const, product: target.product, expectedAdvertiserId: target.advertiserId, adId: target.adId, requestId: randomUUID() });
it.each(["connection", "navigation"])("never returns private %s errors through the bridge", async stage => {
  const privateError = new Error("ws://127.0.0.1:42001/private-token?cookie=secret");
  if (stage === "connection") mocks.page.mockRejectedValueOnce(privateError);
  else mocks.page.mockImplementationOnce(async (_target, _signal, read) => read({ goto: async () => { throw privateError; } }));
  await expect(readQianchuanBackendQuery(target, query(), new AbortController().signal)).rejects.toThrow("千川查询失败，请检查账号网页、登录状态和网络连接。");
});
it("rejects a mismatched account before opening a browser", async () => {
  mocks.egress.mockClear();
  await expect(readQianchuanBackendQuery(target, { ...query(), expectedAdvertiserId: "99999" }, new AbortController().signal)).rejects.toThrow("广告账户已变化");
  expect(mocks.egress).not.toHaveBeenCalled();
});
it("preserves cancellation instead of turning it into a retryable connection error", async () => {
  const controller = new AbortController();
  mocks.page.mockImplementationOnce(async () => { controller.abort(); throw new Error("private-token"); });
  await expect(readQianchuanBackendQuery(target, query(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});
