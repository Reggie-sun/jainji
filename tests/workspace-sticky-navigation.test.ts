import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); }, 30000);
afterAll(async () => { await browser?.close(); });

const script = buildSync({
  stdin: { contents: `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { WorkspaceHeader } from "./src/renderer/WorkspaceChrome";
    function Fixture() {
      const [section, setSection] = useState("packaging");
      return <div className="membership-shell">
        <div className="membership-bar"><div>已登录</div><div>会员工作区</div></div>
        <div className="membership-workspace"><div className="app-shell"><div className="main-area">
          <WorkspaceHeader step="templates" section={section} projectName="滚动导航回归项目" projectDirty={false}
            engineReady engineLabel="本地就绪" disabled={false} saveDisabled={false}
            onWorkflow={setSection} onNewProject={()=>{}} onOpenProject={()=>{}} onSaveProject={()=>{}} onProjectManager={()=>{}} />
          <main className="content">
            <div style={{height:800}}>包装设置与预览</div>
            <label id="display-time-settings" htmlFor="fixture-timing">价格 / 展示文字显示时段</label>
            <select id="fixture-timing"><option>全程显示</option><option>仅前 5 秒</option></select>
            <div style={{height:800}}>逐素材设置</div>
            <section id="corner-decoration-editor"><h2>四角贴纸</h2><button type="button">编辑左上角</button></section>
            <div style={{height:1400}}>其他设置</div>
          </main>
        </div></div></div>
      </div>;
    }
    createRoot(document.getElementById("root")).render(<Fixture/>);
  `, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
}).outputFiles[0]!.text;

async function fixture(width: number) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.setDefaultTimeout(3000);
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: ["styles.css", "workspace-redesign.css", "membership.css"].map(path => readFileSync(`src/renderer/${path}`, "utf8")).join("\n") + "\nhtml,body,#root{height:100%;}" });
  await page.addScriptTag({ content: script });
  return page;
}

async function assertPinned(page: Page) {
  const boxes = await page.evaluate(() => {
    const header = document.querySelector(".workspace-header")!;
    const nav = document.querySelector(".workspace-subnav")!;
    const scroller = document.querySelector(".membership-workspace")!;
    const rect = nav.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { headerTop: header.getBoundingClientRect().top, scrollerTop: scroller.getBoundingClientRect().top,
      navBottom: rect.bottom, headerBottom: header.getBoundingClientRect().bottom, hit: nav.contains(hit), height: innerHeight };
  });
  expect(Math.abs(boxes.headerTop - boxes.scrollerTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxes.navBottom - boxes.headerBottom)).toBeLessThanOrEqual(1);
  expect(boxes.navBottom).toBeLessThan(boxes.height);
  expect(boxes.hit).toBe(true);
}

it.each([1440, 1100, 820])("keeps packaging shortcuts visible and clickable throughout a long workspace at %ipx", async width => {
  const page = await fixture(width);
  try {
    const nav = page.getByRole("navigation", { name: "包装设置", exact: true });
    await nav.waitFor();
    for (const top of [600, 1400, 2800]) {
      await page.locator(".membership-workspace").evaluate((element, top) => { element.scrollTop = top; }, top);
      await assertPinned(page);
    }
    for (const [name, target] of [["显示时段", "#display-time-settings"], ["四角贴纸", "#corner-decoration-editor"]]) {
      await nav.getByRole("button", { name, exact: true }).click();
      await expect.poll(() => page.locator(target!).evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(
        await page.locator(".workspace-header").evaluate(element => element.getBoundingClientRect().bottom) - 1,
      );
      expect((await page.locator(target!).boundingBox())!.y).toBeLessThan(800);
      await assertPinned(page);
    }
    await page.locator(".workflow-steps button").nth(2).click();
    expect(await nav.count()).toBe(0);
    await page.locator(".workflow-steps button").nth(1).click();
    await nav.waitFor();
    await assertPinned(page);
  } finally { await page.close(); }
}, 30000);
