import { chromium, type Browser, type Page } from "playwright-core";
import { isLoopbackUrl } from "../shared/douyin-upload.js";
import { QianchuanSubaccountCatalogSchema, type QianchuanSubaccountCatalog } from "../shared/qianchuan-subaccounts.js";
import type { QianchuanCurrentAccount } from "../shared/qianchuan-plan-selection.js";
import { readCurrentQianchuanPage } from "./qianchuan-current-account.js";
import { QianchuanPickerTransport } from "./qianchuan-picker-transport.js";

const failure = () => new Error("无法完整核对千川子账户，请检查网页后刷新子账户。");
type Guard = () => Promise<void>;

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Attach only the verified visible account page; disconnect never closes a user tab. */
async function withAccountPage<T>(endpoint: string, signal: AbortSignal, excluded: ReadonlySet<string>, guard: Guard,
  action: (page: Page, identity: Awaited<ReturnType<typeof readCurrentQianchuanPage>>) => Promise<T>): Promise<T> {
  let transport: QianchuanPickerTransport | undefined, browser: Browser | undefined;
  try {
    await guard();
    const identity = await readCurrentQianchuanPage(endpoint, signal, excluded);
    const url = new URL(endpoint);
    if (!isLoopbackUrl(endpoint) || url.pathname !== "/") throw failure();
    const response = await fetch(new URL("/json/version", url), { redirect: "error", signal });
    const length = response.headers.get("content-length");
    if (!response.ok || (length !== null && (!/^\d+$/.test(length) || Number(length) > 65536))) throw failure();
    if (!response.body) throw failure();
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try { for (;;) { const item = await abortable(reader.read(), signal); if (item.done) break; size += item.value.length; if (size > 65536) throw failure(); chunks.push(item.value); } }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const bytes = Buffer.concat(chunks).toString("utf8");
    const socket = JSON.parse(bytes).webSocketDebuggerUrl;
    if (typeof socket !== "string" || !isLoopbackUrl(socket, true) || new URL(socket).host !== url.host || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(new URL(socket).pathname)) throw failure();
    transport = await QianchuanPickerTransport.connect(socket, signal);
    browser = await abortable(chromium.connectOverCDP(transport, { noDefaults: true, timeout: 5000 }), signal);
    if (browser.contexts().length !== 1) throw failure();
    const context = browser.contexts()[0]!;
    const opening = context.waitForEvent("page", { timeout: 5000 });
    void opening.catch(() => undefined);
    await abortable(transport.attach(identity.targetId), signal);
    const page = await abortable(opening, signal);
    const session = await context.newCDPSession(page);
    try { if ((await session.send("Target.getTargetInfo")).targetInfo.targetId !== identity.targetId) throw failure(); }
    finally { await session.detach(); }
    page.setDefaultTimeout(5000);
    const fresh = await readCurrentQianchuanPage(endpoint, signal, excluded);
    if (JSON.stringify(fresh) !== JSON.stringify(identity)) throw failure();
    return await action(page, identity);
  } catch {
    if (signal.aborted) throw signal.reason;
    throw failure();
  } finally {
    await browser?.close().catch(() => undefined);
    transport?.close();
  }
}

