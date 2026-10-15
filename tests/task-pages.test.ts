import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { taskPagesFixtureScript, taskPagesFixtureStyles } from "./helpers/task-pages-fixture";
import { createCoverReviewDraft, editCoverReviewDraft } from "../src/main/cover-review-session";
import { DEFAULT_COVER_STICKER } from "../src/shared/cover-sticker";
import type { MediaItem } from "../src/main/domain";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });
async function fixture() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(4000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://127.0.0.1:3000/task-pages", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("http://127.0.0.1:3000/task-pages");
  await page.exposeFunction("editTaskPageReview", editCoverReviewDraft);
  await page.addStyleTag({ content: taskPagesFixtureStyles() });
  await page.addScriptTag({ content: taskPagesFixtureScript() });
  await page.getByRole("heading", { name: "素材", exact: true }).waitFor();
  return { page, errors };
}
const workflow = (page: Page, name: string) => page.getByRole("navigation", { name: "制作流程" }).getByRole("button", { name: new RegExp(name + "$" ) });
const rail = (page: Page, name: string) => page.locator(".workspace-rail").getByRole("button", { name, exact: true });

it("opens the effect loop and returns to production configuration without starting production", async () => {
  const { page, errors } = await fixture();
  try {
    await rail(page, "千川").click();
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "制作与效果", exact: true }).click();
    await page.getByRole("heading", { name: "制作与效果", exact: true }).waitFor();
    await page.getByRole("button", { name: "制作并配置上传", exact: true }).click();
    await page.getByRole("heading", { name: "输出确认", exact: true }).waitFor();
    const calls = await page.evaluate(() => (window as any).taskPagesFixture.calls);
    expect(calls.starts).toEqual([]); expect(calls.batchStarts).toEqual([]); expect(calls.sideEffects).toEqual([]); expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("opens the business console directly and returns to the original query and upload pages without production", async () => {
  const { page, errors } = await fixture();
  try {
    await page.addStyleTag({ content: readFileSync("src/renderer/qianchuan-backend.css", "utf8") });
    await page.evaluate(() => {
      const f = (window as any).taskPagesFixture;
      f.calls.supplierReads = [];
      window.jianji.queryQianguanjia = async input => {
        f.calls.supplierReads.push(input.kind);
        if (input.kind === "discover") return { requestId: input.requestId, kind: "discover", unavailableBrowsers: 0, sessions: [{ sessionId: "6fcb5ecd-7608-4a57-bf4d-26625804a38c", label: "隔离授权页面" }] };
        if (input.kind === "accounts") return { ...input, data: { source: "qianguanjia", observedAt: "2026-10-14T08:00:00Z", accounts: [{ advertiserId: "1879999999999999999", name: "隔离授权账户", authStatus: 1, authStatusDesc: "授权正常" }] } };
        if (input.kind === "home") return { ...input, data: { source: "qianguanjia", scope: "supplier-home-aggregate", date: "2026-10-14", observedAt: "2026-10-14T08:00:00Z", groups: Object.fromEntries(["ALL", "LIVE_PROM_GOODS", "VIDEO_PROM_GOODS"].map(key => [key, { current: { statCost: "12.34", totalPayOrderCountForRoi2: "3", totalPayOrderGmvIncludeCouponForRoi2: "99.99", totalPrepayAndPayOrderRoi2: "8.10" }, comparison: {} }])) } } as any;
        throw new Error("unexpected supplier query");
      };
      window.jianji.cancelQianguanjiaQuery = async () => {};
      window.jianji.disconnectQianguanjia = async () => {};
    });
    await rail(page, "千川").click();
    const nav = page.getByRole("navigation", { name: "千川页面" });
    await nav.getByRole("button", { name: "投放工作台", exact: true }).click();
    expect(await page.getByLabel("数据来源", { exact: true }).inputValue()).toBe("qianchuan");
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.supplierReads)).toEqual([]);
    await page.getByLabel("数据来源", { exact: true }).selectOption("qianguanjia");
    await page.getByRole("heading", { name: "数据概览", exact: true }).waitFor();
    await page.getByRole("button", { name: "连接已授权账户", exact: true }).click();
    await page.getByTestId("qianguanjia-home").waitFor();
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.supplierReads)).toEqual(["discover", "accounts", "home"]);
    await page.getByRole("navigation", { name: "投放工作台业务导航" }).getByRole("button", { name: "推广管理", exact: true }).click();
    expect(await page.getByLabel("数据来源", { exact: true }).inputValue()).toBe("qianchuan");
    await page.getByLabel("查询内容", { exact: true }).selectOption("report");
    await page.getByLabel("数据来源", { exact: true }).selectOption("qianguanjia");
    await page.getByRole("heading", { name: "数据概览", exact: true }).waitFor();
    expect(await page.getByTestId("qianguanjia-home").count()).toBe(0);
    await page.getByRole("button", { name: "计划 · ROI · 预算", exact: true }).click();
    expect(await page.getByLabel("查询内容", { exact: true }).inputValue()).toBe("report");
    await nav.getByRole("button", { name: "上传任务", exact: true }).click();
    expect(await page.getByText("当前项目没有千川上传任务。", { exact: true }).isVisible()).toBe(true);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.sideEffects)).toEqual([]);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.starts)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("opens the Qianchuan query page and uses the selected saved account without upload work", async () => {
  const { page, errors } = await fixture();
  try {
    await page.evaluate(() => {
      const f = (window as any).taskPagesFixture;
      f.state.douyinUpload.accounts = [{ product: "眼贴", advertiserId: "12345", adId: "67890", available: true }];
      f.calls.backendQueries = [];
      window.jianji.queryQianchuanBackend = async input => {
        f.calls.backendQueries.push(input);
        return { kind: "plan", advertiserId: "12345", adId: "67890", name: "已查询的计划", observedAt: "2026-10-13T10:00:00Z", budget: "500", roiGoal: "2", products: [] };
      };
      window.jianji.cancelQianchuanBackendQuery = async () => {};
      f.emit();
    });
    await rail(page, "千川").click();
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "计划与数据" }).click();
    expect(await page.getByLabel("查询计划 ID").inputValue()).toBe("67890");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByRole("heading", { name: "已查询的计划" }).waitFor();
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.backendQueries)).toEqual([expect.objectContaining({ kind: "plan", expectedAdvertiserId: "12345", adId: "67890" })]);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.starts)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("exposes saved upload methods and preserves isolated route drafts without starting work", async () => {
  const { page, errors } = await fixture();
  try {
    const remote = { mode: "remote-browser", group: "主体一", sshHost: "shop-one", localPort: 19381, expectedIp: "203.0.113.11" };
    const local = { group: "主体二", sshHost: "shop-two", localPort: 19382, expectedIp: "203.0.113.12" };
    await page.evaluate(({ remote, local }) => {
      const f = (window as any).taskPagesFixture;
      f.state.douyinUpload.accounts = [
        { product: "蝴蝶贴", browserProfileName: "远端账号", advertiserId: "123", adId: "456", available: true, egress: remote },
        { product: "眼贴", browserProfileName: "代理账号", advertiserId: "124", adId: "457", available: true, egress: local },
        { product: "肥皂", browserProfileName: "本机账号", advertiserId: "125", adId: "458", available: true },
      ];
      f.calls.accountSaves = []; f.calls.configSaves = [];
      window.jianji.saveQianchuanAccount = async input => { f.calls.accountSaves.push(structuredClone(input)); throw new Error("隔离保存失败"); };
      window.jianji.saveDouyinUploadConfig = async config => { f.calls.configSaves.push(structuredClone(config)); f.state.douyinUpload.config = structuredClone(config); return structuredClone(f.state); };
      f.emit();
    }, { remote, local });
    await rail(page, "千川").click();
    const nav = page.getByRole("navigation", { name: "千川页面" });
    await nav.getByRole("button", { name: "账号与计划", exact: true }).click();
    const cards = page.locator(".qianchuan-account-products");
    expect(await cards.isVisible()).toBe(true);
    expect(await cards.getByRole("button", { name: /远端账号.*账户 123.*VPS 上传/ }).isVisible()).toBe(true);
    expect(await cards.getByRole("button", { name: /代理账号.*账户 124.*本机上传 · VPS 出口/ }).isVisible()).toBe(true);
    expect(await cards.getByRole("button", { name: /本机账号.*账户 125.*本机上传/ }).isVisible()).toBe(true);
    expect((await cards.boundingBox())!.y).toBeLessThan(600);
    await cards.getByRole("button", { name: /远端账号.*账户 123/ }).click();
    expect(await page.getByLabel("SSH 主机别名", { exact: true }).isVisible()).toBe(false);
    await page.getByText("高级连接设置", { exact: true }).click();
    expect(await page.getByRole("radio", { name: "VPS 上传", exact: true }).isChecked()).toBe(true);
    expect(await page.getByLabel("SSH 主机别名", { exact: true }).inputValue()).toBe("shop-one");
    expect(await page.getByLabel("复用已设置的主体", { exact: true }).inputValue()).toBe(remote.group);
    await page.getByRole("radio", { name: "本机上传 · VPS 出口", exact: true }).check();
    expect(await page.getByLabel("预期出口 IPv4", { exact: true }).inputValue()).toBe(remote.expectedIp);
    await page.getByRole("radio", { name: "VPS 上传", exact: true }).check();
    await page.getByLabel("主体代号", { exact: true }).fill("未保存主体");
    expect(await page.getByLabel("复用已设置的主体", { exact: true }).inputValue()).toBe("");
    await cards.getByRole("button", { name: /远端账号.*账户 123/ }).click();
    expect(await page.getByLabel("主体代号", { exact: true }).inputValue()).toBe("未保存主体");
    await nav.getByRole("button", { name: "上传任务", exact: true }).click();
    await nav.getByRole("button", { name: "账号与计划", exact: true }).click();
    expect(await page.getByLabel("主体代号", { exact: true }).inputValue()).toBe("未保存主体");
    await page.getByRole("button", { name: "保存账号", exact: true }).click();
    await page.locator("#qianchuan-account-editor").getByRole("alert").filter({ hasText: "隔离保存失败" }).waitFor();
    expect(await page.getByLabel("主体代号", { exact: true }).inputValue()).toBe("未保存主体");
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.accountSaves[0].egress)).toEqual({ ...remote, group: "未保存主体" });
    await page.getByLabel("复用已设置的主体", { exact: true }).selectOption(local.group);
    expect(await page.getByLabel("复用已设置的主体", { exact: true }).inputValue()).toBe(local.group);
    expect(await page.getByRole("radio", { name: "VPS 上传", exact: true }).isChecked()).toBe(true);
    expect(await page.getByLabel("SSH 主机别名", { exact: true }).inputValue()).toBe(local.sshHost);
    expect(await page.getByRole("button", { name: "保存账号", exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole("alert").filter({ hasText: "同主体必须使用相同出口设置" }).isVisible()).toBe(true);
    expect(await page.getByLabel("主体代号", { exact: true }).inputValue()).toBe(local.group);
    await page.getByRole("radio", { name: "本机上传 · VPS 出口", exact: true }).check();
    await page.getByLabel("复用已设置的主体", { exact: true }).selectOption(remote.group);
    expect(await page.getByLabel("复用已设置的主体", { exact: true }).inputValue()).toBe(remote.group);
    expect(await page.getByRole("radio", { name: "本机上传 · VPS 出口", exact: true }).isChecked()).toBe(true);
    expect(await page.getByLabel("SSH 主机别名", { exact: true }).inputValue()).toBe(remote.sshHost);
    expect(await page.getByLabel("主体代号", { exact: true }).inputValue()).toBe(remote.group);
    expect(await page.getByLabel("预期出口 IPv4", { exact: true }).inputValue()).toBe(remote.expectedIp);
    expect(await page.getByLabel("本地连接端口", { exact: true }).inputValue()).toBe(String(remote.localPort));
    await page.getByLabel("SSH 主机别名", { exact: true }).fill("未保存别名");
    expect(await page.getByLabel("复用已设置的主体", { exact: true }).inputValue()).toBe("");
    await page.getByLabel("复用已设置的主体", { exact: true }).selectOption(remote.group);
    expect(await page.getByLabel("SSH 主机别名", { exact: true }).inputValue()).toBe(remote.sshHost);
    expect(await page.getByLabel("复用已设置的主体", { exact: true }).inputValue()).toBe(remote.group);
    await page.getByLabel("复用已设置的主体", { exact: true }).selectOption(local.group);
    expect(await page.getByRole("radio", { name: "本机上传 · VPS 出口", exact: true }).isChecked()).toBe(true);
    expect(await page.getByRole("button", { name: "保存账号", exact: true }).isDisabled()).toBe(false);
    await cards.getByRole("button", { name: /本机账号.*账户 125/ }).click();
    expect(await page.getByRole("radio", { name: "本机上传", exact: true }).isChecked()).toBe(true);
    expect(await page.getByLabel("SSH 主机别名", { exact: true }).count()).toBe(0);
    await page.getByRole("radio", { name: "VPS 上传", exact: true }).check();
    expect(await page.getByRole("button", { name: "保存账号", exact: true }).isDisabled()).toBe(true);
    expect(await page.getByLabel("SSH 主机别名", { exact: true }).inputValue()).toBe("");
    await cards.getByRole("button", { name: /代理账号.*账户 124/ }).click();
    expect(await page.getByRole("radio", { name: "本机上传 · VPS 出口", exact: true }).isChecked()).toBe(true);
    await page.getByRole("button", { name: "保存账号", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).taskPagesFixture.calls.accountSaves.length)).toBe(2);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.accountSaves[1].egress)).toEqual(local);
    await page.getByRole("radio", { name: "本机上传", exact: true }).check();
    await page.getByRole("button", { name: "保存账号", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).taskPagesFixture.calls.accountSaves.length)).toBe(3);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.accountSaves[2].egress)).toBeNull();
    await page.getByRole("checkbox", { name: "启用千川上传", exact: true }).check();
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.configSaves)).toEqual([]);
    await page.getByRole("button", { name: "保存上传设置", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).taskPagesFixture.calls.configSaves.length)).toBe(1);
    for (const width of [760, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await cards.boundingBox())!.width).toBeLessThan(width);
    }
    await page.evaluate(() => { window.jianji.saveQianchuanAccount = async () => new Promise(() => {}); });
    await page.getByRole("button", { name: "保存账号", exact: true }).click();
    await expect.poll(() => page.getByRole("radio", { name: "VPS 上传", exact: true }).isDisabled()).toBe(true);
    expect(await cards.getByRole("button", { name: /远端账号.*账户 123/ }).isDisabled()).toBe(true);
    const calls = await page.evaluate(() => (window as any).taskPagesFixture.calls);
    expect(calls.starts).toEqual([]); expect(calls.batchStarts).toEqual([]); expect(calls.sideEffects).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("switches a subject without a checkbox or manual browser operation and shows failures beside save", async () => {
  const { page, errors } = await fixture();
  try {
    const remote = { mode: "remote-browser", group: "主体一", sshHost: "shop-one", localPort: 19381, expectedIp: "203.0.113.11" };
    await page.evaluate(remote => {
      const f = (window as any).taskPagesFixture;
      f.state.douyinUpload.accounts = [
        { product: "蝴蝶贴", browserProfileName: "予浅", advertiserId: "123", adId: "456", available: true, egress: remote },
        { product: "眼贴", browserProfileName: "安序", advertiserId: "124", adId: "457", available: true, egress: remote },
      ];
      f.calls.accountSaves = []; f.rejectGroupSave = true;
      window.jianji.saveQianchuanAccount = async input => {
        f.calls.accountSaves.push(structuredClone(input));
        if (f.rejectGroupSave) throw Error("Error invoking remote method 'douyinUpload.saveAccount': Error: 该账号有待确认或结果未知的批次，暂时不能切换。");
        if (!input.egressGroupChange || !input.egress) throw Error("未明确同意主体切换。");
        const group = input.egressGroupChange.expected.group;
        f.state.douyinUpload.accounts = f.state.douyinUpload.accounts.map((account: any) => account.egress?.group === group ? { ...account, egress: structuredClone(input.egress) } : account);
        return structuredClone(f.state);
      };
      f.emit();
    }, remote);
    await rail(page, "千川").click();
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "账号与计划", exact: true }).click();
    const cards = page.locator(".qianchuan-account-products"), save = page.getByRole("button", { name: "保存账号", exact: true });
    await cards.getByRole("button", { name: /予浅.*账户 123/ }).click();
    await page.getByRole("radio", { name: "本机上传 · VPS 出口", exact: true }).check();
    expect(await page.getByRole("checkbox", { name: /^同时切换本主体全部账号/ }).count()).toBe(0);
    expect(await page.getByLabel("SSH 主机别名", { exact: true }).isVisible()).toBe(false);
    expect(await page.getByRole("button", { name: "关闭账号浏览器", exact: true }).isVisible()).toBe(false);
    expect(await save.isDisabled()).toBe(false);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.accountSaves)).toEqual([]);
    await page.evaluate(remote => {
      const f = (window as any).taskPagesFixture;
      f.state.douyinUpload.accounts.push({ product: "氨糖膏", browserProfileName: "新增成员", advertiserId: "126", adId: "459", available: true, egress: remote });
      f.emit();
    }, remote);
    await page.getByText(/同主体的 3 个账号将同步切换/).waitFor();
    expect(await save.isDisabled()).toBe(false);
    await save.click();
    await page.locator("#qianchuan-account-editor").getByRole("alert").filter({ hasText: "待确认或结果未知" }).waitFor();
    expect(await page.getByRole("alert").count()).toBe(1);
    expect(await page.getByRole("alert").innerText()).not.toContain("Error invoking remote method");
    expect(await page.getByRole("radio", { name: "本机上传 · VPS 出口", exact: true }).isChecked()).toBe(true);
    expect(await cards.getByRole("button", { name: /安序.*VPS 上传/ }).isVisible()).toBe(true);
    const input = await page.evaluate(() => (window as any).taskPagesFixture.calls.accountSaves[0]);
    expect(input.egressGroupChange).toEqual({ expected: remote, advertiserIds: ["123", "124", "126"] });
    const { mode: _mode, ...local } = remote;
    expect(input.egress).toEqual(local);
    await page.evaluate(() => { (window as any).taskPagesFixture.rejectGroupSave = false; });
    await save.click();
    await expect.poll(() => cards.getByRole("button", { name: /本机上传 · VPS 出口/ }).count()).toBe(3);
    expect(await page.locator("#qianchuan-account-editor").count()).toBe(0);
    await page.getByText("账号设置已保存，新制作将使用所选上传方式。", { exact: true }).waitFor();
    const calls = await page.evaluate(() => (window as any).taskPagesFixture.calls);
    expect(calls.starts).toEqual([]); expect(calls.sideEffects).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it.each([false, true])("shows old account batches, including a shared browser (%s), and requires explicit confirmation without changing the project", async sharedBrowser => {
  const { page, errors } = await fixture();
  try {
    const oldProject = "f97a1b03-0479-45e7-9e30-aee4d6da852c", batchId = "c9a5b359-a801-4429-b3c5-50c4ae6fb255";
    await page.evaluate(({ oldProject, batchId, sharedBrowser }) => {
      const f = (window as any).taskPagesFixture;
      f.state.douyinUpload.accounts = [{ product: "眼贴", advertiserId: "123", adId: "456", available: true }];
      f.state.douyinUpload.accountBatches = [{ projectId: oldProject, pageBatchId: batchId, accountProduct: sharedBrowser ? "热敷贴" : "眼贴", relatedAccountProducts: ["眼贴"], advertiserId: "999", adId: "456", expectedCount: 2, taskIds: ["a".repeat(64)], readyCount: 0, unknownCount: 1, notSelectedCount: 0, canClose: true },
        { projectId: oldProject, pageBatchId: "e6bf04d2-5074-4b44-aad8-809c60735ff9", accountProduct: "肥皂", advertiserId: "888", adId: "457", expectedCount: 1, taskIds: ["b".repeat(64)], readyCount: 1, unknownCount: 0, notSelectedCount: 0, canClose: true }];
      f.calls.accountClosures = [];
      window.jianji.closeQianchuanAccountUploadBatch = async input => {
        f.calls.accountClosures.push(structuredClone(input));
        f.state.douyinUpload.accountBatches = f.state.douyinUpload.accountBatches.filter((batch: any) => batch.pageBatchId !== input.expectedPageBatchId);
        return structuredClone(f.state);
      };
      f.emit();
    }, { oldProject, batchId, sharedBrowser });
    const beforeProject = await page.evaluate(() => (window as any).taskPagesFixture.state.project.id);
    await rail(page, "千川").click();
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "账号与计划", exact: true }).click();
    await page.locator(".qianchuan-account-products").getByRole("button", { name: /账户 123/ }).click();
    await page.getByText("查看未结束上传（1 批）", { exact: true }).click();
    await page.getByRole("button", { name: "结束本批本地上传", exact: true }).click();
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.accountClosures)).toEqual([]);
    await page.getByRole("button", { name: "保留本批", exact: true }).click();
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.accountClosures)).toEqual([]);
    await page.getByRole("button", { name: "结束本批本地上传", exact: true }).click();
    await page.getByRole("button", { name: "确认结束本批本地上传", exact: true }).click();
    await page.getByText("本批本地上传已结束。处理完剩余批次后，可再次保存上传方式。", { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.accountClosures)).toEqual([{ projectId: oldProject, uploadTaskId: "a".repeat(64), expectedPageBatchId: batchId }]);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.state.project.id)).toBe(beforeProject);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.sideEffects)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("opens the actual shared-browser blockers beside a failed save without ending them", async () => {
  const { page, errors } = await fixture();
  try {
    await page.evaluate(() => {
      const f = (window as any).taskPagesFixture;
      f.state.douyinUpload.accounts = [{ product: "眼贴", advertiserId: "123", adId: "456", available: true }];
      f.state.douyinUpload.accountBatches = [];
      f.calls.accountClosures = []; f.calls.accountSaves = [];
      window.jianji.saveQianchuanAccount = async input => {
        f.calls.accountSaves.push(input);
        f.state.douyinUpload.accountBatches = [{ projectId: "f97a1b03-0479-45e7-9e30-aee4d6da852c", pageBatchId: "c9a5b359-a801-4429-b3c5-50c4ae6fb255", accountProduct: "热敷贴", relatedAccountProducts: ["眼贴"], advertiserId: "999", adId: "456", expectedCount: 1, taskIds: ["a".repeat(64)], readyCount: 0, unknownCount: 1, notSelectedCount: 0, canClose: true }];
        f.emit(); throw new Error("该账号或共用浏览器有待确认或结果未知的批次，请在下方查看未结束上传。");
      };
      f.emit();
    });
    await rail(page, "千川").click();
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "账号与计划", exact: true }).click();
    await page.locator(".qianchuan-account-products").getByRole("button", { name: /账户 123/ }).click();
    await page.getByRole("button", { name: "保存账号", exact: true }).click();
    await page.getByRole("button", { name: "结束本批本地上传", exact: true }).waitFor({ state: "visible" });
    expect(await page.getByText("查看未结束上传（1 批）", { exact: true }).evaluate(el => (el.parentElement as HTMLDetailsElement).open)).toBe(true);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.accountClosures)).toEqual([]);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.sideEffects)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("selects and renames saved material templates directly beside an empty material list", async () => {
  const { page, errors } = await fixture();
  try {
    await page.evaluate(() => {
      const f = (window as any).taskPagesFixture;
      f.state.project.mediaItems = [];
      f.state.project.workspaceDraft.selectedMediaIds = [];
      f.calls.templateLoads = []; f.calls.templateRenames = [];
      const load = window.jianji.loadProject;
      window.jianji.loadProject = async id => {
        f.calls.templateLoads.push(id);
        const next = await load(id);
        f.state.activeRecentProjectId = id;
        return { ...next!, activeRecentProjectId: id };
      };
      window.jianji.renameSavedProject = async (id, name) => {
        f.calls.templateRenames.push({ id, name });
        f.state.recentProjects = f.state.recentProjects.map((project: any) => project.id === id ? { ...project, name } : project);
        if (f.state.activeRecentProjectId === id) f.state.project.name = name;
        return structuredClone(f.state);
      };
      f.emit();
    });
    const picker = page.getByRole("region", { name: "素材模板快捷选择", exact: true });
    await picker.getByLabel("已保存的素材模板", { exact: true }).click();
    expect(await picker.getByRole("button", { name: /删除模板/ }).count()).toBe(2);
    await picker.getByRole("option", { name: /项目 B/ }).click();
    expect(await page.getByRole("heading", { name: "素材", exact: true }).isVisible()).toBe(true);
    await expect.poll(() => page.getByRole("checkbox", { name: /^选择 素材 [ABC]\.mp4$/ }).count()).toBe(3);
    await workflow(page, "包装").click();
    expect(await page.locator("#product-price").inputValue()).toBe("B 的文字");
    await workflow(page, "输出确认").click();
    expect(await page.locator("#production-count").inputValue()).toBe("6");
    await workflow(page, "素材").click();
    await picker.getByLabel("已保存的素材模板", { exact: true }).click();
    await picker.getByRole("button", { name: "重命名模板 项目 B", exact: true }).click();
    await picker.getByRole("textbox", { name: "新的模板名称", exact: true }).fill("项目 B 新名称");
    await picker.getByRole("button", { name: "确认重命名", exact: true }).click();
    expect(await picker.getByLabel("已保存的素材模板", { exact: true }).innerText()).toContain("项目 B 新名称");
    const calls = await page.evaluate(() => (window as any).taskPagesFixture.calls);
    expect(calls.templateLoads).toHaveLength(1);
    expect(calls.templateRenames).toEqual([{ id: calls.templateLoads[0], name: "项目 B 新名称" }]);
    expect(calls.starts).toEqual([]); expect(calls.batchStarts).toEqual([]); expect(calls.sideEffects).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("keeps the active template after load failure and blocks template switching during production", async () => {
  const { page, errors } = await fixture();
  try {
    await page.evaluate(() => {
      const f = (window as any).taskPagesFixture;
      f.state.activeRecentProjectId = f.state.recentProjects[0].id;
      window.jianji.loadProject = async () => { throw new Error("隔离模板加载失败"); };
      f.emit();
    });
    const picker = page.getByRole("region", { name: "素材模板快捷选择", exact: true });
    const summary = picker.getByLabel("已保存的素材模板", { exact: true });
    await summary.click();
    await picker.getByRole("option", { name: /项目 B/ }).click();
    await page.getByRole("alert").filter({ hasText: "隔离模板加载失败" }).waitFor();
    expect(await summary.innerText()).toContain("蝴蝶贴");
    expect(await summary.innerText()).not.toContain("项目 B");
    await page.evaluate(() => {
      const f = (window as any).taskPagesFixture;
      f.state.agentRun = { id: crypto.randomUUID(), projectId: f.state.project.id, status: "running", usesModel: false, items: [] };
      f.emit();
    });
    await expect.poll(() => summary.getAttribute("aria-disabled")).toBe("true");
    await summary.click();
    expect(await picker.locator("details").getAttribute("open")).toBe(null);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("puts bulk works first and navigates to frozen upload details without resuming on navigation", async () => {
  const { page, errors } = await fixture();
  try {
    await page.evaluate(() => (window as any).taskPagesFixture.showBatchResults({ unknown: true }));
    await rail(page, "批量制作").click();
    await page.getByLabel("选择模板 蝴蝶贴", { exact: true }).check();
    await page.getByRole("spinbutton", { name: "想制作的视频条数", exact: true }).first().fill("123");
    await page.getByRole("button", { name: "查看 绿眼贴 作品", exact: true }).click();
    const works = page.getByRole("region", { name: "绿眼贴作品与任务", exact: true });
    await works.waitFor();
    expect(await works.getByRole("button", { name: "播放", exact: true }).count()).toBe(40);
    expect(await works.getByText("隔离渲染异常", { exact: true }).count()).toBe(10);
    expect(await works.evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(600);
    expect(await page.getByText("上传文件 0.mp4", { exact: true }).isVisible()).toBe(false);
    expect(await page.getByRole("button", { name: "安全继续", exact: true }).count()).toBe(0);
    const uploadButton = page.getByRole("button", { name: "查看本批上传任务", exact: true });
    await uploadButton.click();
    await page.getByRole("heading", { name: "绿眼贴 · 上传任务", exact: true }).waitFor();
    expect(await page.getByText("上传文件 0.mp4", { exact: true }).isVisible()).toBe(true);
    expect(await page.getByText(/账户 321 \/ 计划 654/).count()).toBe(40);
    expect(await page.getByRole("button", { name: "安全继续", exact: true }).first().isDisabled()).toBe(true);
    expect(await page.getByRole("region", { name: "本项千川上传", exact: true }).getByText("旧上传操作未能安全停止，请先关闭应用并核查 Chrome。", { exact: true }).isVisible()).toBe(true);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.batchResumes)).toEqual([]);
    await page.getByRole("button", { name: "核查原上传页", exact: true }).click();
    const observed = await page.evaluate(() => { const f = (window as any).taskPagesFixture; return { run: f.state.batchProduction, calls: f.calls }; });
    expect(observed.calls.batchResumes).toEqual([{ runId: observed.run.id, jobId: observed.run.jobs[0].id, uploadTaskId: "0".repeat(64) }]);
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "账号与计划", exact: true }).click();
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "上传任务", exact: true }).click();
    expect(await page.getByRole("heading", { name: "绿眼贴 · 上传任务", exact: true }).isVisible()).toBe(true);
    await page.getByRole("button", { name: "返回来源页面", exact: false }).click();
    expect(await works.isVisible()).toBe(true);
    await expect.poll(() => uploadButton.evaluate(element => element === document.activeElement)).toBe(true);
    await page.getByRole("button", { name: "返回批量列表", exact: false }).click();
    expect(await page.getByRole("spinbutton", { name: "想制作的视频条数", exact: true }).first().inputValue()).toBe("123");
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.batchStarts)).toEqual([]);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.sideEffects)).toEqual([]);
    await rail(page, "千川").click();
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "上传任务", exact: true }).click();
    await page.getByRole("button", { name: "绿眼贴 · 本批上传", exact: true }).click();
    await page.getByRole("heading", { name: "绿眼贴 · 上传任务", exact: true }).waitFor();
    await page.locator(".project-switcher summary").click();
    await page.getByRole("button", { name: "管理项目", exact: true }).click();
    await page.getByLabel("已保存的项目", { exact: true }).click();
    await page.getByRole("option", { name: /项目 B/ }).click();
    await rail(page, "千川").click();
    expect(await page.getByRole("heading", { name: "绿眼贴 · 上传任务", exact: true }).count()).toBe(0);
    expect(await page.getByText("当前项目没有千川上传任务。", { exact: true }).isVisible()).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("hands enabled automatic upload to new batch production and keeps it frozen during navigation", async () => {
  const { page, errors } = await fixture();
  try {
    await page.evaluate(() => (window as any).taskPagesFixture.configureAccounts());
    await rail(page, "批量制作").click();
    await page.getByLabel("选择模板 蝴蝶贴", { exact: true }).check();
    await page.getByRole("spinbutton", { name: "想制作的视频条数", exact: true }).first().fill("7");
    await page.getByRole("combobox", { name: "蝴蝶贴上传账号", exact: true }).selectOption("蝴蝶贴");
    await page.locator('[id$="-plan"]').first().selectOption("456");
    await page.getByRole("button", { name: "开始批量制作", exact: true }).click();
    const entries = await page.evaluate(() => (window as any).taskPagesFixture.calls.batchStarts[0].entries);
    expect(entries).toHaveLength(1);
    expect(entries[0].requestedCount).toBe(7);
    expect(entries[0].douyinUpload).toEqual({ enabled: true, accountProduct: "蝴蝶贴", plan: { advertiserId: "123", adId: "456", name: "隔离计划" } });
    await rail(page, "千川").click();
    await rail(page, "批量制作").click();
    await page.getByRole("spinbutton", { name: "想制作的视频条数", exact: true }).first().fill("8");
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.batchStarts[0].entries)).toEqual(entries);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.batchStarts.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.batchResumes)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("separates production stages, retains drafts and explains missing text beside output", async () => {
  const { page, errors } = await fixture();
  try {
    await workflow(page, "包装").click();
    await page.getByRole("heading", { name: "包装设置", exact: true }).waitFor();
    expect(await page.locator(".export-card").isVisible()).toBe(false);
    expect(await page.locator("#cover-sticker-settings").isVisible()).toBe(false);
    await workflow(page, "输出确认").click();
    await page.getByRole("button", { name: "去填写展示文字", exact: true }).click();
    await expect.poll(() => page.locator("#product-price").evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(
      await page.locator(".workspace-header").evaluate(element => element.getBoundingClientRect().bottom),
    );
    await page.locator("#product-price").fill("手填原文");
    await workflow(page, "覆盖").click();
    expect(await page.locator("#product-price").isVisible()).toBe(false);
    await workflow(page, "输出确认").click();
    await page.locator("#production-count").fill("10");
    await page.locator(".directory-picker").click();
    await workflow(page, "包装").click();
    expect(await page.locator("#product-price").inputValue()).toBe("手填原文");
    await workflow(page, "输出确认").click();
    expect(await page.locator("#production-count").inputValue()).toBe("10");
    expect(await page.locator(".directory-picker").textContent()).toContain("/tmp/隔离成片");
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.starts)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("pauses hidden media and returns from resource and model pages to the original draft", async () => {
  const { page, errors } = await fixture();
  try {
    await page.evaluate(() => { const video = document.querySelector(".source-preview video") as HTMLVideoElement; (window as any).pauseCalls = 0; video.pause = () => { (window as any).pauseCalls++; }; });
    await workflow(page, "包装").click();
    expect(await page.evaluate(() => (window as any).pauseCalls)).toBeGreaterThan(0);
    await page.locator("#product-price").fill("跨页原文");
    await page.getByRole("button", { name: "管理贴纸库", exact: true }).click();
    await page.getByRole("button", { name: "返回来源页面", exact: false }).click();
    expect(await page.locator("#product-price").inputValue()).toBe("跨页原文");
    await page.getByRole("button", { name: "全部交给 Agent", exact: true }).click();
    await workflow(page, "输出确认").click();
    expect(await page.locator(".production-blockers").textContent()).toContain("视觉识别模型");
    expect(await page.locator(".production-blockers").textContent()).toContain("复核模型");
    await page.getByRole("button", { name: "去配置模型", exact: true }).first().click();
    expect(await workflow(page, "输出确认").isVisible()).toBe(false);
    await page.getByRole("button", { name: "返回来源页面", exact: false }).click();
    expect(await page.locator("#production-count").isVisible()).toBe(true);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.sideEffects)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("keeps unsaved coverage boxes across pages and blocks production without implicitly saving", async () => {
  const { page, errors } = await fixture();
  try {
    await workflow(page, "覆盖").click();
    await page.getByLabel("启用覆盖", { exact: true }).check();
    await page.getByRole("button", { name: "添加覆盖框", exact: true }).click();
    await page.getByLabel("左边", { exact: false }).fill("17");
    await workflow(page, "输出确认").click();
    expect(await page.getByText("覆盖设置有未保存的修改。", { exact: false }).isVisible()).toBe(true);
    await page.getByRole("button", { name: "去保存覆盖设置", exact: true }).click();
    expect(await page.getByLabel("左边", { exact: false }).inputValue()).toBe("17");
    expect(await page.getByRole("combobox", { name: "选择当前覆盖框" }).count()).toBe(1);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.coverSaves)).toEqual([]);
    await page.getByRole("button", { name: "保存覆盖设置", exact: true }).click();
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.coverSaves[0].mediaRegions["00000000-0000-4000-8000-000000000000"][0].rectangle.x)).toBe(0.17);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("keeps legacy review editing alive and invokes the original preview and approval invalidation", async () => {
  const { page, errors } = await fixture();
  try {
    const project = await page.evaluate(() => (window as any).taskPagesFixture.state.project);
    const draft = createCoverReviewDraft(project.id, project.mediaItems.map((media: MediaItem) => ({ ...media, fingerprint: "isolated" })));
    draft.status = "awaiting_approval";
    draft.frozen = [{ mediaId: draft.media[0].mediaId, version: 1, templateJson: '{"layers":[]}', templateDigest: "a".repeat(64), presetJson: "{}", bindingDigest: "b".repeat(64) }];
    draft.approval = { submissionId: randomUUID(), revision: 0, bindingDigest: "c".repeat(64), approvedAt: new Date().toISOString(), receipts: [] };
    await page.evaluate(({ draft, cover }) => { const f = (window as any).taskPagesFixture; f.state.project.coverSticker = cover; f.state.project.reviewDrafts = [draft]; f.emit(); }, { draft, cover: { ...DEFAULT_COVER_STICKER, enabled: true, trackingMode: "assisted" } });
    await workflow(page, "覆盖").click();
    await page.getByRole("button", { name: "新增覆盖框", exact: true }).click();
    await page.getByText("精确位置与跟随设置", { exact: true }).click();
    await page.getByLabel("左侧 %", { exact: true }).fill("18");
    await workflow(page, "包装").click();
    await workflow(page, "覆盖").click();
    expect(await page.getByLabel("左侧 %", { exact: true }).inputValue()).toBe("18");
    await page.getByRole("button", { name: "保存此框", exact: true }).first().click();
    const result = await page.evaluate(() => (window as any).taskPagesFixture.state.project.reviewDrafts[0]);
    expect(result.revision).toBe(2);
    expect(result.frozen).toEqual([]);
    expect(result.approval).toBeUndefined();
    expect(result.media[0].segments[0].track.keyframes[0].rectangle.x).toBe(0.18);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("returns to output with the internal scroll position, upload choices and account draft intact", async () => {
  const { page, errors } = await fixture();
  try {
    await workflow(page, "包装").click();
    await page.locator("#product-price").fill("原文");
    await workflow(page, "输出确认").click();
    await page.getByLabel("本次成片导出完成后自动上传并确认", { exact: true }).check();
    await page.getByRole("button", { name: "配置千川账号与计划", exact: true }).scrollIntoViewIfNeeded();
    const top = await page.locator(".membership-workspace").evaluate(el => el.scrollTop);
    await page.getByRole("button", { name: "配置千川账号与计划", exact: true }).click();
    await page.getByRole("button", { name: /蝴蝶贴.*未设置/ }).click();
    await page.locator("#qianchuan-product-name").fill("未保存的名字");
    await page.getByRole("button", { name: "返回来源页面", exact: false }).click();
    await page.waitForFunction(top => Math.abs(document.querySelector(".membership-workspace")!.scrollTop - top) < 2, top);
    expect(await page.getByLabel("本次成片导出完成后自动上传并确认", { exact: true }).isChecked()).toBe(true);
    expect(await page.locator(".production-blockers").textContent()).toContain("全局千川上传尚未启用");
    await page.getByRole("button", { name: "配置千川账号与计划", exact: true }).click();
    expect(await page.locator("#qianchuan-product-name").inputValue()).toBe("未保存的名字");
    await page.evaluate(() => (window as any).taskPagesFixture.configureAccounts());
    await page.getByRole("button", { name: "返回来源页面", exact: false }).click();
    await page.locator("#douyin-upload-product").selectOption("蝴蝶贴");
    await page.locator("#douyin-upload-plan").selectOption("456");
    await workflow(page, "覆盖").click();
    await workflow(page, "输出确认").click();
    expect(await page.locator("#douyin-upload-product").inputValue()).toBe("蝴蝶贴");
    expect(await page.locator("#douyin-upload-plan").inputValue()).toBe("456");
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.starts)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("hands batch and cleanup drafts to the separate composer, retains form drafts and edits only scheduling", async () => {
  const { page, errors } = await fixture();
  try {
    await rail(page, "批量制作").click();
    await page.getByLabel("选择模板 蝴蝶贴", { exact: true }).check();
    await page.getByRole("spinbutton", { name: "想制作的视频条数", exact: true }).first().fill("123");
    expect(await page.getByLabel("任务名称").isVisible()).toBe(false);
    await page.getByRole("button", { name: "保存为定时任务", exact: true }).click();
    await page.getByLabel("任务名称", { exact: true }).fill("隔离定时制作");
    await page.getByLabel("每天执行时间", { exact: true }).fill("22:15");
    await page.getByLabel("我授权简辑在以上固定范围定时执行；如包含清理会自动删除上述计划素材或账号全部库视频，如包含上传会自动上传并确认批次。", { exact: true }).check();
    await page.getByRole("button", { name: "返回来源页面", exact: false }).click();
    expect(await page.getByRole("spinbutton", { name: "想制作的视频条数", exact: true }).first().inputValue()).toBe("123");
    await rail(page, "自动化").click();
    await page.getByRole("navigation", { name: "自动化页面" }).getByRole("button", { name: "创建任务", exact: true }).click();
    expect(await page.getByLabel("任务名称", { exact: true }).inputValue()).toBe("隔离定时制作");
    await page.getByRole("button", { name: "保存定时任务", exact: true }).click();
    const request = await page.evaluate(() => (window as any).taskPagesFixture.calls.created[0]);
    expect(request.production.entries[0].requestedCount).toBe(123);
    expect(request.enabled).toBe(false);
    expect(request.time).toBe("22:15");
    await page.getByRole("button", { name: "编辑定时设置", exact: true }).click();
    await page.getByRole("region", { name: "编辑定时任务", exact: true }).getByLabel("每天执行时间", { exact: true }).fill("23:10");
    await rail(page, "批量制作").click();
    await rail(page, "自动化").click();
    expect(await page.getByRole("region", { name: "编辑定时任务", exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole("region", { name: "编辑定时任务", exact: true }).getByLabel("每天执行时间", { exact: true }).inputValue()).toBe("23:10");
    await page.getByRole("button", { name: "保存定时设置", exact: true }).click();
    const configured = await page.evaluate(() => (window as any).taskPagesFixture.calls.configured[0]);
    expect(Object.keys(configured).sort()).toEqual(["enabled", "id", "time"]);
    expect(configured.time).toBe("23:10");
    await page.getByRole("button", { name: "编辑定时设置", exact: true }).click();
    expect(await page.getByRole("region", { name: "编辑定时任务", exact: true }).getByLabel("每天执行时间", { exact: true }).inputValue()).toBe("23:10");
    await page.evaluate(() => (window as any).taskPagesFixture.configureAccounts());
    await rail(page, "千川").click();
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "素材管理", exact: true }).click();
    await page.getByLabel(/隔离账号.*账户 123/).check();
    await page.getByRole("button", { name: "保存为定时任务", exact: true }).click();
    expect(await page.locator(".automation-scope").textContent()).toContain("计划 456");
    expect(await page.getByLabel(/我授权简辑/).isChecked()).toBe(false);
    expect(await page.evaluate(() => (window as any).taskPagesFixture.calls.sideEffects)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("navigates during production without changing frozen inputs and isolates restored projects", async () => {
  const { page, errors } = await fixture();
  try {
    await workflow(page, "包装").click();
    await page.locator("#product-price").fill("冻结原文");
    await workflow(page, "输出确认").click();
    await page.locator("#production-count").fill("10");
    await page.getByRole("button", { name: "本地制作，制作 12 条成片", exact: true }).click();
    await rail(page, "千川").click();
    await rail(page, "制作").click();
    await workflow(page, "包装").click();
    await page.locator("#product-price").fill("下一轮草稿");
    await workflow(page, "输出确认").click();
    await page.locator("#production-count").fill("7");
    expect(await page.getByText("当前制作尚未结束；可浏览下一轮设置，不能重复启动。", { exact: false }).isVisible()).toBe(true);
    const calls = await page.evaluate(() => (window as any).taskPagesFixture.calls);
    expect(calls.starts).toHaveLength(1);
    expect(calls.starts[0].decorations.productPrice).toBe("冻结原文");
    expect(calls.starts[0].multiplier).toBe(4);
    expect(calls.sideEffects).toEqual([]);
    await page.evaluate(() => { const f = (window as any).taskPagesFixture; f.state.agentRun = undefined; f.emit(); });
    await page.locator(".project-switcher summary").click();
    await page.getByRole("button", { name: "管理项目", exact: true }).click();
    await page.getByLabel("已保存的项目", { exact: true }).click();
    await page.getByRole("option", { name: /项目 B/ }).click();
    await workflow(page, "包装").click();
    expect(await page.locator("#product-price").inputValue()).toBe("B 的文字");
    await workflow(page, "输出确认").click();
    expect(await page.locator("#production-count").inputValue()).toBe("6");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it("puts results first and moves account and material management into separate Qianchuan pages", async () => {
  const { page, errors } = await fixture();
  try {
    await page.evaluate(() => (window as any).taskPagesFixture.showResults());
    await rail(page, "作品").click();
    expect(await page.locator(".result-stats").boundingBox()).toMatchObject({ y: expect.any(Number) });
    expect((await page.locator(".result-stats").boundingBox())!.y).toBeLessThan(300);
    expect(await page.getByRole("button", { name: "播放", exact: true }).count()).toBe(2);
    expect(await page.getByRole("heading", { name: "千川上传任务", exact: true }).isVisible()).toBe(false);
    await rail(page, "千川").click();
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "账号与计划", exact: true }).click();
    expect(await page.locator(".qianchuan-account-products").isVisible()).toBe(true);
    expect(await page.getByRole("heading", { name: "素材清理", exact: true }).isVisible()).toBe(false);
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "素材管理", exact: true }).click();
    expect(await page.getByRole("heading", { name: "素材清理", exact: true }).isVisible()).toBe(true);
    expect(await page.getByLabel("任务名称").isVisible()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);
