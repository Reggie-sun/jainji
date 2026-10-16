import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { qianchuanBackendFixtureScript, qianchuanBackendFixtureStyles } from "./helpers/qianchuan-backend-ui-fixture";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });
async function fixture(width = 1000) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.route("http://127.0.0.1:3000/query", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div id="root"></div>' }));
  await page.goto("http://127.0.0.1:3000/query");
  await page.addStyleTag({ content: qianchuanBackendFixtureStyles() });
  await page.addScriptTag({ content: qianchuanBackendFixtureScript() });
  await page.getByLabel("查询账号").waitFor();
  return page;
}
async function configureSupplier(page: Awaited<ReturnType<typeof fixture>>, options: { count?: number; sessions?: number; delayKind?: string; homeAt?: string } = {}) {
  await page.evaluate(options => {
    const w = window as any, original = window.jianji.queryQianguanjia;
    window.jianji.queryQianguanjia = async input => {
      const result = await original(input);
      if (result.kind === "discover" && options.sessions === 2) result.sessions.push({ sessionId: "712f9350-51c4-4599-a5ab-a6d2d40486d8", label: "隔离第二个页面" });
      if (result.kind === "accounts" && options.count) result.data.accounts = Array.from({ length: options.count }, (_, i) => ({ advertiserId: String(1879999999999999999n + BigInt(i)), name: i ? `授权测试账户 ${i + 1}` : "授权测试账户", authStatus: i % 2 ? 0 : 1, authStatusDesc: i % 2 ? "授权失效" : "授权正常" }));
      if (result.kind === "home" && options.homeAt) result.data.observedAt = options.homeAt;
      if (input.kind === options.delayKind) return new Promise(resolve => w.supplierPending.push(() => resolve(result)));
      return result;
    };
  }, options);
}
it("reads explicit plan, material pages and report, clearing stale data on edits", async () => {
  const page = await fixture();
  try {
    expect(await page.evaluate(() => (window as any).reads)).toEqual([]);
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByRole("heading", { name: "真实结构示例计划" }).waitFor();
    expect(await page.locator(".qianchuan-query-metrics dd").nth(1).innerText()).toBe("1000.00");
    expect(await page.locator(".qianchuan-query-metrics dt").nth(1).innerText()).toBe("预算（元）");
    await page.getByLabel("查询账号").selectOption("肥皂");
    expect(await page.getByRole("heading", { name: "真实结构示例计划" }).count()).toBe(0);
    expect(await page.getByLabel("查询计划 ID").inputValue()).toBe("67891");
    await page.getByLabel("查询内容").selectOption("materials");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByRole("cell", { name: /^素材页 0\b/ }).waitFor();
    await page.getByRole("button", { name: "下一页" }).click();
    await page.getByRole("cell", { name: /^素材页 100\b/ }).waitFor();
    expect(await page.getByRole("button", { name: "下一页" }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "上一页" }).click();
    await page.getByRole("cell", { name: /^素材页 0\b/ }).waitFor();
    await page.getByLabel("查询内容").selectOption("report");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.locator(".qianchuan-query-metrics dd").first().waitFor();
    expect(await page.evaluate(() => (window as any).reads.map((input: any) => [input.kind, input.expectedAdvertiserId, input.offset]))).toEqual([
      ["plan", "12345", undefined], ["materials", "12346", 0], ["materials", "12346", 100], ["materials", "12346", 0], ["report", "12346", undefined],
    ]);
    await page.getByLabel("查询开始日期").fill("2026-01-01");
    expect(await page.locator(".qianchuan-query-result").count()).toBe(0);
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByRole("alert").waitFor();
    expect(await page.evaluate(() => (window as any).reads.length)).toBe(5);
  } finally { await page.close(); }
});
it.each(["cancel", "hide", "identity"])("cancels on %s and ignores a late result", async action => {
  const page = await fixture();
  try {
    await page.evaluate(() => { (window as any).delay = true; });
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByRole("button", { name: "取消查询" }).waitFor();
    if (action === "cancel") await page.getByRole("button", { name: "取消查询" }).click();
    if (action === "hide") await page.evaluate(() => (window as any).setActive(false));
    if (action === "identity") await page.evaluate(() => (window as any).setAccounts([{ product: "眼贴", advertiserId: "99999", adId: "88888", available: true }]));
    await page.waitForFunction(() => (window as any).cancellations.length === 1);
    expect(await page.evaluate(() => (window as any).cancellations[0].requestId === (window as any).reads[0].requestId)).toBe(true);
    await page.evaluate(() => (window as any).pending[0]());
    await page.waitForTimeout(50);
    expect(await page.locator(".qianchuan-query-result").count()).toBe(0);
    expect(await page.getByRole("button", { name: "取消查询" }).count()).toBe(0);
    if (action === "identity") expect(await page.getByLabel("查询计划 ID").inputValue()).toBe("88888");
  } finally { await page.close(); }
});
it("keeps narrow controls inside the viewport and hides unsafe bridge errors", async () => {
  const page = await fixture(360);
  try {
    await page.getByLabel("查询内容").selectOption("report");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { (window as any).fail = true; });
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByRole("alert").waitFor();
    expect(await page.getByRole("alert").textContent()).toContain("查询失败");
    expect(await page.locator("body").textContent()).not.toContain("private-secret-token");
  } finally { await page.close(); }
});
it("connects supplier source and displays exact account IDs and aggregate scope", async () => {
  const page = await fixture(360);
  try {
    await page.getByRole("button", { name: "千管家", exact: true }).click();
    await page.locator(".qianguanjia-connection-settings summary").click();
    expect(await page.getByRole("button", { name: "读取授权账户" }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "发现已登录页面" }).click();
    await page.waitForFunction(() => (document.querySelector('[aria-label="千管家页面"]') as HTMLSelectElement).value !== "");
    await page.getByRole("button", { name: "读取授权账户" }).click();
    await page.getByRole("cell", { name: "1879999999999999999", exact: true }).waitFor();
    await page.getByRole("button", { name: "读取今日汇总" }).click();
    await page.getByRole("heading", { name: "全部推广", exact: true }).waitFor();
    expect(await page.locator(".qianguanjia-console").textContent()).toContain("不代表任一单账户");
    expect(await page.getByTestId("qianguanjia-home").locator("dd").first().textContent()).toBe("12.34");
    expect(await page.getByTestId("qianguanjia-directory").count()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "千川查询", exact: true }).click();
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByRole("heading", { name: "真实结构示例计划" }).waitFor();
  } finally { await page.close(); }
});
it.each(["cancel", "source", "hide"])("supplier %s cancels and rejects late observations", async action => {
  const page = await fixture();
  try {
    await page.getByRole("button", { name: "千管家", exact: true }).click();
    await page.locator(".qianguanjia-connection-settings summary").click();
    await page.getByRole("button", { name: "发现已登录页面" }).click();
    await page.waitForFunction(() => (document.querySelector('[aria-label="千管家页面"]') as HTMLSelectElement).value !== "");
    await page.evaluate(() => { (window as any).supplierDelay = true; });
    await page.getByRole("button", { name: "读取授权账户" }).click();
    await page.getByRole("button", { name: "取消千管家查询" }).waitFor();
    if (action === "cancel") await page.getByRole("button", { name: "取消千管家查询" }).click();
    if (action === "source") await page.getByRole("button", { name: "千川查询", exact: true }).click();
    if (action === "hide") await page.evaluate(() => (window as any).setActive(false));
    await page.waitForFunction(() => (window as any).supplierCancels.length === 1);
    await page.evaluate(() => (window as any).supplierPending[0]());
    await page.waitForTimeout(50);
    expect(await page.getByTestId("qianguanjia-directory").count()).toBe(0);
    expect(await page.evaluate(() => (window as any).supplierDisconnects)).toBeGreaterThan(0);
  } finally { await page.close(); }
});
it("supplier shows empty directory and safely clears state on bridge failure", async () => {
  const page = await fixture();
  try {
    await page.getByRole("button", { name: "千管家", exact: true }).click();
    await page.locator(".qianguanjia-connection-settings summary").click();
    await page.getByRole("button", { name: "发现已登录页面" }).click();
    await page.waitForFunction(() => (document.querySelector('[aria-label="千管家页面"]') as HTMLSelectElement).value !== "");
    await page.evaluate(() => { (window as any).supplierEmpty = true; });
    await page.getByRole("button", { name: "读取授权账户" }).click();
    await page.getByText("当前会话没有返回授权账户。").waitFor();
    await page.evaluate(() => { (window as any).supplierFail = true; });
    await page.getByRole("button", { name: "读取今日汇总" }).click();
    await page.getByRole("alert").waitFor();
    expect(await page.locator("body").textContent()).not.toContain("private-secret-token");
    expect(await page.getByTestId("qianguanjia-directory").count()).toBe(0);
    expect(await page.getByRole("button", { name: "读取今日汇总" }).isDisabled()).toBe(true);
  } finally { await page.close(); }
});

