import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });

function fixtureScript() {
  return buildSync({ stdin: { contents: `
    import React, {useState} from "react";
    import {createRoot} from "react-dom/client";
    import {QianchuanDeliveryPanel} from "./src/renderer/QianchuanDeliveryPanel";
    const account={product:"滴耳康",advertiserId:"1876131703522649",adId:"1877582409449488",available:true};
    const adId="1878488818847384";
    const uuid="55555555-5555-4555-8555-555555555555";
    const prepared=input=>({preflightId:uuid,expiresAt:"2026-10-17T12:00:00.000Z",capabilityStatus:window.capabilityStatus??"live-read-verified",recipeEvidenceId:"first-qualification-v1",recipeDigest:"a".repeat(64),productIds:["7001"],draft:{schemaVersion:1,draftId:"66666666-6666-4666-8666-666666666666",provider:"qianchuan-browser",accountSlot:input.product,advertiserId:input.expectedAdvertiserId,mode:"product-cost-control",action:input.action,beforeVersion:"page-version-1",adId:input.adId,beforeValues:input.action==="set-budget"?{budget:"120.00",budgetType:"daily"}:{roi:"2.0"},target:input.action==="set-budget"?{budget:input.targetValue,budgetType:"daily"}:{roi:input.targetValue}}});
    window.prepareCalls=[];window.confirmCalls=[];window.cancelCalls=[];window.preparePending=[];window.confirmPending=[];window.prepareDelay=false;window.confirmDelay=false;window.capabilityStatus="live-read-verified";
    window.jianji={
      prepareQianchuanDelivery:input=>{window.prepareCalls.push(input);if(window.prepareDelay)return new Promise(resolve=>window.preparePending.push(()=>resolve(prepared(input))));return Promise.resolve(prepared(input));},
      confirmQianchuanDelivery:input=>{window.confirmCalls.push(input);const result=window.confirmResult??{state:"UNKNOWN",reason:"SUBMIT_OUTCOME_UNKNOWN",action:"set-budget",operationId:"77777777-7777-4777-8777-777777777777",adId};if(window.confirmDelay)return new Promise(resolve=>window.confirmPending.push(()=>resolve(result)));return Promise.resolve(result);},
      cancelQianchuanIntegration:async input=>{window.cancelCalls.push(input);}
    };
    function Fixture(){const [active,setActive]=useState(true),[currentAccount,setAccount]=useState(account),[currentAdId,setAdId]=useState(adId);window.setActive=setActive;window.setAccount=setAccount;window.setAdId=setAdId;return <QianchuanDeliveryPanel account={currentAccount} active={active} adId={currentAdId}/>;}
    createRoot(document.getElementById("root")).render(<Fixture/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" }).outputFiles[0]!.text;
}

async function fixture(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 900, height: 850 } });
  await page.route("http://127.0.0.1:3000/delivery", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<meta charset="utf-8"><div id="root"></div>' }));
  await page.goto("http://127.0.0.1:3000/delivery");
  await page.addScriptTag({ content: fixtureScript() });
  await page.getByRole("heading", { name: "单次计划调整验证" }).waitFor();
  return page;
}

async function fillBounds(page: Page) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel("操作", { exact: true }).selectOption("set-budget");
  await page.getByLabel("目标值", { exact: true }).fill("150.00");
  await page.getByLabel("CNY 每日预算上限", { exact: true }).fill("200.00");
  await page.getByLabel("本次累计可增加额（CNY）", { exact: true }).fill("40.00");
  await page.getByLabel("授权截止时间（本地时间）", { exact: true }).fill(local);
}

it("does not read on mount and requires explicit preflight before a single exact confirmation", async () => {
  const page = await fixture();
  try {
    expect(await page.evaluate(() => [(window as any).prepareCalls, (window as any).confirmCalls])).toEqual([[], []]);
    expect(await page.getByLabel("操作").locator("option").allTextContents()).toEqual(["请选择动作", "修改预算", "修改 ROI 目标"]);
    expect(await page.getByText("最多执行 1 次", { exact: true }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "授权并执行一次验证", exact: true }).isDisabled()).toBe(true);
    await fillBounds(page);
    expect(await page.evaluate(() => [(window as any).prepareCalls, (window as any).confirmCalls])).toEqual([[], []]);
    await page.getByRole("button", { name: "读取并准备一次验证", exact: true }).click();
    await page.waitForFunction(() => (window as any).prepareCalls.length === 1);
    expect(await page.evaluate(() => (window as any).prepareCalls[0])).toMatchObject({
      product: "滴耳康", expectedAdvertiserId: "1876131703522649", adId: "1878488818847384", action: "set-budget", targetValue: "150.00",
    });
    expect(await page.getByText("账户 1876131703522649 · 保存默认计划 1877582409449488", { exact: true }).count()).toBe(1);
    expect(await page.getByText("本次目标计划 1878488818847384", { exact: false }).count()).toBe(1);
    expect(await page.getByText("120.00", { exact: false }).count()).toBeGreaterThan(0);
    expect(await page.getByText("150.00", { exact: false }).count()).toBeGreaterThan(0);
    expect(await page.getByText("首次资格：仅真实读取核验；本次为一次性实验写入，尚未证明真实写入及回读。", { exact: true }).count()).toBe(1);
    expect(await page.getByText("商品 ID：7001", { exact: true }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "授权并执行一次验证", exact: true }).isEnabled()).toBe(true);
    await page.evaluate(() => { (window as any).confirmDelay = true; });
    await page.getByRole("button", { name: "授权并执行一次验证", exact: true }).click();
    await page.waitForFunction(() => (window as any).confirmCalls.length === 1);
    const confirmation = await page.evaluate(() => (window as any).confirmCalls[0]);
    expect(confirmation).toMatchObject({ preflightId: "55555555-5555-4555-8555-555555555555", maxTargetBudget: "200.00", totalBudgetIncrease: "40.00", maxActions: 1 });
    expect(Date.parse(confirmation.expiresAt)).toBeLessThanOrEqual(Date.parse("2026-10-17T12:00:00.000Z"));
    expect(await page.getByRole("button", { name: "授权并执行一次验证", exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => (window as any).confirmPending[0]());
    await page.getByText(/结果未知.*不可重发/).waitFor();
    expect(await page.evaluate(() => (window as any).confirmCalls.length)).toBe(1);
    expect(await page.getByText("商品 ID：7001", { exact: true }).count()).toBe(1);
  } finally { await page.close(); }
});

it("requires explicit CNY bounds and expiry before preflight can be requested", async () => {
  const page = await fixture();
  try {
    await page.getByLabel("操作", { exact: true }).selectOption("set-budget");
    await page.getByLabel("目标值", { exact: true }).fill("150.00");
    expect(await page.getByRole("button", { name: "读取并准备一次验证", exact: true }).isDisabled()).toBe(true);
    await page.getByLabel("CNY 每日预算上限", { exact: true }).fill("200.00");
    await page.getByLabel("本次累计可增加额（CNY）", { exact: true }).fill("40.00");
    expect(await page.getByRole("button", { name: "读取并准备一次验证", exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => (window as any).prepareCalls)).toEqual([]);
  } finally { await page.close(); }
});

it("invalidates an already prepared draft when its target input changes", async () => {
  const page = await fixture();
  try {
    await fillBounds(page);
    await page.getByRole("button", { name: "读取并准备一次验证", exact: true }).click();
    await page.getByText(/首次资格：仅真实读取核验/).waitFor();
    await page.getByLabel("目标值", { exact: true }).fill("151.00");
    expect(await page.getByText(/首次资格：仅真实读取核验/).count()).toBe(0);
    expect(await page.getByRole("button", { name: "授权并执行一次验证", exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => (window as any).confirmCalls)).toEqual([]);
  } finally { await page.close(); }
});

it("rejects budget limits below the returned budget increase", async () => {
  const page = await fixture();
  try {
    await fillBounds(page);
    await page.getByLabel("本次累计可增加额（CNY）", { exact: true }).fill("29.99");
    await page.getByRole("button", { name: "读取并准备一次验证", exact: true }).click();
    await page.getByText(/本次累计可增加额不能低于本次预算上调额/).waitFor();
    expect(await page.getByRole("button", { name: "授权并执行一次验证", exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => (window as any).confirmCalls)).toEqual([]);
  } finally { await page.close(); }
});

it.each(["target", "adId", "account", "hidden"])("cancels and ignores a late preflight after %s changes", async change => {
  const page = await fixture();
  try {
    await fillBounds(page);
    await page.evaluate(() => { (window as any).prepareDelay = true; });
    await page.getByRole("button", { name: "读取并准备一次验证", exact: true }).click();
    await page.waitForFunction(() => (window as any).prepareCalls.length === 1);
    const requestId = await page.evaluate(() => (window as any).prepareCalls[0].requestId);
    if (change === "target") await page.getByLabel("目标值", { exact: true }).fill("151.00");
    if (change === "adId") await page.evaluate(() => (window as any).setAdId("1878488818847000"));
    if (change === "account") await page.evaluate(() => (window as any).setAccount({ product: "眼贴", advertiserId: "1876036793517065", adId: "1876052012647452", available: true }));
    if (change === "hidden") await page.evaluate(() => (window as any).setActive(false));
    await page.waitForFunction(() => (window as any).cancelCalls.length === 1);
    expect(await page.evaluate(() => (window as any).cancelCalls[0].requestId)).toBe(requestId);
    await page.evaluate(() => (window as any).preparePending[0]());
    await page.waitForTimeout(30);
    expect(await page.getByText("准备结果", { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => (window as any).confirmCalls)).toEqual([]);
  } finally { await page.close(); }
});
