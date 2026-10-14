import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";

export function planSelectionFixtureScript(options: { strict?: boolean; multiple?: boolean; batch?: boolean } = {}) {
  return buildSync({ stdin: { contents: `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { QianchuanPlanSelect } from "./src/renderer/QianchuanPlanSelect";
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
        {mounted && <>${options.batch ? '<div className="batch-template-controls"><div className="batch-upload-account" style={{width:360}}><label className="batch-upload-toggle"><span>千川上传</span><span><input type="checkbox" defaultChecked/><span>开启</span></span></label><select aria-label="上传账号"><option>眼贴 · 1000</option></select><QianchuanPlanSelect compact account={accounts[0]} value={value.plan} onChange={plan => setValue({...value, plan})}/></div></div>' : '<DouyinUploadControls value={value} onChange={setValue} accounts={accounts} compact={compact}/>'}
          ${options.multiple ? '<DouyinUploadControls value={value} onChange={setValue} accounts={accounts} compact={compact} idPrefix="another"/>' : ""}</>}
        <output id="selection">{JSON.stringify(value)}</output></>;
    }
    createRoot(document.getElementById("root")).render(${options.strict ? "<React.StrictMode><Fixture/></React.StrictMode>" : "<Fixture/>"});
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" }).outputFiles[0]!.text;
}

export function cleanupPlanFixtureScript(recovery = false) {
  return buildSync({ stdin: { contents: `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { QianchuanVideoLibraryActions } from "./src/renderer/QianchuanVideoLibraryActions";
    window.catalogRequests = []; window.cleanupRequests = []; window.recoveryRequests = [];
    window.jianji = {
      listQianchuanPlans: input => new Promise((resolve, reject) => window.catalogRequests.push({ input, resolve, reject })),
      cancelQianchuanPlans: async () => {},
      clearQianchuanVideoLibraries: async input => { window.cleanupRequests.push(input); return ${recovery ? '[{product:"眼贴",advertiserId:"1000",state:"BLOCKED",deletedCount:0,message:"计划 9001 上次删除结果未知",pendingPlanDeletion:{adId:"9001",attempt:"11111111-1111-4111-8111-111111111111",digest:"d".repeat(64),ids:["7001","7002"]}}]' : "[]"}; },
      resolveQianchuanPlanMaterialDeletion: async input => { window.recoveryRequests.push(input); },
      onQianchuanVideoLibrarySchedule: () => () => {},
      getQianchuanVideoLibrarySchedule: async () => ({settings:{enabled:false,time:"00:30",accounts:[]},timeZone:"Asia/Hong_Kong"})
    };
    function Fixture() {
      const [accounts, setAccounts] = useState([{product:"眼贴",advertiserId:"1000",adId:"2000",available:true}]);
      window.changeCleanupAccount = advertiserId => setAccounts([{...accounts[0],advertiserId}]);
      window.renameCleanupProfile = browserProfileName => setAccounts(current => current.map(account => ({...account,browserProfileName})));
      return <QianchuanVideoLibraryActions accounts={accounts} busy={false}/>;
    }
    createRoot(document.getElementById("root")).render(<Fixture/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, loader: { ".css": "empty" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" }).outputFiles[0]!.text;
}

export function subaccountFixtureScript(directoryError?: string, membershipError = false, deferDirectory = false) {
  return buildSync({stdin:{contents:`
    import React,{useState} from "react";
    import {createRoot} from "react-dom/client";
    import {QianchuanPlanSelect} from "./src/renderer/QianchuanPlanSelect";
    window.currentChild="7000";window.planReads=[];window.switches=[];window.directoryReads=0;window.directoryInputs=[];window.directoryError=${JSON.stringify(directoryError ?? "")};
    window.planError=${JSON.stringify(membershipError ? "无法核验账号权限，请检查网络后重试。" : "")};
    const membershipListeners=new Set();window.emitMembership=state=>membershipListeners.forEach(listener=>listener({state}));
    const named=id=>({advertiserId:id,name:id==="7000"?"原子账户商贸":"新子账户商贸"});
    window.jianji={onMembership:listener=>{membershipListeners.add(listener);return()=>membershipListeners.delete(listener);},listQianchuanPlans:async input=>{window.planReads.push(input);if(window.planError)throw new Error(window.planError);const id=window.currentChild;return {account:named(id),plans:[{advertiserId:id,adId:id==="7000"?"9001":"9002",name:"对应计划",accountSource:"current-browser"}]};},cancelQianchuanPlans:async()=>{},
      listQianchuanSubaccounts:async input=>{window.directoryReads++;window.directoryInputs.push(input);if(window.directoryError)throw new Error(window.directoryError);if(${deferDirectory})await new Promise(resolve=>window.resolveDirectory=resolve);return {current:named(window.currentChild),accounts:[named("7000"),named("8000")]};},
      switchQianchuanSubaccount:input=>new Promise((resolve,reject)=>window.switches.push({input,resolve:()=>{window.currentChild=input.advertiserId;resolve(named(window.currentChild));},reject}))};
    function Fixture(){const [plan,setPlan]=useState(),[account,setAccount]=useState(),[disabled,setDisabled]=useState(false);window.selection={plan,account};window.setDisabled=setDisabled;
      return <div className="batch-template-controls"><div className="batch-upload-account" style={{width:520}}><label>千川上传</label>
        <select aria-label="上传账号"><option>已保存的登录浏览器</option></select><QianchuanPlanSelect compact account={{product:"眼贴",advertiserId:"1000",available:true}} value={plan} onChange={setPlan} onAccountRead={setAccount} disabled={disabled}/>
        </div><output id="selection">{JSON.stringify({plan,account})}</output></div>;}
    createRoot(document.getElementById("root")).render(<Fixture/>);
  `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic"}).outputFiles[0]!.text;
}

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });
it("keeps account editing and scheduled targets independent of live Chrome display names", async () => {
  const page = await browser.newPage();
  try {
    await page.route("http://127.0.0.1:3000/account-names", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("http://127.0.0.1:3000/account-names");
    const script = buildSync({ stdin: { contents: `
      import React, {useState} from "react";
      import {createRoot} from "react-dom/client";
      import {QianchuanAccountSettings} from "./src/renderer/QianchuanAccountSettings";
      import {QianchuanVideoLibraryActions} from "./src/renderer/QianchuanVideoLibraryActions";
      import {QianchuanVideoLibrarySchedule} from "./src/renderer/QianchuanVideoLibrarySchedule";
      window.saved = []; window.controlled = []; window.scheduled = [];
      const settings = {enabled:true,time:"00:30",accounts:[{product:"眼贴",expectedAdvertiserId:"1000"}],confirmation:"DELETE_ALL_VIDEOS"};
      window.jianji = {listQianchuanPlans:async()=>[],cancelQianchuanPlans:async()=>{},
        onQianchuanVideoLibrarySchedule:()=>()=>{},getQianchuanVideoLibrarySchedule:async()=>({settings,timeZone:"Asia/Hong_Kong"}),
        saveQianchuanVideoLibrarySchedule:async value=>{window.scheduled.push(value);return {settings:value,timeZone:"Asia/Hong_Kong"}}};
      function Fixture(){const [accounts,setAccounts]=useState([
        {product:"眼贴",productName:"旧产品",browserProfileName:"相同 Chrome 名称",advertiserId:"1000",adId:"9001",available:true},
        {product:"肥皂",productName:"另一个产品",browserProfileName:"相同 Chrome 名称",advertiserId:"1001",adId:"9002",available:true}]);
        window.renameAllProfiles=()=>setAccounts(current=>current.map(account=>({...account,browserProfileName:"改名后的 Chrome"})));
        return <><QianchuanAccountSettings accounts={accounts} busy={false}
          onSave={async value=>{window.saved.push(value);return true}} onOpenBrowser={async()=>true}
          onControlBrowser={async value=>{window.controlled.push(value);return true}}/><QianchuanVideoLibraryActions accounts={accounts} busy={false}/><QianchuanVideoLibrarySchedule accounts={accounts} busy={false}/></>;}
      createRoot(document.getElementById("root")).render(<Fixture/>);
    `, resolveDir: process.cwd(), loader: "tsx" }, loader: { ".css": "empty" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" }).outputFiles[0]!.text;
    await page.addScriptTag({content:script});
    expect(await page.locator(".qianchuan-account-products").isVisible()).toBe(true);
    await page.getByText("选择要清理的账号（可多选）", { exact: true }).waitFor();
    const cleanupAccount = page.locator(".qianchuan-cleanup-accounts input").first();
    await cleanupAccount.uncheck();
    await page.getByRole("button", {name:/相同 Chrome 名称.*账户 1000.*已设置/}).click();
    expect(await page.getByLabel("产品名称",{exact:true}).inputValue()).toBe("旧产品");
    await page.getByLabel("产品名称",{exact:true}).fill("手填新产品");
    await page.getByRole("button", {name:/相同 Chrome 名称.*账户 1000.*已设置/}).click();
    expect(await page.getByLabel("产品名称", { exact: true }).inputValue()).toBe("手填新产品");
    expect(await cleanupAccount.isChecked()).toBe(false);
    await page.evaluate(()=>(window as any).renameAllProfiles());
    await page.getByRole("heading",{name:"改名后的 Chrome · 账号设置",exact:true}).waitFor();
    expect(await page.getByLabel("产品名称",{exact:true}).inputValue()).toBe("手填新产品");
    expect(await page.getByLabel("千川计划链接",{exact:true}).inputValue()).toContain("aavid=1000&adId=9001");
    await page.getByText("浏览器维护",{exact:true}).click();
    await page.getByRole("button",{name:"关闭账号浏览器",exact:true}).click();
    expect(await page.getByRole("group",{name:"确认账号浏览器操作"}).textContent()).toContain("改名后的 Chrome（账户 1000）");
    await page.getByRole("button",{name:"取消浏览器操作",exact:true}).click();
    await page.getByText("运行条件与已绑定账号",{exact:true}).click();
    expect(await page.locator(".qianchuan-cleanup-requirements").textContent()).toContain("改名后的 Chrome");
    await page.getByText("编辑视频库清空设置",{exact:true}).click();
    expect(await page.locator(".qianchuan-cleanup-schedule-editor").textContent()).toContain("改名后的 Chrome（账户 1000）");
    await page.getByRole("button",{name:"保存定时设置",exact:true}).click();
    await page.waitForFunction(()=>(window as any).scheduled.length===1);
    expect(await page.evaluate(()=>(window as any).scheduled[0].accounts)).toEqual([{product:"眼贴",expectedAdvertiserId:"1000"},{product:"肥皂",expectedAdvertiserId:"1001"}]);
    await page.getByRole("button",{name:"保存账号",exact:true}).click();
    await page.waitForFunction(()=>(window as any).saved.length===1);
    expect(await page.evaluate(()=>(window as any).saved[0])).toEqual({product:"眼贴",productName:"手填新产品",planUrl:"https://qianchuan.jinritemai.com/uni-prom?aavid=1000&adId=9001",egress:null});
    expect(await page.evaluate(()=>(window as any).controlled)).toEqual([]);
  } finally {await page.close();}
});
it("shows pending IDs and requires manual handling plus a second confirmation without automatically retrying", async () => {
  const page = await browser.newPage();
  try {
    await page.route("http://127.0.0.1:3000/recovery", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("http://127.0.0.1:3000/recovery"); await page.addScriptTag({ content: cleanupPlanFixtureScript(true) });
    await page.waitForFunction(() => (window as any).catalogRequests.length === 1);
    await page.evaluate(() => (window as any).catalogRequests[0].resolve([{advertiserId:"1000",adId:"9001",name:"计划 9001"}]));
    await page.getByRole("button", { name: "自动删除所选两类素材（1）", exact: true }).click();
    await page.getByText("查看各账号结果", { exact: true }).click();
    await page.getByText("待核查素材明细（2 条）", { exact: true }).click();
    expect(await page.getByLabel("待核查素材 ID").inputValue()).toBe("7001\n7002");
    expect(await page.getByRole("button", { name: "结束这次旧清理记录", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("checkbox", { name: "我已在千川核查并处理以上全部素材" }).check();
    await page.getByRole("button", { name: "结束这次旧清理记录", exact: true }).click();
    expect(await page.evaluate(() => (window as any).recoveryRequests.length)).toBe(0);
    await page.getByRole("button", { name: "返回核查", exact: true }).click();
    await page.getByRole("button", { name: "结束这次旧清理记录", exact: true }).click();
    await page.getByRole("button", { name: "确认结束旧记录", exact: true }).click();
    await page.getByText(/旧记录已由你标记为人工处理/).waitFor();
    expect(await page.evaluate(() => (window as any).recoveryRequests)).toEqual([{ product: "眼贴", advertiserId: "1000", adId: "9001", attempt: "11111111-1111-4111-8111-111111111111", digest: "d".repeat(64), confirmation: "MANUALLY_HANDLED_PLAN_DELETION" }]);
    expect(await page.evaluate(() => (window as any).cleanupRequests.length)).toBe(1);
    expect(await page.getByLabel("待核查素材 ID").count()).toBe(0);
  } finally { await page.close(); }
});
async function fixture(options: { strict?: boolean; multiple?: boolean; batch?: boolean } = {}): Promise<Page> {
  const page = await browser.newPage();
  await page.route("http://127.0.0.1:3000/plan-selector", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("http://127.0.0.1:3000/plan-selector"); await page.addScriptTag({ content: planSelectionFixtureScript(options) });
  await page.waitForFunction(() => (window as any).catalogRequests.length === 1);
  return page;
}
async function selected(page: Page) { return page.locator("#selection").textContent().then(value => JSON.parse(value!)); }
describe("plan selector browser interaction", () => {
  it("reads the subaccount directory before requesting plans and places the child before the plan", async () => {
    const page = await browser.newPage();
    try {
      await page.route("http://127.0.0.1:3000/children", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div id="root"></div>' }));
      await page.goto("http://127.0.0.1:3000/children"); await page.addScriptTag({ content: subaccountFixtureScript(undefined, false, true) });
      await page.waitForFunction(() => (window as any).directoryReads === 1);
      expect(await page.evaluate(() => (window as any).directoryInputs[0].displayCache)).toBe(true);
      expect(await page.evaluate(() => (window as any).planReads.length)).toBe(0);
      expect(await page.getByLabel("上传计划", { exact: true }).isDisabled()).toBe(true);
      expect(await page.locator(".qianchuan-plan-select").evaluate(element => {
        const child = element.querySelector(".qianchuan-subaccount-select")!;
        return !!(child.compareDocumentPosition(element.querySelector(":scope > select")!) & Node.DOCUMENT_POSITION_FOLLOWING);
      })).toBe(true);
      await page.evaluate(() => (window as any).resolveDirectory());
      await page.getByLabel("上传计划", { exact: true }).selectOption("9001");
      expect(await page.evaluate(() => (window as any).planReads.length)).toBe(1);
      expect(await page.evaluate(() => (window as any).planReads[0])).toMatchObject({ displayCache: true, expectedCurrentAdvertiserId: "7000" });
      expect((await selected(page)).plan).toMatchObject({ advertiserId: "7000", adId: "9001" });
    } finally { await page.close(); }
  });
  it("keeps subaccount selection usable when plan reading fails", async () => {
    const page = await browser.newPage();
    try {
      await page.route("http://127.0.0.1:3000/children", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div id="root"></div>' }));
      await page.goto("http://127.0.0.1:3000/children"); await page.addScriptTag({ content: subaccountFixtureScript(undefined, true) });
      await page.getByRole("alert").waitFor();
      expect(await page.getByLabel("子账户", { exact: true }).isDisabled()).toBe(false);
      await page.evaluate(() => { (window as any).planError = ""; });
      await page.getByLabel("子账户", { exact: true }).selectOption("8000");
      await page.waitForFunction(() => (window as any).switches.length === 1);
      await page.evaluate(() => (window as any).switches[0].resolve());
      await page.getByLabel("上传计划", { exact: true }).selectOption("9002");
      expect((await selected(page)).plan).toMatchObject({ advertiserId: "8000", adId: "9002" });
      expect(await page.evaluate(() => (window as any).switches.length)).toBe(1);
    } finally { await page.close(); }
  });
  it("uses cached catalogs on focus but bypasses both caches on explicit refresh", async () => {
    const page = await browser.newPage();
    try {
      await page.route("http://127.0.0.1:3000/cache", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div id="root"></div>' }));
      await page.goto("http://127.0.0.1:3000/cache"); await page.addScriptTag({ content: subaccountFixtureScript() });
      await page.getByLabel("上传计划", {exact:true}).selectOption("9001");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForFunction(() => (window as any).planReads.length === 2);
      expect(await page.evaluate(() => (window as any).planReads[1].refresh)).toBeUndefined();
      expect(await page.evaluate(() => (window as any).directoryInputs[1].refresh)).toBeUndefined();
      expect((await selected(page)).plan.adId).toBe("9001");
      await page.getByRole("button", {name:"刷新计划",exact:true}).click();
      await page.waitForFunction(() => (window as any).planReads.length === 3);
      expect(await page.evaluate(() => (window as any).planReads[2].refresh)).toBe(true);
      expect(await page.evaluate(() => (window as any).directoryInputs[2].refresh)).toBe(true);
      await page.getByRole("button", {name:"刷新子账户",exact:true}).click();
      await page.waitForFunction(() => (window as any).directoryInputs.length === 4);
      expect(await page.evaluate(() => (window as any).directoryInputs[3].refresh)).toBe(true);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForFunction(() => (window as any).directoryInputs.length === 5);
      expect(await page.evaluate(() => (window as any).directoryInputs[4].refresh)).toBeUndefined();
    } finally { await page.close(); }
  });
  it("rejects plans from a different child until the directory is explicitly refreshed", async () => {
    const page = await browser.newPage();
    try {
      await page.route("http://127.0.0.1:3000/children", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div id="root"></div>' }));
      await page.goto("http://127.0.0.1:3000/children"); await page.addScriptTag({ content: subaccountFixtureScript(undefined, false, true) });
      await page.waitForFunction(() => (window as any).directoryReads === 1);
      await page.evaluate(() => {
        (window as any).jianji.listQianchuanPlans = async (input: unknown) => {
          (window as any).planReads.push(input);
          return { account: { advertiserId: "8000", name: "新子账户商贸" }, plans: [{ advertiserId: "8000", adId: "9002", name: "对应计划", accountSource: "current-browser" }] };
        };
        (window as any).resolveDirectory();
      });
      await page.getByRole("alert").waitFor();
      expect(await page.getByRole("alert").textContent()).toBe("网页子账户已变化，请刷新子账户后重新选择计划。");
      expect(await page.getByLabel("上传计划", { exact: true }).isDisabled()).toBe(true);
      expect((await selected(page)).plan).toBeUndefined();
      expect((await selected(page)).account.advertiserId).toBe("7000");
      expect(await page.evaluate(() => (window as any).planReads.length)).toBe(1);
      expect(await page.evaluate(() => (window as any).switches)).toEqual([]);
      await page.evaluate(() => { (window as any).currentChild = "8000"; });
      await page.getByRole("button", { name: "刷新子账户", exact: true }).click();
      await page.waitForFunction(() => (window as any).directoryReads === 2);
      expect(await page.evaluate(() => (window as any).planReads.length)).toBe(1);
      await page.evaluate(() => (window as any).resolveDirectory());
      await page.getByLabel("上传计划", { exact: true }).selectOption("9002");
      expect((await selected(page)).plan).toMatchObject({ advertiserId: "8000", adId: "9002" });
      expect(await page.evaluate(() => (window as any).planReads.length)).toBe(2);
      expect(await page.evaluate(() => (window as any).switches)).toEqual([]);
    } finally { await page.close(); }
  });
  it.each([false, true])("refreshes a failed plan and child directory once after membership recovers, deferring while busy: %s", async busy => {
    const page = await browser.newPage();
    try {
      await page.route("http://127.0.0.1:3000/children",route=>route.fulfill({contentType:"text/html; charset=utf-8",body:'<div id="root"></div>'}));
      await page.goto("http://127.0.0.1:3000/children"); await page.addScriptTag({content:subaccountFixtureScript(undefined, true)});
      await page.getByRole("alert").waitFor();
      expect(await page.getByLabel("子账户",{exact:true}).isDisabled()).toBe(false);
      await page.evaluate(busy=>{(window as any).setDisabled(busy);(window as any).emitMembership("unavailable");(window as any).planError="";},busy);
      await page.evaluate(()=>{(window as any).emitMembership("allowed");(window as any).emitMembership("allowed");});
      if (busy) {
        await page.waitForTimeout(50);
        expect(await page.evaluate(()=>(window as any).planReads.length)).toBe(1);
        await page.evaluate(()=>(window as any).setDisabled(false));
      }
      await page.getByLabel("子账户",{exact:true}).selectOption("7000");
      expect(await page.evaluate(()=>(window as any).planReads.length)).toBe(2);
      expect(await page.evaluate(()=>(window as any).planReads[1].refresh)).toBe(true);
      expect(await page.evaluate(()=>(window as any).directoryReads)).toBe(2);
      expect((await selected(page)).plan).toBeUndefined();
      expect(await page.evaluate(()=>(window as any).switches)).toEqual([]);
      await page.getByLabel("上传计划",{exact:true}).selectOption("9001");
      await page.evaluate(()=>{(window as any).emitMembership("allowed");(window as any).emitMembership("allowed");});
      await page.waitForTimeout(50);
      expect(await page.evaluate(()=>(window as any).planReads.length)).toBe(2);
      expect((await selected(page)).plan).toMatchObject({advertiserId:"7000",adId:"9001"});
      await page.evaluate(()=>{(window as any).emitMembership("unavailable");(window as any).emitMembership("denied");});
      await page.waitForTimeout(50);
      expect(await page.evaluate(()=>(window as any).planReads.length)).toBe(2);
    } finally {await page.close();}
  });
  it.each([
    ["Error invoking remote method 'douyin-upload:list-subaccounts': Error: 远端浏览器连接不可用，请明确重连。", "远端浏览器连接不可用，请明确重连。"],
    ["连接失败 ws://127.0.0.1:12345/private-browser-token", "读取子账户失败，请检查网页后刷新。"],
  ])("shows a safe directory failure and recovers on explicit refresh: %s", async (cause, message) => {
    const page = await browser.newPage();
    try {
      await page.route("http://127.0.0.1:3000/children",route=>route.fulfill({contentType:"text/html; charset=utf-8",body:'<div id="root"></div>'}));
      await page.goto("http://127.0.0.1:3000/children"); await page.addScriptTag({content:subaccountFixtureScript(cause)});
      await page.getByRole("alert").waitFor(); expect(await page.getByRole("alert").textContent()).toBe(message);
      expect(await page.getByLabel("子账户",{exact:true}).isDisabled()).toBe(true);
      expect(await page.evaluate(()=>(window as any).directoryReads)).toBe(1);
      expect(await page.getByLabel("上传计划",{exact:true}).isDisabled()).toBe(true);
      expect(await page.evaluate(()=>(window as any).planReads.length)).toBe(0);
      await page.evaluate(()=>{(window as any).directoryError="";});
      await page.getByRole("button",{name:"刷新子账户",exact:true}).click();
      await page.getByLabel("子账户",{exact:true}).selectOption("7000");
      expect(await page.evaluate(()=>(window as any).directoryReads)).toBe(2);
      await page.getByLabel("上传计划",{exact:true}).selectOption("9001");
      expect((await selected(page)).plan).toMatchObject({advertiserId:"7000",adId:"9001"});
      expect(await page.evaluate(()=>(window as any).switches)).toEqual([]);
    } finally {await page.close();}
  });
  it("selects a child explicitly, clears the old plan immediately, then reads only the new child's plans", async () => {
    const page=await browser.newPage();
    try {
      await page.route("http://127.0.0.1:3000/children",route=>route.fulfill({contentType:"text/html; charset=utf-8",body:'<div id="root"></div>'}));
      await page.goto("http://127.0.0.1:3000/children");await page.addScriptTag({content:subaccountFixtureScript()});
      await page.addStyleTag({content:readFileSync("src/renderer/styles.css","utf8")+readFileSync("src/renderer/batch-production.css","utf8")});
      await page.getByLabel("子账户",{exact:true}).selectOption("7000");
      expect(await page.getByLabel("子账户",{exact:true}).locator("option").allTextContents()).toEqual(["原子账户商贸 · 7000","新子账户商贸 · 8000"]);
      const layout=await page.locator(".qianchuan-plan-select").evaluate(element=>{
        // The child wrapper uses display: contents; measure its visible controls.
        const child=element.querySelector(".qianchuan-subaccount-select > select")!.getBoundingClientRect();
        const plan=element.querySelector(":scope > select")!.getBoundingClientRect();
        return {gap:plan.left-child.right,alignment:Math.abs(child.top-plan.top),overflow:element.scrollWidth>element.clientWidth};
      });
      expect(layout.gap).toBeGreaterThanOrEqual(0);expect(layout.alignment).toBeLessThan(1);expect(layout.overflow).toBe(false);
      await page.getByLabel("上传计划",{exact:true}).selectOption("9001");
      await page.getByLabel("子账户",{exact:true}).selectOption("8000");
      await page.waitForFunction(()=>(window as any).switches.length===1);
      expect(await page.evaluate(()=>(window as any).selection)).toEqual({});
      expect(await page.getByLabel("上传计划",{exact:true}).isDisabled()).toBe(true);
      expect(await page.evaluate(()=>(window as any).switches[0].input)).toEqual({product:"眼贴",expectedAdvertiserId:"1000",expectedCurrentAdvertiserId:"7000",advertiserId:"8000"});
      expect(await page.evaluate(() => (window as any).switches[0].input.displayCache)).toBeUndefined();
      await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
      expect(await page.evaluate(()=>(window as any).planReads.length)).toBe(1);
      await page.evaluate(()=>(window as any).switches[0].resolve());
      await page.getByLabel("子账户",{exact:true}).selectOption("8000");
      await page.waitForFunction(()=>(window as any).selection.account?.advertiserId==="8000");
      expect((await selected(page)).plan).toBeUndefined();
      expect(await page.getByLabel("上传计划",{exact:true}).locator("option").allTextContents()).toEqual(["请选择上传计划","对应计划 · ID 9002"]);
      await page.getByLabel("上传计划",{exact:true}).selectOption("9002");
      expect((await selected(page)).plan).toMatchObject({advertiserId:"8000",adId:"9002",accountSource:"current-browser"});
      await page.getByLabel("子账户",{exact:true}).selectOption("7000");
      await page.evaluate(()=>(window as any).switches[1].reject(new Error("切换结果未能核对，请检查网页。")));
      await page.getByRole("alert").waitFor();
      expect((await selected(page)).plan).toBeUndefined();
      expect(await page.evaluate(()=>(window as any).switches.length)).toBe(2);
      expect(await page.getByLabel("子账户",{exact:true}).isDisabled()).toBe(true);
      await page.getByRole("button",{name:"刷新子账户",exact:true}).click();
      await page.getByLabel("子账户",{exact:true}).selectOption("8000");
      expect(await page.evaluate(()=>(window as any).switches.length)).toBe(2);
    } finally {await page.close();}
  });
  it("retains the last child name and ID as a historical draft after plan refresh fails", async () => {
    const page = await fixture();
    try {
      await page.evaluate(() => (window as any).catalogRequests[0].resolve({ account: { advertiserId: "7000", name: "新子账户商贸" }, plans: [] }));
      const account = page.locator('#douyin-upload-product');
      await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('#douyin-upload-product')?.selectedOptions[0]?.textContent === "新子账户商贸 · 7000");
      expect(await page.getByLabel("上传计划").isDisabled()).toBe(true);
      expect(await account.inputValue()).toBe("眼贴");
      await page.getByRole("button", { name: "刷新计划", exact: true }).click();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('#douyin-upload-product')?.selectedOptions[0]?.textContent?.includes("7000"));
      expect(await account.locator("option:checked").textContent()).toContain("7000");
      await page.evaluate(() => (window as any).catalogRequests[1].reject(new Error("无法确认当前网页账户")));
      await page.getByRole("alert").waitFor();
      expect(await account.locator("option:checked").textContent()).toContain("7000");
      await page.getByText(/历史目录.*刷新失败/).waitFor();
    } finally { await page.close(); }
  });
  it("reads and selects the webpage child, then clears the choice if focus returns with a different child", async () => {
    const page = await fixture({ batch: true });
    try {
      expect(await page.evaluate(() => (window as any).catalogRequests[0].input.accountSource)).toBe("current-browser");
      expect(await page.evaluate(() => (window as any).catalogRequests[0].input.displayCache)).toBe(true);
      const respond = (advertiserId: string) => page.evaluate(id => (window as any).catalogRequests.at(-1).resolve([
        { advertiserId: id, adId: "9001", name: "子账户计划", accountSource: "current-browser" },
      ]), advertiserId);
      await respond("7000");
      await page.getByLabel("上传计划").selectOption("9001");
      expect((await selected(page)).plan).toMatchObject({ advertiserId: "7000", accountSource: "current-browser" });
      await page.getByText("网页账户 · 账户 7000", { exact: true }).waitFor();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      await respond("8000");
      await page.getByText("网页账户 · 账户 8000", { exact: true }).waitFor();
      expect((await selected(page)).plan).toBeUndefined();
      expect(await page.getByLabel("上传计划").inputValue()).toBe("");
    } finally { await page.close(); }
  });
  it("keeps account controls aligned and offers recovery after a raw CDP timeout", async () => {
    const page = await fixture({ batch: true });
    try {
      await page.addStyleTag({ content: readFileSync("src/renderer/styles.css", "utf8") + readFileSync("src/renderer/batch-production.css", "utf8") });
      await page.evaluate(() => (window as any).catalogRequests[0].reject(new Error("Error invoking remote method 'douyinUpload.listPlans': TimeoutError: browserType.connectOverCDP: Timeout 10000ms exceeded. Call log: \u001b[2m - <ws connected> ws://127.0.0.1:34515/private-session\u001b[22m")));
      await page.getByRole("alert").waitFor();
      expect(await page.getByRole("alert").textContent()).toBe("连接账号 Chrome 超时，请检查浏览器后刷新计划。");
      const geometry = await page.locator(".batch-upload-account").evaluate(element => {
        const account = element.querySelector('[aria-label="上传账号"]')!.getBoundingClientRect();
        const plan = element.querySelector('[aria-label="上传计划"]')!.getBoundingClientRect();
        return { accountY: account.y, planY: plan.y, height: element.getBoundingClientRect().height, overflow: element.scrollWidth > element.clientWidth };
      });
      expect(geometry.accountY).toBeCloseTo(geometry.planY, 0);
      expect(geometry.height).toBeLessThan(140);
      expect(geometry.overflow).toBe(false);
      expect(await page.getByLabel("上传计划").isDisabled()).toBe(true);
      await page.getByRole("button", { name: "刷新计划", exact: true }).click();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      await page.getByRole("button", { name: "返回两个计划" }).click();
      await page.getByLabel("上传计划").selectOption("9001");
      expect((await selected(page)).plan.adId).toBe("9001");
    } finally { await page.close(); }
  });
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
  it("puts verified product names first and shows the full selected plan identity separately", async () => {
    const page = await fixture();
    try {
      await page.evaluate(() => (window as any).catalogRequests[0].resolve([
        { advertiserId: "1000", adId: "1877947268854202", name: "2026-10-02_商品全域投放_22:00:07", productNames: ["叶黄素蒸汽眼罩"] },
        { advertiserId: "1000", adId: "1877947269854202", name: "2026-10-02_商品全域投放_22:00:07", productNames: ["艾草蒸汽眼罩", "热敷眼贴"] },
      ]));
      const options = page.getByLabel("上传计划").locator("option");
      await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('[aria-label="上传计划"]')!.options.length === 3);
      expect((await options.allTextContents())[1]).toMatch(/^叶黄素蒸汽眼罩/);
      expect((await options.allTextContents())[2]).toMatch(/^艾草蒸汽眼罩、热敷眼贴/);
      await page.addStyleTag({ content: readFileSync("src/renderer/batch-production.css", "utf8") });
      await page.locator(".qianchuan-plan-select").evaluate(element => {
        const grid = document.createElement("div"); grid.className = "batch-upload-account"; grid.style.width = "240px";
        element.before(grid); grid.append(document.createElement("span"), document.createElement("span"), element);
      });
      expect(await page.locator(".qianchuan-plan-select").evaluate(element => element.getBoundingClientRect().width)).toBe(240);
      await page.getByLabel("上传计划").selectOption("1877947269854202");
      expect((await selected(page)).plan.adId).toBe("1877947269854202");
      await page.getByText("计划 ID：1877947269854202", { exact: true }).waitFor();
      await page.getByText("计划名称：2026-10-02_商品全域投放_22:00:07", { exact: true }).waitFor();
    } finally { await page.close(); }
  });
  it("requires an explicit plan, displays name and ID, and retains selection when a refresh falls back to history", async () => {
    const page = await fixture();
    try {
      expect(await page.getByLabel("上传计划").isDisabled()).toBe(true);
      expect(await page.evaluate(() => (window as any).catalogRequests[0].input.displayCache)).toBe(true);
      await page.evaluate(() => (window as any).catalogRequests[0].resolve({
        plans: ["9001", "9002"].map(adId => ({ advertiserId: "1000", adId, name: `计划 ${adId}` })),
        cache: { source: "live", readAt: 1_760_000_000_000, stale: false, persisted: true },
      }));
      await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('[aria-label="上传计划"]')!.disabled);
      expect((await selected(page)).plan).toBeUndefined();
      expect(await page.getByLabel("上传计划").locator("option").allTextContents()).toContain("计划 9002 · ID 9002");
      await page.getByLabel("上传计划").selectOption("9002");
      expect((await selected(page)).plan).toEqual({ advertiserId: "1000", adId: "9002", name: "计划 9002" });
      await page.getByRole("button", { name: "刷新计划" }).click();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      expect((await selected(page)).plan?.adId).toBe("9002");
      await page.evaluate(() => (window as any).catalogRequests[1].resolve({
        plans: ["9001", "9002"].map(adId => ({ advertiserId: "1000", adId, name: `计划 ${adId}` })),
        cache: { source: "cache", readAt: 1_760_000_000_000, stale: true, refreshFailed: true },
      }));
      await page.getByText(/历史目录.*刷新失败/).waitFor();
      expect((await selected(page)).plan?.adId).toBe("9002");
      expect(await page.getByLabel("上传计划").isDisabled()).toBe(false);
    } finally { await page.close(); }
  });
  it("clears a selected upload plan only after a fresh catalog removes it", async () => {
    const page = await fixture();
    try {
      await page.evaluate(() => (window as any).catalogRequests[0].resolve({
        plans: ["9001", "9002"].map(adId => ({ advertiserId: "1000", adId, name: `计划 ${adId}` })),
        cache: { source: "live", readAt: 1_760_000_000_000, stale: false, persisted: true },
      }));
      await page.getByLabel("上传计划").selectOption("9002");
      await page.getByRole("button", { name: "刷新计划" }).click();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      await page.evaluate(() => (window as any).catalogRequests[1].resolve({
        plans: [{ advertiserId: "1000", adId: "9001", name: "计划 9001" }],
        cache: { source: "live", readAt: 1_760_000_060_000, stale: false, persisted: true },
      }));
      await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('[aria-label="上传计划"]')!.options.length === 2);
      expect((await selected(page)).plan).toBeUndefined();
      expect(await page.getByLabel("上传计划").locator("option").allTextContents()).not.toContain("计划 9002 · ID 9002");
    } finally { await page.close(); }
  });
  it("retains a failed child refresh as a draft and sends switches through the live API", async () => {
    const page = await browser.newPage();
    try {
      await page.route("http://127.0.0.1:3000/children", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div id="root"></div>' }));
      await page.goto("http://127.0.0.1:3000/children"); await page.addScriptTag({ content: subaccountFixtureScript() });
      await page.waitForFunction(() => (window as any).directoryReads === 1);
      await page.getByLabel("上传计划", { exact: true }).selectOption("9001");
      await page.evaluate(() => { (window as any).directoryError = "Chrome 已断开"; });
      await page.getByRole("button", { name: "刷新子账户", exact: true }).click();
      await page.waitForFunction(() => (window as any).directoryReads === 2);
      await page.locator(".qianchuan-subaccount-select").getByRole("status").waitFor();
      expect(await page.getByLabel("子账户", { exact: true }).inputValue()).toBe("7000");
      expect(await page.getByLabel("子账户", { exact: true }).locator("option").allTextContents()).toEqual(["原子账户商贸 · 7000", "新子账户商贸 · 8000"]);
      expect(await page.getByLabel("子账户", { exact: true }).isDisabled()).toBe(false);
      expect((await selected(page)).plan).toMatchObject({ advertiserId: "7000", adId: "9001" });
      await page.getByLabel("子账户", { exact: true }).selectOption("8000");
      await page.waitForFunction(() => (window as any).switches.length === 1);
      expect(await page.evaluate(() => (window as any).switches[0].input)).toEqual({ product: "眼贴", expectedAdvertiserId: "1000", expectedCurrentAdvertiserId: "7000", advertiserId: "8000" });
      await page.evaluate(() => (window as any).switches[0].reject(new Error("当前网页连接失败")));
      await page.getByRole("alert").waitFor();
      expect(await page.evaluate(() => (window as any).switches[0].input.displayCache)).toBeUndefined();
      await page.evaluate(() => { (window as any).directoryError = ""; });
      await page.getByRole("button", { name: "刷新子账户", exact: true }).click();
      await page.waitForFunction(() => (window as any).directoryReads === 3);
      await page.getByLabel("子账户", { exact: true }).selectOption("8000");
      await page.waitForFunction(() => (window as any).switches.length === 2);
      expect(await page.evaluate(() => (window as any).switches[1].input)).toEqual({ product: "眼贴", expectedAdvertiserId: "1000", expectedCurrentAdvertiserId: "7000", advertiserId: "8000" });
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
      expect(await page.getByLabel("上传计划").locator("option").allTextContents()).not.toContain("旧账号计划 · ID 7777");
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
  it("keeps batch account, plan and refresh aligned while preserving choice and visible errors", async () => {
    const page = await fixture({ batch: true });
    try {
      await page.addStyleTag({ content: readFileSync("src/renderer/styles.css", "utf8") + readFileSync("src/renderer/batch-production.css", "utf8") });
      const height = await page.locator(".batch-upload-account").evaluate(element => element.getBoundingClientRect().height);
      await page.getByRole("button", { name: "返回两个计划" }).click();
      expect((await selected(page)).plan).toBeUndefined();
      await page.getByLabel("上传计划", { exact: true }).selectOption("9002");
      const geometry = await page.locator(".batch-upload-account").evaluate(element => {
        const account = element.querySelector('[aria-label="上传账号"]')!.getBoundingClientRect();
        const plan = element.querySelector('[aria-label="上传计划"]')!.getBoundingClientRect();
        const refresh = element.querySelector('[aria-label="刷新计划"]')!.getBoundingClientRect();
        return { height: element.getBoundingClientRect().height, accountY: account.y, planY: plan.y, refreshY: refresh.y,
          overflow: element.scrollWidth > element.clientWidth };
      });
      expect(geometry.planY).toBeCloseTo(geometry.accountY, 0);
      expect(geometry.refreshY).toBeCloseTo(geometry.accountY, 0);
      expect(geometry.height).toBeCloseTo(height, 0);
      expect(geometry.overflow).toBe(false);
      expect(await page.getByLabel("上传计划", { exact: true }).getAttribute("title")).toContain("计划 9002 · ID 9002");
      await page.getByRole("button", { name: "刷新计划", exact: true }).click();
      expect((await selected(page)).plan.adId).toBe("9002");
      await page.getByRole("button", { name: "读取失败", exact: true }).click();
      await page.getByRole("alert").waitFor();
      expect(await page.getByRole("alert").textContent()).toBe("Chrome 登录已失效");
      expect((await selected(page)).plan.adId).toBe("9002");
      expect(await page.getByLabel("上传计划").isDisabled()).toBe(false);
    } finally { await page.close(); }
  });
});

describe("cleanup plan browser interaction", () => {
  async function cleanupFixture() {
    const page = await browser.newPage();
    await page.route("http://127.0.0.1:3000/cleanup", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("http://127.0.0.1:3000/cleanup"); await page.addScriptTag({ content: cleanupPlanFixtureScript() });
    await page.addStyleTag({ content: readFileSync("src/renderer/styles.css", "utf8") + readFileSync("src/renderer/qianchuan-cleanup.css", "utf8") });
    await page.waitForFunction(() => (window as any).catalogRequests.length === 1);
    expect(await page.evaluate(() => (window as any).catalogRequests[0].input.displayCache)).toBe(true);
    return page;
  }
  async function respond(page: Page) {
    await page.evaluate(() => {
      const request = (window as any).catalogRequests.at(-1);
      request.resolve(["9001", "9002"].map(adId => ({advertiserId:request.input.expectedAdvertiserId, adId, name:"计划 " + adId, productNames:["叶黄素蒸汽眼罩"]})));
    });
    await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).waitFor();
  }
  it("defaults to all plans and freezes the complete set before deletion", async () => {
    const page = await cleanupFixture();
    try {
      expect(await page.getByRole("button", { name: "自动删除所选两类素材", exact: true }).isDisabled()).toBe(true); await respond(page);
      await page.getByRole("checkbox", { name: /近15天零展示素材/ }).uncheck();
      expect(await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).isChecked()).toBe(true);
      expect(await page.getByRole("checkbox", { name: "清理计划 9002", exact: true }).isChecked()).toBe(true);
      await page.setViewportSize({ width: 420, height: 900 });
      expect(await page.locator(".qianchuan-cleanup-plan").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
      await page.getByRole("button", { name: "清理所选计划（2）", exact: true }).click();
      const confirmation = await page.getByRole("group", { name: "确认素材清理" }).textContent();
      expect(confirmation).toContain("2 个计划"); expect(confirmation).toContain("ID 9001"); expect(confirmation).toContain("ID 9002");
      expect(await page.evaluate(() => (window as any).cleanupRequests.length)).toBe(0);
      await page.getByRole("button", { name: "确认删除三类计划素材（1 个账号）", exact: true }).click();
      await page.waitForFunction(() => (window as any).cleanupRequests.length === 1);
      expect(await page.evaluate(() => (window as any).cleanupRequests[0])).toEqual({ confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1000", plans: ["9001", "9002"].map(adId => ({ advertiserId: "1000", adId, name: `计划 ${adId}`, productNames: ["叶黄素蒸汽眼罩"] })) }] });
    } finally { await page.close(); }
  });
  it("refreshes Chrome labels without changing selected cleanup accounts or plans", async () => {
    const page = await cleanupFixture();
    try {
      await respond(page);
      await page.getByRole("checkbox", { name: /近15天零展示素材/ }).uncheck();
      await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).uncheck();
      await page.evaluate(() => (window as any).renameCleanupProfile("新的 Chrome 资料名"));
      await page.getByRole("checkbox", { name: "新的 Chrome 资料名 账户 1000", exact: true }).waitFor();
      expect(await page.getByRole("checkbox", { name: "新的 Chrome 资料名 账户 1000", exact: true }).isChecked()).toBe(true);
      expect(await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).isChecked()).toBe(false);
      expect(await page.getByRole("checkbox", { name: "清理计划 9002", exact: true }).isChecked()).toBe(true);
      expect(await page.locator(".qianchuan-cleanup-plan > strong").textContent()).toBe("新的 Chrome 资料名 · 账户 1000");
      expect(await page.evaluate(() => (window as any).catalogRequests.length)).toBe(1);
      await page.getByRole("button", { name: "清理所选计划（1）", exact: true }).click();
      await page.evaluate(() => (window as any).renameCleanupProfile("再次改名"));
      await page.getByRole("group", { name: "确认素材清理" }).getByText("再次改名", { exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).cleanupRequests.length)).toBe(0);
      await page.getByRole("button", { name: "确认删除三类计划素材（1 个账号）", exact: true }).click();
      await page.waitForFunction(() => (window as any).cleanupRequests.length === 1);
      expect(await page.evaluate(() => (window as any).cleanupRequests[0])).toEqual({ confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1000", plans: [{ advertiserId: "1000", adId: "9002", name: "计划 9002", productNames: ["叶黄素蒸汽眼罩"] }] }] });
    } finally { await page.close(); }
  });
  it("defaults to both independent rules, allows an empty choice and starts both rules once", async () => {
    const page = await cleanupFixture();
    try {
      await respond(page);
      const audit = page.getByRole("checkbox", { name: /计划内三类素材/ }), zero = page.getByRole("checkbox", { name: /近15天零展示素材/ });
      expect(await audit.isChecked()).toBe(true); expect(await zero.isChecked()).toBe(true);
      expect(await page.getByRole("combobox", { name: "计划素材清理规则" }).count()).toBe(0);
      await audit.uncheck(); await zero.uncheck();
      expect(await page.getByRole("button", { name: "清理所选账号（1）" }).isDisabled()).toBe(true);
      await audit.check(); await zero.check();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2); await respond(page);
      await page.getByRole("button", { name: "自动删除所选两类素材（2）", exact: true }).click();
      await page.waitForFunction(() => (window as any).cleanupRequests.length === 1);
      expect(await page.evaluate(() => (window as any).cleanupRequests[0])).toMatchObject({ confirmation: "DELETE_PLAN_MATERIALS", planMaterialRule: "AUDIT_AND_ZERO_IMPRESSIONS_15D" });
    } finally { await page.close(); }
  });
  it("starts zero-impression cleanup once for the frozen plan set without per-page confirmation or library clearing", async () => {
    const page = await cleanupFixture();
    try {
      await respond(page);
      await page.getByRole("checkbox", { name: /计划内三类素材/ }).uncheck();
      expect(await page.getByRole("checkbox", { name: /视频库全部视频/ }).isChecked()).toBe(false);
      expect(await page.getByRole("checkbox", { name: /视频库全部视频/ }).isDisabled()).toBe(false);
      await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).uncheck();
      await page.getByRole("button", { name: "自动删除零展示素材（1）", exact: true }).click();
      await page.waitForFunction(() => (window as any).cleanupRequests.length === 1);
      expect(await page.getByRole("group", { name: "确认素材清理" }).count()).toBe(0);
      expect(await page.evaluate(() => (window as any).cleanupRequests[0])).toMatchObject({ confirmation: "DELETE_PLAN_MATERIALS", planMaterialRule: "ZERO_IMPRESSIONS_15D", accounts: [{ expectedAdvertiserId: "1000", plans: [{ adId: "9002" }] }] });
    } finally { await page.close(); }
  });
  it.each(["ZERO_IMPRESSIONS_15D", "AUDIT_AND_ZERO_IMPRESSIONS_15D"])("keeps library selection independent and confirms its separate scope with %s", async planMaterialRule => {
    const page = await cleanupFixture();
    try {
      await respond(page);
      const library = page.getByRole("checkbox", { name: /视频库全部视频/ });
      const zero = page.getByRole("checkbox", { name: /近15天零展示素材/ });
      expect(await library.isChecked()).toBe(false);
      expect(await library.isDisabled()).toBe(false);
      await library.check(); await zero.uncheck(); await zero.check();
      expect(await library.isChecked()).toBe(true);
      if (planMaterialRule === "ZERO_IMPRESSIONS_15D") await page.getByRole("checkbox", { name: /计划内三类素材/ }).uncheck();
      await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).uncheck();
      await page.getByRole("button", { name: "清理所选计划及视频库（1）", exact: true }).click();
      const confirmation = await page.getByRole("group", { name: "确认素材清理" }).textContent();
      expect(confirmation).toContain("近15天零展示素材"); expect(confirmation).toContain("加入当前计划已满15天（360小时）"); expect(confirmation).not.toContain("72小时"); expect(confirmation).toContain("不按计划筛选");
      expect(confirmation?.includes("所选计划内三类素材")).toBe(planMaterialRule === "AUDIT_AND_ZERO_IMPRESSIONS_15D");
      expect(confirmation).toContain("ID 9002"); expect(confirmation).not.toContain("ID 9001");
      expect(await page.evaluate(() => (window as any).cleanupRequests.length)).toBe(0);
      await page.getByRole("button", { name: "确认删除两类内容（1 个账号）", exact: true }).click();
      await page.waitForFunction(() => (window as any).cleanupRequests.length === 1);
      expect(await page.evaluate(() => (window as any).cleanupRequests[0])).toMatchObject({ confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", planMaterialRule, accounts: [{ expectedAdvertiserId: "1000", plans: [{ adId: "9002" }] }] });
    } finally { await page.close(); }
  });
  it("allows deselection, preserves an explicit empty choice on remount and submits only the checked subset", async () => {
    const page = await cleanupFixture();
    try {
      await respond(page);
      await page.getByRole("checkbox", { name: /近15天零展示素材/ }).uncheck();
      await page.getByRole("button", { name: "全选清理计划", exact: true }).click();
      expect(await page.getByRole("button", { name: "清理所选计划", exact: true }).isDisabled()).toBe(true);
      await page.getByRole("checkbox", { name: /计划内三类素材/ }).uncheck();
      await page.getByRole("checkbox", { name: /计划内三类素材/ }).check();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2); await respond(page);
      expect(await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).isChecked()).toBe(false);
      expect(await page.getByRole("checkbox", { name: "清理计划 9002", exact: true }).isChecked()).toBe(false);
      await page.getByRole("button", { name: "全选清理计划", exact: true }).click();
      await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).uncheck();
      await page.getByRole("button", { name: "清理所选计划（1）", exact: true }).click();
      const confirmation = await page.getByRole("group", { name: "确认素材清理" }).textContent();
      expect(confirmation).toContain("ID 9002"); expect(confirmation).not.toContain("ID 9001");
      await page.getByRole("button", { name: "确认删除三类计划素材（1 个账号）", exact: true }).click();
      await page.waitForFunction(() => (window as any).cleanupRequests.length === 1);
      expect(await page.evaluate(() => (window as any).cleanupRequests[0].accounts[0].plans.map((plan: { adId: string }) => plan.adId))).toEqual(["9002"]);
    } finally { await page.close(); }
  });
  it("preserves an explicit empty cleanup choice and its plan directory after refresh fails", async () => {
    const page = await cleanupFixture();
    try {
      await respond(page);
      await page.getByRole("button", { name: "全选清理计划", exact: true }).click();
      expect(await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).isChecked()).toBe(false);
      expect(await page.getByRole("checkbox", { name: "清理计划 9002", exact: true }).isChecked()).toBe(false);
      await page.getByRole("button", { name: "刷新计划", exact: true }).click();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      expect(await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).isChecked()).toBe(false);
      await page.evaluate(() => (window as any).catalogRequests[1].reject(new Error("Chrome 登录已失效")));
      await page.getByRole("alert").waitFor();
      await page.getByText(/历史目录.*刷新失败/).waitFor();
      expect(await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).isChecked()).toBe(false);
      expect(await page.getByRole("checkbox", { name: "清理计划 9002", exact: true }).isChecked()).toBe(false);
      expect(await page.getByText("已选 0 / 2 个计划", { exact: true }).count()).toBe(1);
    } finally { await page.close(); }
  });
  it("blocks stale confirmation and failed refresh, while account-wide clearing remains explicit", async () => {
    const page = await cleanupFixture();
    try {
      await respond(page);
      await page.getByRole("checkbox", { name: /近15天零展示素材/ }).uncheck();
      await page.getByRole("button", { name: "清理所选计划（2）", exact: true }).click();
      await page.evaluate(() => (window as any).changeCleanupAccount("1001"));
      await page.getByText("账号设置已变化，请取消并重新选择清理范围。", { exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "确认删除三类计划素材（1 个账号）", exact: true }).isDisabled()).toBe(true);
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 2);
      await respond(page);
      await page.getByRole("button", { name: "刷新计划", exact: true }).click();
      await page.waitForFunction(() => (window as any).catalogRequests.length === 3);
      await page.evaluate(() => (window as any).catalogRequests.at(-1).reject(new Error("Chrome 登录已失效")));
      await page.getByText("Chrome 登录已失效", { exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "清理所选计划（2）", exact: true }).isDisabled()).toBe(false);
      expect(await page.getByRole("checkbox", { name: "清理计划 9001", exact: true }).isChecked()).toBe(true);
      await page.getByRole("checkbox", { name: /计划内三类素材/ }).uncheck();
      await page.getByRole("checkbox", { name: /视频库全部视频/ }).check();
      await page.getByRole("button", { name: "清理所选账号（1）", exact: true }).click();
      expect(await page.getByRole("group", { name: "确认素材清理" }).textContent()).toContain("不按计划筛选");
      await page.getByRole("button", { name: "确认删除全部库视频（1 个账号）", exact: true }).click();
      await page.waitForFunction(() => (window as any).cleanupRequests.length === 1);
      expect(await page.evaluate(() => (window as any).cleanupRequests[0])).toEqual({ confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: "眼贴", expectedAdvertiserId: "1001" }] });
    } finally { await page.close(); }
  });
});
