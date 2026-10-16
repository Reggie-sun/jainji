import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { overviewFixtureScript, overviewFixtureStyles } from "./helpers/qianchuan-overview-fixture";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });
async function fixture(width = 1440, active = true) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(4000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://127.0.0.1:3000/overview", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta charset="utf-8"><style>${overviewFixtureStyles()}</style><div id="root"></div>` }));
  await page.goto("http://127.0.0.1:3000/overview");
  await page.addScriptTag({ content: overviewFixtureScript({ active }) });
  await page.getByRole("heading", { name: "账户与保存计划", exact: true }).waitFor();
  if (active) await page.getByRole("cell", { name: "蒸汽眼罩", exact: true }).waitFor();
  return { page, errors };
}
const calls = (page: Page) => page.evaluate(() => (window as any).overviewFixture.calls);

it("shows subaccounts and all plan products without substituting saved aliases or saved plan IDs", async () => {
  const { page, errors } = await fixture(); try {
    expect(await page.getByLabel("概览登录账号").locator("option").count()).toBe(2);
    expect(await page.getByLabel("子账户", { exact: true }).locator("option").count()).toBe(3);
    expect(await page.getByLabel("子账户", { exact: true }).inputValue()).toBe("124");
    expect(await page.getByRole("cell", { name: "789", exact: true }).count()).toBe(1);
    expect(await page.getByRole("cell", { name: "790", exact: true }).count()).toBe(1);
    expect(await page.getByRole("cell", { name: "商品信息未读取", exact: true }).count()).toBe(1);
    expect(await page.locator("tbody").innerText()).not.toMatch(/过期商品别名|456|氨糖膏/);
    const read = (await calls(page)).plans[0];
    expect(read).toMatchObject({ product: "蝴蝶贴", expectedAdvertiserId: "123", expectedCurrentAdvertiserId: "124", accountSource: "current-browser", displayCache: true, includeAccount: true });
    expect((await calls(page)).writes).toEqual([]); expect((await calls(page)).switches).toEqual([]); expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("removes deleted plans on an explicit complete refresh", async () => {
  const { page } = await fixture(); try {
    await page.evaluate(() => { (window as any).overviewFixture.plans["124"] = []; });
    await page.getByRole("button", { name: "刷新子账户与计划", exact: true }).click();
    await page.getByText("该子账户没有可用计划。", { exact: true }).waitFor();
    expect(await page.locator("tbody tr").count()).toBe(0);
    const read = await calls(page); expect(read.plans.at(-1).refresh).toBe(true); expect(read.directory.at(-1).refresh).toBe(true);
  } finally { await page.close(); }
});

it("retains the same account's known plans after a failed refresh", async () => {
  const { page } = await fixture(); try {
    await page.evaluate(() => { (window as any).overviewFixture.fail = true; });
    await page.getByRole("button", { name: "刷新子账户与计划", exact: true }).click();
    await page.getByRole("alert").waitFor();
    expect(await page.getByRole("cell", { name: "蒸汽眼罩", exact: true }).count()).toBe(1);
    expect((await calls(page)).switches).toEqual([]);
  } finally { await page.close(); }
});

it("does not restore older persisted plans after a newer live result could not be persisted", async () => {
  const { page } = await fixture(); try {
    await page.evaluate(() => { const f = (window as any).overviewFixture; f.oldPlans = f.plans["124"]; f.plans["124"] = [{ advertiserId: "124", adId: "9001", name: "新计划", productNames: ["更新后的商品"], accountSource: "current-browser" }]; f.planCache = { source: "live", readAt: Date.now(), stale: false, persisted: false }; });
    await page.getByRole("button", { name: "刷新子账户与计划", exact: true }).click();
    await page.getByRole("cell", { name: "更新后的商品", exact: true }).waitFor();
    await page.evaluate(() => { const f = (window as any).overviewFixture; f.plans["124"] = f.oldPlans; f.planCache = { source: "cache", readAt: Date.now() - 86400000, stale: true, refreshFailed: true }; });
    await page.getByRole("button", { name: "刷新子账户与计划", exact: true }).click();
    await page.waitForFunction(() => (window as any).overviewFixture.calls.plans.length === 3 && !Array.from(document.querySelectorAll("button")).find(button => button.textContent === "刷新子账户与计划")?.disabled);
    expect(await page.getByRole("cell", { name: "更新后的商品", exact: true }).count()).toBe(1);
    expect(await page.getByRole("cell", { name: "蒸汽眼罩", exact: true }).count()).toBe(0);
  } finally { await page.close(); }
});

it("rejects a plan catalog belonging to another advertiser", async () => {
  const { page } = await fixture(); try {
    await page.evaluate(() => { (window as any).overviewFixture.mode = "wrong-account"; });
    await page.getByRole("button", { name: "刷新子账户与计划", exact: true }).click();
    await page.getByRole("alert").waitFor();
    expect(await page.locator("tbody").innerText()).not.toMatch(/错误账户|错误商品|9991/);
  } finally { await page.close(); }
});

it("uses the guarded explicit subaccount switch and reloads its bound plans", async () => {
  const { page, errors } = await fixture(); try {
    await page.getByLabel("子账户", { exact: true }).selectOption("125");
    await page.getByRole("cell", { name: "鼻贴", exact: true }).waitFor();
    expect(await page.getByRole("cell", { name: "蒸汽眼罩", exact: true }).count()).toBe(0);
    const read = await calls(page);
    expect(read.switches).toEqual([{ product: "蝴蝶贴", expectedAdvertiserId: "123", expectedCurrentAdvertiserId: "124", advertiserId: "125" }]);
    expect(read.plans.at(-1).expectedCurrentAdvertiserId).toBe("125"); expect(read.writes).toEqual([]); expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("clears the plan view after an unknown switch without retrying it", async () => {
  const { page } = await fixture(); try {
    await page.evaluate(() => { (window as any).overviewFixture.mode = "switch-unknown"; });
    await page.getByLabel("子账户", { exact: true }).selectOption("125");
    await page.getByRole("alert").waitFor();
    expect(await page.locator("tbody tr").count()).toBe(0);
    expect((await calls(page)).switches).toHaveLength(1); expect((await calls(page)).writes).toEqual([]);
  } finally { await page.close(); }
});

it.each(["account", "hide"])("%s cancels a pending plan read and ignores its late response", async action => {
  const { page, errors } = await fixture(); try {
    await page.evaluate(() => { (window as any).overviewFixture.delay = true; });
    await page.getByRole("button", { name: "刷新子账户与计划", exact: true }).click();
    await page.waitForFunction(() => (window as any).overviewFixture.pending.length === 1);
    await page.evaluate(() => { (window as any).overviewFixture.delay = false; });
    if (action === "account") {
      await page.getByLabel("概览登录账号").selectOption("氨糖膏");
      await page.getByRole("cell", { name: "护肩贴", exact: true }).waitFor();
    } else await page.evaluate(() => (window as any).overviewFixture.setActive(false));
    await page.waitForFunction(() => (window as any).overviewFixture.calls.cancels.length === 1);
    await page.evaluate(() => (window as any).overviewFixture.pending[0]());
    expect(await page.getByRole("cell", { name: "蒸汽眼罩", exact: true }).count()).toBe(0);
    if (action === "account") expect(await page.getByLabel("子账户", { exact: true }).inputValue()).toBe("224");
    expect((await calls(page)).writes).toEqual([]); expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("does not load a hidden overview or restore data from a replaced account binding", async () => {
  const { page } = await fixture(1440, false); try {
    expect((await calls(page)).directory).toEqual([]); expect((await calls(page)).plans).toEqual([]);
    await page.evaluate(() => (window as any).overviewFixture.setActive(true));
    await page.getByRole("cell", { name: "蒸汽眼罩", exact: true }).waitFor();
    await page.evaluate(() => { const f = (window as any).overviewFixture; f.setAccounts(f.accounts.map((a: any) => a.product === "蝴蝶贴" ? { ...a, advertiserId: "333" } : a)); });
    await page.getByRole("alert").waitFor();
    expect(await page.locator("tbody tr").count()).toBe(0);
  } finally { await page.close(); }
});

it.each([820, 1440])("keeps the %i px overview usable without page overflow", async width => {
  const { page, errors } = await fixture(width); try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "管理账号与计划", exact: true }).click();
    expect((await calls(page)).navigation).toEqual(["accounts"]);
    expect((await calls(page)).writes).toEqual([]); expect(errors).toEqual([]);
  } finally { await page.close(); }
});
