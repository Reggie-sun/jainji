import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { LIBRARY_DELETE_WARNING, QianchuanVideoLibraryPage } from "../src/main/qianchuan-video-library-page";
import { videoLibraryUrl } from "../src/shared/qianchuan-video-library";

let browser: Browser;
const id = "1876024170199244";
vi.setConfig({ testTimeout: 40000, hookTimeout: 30000 });
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); });
afterAll(async () => { await browser?.close(); });
function html(ids: string[], headerId: string, warning: string, delayedSize = false) {
  const fiftyRows = ids.slice(0, 50).map(x => `<tr><td><input type="checkbox"></td><td>ID：${x}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><header>ID：${headerId}</header><input placeholder="请输入视频名称/ID搜索">${"<input placeholder='请选择'>".repeat(6)}
    ${delayedSize ? '<div class="ovui-page-select"><input id="size" class="ovui-select__input" readonly value="20条/页"><div id="fifty" class="ovui-option" style="display:none">50条/页</div></div>' : ''}
    ${ids.length ? `<div class="ovui-page-total">共 ${ids.length} 条记录</div><span class="ovui-page-turner__item--active">1</span>` : '<div class="oc-empty" data-e2e="oc_emptyKey_tools/creative-management/video-library__ocSelect_rolling_load__rollingLoad">暂无数据</div>'}
    <style>.ovui-checkbox__wrapper{position:relative;width:16px;height:16px}.ovui-checkbox__wrapper input{position:absolute;inset:0;margin:0;width:16px;height:16px;opacity:0}.ovui-checkbox__inner{position:absolute;inset:0;background:#ddd}</style>
    <table class="ovui-table"><thead><tr><th><label class="ovui-checkbox"><div class="ovui-checkbox__wrapper"><input id="all" type="checkbox"><div class="ovui-checkbox__inner"></div></div></label></th></tr></thead><tbody>${ids.slice(0,20).map(x=>`<tr><td><input type="checkbox"></td><td>ID：${x}</td></tr>`).join("")}</tbody></table>
    <span id="selected"></span><button id="remove" style="display:none">删除</button><div class="ovui-modal" style="display:none">
    <div>确认要删除该素材吗？</div><div id="warning"></div><button>取消</button><button id="confirm">确认</button></div>
    <script>const count=${Math.min(20,ids.length)};document.querySelector('#all').onchange=e=>{document.querySelectorAll('tbody input').forEach(x=>x.checked=e.target.checked);document.querySelector('#selected').textContent=e.target.checked?'已选'+count+'个':'';document.querySelector('#remove').style.display=e.target.checked?'':'none'};
    document.querySelector('#remove').onclick=()=>{document.querySelector('.ovui-modal').style.display='';document.querySelector('#warning').textContent='已选择 '+count+' 个视频，'+${JSON.stringify(warning)}};
    document.querySelector('#confirm').onclick=async()=>{await fetch('/fixture-delete',{method:'POST'});document.querySelector('.ovui-modal').style.display='none'};
    if(document.querySelector('#size')){document.querySelector('#size').onclick=()=>document.querySelector('#fifty').style.display='';document.querySelector('#fifty').onclick=()=>{document.querySelector('#fifty').style.display='none';document.querySelector('#size').value='50条/页';setTimeout(()=>document.querySelector('tbody').innerHTML=${JSON.stringify(fiftyRows)},300)}};</script>`;
}
async function fixture(options: { count?: number; headerId?: string; warning?: string; delayedSize?: boolean } = {}) {
  const context = await browser.newContext(); const page = await context.newPage();
  let ids = Array.from({length:options.count ?? 25},(_,i)=>`${7000+i}`), confirmations = 0;
  await page.route("https://qianchuan.jinritemai.com/**", async route => {
    if (route.request().method() === "POST") { confirmations++; ids=ids.slice(20); await route.fulfill({body:"ok"}); }
    else await route.fulfill({ contentType:"text/html", body:html(ids, options.headerId ?? id, options.warning ?? LIBRARY_DELETE_WARNING, options.delayedSize) });
  });
  const session = new QianchuanVideoLibraryPage(page, id, new AbortController().signal);
  return { page, context, session, confirmations:()=>confirmations };
}
it("uses the real selectors to select only the current page and scopes confirmation to the verified deletion modal", async () => {
  const f=await fixture();
  try {
    await f.session.open(); const first=await f.session.read(); expect(first.total).toBe(25);
    let persisted=false;
    await f.session.deleteBatch(first,async()=>{persisted=true;expect(f.confirmations()).toBe(0)});
    expect(persisted).toBe(true); expect(f.confirmations()).toBe(1);
    const next=await f.session.refresh(); expect(next).toEqual({total:5,ids:["7020","7021","7022","7023","7024"]});
    await f.session.deleteBatch(next,async()=>{}); expect(await f.session.refresh()).toEqual({total:0,ids:[]});
  } finally { await f.context.close(); }
});
it("waits for the new page after an asynchronous page-size change on both open and refresh", async () => {
  const f = await fixture({ count: 75, delayedSize: true });
  try {
    await f.session.open();
    expect((await f.session.read()).ids).toHaveLength(50);
    expect((await f.session.refresh()).ids).toHaveLength(50);
    expect(f.confirmations()).toBe(0);
  } finally { await f.context.close(); }
});
it("rejects a mismatched visible account even when the URL contains the requested ID", async () => {
  const f=await fixture({headerId:"999"});
  try { await expect(f.session.open()).rejects.toThrow("账号"); expect(f.confirmations()).toBe(0); }
  finally { await f.context.close(); }
});
it("never confirms when durable intent persistence fails", async () => {
  const f=await fixture();
  try { await f.session.open(); await expect(f.session.deleteBatch(await f.session.read(),async()=>{throw new Error("sync failed")})).rejects.toThrow("sync failed"); expect(f.confirmations()).toBe(0); }
  finally { await f.context.close(); }
});
it("rejects a changed warning or filtered list before recording deletion intent", async () => {
  const f=await fixture({warning:"删除会停止在投计划"});
  try {
    await f.session.open(); let called=false;
    await expect(f.session.deleteBatch(await f.session.read(),async()=>{called=true})).rejects.toThrow("页面");
    expect(called).toBe(false); expect(f.confirmations()).toBe(0);
  } finally { await f.context.close(); }
  const g=await fixture();
  try { await g.session.open(); await g.page.getByPlaceholder("请输入视频名称/ID搜索").fill("only one"); await expect(g.session.read()).rejects.toThrow(); expect(g.confirmations()).toBe(0); }
  finally { await g.context.close(); }
});
it("rejects duplicate aavid URLs before reading or selecting", async () => {
  const f=await fixture();
  try { await f.page.goto(videoLibraryUrl(id)+"&aavid="+id); await expect(f.session.read()).rejects.toThrow(); expect(f.confirmations()).toBe(0); }
  finally { await f.context.close(); }
});
