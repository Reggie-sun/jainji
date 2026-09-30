import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BatchProductionPanel } from ${JSON.stringify(path.join(root, "src/renderer/BatchProductionPanel.tsx"))};
const off = "00000000-0000-4000-8000-000000000001", legacy = "00000000-0000-4000-8000-000000000002";
const projects = [
  { recentProjectId: off, name: "逐素材关闭", sourceCount: 3, requestedCount: 2, productPrice: "", coverEnabled: false, displayMode: "full", mode: "random", displayTextRequiredByMedia: [false, false, true] },
  { recentProjectId: legacy, name: "旧模板默认开启", sourceCount: 1, requestedCount: 1, productPrice: "", coverEnabled: false, displayMode: "full", mode: "random" }
];
const state = { recentProjects: [], queue: { batches: [] }, capabilities: { ready: true }, douyinUpload: { config: { enabled: false }, accounts: [], tasks: [] } };
window.fixtureStarts = [];
window.jianji = { batchProductionProjects: async () => projects, startBatchProduction: async input => { window.fixtureStarts.push(input); return state; } };
function Fixture() { const [current, update] = useState(state); return <BatchProductionPanel state={current} visible onState={update} />; }
createRoot(document.getElementById("root")).render(<Fixture />);
`;
const { outputFiles } = require("esbuild").buildSync({ stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, bundle: true,
  write: false, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" } });
const html = '<!doctype html><html lang="zh"><meta charset="utf-8"><title>Batch Display Text Fixture</title><div id="root"></div><script src="/fixture.js"></script></html>';
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/fixture.js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
  response.end(request.url === "/fixture.js" ? outputFiles[0].contents : html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes("--serve")) {
  console.log(JSON.stringify({ url, scope: "isolated renderer fixture; no Electron IPC, media, model or upload actions" }));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
} else {
  let browser;
  try {
    browser = await require("playwright-core").chromium.launch({ headless: true, executablePath: process.env.JIANJI_SMOKE_CHROME || "/opt/google/chrome/google-chrome" });
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    const row = name => page.getByRole("region", { name: `${name}制作设置`, exact: true });
    const start = page.getByRole("button", { name: "开始批量制作", exact: true });
    await page.getByRole("checkbox", { name: "选择模板 逐素材关闭", exact: true }).check();
    assert.equal(await row("逐素材关闭").getByLabel("展示文字 / 价格").isDisabled(), true);
    assert.equal(await start.isEnabled(), true);
    await start.click();
    await page.waitForFunction(() => window.fixtureStarts.length === 1);
    assert.equal(await page.evaluate(() => window.fixtureStarts[0].entries[0].productPrice), "");
    await row("逐素材关闭").getByLabel("想制作的视频条数", { exact: true }).fill("3");
    assert.equal(await row("逐素材关闭").getByLabel("展示文字 / 价格").isEnabled(), true);
    assert.equal(await start.isDisabled(), true);
    await row("逐素材关闭").getByRole("alert").waitFor();
    await row("逐素材关闭").getByLabel("展示文字 / 价格").fill("用户手填文字");
    assert.equal(await start.isEnabled(), true);
    await row("逐素材关闭").getByLabel("展示文字 / 价格").fill("一行\n二行\n三行");
    assert.equal(await start.isDisabled(), true);
    await row("逐素材关闭").getByLabel("想制作的视频条数", { exact: true }).fill("2");
    assert.equal(await start.isEnabled(), true);
    await row("逐素材关闭").getByLabel("想制作的视频条数", { exact: true }).fill("3");
    assert.equal(await start.isDisabled(), true);
    await row("逐素材关闭").getByLabel("展示文字 / 价格").fill("用户手填文字");
    await page.getByRole("checkbox", { name: "选择模板 旧模板默认开启", exact: true }).check();
    assert.equal(await start.isDisabled(), true);
    await row("旧模板默认开启").getByLabel("展示文字 / 价格").fill("旧模板手填文字");
    assert.equal(await start.isEnabled(), true);
    await start.click();
    await page.waitForFunction(() => window.fixtureStarts.length === 2);
    assert.deepEqual(await page.evaluate(() => window.fixtureStarts[1].entries.map(entry => entry.productPrice)), ["用户手填文字", "旧模板手填文字"]);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "PASS", checks: ["blank text allowed when actual selected sources are disabled", "requested count includes enabled source and blocks blank text", "legacy template defaults to requiring manual text", "explicit text reaches batch start unchanged"], actualProductionStarts: 0 }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
