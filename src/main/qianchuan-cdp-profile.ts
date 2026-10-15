import path from "node:path";
import { withQianchuanQueryPage } from "./qianchuan-query-page.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import type { QianchuanBrowserBinding } from "./qianchuan-browser-bindings.js";

const changed = () => new Error("Chrome 实际资料目录或默认连接与原账号不一致，未读取子账户。请检查原账号浏览器。");

/** A process endpoint alone does not identify the profile behind its default context. */
export async function readQianchuanCdpProfile(target: FrozenQianchuanAccount, binding: QianchuanBrowserBinding, signal: AbortSignal): Promise<string> {
  return withQianchuanQueryPage(target, signal, async page => {
    const browser = page.context().browser(); if (!browser) throw changed();
    const session = await browser.newBrowserCDPSession();
    const pageSession = await page.context().newCDPSession(page);
    try {
      const before = await session.send("Target.getBrowserContexts");
      const contextId = before.defaultBrowserContextId;
      if (!Array.isArray(before.browserContextIds) || typeof contextId !== "string" || !contextId || before.browserContextIds.includes(contextId)) throw changed();
      const initial = (await pageSession.send("Target.getTargetInfo")).targetInfo;
      if (initial.type !== "page" || initial.browserContextId !== contextId) throw changed();
      await page.goto("chrome://version/", { waitUntil: "domcontentloaded" });
      const profilePath = await page.locator("#profile_path").textContent();
      if (page.url() !== "chrome://version/" || profilePath?.trim() !== path.join(binding.profile, binding.profileDirectory)) throw changed();
      const after = (await pageSession.send("Target.getTargetInfo")).targetInfo;
      if (after.targetId !== initial.targetId || after.type !== "page" || after.url !== "chrome://version/" || after.browserContextId !== contextId ||
        (await session.send("Target.getBrowserContexts")).defaultBrowserContextId !== contextId) throw changed();
      signal.throwIfAborted(); return contextId;
    } finally {
      await pageSession.detach().catch(() => undefined);
      await session.detach().catch(() => undefined);
    }
  });
}
