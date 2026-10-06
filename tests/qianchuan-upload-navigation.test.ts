import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DouyinCdpUploader } from "../src/main/douyin-cdp-uploader";
import { QianchuanPageSession } from "../src/main/qianchuan-page-contract";
import { frozenInputDigest, uploadTaskId, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { QianchuanUploadConfigSchema } from "../src/shared/douyin-upload";
import { resolveChromeExecutable, startQianchuanFixture, type QianchuanFixture } from "./helpers/douyin-cdp-fixture";

vi.setConfig({ testTimeout: 15_000, hookTimeout: 30_000 });
let root: string, fixture: QianchuanFixture, browser: Browser;
const uploaders: DouyinCdpUploader[] = [];
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "qianchuan-navigation-"));
  const html = await readFile("tests/fixtures/qianchuan-production-page.html", "utf8");
  const bootstrap = `<script>
    const mode = localStorage.getItem('navigation-mode') || 'normal';
    if (mode !== 'normal') {
      const url = new URL(location.href); url.searchParams.set('adId', mode === 'wrong-url' ? '555555' : ''); history.replaceState({}, '', url);
      document.querySelector('#plan-drawer').hidden = true;
      const list = document.createElement('section');
      list.innerHTML = '<div class="oc-promotion-product-adinfo"><div class="oc-promotion-product-adinfo-id-fade">ID：987654</div><div class="oc-promotion-product-adinfo-material">素材</div></div>';
      if (mode === 'missing') list.textContent = '暂无数据';
      if (mode === 'duplicate') list.innerHTML += list.innerHTML;
      if (mode === 'duplicate-control') list.firstElementChild.innerHTML += '<div class="oc-promotion-product-adinfo-material">素材</div>';
      document.body.append(list);
      if (mode === 'loading') {
        const account = document.querySelector('.account-info-container'); account.hidden = true; list.hidden = true;
        setTimeout(() => { account.hidden = false; list.hidden = false; }, 150);
      }
      list.addEventListener('click', e => {
        if (!e.target.closest('.oc-promotion-product-adinfo-material')) return;
        fetch('/events', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'initial-plan-click'})});
        if (mode === 'stuck') return;
        const target = new URL(location.href); target.searchParams.set('adId', mode === 'wrong-drawer' ? '555555' : '987654'); history.replaceState({}, '', target);
        document.querySelector('#plan-drawer').hidden = false;
      });
    }
  </script>`;
  const fixtureHtml = path.join(root, "navigation.html"); await writeFile(fixtureHtml, html.replace("</body>", `${bootstrap}</body>`));
  fixture = await startQianchuanFixture({ tempRoot: root, chromeExecutable: await resolveChromeExecutable(), production: true, fixtureHtml });
  browser = await chromium.connectOverCDP(fixture.cdpEndpoint, { noDefaults: true });
  await browser.contexts()[0]!.pages()[0]!.goto(fixture.contract.fixtureUrl!);
});
afterEach(async () => {
  await Promise.all(uploaders.splice(0).map(port => port.stop()));
  for (const page of browser.contexts()[0]!.pages().slice(1)) await page.close();
  fixture.reset();
});
afterAll(async () => { await browser?.close(); await fixture?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
async function task(mode: string): Promise<UploadTaskRecord> {
  await browser.contexts()[0]!.pages()[0]!.evaluate(value => localStorage.setItem("navigation-mode", value), mode);
  const snapshotPath = path.join(root, `${randomUUID()}.mp4`), bytes = Buffer.from("offline-navigation"); await writeFile(snapshotPath, bytes);
  const input = { project_id: randomUUID(), batch_id: randomUUID(), export_task_id: randomUUID(), video_path: snapshotPath, artifact_sha256: createHash("sha256").update(bytes).digest("hex"), size_bytes: bytes.length };
  const target = { product: "眼贴" as const, cdpEndpoint: fixture.cdpEndpoint, advertiserId: "123456", adId: "987654", configDigest: "d".repeat(64) };
  const authorization = { target, pageBatchId: randomUUID(), expectedCount: 1 };
  return { input, inputDigest: frozenInputDigest(input, authorization), authorization, snapshotPath,
    config: QianchuanUploadConfigSchema.parse({ enabled: true, timeouts: { navigation: 1000, action: 500, fileInput: 500, processing: 1000 } }),
    result: { ...input, upload_task_id: uploadTaskId(input, target), artifact_sha256: input.artifact_sha256, file_name: path.basename(snapshotPath), accountProduct: target.product, advertiserId: target.advertiserId, adId: target.adId, state: "PENDING", upload_outcome: "NOT_SELECTED", retryable: false, retry_count: 0, attempt_count: 0, timestamp: new Date().toISOString() } };
}
async function open(value: UploadTaskRecord, signal = new AbortController().signal) {
  const port = new DouyinCdpUploader(fixture.contract); uploaders.push(port);
  await port.connect(value, signal); return port.open([value], [], signal);
}
async function noFileActions(clicks: number) {
  await vi.waitFor(async () => {
    const events = (await fixture.inspect()).events;
    expect(events.filter(e => e.type === "initial-plan-click")).toHaveLength(clicks);
    expect(events.filter(e => ["files", "drop", "confirm", "settings"].includes(e.type))).toHaveLength(0);
  });
}
describe("initial source-owned plan navigation", () => {
  it("opens the unique frozen plan after the platform clears the deep link", async () => {
    const value = await task("cleared"); const result = await open(value);
    expect(result.pageOwnership.pageBatchId).toBe(value.authorization.pageBatchId); expect(result.selectedIndex).toBe(1);
    await noFileActions(1);
  });
  it("keeps a successful deep link without list clicks", async () => { await open(await task("normal")); await noFileActions(0); });
  it("waits for the visible account and list to load before the single plan click", async () => { await open(await task("loading")); await noFileActions(1); });
  it.each(["wrong-url", "duplicate", "duplicate-control", "missing", "wrong-drawer", "stuck"])("refuses %s without any file action", async mode => {
    await expect(open(await task(mode))).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    await noFileActions(["wrong-drawer", "stuck"].includes(mode) ? 1 : 0);
  });
  it("does not navigate a wrong advertiser", async () => {
    fixture.setControls({ wrongAdvertiser: true }); await expect(open(await task("cleared"))).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    await noFileActions(0);
  });
  it("rejects a wrong visible drawer identity after opening the exact list row", async () => {
    fixture.setControls({ wrongDrawerPlan: true }); await expect(open(await task("cleared"))).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    await noFileActions(1);
  });
  it("never applies initial navigation to an existing owned upload modal", async () => {
    const value = await task("normal"), page = await browser.contexts()[0]!.newPage();
    const session = new QianchuanPageSession(page, fixture.contract, signal => signal.throwIfAborted());
    const signal = new AbortController().signal;
    await page.goto(session.url(value)); await page.bringToFront(); await session.prepare([value], [], "fixture-target", signal);
    await expect(session.openInitialPlan(value, signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    await noFileActions(0);
  });
  it("cancellation stops a pending navigation without a late list click", async () => {
    const controller = new AbortController(), value = await task("missing"), work = open(value, controller.signal);
    setTimeout(() => controller.abort(), 100); await expect(work).rejects.toBeDefined(); await new Promise(resolve => setTimeout(resolve, 150)); await noFileActions(0);
  });
});
