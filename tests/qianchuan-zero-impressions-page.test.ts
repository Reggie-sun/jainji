import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { QianchuanPlanMaterialPage } from "../src/main/qianchuan-plan-material-page";
import { QianchuanPlanMaterials } from "../src/main/qianchuan-plan-materials";
import { createZeroImpressionsWindow } from "../src/main/qianchuan-zero-impressions";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";

const target = { product: "蝴蝶贴", advertiserId: "1234", adId: "5678", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) } as FrozenQianchuanAccount;
let browser: Browser;
vi.setConfig({ testTimeout: 40000, hookTimeout: 30000 });
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); });
afterAll(async () => { await browser?.close(); });

async function fixture(options: { noInitialCandidates?: boolean; noCreationTime?: boolean; empty?: boolean; badDelivery?: string; badDeliveryRow?: string; badDate?: boolean; missingMetric?: boolean; extraTitle?: boolean; extraDeletion?: boolean; wrongAccount?: boolean; unknownOutcome?: boolean; emptyNextPage?: boolean } = {}) {
  const context = await browser.newContext(), page = await context.newPage();
  const window = createZeroImpressionsWindow();
  const fresh = new Date(Date.now() + 8 * 3600000 - 3600000).toISOString().slice(0, 19).replace("T", " ");
  let data = [
    { id: "11", count: 3, time: "2025-01-01 00:00:00" }, { id: "12", count: 0, time: fresh },
    { id: "13", count: 0, time: "2025-01-01 00:00:00" }, { id: "14", count: 7, time: "2025-01-01 00:00:00" },
    { id: "15", count: 0, time: "2025-01-01 00:00:00" }, { id: "16", count: 0, time: fresh },
    { id: "17", count: 0, time: "2025-01-01 00:00:00" },
  ];
  if (options.noInitialCandidates) data[1].count = 1;
  const protectedIds: string[] = [];
  data = data.flatMap((row, index) => index % 2 ? [row, ...Array.from({ length: 98 }, (_, i) => { const id = String(1000 + index * 100 + i); protectedIds.push(id); return { id, count: 1, time: "2025-01-01 00:00:00" }; })] : [row]);
  if (options.empty) data = [];
  const removed: string[][] = [], offsets: number[] = [];
  const html = `<!doctype html><meta charset="utf-8"><div class="account-info-container">ID：${options.wrongAccount ? "9999" : target.advertiserId}</div>
  <div class="ovui-drawer--no-maskable"><div class="ad-drawer-body">计划 ID：${target.adId}
  <input placeholder="请选择开始日期" value="${window.startTime.slice(0, 10)}"><input placeholder="请选择结束日期" value="${window.endTime.slice(0, 10)}">
  <input placeholder="输入视频名称/ID后回车搜索"><button id="filter">更多筛选</button>
  <div class="ovui-popover" style="display:none"><button id="clear">清空</button><div class="config-area" id="delivery"><div class="oc-title">投放状态</div><input placeholder="请选择" value="已删除" readonly><li class="ovui-cascader-panel__selection-item"><div class="ovui-cascader-panel__item-label">投放中</div></li></div><button id="apply">确定</button></div>
  <div class="ovui-page-select"><input value="10条/页" readonly></div><div class="ovui-option" style="display:none">100条/页</div><div class="ovui-table__head-wrapper"><table><thead><tr><th><input type="checkbox" id="all"></th><th>视频</th>${options.noCreationTime ? "" : "<th>创建时间</th>"}<th>整体展示次数</th></tr></thead></table></div>
  <div class="ovui-table__body-wrapper"><table><tbody></tbody></table></div><div id="footer"></div><div id="selection"></div><button id="remove">删除</button>
  </div></div><div class="ovui-modal" style="display:none">确定要删除视频吗？<button id="cancel">取消</button><button id="confirm">确定</button></div>
  <script>
    let pageSize=10;
    document.querySelector('.ovui-page-select input').onclick=()=>document.querySelector('.ovui-option').style.display='';
    document.querySelector('.ovui-option').onclick=()=>{pageSize=100;document.querySelector('.ovui-page-select input').value='100条/页';document.querySelector('.ovui-option').style.display='none';list()};
    setTimeout(()=>{document.querySelector('#delivery .ovui-cascader-panel__item-label').onclick=()=>document.querySelector('#delivery input').value='投放中'},0);

  let offset=0,total=0,shown=[];
  const selected=()=>Array.from(document.querySelectorAll('tbody input:checked')).map(x=>x.dataset.id);
  function selection(){document.querySelector('#selection').textContent='已选'+selected().length+'个 视频'}
  async function list(){
    const expected={query_type:['all'],roi2_material_type_v3:['1001'],marketing_goal:['1'],ad_id:['${target.adId}'],roi2_material_video_type:['11'],roi2_material_status:[${options.badDelivery ? JSON.stringify(options.badDelivery) : "document.querySelector('#delivery input').value==='投放中'?'1':'2'"}]};
    const body={DataSetKey:'site_promotion_product_post_data_video',StartTime:'${options.badDate ? "2026-01-01 00:00:00" : window.startTime}',EndTime:'${window.endTime}',Metrics:['product_show_count_for_roi2'],Dimensions:['material_id'${options.noCreationTime ? "" : ",'roi2_material_upload_time'"}],PageParams:{Offset:offset,Limit:pageSize},Filters:{ConditionRelationshipType:1,Conditions:Object.entries(expected).map(([Field,Values])=>({Field,Values,Operator:7}))}};
    const r=await fetch('/ad/api/pmc/v1/uni-promotion/material/list-required?aavid=${target.advertiserId}',{method:'POST',body:JSON.stringify(body)});const b=await r.json();total=Number(b.data.statsData.totalCount??0);shown=b.data.statsData.rows??[];const pager=document.querySelector('.ovui-page-select');if(pager)pager.style.display=total?'':'none';
    document.querySelector('tbody').innerHTML=shown.map(x=>'<tr><td><input type="checkbox" data-id="'+x.id+'"></td><td>素材ID: '+x.id+'</td>${options.noCreationTime ? "" : "<td>'+x.time+'</td>"}<td>'+x.count+'</td></tr>').join('');
    document.querySelectorAll('tbody input').forEach(x=>x.onchange=selection);document.querySelector('#all').checked=false;selection();
    document.querySelector('#footer').innerHTML=total?'<div class="ovui-page-total">共 '+total+' 条记录</div><ul><li class="ovui-page-turner__item" id="first">1</li><li class="ovui-page-turner__item--active">'+(offset/pageSize+1)+'</li><li class="ovui-page-turner__item" id="next"><div class="ovui-page-turner__next-icon">next</div></li></ul>':'<div class="oc-empty">暂无数据</div>';
    if(total){document.querySelector('#first').onclick=()=>{offset=0;list()};document.querySelector('#next').onclick=()=>{offset+=pageSize;list()}}
  }
  document.querySelector('#filter').onclick=()=>document.querySelector('.ovui-popover').style.display='';
  document.querySelector('#apply').onclick=()=>{document.querySelector('.ovui-popover').style.display='none';list()};
  document.querySelector('#all').onclick=()=>{document.querySelectorAll('tbody input').forEach(x=>x.checked=true);selection()};
  document.querySelector('#remove').onclick=()=>document.querySelector('.ovui-modal').style.display='';
  document.querySelector('#confirm').onclick=async()=>{await fetch('/fixture-delete',{method:'POST',body:JSON.stringify(selected())});
  ${options.extraTitle ? "document.querySelector('.ovui-modal').innerHTML='确定要删除自选视频吗？需要同步删除以下1个自选标题<button>确定</button>'" : "document.querySelector('.ovui-modal').style.display='none'; offset=0; await list()"}};
  </script>`;
  await page.route("https://qianchuan.jinritemai.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("list-required")) {
      const { Offset: offset, Limit: limit } = route.request().postDataJSON().PageParams; offsets.push(offset);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status_code: 0, data: { statsData: data.length && !(options.emptyNextPage && offset > 0) ? { totalCount: String(data.length), rows: data.slice(offset, offset + limit).map(x => ({ ...x,
        dimensions: { materialId: { value: x.id }, roi2MaterialStatus: { value: options.badDeliveryRow ?? "1" }, ...(options.noCreationTime ? {} : { roi2MaterialUploadTime: { value: x.time } }) },
        metrics: options.missingMetric ? {} : { productShowCountForRoi2: { value: x.count, valueStr: String(x.count) } },
      })) } : {} } }) });
    } else if (url.pathname === "/fixture-delete") {
      const ids: string[] = route.request().postDataJSON(); removed.push(ids);
      if (!options.extraTitle && !options.unknownOutcome) data = data.filter(x => !ids.includes(x.id) && !(options.extraDeletion && x.id === "11"));
      await route.fulfill({ body: "{}" });
    } else await route.fulfill({ contentType: "text/html", body: html });
  });
  const session = new QianchuanPlanMaterialPage(page, target, new AbortController().signal, window);
  return { page, context, session, removed, offsets, remaining: () => data.filter(x => !protectedIds.includes(x.id)).map(x => x.id) };
}

