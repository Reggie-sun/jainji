import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanBrowserAccounts } from "../src/main/qianchuan-browser-accounts";
import { QianchuanRemoteRuntime, qianchuanRemoteRuntime } from "../src/main/qianchuan-remote-runtime";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("reads a main-account directory, then switches and reads the chosen child's plans without an extension", async () => {
  const anchor: FrozenQianchuanAccount = { product: "氨糖膏", advertiserId: "1876036793517065", adId: "123", cdpEndpoint: "http://127.0.0.1:9223", configDigest: "a".repeat(64) };
  const main = { advertiserId: anchor.advertiserId, name: "主账户" }, child = { advertiserId: "1876039035222536", name: "子账户-1" };
  let snapshot = { targetId: "ACTUAL-STRING-TARGET", browserContextId: "original-context", documentId: randomUUID(), account: main, gfversion: "fixture" };
  const verify = vi.fn(async () => {}), calls: string[] = [];
  const owner = new QianchuanBrowserAccounts("/unused", {
    resolve: async () => ({ identity: "verified-process:123:456", endpoint: "http://127.0.0.1:36895", verify }),
    session: (target, _verify, exclusions) => {
      expect(exclusions).toEqual(new Set(["protected-upload-page"]));
      return { current: async () => structuredClone(snapshot), call: async operation => {
      calls.push(operation.kind);
      if (operation.kind === "identity") return structuredClone(snapshot);
      if (operation.kind === "switch") { snapshot = { ...snapshot, documentId: randomUUID(), account: operation.chosen }; return structuredClone(snapshot); }
      if (operation.kind === "plans") return [{ advertiserId: snapshot.account.advertiserId, adId: "789", name: "子账户计划", accountSource: "current-browser" }];
      if (operation.path.endsWith("/info")) return { kind: "user-info", accountInfo: { advId: snapshot.account.advertiserId, advName: snapshot.account.name } };
      expect(target.cdpEndpoint).toBe("http://127.0.0.1:36895");
      return { kind: "user-list", accounts: [main, child], totalPages: 1, totalCount: 2, currentPage: 1 };
    } };
    },
  });
  const signal = new AbortController().signal, guard = vi.fn(async () => {});
  const exclusions = new Set(["protected-upload-page"]);
  const before = await owner.current(anchor, signal, exclusions), original = structuredClone(anchor);
  expect(before.account).toEqual(main);
  expect((await owner.accounts(before, signal, guard)).accounts).toEqual([main, child]);
  await expect(owner.switch(before, child.advertiserId, signal, guard)).resolves.toEqual({ account: child });
  const after = await owner.current(anchor, signal, exclusions);
  expect(after.identity).not.toBe(before.identity);
  expect(after.uploadEndpointVerified).toBe(true);
  expect((await owner.plans(after, signal, guard))[0]).toMatchObject({ advertiserId: child.advertiserId, adId: "789" });
  expect(calls.filter(value => value === "switch")).toHaveLength(1);
  expect(anchor).toEqual(original);
  expect(verify).toHaveBeenCalled(); expect(guard).toHaveBeenCalled();
});

it("rejects forged sessions and a changed original-browser proof before any account operation", async () => {
  const anchor: FrozenQianchuanAccount = { product: "氨糖膏", advertiserId: "123", adId: "456", cdpEndpoint: "http://127.0.0.1:9223", configDigest: "a".repeat(64) };
  let changed = false;
  const call = vi.fn(), snapshot = { targetId: "real-target", browserContextId: "original-context", documentId: randomUUID(), account: { advertiserId: "123", name: "main" }, gfversion: "fixture" };
  const owner = new QianchuanBrowserAccounts("/unused", {
    resolve: async () => ({ identity: "os-proof", endpoint: "http://127.0.0.1:36895", verify: async () => { if (changed) throw new Error("PID changed"); } }),
    session: () => ({ current: async () => snapshot, call }),
  });
  const signal = new AbortController().signal, session = await owner.current(anchor, signal);
  await expect(owner.accounts({ ...session }, signal, async () => {})).rejects.toThrow();
  changed = true;
  await expect(owner.accounts(session, signal, async () => {})).rejects.toThrow("PID changed");
  expect(call).not.toHaveBeenCalled();
});

it("rejects a changed browser context before a signed request even when the target and account remain", async () => {
  const anchor: FrozenQianchuanAccount = { product: "氨糖膏", advertiserId: "123", adId: "456", cdpEndpoint: "http://127.0.0.1:9223", configDigest: "a".repeat(64) };
  let snapshot = { targetId: "original-target", browserContextId: "original-context", documentId: randomUUID(), account: { advertiserId: "123", name: "main" }, gfversion: "fixture" };
  const call = vi.fn(async () => structuredClone(snapshot));
  const owner = new QianchuanBrowserAccounts("/unused", {
    resolve: async () => ({ identity: "os-proof", endpoint: "http://127.0.0.1:36895", verify: async () => {} }),
    session: () => ({ current: async () => structuredClone(snapshot), call }),
  });
  const signal = new AbortController().signal, session = await owner.current(anchor, signal);
  snapshot = { ...snapshot, browserContextId: "another-context" };
  await expect(owner.accounts(session, signal, async () => {})).rejects.toThrow();
  expect(call).toHaveBeenCalledOnce();
  expect(call.mock.calls[0]).toEqual([{ kind: "identity" }, signal]);
});

