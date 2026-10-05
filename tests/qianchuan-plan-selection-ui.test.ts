import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";

export function planSelectionFixtureScript(options: { strict?: boolean; multiple?: boolean } = {}) {
  return buildSync({ stdin: { contents: `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { DouyinUploadControls } from "./src/renderer/DouyinUploadControls";
    window.catalogRequests = [];
    window.cancelledRequests = [];
    window.jianji = { listQianchuanPlans: input => new Promise((resolve, reject) => window.catalogRequests.push({ input, resolve, reject })),
      cancelQianchuanPlans: async input => { window.cancelledRequests.push(input); window.catalogRequests.find(request => request.input.requestId === input.requestId)?.reject(new Error("计划读取已取消")); } };
    const accounts = [ {product:"眼贴", advertiserId:"1000", adId:"2000", available:true}, {product:"肥皂", advertiserId:"1001", adId:"2001", available:true} ];
    function Fixture() {
      const [value, setValue] = useState({enabled:true, accountProduct:"眼贴"});
      const [compact, setCompact] = useState(false);
      const [mounted, setMounted] = useState(true);
      window.fixtureSelection = value;
      const respond = kind => {
        const request = window.catalogRequests.at(-1);
        if (kind === "failure") request.reject(new Error("Chrome 登录已失效"));
        else request.resolve(kind === "empty" ? [] : ["9001","9002"].map(adId => ({advertiserId:request.input.expectedAdvertiserId, adId, name:"计划 " + adId})));
      };
      return <><button onClick={() => setCompact(current => !current)}>切换紧凑布局</button>
        <button onClick={() => setMounted(false)}>退出计划选择</button>
        <button onClick={() => respond("plans")}>返回两个计划</button><button onClick={() => respond("empty")}>返回空列表</button><button onClick={() => respond("failure")}>读取失败</button>
        {mounted && <><DouyinUploadControls value={value} onChange={setValue} accounts={accounts} compact={compact}/>
          ${options.multiple ? '<DouyinUploadControls value={value} onChange={setValue} accounts={accounts} compact={compact} idPrefix="another"/>' : ""}</>}
        <output id="selection">{JSON.stringify(value)}</output></>;
    }
    createRoot(document.getElementById("root")).render(${options.strict ? "<React.StrictMode><Fixture/></React.StrictMode>" : "<Fixture/>"});
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" }).outputFiles[0]!.text;
}

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });
async function fixture(options: { strict?: boolean; multiple?: boolean } = {}): Promise<Page> {
  const page = await browser.newPage();
  await page.route("http://127.0.0.1:3000/plan-selector", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("http://127.0.0.1:3000/plan-selector"); await page.addScriptTag({ content: planSelectionFixtureScript(options) });
  await page.waitForFunction(() => (window as any).catalogRequests.length === 1);
  return page;
}
async function selected(page: Page) { return page.locator("#selection").textContent().then(value => JSON.parse(value!)); }
describe("plan selector browser interaction", () => {
  it("shares StrictMode and multiple selectors and cancels the final lease on exit", async () => {
    const page = await fixture({ strict: true, multiple: true });
    try {
      await page.getByRole("button", { name: "刷新计划" }).nth(1).waitFor();
      expect(await page.evaluate(() => (window as any).catalogRequests.length)).toBe(1);
      expect(await page.evaluate(() => (window as any).cancelledRequests.length)).toBe(0);
      await page.getByRole("button", { name: "退出计划选择" }).click();
      await page.waitForFunction(() => (window as any).cancelledRequests.length === 1);
      expect(await page.getByLabel("上传计划").count()).toBe(0);
      expect(await page.evaluate(() => (window as any).catalogRequests.length)).toBe(1);
    } finally { await page.close(); }
  });
  it("requires an explicit plan, displays name and ID, and clears selection on refresh failure", async () => {
    const page = await fixture();
    try {
      expect(await page.getByLabel("上传计划").isDisabled()).toBe(true);
      await page.getByRole("button", { name: "返回两个计划" }).click();
      await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('[aria-label="上传计划"]')!.disabled);
      expect((await selected(page)).plan).toBeUndefined();
      expect(await page.getByLabel("上传计划").locator("option").allTextContents()).toContain("计划 9002 · 9002");
      await page.getByLabel("上传计划").selectOption("9002");
      expect((await selected(page)).plan).toEqual({ advertiserId: "1000", adId: "9002", name: "计划 9002" });
      await page.getByRole("button", { name: "刷新计划" }).click();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      expect((await selected(page)).plan).toBeUndefined();
      await page.getByRole("button", { name: "读取失败", exact: true }).click();
      await page.getByRole("alert").waitFor();
      expect(await page.getByRole("alert").textContent()).toBe("Chrome 登录已失效");
      expect(await page.getByLabel("上传计划").isDisabled()).toBe(true);
    } finally { await page.close(); }
  });
  it("ignores late responses from the previous Chrome account and handles an empty catalog", async () => {
    const page = await fixture();
    try {
      await page.getByLabel("本次产品账号").selectOption("肥皂");
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      await page.evaluate(() => (window as any).catalogRequests[0].resolve([{ advertiserId: "1000", adId: "7777", name: "旧账号计划" }]));
      await page.getByRole("button", { name: "返回两个计划" }).click();
      await page.getByLabel("上传计划").selectOption("9001");
      expect((await selected(page)).plan.advertiserId).toBe("1001");
      expect(await page.getByLabel("上传计划").locator("option").allTextContents()).not.toContain("旧账号计划 · 7777");
      await page.getByRole("button", { name: "刷新计划" }).click();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 3);
      await page.getByRole("button", { name: "返回空列表" }).click();
      await page.getByText("该账号没有可用计划。").waitFor();
      expect((await selected(page)).plan).toBeUndefined();
    } finally { await page.close(); }
  });
  it("lets append's compact controls choose a plan and clears it when changing account", async () => {
    const page = await fixture();
    try {
      await page.getByRole("button", { name: "切换紧凑布局" }).click();
      await page.getByLabel("千川上传", { exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).catalogRequests.length)).toBe(1);
      await page.getByRole("button", { name: "返回两个计划" }).click();
      await page.getByLabel("上传计划").selectOption("9001");
      expect((await selected(page)).plan.adId).toBe("9001");
      await page.getByLabel("千川上传", { exact: true }).selectOption("肥皂");
      expect((await selected(page)).plan).toBeUndefined();
    } finally { await page.close(); }
  });
});
