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
const id = "00000000-0000-4000-8000-000000000001";
const projects = [{ recentProjectId: id, name: "自动覆盖旧模板", sourceCount: 1, requestedCount: 1, productPrice: "", coverEnabled: true, coverMode: "agent", displayMode: "full", mode: "random", displayTextRequiredByMedia: [false] }];
const state = { recentProjects: [], queue: { batches: [] }, capabilities: { ready: true }, douyinUpload: { config: { enabled: false }, accounts: [], tasks: [] } };
window.fixtureStarts = [];
window.jianji = { batchProductionProjects: async () => projects, startBatchProduction: async input => { window.fixtureStarts.push(input); return state; } };
function Fixture() { const [current, update] = useState(state); return <BatchProductionPanel state={current} visible onState={update} />; }
createRoot(document.getElementById("root")).render(<Fixture />);
`;
const { outputFiles } = require("esbuild").buildSync({ stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, bundle: true,
  write: false, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" } });
const html = '<!doctype html><html lang="zh"><meta charset="utf-8"><title>Batch Random Mode Fixture</title><div id="root"></div><script src="/fixture.js"></script></html>';
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
    await page.getByRole("checkbox", { name: "选择模板 自动覆盖旧模板", exact: true }).check();
    const saved = row("自动覆盖旧模板");
    assert.equal(await start.isDisabled(), true);
    assert.match(await saved.getByRole("alert").innerText(), /本地随机不会调用模型/);
    assert.equal(await page.evaluate(() => window.fixtureStarts.length), 0);
    await saved.getByRole("checkbox", { name: "自动覆盖旧模板开启覆盖", exact: true }).uncheck();
    assert.equal(await start.isEnabled(), true);
    await start.click();
    await page.waitForFunction(() => window.fixtureStarts.length === 1);
    assert.deepEqual(await page.evaluate(() => ({mode: window.fixtureStarts[0].entries[0].mode, coverEnabled: window.fixtureStarts[0].entries[0].coverEnabled})), {mode: "random", coverEnabled: false});
    await saved.getByRole("checkbox", { name: "自动覆盖旧模板开启覆盖", exact: true }).check();
    assert.equal(await start.isDisabled(), true);
    await saved.getByRole("button", {name: "全部交给 Agent", exact: true}).click();
    assert.equal(await start.isEnabled(), true);
    await saved.getByRole("button", {name: "本地随机", exact: true}).click();
    assert.equal(await start.isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "PASS", checks: ["saved Agent cover blocks local random before start", "explicitly disabling cover admits local random", "Agent decoration remains explicit", "switching back revalidates saved cover"], actualProductionStarts: 0 }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