it("uses the saved VPS anchor for the verified tunnel while keeping the current child separate, without native RPC", async () => {
  const route = { mode: "remote-browser" as const, group: "future-vps", sshHost: "future-host", expectedIp: "8.8.8.8", localPort: 19381 };
  const anchor: FrozenQianchuanAccount = { product: "眼贴", advertiserId: "123", adId: "456", cdpEndpoint: "http://127.0.0.1:9225", configDigest: "a".repeat(64), egress: route };
  const metadata = { profile: "/original-profile", profileDirectory: "Default", processId: 42, startedAt: "1234", browser: { port: 34987, browserPath: "/devtools/browser/original" } };
  const profile = vi.spyOn(qianchuanRemoteRuntime, "browserProfile").mockResolvedValue(metadata);
  const attach = vi.spyOn(qianchuanRemoteRuntime, "attachMetadata").mockResolvedValue("http://127.0.0.1:19381");
  const extension = vi.spyOn(qianchuanRemoteRuntime, "extensionRequest").mockRejectedValue(new Error("native RPC must not run"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:19381/devtools/browser/original" }))));
  const child = { advertiserId: "789", name: "实际网页子账户" }, snapshot = { targetId: "real-target-id", browserContextId: "original-context", documentId: randomUUID(), account: child, gfversion: "fixture" };
  const call = vi.fn(async () => snapshot);
  const sessionFactory = vi.fn((target: FrozenQianchuanAccount) => {
    expect(target).toMatchObject({ advertiserId: "123", cdpEndpoint: "http://127.0.0.1:19381", egress: route });
    return { current: async () => snapshot, call };
  });
  const owner = new QianchuanBrowserAccounts("/unused", { session: sessionFactory }), signal = new AbortController().signal;
  expect((await owner.current(anchor, signal)).account).toEqual(child);
  expect(attach).toHaveBeenCalledWith(route, "123", metadata.browser, 0);
  expect(profile.mock.calls.every(args => args[1] === "123")).toBe(true);
  expect(extension).not.toHaveBeenCalled();

  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:19381/devtools/browser/replaced" })));
  await expect(owner.current(anchor, signal)).rejects.toThrow();
  expect(sessionFactory).toHaveBeenCalledTimes(1);
  expect(call).not.toHaveBeenCalled();
});

it("rebuilds a terminated channel for a new metadata observation without retrying the failed operation", async () => {
  const route = { mode: "remote-browser" as const, group: "future-vps", sshHost: "future-host", expectedIp: "8.8.8.8", localPort: 19381 };
  const metadata = { profile: "/original", profileDirectory: "Default", processId: 42, startedAt: "1234", browser: { port: 34987, browserPath: "/devtools/browser/original" } };
  const controller = new AbortController(), request = vi.fn(async () => metadata);
  const create = vi.fn(() => ({ route, controller: new AbortController(), request, close() {} }));
  const runtime = new QianchuanRemoteRuntime(create);
  Reflect.get(runtime, "channels").set(route.group, { route, controller, request, close() {} });
  controller.abort();
  expect(() => runtime.extensionRequest(route, "123", "extension-profile")).toThrow();
  expect(request).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  await expect(runtime.browserProfile(route, "123")).resolves.toEqual(metadata);
  expect(create).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith("browser-profile", "123", {}, undefined, undefined);
  await expect(runtime.browserProfile({ ...route, sshHost: "another-host" }, "123")).rejects.toThrow();
  expect(create).toHaveBeenCalledOnce(); expect(request).toHaveBeenCalledOnce();
});

it("does not rebuild observation transport while an old browser lease has not terminated", async () => {
  const route = { mode: "remote-browser" as const, group: "future-vps", sshHost: "future-host", expectedIp: "8.8.8.8", localPort: 19381 };
  const channel = { route, controller: new AbortController(), request: vi.fn(), close: vi.fn() }, lease = new AbortController();
  const create = vi.fn(() => channel), runtime = new QianchuanRemoteRuntime(create);
  Reflect.get(runtime, "channels").set(route.group, channel);
  Reflect.get(runtime, "browsers").set("123", { route, advertiserId: "123", controller: lease });
  channel.controller.abort();
  await expect(runtime.browserProfile(route, "123")).rejects.toThrow();
  expect(create).not.toHaveBeenCalled(); expect(channel.close).not.toHaveBeenCalled();
  expect(lease.signal.aborted).toBe(false);
  expect(Reflect.get(runtime, "browsers").has("123")).toBe(true);
});
