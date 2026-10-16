import { chromium, type Page } from "playwright-core";
import { guardedTransport } from "./local-cdp-transport.js";
import { QianguanjiaTransport } from "./qianguanjia-transport.js";
import { runningChromeEndpoints } from "./qianchuan-browser-discovery.js";
import { QianguanjiaReadonlyAdapter } from "./qianchuan-qianguanjia-adapter.js";

const unavailable = () => new Error("无法连接千管家正常页面，请保持已登录的 Chrome 打开后重新发现。");
const routes = new Map([
  ["/dist/adsreport/report-uni/video", "千管家推商品报表"],
  ["/dist/adsreport/report-uni/materialNew", "千管家素材报表"],
  ["/dist/material/index", "千管家素材中心"],
  ["/dist/dashboard/index", "千管家首页"],
  ["/dist/advertiser/manage/AdvertiserManager/index", "千管家账户管理"],
]);
function pageLabel(value: string): string | undefined {
  try { const url = new URL(value); return url.origin === "https://qc.uliangtech.com" && !url.username && !url.password ? routes.get(url.pathname) : undefined; }
  catch { return undefined; }
}
export interface QianguanjiaBrowserTarget { websocket: string; targetId: string; label: string }
async function metadata(url: string, signal: AbortSignal, limit: number): Promise<unknown> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) });
  if (response.status !== 200 || !response.body) throw unavailable();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > limit) throw unavailable(); chunks.push(chunk.value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
/** Process/CDP metadata only: never reads profile login files or opens a new browser. */
export async function discoverQianguanjiaTargets(signal: AbortSignal, endpoints = runningChromeEndpoints): Promise<{ targets: QianguanjiaBrowserTarget[]; unavailableBrowsers: number }> {
  signal.throwIfAborted();
  const candidates = [...new Set(await endpoints())];
  if (candidates.length > 16) throw unavailable();
  const targets: QianguanjiaBrowserTarget[] = []; let unavailableBrowsers = 0;
  for (const endpoint of candidates) {
    signal.throwIfAborted();
    if (!/^(?:http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}|ws:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/devtools\/browser\/[A-Za-z0-9-]+)$/.test(endpoint) || Number(new URL(endpoint).port) > 65535) throw unavailable();
    try {
      const host = new URL(endpoint).host, root = `http://${host}`;
      const version = await metadata(`${root}/json/version`, signal, 65536) as { webSocketDebuggerUrl?: unknown };
      const websocket = version?.webSocketDebuggerUrl;
      if (typeof websocket !== "string" || !/^ws:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/devtools\/browser\/[A-Za-z0-9-]+$/.test(websocket) || new URL(websocket).host !== host || endpoint.startsWith("ws:") && websocket !== endpoint) throw unavailable();
      const tabs = await metadata(`${root}/json/list`, signal, 262144);
      if (!Array.isArray(tabs) || tabs.length > 256) throw unavailable();
      const found: QianguanjiaBrowserTarget[] = [];
      for (const tab of tabs) {
        if (!tab || typeof tab.type !== "string" || typeof tab.url !== "string" || tab.url.length > 16384) throw unavailable();
        const label = tab.type === "page" ? pageLabel(tab.url) : undefined;
        if (!label) continue;
        if (typeof tab.id !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(tab.id)) throw unavailable();
        found.push({ websocket, targetId: tab.id, label });
      }
      for (const target of found) if (!targets.some(item => item.websocket === target.websocket && item.targetId === target.targetId)) targets.push(target);
    } catch { signal.throwIfAborted(); unavailableBrowsers++; }
  }
  if (targets.length > 32) throw unavailable();
  return { targets, unavailableBrowsers };
}

/** Attach only the selected existing page. close() detaches; it never closes a tab or Chrome. */
export async function connectQianguanjiaTarget(target: QianguanjiaBrowserTarget, signal: AbortSignal): Promise<{ adapter: QianguanjiaReadonlyAdapter; close(): Promise<void> }> {
  const controller = new AbortController();
  const aborted = () => controller.abort(); signal.addEventListener("abort", aborted, { once: true });
  if (signal.aborted) controller.abort();
  const deadline = setTimeout(() => controller.abort(), 15000);
  let relay: Awaited<ReturnType<typeof guardedTransport>> | undefined;
  let transport: QianguanjiaTransport | undefined;
  let adapter: QianguanjiaReadonlyAdapter | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    controller.abort(); transport?.close();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.allSettled([relay?.close(), adapter?.dispose()]), new Promise<void>(resolve => { timer = setTimeout(resolve, 2000); })]); }
    finally { clearTimeout(timer); }
  })();
  try {
    relay = await guardedTransport(target.websocket, controller.signal, 10000);
    transport = await QianguanjiaTransport.connect(relay.url, target.targetId, controller.signal);
    const browser = await chromium.connectOverCDP(transport, { timeout: 10000, noDefaults: true });
    const session = await browser.newBrowserCDPSession();
    try {
      const info = (await session.send("Target.getTargetInfo", { targetId: target.targetId })).targetInfo;
      if (info.type !== "page" || !pageLabel(info.url)) throw unavailable();
      if (browser.contexts().length !== 1) throw unavailable();
      const opened = browser.contexts()[0]!.waitForEvent("page", { timeout: 10000 }) as Promise<Page>;
      void opened.catch(() => undefined);
      await transport.attach();
      const page = await opened;
      const pageSession = await page.context().newCDPSession(page);
      try {
        if ((await pageSession.send("Target.getTargetInfo")).targetInfo.targetId !== target.targetId || !pageLabel(page.url())) throw unavailable();
      } finally { await pageSession.detach().catch(() => undefined); }
      await transport.refreshMainWorld();
      adapter = await QianguanjiaReadonlyAdapter.create(page);
      signal.throwIfAborted(); controller.signal.throwIfAborted();
      return { adapter, close };
    } finally { await session.detach().catch(() => undefined); }
  } catch { await close(); throw unavailable(); }
  finally { clearTimeout(deadline); signal.removeEventListener("abort", aborted); }
}
