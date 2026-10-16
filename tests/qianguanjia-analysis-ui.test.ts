import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { qianguanjiaAnalysisFixtureScript, qianguanjiaAnalysisFixtureStyles } from "./helpers/qianguanjia-analysis-ui-fixture";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });

async function fixture(width = 1000, accountCount = 2) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route("http://127.0.0.1:3000/qianguanjia-history", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<meta charset="utf-8"><div id="root"></div>' }));
  await page.goto("http://127.0.0.1:3000/qianguanjia-history");
  await page.addStyleTag({ content: qianguanjiaAnalysisFixtureStyles() });
  await page.addScriptTag({ content: qianguanjiaAnalysisFixtureScript(accountCount) });
  await page.getByRole("heading", { name: "历史报表", exact: true }).waitFor();
  return page;
}

async function setRange(page: Awaited<ReturnType<typeof fixture>>) {
  await page.getByLabel("历史报表开始日期").fill("2026-10-01");
  await page.getByLabel("历史报表结束日期").fill("2026-10-31");
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="本地历史快照"] option').length >= 2);
}

it("queries all or selected supplier accounts and labels the source, range, and raw metrics", async () => {
  const page = await fixture(360);
  try {
    expect(await page.evaluate(() => (window as any).supplierReads)).toEqual([]);
    expect(await page.getByLabel("全部授权账户").isChecked()).toBe(true);
    await page.getByLabel("历史报表开始日期").fill("2026-10-09");
    await page.getByLabel("历史报表结束日期").fill("2026-10-15");
    await page.getByRole("button", { name: "查询历史报表", exact: true }).click();
    await page.getByRole("cell", { name: "2026-10-09~2026-10-15" }).waitFor();
    expect(await page.locator("tbody tr").first().innerText()).toContain("12.34");
    expect(await page.evaluate(() => (window as any).supplierReads)).toMatchObject([{ kind: "report", advertiserIds: ["1879999999999999999", "1879999999999999998"], startDate: "2026-10-09", endDate: "2026-10-15", page: 1, limit: 20 }]);
    expect(await page.getByText(/当前页未返回 1 个所选账户的行数据；不补零/).count()).toBe(1);
    expect(await page.getByText(/计划和素材维度未由此接口返回/).count()).toBe(1);
    expect(await page.getByText(/金额单位、归因窗口和 ROI 口径尚未与千川平台对账/).count()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => [(window as any).captureCalls.length, (window as any).disconnects])).toEqual([0, 0]);
    await page.getByLabel("中台账户 · 1879999999999999999").uncheck();
    await page.getByRole("button", { name: "查询历史报表", exact: true }).click();
    await page.getByRole("cell", { name: "12.34" }).waitFor();
    expect(await page.evaluate(() => (window as any).supplierReads[1].advertiserIds)).toEqual(["1879999999999999998"]);
    await page.getByLabel("历史报表开始日期").fill("2026-10-10");
    expect(await page.locator("tbody tr").count()).toBe(0);
    expect(await page.evaluate(() => (window as any).supplierReads.length)).toBe(2);
  } finally { await page.close(); }
});

it("distinguishes an unavailable report from an actual empty result", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => { (window as any).supplierUnavailable = true; });
    await page.getByRole("button", { name: "查询历史报表", exact: true }).click();
    await page.getByText("当前接口没有提供可用历史报表", { exact: true }).waitFor();
    expect(await page.getByText(/没有用首页今日汇总填充历史结果/).count()).toBe(1);
    await page.evaluate(() => { (window as any).supplierUnavailable = false; (window as any).supplierEmpty = true; });
    await page.getByRole("button", { name: "查询历史报表", exact: true }).click();
    await page.getByText("所选范围没有报表行", { exact: true }).waitFor();
    expect(await page.getByText("当前接口没有提供可用历史报表", { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => (window as any).supplierReads.length)).toBe(2);
    expect(await page.evaluate(() => (window as any).captureCalls)).toEqual([]);
  } finally { await page.close(); }
});

it("drops a late supplier result after cancellation and reports the shared busy/session lifecycle", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => { (window as any).supplierDelay = true; });
    await page.getByRole("button", { name: "查询历史报表", exact: true }).click();
    await page.waitForFunction(() => (window as any).supplierPending.length === 1);
    expect(await page.evaluate(() => (window as any).busyStates)).toEqual([true]);
    await page.getByRole("button", { name: "取消查询", exact: true }).click();
    await page.waitForFunction(() => (window as any).supplierCancels.length === 1);
    await page.evaluate(() => (window as any).supplierPending[0]());
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => (window as any).supplierCancels[0].requestId === (window as any).supplierReads[0].requestId)).toBe(true);
    expect(await page.evaluate(() => (window as any).sessionInvalidations)).toBe(1);
    expect(await page.evaluate(() => (window as any).busyStates)).toEqual([true, false]);
    expect(await page.getByRole("cell", { name: "12.34" }).count()).toBe(0);
    expect(await page.evaluate(() => (window as any).captureCalls)).toEqual([]);
  } finally { await page.close(); }
});