it.each([false, true])("scans thirty-day uneven pages including fresh zero rows without requiring creation time: %s", async noCreationTime => {
  const f = await fixture({ noCreationTime }), root = await mkdtemp(path.join(tmpdir(), "zero-cleanup-"));
  try {
    const owner = new QianchuanPlanMaterials(root, async () => ({ page: f.session, close: () => f.session.dispose() }));
    const result = await owner.clear(target, async () => {}, undefined, "ZERO_IMPRESSIONS_30D");
    expect(result, JSON.stringify({ result, offsets: f.offsets, removed: f.removed })).toMatchObject({ state: "CLEARED", deletedCount: 5 });
    const range = JSON.parse(new URLSearchParams(new URL(f.page.url()).hash.slice(1)).get("adr")!).dateRange;
    expect(range).toEqual([createZeroImpressionsWindow().startTime.slice(0, 10), createZeroImpressionsWindow().endTime.slice(0, 10)]);
    expect(f.removed.flat()).toEqual(["12", "13", "15", "16", "17"]); expect(f.remaining()).toEqual(["11", "14"]);
    expect(f.offsets.filter(offset => offset === 0).length).toBeGreaterThan(1); expect(f.offsets).toContain(100);
    expect((await readdir(path.join(root, "plan-material-deletions"))).some(name => name.endsWith("pending.json"))).toBe(false);
  } finally { await f.context.close(); await rm(root, { recursive: true, force: true }); }
});
it.each([{ badDate: true }, { missingMetric: true }, { wrongAccount: true }])("refuses unbound dates, absent counts and wrong account before deletion %j", async options => {
  const f = await fixture(options);
  try { await expect((async () => { await f.session.open(); await f.session.filter(); })()).rejects.toThrow(); expect(f.removed).toEqual([]); }
  finally { await f.session.dispose(); await f.context.close(); }
});
it("does not report completion when a later platform page unexpectedly becomes empty", async () => {
  const f = await fixture({ emptyNextPage: true, noInitialCandidates: true }), root = await mkdtemp(path.join(tmpdir(), "zero-empty-"));
  try {
    const owner = new QianchuanPlanMaterials(root, async () => ({ page: f.session, close: () => f.session.dispose() }));
    expect(await owner.clear(target, async () => {}, undefined, "ZERO_IMPRESSIONS_30D")).toMatchObject({ state: "BLOCKED", deletedCount: 0 });
    expect(f.offsets).toEqual([0, 0, 100]); expect(f.removed).toEqual([]);
  } finally { await f.context.close(); await rm(root, { recursive: true, force: true }); }
});
it("a page with no candidates advances, while changed date or foreign selection prevents confirmation", async () => {
  const f = await fixture({ noInitialCandidates: true });
  try {
    await f.session.open(); await f.session.filter(); expect((await f.session.read()).ids).toEqual([]);
    await f.session.movePage(); const before = await f.session.read(); expect(before.ids).toEqual(["13"]);
    await f.page.locator('tbody input[data-id="14"]').check();
    await expect(f.session.deleteBatch(before, async () => {})).rejects.toThrow();
    await f.page.locator('tbody input[data-id="14"]').uncheck();
    await f.page.getByPlaceholder("请选择开始日期").fill("2026-01-01");
    await expect(f.session.deleteBatch(before, async () => {})).rejects.toThrow(); expect(f.removed).toEqual([]);
  } finally { await f.session.dispose(); await f.context.close(); }
});
it("retains the shared pending fence on an expanded title-deletion confirmation without confirming again", async () => {
  const f = await fixture({ extraTitle: true }), root = await mkdtemp(path.join(tmpdir(), "zero-unknown-"));
  const connect = vi.fn(async () => ({ page: f.session, close: () => f.session.dispose() }));
  try {
    const owner = new QianchuanPlanMaterials(root, connect);
    expect(await owner.clear(target, async () => {}, undefined, "ZERO_IMPRESSIONS_30D")).toMatchObject({ state: "BLOCKED", deletedCount: 0 });
    const gate = path.join(root, "plan-material-deletions", `${target.advertiserId}-${target.adId}.pending.json`), bytes = await readFile(gate);
    expect(f.removed).toEqual([["12"]]);
    expect((await owner.clear(target, async () => {})).state).toBe("BLOCKED"); expect(connect).toHaveBeenCalledTimes(1); expect(await readFile(gate)).toEqual(bytes);
  } finally { await f.context.close(); await rm(root, { recursive: true, force: true }); }
});
it.each([{ extraDeletion: true }, { unknownOutcome: true }])("keeps pending intent when observed removal differs from the selected IDs: %j", async options => {
  const f = await fixture(options), root = await mkdtemp(path.join(tmpdir(), "zero-unknown-"));
  try {
    const owner = new QianchuanPlanMaterials(root, async () => ({ page: f.session, close: () => f.session.dispose() }));
    expect(await owner.clear(target, async () => {}, undefined, "ZERO_IMPRESSIONS_30D")).toMatchObject({ state: "BLOCKED", deletedCount: 0 });
    expect(f.removed).toEqual([["12"]]);
    const intent = JSON.parse(await readFile(path.join(root, "plan-material-deletions", `${target.advertiserId}-${target.adId}.pending.json`), "utf8"));
    expect(intent).toMatchObject({ ids: ["12"], zeroWindow: { startTime: createZeroImpressionsWindow().startTime } });
  } finally { await f.context.close(); await rm(root, { recursive: true, force: true }); }
});

