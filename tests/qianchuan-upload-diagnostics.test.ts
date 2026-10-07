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
async function zeroConfirmation(expectedSelections: number) {
  await vi.waitFor(async () => {
    const events = (await fixture.inspect()).events;
    expect(events.filter(event => event.type === "confirm")).toHaveLength(0);
    expect(events.filter(event => event.type === "files")).toHaveLength(expectedSelections);
  });
}

describe("finite upload blocker diagnostics", () => {
  it("refuses an unrecognized click control before preparing a file selection", async () => {
    const value = await task(), prepared = await session(value);
    await prepared.page.locator('[data-e2e="oc_emptyKey_uni-prom__createMaterialUploadVideo"]').getByText("点击上传", { exact: true }).evaluate(element => element.textContent = "其他操作");
    await expect(prepared.port.prepare([value], [], prepared.targetId, signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    expect(value.result.upload_outcome).toBe("NOT_SELECTED");
    expect((await fixture.inspect()).events.filter(event => ["files", "drop", "chooser-open", "confirm", "settings"].includes(event.type))).toEqual([]);
  });

  it("stops a persistently loading entrance before a file fence or chooser action", async () => {
    fixture.setControls({ entranceLoading: true });
    const value = await task(), prepared = await session(value); value.config.timeouts.action = 200;
    await expect(prepared.port.prepare([value], [], prepared.targetId, signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED", message: expect.stringContaining("忙碌") } });
    expect(value.result.upload_outcome).toBe("NOT_SELECTED");
    expect((await fixture.inspect()).events.filter(event => ["files", "drop", "chooser-open", "confirm", "settings"].includes(event.type))).toEqual([]);
  });

  it.each([
    { chooserAccept: "image/png" }, { chooserMultiple: false }, { chooserWrongPlan: true }, { chooserMissing: true }
  ])("rejects an invalid or missing native chooser without delivering files: %j", async controls => {
    fixture.setControls(controls);
    const value = await task(), prepared = await session(value); value.config.timeouts.action = 300;
    await expect(prepared.port.prepare([value], [], prepared.targetId, signal)).rejects.toMatchObject({ failure: { code: "chooserMissing" in controls ? "TIMEOUT" : "PAGE_CONTRACT_CHANGED" } });
    expect(value.result.upload_outcome).toBe("NOT_SELECTED");
    await zeroConfirmation(0);
    expect((await fixture.inspect()).events.filter(event => event.type === "files")).toEqual([]);
    expect((await fixture.inspect()).events.filter(event => event.type === "chooser-open")).toHaveLength(1);
  });

  it("cancels an outstanding chooser without a delayed file action", async () => {
    fixture.setControls({ chooserMissing: true });
    const value = await task(), prepared = await session(value);
    const cancellation = new AbortController();
    const operation = prepared.port.prepare([value], [], prepared.targetId, cancellation.signal);
    await vi.waitFor(async () => expect((await fixture.inspect()).events.filter(event => event.type === "chooser-open")).toHaveLength(1));
    cancellation.abort();
    await expect(operation).rejects.toThrow();
    expect((await fixture.inspect()).events.filter(event => ["files", "drop", "confirm", "settings"].includes(event.type))).toEqual([]);
    await prepared.page.waitForTimeout(350);
    expect((await fixture.inspect()).events.filter(event => event.type === "files")).toEqual([]);
  });

  it("holds exactly one validated chooser across the durable-fence window", async () => {
    const value = await task(), prepared = await session(value);
    const detach = vi.spyOn(prepared.page, "off");
    await prepared.port.prepare([value], [], prepared.targetId, signal);
    await zeroConfirmation(0);
    expect((await fixture.inspect()).events.filter(event => event.type === "chooser-open")).toHaveLength(1);
    await prepared.page.waitForTimeout(150);
    value.result.upload_outcome = "MAY_HAVE_UPLOADED";
    await prepared.port.upload([value], signal);
    await zeroConfirmation(1);
    expect((await fixture.inspect()).events.filter(event => event.type === "chooser-open")).toHaveLength(1);
    expect(detach).toHaveBeenCalledWith("filechooser", expect.any(Function));
  });

  it("refuses a second chooser during fence persistence without sending files", async () => {
    const value = await task(), prepared = await session(value);
    const detach = vi.spyOn(prepared.page, "off");
    await prepared.port.prepare([value], [], prepared.targetId, signal);
    await prepared.page.locator('[data-e2e="oc_emptyKey_uni-prom__createMaterialUploadVideo"]').getByText("点击上传", { exact: true }).click();
    value.result.upload_outcome = "MAY_HAVE_UPLOADED";
    await expect(prepared.port.upload([value], signal)).rejects.toThrow();
    await zeroConfirmation(0);
    expect(detach).toHaveBeenCalledWith("filechooser", expect.any(Function));
  });

  const permissionReason = "当前账户无该抖音号的全域投放权限，不支持添加素材";
  async function permissionTooltip(page: Page, mode: "hover" | "existing" | "hidden" | "distant") {
    await page.locator("#add-video-button").evaluate((element, { reason, mode }) => {
      element.setAttribute("disabled", "");
      const tip = document.createElement("div"); tip.setAttribute("role", "tooltip"); tip.textContent = reason;
      const box = element.getBoundingClientRect();
      Object.assign(tip.style, { position: "fixed", left: `${mode === "distant" ? 800 : box.left}px`, top: `${mode === "distant" ? 600 : box.top - 30}px`, display: mode === "existing" ? "block" : "none" });
      document.body.append(tip);
      if (mode !== "hidden") element.addEventListener("mouseenter", () => {
        if (mode === "hover") { const visibleBox = element.getBoundingClientRect(); tip.style.left = `${visibleBox.left}px`; tip.style.top = `${visibleBox.top - 30}px`; }
        tip.style.display = "block";
      });
    }, { reason: permissionReason, mode });
  }

  it("identifies the shop permission reason revealed by hovering the disabled add button before file actions", async () => {
    const value = await task(), prepared = await session(value);
    await permissionTooltip(prepared.page, "hover");
    await expect(prepared.port.prepare([value], [], prepared.targetId, signal)).rejects.toMatchObject({ failure: {
      code: "ACCOUNT_UNCONFIRMED", category: "account", message: expect.stringContaining("店铺权限问题（非简辑程序故障）"), next_action: expect.stringContaining("店铺管理员"),
    } });
    await zeroConfirmation(0);
  });

  it.each(["existing", "hidden", "distant"] as const)("does not attribute a %s permission tooltip to the disabled add button", async mode => {
    const value = await task(), prepared = await session(value);
    await permissionTooltip(prepared.page, mode);
    await expect(prepared.port.prepare([value], [], prepared.targetId, signal)).rejects.toMatchObject({ failure: {
      code: "PAGE_CONTRACT_CHANGED", message: expect.stringContaining("平台业务原因尚未确认"),
    } });
    await zeroConfirmation(0);
  });

  it("explains a platform-disabled 添加视频 before any file action without guessing a business reason", async () => {
    const value = await task(), prepared = await session(value);
    await prepared.page.locator("#add-video-button").evaluate(element => element.setAttribute("disabled", ""));
    await expect(prepared.port.prepare([value], [], prepared.targetId, signal)).rejects.toMatchObject({ failure: {
      code: "PAGE_CONTRACT_CHANGED", message: expect.stringContaining("添加视频”按钮已禁用"), next_action: expect.stringContaining("人工核查"),
    } });
    await zeroConfirmation(0);
  });

  it("a missing selected filename reports bounded UNKNOWN during delivery and original-page checks", async () => {
    const value = await task("竞品详情-抖音电商罗盘 - 2026-09-15T234613.318_edited.mp4");
    fixture.setControls({ removeName: value.result.file_name });
    const prepared = await session(value);
    const started = Date.now();
    await expect(select(value, prepared)).rejects.toMatchObject({ failure: {
      code: "UPLOAD_OUTCOME_UNKNOWN", message: expect.stringContaining("未出现在"), next_action: expect.stringContaining("禁止重新选文件"),
    } });
    expect(Date.now() - started).toBeLessThan(value.config.timeouts.processing);
    await expect(prepared.port.ready([value], signal)).rejects.toMatchObject({ failure: {
      code: "UPLOAD_OUTCOME_UNKNOWN", message: expect.stringContaining("未出现在"), next_action: expect.stringContaining("禁止重新选文件"),
    } });
    await zeroConfirmation(1);
  });

  it("visible rows may keep processing beyond the row-appearance deadline", async () => {
    const value = await task(); fixture.setControls({ rowAppearanceDelayMs: 150, processingDelayMs: 800 });
    const prepared = await session(value); await select(value, prepared);
    const evidence = await prepared.port.ready([value], signal);
    expect(evidence[0]!.fileName).toBe(value.result.file_name); await zeroConfirmation(1);
  });

  it("a missing original modal remains UNKNOWN during read-only recovery and never selects again", async () => {
    const value = await task(), prepared = await session(value), ownership = await select(value, prepared);
    await prepared.port.ready([value], signal); value.result.upload_outcome = "READY";
    await prepared.page.locator(fixture.contract.modal).evaluate(element => element.remove());
    const restored = new QianchuanPageSession(prepared.page, fixture.contract, current => current.throwIfAborted());
    await expect(restored.restore(value, ownership, [{ fileName: value.result.file_name, index: 1, ready: true }], prepared.targetId, signal)).rejects.toMatchObject({ failure: {
      code: "UPLOAD_OUTCOME_UNKNOWN", message: expect.stringContaining("原上传弹窗"), next_action: expect.stringContaining("不能"),
    } });
    await zeroConfirmation(1);
  });

  it("an original modal with a replaced ownership tag cannot be recovered", async () => {
    const value = await task(), prepared = await session(value), ownership = await select(value, prepared);
    await prepared.port.ready([value], signal);
    await prepared.page.locator(fixture.contract.modal).evaluate(element => element.setAttribute("data-jianji-upload-session", "another-session"));
    await expect(prepared.port.restore(value, ownership, [{ fileName: value.result.file_name, index: 1, ready: true }], prepared.targetId, signal)).rejects.toMatchObject({ failure: { code: "UPLOAD_OUTCOME_UNKNOWN", message: expect.stringContaining("归属") } });
    await zeroConfirmation(1);
  });
});
