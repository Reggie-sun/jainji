import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { QianchuanDeliveryPageSession } from "../src/main/qianchuan-delivery-page";
import { QianchuanBackendAdapter } from "../src/main/qianchuan-backend-adapter";
import { vi } from "vitest";
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });
const advertiserId = "1876131703522649", adId = "1878488818847384";
const deadline = () => ({ expiresAt: new Date(Date.now() + 60000).toISOString() });
async function fixture() {
  const page = await browser.newPage(); let budget = "500000000", roi = "1.95", revision = "1", clicks = 0, productId = "3847118098272485669";
  await page.route("https://qianchuan.jinritemai.com/**", async route => {
    if (route.request().url().includes("ad-detail-basic")) return route.fulfill({ json: { status_code: 0, data: { adDetailInfo: { id: adId, name: "真实表单 fixture", budget, ecpRoi2Goal: Number(roi), budgetMode: 0, modifyTime: revision }, goodsInfos: [{ id: productId, name: "商品" }] } } });
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: `
      <div class="account-info-container">ID：${advertiserId}</div>
      <table><tbody><tr><td>ID：${adId}</td><td>控成本投放 投放中
        <div class="setting-item"><span class="hint-text">每日预算</span><span class="bold">5000元</span><button class="edit-icon" onclick="openEditor('budget')">编辑预算</button></div>
        <div class="setting-item"><span class="hint-text">ROI目标</span><span class="bold">1.95 (净成交)</span><button class="edit-icon" onclick="openEditor('roi')">编辑ROI</button></div>
      </td></tr></tbody></table><div id="editor"></div>
      <script>
        function openEditor(kind) {
          const box = document.createElement('div'); box.className='ovui-popover';
          const input = document.createElement('input'); input.placeholder=kind==='budget'?'请输入预算金额':'请输入净成交ROI目标'; input.value=kind==='budget'?'5000':'1.95';
          const ok=document.createElement('button'); ok.textContent='确定'; ok.onclick=()=>window.submitValue(kind,input.value);
          const cancel=document.createElement('button'); cancel.textContent='取消'; cancel.onclick=()=>box.remove();
          box.append(input,ok,cancel); document.getElementById('editor').replaceChildren(box);
        }
      </script>` });
  });
  await page.goto(`https://qianchuan.jinritemai.com/uni-prom?aavid=${advertiserId}`);
  await page.exposeFunction("submitValue", (kind: string, value: string) => { clicks++; if (kind === "budget") budget = String(BigInt(value.replace(".", "")) * 1000n); else roi = value; revision = "2"; });
  const session = await QianchuanDeliveryPageSession.create(page, advertiserId);
  return { page, session, clicks: () => clicks, drift: () => { revision = "3"; }, driftProduct: () => { productId = "3847118098272485670"; } };
}
it("prepares a budget draft without submitting, sends once and independently reads the changed value", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const prepared = await f.session.prepare({ requestId: crypto.randomUUID(), product: "滴耳康", expectedAdvertiserId: advertiserId, adId, action: "set-budget", targetValue: "4999.00" }, signal);
    expect(prepared.draft.beforeValues).toEqual({ budget: "5000.00", budgetType: "daily" });
    expect(prepared.draft.target).toEqual({ budget: "4999.00", budgetType: "daily" }); expect(f.clicks()).toBe(0);
    expect(await f.session.readFresh(prepared.draft, signal)).toMatchObject({ version: prepared.draft.beforeVersion, values: prepared.draft.beforeValues });
    await f.session.submitOnce(prepared.draft, signal, deadline());
    expect(await f.session.readback(prepared.draft, { kind: "submitted" }, signal)).toMatchObject({ values: prepared.draft.target });
    expect(f.clicks()).toBe(1); await expect(f.session.submitOnce(prepared.draft, signal, deadline())).rejects.toThrow(); expect(f.clicks()).toBe(1);
  } finally { await f.session.close(); await f.page.close(); }
});
it("never submits an out-of-range budget or a cancelled preflight, and rejects identity drift", async () => {
  const f = await fixture(), controller = new AbortController();
  try {
    const request = { requestId: crypto.randomUUID(), product: "滴耳康" as const, expectedAdvertiserId: advertiserId, adId, action: "set-budget" as const, targetValue: "299.99" };
    await expect(f.session.prepare(request, controller.signal)).rejects.toThrow(); expect(f.clicks()).toBe(0);
    controller.abort(); await expect(f.session.prepare({ ...request, targetValue: "4999.00" }, controller.signal)).rejects.toThrow(); expect(f.clicks()).toBe(0);
    const signal = new AbortController().signal;
    const prepared = await f.session.prepare({ ...request, targetValue: "4999.00" }, signal);
    await f.page.locator(".account-info-container").evaluate(node => { node.textContent = "ID：12345"; });
    await expect(f.session.submitOnce(prepared.draft, signal, deadline())).rejects.toThrow(); expect(f.clicks()).toBe(0);
  } finally { await f.session.close(); await f.page.close(); }
});
it("changes only ROI and refuses a different product in the independent readback", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const prepared = await f.session.prepare({ requestId: crypto.randomUUID(), product: "滴耳康", expectedAdvertiserId: advertiserId, adId, action: "set-roi", targetValue: "1.96" }, signal);
    await f.session.submitOnce(prepared.draft, signal, deadline());
    expect(await f.session.readback(prepared.draft, { kind: "submitted" }, signal)).toMatchObject({ values: { roi: "1.96" } }); expect(f.clicks()).toBe(1);
    f.driftProduct(); await expect(f.session.readback(prepared.draft, { kind: "submitted" }, signal)).rejects.toThrow();
  } finally { await f.session.close(); await f.page.close(); }
});
it("refuses revision drift, unsupported actions and wrong account before the submit click", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const request = { requestId: crypto.randomUUID(), product: "滴耳康" as const, expectedAdvertiserId: advertiserId, adId, action: "set-roi" as const, targetValue: "1.96" };
    const prepared = await f.session.prepare(request, signal); f.drift();
    await expect(f.session.submitOnce(prepared.draft, signal, deadline())).rejects.toThrow(); expect(f.clicks()).toBe(0);
    await expect(f.session.prepare({ ...request, expectedAdvertiserId: "12345" }, signal)).rejects.toThrow();
    await expect(f.session.prepare({ ...request, action: "pause" } as any, signal)).rejects.toThrow();
  } finally { await f.session.close(); await f.page.close(); }
});
it("rejects a different plan whose ID only starts with the requested ID", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    await f.page.locator("tr td").first().evaluate((node, id) => { node.textContent = `ID：${id}0`; }, adId);
    await expect(f.session.prepare({ requestId: crypto.randomUUID(), product: "滴耳康", expectedAdvertiserId: advertiserId,
      adId, action: "set-budget", targetValue: "4999.00" }, signal)).rejects.toThrow();
    expect(f.clicks()).toBe(0);
  } finally { await f.session.close(); await f.page.close(); }
});
it.each(["last read", "button wait", "browser event", "target change"])("blocks a stale submission at %s", async boundary => {
  const f = await fixture(), signal = new AbortController().signal;
  let spy: { mockRestore(): void } | undefined;
  try {
    const prepared = await f.session.prepare({ requestId: crypto.randomUUID(), product: "滴耳康", expectedAdvertiserId: advertiserId,
      adId, action: "set-budget", targetValue: "4999.00" }, signal);
    const expiry = Date.now() + (["browser event", "target change"].includes(boundary) ? 5000 : 100);
    if (boundary === "last read") {
      const original = QianchuanBackendAdapter.prototype.readDeliverySettings;
      spy = vi.spyOn(QianchuanBackendAdapter.prototype, "readDeliverySettings").mockImplementationOnce(async function (this: QianchuanBackendAdapter, ...args) {
        await new Promise(resolve => setTimeout(resolve, 150)); return original.apply(this, args);
      });
    } else if (boundary === "button wait") {
      await f.page.getByRole("button", { name: "确定", exact: true }).evaluate(node => {
        (node as HTMLButtonElement).disabled = true;
        setTimeout(() => { (node as HTMLButtonElement).disabled = false; }, 250);
      });
    } else if (boundary === "browser event") await f.page.evaluate(() => {
      const clock = performance.now.bind(performance); let samples = 0;
      performance.now = () => clock() + (++samples > 1 ? 60000 : 0);
    });
    else await f.page.getByRole("button", { name: "确定", exact: true }).evaluate(node => {
      (node as HTMLButtonElement).disabled = true;
      setTimeout(() => {
        document.querySelector<HTMLInputElement>(".ovui-popover input")!.value = "8000.00";
        (node as HTMLButtonElement).disabled = false;
      }, 200);
    });
    const submission = f.session.submitOnce(prepared.draft, signal, { expiresAt: new Date(expiry).toISOString() });
    if (boundary === "last read") await expect(submission).resolves.toEqual({ kind: "not-sent", reason: "AUTHORIZATION_EXPIRED" });
    else await expect(submission).rejects.toThrow();
    expect(f.clicks()).toBe(0);
  } finally { spy?.mockRestore(); await f.session.close(); await f.page.close(); }
});
it.each([-60000, 0, 60000])("blocks an already dispatched late click with browser clock offset %i", async offset => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const prepared = await f.session.prepare({ requestId: crypto.randomUUID(), product: "滴耳康", expectedAdvertiserId: advertiserId,
      adId, action: "set-budget", targetValue: "4999.00" }, signal);
    await f.page.evaluate(offset => {
      const clock = Date.now.bind(Date); Date.now = () => clock() + offset;
      window.addEventListener("click", () => {
        const end = performance.now() + 800;
        while (performance.now() < end) { /* Hold an already dispatched event past the main deadline. */ }
      }, { capture: true, once: true });
    }, offset);
    await f.session.submitOnce(prepared.draft, signal, { expiresAt: new Date(Date.now() + 500).toISOString() }).catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(f.clicks()).toBe(0);
  } finally { await f.session.close(); await f.page.close(); }
});
it("allows an on-time click independently of the browser wall clock", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const prepared = await f.session.prepare({ requestId: crypto.randomUUID(), product: "滴耳康", expectedAdvertiserId: advertiserId,
      adId, action: "set-budget", targetValue: "4999.00" }, signal);
    await f.page.evaluate(() => { const clock = Date.now.bind(Date); Date.now = () => clock() + 60000; });
    await expect(f.session.submitOnce(prepared.draft, signal, deadline())).resolves.toMatchObject({ kind: "submitted" });
    expect(f.clicks()).toBe(1);
  } finally { await f.session.close(); await f.page.close(); }
});
it("rejects document replacement after the final read and before native click", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  const original = QianchuanBackendAdapter.prototype.readDeliverySettings;
  try {
    const prepared = await f.session.prepare({ requestId: crypto.randomUUID(), product: "滴耳康", expectedAdvertiserId: advertiserId,
      adId, action: "set-budget", targetValue: "4999.00" }, signal);
    const spy = vi.spyOn(QianchuanBackendAdapter.prototype, "readDeliverySettings").mockImplementationOnce(async function (this: QianchuanBackendAdapter, ...args) {
      const value = await original.apply(this, args);
      await f.page.reload();
      await f.page.getByRole("button", { name: "编辑预算", exact: true }).click();
      await f.page.getByPlaceholder("请输入预算金额", { exact: true }).fill("4999.00");
      return value;
    });
    try { await expect(f.session.submitOnce(prepared.draft, signal, deadline())).rejects.toThrow(); }
    finally { spy.mockRestore(); }
    expect(f.clicks()).toBe(0);
  } finally { await f.session.close(); await f.page.close(); }
});
it("keeps the terminal deadline guard after native click timeout until the owned page closes", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const prepared = await f.session.prepare({ requestId: crypto.randomUUID(), product: "滴耳康", expectedAdvertiserId: advertiserId,
      adId, action: "set-budget", targetValue: "4999.00" }, signal);
    const button = f.page.getByRole("button", { name: "确定", exact: true });
    await button.evaluate(node => { (node as HTMLButtonElement).disabled = true; });
    await expect(f.session.submitOnce(prepared.draft, signal, { expiresAt: new Date(Date.now() + 200).toISOString() })).rejects.toThrow();
    await button.evaluate(node => { (node as HTMLButtonElement).disabled = false; });
    // A late native event on the original element must remain fenced after the call has returned.
    await button.click();
    expect(f.clicks()).toBe(0);
  } finally { await f.session.close(); await f.page.close(); }
});
it.each(["visible account", "URL"])("blocks same-document %s drift while the button is waiting", async boundary => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const prepared = await f.session.prepare({ requestId: crypto.randomUUID(), product: "滴耳康", expectedAdvertiserId: advertiserId,
      adId, action: "set-budget", targetValue: "4999.00" }, signal);
    await f.page.getByRole("button", { name: "确定", exact: true }).evaluate((node, boundary) => {
      (node as HTMLButtonElement).disabled = true;
      setTimeout(() => {
        if (boundary === "visible account") document.querySelector(".account-info-container")!.textContent = "ID：12345";
        else history.replaceState(null, "", "/uni-prom?aavid=12345");
        (node as HTMLButtonElement).disabled = false;
      }, 200);
    }, boundary);
    await expect(f.session.submitOnce(prepared.draft, signal, deadline())).rejects.toThrow();
    expect(f.clicks()).toBe(0);
  } finally { await f.session.close(); await f.page.close(); }
});