async function catalogOnPage(page: Page, identity: Awaited<ReturnType<typeof readCurrentQianchuanPage>>, signal: AbortSignal, guard: Guard): Promise<QianchuanSubaccountCatalog> {
  const documentHandle = await abortable(page.evaluateHandle(() => window.document), signal);
  const check = async () => {
    signal.throwIfAborted(); await guard();
    if (page.url() !== identity.url || !await abortable(page.evaluate(original => original === window.document, documentHandle), signal)) throw failure();
    const texts = await abortable(page.locator(".account-info-container .account-info-box").allInnerTexts(), signal);
    if (texts.length !== 1 || texts[0]!.replace(/\s+/g, " ").trim() !== `${identity.account.name} ID：${identity.account.advertiserId}`) throw failure();
  };
  try {
    await check();
    const list = page.locator(".qc-ui-navigator-account-list");
    if (!await list.isVisible()) {
      await abortable(page.locator(".account-info-container").hover(), signal);
      const switcher = page.locator(".qc-ui-navigator-account-detail .checkout-account");
      if (await switcher.count() !== 1) throw failure();
      await check(); await abortable(switcher.click(), signal);
    }
    await abortable(list.waitFor({ state: "visible" }), signal);
    const search = list.locator('input[placeholder="请输入账户名称或完整ID"]');
    if (await search.count() !== 1 || await search.inputValue() !== "") throw failure();
    for (let step = 0; step < 100; step++) {
      await check();
      const end = list.locator(".tools-vmok-plugin-infinite-scroll__loader");
      if (await end.count() !== 1) throw failure();
      if ((await end.innerText()).trim() === "没有更多了") break;
      const previous = await list.locator(".qc-ui-navigator-account-item").count();
      if (previous > 1000 || step === 99) throw failure();
      await abortable(list.locator(".tools-vmok-plugin-infinite-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; }), signal);
      await abortable(page.waitForFunction(count => document.querySelectorAll(".qc-ui-navigator-account-list .qc-ui-navigator-account-item").length > count || document.querySelector(".qc-ui-navigator-account-list .tools-vmok-plugin-infinite-scroll__loader")?.textContent?.trim() === "没有更多了", previous, { timeout: 5000 }), signal);
    }
    const snapshot = async () => QianchuanSubaccountCatalogSchema.parse({ current: identity.account, accounts: await abortable(list.locator(".qc-ui-navigator-account-item").evaluateAll(rows => rows.map(row => {
      const ids = row.querySelectorAll(".account-id"), names = row.querySelectorAll(".account-name");
      return { advertiserId: ids.length === 1 ? /^ID\s+([1-9][0-9]{0,19})$/.exec(ids[0]!.textContent!.trim())?.[1] : undefined,
        name: names.length === 1 ? names[0]!.textContent!.trim() : undefined };
    })), signal) });
    await check(); const first = await snapshot();
    await abortable(new Promise(resolve => setTimeout(resolve, 100)), signal);
    await check(); const second = await snapshot();
    if (JSON.stringify(first) !== JSON.stringify(second)) throw failure();
    return second;
  } finally { await documentHandle.dispose().catch(() => undefined); }
}

export async function readQianchuanSubaccounts(endpoint: string, signal: AbortSignal, excluded: ReadonlySet<string>, guard: Guard): Promise<QianchuanSubaccountCatalog> {
  return withAccountPage(endpoint, signal, excluded, guard, (page, identity) => catalogOnPage(page, identity, signal, guard));
}

export async function switchQianchuanSubaccount(endpoint: string, expected: string, advertiserId: string, signal: AbortSignal, excluded: ReadonlySet<string>, guard: Guard): Promise<QianchuanCurrentAccount> {
  return withAccountPage(endpoint, signal, excluded, guard, async (page, identity) => {
    if (identity.account.advertiserId !== expected) throw failure();
    const catalog = await catalogOnPage(page, identity, signal, guard);
    const chosen = catalog.accounts.find(account => account.advertiserId === advertiserId);
    if (!chosen) throw failure();
    if (advertiserId === expected) return identity.account;
    const documentHandle = await abortable(page.evaluateHandle(() => window.document), signal);
    try {
      await guard(); signal.throwIfAborted();
      // Validate the exact current document and row again inside the single click operation.
      await abortable(page.evaluate(({ original, href, current, chosen }) => {
        const text = document.querySelector(".account-info-container .account-info-box")?.textContent?.replace(/\s+/g, " ").trim();
        const rows = Array.from(document.querySelectorAll(".qc-ui-navigator-account-list .qc-ui-navigator-account-item")).filter(row => row.querySelector(".account-id")?.textContent?.trim() === `ID ${chosen.advertiserId}` && row.querySelector(".account-name")?.textContent?.trim() === chosen.name);
        if (original !== document || location.href !== href || document.visibilityState !== "visible" || text?.replace(/\s/g, "") !== `${current.name}ID：${current.advertiserId}`.replace(/\s/g, "") || rows.length !== 1) throw new Error("Account changed");
        (rows[0] as HTMLElement).click();
      }, { original: documentHandle, href: identity.url, current: identity.account, chosen }), signal);
      // A missing result is observation-only; never click again or roll back automatically.
      await abortable(page.waitForFunction(id => new URL(location.href).searchParams.get("aavid") === id && document.querySelector(".account-info-container .account-info-box")?.textContent?.includes(id), advertiserId, { timeout: 10000 }), signal);
      const fresh = await readCurrentQianchuanPage(endpoint, signal, excluded);
      if (fresh.targetId !== identity.targetId || JSON.stringify(fresh.account) !== JSON.stringify(chosen)) throw failure();
      return fresh.account;
    } finally { await documentHandle.dispose().catch(() => undefined); }
  });
}