it.each([{ badDelivery: "2" }, { badDelivery: "3" }, { badDelivery: "4" }, { badDeliveryRow: "2" }, { badDeliveryRow: "" }])("rejects non-delivering request or response before selection %j", async options => {
  const f = await fixture(options);
  try { await f.session.open(); await expect(f.session.filter()).rejects.toThrow(); expect(f.removed).toEqual([]); }
  finally { await f.session.dispose(); await f.context.close(); }
});
it.each(["delivery", "pager", "drift"])("rejects missing delivery/pager controls or page-size drift: %s", async mode => {
  const f = await fixture();
  try {
    await f.session.open();
    if (mode === "drift") {
      await f.session.filter(); const before = await f.session.read();
      await f.page.locator('.ovui-page-select input').evaluate(node => { (node as HTMLInputElement).value = "10条/页"; });
      await expect(f.session.deleteBatch(before, async () => {})).rejects.toThrow();
    } else {
      await f.page.locator(mode === "delivery" ? "#delivery .oc-title" : ".ovui-page-select").evaluate(node => node.remove());
      await expect(f.session.filter()).rejects.toThrow();
    }
    expect(f.removed).toEqual([]);
  } finally { await f.session.dispose(); await f.context.close(); }
});

it("finishes an empty delivering plan without a pagination control", async () => {
  const f = await fixture({ empty: true }), root = await mkdtemp(path.join(tmpdir(), "zero-empty-plan-"));
  try {
    const owner = new QianchuanPlanMaterials(root, async () => ({ page: f.session, close: () => f.session.dispose() }));
    expect(await owner.clear(target, async () => {}, undefined, "ZERO_IMPRESSIONS_30D")).toMatchObject({ state: "CLEARED", deletedCount: 0 });
    expect(f.removed).toEqual([]);
  } finally { await f.context.close(); await rm(root, { recursive: true, force: true }); }
});
