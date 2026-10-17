import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { expect, it, vi } from "vitest";
import { chromium, type BrowserContext } from "playwright-core";
import { BrowserEgressProbeError, probeChromeEgress } from "../src/main/qianchuan-egress-probe";
import { DouyinCdpUploader } from "../src/main/douyin-cdp-uploader";
import * as egress from "../src/main/qianchuan-egress-browser";
import { startQianchuanFixture } from "./helpers/douyin-cdp-fixture";
import type { UploadTaskRecord } from "../src/main/douyin-upload-store";

it("refuses an unverified route before opening any upload connection", async () => {
  const verify = vi.spyOn(egress, "verifyBrowserEgress").mockRejectedValue(new Error("wrong route"));
  const uploader = new DouyinCdpUploader();
  try {
    await expect(uploader.connect({ authorization: { target: { cdpEndpoint: "http://127.0.0.1:9222" } } } as UploadTaskRecord, new AbortController().signal)).rejects.toMatchObject({ failure: { code: "ACCOUNT_UNCONFIRMED" } });
  } finally { await uploader.stop(); verify.mockRestore(); }
});
it("tunnel loss detaches automation and rejects later delivery while keeping original Chrome open", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-egress-upload-"));
  const fixture = await startQianchuanFixture({ tempRoot: root });
  const controller = new AbortController();
  const verify = vi.spyOn(egress, "verifyBrowserEgress").mockResolvedValue({ identity: "frozen-route", signal: controller.signal });
  const uploader = new DouyinCdpUploader(fixture.contract);
  try {
    await uploader.connect({ authorization: { target: { cdpEndpoint: fixture.cdpEndpoint } }, config: { timeouts: { connect: 5000 } } } as UploadTaskRecord, new AbortController().signal);
    controller.abort(new Error("tunnel disconnected"));
    await expect(uploader.upload([], new AbortController().signal)).rejects.toThrow();
    const evidence = await fixture.inspect();
    expect(evidence.chromeRunning).toBe(true);
    expect(evidence.pages.some(page => page.id === fixture.originalTargetId)).toBe(true);
    expect(evidence.events).toHaveLength(0);
  } finally { await uploader.stop(); verify.mockRestore(); await fixture.stop(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}, 15000);

it("a fresh network lease cannot revive an uploader whose captured lease was revoked during open", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-egress-new-lease-"));
  const fixture = await startQianchuanFixture({ tempRoot: root });
  const old = new AbortController(), fresh = new AbortController();
  const verify = vi.spyOn(egress, "verifyBrowserEgress").mockResolvedValue({ identity: "frozen-route", signal: old.signal });
  const uploader = new DouyinCdpUploader(fixture.contract);
  const task = { authorization: { target: { cdpEndpoint: fixture.cdpEndpoint,
    egress: { group: "fixture", sshHost: "fixture", localPort: 19381, expectedIp: "203.0.113.11" } } },
    config: { timeouts: { connect: 5000 } } } as UploadTaskRecord;
  try {
    await uploader.connect(task, new AbortController().signal);
    verify.mockImplementationOnce(async () => {
      old.abort(new Error("Original lease permanently revoked"));
      return { identity: "frozen-route", signal: fresh.signal };
    });
    await expect(uploader.open([task], [], new AbortController().signal)).rejects.toThrow();
    expect(fresh.signal.aborted).toBe(false);
    await expect(uploader.connect(task, new AbortController().signal)).rejects.toThrow();
    await expect(uploader.upload([], new AbortController().signal)).rejects.toThrow();
    expect(verify).toHaveBeenCalledTimes(2);
    const state = await fixture.inspect();
    expect(state.events).toEqual([]);
    expect(state.chromeRunning).toBe(true);
    expect(state.pages.some(page => page.id === fixture.originalTargetId)).toBe(true);
  } finally { await uploader.stop(); verify.mockRestore(); await fixture.stop(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}, 15000);

it("forwards the current preselection attempt to both uploader egress checks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-egress-attempt-index-"));
  const fixture = await startQianchuanFixture({ tempRoot: root });
  const lease = new AbortController();
  const verify = vi.spyOn(egress, "verifyBrowserEgress").mockResolvedValue({ identity: "frozen-route", signal: lease.signal });
  const uploader = new DouyinCdpUploader(fixture.contract);
  const task = { authorization: { target: { cdpEndpoint: fixture.cdpEndpoint,
    egress: { group: "fixture", sshHost: "fixture", localPort: 19381, expectedIp: "203.0.113.11" } } },
    config: { timeouts: { connect: 5000 } } } as UploadTaskRecord;
  try {
    const signal = new AbortController().signal;
    await uploader.connect(task, signal, 2);
    verify.mockRejectedValueOnce(new BrowserEgressProbeError(true));
    await expect(uploader.open([task], [], signal, 1)).rejects.toMatchObject({
      failure: { code: "CDP_UNAVAILABLE", category: "browser", retryable: true, requires_human: false },
    });
    expect(verify.mock.calls.map(call => (call as unknown as unknown[])[4])).toEqual([2, 1]);
    expect((await fixture.inspect()).events).toEqual([]);
  } finally {
    await uploader.stop(); verify.mockRestore(); await fixture.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 15000);

async function withProbe(reply: "reset" | string, work: (error: unknown, endpoint: string) => Promise<void>, lease?: AbortController) {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-probe-recovery-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(root, { executablePath: "/usr/bin/google-chrome", headless: true,
      args: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] });
    const original = context.pages()[0]!;
    await original.goto("data:text/html,Original%20fixture%20page");
    await context.route("https://checkip.amazonaws.com/**", route => {
      lease?.abort(new Error("Lease revoked"));
      return reply === "reset" ? route.abort("connectionreset") : route.fulfill({ status: 200, contentType: "text/plain", body: reply });
    });
    const port = (await readFile(path.join(root, "DevToolsActivePort"), "utf8")).split("\n")[0];
    const endpoint = `http://127.0.0.1:${port}`;
    let error: unknown;
    try { await probeChromeEgress(endpoint, "203.0.113.11", lease?.signal ?? new AbortController().signal); }
    catch (value) { error = value; }
    expect(error).toBeInstanceOf(Error);
    await work(error, endpoint);
    expect(original.isClosed()).toBe(false);
    expect(await original.locator("body").innerText()).toBe("Original fixture page");
    expect(context.pages().filter(page => !page.isClosed())).toEqual([original]);
  } finally { vi.restoreAllMocks(); await context?.close(); await rm(root, { recursive: true, force: true }); }
}

