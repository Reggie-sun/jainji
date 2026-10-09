import { guardedTransport } from "./local-cdp-transport.js";
import { browserWebSocketForEndpoint } from "./qianchuan-browser-discovery.js";
import { chromium, type Browser, type Page } from "playwright-core";
import { isLoopbackUrl, uploadFailure, type PageOwnership, type ReadyEvidence, type QianchuanUploadConfig } from "../shared/douyin-upload.js";
import { MAX_UPLOAD_GROUP_SIZE, type UploadBrowserPort, type BatchSelectedFile } from "./douyin-upload-service.js";
import type { UploadTaskRecord } from "./douyin-upload-store.js";
import { QianchuanPageSession, PRODUCTION_QIANCHUAN_CONTRACT, qianchuanReadiness, type QianchuanPageContract } from "./qianchuan-page-contract.js";
import { verifyBrowserEgress } from "./qianchuan-egress-browser.js";
import type { EgressLease } from "./qianchuan-egress-runtime.js";
export const douyinReadiness = (_config: QianchuanUploadConfig) => qianchuanReadiness();
export type { QianchuanPageContract };

export class DouyinCdpUploader implements UploadBrowserPort {
  private browser?: Browser;
  private page?: Page;
  private session?: QianchuanPageSession;
  private transport?: Awaited<ReturnType<typeof guardedTransport>>;
  private readonly controller = new AbortController();
  private egressLease?: EgressLease;
  private readonly egressLost = () => { void this.stop(); };
  constructor(private readonly contract: QianchuanPageContract | undefined = PRODUCTION_QIANCHUAN_CONTRACT) {}
  private check = (signal: AbortSignal): void => { signal.throwIfAborted(); this.controller.signal.throwIfAborted(); this.egressLease?.signal.throwIfAborted(); };
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
    try {
      this.egressLease = await verifyBrowserEgress(endpoint, task.authorization.target.egress);
      this.egressLease?.signal.addEventListener("abort", this.egressLost, { once: true });
      this.check(signal);
    } catch { throw uploadFailure("ACCOUNT_UNCONFIRMED", "account", "账号固定出口未通过验证，未执行上传。", "检查固定出口并明确重连；结果未知的原批次不能重传。", true); }
    await this.action(signal, async () => {
      try {
        const response = await fetch(new URL("/json/version", endpoint), { redirect: "error", signal: AbortSignal.any([signal, this.controller.signal]) });
        const info = response.status === 404
          ? { webSocketDebuggerUrl: await browserWebSocketForEndpoint(endpoint) }
          : response.ok ? await response.json() as { webSocketDebuggerUrl?: unknown } : undefined;
        if (!info) throw new Error("Discovery unavailable");
        if (typeof info.webSocketDebuggerUrl !== "string" || !isLoopbackUrl(info.webSocketDebuggerUrl, true) || new URL(info.webSocketDebuggerUrl).port !== new URL(endpoint).port) throw new Error("Unsafe discovery websocket");
        this.check(signal); this.transport = await guardedTransport(info.webSocketDebuggerUrl, this.controller.signal, task.config.timeouts.connect); this.check(signal);
        const browser = await chromium.connectOverCDP(this.transport.url, { timeout: task.config.timeouts.connect, noDefaults: true, isLocal: true });
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
      if (task.authorization.target.egress) await verifyBrowserEgress(task.authorization.target.cdpEndpoint, task.authorization.target.egress);
      this.check(signal);
      const initial = !this.page;
      if (!this.page) {
        if (selected.length) throw new Error("Missing original task page");
        const context = this.browser?.contexts()[0]; if (!context) throw new Error("Not connected");
        this.check(signal); this.page = await context.newPage(); this.check(signal);
        if (contract.kind === "qianchuan") {
          const window = await this.browser!.newBrowserCDPSession();
          try {
            const { windowId } = await window.send("Browser.getWindowForTarget", { targetId: await this.targetId(this.page) }); this.check(signal);
            await window.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "maximized" } }); this.check(signal);
          } finally { await window.detach(); }
        }
        this.session = new QianchuanPageSession(this.page, contract, this.check);
        await this.page.goto(this.session.url(task), { timeout: task.config.timeouts.navigation, waitUntil: "domcontentloaded" }); this.check(signal);
      }
      // Background tabs can suspend animation frames used by click stability checks.
      await this.page.bringToFront(); this.check(signal);
      if (initial) await this.session!.openInitialPlan(task, signal);
      return this.session!.prepare(tasks, selected, await this.targetId(this.page), signal);
    });
  }
  async upload(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<void> { await this.action(signal, () => this.session!.upload(tasks, signal)); }
  async ready(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<ReadyEvidence[]> { return this.action(signal, () => this.session!.ready(tasks, signal)); }
  async pollReady(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<ReadyEvidence[] | undefined> { return this.action(signal, () => this.session!.pollReady(tasks, signal)); }
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
    this.egressLease?.signal.removeEventListener("abort", this.egressLost);
    this.session?.clearChooser();
    this.controller.abort(); await this.transport?.close();
    const browser = this.browser; this.browser = undefined; await browser?.close().catch(() => undefined);
    // Relay detaches automation; Chrome, default context and every task tab remain for the user.
  }
}
