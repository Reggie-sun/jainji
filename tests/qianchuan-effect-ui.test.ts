import { effectFixtureScript, effectFixtureStyles } from "./helpers/qianchuan-effect-ui-fixture";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });
async function fixture(width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const script = effectFixtureScript();
  await page.route("http://127.0.0.1:3000/effects", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta charset="utf-8"><style>${effectFixtureStyles()}</style><div id="root"></div>` }));
  await page.goto("http://127.0.0.1:3000/effects");
  await page.addScriptTag({ content: script }); await page.getByRole("heading", { name: "制作与效果", exact: true }).waitFor();
  await page.getByLabel("效果采集目标").selectOption("眼贴:1879999999999999999:1878754135410692");
  return page;
}
it("joins an accepted output on the second page and keeps unknown uploads unaccepted", async () => {
  const p = await fixture(); try {
    await p.getByRole("button", { name: "采集素材效果", exact: true }).click();
    await p.getByText("已精确关联视频", { exact: false }).waitFor();
    expect(await p.locator("tbody tr").count()).toBe(2);
    expect(await p.locator("tbody tr").first().innerText()).toContain("12.34");
    expect(await p.locator("tbody tr").nth(1).innerText()).not.toContain("12.34");
    const calls = await p.evaluate(() => (window as any).reads); expect(calls.map((q: any) => q.offset)).toEqual([0, 100]); expect(calls[0].asOf).toBe(calls[1].asOf);
    expect(await p.evaluate(() => (window as any).production)).toBe(0);
  } finally { await p.close(); }
});
it.each(["cancel", "hide", "rebind"])("%s drops late metrics and never reads the next page", async action => {
  const p = await fixture(); try {
    await p.evaluate(() => { (window as any).delay = true; }); await p.getByRole("button", { name: "采集素材效果", exact: true }).click();
    await p.waitForFunction(() => (window as any).pending.length === 1);
    if (action === "cancel") await p.getByRole("button", { name: "取消效果采集", exact: true }).click();
    else await p.evaluate(action => (window as any)[action](), action);
    await p.waitForFunction(() => (window as any).cancels.length === 1);
    await p.evaluate(() => (window as any).pending[0]());
    expect(await p.evaluate(() => (window as any).reads.length)).toBe(1); expect(await p.evaluate(() => (window as any).cancels.length)).toBe(1);
    expect(await p.locator("tbody").innerText()).not.toContain("12.34");
  } finally { await p.close(); }
});
it("refuses mismatched metrics and stops after the first page", async () => {
  const p = await fixture(); try {
    await p.evaluate(() => { (window as any).bad = true; }); await p.getByRole("button", { name: "采集素材效果", exact: true }).click();
    await p.getByRole("alert").waitFor(); expect(await p.locator("tbody").innerText()).not.toContain("12.34");
    expect(await p.evaluate(() => (window as any).reads.length)).toBe(1);
  } finally { await p.close(); }
});
it.each([360, 820, 1440])("keeps the %i px page usable and original navigation free of production side effects", async width => {
  const p = await fixture(width); try {
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await p.getByRole("button", { name: "查看上传与接收", exact: true }).click();
    expect(await p.evaluate(() => (window as any).nav)).toEqual(["uploads"]); expect(await p.evaluate(() => (window as any).production)).toBe(0);
    await p.getByRole("button", { name: "制作并配置上传", exact: true }).click(); expect(await p.evaluate(() => (window as any).production)).toBe(1);
    expect(await p.evaluate(() => (window as any).reads)).toEqual([]);
  } finally { await p.close(); }
});

it("filters a local batch, opens the original artifact and exports one platform metric set", async () => {
  const p = await fixture(); try {
    await p.getByRole("button", { name: "采集素材效果", exact: true }).click();
    await p.getByText("完整快照已保存", { exact: false }).waitFor();
    await p.getByLabel("效果制作批次").selectOption("d5555555-5555-4555-8555-555555555555");
    expect(await p.locator("tbody tr").count()).toBe(1);
    expect(await p.getByRole("button", { name: "导出当前关联效果 CSV" }).isDisabled()).toBe(true);
    await p.getByLabel("效果制作批次").selectOption("d2222222-2222-4222-8222-222222222222");
    await p.getByRole("button", { name: "打开原成片", exact: true }).click();
    expect(await p.evaluate(() => (window as any).opened)).toEqual(["d4444444-4444-4444-8444-444444444444"]);
    await p.evaluate(() => { const original = URL.createObjectURL; (window as any).exported = ""; URL.createObjectURL = blob => { void (blob as Blob).text().then(text => { (window as any).exported = text; }); return original(blob); }; });
    await p.getByRole("button", { name: "导出当前关联效果 CSV" }).click();
    await p.waitForFunction(() => (window as any).exported.length > 0);
    const csv: string = await p.evaluate(() => (window as any).exported);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(5);
    expect(csv).toContain("d2222222-2222-4222-8222-222222222222");
    expect(csv).not.toContain("d5555555-5555-4555-8555-555555555555");
    expect(await p.evaluate(() => (window as any).production)).toBe(0);
  } finally { await p.close(); }
});