it("hides private provider errors and marks the supplier session invalid", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => { (window as any).supplierFail = true; });
    await page.getByRole("button", { name: "查询历史报表", exact: true }).click();
    await page.getByRole("alert").waitFor();
    expect(await page.getByRole("alert").innerText()).toContain("历史报表读取失败");
    expect(await page.locator("body").innerText()).not.toContain("private-secret-token");
    expect(await page.evaluate(() => (window as any).sessionInvalidations)).toBe(1);
    expect(await page.evaluate(() => (window as any).busyStates)).toEqual([true, false]);
  } finally { await page.close(); }
});

it("loads only the chosen local account and compares saved account snapshots exactly", async () => {
  const page = await fixture();
  try {
    await page.getByLabel("历史报表来源").selectOption("local");
    await setRange(page);
    await page.getByLabel("本地历史快照").selectOption("08b94db4-2684-42b0-8a38-2cce443c0778");
    expect(await page.getByText(/账户汇总仅为商品自选控成本口径，不能泛化为全账户或全投放模式总计/).count()).toBe(1);
    await page.getByLabel("对比历史快照").selectOption("1b9c1f1c-67bb-4da6-9b8f-aa3d2a7c9901");
    await page.getByRole("region", { name: "历史快照对比" }).getByText("2.34", { exact: true }).waitFor();
    expect(await page.getByRole("region", { name: "历史快照对比" }).innerText()).toContain("左侧快照 − 对比快照");
    expect(await page.evaluate(() => (window as any).localReads[0])).toEqual({ product: "眼贴", expectedAdvertiserId: "1879999999999999999" });
    expect(await page.evaluate(() => [(window as any).supplierReads.length, (window as any).captureCalls.length])).toEqual([0, 0]);
    await page.getByLabel("本地历史账户").selectOption(JSON.stringify(["肥皂", "1879999999999999998"]));
    await page.getByText("该账户还没有已保存的快照", { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).localReads.at(-1))).toEqual({ product: "肥皂", expectedAdvertiserId: "1879999999999999998" });
  } finally { await page.close(); }
});

it("allows retry after a local snapshot read failure", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => { (window as any).localFail = true; });
    await page.getByLabel("历史报表来源").selectOption("local");
    await page.getByRole("alert").waitFor();
    expect(await page.getByRole("alert").innerText()).toContain("读取失败或完整性校验未通过");
    expect(await page.locator("body").innerText()).not.toContain("private-local-error");
    await page.evaluate(() => { (window as any).localFail = false; });
    await page.getByRole("button", { name: "重新读取本地快照", exact: true }).click();
    await page.getByLabel("本地历史快照").waitFor();
    expect(await page.evaluate(() => (window as any).localReads.length)).toBe(2);
    expect(await page.evaluate(() => (window as any).captureCalls)).toEqual([]);
  } finally { await page.close(); }
});

it("stops displaying a pending local read and ignores its late result", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => { (window as any).localDelay = true; });
    await page.getByLabel("历史报表来源").selectOption("local");
    await page.waitForFunction(() => (window as any).localPending.length === 1);
    await page.getByRole("button", { name: "停止显示本次读取", exact: true }).click();
    await page.getByText(/底层 IPC 不能取消；迟到结果会忽略/).waitFor();
    await page.evaluate(() => (window as any).localPending[0]());
    await page.waitForTimeout(30);
    expect(await page.getByLabel("本地历史快照").count()).toBe(0);
    expect(await page.getByText(/已停止显示本次本地快照读取/).count()).toBe(1);
    await page.evaluate(() => { (window as any).localDelay = false; });
    await page.getByRole("button", { name: "重新读取本地快照", exact: true }).click();
    await page.getByLabel("本地历史快照").waitFor();
    expect(await page.evaluate(() => (window as any).localReads.length)).toBe(2);
    expect(await page.evaluate(() => (window as any).captureCalls)).toEqual([]);
  } finally { await page.close(); }
});

it("filters saved material snapshots and compares only equal material IDs", async () => {
  const page = await fixture();
  try {
    await page.getByLabel("历史报表来源").selectOption("local");
    await setRange(page);
    await page.getByLabel("历史报表计划筛选").selectOption("1878754135410692");
    await page.getByLabel("本地历史快照").selectOption("e85d9cf4-cfe5-45ea-8608-c51ca4d1f73b");
    await page.getByLabel("对比历史快照").selectOption("c93ef312-e3f1-4226-991b-0d4d9a2c3812");
    await page.getByRole("region", { name: "历史快照对比" }).getByText("7696527003390771254", { exact: false }).waitFor();
    const compare = page.getByRole("region", { name: "历史快照对比" });
    expect(await compare.innerText()).toContain("左侧未匹配 1 条，右侧未匹配 1 条。名称不参与关联。");
    expect(await compare.getByText("7696527003390771254", { exact: false }).count()).toBeGreaterThan(0);
    expect(await compare.getByText("7696527003390771256", { exact: false }).count()).toBe(0);
    expect(await page.getByLabel("历史素材筛选").count()).toBe(1);
    await page.getByLabel("历史素材筛选").fill("video-exact-1");
    expect(await compare.locator("tbody tr").count()).toBe(1);
    await page.getByLabel("历史素材筛选").fill("video-left");
    const mainTable = page.locator(".qianchuan-query-result > .qianchuan-query-table");
    expect(await mainTable.locator("tbody tr").count()).toBe(1);
    expect(await mainTable.locator("tbody tr").first().innerText()).toContain("only-left.mp4");
  } finally { await page.close(); }
});

