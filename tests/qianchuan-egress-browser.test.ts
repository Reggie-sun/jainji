import { createServer, type Socket } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { chromium } from "playwright-core";
import { assertEgressArguments, chromeEgressArguments, verifyBrowserEgress } from "../src/main/qianchuan-egress-browser";
import { accountChromeArguments } from "../src/main/qianchuan-browser-manager";
import { probeChromeEgress } from "../src/main/qianchuan-egress-probe";

const route = { group: "主体一", sshHost: "shop-one", localPort: 19381, expectedIp: "203.0.113.11" };
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
it("real Chromium uses its SOCKS endpoint and fails after proxy loss without direct fallback", async () => {
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
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: chromeEgressArguments({ ...route, localPort: port }) });
  try {
    const page = await browser.newPage();
    await page.goto("http://egress-fixture.invalid/first", { timeout: 5000 });
    expect(await page.locator("body").innerText()).toBe("proxy-fixture");
    expect(requested).toContain("egress-fixture.invalid");
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    await expect(page.goto("http://egress-fixture.invalid/after-loss", { timeout: 5000 })).rejects.toThrow();
  } finally { await browser.close(); for (const socket of sockets) socket.destroy(); if (proxy.listening) await new Promise<void>(resolve => proxy.close(() => resolve())); }
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
