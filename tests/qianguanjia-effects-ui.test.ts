import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { qianguanjiaEffectsFixtureScript, qianguanjiaEffectsFixtureStyles } from "./helpers/qianguanjia-effects-ui-fixture";

const advertiserId = "1879999999999999999";
const accountPlan = "1878754135410692";
const historicalPlan = "1878754135410693";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });

async function fixture(width = 1120) {
  const page = await browser.newPage({ viewport: { width, height: 1050 } });
  await page.route("http://127.0.0.1:3000/qianguanjia-effects", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<meta charset="utf-8"><div id="root"></div>' }));
  await page.goto("http://127.0.0.1:3000/qianguanjia-effects");
  await page.addStyleTag({ content: qianguanjiaEffectsFixtureStyles() });
  await page.addScriptTag({ content: qianguanjiaEffectsFixtureScript() });
  await page.getByRole("heading", { name: "投放效果", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="千管家效果目标"] option').length === 3);
  return page;
}

async function selectTarget(page: Page, adId = accountPlan) {
  await page.getByLabel("千管家效果目标").selectOption({ label: `眼贴 · 账户 ${advertiserId} · 计划 ${adId}` });
}

async function selectOneDay(page: Page, date = "2026-10-15") {
  await page.getByLabel("千管家效果开始日期").fill(date);
  await page.getByLabel("千管家效果结束日期").fill(date);
}

async function waitForNoSnapshot(page: Page) {
  await page.getByText("此账户、计划和日期范围没有已保存的完整素材快照", { exact: true }).waitFor();
}

it("uses an explicit unlisted target, joins exact video IDs, paginates and exports one metric set per platform material", async () => {
  const page = await fixture();
  try {
    expect(await page.evaluate(() => (window as any).captureCalls)).toEqual([]);
    expect(await page.locator("body").innerText()).toContain("不代表全账户视频上传库");
    expect(await page.locator("details").textContent()).toContain("roi2_material_status=1");
    await selectTarget(page);
    expect(await page.getByText("供应商目录未列出；仍可按冻结目标直读千川", { exact: false }).count()).toBeGreaterThan(0);
    await selectOneDay(page);
    await waitForNoSnapshot(page);
    expect(await page.getByRole("button", { name: "读取并保存此范围的素材效果", exact: true }).isDisabled()).toBe(false);
    await page.getByRole("button", { name: "读取并保存此范围的素材效果", exact: true }).click();
    await page.getByText("完整素材快照已保存", { exact: false }).waitFor();
    expect(await page.evaluate(() => (window as any).captureCalls[0])).toMatchObject({
      kind: "materials", product: "眼贴", expectedAdvertiserId: advertiserId, adId: accountPlan,
      startDate: "2026-10-15", endDate: "2026-10-15", browserAccess: "existing-only",
    });
    expect(await page.locator("tbody tr").count()).toBe(20);
    const exactVideo = page.locator("tbody tr").nth(0);
    expect(await exactVideo.innerText()).toContain("按完全相同的平台视频 ID 关联 1 条素材。");
    expect(await exactVideo.innerText()).toContain("renamed-on-platform.mp4");
    const sameNameWrongId = page.locator("tbody tr").nth(1);
    expect(await sameNameWrongId.innerText()).toContain("快照中没有此视频 ID");
    expect(await sameNameWrongId.innerText()).not.toContain("12.34");
    expect(await page.getByRole("alert").first().innerText()).toContain("冲突的本地文件 SHA-256");
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    expect(await page.locator("tbody tr").count()).toBe(5);
    await page.getByRole("button", { name: "上一页", exact: true }).click();
    await page.evaluate(() => {
      (window as any).csvText = "";
      URL.createObjectURL = blob => { void (blob as Blob).text().then(value => { (window as any).csvText = value; }); return "blob:fixture"; };
      URL.revokeObjectURL = () => undefined;
    });
    await page.getByRole("button", { name: "导出精确关联效果 CSV", exact: true }).click();
    await page.waitForFunction(() => (window as any).csvText.length > 0);
    const csv = await page.evaluate(() => (window as any).csvText as string);
    const rows = csv.split("\r\n").filter(Boolean);
    expect(rows).toHaveLength(5);
    expect(rows.slice(1).every((row: string) => row.includes("7696527003390771254"))).toBe(true);
    expect(csv).toContain((await page.evaluate(() => (window as any).localTasks[0].upload_task_id)));
    expect(csv).toContain((await page.evaluate(() => (window as any).localTasks[24].upload_task_id)));
    expect(csv).not.toContain("video-conflict");
    expect(csv).not.toContain("ROI合计");
    expect(await page.evaluate(() => [(window as any).deliveryCalls, (window as any).uploadCalls])).toEqual([0, 0]);
  } finally { await page.close(); }
});

it("distinguishes supplier directory listed, missing and unknown coverage without automatic reads", async () => {
  const page = await fixture();
  try {
    await selectTarget(page);
    expect(await page.getByText("供应商目录未列出；仍可按冻结目标直读千川", { exact: false }).count()).toBeGreaterThan(0);
    await page.evaluate(() => (window as any).includeSupplier());
    expect(await page.getByText("供应商目录已列出", { exact: false }).count()).toBeGreaterThan(0);
    await page.evaluate(() => (window as any).clearDirectory());
    expect(await page.getByText("供应商目录覆盖未知", { exact: false }).count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).captureCalls)).toEqual([]);
    expect(await page.evaluate(() => (window as any).historyReads.length)).toBeGreaterThan(0);
  } finally { await page.close(); }
});

