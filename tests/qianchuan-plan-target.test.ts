import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { QianchuanPageSession } from "../src/main/qianchuan-page-contract";
import { frozenInputDigest, uploadTaskId, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { QianchuanUploadConfigSchema } from "../src/shared/douyin-upload";
import { resolveChromeExecutable, startQianchuanFixture, type QianchuanFixture } from "./helpers/douyin-cdp-fixture";

vi.setConfig({ testTimeout: 15_000, hookTimeout: 30_000 });
let root: string, fixture: QianchuanFixture, browser: Browser;
const pages: Page[] = [], signal = new AbortController().signal;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "qianchuan-diagnostics-"));
  fixture = await startQianchuanFixture({ tempRoot: root, chromeExecutable: await resolveChromeExecutable(), production: true, fixtureHtml: path.resolve("tests/fixtures/qianchuan-production-page.html") });
  browser = await chromium.connectOverCDP(fixture.cdpEndpoint, { noDefaults: true });
});
afterEach(async () => { await Promise.all(pages.splice(0).map(page => page.close().catch(() => undefined))); fixture?.reset(); });
afterAll(async () => { await browser?.close(); await fixture?.stop(); if (root) await rm(root, { recursive: true, force: true }); });

async function task(name = `${randomUUID()}.mp4`): Promise<UploadTaskRecord> {
  const snapshotPath = path.join(root, name), bytes = Buffer.from(`isolated-diagnostic-${name}`);
  await writeFile(snapshotPath, bytes);
  const input = { project_id: randomUUID(), batch_id: randomUUID(), export_task_id: randomUUID(), video_path: snapshotPath, artifact_sha256: createHash("sha256").update(bytes).digest("hex"), size_bytes: bytes.length };
  const target = { product: "眼贴" as const, cdpEndpoint: fixture.cdpEndpoint, advertiserId: "123456", adId: "987654", configDigest: "d".repeat(64) };
  const authorization = { target, pageBatchId: randomUUID(), expectedCount: 1 };
  return { input, inputDigest: frozenInputDigest(input, authorization), authorization, snapshotPath,
    config: QianchuanUploadConfigSchema.parse({ enabled: true, timeouts: { navigation: 2000, action: 2000, fileInput: 500, processing: 2000 } }),
    result: { project_id: input.project_id, batch_id: input.batch_id, export_task_id: input.export_task_id, upload_task_id: uploadTaskId(input, target), artifact_sha256: input.artifact_sha256,
      file_name: name, accountProduct: target.product, advertiserId: target.advertiserId, adId: target.adId, state: "PENDING", upload_outcome: "NOT_SELECTED", retryable: false, retry_count: 0, attempt_count: 1, timestamp: new Date().toISOString() } };
}
async function session(value: UploadTaskRecord) {
  const page = await browser.contexts()[0]!.newPage(); pages.push(page);
  const port = new QianchuanPageSession(page, fixture.contract, current => current.throwIfAborted());
  await page.goto(port.url(value));
  const cdp = await page.context().newCDPSession(page);
  const targetId = (await cdp.send("Target.getTargetInfo")).targetInfo.targetId as string; await cdp.detach();
  return { page, port, targetId };
}
async function select(value: UploadTaskRecord, prepared: Awaited<ReturnType<typeof session>>) {
  const owned = await prepared.port.prepare([value], [], prepared.targetId, signal);
  value.result.upload_outcome = "MAY_HAVE_UPLOADED"; await prepared.port.upload([value], signal);
  return owned.pageOwnership;
}
async function zeroConfirmation(expectedDrops: number) {
  await vi.waitFor(async () => {
    const events = (await fixture.inspect()).events;
    expect(events.filter(event => event.type === "confirm")).toHaveLength(0);
    expect(events.filter(event => event.type === "drop")).toHaveLength(expectedDrops);
  });
}

async function deleted(prepared: Awaited<ReturnType<typeof session>>, text = "已删除") {
  await prepared.page.locator("#plan-ad-id").evaluate((element, value) => {
    let header = element.closest(".oc-promotion-key-info-bar-info-con");
    if (!header) { header = document.createElement("div"); header.className = "oc-promotion-key-info-bar-info-con"; element.before(header); header.append(element); }
    const badge = document.createElement("div"); badge.className = "oc-tag-text"; badge.textContent = value; header.append(badge);
  }, text);
}

