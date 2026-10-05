import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { QianchuanPageSession, parseSelectedCount, PRODUCTION_QIANCHUAN_CONTRACT, qianchuanReadiness } from "../src/main/qianchuan-page-contract";
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

it("only admits explicit selected/capacity observations, not arbitrary count text", () => {
  expect(parseSelectedCount("已选择 2/10")).toEqual({ selected: 2, capacity: 10 });
  expect(parseSelectedCount(" 已选择 0 / 250 ")).toEqual({ selected: 0, capacity: 250 });
  expect(parseSelectedCount("已选择 1/64：")).toEqual({ selected: 1, capacity: 64 });
  for (const value of ["2", "已选择 2/1", "已选择 0/0", "已选择 -1/3", "已选择 1/3 上传完成", "已选择 1/64：上传完成", "已选择 1/99999999999999999999"]) expect(() => parseSelectedCount(value)).toThrow();
});
it("uses the finite production page contract without claiming live acceptance", () => {
  expect(PRODUCTION_QIANCHUAN_CONTRACT).toBeDefined();
  expect(qianchuanReadiness()).toBeUndefined();
});
it("builds the exact production account URL from frozen account fields without leaking the config digest", () => {
  const session = new QianchuanPageSession({} as Page, PRODUCTION_QIANCHUAN_CONTRACT, () => undefined);
  const task = {
    authorization: { target: { product: "眼贴", cdpEndpoint: "http://127.0.0.1:9222", advertiserId: "123456", adId: "987654", configDigest: "d".repeat(64) } },
  } as UploadTaskRecord;
  expect(session.url(task)).toBe("https://qianchuan.jinritemai.com/uni-prom?aavid=123456&adId=987654#umg=1");
});

describe("owned upload modal stability", () => {
  it("waits for the same owned modal to become visible without selecting again", async () => {
    const value = await task(), prepared = await session(value); await select(value, prepared);
    await prepared.page.locator(fixture.contract.modal).evaluate(element => {
      (element as HTMLElement).style.visibility = "hidden";
      setTimeout(() => { (element as HTMLElement).style.visibility = "visible"; }, 350);
    });
    const evidence = await prepared.port.ready([value], signal);
    expect(evidence[0]!.fileName).toBe(value.result.file_name); await zeroConfirmation(1);
  });

  it("also tolerates hiding that starts during an ownership check", async () => {
    const value = await task(), prepared = await session(value); await select(value, prepared);
    await prepared.page.locator(fixture.contract.modal).evaluate(element => {
      const readAttribute = element.getAttribute;
      element.getAttribute = function (name: string) {
        const value = readAttribute.call(this, name);
        if (name === "data-jianji-upload-session") {
          this.getAttribute = readAttribute;
          queueMicrotask(() => {
            (element as HTMLElement).style.visibility = "hidden";
            setTimeout(() => { (element as HTMLElement).style.visibility = "visible"; }, 350);
          });
        }
        return value;
      };
    });
    const evidence = await prepared.port.ready([value], signal);
    expect(evidence[0]!.fileName).toBe(value.result.file_name); await zeroConfirmation(1);
  });

  it("rejects a replacement modal even when it copies the ownership tag", async () => {
    const value = await task(), prepared = await session(value); await select(value, prepared);
    await prepared.page.locator(fixture.contract.modal).evaluate(element => element.replaceWith(element.cloneNode(true)));
    await expect(prepared.port.ready([value], signal)).rejects.toMatchObject({ failure: { code: "UPLOAD_OUTCOME_UNKNOWN" } });
    await zeroConfirmation(1);
  });

  it.each(["timeout", "abort"] as const)("stops a hidden owned modal on %s without file or confirmation actions", async mode => {
    const value = await task(), prepared = await session(value); await select(value, prepared);
    value.config.timeouts.action = 150;
    await prepared.page.locator(fixture.contract.modal).evaluate(element => { (element as HTMLElement).style.visibility = "hidden"; });
    const controller = new AbortController();
    const timer = mode === "abort" ? setTimeout(() => controller.abort(), 60) : undefined;
    try {
      if (mode === "abort") await expect(prepared.port.ready([value], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
      else await expect(prepared.port.ready([value], controller.signal)).rejects.toMatchObject({ failure: { code: "UPLOAD_OUTCOME_UNKNOWN" } });
    } finally { clearTimeout(timer); }
    await zeroConfirmation(1);
  });

});
