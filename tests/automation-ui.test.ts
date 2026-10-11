import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";

const recentProjectId = "11111111-1111-4111-8111-111111111111";
const sourceTaskId = "22222222-2222-4222-8222-222222222222";
const plan = { advertiserId: "123", adId: "456", name: "固定计划" };
const production = {
  entries: [{ recentProjectId, requestedCount: 1, productPrice: "", coverEnabled: false, displayMode: "full", mode: "random",
    douyinUpload: { enabled: true, accountProduct: "蝴蝶贴", plan } }],
};
const productionWithoutPlan = {
  entries: [{ recentProjectId, requestedCount: 1, productPrice: "", coverEnabled: false, displayMode: "full", mode: "random",
    douyinUpload: { enabled: true, accountProduct: "蝴蝶贴" } }],
};

function automationFixtureScript(options: { component?: "composer" | "panel" | "cleanup" | "workspace"; production?: unknown; tasks?: unknown[]; accounts?: unknown[]; librarySchedule?: unknown } = {}) {
  const sourceTasks = options.tasks ?? [];
  const taskArgument = sourceTasks[0] ?? {
    id: sourceTaskId,
    request: { name: "已有制作", time: "23:00", enabled: false, production, upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION" },
    binding: "a".repeat(64), summary: "固定绑定 1 个模板", createdAt: "2026-10-10T00:00:00.000Z",
  };
  return buildSync({ stdin: { contents: `
    import React, {useState} from "react";
    import { createRoot } from "react-dom/client";
    import { AutomationComposer, AutomationPanel } from "./src/renderer/AutomationPanel";
    import { AutomationWorkspace } from "./src/renderer/AutomationWorkspace";
    import { QianchuanVideoLibraryActions } from "./src/renderer/QianchuanVideoLibraryActions";
    window.automationTasks = ${JSON.stringify(sourceTasks.length ? sourceTasks : options.component === "composer" && !options.production ? [taskArgument] : [])};
    window.automationCalls = { created: [], configured: [], removed: [], cleanup: [], librarySaved: [] };
    let librarySchedule = ${JSON.stringify(options.librarySchedule ?? { settings: { confirmation: "DELETE_ALL_VIDEOS", enabled: false, time: "00:30", accounts: [] }, timeZone: "Asia/Hong_Kong" })};
    const libraryListeners = new Set();
    const status = () => ({ tasks: window.automationTasks, timeZone: "Asia/Hong_Kong", running: false });
    window.jianji = {
      getAutomation: async () => status(),
      createAutomation: async input => { window.automationCalls.created.push(input); return status(); },
      configureAutomation: async input => {
        window.automationCalls.configured.push(input);
        window.automationTasks = window.automationTasks.map(task => task.id === input.id ? { ...task, request: { ...task.request, enabled: input.enabled, time: input.time } } : task);
        return status();
      },
      removeAutomation: async id => { window.automationCalls.removed.push(id); window.automationTasks = window.automationTasks.filter(task => task.id !== id); return status(); },
      onAutomation: () => () => {},
      listQianchuanPlans: async input => [{ advertiserId: input.expectedAdvertiserId, adId: "456", name: "固定计划" }],
      cancelQianchuanPlans: async () => {},
      clearQianchuanVideoLibraries: async input => { window.automationCalls.cleanup.push(input); return []; },
      onQianchuanVideoLibrarySchedule: listener => { libraryListeners.add(listener); return () => libraryListeners.delete(listener); },
      getQianchuanVideoLibrarySchedule: async () => structuredClone(librarySchedule),
      saveQianchuanVideoLibrarySchedule: async settings => {
        window.automationCalls.librarySaved.push(structuredClone(settings));
        librarySchedule = { ...librarySchedule, settings: structuredClone(settings) };
        libraryListeners.forEach(listener => listener(structuredClone(librarySchedule)));
        return structuredClone(librarySchedule);
      },
    };
    const production = ${JSON.stringify(options.production ?? null)};
    function Fixture() {
      const [cleanup, setCleanup] = useState();
      const [page, setPage] = useState("tasks");
      const accounts = ${JSON.stringify(options.accounts ?? [])};
      if (${JSON.stringify(options.component ?? "composer")} === "panel") return <AutomationPanel accounts={accounts}/>;
      if (${JSON.stringify(options.component ?? "composer")} === "workspace") return <AutomationWorkspace state={{douyinUpload:{accounts}}} page={page} onPage={setPage} revision={0} onSource={()=>{}}/>;
      if (${JSON.stringify(options.component ?? "composer")} === "cleanup") return cleanup ? <AutomationComposer cleanup={cleanup}/> : <QianchuanVideoLibraryActions accounts={[{ product: "蝴蝶贴", advertiserId: "123", adId: "456", available: true }]} busy={false} onAutomation={setCleanup}/>;
      return <AutomationComposer production={production ?? undefined}/>;
    }
    createRoot(document.getElementById("root")).render(<Fixture/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, loader: { ".css": "empty" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" }).outputFiles[0]!.text;
}

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });

async function fixture(options: Parameters<typeof automationFixtureScript>[0] = {}): Promise<{ page: Page; pageErrors: string[] }> {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const route = `http://127.0.0.1:3000/automation-${options.component ?? "composer"}`;
  await page.route(route, request => request.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto(route);
  await page.addScriptTag({ content: automationFixtureScript(options) });
  await page.addStyleTag({ content: ["src/renderer/styles.css", "src/renderer/automation.css", "src/renderer/qianchuan-cleanup.css"].map(path => readFileSync(path, "utf8")).join("\n") });
  const heading = options.component === "panel" || options.component === "workspace" ? "每日自动化任务" : options.component === "cleanup" ? "素材清理" : "保存每日自动化";
  await page.getByRole("heading", { name: heading }).waitFor();
  return { page, pageErrors };
}

describe("scheduled automation browser interaction", () => {
  it.each([
    { rule: undefined, audit: true, zero: false },
    { rule: "ZERO_IMPRESSIONS_15D", audit: false, zero: true },
    { rule: "AUDIT_AND_ZERO_IMPRESSIONS_15D", audit: true, zero: true },
  ])("shows the actual saved cleanup conditions and named plan targets: $rule", async ({ rule, audit, zero }) => {
    const task = {
      id: sourceTaskId, request: { name: "日常清理", time: "00:30", enabled: true, upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION",
        cleanup: { confirmation: "DELETE_PLAN_MATERIALS", ...(rule ? { planMaterialRule: rule } : {}), accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123", plans: [plan, { ...plan, adId: "789", name: "第二个固定计划" }] }] } },
      binding: "a".repeat(64), summary: "清理账户 123 · 计划 456、789", createdAt: "2026-10-10T00:00:00.000Z",
    };
    const { page, pageErrors } = await fixture({ component: "panel", tasks: [task], accounts: [{ product: "蝴蝶贴", browserProfileName: "已绑定账号", advertiserId: "123", adId: "456", available: true }] });
    try {
      const row = page.getByRole("article", { name: "日常清理", exact: true });
      await row.getByText("执行内容：计划素材清理", { exact: true }).waitFor();
      expect(await row.textContent()).toContain("已绑定账号");
      expect(await row.textContent()).toContain("账户 123");
      expect(await row.textContent()).toContain("固定计划");
      expect(await row.textContent()).toContain("计划 456");
      expect(await row.textContent()).toContain("第二个固定计划");
      expect(await row.textContent()).toContain("计划 789");
      expect(await row.textContent()).toContain("仅删除所选计划内符合条件的素材，不清空账号视频库。");
      expect((await row.textContent())!.includes("审核不通过、生态审核不通过、审核通过可优化")).toBe(audit);
      expect((await row.textContent())!.includes("近 15 天零展示（加入计划满 15 天）")).toBe(zero);
      expect(await page.evaluate(() => (window as any).automationCalls.cleanup)).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally { await page.close(); }
  });

  it("shows a saved single-plan ID without borrowing a name from a rebound account", async () => {
    const task = {
      id: sourceTaskId, request: { name: "历史计划清理", time: "00:30", enabled: false, upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION",
        cleanup: { confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123", expectedAdId: "456" }] } },
      binding: "a".repeat(64), summary: "清理账户 123 · 计划 456", createdAt: "2026-10-10T00:00:00.000Z",
    };
    const { page } = await fixture({ component: "panel", tasks: [task], accounts: [{ product: "蝴蝶贴", browserProfileName: "另一个账号", advertiserId: "999", adId: "888", available: true }] });
    try {
      const row = page.getByRole("article", { name: "历史计划清理", exact: true });
      await row.getByText("账户 123", { exact: true }).waitFor();
      expect(await row.textContent()).toContain("计划 456");
      expect(await row.textContent()).not.toContain("另一个账号");
      expect(await row.textContent()).not.toContain("999");
    } finally { await page.close(); }
  });

  it("shows production and chained upload, and resolves an independent upload's saved source targets", async () => {
    const task = {
      id: sourceTaskId, request: { name: "固定制作", time: "23:00", enabled: true, production, upload: true, confirmation: "AUTHORIZE_FIXED_AUTOMATION" },
      binding: "a".repeat(64), summary: "保存时的模板 · 1 条 · 素材 /tmp/固定素材", createdAt: "2026-10-10T00:00:00.000Z",
    };
    const source = { ...task, id: recentProjectId, request: { ...task.request, name: "已有制作", upload: false } };
    const upload = { ...task, id: "33333333-3333-4333-8333-333333333333", request: { name: "独立上传", time: "23:30", enabled: true, upload: true, uploadFrom: recentProjectId, confirmation: "AUTHORIZE_FIXED_AUTOMATION" }, summary: "上传来源：已有制作" };
    const { page } = await fixture({ component: "panel", tasks: [task, source, upload] });
    try {
      const row = page.getByRole("article", { name: "固定制作", exact: true });
      await row.getByText("执行内容：制作 → 上传并确认批次", { exact: true }).waitFor();
      expect(await row.textContent()).toContain("1 个模板，共 1 条");
      await row.getByText("保存时的模板与素材信息", { exact: true }).click();
      await row.getByText(task.summary, { exact: true }).waitFor();
      const independent = page.getByRole("article", { name: "独立上传", exact: true });
      expect(await independent.textContent()).toContain("已有制作");
      expect(await independent.textContent()).toContain("固定计划");
      expect(await independent.textContent()).toContain("计划 456");
      expect(await page.getByRole("article", { name: "已有制作", exact: true }).textContent()).toContain("不自动上传");
    } finally { await page.close(); }
  });

  it("shows one combined task with a shared pause control and read-only historical results", async () => {
    const task = {
      id: sourceTaskId, request: { name: "日常清理", time: "00:30", enabled: true, upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION",
        cleanup: { confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123", plans: [plan] }] } },
      binding: "a".repeat(64), summary: "清理账户 123 · 计划 456", createdAt: "2026-10-10T00:00:00.000Z",
    };
    const librarySchedule = { mergedTaskId: sourceTaskId, settings: { confirmation: "DELETE_ALL_VIDEOS", enabled: false, time: "00:30", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123" }] }, timeZone: "Asia/Hong_Kong",
      lastRun: { day: "2026-10-12", startedAt: "2026-10-11T16:30:00.000Z", state: "BLOCKED", message: "原执行记录保留", results: [{ product: "蝴蝶贴", advertiserId: "123", state: "BLOCKED", deletedCount: 0, message: "历史删除结果未知" }] } };
    const { page, pageErrors } = await fixture({ component: "workspace", tasks: [task], librarySchedule, accounts: [{ product: "蝴蝶贴", browserProfileName: "新账号", advertiserId: "999", adId: "888", available: true }] });
    try {
      const row = page.getByRole("article", { name: "日常清理", exact: true });
      await row.getByText("已启用", { exact: true }).waitFor();
      expect(await page.getByRole("article").count()).toBe(1);
      expect(await row.textContent()).toContain("计划素材清理 → 账号视频库全部清空");
      expect(await row.textContent()).toContain("永久删除已绑定账号视频库中的全部视频");
      expect(await row.textContent()).toContain("账户 123");
      expect(await row.textContent()).toContain("计划 456");
      expect(await row.textContent()).not.toContain("新账号");
      expect(await page.getByText(/同一时间还启用/).count()).toBe(0);
      await row.getByRole("button", { name: "暂停", exact: true }).click();
      await page.waitForFunction(() => (window as any).automationCalls.configured.length === 1);
      expect(await page.evaluate(() => (window as any).automationCalls.configured[0])).toEqual({ id: sourceTaskId, time: "00:30", enabled: false });
      await page.getByText("合并前的执行记录", { exact: true }).click();
      await page.getByText("查看各账号结果", { exact: true }).click();
      await page.getByText("历史删除结果未知", { exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).automationCalls.cleanup)).toEqual([]);
      expect(await page.evaluate(() => (window as any).automationCalls.librarySaved)).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally { await page.close(); }
  });

  it("renders production without a TDZ crash and saves the exact cleanup, production and chained upload scope", async () => {
    const { page, pageErrors } = await fixture({ production });
    try {
      expect(pageErrors).toEqual([]);
      await page.getByLabel("任务名称").fill("晚间批量制作");
      await page.getByLabel("每天执行时间").fill("01:40");
      await page.getByRole("checkbox", { name: "保存后立即启用此每日任务" }).check();
      const authorization = page.getByRole("checkbox", { name: /我授权简辑/ });
      await authorization.check();
      await page.getByLabel("每天执行时间").fill("01:41");
      expect(await authorization.isChecked()).toBe(false);
      await authorization.check();

      await page.getByRole("checkbox", { name: "每日制作前清理所选计划素材" }).check();
      expect(await authorization.isChecked()).toBe(false);
      await authorization.check();
      await page.getByRole("checkbox", { name: /近 15 天零展示/ }).uncheck();
      expect(await authorization.isChecked()).toBe(false);
      await page.getByRole("checkbox", { name: /近 15 天零展示/ }).check();
      await authorization.check();
      await page.getByRole("checkbox", { name: "制作完成后自动上传并确认所选批次" }).check();
      expect(await authorization.isChecked()).toBe(false);
      await authorization.check();

      await page.getByRole("button", { name: "保存定时任务" }).click();
      await page.waitForFunction(() => (window as any).automationCalls.created.length === 1);
      expect(await page.evaluate(() => (window as any).automationCalls.created[0])).toEqual({
        name: "晚间批量制作", time: "01:41", enabled: true,
        cleanup: { confirmation: "DELETE_PLAN_MATERIALS", planMaterialRule: "AUDIT_AND_ZERO_IMPRESSIONS_15D",
          accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123", plans: [plan] }] },
        production, upload: true, confirmation: "AUTHORIZE_FIXED_AUTOMATION",
      });
      expect(pageErrors).toEqual([]);
    } finally { await page.close(); }
  });

  it("blocks saving when checked cleanup has no plan or no rule instead of saving a smaller production task", async () => {
    for (const scenario of [
      { production: productionWithoutPlan, missingText: "未为模板选择上传计划" },
      { production, missingText: "没有选择清理规则" },
    ]) {
      const { page } = await fixture({ production: scenario.production });
      try {
        await page.getByLabel("任务名称").fill("制作并清理");
        await page.getByRole("checkbox", { name: "每日制作前清理所选计划素材" }).check();
        if (scenario.production === production) {
          await page.getByRole("checkbox", { name: /审核不通过、生态审核不通过/ }).uncheck();
          await page.getByRole("checkbox", { name: /近 15 天零展示/ }).uncheck();
        }
        await page.getByText(scenario.missingText, { exact: false }).waitFor();
        await page.getByRole("checkbox", { name: /我授权简辑/ }).check();
        expect(await page.getByRole("button", { name: "保存定时任务" }).isDisabled()).toBe(true);
        expect(await page.evaluate(() => (window as any).automationCalls.created)).toEqual([]);
      } finally { await page.close(); }
    }
  });

  it("saves cleanup selected on the material-cleanup page with its frozen plan and rule", async () => {
    const { page, pageErrors } = await fixture({ component: "cleanup" });
    try {
      await page.getByRole("checkbox", { name: "清理计划 456" }).waitFor();
      expect(await page.getByLabel("任务名称").isVisible()).toBe(false);
      await page.getByRole("checkbox", { name: /近15天零展示素材/ }).uncheck();
      await page.getByRole("button", { name: "保存为定时任务", exact: true }).click();
      await page.getByRole("heading", { name: "保存每日自动化" }).waitFor();
      await page.getByLabel("任务名称").fill("清理所选计划");
      await page.getByRole("checkbox", { name: /我授权简辑/ }).check();
      await page.getByRole("button", { name: "保存定时任务" }).click();
      await page.waitForFunction(() => (window as any).automationCalls.created.length === 1);
      expect(await page.evaluate(() => (window as any).automationCalls.created[0])).toEqual({
        name: "清理所选计划", time: "00:30", enabled: false,
        cleanup: { confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123", plans: [{ advertiserId: "123", adId: "456", name: "固定计划" }] }] },
        upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION",
      });
      expect(pageErrors).toEqual([]);
    } finally { await page.close(); }
  });

  it.each([
    { audit: true, zero: true, rule: "AUDIT_AND_ZERO_IMPRESSIONS_15D" },
    { audit: false, zero: true, rule: "ZERO_IMPRESSIONS_15D" },
    { audit: true, zero: false, rule: undefined },
  ])("saves both selected cleanup scopes as one authorized task: $rule", async ({ audit, zero, rule }) => {
    const { page, pageErrors } = await fixture({ component: "cleanup" });
    try {
      await page.getByRole("checkbox", { name: "清理计划 456" }).waitFor();
      if (!audit) await page.getByRole("checkbox", { name: /计划内三类素材/ }).uncheck();
      if (!zero) await page.getByRole("checkbox", { name: /近15天零展示素材/ }).uncheck();
      const library = page.getByRole("checkbox", { name: /视频库全部视频/ });
      await library.check();
      expect(await page.getByRole("button", { name: "保存为定时任务", exact: true }).isEnabled()).toBe(true);
      const schedule = page.getByRole("region", { name: "定时清理素材" });
      await schedule.getByText(/定时任务将清空所选账号视频库的全部视频/).waitFor();
      expect(await library.isChecked()).toBe(true);
      expect(await schedule.getByRole("button", { name: "保存为定时任务", exact: true }).isEnabled()).toBe(true);
      await schedule.getByRole("button", { name: "保存为定时任务", exact: true }).click();
      await page.getByRole("heading", { name: "保存每日自动化" }).waitFor();
      expect(await page.evaluate(() => (window as any).automationCalls.created)).toEqual([]);
      expect(await page.evaluate(() => (window as any).automationCalls.cleanup)).toEqual([]);
      expect(await page.getByRole("checkbox", { name: /我授权简辑/ }).isChecked()).toBe(false);
      expect(await page.getByRole("button", { name: "保存定时任务" }).isDisabled()).toBe(true);
      await page.getByLabel("任务名称").fill("每日计划素材清理");
      await page.getByRole("checkbox", { name: /我授权简辑/ }).check();
      await page.getByRole("button", { name: "保存定时任务" }).click();
      await page.waitForFunction(() => (window as any).automationCalls.created.length === 1);
      expect(await page.evaluate(() => (window as any).automationCalls.created[0])).toEqual({
        name: "每日计划素材清理", time: "00:30", enabled: false, upload: false,
        cleanup: { confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", ...(rule ? { planMaterialRule: rule } : {}),
          accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123", plans: [plan] }] },
        confirmation: "AUTHORIZE_FIXED_AUTOMATION",
      });
      expect(await page.evaluate(() => (window as any).automationCalls.cleanup)).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally { await page.close(); }
  });

  it("saves an explicitly selected library-only task without plan rules", async () => {
    const { page, pageErrors } = await fixture({ component: "cleanup" });
    try {
      await page.getByRole("checkbox", { name: /计划内三类素材/ }).uncheck();
      await page.getByRole("checkbox", { name: /近15天零展示素材/ }).uncheck();
      await page.getByRole("checkbox", { name: /视频库全部视频/ }).check();
      await page.getByRole("button", { name: "保存为定时任务", exact: true }).click();
      await page.getByLabel("任务名称").fill("每日视频库清空");
      await page.getByText(/视频库全部清空：永久删除/).waitFor();
      await page.getByRole("checkbox", { name: /我授权简辑/ }).check();
      await page.getByRole("button", { name: "保存定时任务" }).click();
      await page.waitForFunction(() => (window as any).automationCalls.created.length === 1);
      expect(await page.evaluate(() => (window as any).automationCalls.created[0].cleanup)).toEqual({ confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123" }] });
      expect(await page.evaluate(() => (window as any).automationCalls.cleanup)).toEqual([]); expect(pageErrors).toEqual([]);
    } finally { await page.close(); }
  });

  it.each(["account", "plan", "rule"])("explains unavailable scheduling without shrinking an empty %s selection", async missing => {
    const { page } = await fixture({ component: "cleanup" });
    try {
      await page.getByRole("checkbox", { name: "清理计划 456" }).waitFor();
      if (missing === "account") await page.getByRole("checkbox", { name: /蝴蝶贴/ }).uncheck();
      if (missing === "plan") await page.getByRole("checkbox", { name: "清理计划 456" }).uncheck();
      if (missing === "rule") {
        await page.getByRole("checkbox", { name: /计划内三类素材/ }).uncheck();
        await page.getByRole("checkbox", { name: /近15天零展示素材/ }).uncheck();
      }
      const schedule = page.getByRole("region", { name: "定时清理素材" });
      expect(await schedule.getByRole("button", { name: "保存为定时任务", exact: true }).isDisabled()).toBe(true);
      await schedule.getByText(missing === "account" ? "请选择要定时清理的账号。" : missing === "plan" ? "请为每个所选账号选择清理计划。" : "请选择计划素材或视频库清理。", { exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).automationCalls.created)).toEqual([]);
      expect(await page.evaluate(() => (window as any).automationCalls.cleanup)).toEqual([]);
    } finally { await page.close(); }
  });

  it("independently uploads only a saved production task and resets authorization when the source changes", async () => {
    const plainTask = {
      id: sourceTaskId,
      request: { name: "已有制作", time: "23:00", enabled: false, production, upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION" },
      binding: "a".repeat(64), summary: "固定绑定 1 个模板", createdAt: "2026-10-10T00:00:00.000Z",
    };
    const excludedCleanupTask = { ...plainTask, id: "33333333-3333-4333-8333-333333333333", request: { ...plainTask.request, cleanup: { confirmation: "DELETE_PLAN_MATERIALS", accounts: [] } } };
    const excludedUploadTask = { ...plainTask, id: "44444444-4444-4444-8444-444444444444", request: { ...plainTask.request, upload: true } };
    const { page } = await fixture({ component: "composer", tasks: [plainTask, excludedCleanupTask, excludedUploadTask] });
    try {
      await page.getByLabel("任务名称").fill("独立上传");
      const authorization = page.getByRole("checkbox", { name: /我授权简辑/ });
      await authorization.check();
      await page.getByRole("checkbox", { name: "独立上传已有制作专用任务" }).check();
      expect(await authorization.isChecked()).toBe(false);
      const source = page.getByLabel("制作任务");
      await source.locator(`option[value="${sourceTaskId}"]`).waitFor({ state: "attached" });
      expect(await source.locator("option").allTextContents()).toEqual(["请选择已有制作专用任务", "已有制作 · 23:00"]);
      await source.selectOption(sourceTaskId);
      expect(await authorization.isChecked()).toBe(false);
      await authorization.check();
      await page.getByRole("button", { name: "保存定时任务" }).click();
      await page.waitForFunction(() => (window as any).automationCalls.created.length === 1);
      expect(await page.evaluate(() => (window as any).automationCalls.created[0])).toEqual({
        name: "独立上传", time: "00:30", enabled: false, upload: true, uploadFrom: sourceTaskId,
        confirmation: "AUTHORIZE_FIXED_AUTOMATION",
      });
    } finally { await page.close(); }
  }, 15000);

  it("pauses, changes the daily time and deletes a saved task through its task controls", async () => {
    const task = {
      id: sourceTaskId,
      request: { name: "晚间制作", time: "23:00", enabled: true, production, upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION" },
      binding: "a".repeat(64), summary: "固定绑定 1 个模板", createdAt: "2026-10-10T00:00:00.000Z",
      lastRun: { id: "55555555-5555-4555-8555-555555555555", day: "2026-10-10", startedAt: "2026-10-10T01:00:00.000Z", state: "COMPLETED", message: "制作完成" },
    };
    const { page } = await fixture({ component: "panel", tasks: [task] });
    try {
      await page.getByRole("article", { name: "晚间制作" }).getByText("最近执行：已完成").waitFor();
      await page.getByRole("button", { name: "暂停" }).click();
      await page.waitForFunction(() => (window as any).automationCalls.configured.length === 1);
      expect(await page.evaluate(() => (window as any).automationCalls.configured[0])).toEqual({ id: sourceTaskId, enabled: false, time: "23:00" });
      await page.getByRole("article", { name: "晚间制作", exact: true }).getByLabel("每天", { exact: true }).fill("03:45");
      await page.getByRole("button", { name: "保存时间" }).click();
      await page.waitForFunction(() => (window as any).automationCalls.configured.length === 2);
      expect(await page.evaluate(() => (window as any).automationCalls.configured[1])).toEqual({ id: sourceTaskId, enabled: false, time: "03:45" });
      page.on("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "删除" }).click();
      await page.waitForFunction(() => (window as any).automationCalls.removed.length === 1);
      expect(await page.evaluate(() => (window as any).automationCalls.removed)).toEqual([sourceTaskId]);
      expect(await page.getByRole("article", { name: "晚间制作" }).count()).toBe(0);
    } finally { await page.close(); }
  });
});