it("keeps a background IP probe connection failure eligible for the existing preselection retry budget", async () => {
  await withProbe("reset", async (error, endpoint) => {
    const verify = vi.spyOn(egress, "verifyBrowserEgress").mockRejectedValue(error);
    const uploader = new DouyinCdpUploader();
    try {
      await expect(uploader.connect({ authorization: { target: { cdpEndpoint: endpoint } } } as UploadTaskRecord,
        new AbortController().signal)).rejects.toMatchObject({ failure: {
          code: "CDP_UNAVAILABLE", category: "browser", retryable: true, requires_human: false,
        } });
      expect(verify).toHaveBeenCalledOnce();
    } finally { await uploader.stop(); }
  });
}, 15000);

it.each(["203.0.113.99\n", "not-an-ip"]) ("keeps an unverified IP response %s fail-closed", async reply => {
  await withProbe(reply, async (error, endpoint) => {
    vi.spyOn(egress, "verifyBrowserEgress").mockRejectedValue(error);
    const uploader = new DouyinCdpUploader();
    try {
      await expect(uploader.connect({ authorization: { target: { cdpEndpoint: endpoint } } } as UploadTaskRecord,
        new AbortController().signal)).rejects.toMatchObject({ failure: {
          code: "ACCOUNT_UNCONFIRMED", category: "account", retryable: false, requires_human: true,
        } });
    } finally { await uploader.stop(); }
  });
}, 15000);

it("does not turn an unclassified route error with a retryable field into upload authority", async () => {
  const verify = vi.spyOn(egress, "verifyBrowserEgress").mockRejectedValue(Object.assign(new Error("unknown route failure"), { retryable: true }));
  const uploader = new DouyinCdpUploader();
  try {
    await expect(uploader.connect({ authorization: { target: { cdpEndpoint: "http://127.0.0.1:9222" } } } as UploadTaskRecord,
      new AbortController().signal)).rejects.toMatchObject({ failure: { code: "ACCOUNT_UNCONFIRMED", requires_human: true, retryable: false } });
  } finally { await uploader.stop(); verify.mockRestore(); }
});

it("preserves cancellation while a background probe failure is being reported", async () => {
  await withProbe("reset", async (error, endpoint) => {
    const controller = new AbortController();
    vi.spyOn(egress, "verifyBrowserEgress").mockImplementation(async () => {
      controller.abort(new Error("Fixture stopped")); throw error;
    });
    const uploader = new DouyinCdpUploader();
    try {
      await expect(uploader.connect({ authorization: { target: { cdpEndpoint: endpoint } } } as UploadTaskRecord,
        controller.signal)).rejects.toThrow("Fixture stopped");
    } finally { await uploader.stop(); }
  });
}, 15000);

