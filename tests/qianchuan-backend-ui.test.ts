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
it("reads explicit plan, material pages and report, clearing stale data on edits", async () => {
  const page = await fixture();
  try {
    expect(await page.evaluate(() => (window as any).reads)).toEqual([]);
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByRole("heading", { name: "真实结构示例计划" }).waitFor();
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
