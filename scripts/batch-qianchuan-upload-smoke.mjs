import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(os.tmpdir(), "jianji-batch-upload-smoke-"));
const home = path.join(directory, "home"), packaged = process.argv.includes("--packaged");
const ffmpeg = process.env.JIANJI_FFMPEG_PATH || "ffmpeg", ffprobe = process.env.JIANJI_FFPROBE_PATH || "ffprobe";
const report = { result: "NOT_EVALUATED", realAccountsUsed: false, directory, checks: [] };
const fixtures = [], routing = [];
let app;
async function state(page) { return page.evaluate(() => window.jianji.getState()); }
async function until(read, accept, timeout = 150000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await delay(100); }
  throw new Error("Timed out waiting for isolated batch upload");
}
async function closeApp() {
  if (!app) return;
  const current = app; app = undefined;
  const child = current.process();
  if (!await Promise.race([current.close().then(() => true, () => true), delay(10000).then(() => false)])) {
    child.kill("SIGTERM"); await delay(1000); if (child.exitCode === null) child.kill("SIGKILL");
  }
}
try {
  assert.ok(process.env.DISPLAY, "run with xvfb-run -a");
  const ffmpegHelp = execFileSync(ffmpeg, ["-hide_banner", "-h", "full"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.ok(ffmpegHelp.includes("-fps_mode"), "selected FFmpeg must support fps_mode");
  await mkdir(home);
  await symlink(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
  const helperFile = path.join(directory, "helper.mjs");
  await require("esbuild").build({ entryPoints: [path.join(root, "tests/helpers/douyin-cdp-fixture.ts")], bundle: true, platform: "node", format: "esm", outfile: helperFile, external: ["playwright-core"] });
  const helper = await import(pathToFileURL(helperFile).href);
  const html = await readFile(path.join(root, "tests/fixtures/qianchuan-production-page.html"), "utf8");
  const ids = [{ advertiserId: "123456", adId: "987654" }, { advertiserId: "223456", adId: "887654" }];
  for (let index = 0; index < 2; index++) {
    const fixtureRoot = path.join(directory, `browser-${index}`); await mkdir(fixtureRoot);
    const fixtureHtml = path.join(fixtureRoot, "page.html");
    await writeFile(fixtureHtml, html.replaceAll("123456", ids[index].advertiserId).replaceAll("987654", ids[index].adId));
    const browserData = packaged ? path.join(home, ".config", "jianji") : path.join(directory, "userData");
    const fixture = await helper.startQianchuanFixture({ tempRoot: fixtureRoot, production: true, fixtureHtml,
      profileDirectory: path.join(browserData, "douyin-upload", "account-browsers", ids[index].advertiserId) });
    fixture.setControls({ processingDelayMs: index ? 50 : 8000 }); fixtures.push(fixture);
    const browser = await require("playwright-core").chromium.connectOverCDP(fixture.cdpEndpoint); routing.push(browser);
    await browser.contexts()[0].route("https://qianchuan.jinritemai.com/**", async route => {
      const url = new URL(route.request().url());
      if (!["/uni-prom", "/controls", "/events"].includes(url.pathname)) return route.abort();
      const local = new URL(url.pathname, fixture.contract.origin); local.search = url.search;
      const method = route.request().method(), body = route.request().postData();
      const response = await fetch(local, { method, ...(body ? { body, headers: { "content-type": "application/json" } } : {}) });
      await route.fulfill({ status: response.status, contentType: response.headers.get("content-type") ?? "text/plain", body: await response.text() });
    });
    await browser.contexts()[0].pages()[0].goto(`https://qianchuan.jinritemai.com/uni-prom?aavid=${ids[index].advertiserId}&adId=${ids[index].adId}`);
  }
  const accountFile = path.join(directory, "accounts.json");
  const products = ["蝴蝶贴", "氨糖膏", "滴耳康", "眼贴", "肥皂", "热敷贴"];
  const usedPorts = new Set(fixtures.map(fixture => Number(new URL(fixture.cdpEndpoint).port)));
  let sparePort = 15000;
  const accounts = products.map((product, index) => {
    const fixtureIndex = product === "蝴蝶贴" ? 0 : product === "眼贴" ? 1 : -1;
    while (usedPorts.has(sparePort)) sparePort++;
    return { product, cdpEndpoint: fixtureIndex < 0 ? `http://127.0.0.1:${sparePort++}` : fixtures[fixtureIndex].cdpEndpoint,
      ...(fixtureIndex < 0 ? { advertiserId: String(100 + index), adId: String(200 + index) } : ids[fixtureIndex]) };
  });
  await writeFile(accountFile, JSON.stringify({ version: 1, accounts }), { mode: 0o600 });
  const sources = [];
  for (const [index, name] of ["商品甲", "商品乙", "只导出"].entries()) {
    const source = path.join(directory, name, "素材", "source.mp4"); await mkdir(path.dirname(source), { recursive: true });
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${["red", "blue", "green"][index]}:size=320x240:rate=10`, "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
    sources.push(source);
  }
  const bootstrap = path.join(directory, "bootstrap.cjs");
  await writeFile(bootstrap, `if(process.type === "browser") {
    const {app}=require("electron"); app.setPath("userData",${JSON.stringify(path.join(directory, "userData"))});
    app.setPath("documents",${JSON.stringify(directory)}); app.getAppPath=()=>${JSON.stringify(root)};
    process.resourcesPath=${JSON.stringify(path.join(root, "resources"))}; require(${JSON.stringify(path.join(root, "dist-electron/main.cjs"))});
  }`);
  const environment = { PATH: process.env.PATH, DISPLAY: process.env.DISPLAY, ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
    ...(process.env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } : {}), LANG: "C.UTF-8", HOME: home, NODE_PATH: path.join(root, "node_modules"),
    XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"), XDG_DATA_HOME: path.join(home, ".local/share"), JIANJI_FFMPEG_PATH: ffmpeg, JIANJI_FFPROBE_PATH: ffprobe };
  async function launch() {
    app = await require("playwright-core")._electron.launch({ executablePath: process.env.JIANJI_SMOKE_ELECTRON || require("electron"), args: packaged ? [] : [bootstrap], cwd: home, env: environment, timeout: 30000 });
    await app.evaluate(({ dialog, shell }, input) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input.accountFile] });
      dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: `${input.directory}/${options.defaultPath.split(/[\\/]/).pop()}` });
      dialog.showMessageBox = async () => ({ response: 0 }); shell.openExternal = async () => undefined;
    }, { accountFile, directory });
    const page = await app.firstWindow(); await page.waitForFunction(() => Boolean(window.jianji));
    await until(() => state(page), value => value.capabilities.ready); return page;
  }
  let page = await launch();
  const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath("userData") })); assert.equal(runtime.packaged, packaged);
  await page.evaluate(async () => { await window.jianji.selectQianchuanAccountConfig(); await window.jianji.saveDouyinUploadConfig({ enabled: true }); });
  const names = ["商品甲", "商品乙", "只导出"];
  const projectFiles = [];
  for (const [index, name] of [...names.entries()].reverse()) {
    const saved = await page.evaluate(async ({ source, name }) => {
      await window.jianji.newProject(); const state = await window.jianji.addAndProbe([source]);
      await window.jianji.setProductPriceDraft(state.project.id, "本批手动文字");
      return window.jianji.saveProject(name, { step: "templates", selectedMediaIds: state.project.mediaItems.map(item => item.id), ruleId: "clean", brief: "", decorations: { mode: "random" },
        requestedCount: 1, exportFormat: "mp4", exportSettings: { resolutionMode: "720p", frameRateMode: "source", quality: "balanced" }, outputDirectoryMode: "automatic" });
    }, { source: sources[index], name });
    projectFiles.push(path.join(directory, saved.recentProjects.find(item => item.id === saved.activeRecentProjectId).fileName));
  }
  const originals = await Promise.all(projectFiles.map(file => readFile(file)));
  await page.reload(); await page.waitForFunction(() => Boolean(window.jianji));
  await page.getByRole("button", { name: "批量制作", exact: true }).click();
  const row = name => page.getByRole("region", { name: `${name}制作设置`, exact: true });
  for (const [index, name] of names.entries()) {
    await row(name).getByRole("checkbox", { name: `选择模板 ${name}`, exact: true }).check();
    await row(name).getByRole("checkbox", { name: `${name}开启覆盖`, exact: true }).uncheck();
    await row(name).getByRole("spinbutton").fill(String([10, 2, 1][index]));
    assert.equal(await row(name).getByLabel("千川上传", { exact: true }).inputValue(), "");
  }
  await row("商品甲").getByLabel("千川上传", { exact: true }).selectOption("蝴蝶贴");
  await row("商品乙").getByLabel("千川上传", { exact: true }).selectOption("眼贴");
  await page.screenshot({ path: path.join(directory, "batch-settings.png"), fullPage: true });
  await page.getByRole("button", { name: "开始批量制作", exact: true }).click();
  const finished = await until(() => state(page), value => value.batchProduction?.status === "finished");
  assert.ok(finished.batchProduction.jobs.every(job => job.status === "completed"));
  async function details(run) { return page.evaluate(run => Promise.all(run.jobs.map(job => window.jianji.batchProductionDetails({ runId: run.id, jobId: job.id }))), run); }
  const ready = await until(() => details(finished.batchProduction), values => values[0].upload?.tasks.length === 10 && values[1].upload?.tasks.length === 2 && values.slice(0, 2).every(value => value.upload.tasks.every(task => task.state === "WAITING_FOR_CONFIRMATION")));
  assert.equal(ready[2].upload.tasks.length, 0);
  assert.ok(ready.slice(0, 2).every((value, index) => value.upload.tasks.every(task => task.advertiserId === ids[index].advertiserId && task.adId === ids[index].adId && value.job.taskIds.includes(task.export_task_id))));
  for (const name of names) assert.equal(await row(name).getByLabel("千川上传", { exact: true }).inputValue(), "");
  for (const [index, file] of projectFiles.entries()) {
    const saved = JSON.parse(await readFile(file, "utf8"));
    const original = JSON.parse(originals[index].toString("utf8"));
    // The active editor saves canonical export history for its project ID.
    // Batch inputs and upload authority must never become template drafts.
    delete saved.exportBatches; delete original.exportBatches;
    delete saved.updatedAt; delete original.updatedAt;
    assert.deepEqual(saved, original, `saved template changed: ${path.basename(file)}`);
    assert.ok(!JSON.stringify(saved).includes("douyinUpload"));
  }
  const inspection = await Promise.all(fixtures.map(fixture => fixture.inspect()));
  report.groupSizes = inspection.map(value => value.events.filter(event => event.type === "files").map(event => event.names.length));
  assert.ok(report.groupSizes.every(groups => groups.every(size => size >= 1 && size <= 9)));
  assert.ok(report.groupSizes[0].length >= 2);
  const ledger = JSON.parse(await readFile(path.join(runtime.userData, "douyin-upload/state.json"), "utf8"));
  assert.equal(ledger.intents.length, 12); assert.equal(ledger.tasks.length, 12);
  assert.equal(new Set(ledger.tasks.map(task => task.authorization.pageBatchId)).size, 2);
  for (const task of ledger.tasks) {
    const fence = JSON.parse(await readFile(path.join(runtime.userData, "douyin-upload/selection-fences", `${task.result.upload_task_id}.json`), "utf8"));
    assert.deepEqual(fence.pageOwnership, task.result.readyEvidence.pageOwnership);
  }
  const firstTask = ready[0].tasks[0];
  assert.ok(Number(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", firstTask.outputPath], { encoding: "utf8" })) > 0);
  await page.getByRole("button", { name: "查看 商品甲 作品", exact: true }).click();
  const progress = page.getByRole("region", { name: "本项千川上传" }).getByRole("status", { name: "本项上传进度" });
  await progress.waitFor();
  assert.match(await progress.innerText(), /已上传 10 \/ 10 条 · 待上传 0 条 · 处理中 0 条 · 结果未知 0 条 · 需处理 0 条 · 停在确定前/);
  await page.screenshot({ path: path.join(directory, "batch-ready.png"), fullPage: true });
  await page.getByRole("button", { name: "← 返回批量列表", exact: true }).click();
  report.checks.push("UI selection/reset", "two frozen accounts", "formal FFmpeg outputs", "group limit and per-file fences", "job-scoped ready details", "export-only item", "saved template drafts unchanged");
  await closeApp(); page = await launch();
  const recovered = await state(page); assert.equal(recovered.batchProduction.id, finished.batchProduction.id);
  const countBefore = inspection.map(value => value.events.filter(event => event.type === "files").length);
  await delay(1000);
  assert.deepEqual((await Promise.all(fixtures.map(fixture => fixture.inspect()))).map(value => value.events.filter(event => event.type === "files").length), countBefore);
  report.checks.push("restart no repeated selection");
  await page.getByRole("button", { name: "批量制作", exact: true }).click();
  for (const [index, name] of names.entries()) {
    if (index === 2) continue;
    await row(name).getByRole("checkbox", { name: `选择模板 ${name}`, exact: true }).check();
    await row(name).getByRole("checkbox", { name: `${name}开启覆盖`, exact: true }).uncheck();
    await row(name).getByRole("spinbutton").fill("2");
    await row(name).getByRole("textbox").fill("故障验证文字");
    await row(name).getByLabel("千川上传", { exact: true }).selectOption(index ? "眼贴" : "蝴蝶贴");
  }
  fixtures[0].setControls({ processingDelayMs: 8000 });
  await page.getByRole("button", { name: "开始批量制作", exact: true }).click();
  await until(() => fixtures[0].inspect(), value => value.events.filter(event => event.type === "files").length > countBefore[0]);
  fixtures[0].setControls({ failure: true });
  const fault = await until(() => state(page), value => value.batchProduction?.id !== recovered.batchProduction.id && value.batchProduction?.status === "finished");
  const stopped = await until(() => details(fault.batchProduction), values => values[0].upload.tasks.some(task => task.upload_outcome === "MAY_HAVE_UPLOADED") && values[1].upload.tasks.length === 2 && values[1].upload.tasks.every(task => task.upload_outcome === "READY"));
  assert.ok(stopped.every(value => value.job.status === "completed"));
  assert.ok(stopped[1].upload.tasks.every(task => task.state === "WAITING_FOR_CONFIRMATION" && task.upload_outcome === "READY"));
  const finalInspection = await Promise.all(fixtures.map(fixture => fixture.inspect()));
  assert.ok(finalInspection[1].events.filter(event => event.type === "files").length > countBefore[1]);
  assert.equal(finalInspection.flatMap(value => value.events).filter(event => event.type === "confirm" || event.type === "settings").length, 0);
  report.checks.push("unknown pauses only its account without changing completed exports");
  Object.assign(report, { result: "PASS", runtime, formalOutputs: 17, uploadedReady: 12 + stopped.flatMap(value => value.upload.tasks).filter(task => task.upload_outcome === "READY").length, confirmClicks: 0, adSettingsChanges: 0, productionOriginInterceptedLocally: true });
} catch (error) {
  report.result = "FAIL"; report.failure = String(error.stack ?? error).slice(0, 4000); process.exitCode = 1;
  if (app) { const page = await app.firstWindow(); await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).catch(() => undefined); }
}
finally {
  await closeApp(); await Promise.all(routing.map(browser => browser.close())); await Promise.all(fixtures.map(fixture => fixture.stop()));
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report, null, 2));
}
