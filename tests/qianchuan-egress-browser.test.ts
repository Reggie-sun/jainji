import { createServer, type Socket } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { chromium } from "playwright-core";
import { egressIdentity } from "../src/shared/qianchuan-egress.js";
import type { RunningChromeBrowser } from "../src/main/qianchuan-browser-discovery.js";
import { assertEgressArguments, chromeEgressArguments, verifyBrowserEgress } from "../src/main/qianchuan-egress-browser";
import { accountChromeArguments } from "../src/main/qianchuan-browser-manager";
import * as egressProbe from "../src/main/qianchuan-egress-probe.js";
import { BrowserEgressProbeError, probeChromeEgress } from "../src/main/qianchuan-egress-probe.js";
import { QianchuanEgressRuntime, qianchuanEgressRuntime } from "../src/main/qianchuan-egress-runtime.js";

const route = { group: "主体一", sshHost: "shop-one", localPort: 19381, expectedIp: "203.0.113.11" };
const endpoint = "http://127.0.0.1:9222";
const stableChrome = (overrides: Partial<RunningChromeBrowser> = {}): RunningChromeBrowser => ({
  endpoint,
  profile: "/tmp/qianchuan-account-profile",
  profileDirectory: "Default",
  windowClass: "account-200",
  processId: 4521,
  startedAt: "882910",
  egressArguments: ["--proxy-server=socks5://127.0.0.1:19381", "--proxy-bypass-list=<-loopback>", "--disable-quic",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
  ...overrides,
});
function testLease(controller = new AbortController()) {
  return { lease: { identity: egressIdentity(route), signal: controller.signal }, controller };
}
afterEach(() => vi.restoreAllMocks());

it("retries a transient browser probe only within the same prepared browser and lease", async () => {
  const { lease } = testLease();
  const browsers = vi.fn(async () => [stableChrome()]);
  const verify = vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValue(lease);
  const probe = vi.spyOn(egressProbe, "probeChromeEgress")
    .mockRejectedValueOnce(new BrowserEgressProbeError(true)).mockResolvedValueOnce(undefined);
  const check = vi.fn();
  const controller = new AbortController();

  await expect(verifyBrowserEgress(endpoint, route, browsers, { signal: controller.signal, check })).resolves.toBe(lease);

  expect(probe).toHaveBeenCalledTimes(2);
  expect(probe.mock.calls[0]?.[2]).not.toBe(lease.signal);
  expect(verify).toHaveBeenCalledTimes(2);
  expect(browsers).toHaveBeenCalledTimes(3);
  expect(check).toHaveBeenCalled();
  expect(lease.signal.aborted).toBe(false);
});

it("stops after three transient browser probes under the prepared context", async () => {
  const { lease } = testLease();
  const browsers = vi.fn(async () => [stableChrome()]);
  const verify = vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValue(lease);
  const probe = vi.spyOn(egressProbe, "probeChromeEgress").mockRejectedValue(new BrowserEgressProbeError(true));
  const controller = new AbortController();

  await expect(verifyBrowserEgress(endpoint, route, browsers, { signal: controller.signal, check: () => {} })).rejects.toBeInstanceOf(BrowserEgressProbeError);

  expect(probe).toHaveBeenCalledTimes(3);
  expect(verify).toHaveBeenCalledTimes(3);
  expect(browsers).toHaveBeenCalledTimes(3);
  expect(lease.signal.aborted).toBe(false);
});

it.each([
  ["non-retryable probe result", () => new BrowserEgressProbeError(false)],
  ["untyped retryable property", () => Object.assign(new Error("unclassified"), { retryable: true })],
])("does not retry a %s", async (_label, makeError) => {
  const { lease } = testLease();
  const browsers = vi.fn(async () => [stableChrome()]);
  const verify = vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValue(lease);
  const error = makeError();
  const probe = vi.spyOn(egressProbe, "probeChromeEgress").mockRejectedValue(error);

  await expect(verifyBrowserEgress(endpoint, route, browsers, { signal: new AbortController().signal, check: () => {} })).rejects.toBe(error);

  expect(probe).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledTimes(1);
});

it("does not retry a route lease verification failure even if its error has a retryable flag", async () => {
  const browsers = vi.fn(async () => [stableChrome()]);
  const verify = vi.spyOn(qianchuanEgressRuntime, "verify").mockRejectedValue(Object.assign(new Error("lease unavailable"), { retryable: true }));
  const probe = vi.spyOn(egressProbe, "probeChromeEgress");

  await expect(verifyBrowserEgress(endpoint, route, browsers, { signal: new AbortController().signal, check: () => {} })).rejects.toThrow("lease unavailable");

  expect(verify).toHaveBeenCalledTimes(1);
  expect(probe).not.toHaveBeenCalled();
});

it("does not retry when the original process identity is not strong enough", async () => {
  const { lease } = testLease();
  const browsers = vi.fn(async () => [stableChrome({ processId: undefined, startedAt: undefined })]);
  const verify = vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValue(lease);
  const probe = vi.spyOn(egressProbe, "probeChromeEgress").mockRejectedValue(new BrowserEgressProbeError(true));

  await expect(verifyBrowserEgress(endpoint, route, browsers, { signal: new AbortController().signal, check: () => {} })).rejects.toBeInstanceOf(BrowserEgressProbeError);

  expect(probe).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledTimes(1);
});

it.each([
  ["endpoint", { endpoint: "http://127.0.0.1:9223" }],
  ["profile", { profile: "/tmp/other-profile" }],
  ["profile directory", { profileDirectory: "Profile 2" }],
  ["window class", { windowClass: "other-account" }],
  ["process id", { processId: 4522 }],
  ["process start time", { startedAt: "882911" }],
  ["proxy flags", { egressArguments: ["--proxy-server=socks5://127.0.0.1:19382"] }],
])("does not repeat the probe after the browser %s changes", async (_label, changed) => {
  const { lease } = testLease();
  let reads = 0;
  const browsers = vi.fn(async () => [stableChrome(++reads === 1 ? {} : changed)]);
  const verify = vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValue(lease);
  const probe = vi.spyOn(egressProbe, "probeChromeEgress").mockRejectedValue(new BrowserEgressProbeError(true));

  await expect(verifyBrowserEgress(endpoint, route, browsers, { signal: new AbortController().signal, check: () => {} })).rejects.toThrow();

  expect(probe).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledTimes(1);
  expect(lease.signal.aborted).toBe(false);
});

it("rejects a changed prepared route before a transient probe can be retried", async () => {
  const { lease } = testLease();
  const browsers = vi.fn(async () => [stableChrome()]);
  const verify = vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValue(lease);
  let currentIdentity = egressIdentity(route);
  const check = vi.fn(() => { if (currentIdentity !== egressIdentity(route)) throw new Error("prepared route changed"); });
  const probe = vi.spyOn(egressProbe, "probeChromeEgress").mockImplementationOnce(async () => {
    currentIdentity = "changed";
    throw new BrowserEgressProbeError(true);
  });

  await expect(verifyBrowserEgress(endpoint, route, browsers, { signal: new AbortController().signal, check })).rejects.toThrow("prepared route changed");

  expect(probe).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledTimes(1);
});

it("does not ask the runtime for a replacement after the original lease is revoked", async () => {
  const { lease, controller: leaseController } = testLease();
  const browsers = vi.fn(async () => [stableChrome()]);
  const verify = vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValue(lease);
  const probe = vi.spyOn(egressProbe, "probeChromeEgress").mockImplementationOnce(async () => {
    leaseController.abort(new Error("revoked"));
    throw new BrowserEgressProbeError(true);
  });

  await expect(verifyBrowserEgress(endpoint, route, browsers, { signal: new AbortController().signal, check: () => {} })).rejects.toThrow();

  expect(probe).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledTimes(1);
});

it("does not silently switch to a different live lease between transient probes", async () => {
  const { lease: original } = testLease();
  const { lease: replacement } = testLease();
  const browsers = vi.fn(async () => [stableChrome()]);
  const verify = vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValueOnce(original).mockResolvedValueOnce(replacement);
  const probe = vi.spyOn(egressProbe, "probeChromeEgress").mockRejectedValueOnce(new BrowserEgressProbeError(true)).mockResolvedValueOnce(undefined);

  await expect(verifyBrowserEgress(endpoint, route, browsers, { signal: new AbortController().signal, check: () => {} })).rejects.toThrow();

  expect(original.signal.aborted).toBe(false);
  expect(verify).toHaveBeenCalledTimes(2);
  expect(probe).toHaveBeenCalledTimes(1);
});

it("cancels the contextual backoff without starting another browser probe", async () => {
  const { lease } = testLease();
  const browsers = vi.fn(async () => [stableChrome()]);
  const verify = vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValue(lease);
  const probe = vi.spyOn(egressProbe, "probeChromeEgress").mockRejectedValue(new BrowserEgressProbeError(true));
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("Aborted", "AbortError")), 50);

  await expect(verifyBrowserEgress(endpoint, route, browsers, { signal: controller.signal, check: () => {} })).rejects.toMatchObject({ name: "AbortError" });

  expect(probe).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledTimes(1);
});

