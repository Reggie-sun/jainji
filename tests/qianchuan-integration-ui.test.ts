import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { qianchuanBackendFixtureScript, qianchuanBackendFixtureStyles } from "./helpers/qianchuan-backend-ui-fixture";
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });
async function fixture(width = 1000, historyDelay = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route("http://127.0.0.1:3000/integration", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<meta charset="utf-8"><div id="root"></div>' }));
  await page.goto("http://127.0.0.1:3000/integration");
  await page.addStyleTag({ content: qianchuanBackendFixtureStyles() });
  await page.evaluate(delay => { (window as any).historyDelay = delay; }, historyDelay);
  await page.addScriptTag({ content: qianchuanBackendFixtureScript() });
  await page.getByRole("heading", { name: "完整报表与历史记录" }).waitFor();
  return page;
}
it("reads independently of the supplier, persists an explicit full report, and reloads history without querying", async () => {
  const p = await fixture(); try {
    await p.getByRole("cell", { name: "创建商品全域计划", exact: true }).waitFor();
    expect(await p.evaluate(() => (window as any).supplierReads)).toEqual([]);
    expect(await p.getByRole("cell", { name: "尚未核验", exact: true }).count()).toBe(6);
    expect(await p.evaluate(() => (window as any).reportReads)).toEqual([]);
    await p.getByRole("button", { name: "采集并保存账户汇总", exact: true }).click();
    await p.getByText("完整报表已保存。保存记录不授予上传或投放权限。").waitFor();
    expect(await p.getByLabel("历史报表快照").inputValue()).not.toBe("");
    expect(await p.evaluate(() => (window as any).reportReads.length)).toBe(1);
    await p.evaluate(() => (window as any).setActive(false));
    await p.evaluate(() => (window as any).setActive(true));
    await p.waitForFunction(() => document.querySelectorAll('[aria-label="历史报表快照"] option').length === 2);
    await p.getByLabel("历史报表快照").selectOption({ index: 1 });
    expect(await p.evaluate(() => (window as any).reportReads.length)).toBe(1);
    expect(await p.evaluate(() => (window as any).reads)).toEqual([]);
    const download = p.waitForEvent("download");
    await p.getByRole("button", { name: "导出当前快照 CSV" }).click();
    expect((await download).suggestedFilename()).toMatch(/^qianchuan-.*\.csv$/);
  } finally { await p.close(); }
});
it.each(["cancel", "hide", "account"])("%s cancels a full capture and ignores the old account's late snapshot", async action => {
  const p = await fixture(); try {
    await p.evaluate(() => { (window as any).reportDelay = true; });
    await p.getByRole("button", { name: "采集并保存账户汇总", exact: true }).click();
    await p.waitForFunction(() => (window as any).reportPending.length === 1);
    if (action === "cancel") await p.getByRole("button", { name: "取消完整采集", exact: true }).click();
    if (action === "hide") await p.evaluate(() => (window as any).setActive(false));
    if (action === "account") await p.getByLabel("查询账号").selectOption("肥皂");
    await p.waitForFunction(() => (window as any).reportCancels.length === 1);
    await p.evaluate(() => (window as any).reportPending[0]());
    expect(await p.getByRole("button", { name: "导出当前快照 CSV" }).count()).toBe(0);
    expect(await p.evaluate(() => (window as any).reportCancels[0].requestId === (window as any).reportReads[0].requestId)).toBe(true);
  } finally { await p.close(); }
});
it("filters exact video identities and keeps narrow controls inside the viewport", async () => {
  const p = await fixture(360); try {
    await p.getByLabel("查询内容").selectOption("materials");
    await p.getByRole("button", { name: "采集并保存完整素材效果", exact: true }).click();
    await p.getByLabel("历史素材筛选").waitFor();
    const area = p.getByRole("region", { name: "千川完整报表与投放准入" });
    await p.getByLabel("历史素材筛选").fill("video-2");
    expect(await area.getByRole("cell", { name: /fixture-video-1/ }).count()).toBe(0);
    expect(await area.getByRole("cell", { name: /fixture-video-2/ }).count()).toBe(1);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await p.close(); }
});
it("local stop never claims that the platform has paused", async () => {
  const p = await fixture(); try {
    await p.getByRole("button", { name: "停止本地投放动作", exact: true }).click();
    await p.getByText("本地后续投放动作已停止。本地停止不等于平台暂停；原平台计划可能仍在投放。").waitFor();
    expect(await p.evaluate(() => (window as any).localStops)).toBe(1);
    expect(await p.evaluate(() => (window as any).reportReads)).toEqual([]);
    expect(await p.evaluate(() => (window as any).reads)).toEqual([]);
  } finally { await p.close(); }
});

it("sorts platform scientific notation without crashing or rounding exact metrics", async () => {
  const p = await fixture(); try {
    await p.getByLabel("查询内容").selectOption("materials");
    await p.getByRole("button", { name: "采集并保存完整素材效果", exact: true }).click();
    await p.getByLabel("历史素材排序").waitFor();
    await p.evaluate(() => {
      const saved = (window as any).reportHistory[0];
      saved.rows[0].metrics = { ...saved.rows[0].metrics, stat_cost_for_roi2: { value: "1e-7", display: "tiny" } };
      saved.rows[1].metrics = { ...saved.rows[1].metrics, stat_cost_for_roi2: { value: "0.000002", display: "larger" } };
    });
    await p.getByRole("button", { name: "读取历史报表", exact: true }).click();
    await p.getByLabel("历史素材排序").selectOption("cost");
    const rows = p.getByRole("region", { name: "千川完整报表与投放准入" }).locator("tbody").first().locator("tr");
    await p.waitForFunction(() => document.body.innerText.includes("larger"));
    expect(await rows.first().innerText()).toContain("fixture-video-2");
  } finally { await p.close(); }
});

it("does not let an older history response remove a newly persisted capture", async () => {
  const p = await fixture(1000, true); try {
    await p.waitForFunction(() => (window as any).historyPending.length > 0);
    await p.getByRole("button", { name: "采集并保存账户汇总", exact: true }).click();
    await p.getByRole("button", { name: "导出当前快照 CSV", exact: true }).waitFor();
    const selected = await p.getByLabel("历史报表快照").inputValue();
    await p.evaluate(() => (window as any).historyPending.forEach((resolve: () => void) => resolve()));
    await p.waitForTimeout(50);
    expect(await p.getByLabel("历史报表快照").inputValue()).toBe(selected);
    expect(await p.getByRole("button", { name: "导出当前快照 CSV", exact: true }).count()).toBe(1);
  } finally { await p.close(); }
});

it("shows a returned unconfirmed plan ID as an UNKNOWN audit reference", async () => {
  const p = await fixture(); try {
    await p.evaluate(() => { (window as any).auditOperations = [{ operationId: "55555555-5555-4555-8555-555555555555", action: "create-plan", state: "UNKNOWN", adId: "789", createdAt: "2026-10-15T04:00:00Z", updatedAt: "2026-10-15T04:00:00Z" }]; (window as any).setActive(false); });
    await p.evaluate(() => (window as any).setActive(true));
    await p.getByText("平台返回计划 789（以回读状态为准）", { exact: false }).waitFor();
    expect(await p.getByRole("cell", { name: /结果未知，只能核查，不可重发/ }).count()).toBe(1);
  } finally { await p.close(); }
});
