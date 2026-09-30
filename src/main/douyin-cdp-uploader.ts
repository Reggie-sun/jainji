import { randomUUID } from "node:crypto";
import http from "node:http";
import type { Socket } from "node:net";
import { chromium, type Browser, type Page } from "playwright-core";
import { isLoopbackUrl, uploadFailure, type PageOwnership, type ReadyEvidence, type QianchuanUploadConfig } from "../shared/douyin-upload.js";
import { MAX_UPLOAD_GROUP_SIZE, type UploadBrowserPort, type BatchSelectedFile } from "./douyin-upload-service.js";
import type { UploadTaskRecord } from "./douyin-upload-store.js";
import { QianchuanPageSession, PRODUCTION_QIANCHUAN_CONTRACT, qianchuanReadiness, type QianchuanPageContract } from "./qianchuan-page-contract.js";
export const douyinReadiness = (_config: QianchuanUploadConfig) => qianchuanReadiness();
export type { QianchuanPageContract };

/** Local transport refuses WS redirects; Playwright otherwise follows them by default. */
async function guardedTransport(endpoint: string, signal: AbortSignal, timeout: number): Promise<{ url: string; close(): Promise<void> }> {
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

export class DouyinCdpUploader implements UploadBrowserPort {
  private browser?: Browser;
  private page?: Page;
  private session?: QianchuanPageSession;
  private transport?: Awaited<ReturnType<typeof guardedTransport>>;
  private readonly controller = new AbortController();
  constructor(private readonly contract: QianchuanPageContract | undefined = PRODUCTION_QIANCHUAN_CONTRACT) {}
  private check = (signal: AbortSignal): void => { signal.throwIfAborted(); this.controller.signal.throwIfAborted(); };
  private pageContract(): QianchuanPageContract {
    if (!this.contract || !this.contract.fileSelectionDoesNotConfirm) throw uploadFailure("PAGE_CONTRACT_UNVERIFIED", "page", "千川生产页面合同尚未核实，禁止浏览器操作。", "核实有限页面定位与独立确认边界。", true);
    return this.contract;
  }
  private async action<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    this.check(signal); const cancel = () => { void this.stop(); }; signal.addEventListener("abort", cancel, { once: true });
    try { const result = await work(); this.check(signal); return result; } finally { signal.removeEventListener("abort", cancel); }
  }
  async connect(task: UploadTaskRecord, signal: AbortSignal): Promise<void> {
    this.pageContract(); this.check(signal); if (this.browser?.isConnected()) return;
    const endpoint = task.authorization.target.cdpEndpoint;
    if (!isLoopbackUrl(endpoint) || new URL(endpoint).pathname !== "/") throw new Error("Unsafe discovery endpoint");
    await this.action(signal, async () => {
      try {
        const response = await fetch(new URL("/json/version", endpoint), { redirect: "error", signal: AbortSignal.any([signal, this.controller.signal]) });
        if (!response.ok) throw new Error("Discovery unavailable");
        const info = await response.json() as { webSocketDebuggerUrl?: unknown };
        if (typeof info.webSocketDebuggerUrl !== "string" || !isLoopbackUrl(info.webSocketDebuggerUrl, true) || new URL(info.webSocketDebuggerUrl).port !== new URL(endpoint).port) throw new Error("Unsafe discovery websocket");
        this.check(signal); this.transport = await guardedTransport(info.webSocketDebuggerUrl, this.controller.signal, task.config.timeouts.connect); this.check(signal);
        const browser = await chromium.connectOverCDP(this.transport.url, { timeout: task.config.timeouts.connect, noDefaults: true });
        if (signal.aborted || this.controller.signal.aborted) { await browser.close(); this.check(signal); }
        this.browser = browser;
        if (browser.contexts().length !== 1) throw uploadFailure("ACCOUNT_UNCONFIRMED", "account", "无法唯一确认 default context。", "人工检查目标 Chrome。", true);
      } catch (error) {
        await this.stop(); if (error instanceof Error && error.name === "UploadError") throw error;
        throw uploadFailure("CDP_UNAVAILABLE", "browser", "无法安全连接本机 Chrome。", "启动对应的 Chrome 并登录后明确继续。", false, true);
      }
    });
  }
  private async targetId(page: Page): Promise<string> {
    const session = await page.context().newCDPSession(page);
    try { return (await session.send("Target.getTargetInfo")).targetInfo.targetId; } finally { await session.detach(); }
  }
  async open(tasks: UploadTaskRecord[], selected: BatchSelectedFile[], signal: AbortSignal): Promise<{ pageOwnership: PageOwnership; selectedIndex: number }> {
    const task = tasks[0]; if (!task || tasks.length > MAX_UPLOAD_GROUP_SIZE) throw new Error("Invalid upload group");
    const contract = this.pageContract();
    return this.action(signal, async () => {
      if (!this.page) {
        if (selected.length) throw new Error("Missing original task page");
        const context = this.browser?.contexts()[0]; if (!context) throw new Error("Not connected");
        this.check(signal); this.page = await context.newPage(); this.check(signal);
        this.session = new QianchuanPageSession(this.page, contract, this.check);
        await this.page.goto(this.session.url(task), { timeout: task.config.timeouts.navigation, waitUntil: "domcontentloaded" }); this.check(signal);
      }
      // Background tabs can suspend animation frames used by click stability checks.
      await this.page.bringToFront(); this.check(signal);
      return this.session!.prepare(tasks, selected, await this.targetId(this.page), signal);
    });
  }
  async upload(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<void> { await this.action(signal, () => this.session!.upload(tasks, signal)); }
  async ready(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<ReadyEvidence[]> { return this.action(signal, () => this.session!.ready(tasks, signal)); }
  async readOnlyCheck(task: UploadTaskRecord, ownership: PageOwnership, selected: BatchSelectedFile[], signal: AbortSignal): Promise<ReadyEvidence> {
    return this.action(signal, async () => {
      const contract = this.pageContract(), pages = this.browser?.contexts()[0]?.pages() ?? [], matches: Page[] = [];
      for (const page of pages) if (new URL(page.url()).origin === contract.origin && await this.targetId(page) === ownership.targetId) matches.push(page);
      if (matches.length !== 1) throw uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "无法恢复原批次 tab。", "人工处理；不能新开页面重传。", true);
      this.page = matches[0]; this.session = new QianchuanPageSession(this.page, contract, this.check);
      return this.session.restore(task, ownership, selected, await this.targetId(this.page), signal);
    });
  }
  async stop(): Promise<void> {
    this.controller.abort(); await this.transport?.close();
    const browser = this.browser; this.browser = undefined; await browser?.close().catch(() => undefined);
    // Relay detaches automation; Chrome, default context and every task tab remain for the user.
  }
}