it("compares two explicitly read supplier periods without filling absent accounts with zero", async () => {
  const page=await fixture();try{
    await page.getByLabel('历史报表开始日期').fill('2026-10-08');await page.getByLabel('历史报表结束日期').fill('2026-10-08');
    await page.evaluate(()=>{(window as any).supplierCost='10.00'});
    await page.getByRole('button',{name:'查询历史报表',exact:true}).click();await page.getByRole('cell',{name:'10.00',exact:true}).waitFor();
    await page.getByRole('button',{name:'将本页设为对比基准'}).click();
    await page.getByLabel('历史报表开始日期').fill('2026-10-15');await page.getByLabel('历史报表结束日期').fill('2026-10-15');
    await page.evaluate(()=>{(window as any).supplierCost='12.34'});
    await page.getByRole('button',{name:'查询历史报表',exact:true}).click();
    const comparison=page.getByRole('region',{name:'供应商历史期间对比'});
    await comparison.getByText(/差值 2.34/).waitFor();
    expect(await comparison.innerText()).toContain('2026-10-08');expect(await comparison.innerText()).toContain('2026-10-15');
    expect(await comparison.locator('tbody tr').count()).toBe(1);
    await page.getByLabel('全部授权账户').uncheck();
    expect(await comparison.getByText(/对比基准：/).count()).toBe(0);
    expect(await page.evaluate(()=>(window as any).supplierReads.length)).toBe(2);
  }finally{await page.close()}
});
it('reads bounded supplier plan rankings and compares exact plans without inventing advertiser association',async()=>{
 const page=await fixture();try{
  await page.locator('.qianguanjia-plan-report summary').click();
  await page.getByLabel('历史报表开始日期').fill('2026-10-08');await page.getByLabel('历史报表结束日期').fill('2026-10-08');
  await page.evaluate(()=>{(window as any).supplierCost='10.00'});await page.getByRole('button',{name:'查询供应商计划榜',exact:true}).click();
  await page.getByRole('cell',{name:/供应商计划/}).waitFor();
  expect(await page.getByText(/全量总数未知/).count()).toBe(1);expect(await page.getByText(/不受上方账户勾选限制/).count()).toBe(1);
  await page.getByRole('button',{name:'将计划榜本页设为基准'}).click();
  await page.getByLabel('历史报表开始日期').fill('2026-10-15');await page.getByLabel('历史报表结束日期').fill('2026-10-15');await page.evaluate(()=>{(window as any).supplierCost='12.34'});
  await page.getByRole('button',{name:'查询供应商计划榜',exact:true}).click();
  await page.getByRole('region',{name:'供应商计划期间对比'}).getByRole('cell',{name:'2.34',exact:true}).waitFor();
  expect(await page.evaluate(()=>(window as any).supplierReads)).toMatchObject([{kind:'plan-report',page:1,limit:10},{kind:'plan-report',page:1,limit:10}]);
 }finally{await page.close()}
});
it('shares a single supplier query lane and cancels late plan observations',async()=>{
 const page=await fixture();try{await page.locator('.qianguanjia-plan-report summary').click();await page.evaluate(()=>{(window as any).supplierDelay=true});await page.getByRole('button',{name:'查询供应商计划榜',exact:true}).click();await page.waitForFunction(()=>(window as any).supplierPending.length===1);expect(await page.getByRole('button',{name:'查询历史报表',exact:true}).isDisabled()).toBe(true);
 await page.getByRole('button',{name:'取消计划榜查询'}).click();await page.evaluate(()=>(window as any).supplierPending[0]());expect(await page.getByRole('cell',{name:/供应商计划/}).count()).toBe(0);expect(await page.evaluate(()=>(window as any).supplierCancels.length)).toBe(1);
 }finally{await page.close()}
});

it("returns to page one when requerying a paginated supplier report and keeps cancellation visible",async()=>{
 const page=await fixture(1000,21);try{
  await page.getByRole('button',{name:'查询历史报表',exact:true}).click();
  await page.getByText('第 1 页 · 共 21 行',{exact:true}).waitFor();
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await page.getByText('第 2 页 · 共 21 行',{exact:true}).waitFor();
  await page.evaluate(()=>{(window as any).supplierDelay=true});
  await page.getByRole('button',{name:'查询历史报表',exact:true}).click();
  await page.getByRole('button',{name:'取消查询',exact:true}).waitFor();
  expect(await page.evaluate(()=>(window as any).supplierReads.at(-1).page)).toBe(1);
  await page.evaluate(()=>(window as any).supplierPending[0]());
  await page.getByText('第 1 页 · 共 21 行',{exact:true}).waitFor();
  expect(await page.locator('tbody tr').count()).toBe(20);
 }finally{await page.close()}
});
