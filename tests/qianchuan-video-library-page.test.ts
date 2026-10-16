import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { LIBRARY_DELETE_WARNING, QianchuanVideoLibraryPage } from "../src/main/qianchuan-video-library-page";
import { videoLibraryUrl } from "../src/shared/qianchuan-video-library";

let browser: Browser;
const id = "1876024170199244";
const listRoute = "/ad/api/creation/material/video-list";
const listUrl = `${listRoute}?aavid=${id}&page=1&pageSize=20&queryString=&source=&tags=&imageModes=&analysisType=&auditStatuses=&materialDeliveryStatus=`;
vi.setConfig({ testTimeout: 40000, hookTimeout: 30000 });
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); });
afterAll(async () => { await browser?.close(); });
function html(ids: string[], headerId: string, warning: string, delayedSize = false, delayedOption = false) {
  const fiftyRows = ids.slice(0, 50).map(x => `<tr><td><input type="checkbox"></td><td>ID：${x}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><header>ID：${headerId}</header><input placeholder="请输入视频名称/ID搜索">${"<input placeholder='请选择'>".repeat(6)}
    ${delayedSize ? '<div class="ovui-page-select"><input id="size" class="ovui-select__input" readonly value="20条/页"><div id="fifty" class="ovui-option" style="display:none">50条/页</div></div>' : ''}
    ${ids.length ? `<div class="ovui-page-total">共 ${ids.length} 条记录</div><span class="ovui-page-turner__item--active">1</span>` : '<div class="oc-empty" data-e2e="oc_emptyKey_tools/creative-management/video-library__ocSelect_rolling_load__rollingLoad">暂无数据</div>'}
    <style>.ovui-checkbox__wrapper{position:relative;width:16px;height:16px}.ovui-checkbox__wrapper input{position:absolute;inset:0;margin:0;width:16px;height:16px;opacity:0}.ovui-checkbox__inner{position:absolute;inset:0;background:#ddd}</style>
    <table class="ovui-table"><thead><tr><th><label class="ovui-checkbox"><div class="ovui-checkbox__wrapper"><input id="all" type="checkbox"><div class="ovui-checkbox__inner"></div></div></label></th></tr></thead><tbody>${ids.slice(0,20).map(x=>`<tr><td><input type="checkbox"></td><td>ID：${x}</td></tr>`).join("")}</tbody></table>
    <span id="selected"></span><button id="remove" style="display:none">删除</button><div class="ovui-modal" style="display:none">
    <div>确认要删除该素材吗？</div><div id="warning"></div><button>取消</button><button id="confirm">确认</button></div>
    <script>fetch(${JSON.stringify(listUrl)});let count=${Math.min(20,ids.length)};document.querySelector('#all').onchange=e=>{document.querySelectorAll('tbody input').forEach(x=>x.checked=e.target.checked);document.querySelector('#selected').textContent=e.target.checked?'已选'+count+'个':'';document.querySelector('#remove').style.display=e.target.checked?'':'none'};
    document.querySelector('#remove').onclick=()=>{document.querySelector('.ovui-modal').style.display='';document.querySelector('#warning').textContent='已选择 '+count+' 个视频，'+${JSON.stringify(warning)}};
    document.querySelector('#confirm').onclick=async()=>{const next=await (await fetch('/fixture-delete',{method:'POST'})).json();document.querySelector('.ovui-modal').style.display='none';count=Math.min(20,next.ids.length);document.querySelector('tbody').innerHTML=next.ids.slice(0,20).map(x=>'<tr><td><input type=checkbox></td><td>ID：'+x+'</td></tr>').join('');document.querySelector('#all').checked=false;document.querySelector('#selected').textContent='';document.querySelector('#remove').style.display='none';if(next.ids.length){document.querySelector('.ovui-page-total').textContent='共 '+next.ids.length+' 条记录'}else{document.querySelector('.ovui-page-total')?.remove();document.querySelector('.ovui-page-turner__item--active')?.remove();const empty=document.createElement('div');empty.className='oc-empty';empty.dataset.e2e='oc_emptyKey_tools/creative-management/video-library__ocSelect_rolling_load__rollingLoad';empty.textContent='暂无数据';document.body.append(empty)}};
    if(document.querySelector('#size')){document.querySelector('#size').onclick=()=>${delayedOption ? "setTimeout(()=>document.querySelector('#fifty').style.display='',120)" : "document.querySelector('#fifty').style.display=''"};document.querySelector('#fifty').onclick=()=>{document.querySelector('#fifty').style.display='none';document.querySelector('#size').value='50条/页';setTimeout(()=>document.querySelector('tbody').innerHTML=${JSON.stringify(fiftyRows)},300)}};</script>`;
}
async function fixture(options: { count?: number; headerId?: string; warning?: string; delayedSize?: boolean; delayedOption?: boolean; failedList?: boolean } = {}) {
  const context = await browser.newContext(); const page = await context.newPage();
  let ids = Array.from({length:options.count ?? 25},(_,i)=>`${7000+i}`), confirmations = 0;
  await page.route("https://qianchuan.jinritemai.com/**", async route => {
    if (new URL(route.request().url()).pathname === listRoute) await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status_code: options.failedList ? 7 : 0, data: { total: String(ids.length) } }) });
    else if (route.request().method() === "POST") { confirmations++; ids=ids.slice(20); await route.fulfill({contentType:"application/json",body:JSON.stringify({ids})}); }
    else await route.fulfill({ contentType:"text/html", body:html(ids, options.headerId ?? id, options.warning ?? LIBRARY_DELETE_WARNING, options.delayedSize, options.delayedOption) });
  });
  const session = new QianchuanVideoLibraryPage(page, id, new AbortController().signal);
  return { page, context, session, confirmations:()=>confirmations };
}
function boundResultWait(page: import("playwright-core").Page) {
  const wait = page.waitForFunction.bind(page);
  vi.spyOn(page, "waitForFunction").mockImplementation((fn, arg, options) => wait(fn, arg, { ...options, timeout: 500 }));
}
async function leaveStaleDeletionList(page: import("playwright-core").Page, retainSelection = false) {
  await page.evaluate(retainSelection => {
    document.querySelector<HTMLButtonElement>("#confirm")!.onclick = async () => {
      await fetch("/fixture-delete", { method: "POST" });
      (document.querySelector(".ovui-modal") as HTMLElement).style.display = "none";
      if (!retainSelection) {
        document.querySelector("#selected")!.textContent = "";
        (document.querySelector("#remove") as HTMLElement).style.display = "none";
      }
    };
  }, retainSelection);
}
function boundSelectionWait(page: import("playwright-core").Page) {
  const getByText = page.getByText.bind(page);
  vi.spyOn(page, "getByText").mockImplementation((text, options) => {
    const locator = getByText(text, options), wait = locator.waitFor.bind(locator);
    vi.spyOn(locator, "waitFor").mockImplementation(options => wait({ ...options, timeout: 500 }));
    return locator;
  });
}
it("returns an initially empty library without changing a retained page-size selector", async () => {
  const f = await fixture({ count: 0, delayedSize: true });
  try {
    boundResultWait(f.page);
    await f.session.open();
    expect(await f.session.read()).toEqual({ total: 0, ids: [] });
    expect(await f.page.locator("#size").inputValue()).toBe("20条/页");
    expect(f.confirmations()).toBe(0);
  } finally { await f.context.close(); }
});
it("consumes an empty final page without changing a page-size selector reset by deletion", async () => {
  const f = await fixture({ count: 2, delayedSize: true });
  try {
    boundResultWait(f.page);
    await f.session.open();
    await f.session.deleteBatch(await f.session.read(), async () => {});
    await f.page.locator("#size").evaluate(node => (node as HTMLInputElement).value = "20条/页");
    boundResultWait(f.page);
    expect(await f.session.refresh()).toEqual({ total: 0, ids: [] });
    expect(await f.page.locator("#size").inputValue()).toBe("20条/页");
    expect(f.confirmations()).toBe(1);
  } finally { await f.context.close(); }
});
it("accepts a verified empty transition while changing page size after a partial final batch", async () => {
  const f = await fixture({ count: 60, delayedSize: true });
  try {
    await f.session.open();
    await f.session.deleteBatch(await f.session.read(), async () => {});
    await f.page.evaluate(() => {
      document.querySelector<HTMLInputElement>("#size")!.value = "20条/页";
      document.querySelector<HTMLElement>("#fifty")!.onclick = () => {
        document.querySelector<HTMLInputElement>("#size")!.value = "50条/页";
        document.querySelector<HTMLElement>("#fifty")!.style.display = "none";
        setTimeout(() => {
          document.querySelector(".ovui-page-total")!.remove();
          document.querySelector(".ovui-page-turner__item--active")!.remove();
          document.querySelector("tbody")!.innerHTML = "";
          const empty = document.createElement("div");
          empty.className = "oc-empty";
          empty.dataset.e2e = "oc_emptyKey_tools/creative-management/video-library__ocTable";
          empty.textContent = "暂无数据";
          document.body.append(empty);
        }, 50);
      };
    });
    boundResultWait(f.page);
    expect(await f.session.refresh()).toEqual({ total: 0, ids: [] });
    expect(f.confirmations()).toBe(1);
  } finally { await f.context.close(); }
});
it("recovers a stale deletion result through one fresh bound list without another confirmation", async () => {
  const f = await fixture({ count: 2 });
  try {
    await f.session.open();
    boundResultWait(f.page);
    await leaveStaleDeletionList(f.page);
    const reload = vi.spyOn(f.page, "reload");
    let intents = 0;
    await f.session.deleteBatch(await f.session.read(), async () => { intents++; });
    expect(await f.session.refresh()).toEqual({ total: 0, ids: [] });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(intents).toBe(1); expect(f.confirmations()).toBe(1);
  } finally { await f.context.close(); }
});
it.each([true, false])("refreshes a retained selection after confirmation and requires actual deletion progress (%s)", async removed => {
  const f = await fixture({ count: 2 });
  try {
    await f.session.open(); boundResultWait(f.page); boundSelectionWait(f.page);
    await leaveStaleDeletionList(f.page, true);
    if (!removed) await f.page.route("**/fixture-delete", route => route.fulfill({ body: "{}" }));
    const reload = vi.spyOn(f.page, "reload");
    let intents = 0, confirmations = 0;
    f.page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/fixture-delete") confirmations++; });
    const deletion = f.session.deleteBatch(await f.session.read(), async () => { intents++; });
    if (removed) {
      await deletion;
      expect(await f.session.refresh()).toEqual({ total: 0, ids: [] });
    } else {
      await expect(deletion).rejects.toThrow("刷新仍未观察到");
      expect(await f.session.read()).toEqual({ total: 2, ids: ["7000", "7001"] });
    }
    expect(reload).toHaveBeenCalledTimes(1);
    expect(intents).toBe(1); expect(confirmations).toBe(1);
  } finally { await f.context.close(); }
});
it.each(["display:none", "visibility:hidden"])("ignores a %s old table when the final visible list is empty", async hidden => {
  const f = await fixture({ count: 2 });
  try {
    await f.session.open();
    boundResultWait(f.page);
    await f.page.evaluate(hidden => {
      document.querySelector<HTMLButtonElement>("#confirm")!.onclick = async () => {
        await fetch("/fixture-delete", { method: "POST" });
        document.querySelector<HTMLElement>(".ovui-modal")!.style.display = "none";
        document.querySelector("#selected")!.textContent = "";
        const old = document.querySelector("table")!;
        old.setAttribute("style", hidden);
        const table = document.createElement("table");
        table.className = "ovui-table"; table.innerHTML = "<tbody></tbody>";
        document.body.append(table);
        document.querySelector(".ovui-page-total")!.remove();
        document.querySelector(".ovui-page-turner__item--active")!.remove();
        const empty = document.createElement("div");
        empty.className = "oc-empty";
        empty.dataset.e2e = "oc_emptyKey_tools/creative-management/video-library__ocTable";
        empty.textContent = "暂无数据"; document.body.append(empty);
      };
    }, hidden);
    const reload = vi.spyOn(f.page, "reload");
    await f.session.deleteBatch(await f.session.read(), async () => {});
    expect(await f.session.refresh()).toEqual({ total: 0, ids: [] });
    expect(reload).not.toHaveBeenCalled(); expect(f.confirmations()).toBe(1);
  } finally { await f.context.close(); }
});
it("stops after one readonly refresh when the platform has not removed the final videos", async () => {
  const f = await fixture({ count: 2 });
  try {
    await f.session.open();
    boundResultWait(f.page);
    await leaveStaleDeletionList(f.page);
    let confirmations = 0;
    await f.page.route("**/fixture-delete", async route => { confirmations++; await route.fulfill({ body: "{}" }); });
    const reload = vi.spyOn(f.page, "reload");
    await expect(f.session.deleteBatch(await f.session.read(), async () => {})).rejects.toThrow("刷新仍未观察到");
    expect(reload).toHaveBeenCalledTimes(1); expect(confirmations).toBe(1);
    expect(await f.session.read()).toEqual({ total: 2, ids: ["7000", "7001"] });
  } finally { await f.context.close(); }
});
it("rejects a failed fresh list response after a deletion timeout without confirming again", async () => {
  const f = await fixture({ count: 2 });
  try {
    await f.session.open();
    boundResultWait(f.page);
    await leaveStaleDeletionList(f.page);
    await f.page.route(`**${listRoute}?**`, route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status_code: 7, data: { total: "0" } }) }));
    const reload = vi.spyOn(f.page, "reload");
    await expect(f.session.deleteBatch(await f.session.read(), async () => {})).rejects.toThrow("无法核对");
    expect(reload).toHaveBeenCalledTimes(1); expect(f.confirmations()).toBe(1);
  } finally { await f.context.close(); }
});
it.each(["filter", "account", "document", "cancel"])("does not reload or confirm again after %s drift during deletion observation", async drift => {
  const f = await fixture({ count: 2 });
  const controller = new AbortController();
  const session = new QianchuanVideoLibraryPage(f.page, id, controller.signal);
  try {
    await session.open();
    boundResultWait(f.page);
    await leaveStaleDeletionList(f.page);
    const reload = vi.spyOn(f.page, "reload"), pause = f.page.waitForTimeout.bind(f.page);
    vi.spyOn(f.page, "waitForTimeout").mockImplementationOnce(async ms => {
      if (drift === "cancel") controller.abort();
      else if (drift === "document") await f.page.goto(videoLibraryUrl(id));
      else await f.page.evaluate(drift => {
        if (drift === "filter") document.querySelector<HTMLInputElement>('input[placeholder="请选择"]')!.value = "筛选";
        else document.querySelector("header")!.textContent = "ID：9999";
      }, drift);
      await pause(ms);
    });
    await expect(session.deleteBatch(await session.read(), async () => {})).rejects.toThrow();
    expect(reload).not.toHaveBeenCalled(); expect(f.confirmations()).toBe(1);
  } finally { await f.context.close(); }
});
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
it("waits for a delayed page-size option before requiring its uniqueness", async () => {
  const f = await fixture({ count: 75, delayedSize: true, delayedOption: true });
  try {
    await f.session.open();
    expect((await f.session.refresh()).ids).toHaveLength(50);
    expect(f.confirmations()).toBe(0);
  } finally { await f.context.close(); }
});
it("continues a shrinking last page without waiting for an earlier total when page size is already 50", async () => {
  const f = await fixture({ count: 60, delayedSize: true });
  try {
    await f.session.open();
    await f.session.deleteBatch(await f.session.read(), async () => {});
    const read = f.session.read.bind(f.session);
    vi.spyOn(f.session, "read").mockImplementationOnce(async () => {
      const before = await read();
      await f.page.evaluate(() => {
        document.querySelector(".ovui-page-total")!.textContent = "共 21 条记录";
        document.querySelector("tbody")!.innerHTML = Array.from({ length: 21 }, (_, i) =>
          `<tr><td><input type="checkbox"></td><td>ID：${7020 + i}</td></tr>`).join("");
      });
      return before;
    });
    const next = await f.session.refresh();
    expect(next.total).toBe(21); expect(next.ids).toHaveLength(21);
    expect(f.confirmations()).toBe(1);
  } finally { await f.context.close(); }
});
it("does not accept a loading empty table before the bound unfiltered list response and rows arrive", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  await page.route("https://qianchuan.jinritemai.com/**", async route => {
    if (new URL(route.request().url()).pathname === listRoute) {
      await new Promise(resolve => setTimeout(resolve, 150));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status_code: 0, data: { total: "25" } }) });
    } else {
      const body = html(Array.from({ length: 25 }, (_, i) => String(7000 + i)), id, LIBRARY_DELETE_WARNING) + `<script>
      const footer=document.querySelector('.ovui-page-total'),active=document.querySelector('.ovui-page-turner__item--active'),rows=document.querySelector('tbody').innerHTML;
      footer.remove();active.remove();document.querySelector('tbody').innerHTML='';
      const empty=document.createElement('div');empty.className='oc-empty';empty.dataset.e2e='oc_emptyKey_tools/creative-management/video-library__ocSelect_rolling_load__rollingLoad';empty.textContent='暂无数据';document.body.append(empty);
      setTimeout(()=>{empty.remove();document.body.append(footer,active);document.querySelector('tbody').innerHTML=rows},350);</script>`;
      await route.fulfill({ contentType: "text/html", body });
    }
  });
  try {
    const session = new QianchuanVideoLibraryPage(page, id, new AbortController().signal);
    await session.open(); expect((await session.read()).total).toBe(25);
  } finally { await context.close(); }
});
it("refuses a failed list response instead of interpreting its visible empty table as a cleared library", async () => {
  const f = await fixture({ count: 0, failedList: true });
  try { await expect(f.session.open()).rejects.toThrow(); expect(f.confirmations()).toBe(0); }
  finally { await f.context.close(); }
});
it("ignores a matching response from the old document before the new navigation commits", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  const ids = Array.from({ length: 25 }, (_, i) => String(7000 + i));
  let initial = true;
  await page.route("https://qianchuan.jinritemai.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === listRoute) {
      if (!url.searchParams.has("old")) await new Promise(resolve => setTimeout(resolve, 150));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status_code: 0, data: { total: url.searchParams.has("old") ? "0" : "25" } }) });
    } else if (initial) { initial = false; await route.fulfill({ contentType: "text/html", body: "<!doctype html>old document" }); }
    else await route.fulfill({ contentType: "text/html", body: html(ids, id, LIBRARY_DELETE_WARNING) + `<script>
      const footer=document.querySelector('.ovui-page-total'),active=document.querySelector('.ovui-page-turner__item--active'),rows=document.querySelector('tbody').innerHTML;
      footer.remove();active.remove();document.querySelector('tbody').innerHTML='';
      const empty=document.createElement('div');empty.className='oc-empty';empty.dataset.e2e='oc_emptyKey_tools/creative-management/video-library__ocTable';empty.textContent='暂无数据';document.body.append(empty);
      setTimeout(()=>{empty.remove();document.body.append(footer,active);document.querySelector('tbody').innerHTML=rows},350);</script>` });
  });
  await page.goto(videoLibraryUrl(id));
  const reload = page.reload.bind(page);
  const navigation = vi.spyOn(page, "reload").mockImplementationOnce(async options => {
    await page.evaluate(async url => { await (await fetch(url)).json(); }, listUrl + "&old=1");
    return reload(options);
  });
  try {
    const session = new QianchuanVideoLibraryPage(page, id, new AbortController().signal);
    await session.open(); expect((await session.read()).total).toBe(25);
  } finally { navigation.mockRestore(); await context.close(); }
});
it("reloads an existing matching library page while preserving its URL and rejects a moved tab", async () => {
  const f = await fixture();
  try {
    await f.page.goto(videoLibraryUrl(id) + "&x_tt_random=123");
    const navigate = vi.spyOn(f.page, "goto"), reload = vi.spyOn(f.page, "reload");
    await f.session.open();
    expect(navigate).not.toHaveBeenCalled(); expect(reload).toHaveBeenCalledTimes(1);
    expect(f.page.url()).toBe(videoLibraryUrl(id) + "&x_tt_random=123");
    await f.page.goto("https://qianchuan.jinritemai.com/uni-prom?aavid=" + id);
    await expect(f.session.open()).rejects.toThrow("页面");
    expect(reload).toHaveBeenCalledTimes(1); expect(f.confirmations()).toBe(0);
    navigate.mockRestore(); reload.mockRestore();
  } finally { await f.context.close(); }
});
it("invalidates response evidence when the same library URL loads a new document", async () => {
  const f = await fixture({ count: 0 });
  try {
    await f.session.open(); expect(await f.session.read()).toEqual({ total: 0, ids: [] });
    await f.page.reload();
    await expect(f.session.read()).rejects.toThrow("页面");
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