it("keeps unprepared browser verification single-shot and uses the lease signal directly", async () => {
  const { lease } = testLease();
  const browsers = vi.fn(async () => [stableChrome()]);
  const verify = vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValue(lease);
  const error = new BrowserEgressProbeError(true);
  const probe = vi.spyOn(egressProbe, "probeChromeEgress").mockRejectedValue(error);

  await expect(verifyBrowserEgress(endpoint, route, browsers)).rejects.toBe(error);

  expect(probe).toHaveBeenCalledTimes(1);
  expect(probe.mock.calls[0]?.[2]).toBe(lease.signal);
  expect(verify).toHaveBeenCalledTimes(1);
});
it("rejects an unowned legacy endpoint before connecting even when its route is absent", async () => {
  await expect(verifyBrowserEgress("http://127.0.0.1:9222", undefined, async () => [])).rejects.toThrow("无法唯一");
});
it("requires exact per-process flags and rejects legacy or PAC/bypass replacement", () => {
  const flags = chromeEgressArguments(route);
  expect(() => assertEgressArguments({ egressArguments: flags }, route)).not.toThrow();
  for (const actual of [[], flags.slice(1), [...flags, "--proxy-pac-url=http://example.com"], [...flags, flags[0]], flags.map(arg => arg.startsWith("--proxy-server") ? "--proxy-server=direct://" : arg)]) {
    expect(() => assertEgressArguments({ egressArguments: actual }, route)).toThrow();
  }
  expect(() => assertEgressArguments({ egressArguments: flags })).toThrow();
  const args = accountChromeArguments("/tmp/account-profile", "123", undefined, route);
  expect(args).toContain("--remote-debugging-address=127.0.0.1");
  expect(args).toContain("--proxy-server=socks5://127.0.0.1:19381");
});
it("real Chromium retains its SOCKS transport when attestation fails, but never falls back after actual proxy loss", async () => {
  const sockets = new Set<Socket>(), requested: string[] = [];
  const proxy = createServer(socket => {
    sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket));
    let phase = 0, buffer = Buffer.alloc(0);
    socket.on("data", data => {
      buffer = Buffer.concat([buffer, data]);
      if (phase === 0 && buffer.length >= 2 + buffer[1]) { buffer = buffer.subarray(2 + buffer[1]); socket.write(Buffer.from([5, 0])); phase = 1; }
      if (phase === 1 && buffer.length >= 5) {
        const length = buffer[3] === 3 ? 7 + buffer[4] : buffer[3] === 1 ? 10 : 22;
        if (buffer.length < length) return;
        requested.push(buffer[3] === 3 ? buffer.subarray(5, 5 + buffer[4]).toString() : "numeric");
        buffer = buffer.subarray(length); socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80])); phase = 2;
      }
      if (phase === 2 && buffer.includes("\r\n\r\n")) {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\nproxy-fixture"); phase = 3;
      }
    });
  });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const port = (proxy.address() as { port: number }).port;
  const ownedRoute = { ...route, localPort: port };
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: vi.fn(() => {
    for (const socket of sockets) socket.destroy();
    proxy.close(); return true;
  }) });
  const probe = vi.fn(async () => route.expectedIp);
  const runtime = new QianchuanEgressRuntime({ launch: () => child, portFree: async () => true, probe });
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: chromeEgressArguments({ ...route, localPort: port }) });
  try {
    const lease = await runtime.ensure(ownedRoute);
    const page = await browser.newPage();
    await page.goto("http://egress-fixture.invalid/first", { timeout: 5000 });
    expect(await page.locator("body").innerText()).toBe("proxy-fixture");
    expect(requested).toContain("egress-fixture.invalid");
    probe.mockRejectedValueOnce(new Error("attestation timeout"));
    await expect(runtime.verify(ownedRoute)).rejects.toThrow();
    expect(lease.signal.aborted).toBe(true);
    await expect(runtime.ensure(ownedRoute)).rejects.toThrow();
    expect(child.kill).not.toHaveBeenCalled();
    await page.goto("http://egress-fixture.invalid/after-attestation-outage", { timeout: 5000 });
    expect(await page.locator("body").innerText()).toBe("proxy-fixture");
    runtime.recover(ownedRoute);
    expect((await runtime.ensure(ownedRoute)).signal.aborted).toBe(false);
    expect(lease.signal.aborted).toBe(true);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    await expect(page.goto("http://egress-fixture.invalid/after-loss", { timeout: 5000 })).rejects.toThrow();
  } finally { runtime.dispose(); await browser.close(); for (const socket of sockets) socket.destroy(); if (proxy.listening) await new Promise<void>(resolve => proxy.close(() => resolve())); }
}, 15000);
it("checks the actual browser response in a disposable tab, rejecting mismatches while preserving user tabs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-egress-probe-"));
  const context = await chromium.launchPersistentContext(root, { executablePath: "/usr/bin/google-chrome", headless: true, args: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] });
  try {
    const port = (await readFile(path.join(root, "DevToolsActivePort"), "utf8")).split("\n")[0];
    const endpoint = `http://127.0.0.1:${port}`, original = context.pages()[0];
    await original.goto("data:text/html,Original%20user%20tab");
    await context.route("https://api.ipify.org/**", route => route.abort("connectionrefused"));
    await context.route("https://checkip.amazonaws.com/**", route => route.fulfill({ status: 200, contentType: "text/plain", body: "203.0.113.11\n" }));
    await probeChromeEgress(endpoint, "203.0.113.11", new AbortController().signal);
    await expect(probeChromeEgress(endpoint, "203.0.113.99", new AbortController().signal)).rejects.toThrow("实际出口");
    expect(original.isClosed()).toBe(false);
    expect(await original.locator("body").innerText()).toBe("Original user tab");
    expect(context.pages().filter(page => !page.isClosed())).toHaveLength(1);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); }
}, 20000);
