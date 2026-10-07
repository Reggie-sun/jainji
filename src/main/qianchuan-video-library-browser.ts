import { chromium, type Browser } from "playwright-core";
import { guardedTransport } from "./local-cdp-transport.js";
import { isLoopbackUrl } from "../shared/douyin-upload.js";
import { QianchuanVideoLibraryPage } from "./qianchuan-video-library-page.js";
import { VIDEO_LIBRARY_ROUTE } from "../shared/qianchuan-video-library.js";
import { QianchuanPlanMaterialPage } from "./qianchuan-plan-material-page.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import type { Page } from "playwright-core";
import type { ZeroImpressionsWindow } from "./qianchuan-zero-impressions.js";

export async function connectVideoLibrary(endpoint: string, advertiserId: string, signal: AbortSignal): Promise<{
  page: QianchuanVideoLibraryPage; close(): Promise<void>;
}> {
  return connectLibrary(endpoint, advertiserId, signal, url => url.pathname === VIDEO_LIBRARY_ROUTE,
    page => new QianchuanVideoLibraryPage(page, advertiserId, signal));
}

export function connectPlanMaterials(target: FrozenQianchuanAccount, signal: AbortSignal, zeroWindow?: ZeroImpressionsWindow): Promise<{
  page: QianchuanPlanMaterialPage; close(): Promise<void>;
}> {
  return connectLibrary(target.cdpEndpoint, target.advertiserId, signal,
    url => url.pathname === "/uni-prom" && url.searchParams.getAll("adId").length === 1 && url.searchParams.get("adId") === target.adId &&
      new URLSearchParams(url.hash.slice(1)).get("jianjiCleanup") === "plan-materials",
    page => new QianchuanPlanMaterialPage(page, target, signal, zeroWindow));
}

async function connectLibrary<T extends object>(endpoint: string, advertiserId: string, signal: AbortSignal,
  matches: (url: URL) => boolean, create: (page: Page) => T): Promise<{ page: T; close(): Promise<void> }> {
  signal.throwIfAborted();
  if (!isLoopbackUrl(endpoint) || new URL(endpoint).pathname !== "/") throw new Error("视频库浏览器连接无效。");
  const response = await fetch(new URL("/json/version", endpoint), { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  if (!response.ok) throw new Error("视频库浏览器连接不可用。");
  const info = await response.json() as { webSocketDebuggerUrl?: unknown };
  if (typeof info.webSocketDebuggerUrl !== "string" || !isLoopbackUrl(info.webSocketDebuggerUrl, true) ||
    new URL(info.webSocketDebuggerUrl).host !== new URL(endpoint).host) throw new Error("视频库浏览器连接无效。");
  const relay = await guardedTransport(info.webSocketDebuggerUrl, signal, 10000);
  let browser: Browser | undefined;
  try {
    browser = await chromium.connectOverCDP(relay.url, { timeout: 10000, noDefaults: true });
    signal.throwIfAborted();
    if (browser.contexts().length !== 1) throw new Error("无法唯一核对视频库浏览器。");
    const context = browser.contexts()[0];
    const existing = context.pages().find(page => {
      try {
        const url = new URL(page.url());
        return !page.isClosed() && url.origin === "https://qianchuan.jinritemai.com" && matches(url) &&
          url.searchParams.getAll("aavid").length === 1 && url.searchParams.get("aavid") === advertiserId;
      } catch { return false; }
    });
    const page = existing ?? await context.newPage();
    page.setDefaultTimeout(10000);
    const session = create(page);
    return { page: session, close: async () => {
      if ("dispose" in session && typeof session.dispose === "function") await session.dispose();
      await relay.close(); await browser?.close();
      // Reuse the same library tab on the next connection; preserve all upload tabs.
    } };
  } catch (error) { await relay.close(); await browser?.close().catch(() => undefined); throw error; }
}
