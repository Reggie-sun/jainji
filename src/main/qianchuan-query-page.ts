import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";
import { guardedTransport } from "./local-cdp-transport.js";
import { QianchuanPickerTransport } from "./qianchuan-picker-transport.js";
import { isLoopbackUrl } from "../shared/douyin-upload.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
const changed = () => new Error("千川账号查询连接无法核对，请检查账号浏览器后重试。");
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

/** Shared, guarded connection: only this invocation's new picker tab is attached and closed. */
export async function withQianchuanQueryPage<T>(target: FrozenQianchuanAccount, signal: AbortSignal, read: (page: Page) => Promise<T>, expectedBrowserContextId?: string): Promise<T> {
  signal.throwIfAborted();
  if (!/^[1-9][0-9]{0,19}$/.test(target.advertiserId) || !isLoopbackUrl(target.cdpEndpoint) || new URL(target.cdpEndpoint).pathname !== "/") throw changed();
  let relay: Awaited<ReturnType<typeof guardedTransport>> | undefined;
  let pickerTransport: QianchuanPickerTransport | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let pickerSession: CDPSession | undefined;
  let pickerTargetId: string | undefined;
  const transportController = new AbortController();
  try {
    const endpoint = new URL(target.cdpEndpoint);
    const response = await fetch(new URL("/json/version", endpoint), { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
    if (!response.ok) throw changed();
    const info = await response.json() as { webSocketDebuggerUrl?: unknown };
    if (typeof info.webSocketDebuggerUrl !== "string" || !isLoopbackUrl(info.webSocketDebuggerUrl, true) ||
      new URL(info.webSocketDebuggerUrl).host !== endpoint.host) throw changed();
    // Keep the relay alive until cancellation has closed this invocation's target.
    relay = await guardedTransport(info.webSocketDebuggerUrl, transportController.signal, 10_000);
    signal.throwIfAborted();
    pickerTransport = await QianchuanPickerTransport.connect(relay.url, transportController.signal);
    signal.throwIfAborted();
    const connection = chromium.connectOverCDP(pickerTransport, { timeout: 10_000, noDefaults: true }).then(async connected => {
      if (signal.aborted) { await connected.close().catch(() => undefined); signal.throwIfAborted(); }
      return connected;
    });
    browser = await abortable(connection, signal);
    if (browser.contexts().length !== 1) throw changed();
    const context = browser.contexts()[0]!;
    pickerSession = await browser.newBrowserCDPSession();
    signal.throwIfAborted();
    let creating: Promise<{ targetId: string }>;
    const opening = context.waitForEvent("page", { timeout: 10_000, predicate: async candidate => {
      const owned = await creating;
      const candidateSession = await context.newCDPSession(candidate);
      try { return (await candidateSession.send("Target.getTargetInfo")).targetInfo.targetId === owned.targetId; }
      finally { await candidateSession.detach().catch(() => undefined); }
    } });
    void opening.catch(() => undefined);
    const creationTimer = setTimeout(() => transportController.abort(), 10_000);
    try {
      creating = pickerSession.send("Target.createTarget", { url: "about:blank", background: true });
      pickerTargetId = (await creating).targetId;
      signal.throwIfAborted();
      // Compare the actual blank target before attaching or navigating. A matching
      // advertiser alone does not prove that two pages share browser login state.
      if (expectedBrowserContextId !== undefined) {
        const actual = await abortable(pickerSession.send("Target.getTargetInfo", { targetId: pickerTargetId }), signal);
        if (!expectedBrowserContextId || actual.targetInfo.browserContextId !== expectedBrowserContextId) throw changed();
      }
      await abortable(pickerTransport.attach(pickerTargetId), signal);
    } finally { clearTimeout(creationTimer); }
    signal.throwIfAborted();
    page = await abortable(opening, signal);
    page.setDefaultTimeout(10_000);
    await abortable(page.setViewportSize({ width: 1600, height: 1000 }), signal);
    return await abortable(read(page), signal);
  } finally {
    const cleanupTimer = setTimeout(() => transportController.abort(), 2000);
    cleanupTimer.unref();
    await page?.close({ runBeforeUnload: false }).catch(() => undefined);
    if (pickerTargetId && pickerSession) {
      await pickerSession.send("Target.closeTarget", { targetId: pickerTargetId }).catch(() => undefined);
      // Chrome acknowledges close before other connections observe the target's removal.
      // Keep this invocation's transport alive until its own blank/loaded picker is gone.
      await (async () => {
        while (!transportController.signal.aborted) {
          const targets = await pickerSession!.send("Target.getTargets");
          if (!targets.targetInfos.some(target => target.targetId === pickerTargetId)) return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      })().catch(() => undefined);
    }
    await pickerSession?.detach().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    transportController.abort();
    pickerTransport?.close();
    await relay?.close().catch(() => undefined);
    clearTimeout(cleanupTimer);
  }
}
