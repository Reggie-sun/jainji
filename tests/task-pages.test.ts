import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { taskPagesFixtureScript, taskPagesFixtureStyles } from "./helpers/task-pages-fixture";
import { createCoverReviewDraft, editCoverReviewDraft } from "../src/main/cover-review-session";
import { DEFAULT_COVER_STICKER } from "../src/shared/cover-sticker";
import type { MediaItem } from "../src/main/domain";
import { randomUUID } from "node:crypto";

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
    await page.getByLabel("本次成片导出完成后自动上传，停在确定前", { exact: true }).check();
    await page.getByRole("button", { name: "配置千川账号与计划", exact: true }).scrollIntoViewIfNeeded();
    const top = await page.locator(".membership-workspace").evaluate(el => el.scrollTop);
    await page.getByRole("button", { name: "配置千川账号与计划", exact: true }).click();
    await page.getByText("管理账号设置", { exact: true }).click();
    await page.getByRole("button", { name: /蝴蝶贴.*未设置/ }).click();
    await page.locator("#qianchuan-product-name").fill("未保存的名字");
    await page.getByRole("button", { name: "返回来源页面", exact: false }).click();
    await page.waitForFunction(top => Math.abs(document.querySelector(".membership-workspace")!.scrollTop - top) < 2, top);
    expect(await page.getByLabel("本次成片导出完成后自动上传，停在确定前", { exact: true }).isChecked()).toBe(true);
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
    await page.getByLabel("我授权简辑在以上固定范围定时执行；如包含清理会自动删除所选计划素材，如包含上传会自动上传并确认批次。", { exact: true }).check();
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
    await page.getByText("管理账号设置", { exact: true }).click();
    expect(await page.getByRole("heading", { name: "素材清理", exact: true }).isVisible()).toBe(false);
    await page.getByRole("navigation", { name: "千川页面" }).getByRole("button", { name: "素材管理", exact: true }).click();
    expect(await page.getByRole("heading", { name: "素材清理", exact: true }).isVisible()).toBe(true);
    expect(await page.getByLabel("任务名称").isVisible()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);
