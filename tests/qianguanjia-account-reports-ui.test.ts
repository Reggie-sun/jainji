import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { qianguanjiaAccountReportsFixtureScript, qianguanjiaAccountReportsFixtureStyles } from "./helpers/qianguanjia-account-reports-ui-fixture";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });
async function fixture(width = 1120) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route("http://127.0.0.1:3000/qgj-account-reports", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<meta charset="utf-8"><div id="root"></div>' }));
  await page.goto("http://127.0.0.1:3000/qgj-account-reports");
  await page.addStyleTag({ content: qianguanjiaAccountReportsFixtureStyles() });
  await page.addScriptTag({ content: qianguanjiaAccountReportsFixtureScript() });
  await page.getByRole("heading", { name: "历史报表", exact: true }).waitFor();
  return page;
}
async function range(page: Page, date = "2026-10-15") {
  await page.getByLabel("历史报表开始日期", { exact: true }).fill(date);
  await page.getByLabel("历史报表结束日期", { exact: true }).fill(date);
}
const capture = (page: Page) => page.getByRole("button", { name: "读取并保存所选账户报表", exact: true }).click();
const table = (page: Page) => page.getByRole("region", { name: "千川跨账户报表", exact: true }).locator("tbody");
async function finish(page: Page) { await page.getByText(/本轮结束：/).waitFor(); }