it("never retries a revoked egress lease as a temporary browser probe error", async () => {
  await withProbe("reset", async (error, endpoint) => {
    vi.spyOn(egress, "verifyBrowserEgress").mockRejectedValue(error);
    const uploader = new DouyinCdpUploader();
    try {
      await expect(uploader.connect({ authorization: { target: { cdpEndpoint: endpoint } } } as UploadTaskRecord,
        new AbortController().signal)).rejects.toMatchObject({ failure: {
          code: "ACCOUNT_UNCONFIRMED", requires_human: true, retryable: false,
        } });
    } finally { await uploader.stop(); }
  }, new AbortController());
}, 15000);

it("uses the same preselection error classification when open rechecks the browser exit", async () => {
  await withProbe("reset", async (error) => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-open-egress-"));
    const fixture = await startQianchuanFixture({ tempRoot: root });
    const verify = vi.spyOn(egress, "verifyBrowserEgress").mockResolvedValue(undefined);
    const uploader = new DouyinCdpUploader(fixture.contract);
    const task = { authorization: { target: { cdpEndpoint: fixture.cdpEndpoint,
      egress: { group: "fixture", sshHost: "fixture", localPort: 19381, expectedIp: "203.0.113.11" } } },
      config: { timeouts: { connect: 5000 } } } as UploadTaskRecord;
    try {
      await uploader.connect(task, new AbortController().signal);
      verify.mockRejectedValueOnce(error);
      await expect(uploader.open([task], [], new AbortController().signal)).rejects.toMatchObject({ failure: {
        code: "CDP_UNAVAILABLE", category: "browser", retryable: true, requires_human: false,
      } });
      const state = await fixture.inspect();
      expect(state.events).toEqual([]);
      expect(state.pages.some(page => page.id === fixture.originalTargetId)).toBe(true);
    } finally { await uploader.stop(); await fixture.stop(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  });
}, 15000);

it.each([
  ["malformed-cdp", false], ["rpc-error", false], ["certificate", false],
  ["invalid-json", false], ["body-reset", true], ["navigate-reset", true], ["proxy-reset", true], ["socks-reset", true],
] as const)("classifies the actual %s probe failure without weakening protocol or certificate checks", async (kind, retryable) => {
  const server = createServer((_request, response) => {
    if (kind === "invalid-json") { response.writeHead(200, { "content-type": "application/json" }); response.end("not-json"); return; }
    if (kind === "body-reset") {
      response.writeHead(200, { "content-type": "application/json", "content-length": "200" });
      response.flushHeaders(); response.write('{"webSocketDebuggerUrl":"');
      setTimeout(() => response.destroy(), 10); return;
    }
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture not listening");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/devtools/browser/fixture` }));
  });
  const websocket = new WebSocketServer({ server });
  websocket.on("connection", socket => socket.on("message", bytes => {
    const request = JSON.parse(bytes.toString());
    if (kind === "malformed-cdp" && request.method === "Network.enable") { socket.send("not-json"); return; }
    if (kind === "rpc-error" && request.method === "Network.setBypassServiceWorker") {
      socket.send(JSON.stringify({ id: request.id, error: { code: -32601, message: "Method not found" } })); return;
    }
    const result = request.method === "Target.createTarget" ? { targetId: "owned-probe" }
      : request.method === "Target.attachToTarget" ? { sessionId: "owned-session" }
      : request.method === "Page.navigate" ? { frameId: "owned-frame", errorText: kind === "certificate" ? "net::ERR_CERT_AUTHORITY_INVALID"
        : kind === "proxy-reset" ? "net::ERR_PROXY_CONNECTION_FAILED" : kind === "socks-reset" ? "net::ERR_SOCKS_CONNECTION_FAILED" : "net::ERR_CONNECTION_RESET" }
      : {};
    socket.send(JSON.stringify({ id: request.id, result }));
  }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture not listening");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const uploader = new DouyinCdpUploader();
  try {
    let error: unknown;
    try { await probeChromeEgress(endpoint, "203.0.113.11", new AbortController().signal); } catch (failure) { error = failure; }
    expect(error).toBeInstanceOf(Error);
    vi.spyOn(egress, "verifyBrowserEgress").mockRejectedValue(error);
    await expect(uploader.connect({ authorization: { target: { cdpEndpoint: endpoint } } } as UploadTaskRecord,
      new AbortController().signal)).rejects.toMatchObject({ failure: retryable
        ? { code: "CDP_UNAVAILABLE", category: "browser", retryable: true, requires_human: false }
        : { code: "ACCOUNT_UNCONFIRMED", category: "account", retryable: false, requires_human: true } });
  } finally {
    await uploader.stop(); vi.restoreAllMocks();
    for (const socket of websocket.clients) socket.terminate();
    websocket.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 15000);
