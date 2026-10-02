import { chromium, type Browser } from "playwright-core";
import { guardedTransport } from "./local-cdp-transport.js";
import { isLoopbackUrl } from "../shared/douyin-upload.js";
import { QianchuanVideoLibraryPage } from "./qianchuan-video-library-page.js";

export async function connectVideoLibrary(endpoint: string, advertiserId: string, signal: AbortSignal): Promise<{
  page: QianchuanVideoLibraryPage; close(): Promise<void>;
}> {
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
    const page = await browser.contexts()[0].newPage();
    page.setDefaultTimeout(10000);
    return { page: new QianchuanVideoLibraryPage(page, advertiserId, signal), close: async () => {
      await relay.close(); await browser?.close();
      // Keep the new library tab and every original upload tab for human inspection.
    } };
  } catch (error) { await relay.close(); await browser?.close().catch(() => undefined); throw error; }
}
