import { randomUUID } from "node:crypto";
import http from "node:http";
import type { Socket } from "node:net";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { isLoopbackUrl, uploadFailure, type DouyinUploadConfig, type UploadSuccess } from "../shared/douyin-upload.js";
import type { UploadBrowserPort } from "./douyin-upload-service.js";
import type { UploadTaskRecord } from "./douyin-upload-store.js";

/** Finite, source-owned page contract. Never loaded from IPC, config or page data. */
export interface DouyinPageContract {
  version: string;
  uploadUrl: string;
  fileSelectionDoesNotPublish: true;
  captionLimit: number;
  file: string; caption: string; ready: string; publish: string;
  login: string; challenge: string; account: string; rejection: string;
  accepted: string; contentIdAttribute: string; statusAttribute: string;
  managementUrl(contentId: string): string;
  evidenceUrl(contentId: string): string;
}
// Reconnaissance has not supplied an authenticated, validated Douyin page contract.
const PRODUCTION_PAGE_CONTRACT: DouyinPageContract | undefined = undefined;
export function douyinReadiness(_config: DouyinUploadConfig): string | undefined {
  if (!PRODUCTION_PAGE_CONTRACT) return "抖音真实页面合同尚未核实，自动发布已阻断；不会连接 Chrome 或上传文件。";
  return undefined;
}

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
  private transport?: Awaited<ReturnType<typeof guardedTransport>>;
  private controller = new AbortController();
  private accountIdentity?: string;
  private preparedTask?: string;
  private submitted = false;
  constructor(private readonly contract: DouyinPageContract | undefined = PRODUCTION_PAGE_CONTRACT) {}
  private check(signal: AbortSignal): void { signal.throwIfAborted(); this.controller.signal.throwIfAborted(); }
  private pageContract(): DouyinPageContract {
    if (!this.contract) throw uploadFailure("PAGE_CONTRACT_UNVERIFIED", "page", "真实抖音页面合同尚未核实，禁止浏览器操作。", "准备专用 Chrome/profile 后核实上传页与内容 ID 接受证据。", true);
    return this.contract;
  }
  async connect(task: UploadTaskRecord, signal: AbortSignal): Promise<void> {
    const contract = this.pageContract(); this.check(signal);
    if (!contract.fileSelectionDoesNotPublish) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "无法证明选文件不会直接发布。", "核实页面流程。", true);
    const endpoint = task.config.cdpEndpoint;
    if (!isLoopbackUrl(endpoint) || new URL(endpoint).pathname !== "/") throw new Error("Unsafe discovery endpoint");
    const cancel = () => { void this.stop(); }; signal.addEventListener("abort", cancel, { once: true });
    try {
      const response = await fetch(new URL("/json/version", endpoint), { redirect: "error", signal: AbortSignal.any([signal, this.controller.signal]) });
      if (!response.ok) throw new Error("Discovery unavailable");
      const info = await response.json() as { webSocketDebuggerUrl?: unknown };
      if (typeof info.webSocketDebuggerUrl !== "string" || !isLoopbackUrl(info.webSocketDebuggerUrl, true) || new URL(info.webSocketDebuggerUrl).port !== new URL(endpoint).port) throw new Error("Unsafe discovery websocket");
      this.check(signal);
      this.transport = await guardedTransport(info.webSocketDebuggerUrl, this.controller.signal, task.config.timeouts.connect);
      this.check(signal);
      const browser = await chromium.connectOverCDP(this.transport.url, { timeout: task.config.timeouts.connect, noDefaults: true });
      if (signal.aborted || this.controller.signal.aborted) { await browser.close(); this.check(signal); }
      this.browser = browser;
      if (browser.contexts().length !== 1) throw uploadFailure("ACCOUNT_UNCONFIRMED", "account", "无法唯一确认已有 default context。", "关闭其他隔离 context 并确认目标账号。", true);
    } catch (error) {
      await this.stop();
      if (error instanceof Error && error.name === "UploadError") throw error;
      throw uploadFailure("CDP_UNAVAILABLE", "browser", "无法安全连接本机 Chrome。", "检查 loopback 调试端口与专用 profile。", false, true);
    } finally { signal.removeEventListener("abort", cancel); }
  }
  async open(task: UploadTaskRecord, signal: AbortSignal): Promise<void> {
    const contract = this.pageContract(); this.check(signal);
    if (task.config.uploadPageUrl && task.config.uploadPageUrl !== contract.uploadUrl) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "配置路由与核实页面合同不匹配。", "核查页面地址。", true);
    const context = this.browser?.contexts()[0]; if (!context) throw new Error("Not connected");
    const cancel = () => { void this.stop(); }; signal.addEventListener("abort", cancel, { once: true });
    try {
      this.page = await context.newPage(); this.check(signal);
      await this.page.goto(contract.uploadUrl, { timeout: task.config.timeouts.navigation, waitUntil: "domcontentloaded" });
      if (new URL(this.page.url()).pathname !== new URL(contract.uploadUrl).pathname) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "上传路由发生非预期跳转。", "人工核查页面地址。", true);
      this.check(signal); await this.guard(signal);
      this.preparedTask = task.result.upload_task_id;
    } finally { signal.removeEventListener("abort", cancel); }
  }
  private async unique(selector: string, signal: AbortSignal): Promise<Locator> {
    this.check(signal); const locator = this.page!.locator(selector);
    if (await locator.count() !== 1) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "页面控件缺失或不唯一。", "人工核查页面结构；不会自动选择第一项。", true);
    this.check(signal); return locator;
  }
  private async guard(signal: AbortSignal): Promise<void> {
    this.check(signal); const c = this.pageContract(), page = this.page;
    if (!page || new URL(page.url()).origin !== new URL(c.uploadUrl).origin) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "上传页发生非预期导航。", "人工核查任务页面。", true);
    for (const [selector, code, message] of [[c.login, "LOGIN_REQUIRED", "需要手工登录。"], [c.challenge, "CHALLENGE_REQUIRED", "需要手工完成验证。"]] as const) {
      if (await page.locator(selector).isVisible()) throw uploadFailure(code, "account", message, "在 Chrome 完成后明确继续。", true);
    }
    if (await page.locator(c.rejection).isVisible()) throw uploadFailure("CONTENT_REJECTED", "input", "平台明确拒绝该内容。", "人工检查拒绝原因，不自动重新发布。", false);
    const account = (await (await this.unique(c.account, signal)).textContent())?.trim();
    if (!account || (this.accountIdentity && this.accountIdentity !== account)) throw uploadFailure("ACCOUNT_UNCONFIRMED", "account", "无法确认账号或账号已经改变。", "停止后确认本次连接的目标账号。", true);
    this.accountIdentity = account; this.check(signal);
  }
  private async action<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    this.check(signal); const cancel = () => { void this.stop(); }; signal.addEventListener("abort", cancel, { once: true });
    try { const result = await work(); this.check(signal); return result; }
    finally { signal.removeEventListener("abort", cancel); }
  }
  async upload(task: UploadTaskRecord, signal: AbortSignal): Promise<void> {
    if (this.submitted || this.preparedTask !== task.result.upload_task_id) throw new Error("Task page ownership mismatch");
    if (new URL(this.page!.url()).pathname !== new URL(this.pageContract().uploadUrl).pathname) throw new Error("Upload route changed");
    await this.guard(signal); const input = await this.unique(this.pageContract().file, signal);
    await this.action(signal, () => input.setInputFiles(task.snapshotPath, { timeout: task.config.timeouts.fileInput }));
  }
  async ready(task: UploadTaskRecord, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + task.config.timeouts.processing;
    // Poll observable ready/challenge states; progress alone cannot grant submit permission.
    while (Date.now() < deadline) {
      await this.guard(signal);
      const ready = this.page!.locator(this.pageContract().ready);
      if (await ready.count() === 1 && await ready.isVisible()) return;
      await this.action(signal, () => this.page!.waitForTimeout(Math.min(200, deadline - Date.now())));
    }
    throw uploadFailure("TIMEOUT", "browser", "平台处理未在期限内完成。", "人工检查文件处理状态。", false);
  }
  async fill(task: UploadTaskRecord, signal: AbortSignal): Promise<void> {
    await this.guard(signal); const c = this.pageContract();
    const caption = task.input.caption ?? "";
    if (caption.length > c.captionLimit) throw uploadFailure("INPUT_CONFLICT", "input", "手工文案超过已核实页面限制。", "手工修改文案；程序不会截断。", true);
    const field = await this.unique(c.caption, signal);
    await this.action(signal, () => field.fill(caption, { timeout: task.config.timeouts.action })); // Removes any filename prefill.
    if (!caption.trim()) throw uploadFailure("CAPTION_REQUIRED", "page", "需要手工填写发布文案。", "补充文案后明确继续。", true);
    if (!(await (await this.unique(c.publish, signal)).isEnabled())) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "页面仍有未决定的必填字段。", "人工检查；不会自动勾选声明或更改可见范围。", true);
  }
  async publish(task: UploadTaskRecord, signal: AbortSignal): Promise<void> {
    if (task.result.publish_outcome !== "MAY_HAVE_SUBMITTED" || this.submitted || this.preparedTask !== task.result.upload_task_id) throw new Error("Publish fence or ownership absent");
    await this.guard(signal);
    if (new URL(this.page!.url()).pathname !== new URL(this.pageContract().uploadUrl).pathname || await (await this.unique(this.pageContract().caption, signal)).inputValue() !== (task.input.caption ?? "")) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "任务页面或手工文案已被改变。", "人工核查原提交，不会再次点击。", true);
    const button = await this.unique(this.pageContract().publish, signal);
    this.check(signal); this.submitted = true; // One invocation even when click throws.
    await this.action(signal, () => button.click({ timeout: task.config.timeouts.action }));
  }
  async verify(task: UploadTaskRecord, signal: AbortSignal): Promise<UploadSuccess> {
    const c = this.pageContract(); this.check(signal);
    if (!this.page || this.preparedTask !== task.result.upload_task_id || !this.submitted) throw uploadFailure("PUBLISH_CONFIRMATION_UNAVAILABLE", "publish", "重连后无法可靠恢复原提交页面。", "人工按具体内容 ID 核查并记录接受证据。", true);
    const deadline = Date.now() + task.config.timeouts.confirmation;
    while (!await this.page.locator(c.accepted).isVisible()) {
      await this.guard(signal);
      if (Date.now() >= deadline) throw uploadFailure("PUBLISH_CONFIRMATION_UNAVAILABLE", "publish", "接受确认超过总时限。", "人工核查原提交。", true);
      await this.action(signal, () => this.page!.waitForTimeout(Math.min(200, deadline - Date.now())));
    }
    await this.guard(signal);
    const accepted = await this.unique(c.accepted, signal);
    const id = await accepted.getAttribute(c.contentIdAttribute);
    if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw uploadFailure("PUBLISH_CONFIRMATION_UNAVAILABLE", "publish", "缺少稳定的内容 ID。", "人工核查原提交。", true);
    const managementUrl = c.managementUrl(id);
    if (new URL(managementUrl).origin !== new URL(c.uploadUrl).origin) throw new Error("Invalid management origin");
    await this.action(signal, () => this.page!.goto(managementUrl, { timeout: Math.max(1, Math.min(task.config.timeouts.navigation, deadline - Date.now())), waitUntil: "domcontentloaded" }));
    await this.guard(signal);
    const reopened = await this.unique(c.accepted, signal), sameId = await reopened.getAttribute(c.contentIdAttribute), status = await reopened.getAttribute(c.statusAttribute);
    if (sameId !== id || (status !== "reviewing" && status !== "published")) throw uploadFailure("PUBLISH_CONFIRMATION_UNAVAILABLE", "publish", "管理页未证明同 ID 内容已被接受。", "人工核查；草稿或弱信号不算成功。", true);
    return { platform_content_id: id, accepted_status: status, url: c.evidenceUrl(id), observed_at: new Date().toISOString(), confirmation_source: "browser", evidence: `Same content ID reopened; contract ${c.version}` };
  }
  async stop(): Promise<void> {
    this.controller.abort();
    // Our relay disconnects all in-flight automation and never sends Browser.close to Chrome.
    await this.transport?.close();
    const browser = this.browser; this.browser = undefined;
    await browser?.close().catch(() => undefined); // Connected-browser cleanup, tested with the fixed runtime version.
    // Task tab stays available for human inspection; existing context/user tabs are untouched.
  }
}
