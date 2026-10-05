import { describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import { chromium } from "playwright-core";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { resolveBatchUploadAccount } from "../src/shared/batch-upload";
import type { QianchuanAccountSummary } from "../src/shared/qianchuan-account";

const accounts: QianchuanAccountSummary[] = [
  { product: "蝴蝶贴", advertiserId: "123", adId: "456", available: true },
  { product: "眼贴", productName: "晚安油", advertiserId: "789", adId: "987", available: true },
];
describe("automatic batch upload account binding", () => {
  it("uses the saved advertiser for different template names and allows shared accounts", () => {
    const binding = { accountProduct: "眼贴" as const, advertiserId: "789" };
    for (const name of ["新眼贴模板", "眼贴2", "晚安油"]) expect(resolveBatchUploadAccount(name, accounts, binding)).toEqual({ accountProduct: "眼贴" });
    expect(resolveBatchUploadAccount("蝴蝶贴", accounts, { ...binding, advertiserId: "123" }).error).toContain("已变化");
    expect(resolveBatchUploadAccount("蝴蝶贴", accounts.slice(0, 1), binding).error).toContain("不可用");
  });
  it("matches the exact saved display name and returns the stable slot", () => {
    expect(resolveBatchUploadAccount(" 蝴蝶贴 ", accounts)).toEqual({ accountProduct: "蝴蝶贴" });
    expect(resolveBatchUploadAccount("晚安油", accounts)).toEqual({ accountProduct: "眼贴" });
  });
  it.each(["眼贴", "晚安", "晚安油模板", "", "  "])("never guesses or uses a renamed slot as fallback: %s", name => {
    expect(resolveBatchUploadAccount(name, accounts)).toEqual({ error: "请选择此模板的上传账号；也可以关闭本项上传。" });
  });
  it("rejects unavailable and ambiguous matching accounts instead of selecting another", () => {
    expect(resolveBatchUploadAccount("晚安油", accounts.map(a => ({ ...a, available: false })))).toEqual({ error: "对应千川商品账号配置不可用，请先保存有效计划链接，或关闭本项上传。" });
    expect(resolveBatchUploadAccount("晚安油", [...accounts, { ...accounts[0], productName: "晚安油" }])).toEqual({ error: "同名千川商品账号不唯一，请在账号设置中区分商品名称，或关闭本项上传。" });
    expect(resolveBatchUploadAccount("蝴蝶贴", [])).toHaveProperty("error");
  });
});

it("reads upload plans only for selected templates and cancels an unfinished read when deselected", async () => {
  const browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.route("http://127.0.0.1:3000/batch-upload", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("http://127.0.0.1:3000/batch-upload");
    const script = buildSync({ stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { BatchProductionPanel } from "./src/renderer/BatchProductionPanel";
      window.requests = []; window.cancellations = [];
      const accounts = [{product:"蝴蝶贴",advertiserId:"123",adId:"456",available:true},
        {product:"眼贴",productName:"晚安油",advertiserId:"789",adId:"987",available:true}];
      window.jianji = {
        batchProductionProjects: async () => ["蝴蝶贴", "晚安油"].map((name, index) => ({
          recentProjectId:String(index), projectId:String(index), name, sourceCount:1, requestedCount:1,
          productPrice:"", requiresDisplayText:false, coverEnabled:false, displayMode:"full", mode:"random"
        })),
        saveBatchUploadAccount: async () => undefined,
        listQianchuanPlans: input => new Promise((resolve, reject) => window.requests.push({input,resolve,reject})),
        cancelQianchuanPlans: async input => { window.cancellations.push(input); window.requests.find(r=>r.input.requestId===input.requestId)?.reject(new Error("已取消")); }
      };
      const state = {recentProjects:[],queue:{batches:[]},capabilities:{ready:true},douyinUpload:{config:{enabled:true},accounts}};
      createRoot(document.getElementById("root")).render(<React.StrictMode><BatchProductionPanel state={state} visible={true} onState={()=>{}}/></React.StrictMode>);
    `, resolveDir: process.cwd(), loader: "tsx" }, loader: { ".css": "empty" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" }).outputFiles[0]!.text;
    await page.addScriptTag({ content: script });
    await page.getByRole("checkbox", { name: "选择模板 晚安油", exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(0);
    await page.getByRole("checkbox", { name: "选择模板 蝴蝶贴", exact: true }).check();
    await page.waitForFunction(() => (window as any).requests.length === 1);
    expect(await page.evaluate(() => (window as any).requests[0].input.expectedAdvertiserId)).toBe("123");
    await page.getByRole("checkbox", { name: "选择模板 蝴蝶贴", exact: true }).uncheck();
    await page.waitForFunction(() => (window as any).cancellations.length === 1);
    expect(await page.getByLabel("上传计划", { exact: true }).count()).toBe(0);
    await page.getByRole("checkbox", { name: "晚安油开启千川上传", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "选择模板 晚安油", exact: true }).check();
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(1);
    await page.getByRole("checkbox", { name: "晚安油开启千川上传", exact: true }).check();
    await page.waitForFunction(() => (window as any).requests.length === 2);
    expect(await page.evaluate(() => (window as any).requests[1].input.expectedAdvertiserId)).toBe("789");
    await page.evaluate(() => (window as any).requests[1].resolve([{ advertiserId: "789", adId: "987", name: "晚安油计划" }]));
    await page.getByLabel("上传计划", { exact: true }).selectOption("987");
    await page.getByRole("checkbox", { name: "选择模板 晚安油", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "选择模板 晚安油", exact: true }).check();
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('[aria-label="上传计划"]')?.value === "987", undefined, { timeout: 3000 });
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(2);
    expect(await page.getByLabel("上传计划", { exact: true }).inputValue()).toBe("987");
  } finally { await browser.close(); }
}, 30000);

it.each([false, true])("keeps the chosen upload plan when returning to the selector (compact: %s)", async compact => {
  const browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.route("http://127.0.0.1:3000/plan-return", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("http://127.0.0.1:3000/plan-return");
    const script = buildSync({ stdin: { contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { DouyinUploadControls } from "./src/renderer/DouyinUploadControls";
      window.requests = [];
      window.jianji = { listQianchuanPlans: input => new Promise((resolve, reject) => window.requests.push({input,resolve,reject})), cancelQianchuanPlans: async () => undefined };
      const accounts = [{product:"眼贴",advertiserId:"789",adId:"987",available:true}, {product:"肥皂",advertiserId:"123",adId:"456",available:true}];
      function Fixture() {
        const [mounted, setMounted] = useState(true);
        const [value, setValue] = useState({enabled:true,accountProduct:"眼贴"});
        window.selection = value;
        return <><button onClick={() => setMounted(current => !current)}>离开或返回设置</button>
          {mounted && <DouyinUploadControls accounts={accounts} value={value} onChange={setValue} compact={${compact}}/>}</>;
      }
      createRoot(document.getElementById("root")).render(<React.StrictMode><Fixture/></React.StrictMode>);
    `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" }).outputFiles[0]!.text;
    await page.addScriptTag({ content: script });
    await page.waitForFunction(() => (window as any).requests.length === 1);
    await page.evaluate(() => (window as any).requests[0].resolve([{ advertiserId: "789", adId: "987", name: "已选计划" }]));
    await page.getByLabel("上传计划", { exact: true }).selectOption("987");
    const chosen = await page.evaluate(() => (window as any).selection.plan);
    await page.getByRole("button", { name: "离开或返回设置" }).click();
    await page.getByRole("button", { name: "离开或返回设置" }).click();
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('[aria-label="上传计划"]')?.value === "987", undefined, { timeout: 3000 });
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).selection.plan)).toEqual(chosen);
    expect(await page.getByLabel("上传计划", { exact: true }).inputValue()).toBe("987");
    await page.getByRole("button", { name: "刷新计划", exact: true }).click();
    await page.waitForFunction(() => (window as any).requests.length === 2);
    expect(await page.evaluate(() => (window as any).selection.plan)).toBeUndefined();
    await page.evaluate(() => (window as any).requests[1].reject(new Error("计划已失效")));
    await page.getByRole("alert").waitFor();
    expect(await page.getByLabel("上传计划", { exact: true }).isDisabled()).toBe(true);
    await page.getByLabel(compact ? "千川上传" : "本次产品账号", { exact: true }).selectOption("肥皂");
    await page.waitForFunction(() => (window as any).requests.length === 3);
    expect(await page.evaluate(() => (window as any).requests[2].input.expectedAdvertiserId)).toBe("123");
    expect(await page.evaluate(() => (window as any).selection.plan)).toBeUndefined();
  } finally { await browser.close(); }
}, 30000);