it("shows empty history separately from a failed explicit capture and redacts provider errors", async () => {
  const page = await fixture();
  try {
    await selectTarget(page);
    await selectOneDay(page);
    await waitForNoSnapshot(page);
    expect(await page.getByText(/缺少历史快照不表示平台指标为零/).count()).toBe(1);
    await page.evaluate(() => { (window as any).captureFail = true; });
    await page.getByRole("button", { name: "读取并保存此范围的素材效果", exact: true }).click();
    await page.getByText(/效果读取或完整快照校验失败/).waitFor();
    expect(await page.locator("body").innerText()).not.toContain("private-capture-token");
    expect(await page.getByLabel("千管家效果历史快照").count()).toBe(0);
    expect(await page.locator("tbody").innerText()).not.toContain("12.34");
    expect(await page.evaluate(() => (window as any).busyStates)).toEqual([true, false]);
  } finally { await page.close(); }
});

it("keeps the shared busy lease until the underlying read settles after cancel", async () => {
  const page = await fixture();
  try {
    await selectTarget(page);
    await selectOneDay(page);
    await waitForNoSnapshot(page);
    await page.evaluate(() => { (window as any).captureDelay = true; });
    await page.getByRole("button", { name: "读取并保存此范围的素材效果", exact: true }).click();
    await page.waitForFunction(() => (window as any).capturePending.length === 1);
    await page.getByRole("button", { name: "取消效果读取", exact: true }).click();
    await page.getByText(/底层请求清理完成前仍占用查询/).waitFor();
    expect(await page.evaluate(() => (window as any).cancels.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).busyStates)).toEqual([true]);
    expect(await page.getByRole("button", { name: "读取并保存此范围的素材效果", exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => (window as any).capturePending[0]());
    await page.waitForFunction(() => JSON.stringify((window as any).busyStates) === JSON.stringify([true, false]));
    expect(await page.locator("tbody").innerText()).not.toContain("12.34");
    expect(await page.evaluate(() => (window as any).captureCalls.length)).toBe(1);
  } finally { await page.close(); }
});

it.each(["date", "account", "hide"] as const)("invalidates and cancels a pending effect when the %s state changes", async change => {
  const page = await fixture();
  try {
    await selectTarget(page);
    await selectOneDay(page);
    await waitForNoSnapshot(page);
    await page.evaluate(() => { (window as any).captureDelay = true; });
    await page.getByRole("button", { name: "读取并保存此范围的素材效果", exact: true }).click();
    await page.waitForFunction(() => (window as any).capturePending.length === 1);
    if (change === "date") await page.getByLabel("千管家效果结束日期").fill("2026-10-14");
    else if (change === "account") await page.evaluate(() => (window as any).rebind());
    else await page.evaluate(() => (window as any).setActive(false));
    await page.waitForFunction(() => (window as any).cancels.length === 1);
    expect(await page.evaluate(() => (window as any).busyStates)).toEqual([true]);
    await page.evaluate(() => (window as any).capturePending[0]());
    await page.waitForFunction(() => JSON.stringify((window as any).busyStates) === JSON.stringify([true, false]));
    expect(await page.getByLabel("千管家效果历史快照").count()).toBe(0);
    expect(await page.locator("tbody").innerText()).not.toContain("12.34");
    expect(await page.evaluate(() => (window as any).captureCalls.length)).toBe(1);
  } finally { await page.close(); }
});

it("reads only complete snapshots for the chosen historical plan and preserves them when the slot later changes", async () => {
  const page = await fixture();
  const selectedId = "e5555555-5555-4555-8555-555555555555";
  try {
    await page.evaluate(id => {
      const make = (adId: string, requestId: string) => (window as any).makeSnapshot({ requestId, product: "眼贴", expectedAdvertiserId: "1879999999999999999", adId, startDate: "2026-10-15", endDate: "2026-10-15" });
      (window as any).historySnapshots = [make("1878754135410692", "e4444444-4444-4444-8444-444444444444"), make("1878754135410693", id)];
    }, selectedId);
    await selectTarget(page, historicalPlan);
    await selectOneDay(page);
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="千管家效果历史快照"] option').length === 2);
    const snapshotSelect = page.getByLabel("千管家效果历史快照");
    expect(await snapshotSelect.locator("option").count()).toBe(2);
    await snapshotSelect.selectOption(selectedId);
    await page.getByText("21.00", {exact:true}).waitFor();
    expect(await page.getByRole("button", { name: "读取并保存此范围的素材效果", exact: true }).isDisabled()).toBe(false);
    await page.getByRole("button", { name: "读取并保存此范围的素材效果", exact: true }).click();
    await page.getByText("完整素材快照已保存", { exact: false }).waitFor();
    expect(await page.evaluate(() => (window as any).captureCalls[0].adId)).toBe(historicalPlan);
    await page.evaluate(() => (window as any).rebind());
    await page.getByText(/当前账户槽位与上传时冻结身份不一致/).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="千管家效果历史快照"] option').length >= 2);
    await page.getByLabel("千管家效果历史快照").selectOption(selectedId);
    await page.getByText("21.00", {exact:true}).waitFor();
    expect(await page.getByRole("button", { name: "读取并保存此范围的素材效果", exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => (window as any).historyReads.every((read: any) => read.expectedAdvertiserId === "1879999999999999999"))).toBe(true);
    expect(await page.evaluate(() => (window as any).captureCalls.length)).toBe(1);
  } finally { await page.close(); }
});

