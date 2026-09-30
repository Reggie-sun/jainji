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
import { BatchProductionDetails } from ${JSON.stringify(path.join(root, "src/renderer/BatchProductionDetails.tsx"))};
const tasks = Array.from({ length: 30 }, (_, index) => ({ id: "export-" + index, status: "completed", progress: 1 }));
const uploads = tasks.map((task, index) => ({ export_task_id: task.id, upload_task_id: "upload-" + index, file_name: "video-" + index + ".mp4",
  advertiserId: "123", adId: "456", state: index < 12 ? "WAITING_FOR_CONFIRMATION" : index < 21 ? "NEEDS_HUMAN" : "PENDING",
  upload_outcome: index < 12 ? "READY" : index < 21 ? "MAY_HAVE_UPLOADED" : "NOT_SELECTED" }));
window.fixtureReads = 0; window.fixtureHistorical = false; window.fixtureActions = [];
window.jianji = new Proxy({ batchProductionDetails: async () => { window.fixtureReads++; return { runId: "run",
  job: { id: "job", name: "晚安油", accountProduct: "眼贴", requestedCount: 30, actualCount: 30, status: "completed", taskIds: tasks.map(task => task.id), completedCount: 30, failedCount: 0 },
  items: [], tasks, upload: { historical: window.fixtureHistorical, message: window.fixtureHistorical ? "这是此前制作的上传记录；自动上传只处理当前制作，旧记录不会自动续传。" : "自动上传已暂停，请核查原上传页面。",
    accounts: [{ product: "眼贴", productName: "晚安油", advertiserId: "123", adId: "456", available: true }], tasks: uploads } }; }
}, { get(target, key) { return target[key] ?? (() => { window.fixtureActions.push(String(key)); throw new Error("Production action forbidden in fixture"); }); } });
function Fixture() { const [show, setShow] = useState(true); return show
  ? <BatchProductionDetails request={{ runId: "run", jobId: "job" }} name="晚安油" onBack={() => setShow(false)} />
  : <p>已返回批量列表</p>; }
createRoot(document.getElementById("root")).render(<Fixture />);
`;
const { outputFiles } = require("esbuild").buildSync({ stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, bundle: true,
  write: false, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" } });
const html = '<!doctype html><html lang="zh"><meta charset="utf-8"><title>Batch Upload Details Fixture</title><div id="root"></div><script src="/fixture.js"></script></html>';
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/fixture.js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
  response.end(request.url === "/fixture.js" ? outputFiles[0].contents : html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes("--serve")) {
  console.log(JSON.stringify({ url, scope: "isolated renderer fixture; no Electron IPC, media, account or upload actions" }));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
} else {
  let browser;
  try {
    browser = await require("playwright-core").chromium.launch({ headless: true, executablePath: process.env.JIANJI_SMOKE_CHROME || "/opt/google/chrome/google-chrome" });
    const page = await browser.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await page.getByRole("heading", { name: "千川上传 · 晚安油", exact: true }).waitFor();
    const progress = await page.getByRole("status", { name: "本项上传进度", exact: true }).innerText();
    for (const text of ["已上传 12 / 30 条", "待上传 9 条", "结果未知 9 条"]) assert.ok(progress.includes(text), text);
    assert.equal(await page.getByRole("alert").count(), 1);
    assert.equal(await page.getByRole("button", { name: "安全继续", exact: true }).count(), 0);
    await page.evaluate(() => { window.fixtureHistorical = true; });
    await page.getByText("这是此前制作的上传记录；自动上传只处理当前制作，旧记录不会自动续传。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("status", { name: "本项上传进度", exact: true }).innerText(), progress);
    await page.getByRole("button", { name: "← 返回批量列表", exact: true }).click();
    await page.getByText("已返回批量列表", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixtureActions), []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "PASS", checks: ["configured account name", "12 READY / 9 unknown / 9 pending", "history refresh retains captured progress", "back navigation"], actualUploadActions: 0 }));
  } finally {
    if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
  }
}