it("connects the business console once and filters exact authorised accounts with pagination", async () => {
  const page = await fixture(1440);
  try {
    await configureSupplier(page, { count: 23 });
    await page.getByRole("button", { name: "千管家", exact: true }).click();
    expect(await page.locator(".qianguanjia-kpis dd").allTextContents()).toEqual(["—", "—", "—", "—"]);
    await page.getByRole("button", { name: "连接已授权账户", exact: true }).click();
    await page.getByTestId("qianguanjia-home").waitFor();
    expect(await page.evaluate(() => (window as any).supplierReads.map((r: any) => r.kind))).toEqual(["discover", "accounts", "home"]);
    await page.getByRole("navigation", { name: "千管家页面" }).getByRole("button", { name: "账户管理" }).click();
    expect(await page.getByTestId("qianguanjia-directory").locator("tbody tr").count()).toBe(10);
    await page.getByRole("button", { name: "下一页账户" }).click();
    await page.getByRole("cell", { name: "1880000000000000009", exact: true }).waitFor();
    await page.getByLabel("搜索授权账户").fill("1880000000000000021");
    await page.getByRole("cell", { name: "1880000000000000021", exact: true }).waitFor();
    expect(await page.getByTestId("qianguanjia-directory").locator("tbody tr").count()).toBe(1);
    await page.getByLabel("授权状态筛选").selectOption("授权失效");
    await page.getByText("没有匹配的授权账户。", { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).supplierReads.length)).toBe(3);
  } finally { await page.close(); }
});

