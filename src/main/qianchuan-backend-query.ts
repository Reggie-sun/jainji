import { QianchuanBackendAdapter } from "./qianchuan-backend-adapter.js";
import { withQianchuanQueryPage } from "./qianchuan-query-page.js";
import { verifyBrowserEgress } from "./qianchuan-egress-browser.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import type { QianchuanBackendQuery, QianchuanBackendResult } from "../shared/qianchuan-backend.js";

/** Reads through the existing account browser and egress, without exporting its login state. */
export async function readQianchuanBackendQuery(target: FrozenQianchuanAccount, query: QianchuanBackendQuery, signal: AbortSignal): Promise<QianchuanBackendResult> {
  signal.throwIfAborted();
  if (query.expectedAdvertiserId !== target.advertiserId) throw new Error("广告账户已变化，请重新选择账号。");
  try {
    const lease = await verifyBrowserEgress(target.cdpEndpoint, target.egress);
    const active = lease ? AbortSignal.any([signal, lease.signal]) : signal;
    active.throwIfAborted();
    return await withQianchuanQueryPage(target, active, async page => {
      const url = new URL("https://qianchuan.jinritemai.com/uni-prom");
      url.searchParams.set("aavid", target.advertiserId);
      // Existing account discovery excludes marked picker pages from user account selection.
      url.searchParams.set("jianjiPlanPicker", "1");
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.locator(".account-info-container").first().waitFor({ state: "visible", timeout: 10000 });
      active.throwIfAborted();
      const adapter = await QianchuanBackendAdapter.create(page, target.advertiserId);
      try { return await adapter.query(query, active); }
      finally { await adapter.dispose(); }
    });
  } catch {
    signal.throwIfAborted();
    throw new Error("千川查询失败，请检查账号网页、登录状态和网络连接。");
  }
}