it("exposes all six saved accounts without a supplier session or automatic platform requests", async () => {
  const page = await fixture(360);
  try {
    expect(await page.getByRole("button", { name: "读取并保存所选账户报表", exact: true }).count()).toBe(1);
    expect(await table(page).locator("tr").count()).toBe(6);
    expect(await page.getByLabel("历史报表来源").inputValue()).toBe("direct");
    expect(await page.evaluate(() => [(window as any).captureCalls.length, (window as any).historyCalls.length])).toEqual([0, 0]);
    await page.evaluate(() => (window as any).includeDirectory());
    expect(await page.getByText(/覆盖 1 \/ 6 个已保存账户/).count()).toBe(1);
    expect(await table(page).locator("tr").count()).toBe(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.close(); }
});

it("serially captures all six through existing-only report IPC and persists independent exact account results", async () => {
  const page = await fixture();
  try {
    await range(page); await page.evaluate(() => { (window as any).captureDelay = true; }); await capture(page);
    for (let i = 1; i <= 6; i++) {
      await page.waitForFunction(n => (window as any).captureCalls.length === n, i);
      expect(await page.evaluate(() => (window as any).capturePending.length)).toBe(1);
      await page.evaluate(() => (window as any).capturePending.shift()());
    }
    await finish(page);
    const calls = await page.evaluate(() => (window as any).captureCalls);
    expect(calls).toHaveLength(6);
    expect(new Set(calls.map((q: any) => q.requestId)).size).toBe(6);
    expect(new Set(calls.map((q: any) => q.expectedAdvertiserId)).size).toBe(6);
    expect(calls.every((q: any) => q.kind === "report" && q.browserAccess === "existing-only" && q.startDate === "2026-10-15")).toBe(true);
    expect(await table(page).getByText("已读取完整快照", { exact: true }).count()).toBe(6);
    expect(await page.evaluate(() => (window as any).busyStates)).toEqual([true, false]);
    expect(await page.evaluate(() => [(window as any).deliveryCalls, (window as any).uploadCalls])).toEqual([0, 0]);
  } finally { await page.close(); }
});

it("continues after one account fails and exports missing status without fabricated zeros or raw errors", async () => {
  const page = await fixture();
  try {
    await range(page); await page.evaluate(() => { (window as any).failAccounts = ['1879999999999999992']; }); await capture(page); await finish(page);
    expect(await table(page).getByText("已读取完整快照", { exact: true }).count()).toBe(5);
    const failed = table(page).locator("tr").nth(1);
    expect(await failed.innerText()).toContain("读取失败");
    expect(await failed.innerText()).not.toContain("12.34");
    expect(await page.locator("body").innerText()).not.toContain("private-token");
    expect(await page.getByText(/不能作为全部账户总计/).count()).toBe(1);
    await page.evaluate(() => { (window as any).csv = ''; URL.createObjectURL = blob => { void (blob as Blob).text().then(value => { (window as any).csv = value; }); return 'blob:fixture'; }; URL.revokeObjectURL = () => undefined; });
    await page.getByRole("button", { name: "导出跨账户报表 CSV", exact: true }).click();
    await page.waitForFunction(() => (window as any).csv.length > 0);
    const csv = await page.evaluate(() => (window as any).csv as string);
    expect(csv).toContain("1879999999999999992"); expect(csv).toContain("failed"); expect(csv).not.toContain("ROI合计");
  } finally { await page.close(); }
});

it("cancel drains the active request, ignores late data and never dispatches remaining accounts", async () => {
  const page = await fixture();
  try {
    await range(page); await page.evaluate(() => { (window as any).captureDelay = true; }); await capture(page);
    await page.waitForFunction(() => (window as any).capturePending.length === 1);
    await page.getByRole("button", { name: "取消跨账户读取", exact: true }).click();
    expect(await page.evaluate(() => (window as any).cancelCalls.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).busyStates)).toEqual([true]);
    expect(await page.getByRole("button", { name: "读取并保存所选账户报表", exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => (window as any).capturePending.shift()());
    await page.waitForFunction(() => JSON.stringify((window as any).busyStates) === '[true,false]');
    expect(await page.evaluate(() => (window as any).captureCalls.length)).toBe(1);
    await table(page).getByText("已取消", { exact: true }).first().waitFor();
    expect(await table(page).getByText("已取消", { exact: true }).count()).toBe(6);
    expect(await table(page).innerText()).not.toContain("12.34");
  } finally { await page.close(); }
});

it("hiding cancels a running original operation and excludes late results", async () => {
  const page = await fixture();
  try {
    await range(page); await page.evaluate(() => { (window as any).captureDelay = true; }); await capture(page);
    await page.waitForFunction(() => (window as any).capturePending.length === 1);
    await page.evaluate(() => (window as any).setActive(false));
    await page.waitForFunction(() => (window as any).cancelCalls.length === 1);
    await page.evaluate(() => (window as any).capturePending.shift()());
    await page.waitForFunction(() => JSON.stringify((window as any).busyStates) === '[true,false]');
    expect(await page.evaluate(() => (window as any).captureCalls.length)).toBe(1);
    expect(await table(page).innerText()).not.toContain("12.34");
    await page.evaluate(() => (window as any).setActive(true));
    await table(page).getByText("尚未读取", { exact: true }).first().waitFor();
    expect(await table(page).getByText("正在读取", { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => (window as any).captureCalls.length)).toBe(1);
  } finally { await page.close(); }
});

it("selects only chosen accounts, rejects empty selection and preserves unavailable accounts for local history", async () => {
  const page = await fixture();
  try {
    await range(page); await page.getByLabel("选择全部本地报表账户", { exact: true }).uncheck();
    expect(await page.getByRole("button", { name: "读取并保存所选账户报表", exact: true }).isDisabled()).toBe(true);
    await page.getByLabel("跨账户选择 1879999999999999994", { exact: true }).check(); await capture(page); await finish(page);
    expect(await page.evaluate(() => (window as any).captureCalls.map((q: any) => q.expectedAdvertiserId))).toEqual(['1879999999999999994']);
    await page.evaluate(() => (window as any).setAccounts((window as any).baseAccounts.map((a: any) => ({ ...a, available: false }))));
    await page.getByRole("button", { name: "读取所选账户历史快照", exact: true }).click(); await finish(page);
    expect(await page.evaluate(() => (window as any).historyCalls.length)).toBe(1);
    expect(await table(page).getByText("已读取完整快照", { exact: true }).count()).toBe(1);
  } finally { await page.close(); }
});

it("distinguishes empty local history, rejects wrong account data, and stops waiting without claiming IPC cancellation", async () => {
  const page = await fixture();
  try {
    await range(page); await page.getByRole("button", { name: "读取所选账户历史快照", exact: true }).click(); await finish(page);
    expect(await table(page).getByText("无匹配历史快照", { exact: true }).count()).toBe(6);
    expect(await page.evaluate(() => (window as any).captureCalls.length)).toBe(0);
    await page.evaluate(() => { (window as any).historyCorrupt = true; });
    await page.getByRole("button", { name: "读取所选账户历史快照", exact: true }).click(); await finish(page);
    expect(await table(page).getByText("读取失败", { exact: true }).count()).toBe(6);
    await page.evaluate(() => { (window as any).historyCorrupt = false; (window as any).historyDelay = true; });
    await page.getByRole("button", { name: "读取所选账户历史快照", exact: true }).click();
    await page.waitForFunction(() => (window as any).historyPending.length === 1);
    await page.getByRole("button", { name: "停止显示跨账户历史", exact: true }).click();
    expect(await page.evaluate(() => (window as any).cancelCalls.length)).toBe(0);
    await page.evaluate(() => (window as any).historyPending.shift()());
    await page.waitForFunction(() => (window as any).busyStates.at(-1) === false);
    await table(page).getByText("已取消", { exact: true }).first().waitFor();
    expect(await table(page).getByText("已取消", { exact: true }).count()).toBe(6);
  } finally { await page.close(); }
});

it("compares exact account identities across requested dates and hides an old result when dates change", async () => {
  const page = await fixture();
  try {
    await range(page); await capture(page); await finish(page);
    await page.getByRole("button", { name: "将当前跨账户结果设为基准", exact: true }).click();
    await range(page, "2026-10-14");
    expect(await table(page).innerText()).not.toContain("已读取完整快照");
    await page.evaluate(() => { (window as any).nextCost = '10.00'; }); await capture(page); await finish(page);
    expect(await table(page).getByText("差值 -2.34", { exact: false }).count()).toBe(6);
    expect(await page.getByText(/2026-10-15 至 2026-10-15/).count()).toBeGreaterThan(0);
    expect(await page.locator("body").innerText()).toContain("未折算不同区间长度");
    expect(await table(page).getByText(/基准实际窗口：2026-10-15 00:00:00 至 2026-10-15 23:59:59/).count()).toBe(6);
    expect(await table(page).getByText(/基准截止/).count()).toBe(6);
    await page.getByLabel("跨账户选择 1879999999999999991", { exact: true }).uncheck();
    expect(await page.getByText(/对比基准：/).count()).toBe(0);
    await page.getByLabel("跨账户选择 1879999999999999991", { exact: true }).check();
    expect(await page.getByText(/对比基准：/).count()).toBe(0);
  } finally { await page.close(); }
});

it("rejects corrupt captures and invalid dates without automatic fallback or retry", async () => {
  const page = await fixture();
  try {
    await range(page); await page.evaluate(() => { (window as any).captureCorrupt = true; }); await capture(page); await finish(page);
    expect(await table(page).getByText("读取失败", { exact: true }).count()).toBe(6);
    await page.getByLabel("历史报表开始日期").fill("2026-10-16"); await page.getByLabel("历史报表结束日期").fill("2026-10-15");
    expect(await page.getByRole("button", { name: "读取并保存所选账户报表", exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => (window as any).captureCalls.length)).toBe(6);
  } finally { await page.close(); }
});

it("uses current Chrome profile labels throughout account views without exposing legacy slot names", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => (window as any).setAccounts((window as any).baseAccounts.map((a: any,i:number)=>({...a,browserProfileName:'当前Chrome档案'+(i+1)}))));
    await page.waitForFunction(()=>document.querySelector('[aria-label="千川跨账户报表"] tbody')?.textContent?.includes('当前Chrome档案1'));
    expect(await table(page).innerText()).not.toContain('原槽位');
    for(let i=1;i<=6;i++)expect(await table(page).innerText()).toContain('当前Chrome档案'+i);
    await range(page);await capture(page);await finish(page);
    expect(await page.evaluate(()=>(window as any).captureCalls.map((q:any)=>q.product))).toEqual(['蝴蝶贴','氨糖膏','滴耳康','眼贴','肥皂','热敷贴']);
    await page.evaluate(() => (window as any).setAccounts((window as any).baseAccounts.map((a: any,i:number)=>({...a,browserProfileName:'已更名Chrome档案'+(i+1)}))));
    await page.waitForFunction(()=>document.querySelector('[aria-label="千川跨账户报表"] tbody')?.textContent?.includes('已更名Chrome档案1'));
    expect(await page.evaluate(()=>(window as any).captureCalls.length)).toBe(6);
    expect(await table(page).innerText()).toContain('12.34');
    await page.getByLabel('历史报表来源',{exact:true}).selectOption('local');
    const labels=await page.getByLabel('本地历史账户',{exact:true}).locator('option').allTextContents();
    expect(labels.slice(1).every(label=>label.startsWith('已更名Chrome档案'))).toBe(true);
  } finally { await page.close(); }
});