it.each([360, 820, 1440])("shows a usable business console at %i px without fake metrics or viewport overflow", async width => {
  const page = await fixture(width);
  try {
    await page.getByRole("button", { name: "千管家", exact: true }).click();
    expect(await page.getByRole("heading", { name: "数据概览", exact: true }).isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => (window as any).supplierReads)).toEqual([]);
    await page.getByRole("navigation", { name: "千管家页面" }).getByRole("button", { name: "账户管理" }).click();
    await page.getByRole("heading", { name: "账户管理", exact: true }).waitFor();
    await page.getByRole("button", { name: "连接已授权账户", exact: true }).click();
    await page.getByTestId("qianguanjia-home").waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".qianguanjia-kpis dd").allTextContents()).toEqual(["12.34", "99.99", "3", "8.10"]);
  } finally { await page.close(); }
});

it("cancels a connection between directory and overview without starting the next read", async () => {
  const page = await fixture();
  try {
    await page.getByRole("button", { name: "千管家", exact: true }).click();
    await configureSupplier(page, { delayKind: "accounts" });
    await page.getByRole("button", { name: "连接已授权账户", exact: true }).click();
    await page.waitForFunction(() => (window as any).supplierReads.length === 2);
    await page.getByRole("button", { name: "取消千管家查询" }).click();
    await page.evaluate(() => (window as any).supplierPending[0]());
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => (window as any).supplierReads.map((r: any) => r.kind))).toEqual(["discover", "accounts"]);
    expect(await page.getByTestId("qianguanjia-directory").count()).toBe(0);
    expect(await page.getByTestId("qianguanjia-home").count()).toBe(0);
  } finally { await page.close(); }
});

it("requires an explicit page choice when connecting more than one supplier page", async () => {
  const page = await fixture();
  try {
    await page.getByRole("button", { name: "千管家", exact: true }).click();
    await configureSupplier(page, { sessions: 2 });
    await page.getByRole("button", { name: "连接已授权账户", exact: true }).click();
    await page.getByText("发现多个业务页面，请在连接设置中选择要使用的页面。", { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).supplierReads.map((r: any) => r.kind))).toEqual(["discover"]);
  } finally { await page.close(); }
});

it("shows the observation time for the displayed overview instead of an older account directory", async () => {
  const page = await fixture();
  try {
    await configureSupplier(page, { homeAt: "2026-10-14T09:30:00Z" });
    await page.getByRole("button", { name: "千管家", exact: true }).click();
    await page.getByRole("button", { name: "连接已授权账户", exact: true }).click();
    await page.getByTestId("qianguanjia-home").waitFor();
    expect(await page.locator(".qianguanjia-console-toolbar small").innerText()).toContain("17:30:00");
    await page.getByRole("navigation", { name: "千管家页面" }).getByRole("button", { name: "账户管理" }).click();
    expect(await page.locator(".qianguanjia-console-toolbar small").innerText()).toContain("16:00:00");
  } finally { await page.close(); }
});
