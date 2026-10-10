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

function automationFixtureScript(options: { component?: "composer" | "panel" | "cleanup"; production?: unknown; tasks?: unknown[] } = {}) {
  const sourceTasks = options.tasks ?? [];
  const taskArgument = sourceTasks[0] ?? {
    id: sourceTaskId,
    request: { name: "已有制作", time: "23:00", enabled: false, production, upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION" },
    binding: "a".repeat(64), summary: "固定绑定 1 个模板", createdAt: "2026-10-10T00:00:00.000Z",
  };
  return buildSync({ stdin: { contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { AutomationComposer, AutomationPanel } from "./src/renderer/AutomationPanel";
    import { QianchuanVideoLibraryActions } from "./src/renderer/QianchuanVideoLibraryActions";
    window.automationTasks = ${JSON.stringify(sourceTasks.length ? sourceTasks : options.component === "composer" && !options.production ? [taskArgument] : [])};
    window.automationCalls = { created: [], configured: [], removed: [] };
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
      onQianchuanVideoLibrarySchedule: () => () => {},
      getQianchuanVideoLibrarySchedule: async () => ({ settings: { enabled: false, time: "00:30", accounts: [] }, timeZone: "Asia/Hong_Kong" }),
      saveQianchuanVideoLibrarySchedule: async settings => ({ settings, timeZone: "Asia/Hong_Kong" }),
    };
    const production = ${JSON.stringify(options.production ?? null)};
    function Fixture() {
      if (${JSON.stringify(options.component ?? "composer")} === "panel") return <AutomationPanel/>;
      if (${JSON.stringify(options.component ?? "composer")} === "cleanup") return <QianchuanVideoLibraryActions accounts={[{ product: "蝴蝶贴", advertiserId: "123", adId: "456", available: true }]} busy={false}/>;
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
  const heading = options.component === "panel" ? "每日自动化任务" : options.component === "cleanup" ? "保存每日自动化" : "保存每日自动化";
  await page.getByRole("heading", { name: heading }).waitFor();
  return { page, pageErrors };
}

describe("scheduled automation browser interaction", () => {
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
      await page.getByRole("heading", { name: "保存每日自动化" }).waitFor();
      await page.getByRole("checkbox", { name: /近15天零展示素材/ }).uncheck();
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
      await page.getByLabel("每天").fill("03:45");
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
