import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
it("keeps an unknown deletion intent and refuses confirmation on a later explicit call or a new owner", async () => {
  const f = await ownerFixture();
  f.page.deleteBatch.mockImplementationOnce(async (_before, confirm) => { await confirm(); throw new Error("response lost"); });
  expect((await f.owner.clear(target, async () => {})).state).toBe("BLOCKED");
  const bytes = await readFile(f.gate);
  expect((await new QianchuanPlanMaterials(f.root, f.connect).clear(target, async () => {})).state).toBe("BLOCKED");
  expect(f.connect).toHaveBeenCalledTimes(1); expect(await readFile(f.gate)).toEqual(bytes);
});
it("stops after cancellation before intent and reports an absent ecological option without another filter", async () => {
  const f = await ownerFixture(), controller = new AbortController(); controller.abort();
  expect((await f.owner.clear(target, async () => {}, controller.signal)).state).toBe("BLOCKED"); expect(f.connect).not.toHaveBeenCalled();
  f.page.filter.mockResolvedValue({ skippedEcological: true });
  expect(await f.owner.clear(target, async () => {})).toMatchObject({ state: "CLEARED", message: expect.stringContaining("已跳过") });
});

let browser: Browser;
vi.setConfig({ testTimeout: 40000, hookTimeout: 30000 });
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); });
afterAll(async () => { await browser?.close(); });
async function pageFixture(options: { noEcological?: boolean; wrongAccount?: boolean; wrongPlan?: boolean; badFilter?: boolean; failedList?: boolean; unsafeRow?: boolean; empty?: boolean } = {}) {
  const context = await browser.newContext(), page = await context.newPage();
  let confirmations = 0, filters = 0;
  const data = [
    { id: "7001", status: "审核不通过\n可优化\n审核建议" },
    ...options.noEcological ? [] : [{ id: "7002", status: "生态审核不通过\n生态建议" }],
    { id: "7003", status: "审核通过\n可优化\n审核建议" }, { id: "7004", status: "审核通过" }, { id: "7005", status: "未审核" },
  ];
  let filtered = options.empty ? [] : data.filter(row => PLAN_MATERIAL_STATUSES.some(status => matchesPlanMaterialStatus(row.status, status)));
  if (options.unsafeRow) filtered.push(data.find(row => row.id === "7004")!);
  const html = `<!doctype html><meta charset="utf-8"><div class="account-info-container">ID：${options.wrongAccount ? "999" : target.advertiserId}</div>
    <div class="ovui-drawer--no-maskable"><div class="ad-drawer-body">计划 ID：${options.wrongPlan ? "999" : target.adId}
      <input placeholder="输入视频名称/ID后回车搜索"><button id="filter">更多筛选</button>
      <div class="ovui-popover" style="display:none">素材状态<button id="clear">清空</button><div class="config-area">素材状态<input placeholder="请选择">
      ${PLAN_MATERIAL_STATUSES.filter(status => !options.noEcological || status !== "生态审核不通过").map(status => `<li class="ovui-cascader-panel__selection-item"><input type="checkbox" value="${status}"><div class="ovui-cascader-panel__item-label">${status}</div></li>`).join("")}
      </div><button id="apply">确定</button><button id="cancelFilter">取消</button></div>
      <div class="ovui-table__head-wrapper"><table><thead><tr><th><input id="all" type="checkbox"></th></tr></thead></table></div>
      <div class="ovui-table__body-wrapper"><table><tbody></tbody></table></div><div id="footer"></div><span id="selected"></span><button id="remove" style="display:none">删除</button>
    </div></div><div class="ovui-modal" style="display:none">确定要删除视频吗？<button id="cancel">取消</button><button id="confirm">确定</button></div>
    <script>
    let shown=[]; const render=rows=>{shown=rows;document.querySelector('tbody').innerHTML=rows.map(x=>'<tr><td><input type="checkbox"></td><td>素材ID: '+x.id+'</td><td class="oc-promotion-status-card">'+x.status.replaceAll('\\n','<br>')+'</td></tr>').join('');document.querySelector('#footer').innerHTML=rows.length?'<div class="ovui-page-total">共 '+rows.length+' 条记录</div>':'<div class="oc-empty">暂无数据</div>';document.querySelector('#all').checked=false;document.querySelector('#selected').textContent='';document.querySelector('#remove').style.display='none'};
    const list=async()=>{const values=Array.from(document.querySelectorAll('.config-area input[type=checkbox]:checked')).map(x=>x.value);const expected={query_type:['all'],roi2_material_type_v3:['1001'],marketing_goal:['1'],ad_id:['${target.adId}'],roi2_material_video_type:['11'],material_audit_status:${options.badFilter ? "['1']" : "['4','2']"}};if(!values.includes('生态审核不通过'))expected.material_audit_reject_type=['1'];const response=await fetch('${"/ad/api/pmc/v1/uni-promotion/material/list-required"}?aavid=${target.advertiserId}',{method:'POST',body:JSON.stringify({DataSetKey:'site_promotion_product_post_data_video',PageParams:{Offset:0,Limit:10},Filters:{ConditionRelationshipType:1,Conditions:Object.entries(expected).map(([Field,Values])=>({Field,Values,Operator:7}))}})});const body=await response.json();render(body.data.statsData.rows??[])};
    document.querySelector('#filter').onclick=()=>document.querySelector('.ovui-popover').style.display='';document.querySelector('#clear').onclick=()=>document.querySelectorAll('.config-area input[type=checkbox]').forEach(x=>x.checked=false);document.querySelectorAll('.ovui-cascader-panel__item-label').forEach(x=>x.onclick=()=>{const input=x.previousElementSibling;input.checked=!input.checked});document.querySelector('#apply').onclick=()=>{document.querySelector('.ovui-popover').style.display='none';list()};document.querySelector('#all').onclick=e=>{document.querySelectorAll('tbody input').forEach(x=>x.checked=e.target.checked);document.querySelector('#selected').textContent=e.target.checked?'已选'+shown.length+'个 视频':'';document.querySelector('#remove').style.display=e.target.checked?'':'none'};document.querySelector('#remove').onclick=()=>document.querySelector('.ovui-modal').style.display='';document.querySelector('#cancel').onclick=()=>document.querySelector('.ovui-modal').style.display='none';document.querySelector('#confirm').onclick=async()=>{await fetch('/fixture-delete',{method:'POST'});document.querySelector('.ovui-modal').style.display='none';await list()};
    </script>`;
  await page.route("https://qianchuan.jinritemai.com/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/material/list-required")) {
      filters++;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status_code: options.failedList ? 9 : 0, data: { statsData: filtered.length ? { totalCount: String(filtered.length), rows: filtered.map(row => ({ ...row, dimensions: { materialId: { value: row.id } } })) } : {} } }) });
    } else if (pathname === "/fixture-delete") { confirmations++; filtered = []; await route.fulfill({ body: "{}" }); }
    else await route.fulfill({ contentType: "text/html", body: html });
  });
  return { context, page, session: new QianchuanPlanMaterialPage(page, target, new AbortController().signal), confirmations: () => confirmations, filters: () => filters };
}
it("selects all three options together, sends one filter and deletes only verified selected rows", async () => {
  const f = await pageFixture();
  try {
    await f.session.open(); expect(await f.session.filter()).toEqual({ skippedEcological: false });
    expect(f.filters()).toBe(1); const before = await f.session.read(); expect(before.ids).toEqual(["7001", "7002", "7003"]);
    await f.session.deleteBatch(before, async () => { expect(f.confirmations()).toBe(0); });
    expect(f.confirmations()).toBe(1); expect(await f.session.read()).toEqual({ total: 0, ids: [] });
  } finally { await f.session.dispose(); await f.context.close(); }
});
it("skips just an absent ecological option and still selects both required statuses in one filter", async () => {
  const f = await pageFixture({ noEcological: true });
  try { await f.session.open(); expect(await f.session.filter()).toEqual({ skippedEcological: true }); expect(f.filters()).toBe(1); expect((await f.session.read()).ids).toEqual(["7001", "7003"]); }
  finally { await f.session.dispose(); await f.context.close(); }
});
it.each([{ wrongAccount: true }, { wrongPlan: true }, { unsafeRow: true }, { failedList: true }])("rejects mismatching identity, plain approval or failed responses before deletion (%j)", async options => {
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