it("fails closed on an invalid local-history scope and hides details of the read failure", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => { (window as any).historyCorrupt = true; });
    await selectTarget(page);
    await page.getByText(/本地历史快照读取失败或身份/).waitFor();
    expect(await page.locator("body").innerText()).not.toContain("private-history-token");
    expect(await page.getByLabel("千管家效果历史快照").count()).toBe(0);
  } finally { await page.close(); }
});

it("does not overlap a shared query and keeps native layout usable at narrow width", async () => {
  const page = await fixture(360);
  try {
    await page.evaluate(() => (window as any).setExternalBusy(true));
    await selectTarget(page);
    await selectOneDay(page);
    await waitForNoSnapshot(page);
    expect(await page.getByRole("button", { name: "读取并保存此范围的素材效果", exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => [(window as any).captureCalls.length, (window as any).deliveryCalls, (window as any).uploadCalls])).toEqual([0, 0, 0]);
  } finally { await page.close(); }
});


it('filters local project and batch references without issuing another platform request',async()=>{
 const page=await fixture();try{
  await selectTarget(page);await selectOneDay(page);await waitForNoSnapshot(page);
  await page.getByLabel('效果项目筛选').selectOption('d1111111-1111-4111-8111-111111111112');
  expect(await page.locator('tbody tr').count()).toBe(1);
  await page.getByLabel('效果批次筛选').selectOption('d2222222-2222-4222-8222-222222222223');
  expect(await page.locator('tbody tr').count()).toBe(1);
  expect(await page.locator('tbody').innerText()).toContain('output-23.mp4');
  expect(await page.evaluate(()=>(window as any).captureCalls.length)).toBe(0);
 }finally{await page.close()}
});

it('does not let a pending local-history read overwrite a fresh capture',async()=>{
 const page=await fixture();try{
  await page.evaluate(()=>{(window as any).historyDelay=true;});
  await selectTarget(page);await selectOneDay(page);
  await page.getByText(/正在读取此账户已保存的本地历史快照/).waitFor();
  expect(await page.getByRole('button',{name:'读取并保存此范围的素材效果',exact:true}).isDisabled()).toBe(true);
  await page.evaluate(()=>{for(const finish of (window as any).historyPending)finish();(window as any).historyDelay=false;});
  await waitForNoSnapshot(page);
  await page.evaluate(()=>{(window as any).captureDelay=true;});
  await page.getByRole('button',{name:'读取并保存此范围的素材效果',exact:true}).click();
  await page.waitForFunction(()=>(window as any).capturePending.length===1);
  expect(await page.getByRole('button',{name:'重新读取已保存快照',exact:true}).isDisabled()).toBe(true);
  await page.evaluate(()=>(window as any).capturePending[0]());
  await page.getByText('完整素材快照已保存',{exact:false}).waitFor();
  expect(await page.getByLabel('千管家效果历史快照').inputValue()).not.toBe('');
 }finally{await page.close()}
});


it('stops displaying a local history read without claiming to cancel the uncancellable IPC',async()=>{
 const page=await fixture();try{
  await page.evaluate(()=>{(window as any).historyDelay=true;});
  await selectTarget(page);await selectOneDay(page);
  await page.getByRole('button',{name:'停止显示历史读取',exact:true}).click();
  await page.getByText(/后台本地读取无法中断/).waitFor();
  await page.getByRole('button',{name:'读取并保存此范围的素材效果',exact:true}).click();
  await page.getByText('完整素材快照已保存',{exact:false}).waitFor();
  const selected=await page.getByLabel('千管家效果历史快照').inputValue();
  await page.evaluate(()=>{for(const finish of (window as any).historyPending)finish();});
  expect(await page.getByLabel('千管家效果历史快照').inputValue()).toBe(selected);
  expect(await page.evaluate(()=>(window as any).cancels.length)).toBe(0);
 }finally{await page.close()}
});

it('does not reuse a partial earlier-day snapshot for an extended date range',async()=>{
 const page=await fixture();try{
  const id='e5555555-5555-4555-8555-555555555555';
  await page.evaluate(id=>{
   const snapshot=(window as any).makeSnapshot({requestId:id,product:'眼贴',expectedAdvertiserId:'1879999999999999999',adId:'1878754135410692',startDate:'2026-10-15',endDate:'2026-10-15'});
   (window as any).historySnapshots=[{...snapshot,endTime:'2026-10-15 12:00:00',asOf:'2026-10-15T04:00:00.000Z',capturedAt:'2026-10-15T04:01:00.000Z'}];
  },id);
  await selectTarget(page);await selectOneDay(page);
  await page.getByLabel('千管家效果历史快照').waitFor();
  await page.getByLabel('千管家效果历史快照').selectOption(id);
  expect(await page.getByRole('button',{name:'导出精确关联效果 CSV',exact:true}).isDisabled()).toBe(false);
  await page.getByLabel('千管家效果结束日期').fill('2026-10-16');
  await page.getByText(/正在读取此账户已保存的本地历史快照/).waitFor({state:'hidden'});
  expect(await page.getByLabel('千管家效果历史快照').count()).toBe(0);
  expect(await page.getByRole('button',{name:'导出精确关联效果 CSV',exact:true}).count()).toBe(0);
  expect(await page.evaluate(()=>(window as any).captureCalls.length)).toBe(0);
 }finally{await page.close()}
});
