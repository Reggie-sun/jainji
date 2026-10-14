import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });
async function fixture(width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const script = buildSync({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QianchuanEffectLoop}from'./src/renderer/QianchuanEffectLoop';import{QIANCHUAN_QUERY_METRICS}from'./src/shared/qianchuan-backend';
    const advertiserId='1879999999999999999',adId='1878754135410692',batch='d2222222-2222-4222-8222-222222222222',at='2026-10-15T02:00:00.000Z';
    const base={project_id:'d1111111-1111-4111-8111-111111111111',batch_id:batch,export_task_id:'d4444444-4444-4444-8444-444444444444',upload_task_id:'a'.repeat(64),artifact_sha256:'b'.repeat(64),file_name:'same-name.mp4',accountProduct:'眼贴',advertiserId,adId,state:'ACCEPTED',upload_outcome:'ACCEPTED',retryable:false,retry_count:0,attempt_count:1,timestamp:at,acceptedEvidence:{advertiserId,adId,fileName:'same-name.mp4',selectedCount:1,observedAt:at,pageOwnership:{targetId:'target-1',pageBatchId:batch,modalSessionId:'d3333333-3333-4333-8333-333333333333'},platformVideoId:'video-1',attempt:1,requestSha256:'c'.repeat(64),responseSha256:'d'.repeat(64)}};
    const tasks=[base,{...base,upload_task_id:'e'.repeat(64),state:'NEEDS_HUMAN',upload_outcome:'MAY_HAVE_UPLOADED',acceptedEvidence:undefined}];
    window.reads=[];window.cancels=[];window.pending=[];window.delay=false;window.bad=false;window.production=0;window.nav=[];
    const result=q=>({kind:'materials',advertiserId:window.bad?'999':q.expectedAdvertiserId,adId:q.adId,observedAt:q.asOf,startTime:q.startDate+' 00:00:00',endTime:[q.endDate+' 23:59:59',new Date(Date.parse(q.asOf)+8*3600000).toISOString().slice(0,19).replace('T',' ')].sort()[0],offset:q.offset,limit:q.limit,total:101,rows:Array.from({length:q.offset?1:100},(_,i)=>({materialId:String(7696527003390771254n+BigInt(q.offset+i)),videoId:q.offset?'video-1':'other-'+i,name:'same-name.mp4',metrics:Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(k=>[k,{value:'12.34',display:'12.34'}]))}))});
    window.jianji={queryQianchuanBackend:async q=>{window.reads.push(q);if(window.delay)return new Promise(resolve=>window.pending.push(()=>resolve(result(q))));return result(q);},cancelQianchuanBackendQuery:async q=>window.cancels.push(q)};
    function Fixture(){const[active,setActive]=useState(true),[advertiser,setAdvertiser]=useState(advertiserId);window.hide=()=>setActive(false);window.rebind=()=>setAdvertiser('999');return <><p>隔离测试数据</p><QianchuanEffectLoop state={{douyinUpload:{tasks,accounts:[{product:'眼贴',advertiserId:advertiser,available:true}]}}} active={active} onNavigate={p=>window.nav.push(p)} onProduction={()=>window.production++}/></>;}createRoot(document.getElementById('root')).render(<Fixture/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" } }).outputFiles[0]!.text;
  await page.route("http://127.0.0.1:3000/effects", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta charset="utf-8"><style>${readFileSync("src/renderer/qianchuan-backend.css", "utf8")}body{margin:12px}select,input{max-width:100%;box-sizing:border-box}</style><div id="root"></div>` }));
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
