import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { QianchuanPlanMaterials } from "../src/main/qianchuan-plan-materials";
import { QianchuanPlanMaterialPage } from "../src/main/qianchuan-plan-material-page";
import { PLAN_MATERIAL_STATUSES, matchesPlanMaterialStatus } from "../src/shared/qianchuan-video-library";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";

const target = { product: "蝴蝶贴", advertiserId: "1876024170199244", adId: "123", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) } as FrozenQianchuanAccount;
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it("distinguishes plain approval and unreviewed material from exactly the three cleanup states", () => {
  for (const text of ["审核通过", "未审核", "审核通过\n审核建议", "生态审核不通过\n可优化"]) {
    expect(matchesPlanMaterialStatus(text, "审核通过可优化")).toBe(false);
  }
  expect(matchesPlanMaterialStatus("审核通过\n可优化\n审核建议", "审核通过可优化")).toBe(true);
  expect(matchesPlanMaterialStatus("生态审核不通过\n生态建议", "审核不通过")).toBe(false);
});
async function ownerFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "plan-cleanup-")); roots.push(root);
  let ids = ["7001", "7002", "7003"];
  const snapshot = () => ({ total: ids.length, ids: ids.slice(0, 2) });
  const gate = path.join(root, "plan-material-deletions", `${target.advertiserId}-${target.adId}.pending.json`);
  const page = { open: vi.fn(async () => {}), filter: vi.fn(async () => ({ skippedEcological: false })), read: vi.fn(async () => snapshot()),
    deleteBatch: vi.fn(async (before: ReturnType<typeof snapshot>, confirm: () => Promise<void>) => {
      await confirm(); expect(JSON.parse(await readFile(gate, "utf8"))).toMatchObject({ adId: target.adId, ids: before.ids });
      ids = ids.filter(id => !before.ids.includes(id));
    }) };
  const connect = vi.fn(async () => ({ page, close: async () => {} }));
  return { root, gate, page, connect, owner: new QianchuanPlanMaterials(root, connect) };
}
it("persists each plan-bound intent before confirmation and uses only one combined filter for multiple pages", async () => {
  const f = await ownerFixture();
  expect(await f.owner.clear(target, async () => {})).toMatchObject({ state: "CLEARED", deletedCount: 3 });
  expect(f.page.filter).toHaveBeenCalledTimes(1); expect(f.page.deleteBatch).toHaveBeenCalledTimes(2);
  expect((await readdir(path.join(f.root, "plan-material-deletions"))).some(name => name.endsWith(".pending.json"))).toBe(false);
});
it.each([false, true])("runs both rules sequentially over remaining materials and retains progress if zero cleanup fails: %s", async failZero => {
  const root = await mkdtemp(path.join(tmpdir(), "combined-cleanup-")); roots.push(root);
  let remaining = ["7001", "7002", "7003"];
  const modes: boolean[] = [], removed: string[] = [];
  const connect = vi.fn(async (_target, _signal, window) => {
    const zero = !!window; modes.push(zero);
    // 7002 belongs to both predicates; the second query must see only what remains.
    const eligible = () => remaining.filter(id => zero ? id !== "7001" : id !== "7003");
    const read = async () => ({ total: eligible().length, ids: eligible(), ...(zero ? { zeroImpressions: { offset: 0, limit: 10,
      rows: eligible().map(id => ({ id, impressions: 0, createdAt: "2025-01-01 00:00:00", eligible: true })) } } : {}) });
    return { page: { open: async () => {}, filter: async () => ({ skippedEcological: false }), read, movePage: async () => false,
      deleteBatch: async (before: Awaited<ReturnType<typeof read>>, confirm: () => Promise<void>) => {
        await confirm();
        if (zero && failZero) throw new Error("zero result unknown");
        removed.push(...before.ids); remaining = remaining.filter(id => !before.ids.includes(id));
      } }, close: async () => {} };
  });
  const owner = new QianchuanPlanMaterials(root, connect);
  expect(await owner.clear(target, async () => {}, undefined, "AUDIT_AND_ZERO_IMPRESSIONS_15D")).toMatchObject({ state: failZero ? "BLOCKED" : "CLEARED", deletedCount: failZero ? 2 : 3 });
  expect(modes).toEqual([false, true]); expect(removed).toEqual(failZero ? ["7001", "7002"] : ["7001", "7002", "7003"]);
  if (failZero) {
    expect((await owner.clear(target, async () => {}, undefined, "AUDIT_AND_ZERO_IMPRESSIONS_15D")).state).toBe("BLOCKED");
    expect(connect).toHaveBeenCalledTimes(3);
  }
});
it("does not enter the second rule when the first rule has an unknown outcome", async () => {
  const f = await ownerFixture();
  f.page.deleteBatch.mockImplementationOnce(async (_before, confirm) => { await confirm(); throw new Error("response lost"); });
  expect((await f.owner.clear(target, async () => {}, undefined, "AUDIT_AND_ZERO_IMPRESSIONS_15D")).state).toBe("BLOCKED");
  expect(f.connect).toHaveBeenCalledTimes(1); expect(await readFile(f.gate, "utf8")).toContain("7001");
});
it("keeps an unknown deletion intent and refuses confirmation on a later explicit call or a new owner", async () => {
  const f = await ownerFixture();
  f.page.deleteBatch.mockImplementationOnce(async (_before, confirm) => { await confirm(); throw new Error("response lost"); });
  expect((await f.owner.clear(target, async () => {})).state).toBe("BLOCKED");
  const bytes = await readFile(f.gate);
  expect((await new QianchuanPlanMaterials(f.root, f.connect).clear(target, async () => {})).state).toBe("BLOCKED");
  expect(f.connect).toHaveBeenCalledTimes(2); expect(f.page.deleteBatch).toHaveBeenCalledTimes(1); expect(await readFile(f.gate)).toEqual(bytes);
});
it.each([
  { startTime: "2026-09-30 00:00:00", endTime: "2026-10-06 23:59:59", createdBefore: "2026-10-05 16:00:00" },
  { startTime: "2026-09-08 00:00:00", endTime: "2026-10-07 23:59:59" },
])("preserves a legacy pending intent when the connection lacks isolation support: %j", async zeroWindow => {
  const f = await ownerFixture();
  await mkdir(path.dirname(f.gate), { recursive: true, mode: 0o700 });
  const bytes = JSON.stringify({ version: 1, attempt: "11111111-1111-4111-8111-111111111111", advertiserId: target.advertiserId, adId: target.adId, ids: ["7001"], zeroWindow });
  await writeFile(f.gate, bytes, { mode: 0o600 });
  expect(await f.owner.clear(target, async () => {}, undefined, "ZERO_IMPRESSIONS_15D")).toMatchObject({ state: "BLOCKED", message: expect.stringContaining("缺少历史素材隔离分页能力") });
  expect(f.connect).toHaveBeenCalledTimes(1); expect(f.page.deleteBatch).not.toHaveBeenCalled(); expect(await readFile(f.gate, "utf8")).toBe(bytes);
});
it("stops after cancellation before intent and reports an absent ecological option without another filter", async () => {
  const f = await ownerFixture(), controller = new AbortController(); controller.abort();
  expect((await f.owner.clear(target, async () => {}, controller.signal)).state).toBe("BLOCKED"); expect(f.connect).not.toHaveBeenCalled();
  f.page.filter.mockResolvedValue({ skippedEcological: true });
  expect(await f.owner.clear(target, async () => {})).toMatchObject({ state: "CLEARED", message: expect.stringContaining("已跳过") });
});
it("reports the failing cleanup stage for a page timeout without connecting again or writing deletion intent", async () => {
  const f = await ownerFixture(), timeout = new Error("locator.waitFor: Timeout 10000ms exceeded."); timeout.name = "TimeoutError";
  f.page.filter.mockRejectedValueOnce(timeout);
  expect(await f.owner.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", message: expect.stringContaining("筛选计划素材时等待千川页面超时") });
  expect(f.connect).toHaveBeenCalledTimes(1); expect(f.page.deleteBatch).not.toHaveBeenCalled();
  expect((await readdir(path.join(f.root, "plan-material-deletions"))).some(name => name.endsWith(".pending.json"))).toBe(false);
});

let browser: Browser;
vi.setConfig({ testTimeout: 40000, hookTimeout: 30000 });
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); });
afterAll(async () => { await browser?.close(); });
async function pageFixture(options: { initialOffset?: number; many?: boolean; badDelivery?: string; badDeliveryRow?: string; noEcological?: boolean; wrongAccount?: boolean; wrongPlan?: boolean; badFilter?: boolean; failedList?: boolean; unsafeRow?: boolean; empty?: boolean; auditLabel?: boolean; ambiguousStatus?: boolean; titleConfirmation?: boolean } = {}) {
  const context = await browser.newContext(), page = await context.newPage();
  let confirmations = 0, filters = 0;
  const data = [
    { id: "7001", status: "审核不通过\n可优化\n审核建议" },
    ...options.noEcological ? [] : [{ id: "7002", status: "生态审核不通过\n生态建议" }],
    { id: "7003", status: "审核通过\n可优化\n审核建议" }, { id: "7004", status: "审核通过" }, { id: "7005", status: "未审核" },
  ];
  let filtered = options.empty ? [] : data.filter(row => PLAN_MATERIAL_STATUSES.some(status => matchesPlanMaterialStatus(row.status, status)));
  if (options.many) filtered = Array.from({ length: 101 }, (_, i) => ({ id: String(8000 + i), status: "审核不通过" }));
  const removed: string[][] = [];
  if (options.unsafeRow) filtered.push(data.find(row => row.id === "7004")!);
  const html = `<!doctype html><meta charset="utf-8"><div class="account-info-container">ID：${options.wrongAccount ? "999" : target.advertiserId}</div>
    <div class="ovui-drawer--no-maskable"><div class="ad-drawer-body">计划 ID：${options.wrongPlan ? "999" : target.adId}
      <input placeholder="输入视频名称/ID后回车搜索"><button id="filter">更多筛选</button>
      <div class="ovui-popover" style="display:none"><button id="clear">清空</button><div class="config-area" id="delivery"><div class="oc-title">投放状态</div><input placeholder="请选择" value="已删除" readonly><li class="ovui-cascader-panel__selection-item"><div class="ovui-cascader-panel__item-label">投放中</div></li></div><div class="config-area"><div class="oc-title">${options.auditLabel ? "审核状态" : "素材状态"}</div><input placeholder="请选择">
      ${PLAN_MATERIAL_STATUSES.filter(status => !options.noEcological || status !== "生态审核不通过").map(status => `<li class="ovui-cascader-panel__selection-item"><input type="checkbox" value="${status}"><div class="ovui-cascader-panel__item-label">${status}</div></li>`).join("")}
      </div>${options.ambiguousStatus ? '<div class="config-area"><div class="oc-title">审核状态</div><input placeholder="请选择"></div>' : ""}<button id="apply">确定</button><button id="cancelFilter">取消</button></div>
      <div class="ovui-page-select"><input value="10条/页" readonly></div><div class="ovui-option" style="display:none">100条/页</div><div class="ovui-table__head-wrapper"><table><thead><tr><th><input id="all" type="checkbox"></th></tr></thead></table></div>
      <div class="ovui-table__body-wrapper"><table><tbody></tbody></table></div><div id="footer"></div><span id="selected"></span><button id="remove" style="display:none">删除</button>
    </div></div><div class="ovui-modal" style="display:none">确定要删除视频吗？<button id="cancel">取消</button><button id="confirm">确定</button></div>
    <script>
    let pageSize=10,offset=${options.initialOffset ?? 0},total=0;
    document.querySelector('.ovui-page-select input').onclick=()=>document.querySelector('.ovui-option').style.display='';
    document.querySelector('.ovui-option').onclick=()=>{pageSize=100;document.querySelector('.ovui-page-select input').value='100条/页';document.querySelector('.ovui-option').style.display='none';list()};
    setTimeout(()=>{document.querySelector('#delivery .ovui-cascader-panel__item-label').onclick=()=>document.querySelector('#delivery input').value='投放中'},0);

    let shown=[]; const selected=()=>Array.from(document.querySelectorAll('tbody input:checked')).map((x)=>x.dataset.id); const selection=()=>{document.querySelector('#selected').textContent='已选'+selected().length+'个 视频';document.querySelector('#remove').style.display=selected().length?'':'none'}; const render=rows=>{shown=rows;const pager=document.querySelector('.ovui-page-select');if(pager)pager.style.display=rows.length?'':'none';document.querySelector('tbody').innerHTML=rows.map(x=>'<tr><td><input type="checkbox" data-id="'+x.id+'"></td><td>素材ID: '+x.id+'</td><td class="oc-promotion-status-card">'+x.status.replaceAll('\\n','<br>')+'</td></tr>').join('');document.querySelector('#footer').innerHTML=total?'<div class="ovui-page-total">共 '+total+' 条记录</div><ul><li class="ovui-page-turner__item" id="first">1</li><li class="ovui-page-turner__item--active">'+(offset/pageSize+1)+'</li><li class="ovui-page-turner__item" id="next"><div class="ovui-page-turner__next-icon">next</div></li></ul>':'<div class="oc-empty">暂无数据</div>';document.querySelector('#all').checked=false;document.querySelector('#selected').textContent='';document.querySelector('#remove').style.display='none';document.querySelectorAll('tbody input').forEach(x=>x.onchange=selection);if(total){document.querySelector('#first').onclick=()=>{offset=0;list()};document.querySelector('#next').onclick=()=>{offset+=pageSize;list()}}};
    const list=async()=>{const values=Array.from(document.querySelectorAll('.config-area input[type=checkbox]:checked')).map(x=>x.value);const expected={query_type:['all'],roi2_material_type_v3:['1001'],marketing_goal:['1'],ad_id:['${target.adId}'],roi2_material_video_type:['11'],roi2_material_status:[${options.badDelivery ? JSON.stringify(options.badDelivery) : "document.querySelector('#delivery input').value==='投放中'?'1':'2'"}],material_audit_status:${options.badFilter ? "['1']" : "['4','2']"}};if(${!options.auditLabel}&&!values.includes('生态审核不通过'))expected.material_audit_reject_type=['1'];const response=await fetch('${"/ad/api/pmc/v1/uni-promotion/material/list-required"}?aavid=${target.advertiserId}',{method:'POST',body:JSON.stringify({DataSetKey:'site_promotion_product_post_data_video',PageParams:{Offset:offset,Limit:pageSize},Filters:{ConditionRelationshipType:1,Conditions:Object.entries(expected).map(([Field,Values])=>({Field,Values,Operator:7}))}})});const body=await response.json();total=Number(body.data.statsData.totalCount??0);render(body.data.statsData.rows??[])};
    document.querySelector('#filter').onclick=()=>document.querySelector('.ovui-popover').style.display='';document.querySelector('#clear').onclick=()=>document.querySelectorAll('.config-area input[type=checkbox]').forEach(x=>x.checked=false);document.querySelectorAll('.ovui-cascader-panel__item-label').forEach(x=>x.onclick=()=>{const input=x.previousElementSibling;input.checked=!input.checked});document.querySelector('#apply').onclick=()=>{document.querySelector('.ovui-popover').style.display='none';list()};document.querySelector('#all').onclick=e=>{document.querySelectorAll('tbody input').forEach(x=>x.checked=e.target.checked);document.querySelector('#selected').textContent=e.target.checked?'已选'+shown.length+'个 视频':'';document.querySelector('#remove').style.display=e.target.checked?'':'none'};document.querySelector('#remove').onclick=()=>document.querySelector('.ovui-modal').style.display='';document.querySelector('#cancel').onclick=()=>document.querySelector('.ovui-modal').style.display='none';document.querySelector('#confirm').onclick=async()=>{await fetch('/fixture-delete',{method:'POST',body:JSON.stringify(selected())});document.querySelector('.ovui-modal').style.display='none';${options.titleConfirmation ? "setTimeout(()=>{const modal=document.createElement('div');modal.className='ovui-modal';modal.innerHTML='确定要删除自选视频吗？部分商品下的自选素材将被清空，需要同步删除以下 13 个自选标题<button id=secondConfirm>确定</button>';modal.querySelector('button').onclick=()=>fetch('/fixture-delete',{method:'POST',body:JSON.stringify(selected())});document.body.append(modal)},150)" : "offset=0;await list()"}};
    </script>`;
  await page.route("https://qianchuan.jinritemai.com/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/material/list-required")) {
      filters++;
      const { Offset: offset, Limit: limit } = route.request().postDataJSON().PageParams;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status_code: options.failedList ? 9 : 0, data: { statsData: filtered.length ? { totalCount: String(filtered.length), rows: filtered.slice(offset, offset + limit).map(row => ({ ...row, dimensions: { materialId: { value: row.id }, roi2MaterialStatus: { value: options.badDeliveryRow ?? "1" } } })) } : {} } }) });
    } else if (pathname === "/fixture-delete") { confirmations++; const ids: string[] = route.request().postDataJSON(); removed.push(ids); if (!options.titleConfirmation) filtered = filtered.filter(row => !ids.includes(row.id)); await route.fulfill({ body: "{}" }); }
    else await route.fulfill({ contentType: "text/html", body: html });
  });
  return { context, page, removed, session: new QianchuanPlanMaterialPage(page, target, new AbortController().signal), confirmations: () => confirmations, filters: () => filters };
}
it("selects all three options together, sends one filter and deletes only verified selected rows", async () => {
  const f = await pageFixture();
  try {
    await f.session.open(); expect(await f.session.filter()).toEqual({ skippedEcological: false });
    expect(f.filters()).toBe(2); const before = await f.session.read(); expect(before.ids).toEqual(["7001", "7002", "7003"]);
    await f.session.deleteBatch(before, async () => { expect(f.confirmations()).toBe(0); });
    expect(f.confirmations()).toBe(1); expect(await f.session.read()).toEqual({ total: 0, ids: [] });
  } finally { await f.session.dispose(); await f.context.close(); }
});
it.each(["mixed", "protected-first", "protected-last"])("skips historical audit IDs and reaches other candidates across pages: %s", async mode => {
  const many = mode !== "mixed";
  const f = await pageFixture({ many, initialOffset: mode === "protected-last" ? 100 : 0 }), owner = await ownerFixture();
  await mkdir(path.dirname(owner.gate), { recursive: true, mode: 0o700 });
  const ids = mode === "protected-last" ? ["8100"] : many ? Array.from({ length: 100 }, (_, i) => String(8000 + i)) : ["7001"];
  const bytes = JSON.stringify({ version: 1, attempt: "11111111-1111-4111-8111-111111111111", advertiserId: target.advertiserId, adId: target.adId, ids });
  await writeFile(owner.gate, bytes, { mode: 0o600 });
  try {
    const result = await new QianchuanPlanMaterials(owner.root, async () => ({ page: f.session, close: () => f.session.dispose() })).clear(target, async () => {});
    expect(result).toMatchObject({ state: "PARTIAL", deletedCount: mode === "protected-last" ? 100 : many ? 1 : 2 });
    expect(f.removed).toEqual([mode === "protected-last" ? Array.from({ length: 100 }, (_, i) => String(8000 + i)) : many ? ["8100"] : ["7002", "7003"]]);
    expect(await readFile(owner.gate, "utf8")).toBe(bytes);
  } finally { await f.session.dispose(); await f.context.close(); }
});
it("skips just an absent ecological option and still selects both required statuses in one filter", async () => {
  const f = await pageFixture({ noEcological: true });
  try { await f.session.open(); expect(await f.session.filter()).toEqual({ skippedEcological: true }); expect(f.filters()).toBe(2); expect((await f.session.read()).ids).toEqual(["7001", "7003"]); }
  finally { await f.session.dispose(); await f.context.close(); }
});
it("supports the live audit-status label without changing the combined filter or admitting plain approval", async () => {
  const f = await pageFixture({ auditLabel: true, noEcological: true }); f.page.setDefaultTimeout(500);
  try { await f.session.open(); expect(await f.session.filter()).toEqual({ skippedEcological: true }); expect(f.filters()).toBe(2); expect((await f.session.read()).ids).toEqual(["7001", "7003"]); expect(f.confirmations()).toBe(0); }
  finally { await f.session.dispose(); await f.context.close(); }
});
it("rejects ambiguous status controls before applying a filter or deleting", async () => {
  const f = await pageFixture({ ambiguousStatus: true });
  try { await f.session.open(); await expect(f.session.filter()).rejects.toThrow(); expect(f.filters()).toBe(0); expect(f.confirmations()).toBe(0); }
  finally { await f.session.dispose(); await f.context.close(); }
});
it("reports the platform's additional title-deletion boundary without a second confirmation and retains pending intent", async () => {
  const f = await pageFixture({ titleConfirmation: true }), owner = await ownerFixture();
  const connect = vi.fn(async () => ({ page: f.session, close: async () => { await f.session.dispose(); } }));
  try {
    const result = await new QianchuanPlanMaterials(owner.root, connect).clear(target, async () => {});
    expect(result).toMatchObject({ state: "BLOCKED", deletedCount: 0, message: expect.stringContaining("同步删除自选标题") });
    expect(f.confirmations()).toBe(1); const bytes = await readFile(owner.gate);
    const repeated = await new QianchuanPlanMaterials(owner.root, connect).clear(target, async () => {});
    expect(repeated.state).toBe("BLOCKED"); expect(repeated.pendingPlanDeletion).toEqual(result.pendingPlanDeletion);
    expect(result.pendingPlanDeletion?.ids).toHaveLength(3);
    expect(connect).toHaveBeenCalledTimes(2); expect(f.confirmations()).toBe(1); expect(await readFile(owner.gate)).toEqual(bytes);
  } finally { await f.context.close(); }
});
it.each([{ wrongAccount: true }, { wrongPlan: true }, { unsafeRow: true }, { failedList: true }, { auditLabel: true, noEcological: true, unsafeRow: true }])("rejects mismatching identity, plain approval or failed responses before deletion (%j)", async options => {
  const f = await pageFixture(options);
  try { await expect((async () => { await f.session.open(); await f.session.filter(); })()).rejects.toThrow(); expect(f.confirmations()).toBe(0); }
  finally { await f.session.dispose(); await f.context.close(); }
});
it("a matching loading empty DOM is insufficient without a successful bound filter response", async () => {
  const f = await pageFixture({ empty: true, failedList: true });
  try { await f.session.open(); await expect(f.session.filter()).rejects.toThrow(); expect(f.confirmations()).toBe(0); }
  finally { await f.session.dispose(); await f.context.close(); }
});
it("rejects document replacement and foreign checked rows before confirmation", async () => {
  for (const replace of [false, true]) {
    const f = await pageFixture();
    try {
      await f.session.open(); await f.session.filter(); const before = await f.session.read();
      if (replace) await f.page.reload(); else await f.page.locator('tbody input[type="checkbox"]').first().check();
      await expect(f.session.deleteBatch(before, async () => {})).rejects.toThrow(); expect(f.confirmations()).toBe(0);
    } finally { await f.session.dispose(); await f.context.close(); }
  }
});

it.each([{ badDelivery: "2" }, { badDelivery: "3" }, { badDelivery: "4" }, { badDeliveryRow: "2" }, { badDeliveryRow: "" }])("rejects non-delivering request or response before selection %j", async options => {
  const f = await pageFixture(options);
  try { await f.session.open(); await expect(f.session.filter()).rejects.toThrow(); expect(f.confirmations()).toBe(0); }
  finally { await f.session.dispose(); await f.context.close(); }
});
it.each(["delivery", "pager", "drift"])("rejects missing delivery/pager controls or page-size drift: %s", async mode => {
  const f = await pageFixture();
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
    expect(f.confirmations()).toBe(0);
  } finally { await f.session.dispose(); await f.context.close(); }
});

it("accepts an empty delivering filter without a pagination control", async () => {
  const f = await pageFixture({ empty: true });
  try { await f.session.open(); await f.session.filter(); expect(await f.session.read()).toEqual({ total: 0, ids: [] }); expect(f.confirmations()).toBe(0); }
  finally { await f.session.dispose(); await f.context.close(); }
});