describe("target plan availability", () => {
  it("rejects the target header's deleted plan before opening an upload modal", async () => {
    const value = await task(), prepared = await session(value); await deleted(prepared);
    await expect(prepared.port.prepare([value], [], prepared.targetId, signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED", message: expect.stringContaining("987654 已删除"), next_action: expect.stringContaining("改传当前计划") } });
    expect(await prepared.page.locator(fixture.contract.modal).isVisible()).toBe(false); await zeroConfirmation(0);
  });
  it("rejects visible deleted text in a zero-height status badge before opening an upload modal", async () => {
    const value = await task(), prepared = await session(value); await deleted(prepared);
    const geometry = await prepared.page.locator(".oc-tag-text").filter({ hasText: /^已删除$/ }).evaluate(element => {
      (element as HTMLElement).style.lineHeight = "0px";
      const text = document.createRange(); text.selectNodeContents(element);
      return { badgeHeight: element.getBoundingClientRect().height, textHeight: text.getBoundingClientRect().height };
    });
    expect(geometry.badgeHeight).toBe(0); expect(geometry.textHeight).toBeGreaterThan(0);
    await expect(prepared.port.prepare([value], [], prepared.targetId, signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED", message: expect.stringContaining("987654 已删除") } });
    expect(await prepared.page.locator(fixture.contract.modal).isVisible()).toBe(false); await zeroConfirmation(0);
  });
  it.each(["display: none", "visibility: hidden"])("ignores deleted text hidden by %s in the target header", async style => {
    const value = await task(), prepared = await session(value); await deleted(prepared);
    await prepared.page.locator(".oc-tag-text").filter({ hasText: /^已删除$/ }).evaluate((element, value) => element.setAttribute("style", value), style);
    await select(value, prepared);
    expect((await prepared.port.ready([value], signal))[0]!.adId).toBe("987654"); await zeroConfirmation(1);
  });
  it("rejects deletion after preparation without selecting a file", async () => {
    const value = await task(), prepared = await session(value);
    await prepared.port.prepare([value], [], prepared.targetId, signal); await deleted(prepared);
    value.result.upload_outcome = "MAY_HAVE_UPLOADED";
    await expect(prepared.port.upload([value], signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED", message: expect.stringContaining("已删除") } });
    await zeroConfirmation(0);
  });
  it("keeps selected files read-only after deletion", async () => {
    const value = await task(), prepared = await session(value), ownership = await select(value, prepared);
    await prepared.port.ready([value], signal); value.result.upload_outcome = "READY"; await deleted(prepared);
    const restored = new QianchuanPageSession(prepared.page, fixture.contract, current => current.throwIfAborted());
    await expect(restored.restore(value, ownership, [{ fileName: value.result.file_name, index: 1, ready: true }], prepared.targetId, signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    await zeroConfirmation(1);
  });
  it("does not confuse other plan or material deletion text with target status", async () => {
    const value = await task(), prepared = await session(value); await deleted(prepared, "投放中");
    await prepared.page.locator(".ad-drawer-body").first().evaluate(element => { const badge=document.createElement("div"); badge.className="oc-tag-text"; badge.textContent="已删除"; element.append(badge); });
    const ownership = await select(value, prepared); expect(ownership.pageBatchId).toBe(value.authorization.pageBatchId);
    expect((await prepared.port.ready([value], signal))[0]!.adId).toBe("987654"); await zeroConfirmation(1);
  });
  it("refuses an unknown header structure instead of assuming the plan is available", async () => {
    const value = await task(), prepared = await session(value);
    await prepared.page.locator(".oc-promotion-key-info-bar-info-con").evaluate(header => header.replaceWith(...Array.from(header.children)));
    await expect(prepared.port.prepare([value], [], prepared.targetId, signal)).rejects.toMatchObject({failure:{code:"PAGE_CONTRACT_CHANGED"}});
    await zeroConfirmation(0);
  });
});
