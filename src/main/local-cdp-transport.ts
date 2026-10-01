import { randomUUID } from "node:crypto";
import http from "node:http";
import type { Socket } from "node:net";
import { chromium } from "playwright-core";
import { isLoopbackUrl } from "../shared/douyin-upload.js";

/** Local transport refuses WS redirects; Playwright otherwise follows them by default. */
export async function guardedTransport(endpoint: string, signal: AbortSignal, timeout: number): Promise<{ url: string; close(): Promise<void> }> {
  signal.throwIfAborted();
  if (!isLoopbackUrl(endpoint, true)) throw new Error("Unsafe websocket endpoint");
  const upstreamUrl = new URL(endpoint), token = randomUUID();
  const sockets = new Set<Socket>();
  const server = http.createServer((_req, res) => { res.writeHead(403).end(); });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => socket.destroy()); });
  server.on("upgrade", (request, local, head) => {
    if (signal.aborted || request.url !== `/${token}`) { local.destroy(); return; }
    const upstream = http.request({ hostname: upstreamUrl.hostname.replace(/^\[|\]$/g, ""), port: upstreamUrl.port, path: upstreamUrl.pathname,
      headers: { host: upstreamUrl.host, upgrade: "websocket", connection: "Upgrade", "sec-websocket-key": request.headers["sec-websocket-key"], "sec-websocket-version": "13" }, timeout });
    upstream.on("upgrade", (response, remote, upstreamHead) => {
      if (signal.aborted || response.statusCode !== 101) { remote.destroy(); local.destroy(); return; }
      sockets.add(remote); remote.on("close", () => { sockets.delete(remote); local.destroy(); });
      remote.on("error", () => { remote.destroy(); local.destroy(); });
      local.on("close", () => remote.destroy());
      local.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${response.headers["sec-websocket-accept"]}\r\n\r\n`);
      if (head.length) remote.write(head); if (upstreamHead.length) local.write(upstreamHead);
      remote.pipe(local); local.pipe(remote);
    });
    upstream.on("response", () => { upstream.destroy(); local.destroy(); }); // 3xx never followed.
    upstream.on("error", () => local.destroy()); upstream.on("timeout", () => { upstream.destroy(); local.destroy(); });
    signal.addEventListener("abort", () => { upstream.destroy(); local.destroy(); }, { once: true }); upstream.end();
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing local transport address");
  let closed = false;
  const close = async () => { if (closed) return; closed = true; for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); };
  if (signal.aborted) { await close(); signal.throwIfAborted(); }
  signal.addEventListener("abort", () => { void close(); }, { once: true });
  return { url: `ws://127.0.0.1:${address.port}/${token}`, close };
}

/** Read target metadata only; detaching leaves Chrome and all tabs open. */
export async function readChromeTargets(endpoint: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const transport = await guardedTransport(endpoint, controller.signal, 20_000).catch(error => { clearTimeout(timer); throw error; });
  try {
    const browser = await chromium.connectOverCDP(transport.url, { timeout: 20_000, noDefaults: true });
    try {
      controller.signal.throwIfAborted();
      const session = await browser.newBrowserCDPSession();
      try { return (await session.send("Target.getTargets")).targetInfos; }
      finally { await session.detach().catch(() => undefined); }
    } finally { await browser.close(); }
  } finally { clearTimeout(timer); await transport.close(); }
}
