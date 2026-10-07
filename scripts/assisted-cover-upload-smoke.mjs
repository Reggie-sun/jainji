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
const directory = await mkdtemp(path.join(os.tmpdir(), "jianji-cover-upload-smoke-"));
const home = path.join(directory, "home"), packaged = false;
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
  await require("esbuild").build({ entryPoints: [path.join(root, "tests/helpers/douyin-cdp-fixture.ts")], bundle: true, platform: "node", format: "esm", outfile: helperFile, external: ["playwright-core", "ws"] });
  const helper = await import(pathToFileURL(helperFile).href);
  const fixtureChrome = path.join(directory, "fixture-chrome");
  const chromeExecutable = await helper.resolveChromeExecutable();
  await writeFile(fixtureChrome, `#!/bin/sh\nexec '${chromeExecutable.replaceAll("'", "'\\''")}' --profile-directory=Default "$@"\n`, { mode: 0o700 });
  const bindingsFile = path.join(directory, "bindings.cjs");
  await require("esbuild").build({ entryPoints: [path.join(root, "src/main/qianchuan-browser-bindings.ts")], bundle: true, platform: "node", format: "cjs", outfile: bindingsFile });
  const { QianchuanBrowserBindings } = require(bindingsFile);
  const html = await readFile(path.join(root, "tests/fixtures/qianchuan-production-page.html"), "utf8");
  const ids = [{ advertiserId: "123456", adId: "987654" }];
  for (let index = 0; index < 1; index++) {
    const fixtureRoot = path.join(directory, `browser-${index}`); await mkdir(fixtureRoot);
    const fixtureHtml = path.join(fixtureRoot, "page.html");
    await writeFile(fixtureHtml, html.replaceAll("123456", ids[index].advertiserId).replaceAll("987654", ids[index].adId));
    const browserData = packaged ? path.join(home, ".config", "jianji") : path.join(directory, "userData");
    const fixture = await helper.startQianchuanFixture({ tempRoot: fixtureRoot, production: true, fixtureHtml, chromeExecutable: fixtureChrome,
      profileDirectory: path.join(browserData, "douyin-upload", "account-browsers", ids[index].advertiserId) });
    fixture.setControls({ processingDelayMs: 50 }); fixtures.push(fixture);
    const browser = await require("playwright-core").chromium.connectOverCDP(fixture.cdpEndpoint); routing.push(browser);
    await browser.contexts()[0].route("https://qianchuan.jinritemai.com/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/uni-prom" && !url.searchParams.get("adId")) return route.fulfill({ contentType: "text/html", body: `<html><head><meta charset="utf-8"></head><body><div class="account-info-container">ID：123456</div><table><tr class="ovui-tr"><td class="p-c-ad-name-col"><div class="oc-promotion-product-adinfo-name"><span class="oc-typography-value-int">隔离上传计划</span></div><div class="oc-promotion-product-adinfo-id-fade">ID：987654</div></td></tr></table><div data-e2e="oc_emptyKey_uni-prom__ocTable_pagination_group"><span class="ovui-page-total">共 1 条记录</span><li class="ovui-page-turner__item--active">1</li><li class="ovui-page-turner__item ovui-page-turner__item--disabled"><span class="ovui-page-turner__next-icon">下一页</span></li></div></body></html>` });
      if (!["/uni-prom", "/controls", "/events"].includes(url.pathname)) return route.abort();
      const local = new URL(url.pathname, fixture.contract.origin); local.search = url.search;
      const method = route.request().method(), body = route.request().postData();
      const response = await fetch(local, { method, ...(body ? { body, headers: { "content-type": "application/json" } } : {}) });
      await route.fulfill({ status: response.status, contentType: response.headers.get("content-type") ?? "text/plain", body: await response.text() });
    });
    await browser.contexts()[0].pages()[0].goto(`https://qianchuan.jinritemai.com/uni-prom?aavid=${ids[index].advertiserId}&adId=${ids[index].adId}`);
    const uploadRoot = path.join(browserData, "douyin-upload");
    await new QianchuanBrowserBindings(uploadRoot).save({ advertiserId: ids[index].advertiserId,
      profile: path.join(uploadRoot, "account-browsers", ids[index].advertiserId), profileDirectory: "Default" });
  }
  const accountFile = path.join(directory, "accounts.json");
  const products = ["蝴蝶贴", "氨糖膏", "滴耳康", "眼贴", "肥皂", "热敷贴"];
  const usedPorts = new Set(fixtures.map(fixture => Number(new URL(fixture.cdpEndpoint).port)));
  let sparePort = 15000;
  const accounts = products.map((product, index) => {
    const fixtureIndex = product === "眼贴" ? 0 : -1;
    while (usedPorts.has(sparePort)) sparePort++;
    return { product, ...(fixtureIndex < 0 ? {} : { productName: fixtureIndex ? "商品乙" : "商品甲" }), cdpEndpoint: fixtureIndex < 0 ? `http://127.0.0.1:${sparePort++}` : fixtures[fixtureIndex].cdpEndpoint,
      ...(fixtureIndex < 0 ? { advertiserId: String(100 + index), adId: String(200 + index) } : ids[fixtureIndex]) };
  });
  await writeFile(accountFile, JSON.stringify({ version: 1, accounts }), { mode: 0o600 });
  const sources = [];
  for (const [index, name] of ["人工覆盖"].entries()) {
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
  await page.evaluate(async source => {
    const state = await window.jianji.addAndProbe([source]);
    await window.jianji.setCoverSticker({ stickerIds: [], rectangle: { x: 0, y: 0, width: .1, height: .1 }, ...state.project.coverSticker, enabled: true, trackingMode: "manual", assistedArtwork: undefined, coverStrategy: undefined });
    await window.jianji.saveProject("人工覆盖上传", { step: "templates", selectedMediaIds: state.project.mediaItems.map(item => item.id), ruleId: "clean", brief: "", decorations: { mode: "manual", sticker: "none", displayText: { enabled: false, x: .5, y: .1 } }, requestedCount: 1, exportFormat: "mp4", exportSettings: { resolutionMode: "source", frameRateMode: "source", quality: "balanced" }, outputDirectoryMode: "automatic" });
  }, sources[0]);
  await page.reload();
  const coverSettings = page.getByRole('region', { name: '覆盖原贴纸设置', exact: true });
  await coverSettings.getByRole('button', { name: '人工框选区域 + 贴纸覆盖', exact: true }).click();
  assert.equal(await coverSettings.getByText('已覆盖', { exact: true }).count(), 0);
  await coverSettings.getByRole('button', { name: '保存设置并打开框选', exact: true }).click();
  await coverSettings.locator('.cover-review video').waitFor();
  assert.equal(await page.locator('.cover-review').count(), 1);
  assert.ok(await page.evaluate(() => Boolean(document.querySelector('.cover-review').compareDocumentPosition(document.querySelector('.step-footer')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  await coverSettings.screenshot({ path: path.join(directory, 'human-region-entry.png') });
  await page.getByRole('button', { name: '建立人工区域草稿', exact: true }).click();
  await page.getByRole('button', { name: '新增人工覆盖区域', exact: true }).waitFor();
  const reviewId = (await state(page)).project.reviewDrafts.at(-1).id;
  await coverSettings.getByRole('button', { name: '手动设置', exact: true }).click();
  assert.equal(await coverSettings.locator('.cover-review').count(), 0);
  await coverSettings.getByRole('button', { name: '恢复已应用设置', exact: true }).click();
  await coverSettings.getByRole('button', { name: '新增人工覆盖区域', exact: true }).waitFor();
  assert.equal((await state(page)).project.reviewDrafts.at(-1).id, reviewId);
  await page.getByRole('button', { name: '新增人工覆盖区域', exact: true }).click();
  const move = page.getByRole('button', { name: '移动覆盖框 1', exact: true });
  await move.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const beforeDrag = (await state(page)).project.reviewDrafts.at(-1).media[0].segments[0].track.keyframes[0].rectangle;
  const box = await move.boundingBox(); assert.ok(box);
  assert.ok(await move.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), 'drag target must be visible outside sticky navigation');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 15, { steps: 5 }); await page.mouse.up();
  await until(() => state(page), value => value.project.reviewDrafts.at(-1).media[0].segments[0].track.keyframes[0].rectangle.x !== beforeDrag.x);
  const details = page.locator('.cover-review details').filter({ has: page.locator('summary').filter({ hasText: '精确位置' }) });
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
  for (const [i, label] of ['左侧 %', '顶部 %', '宽 %', '高 %'].entries()) await page.getByRole('spinbutton', { name: label, exact: true }).fill(String([0, 0, 10, 10][i]));
  await page.getByRole('button', { name: '保存此框', exact: true }).last().click();
  await page.getByRole('button', { name: '确认范围', exact: true }).click();
  await page.getByRole('checkbox', { name: '本次成片导出完成后自动上传，停在确定前', exact: true }).check();
  await page.locator('#douyin-upload-product').selectOption('眼贴');
  await page.getByRole('button', { name: '确认全部版本、导出并上传千川', exact: true }).waitFor();
  const planSelect = page.getByRole('combobox', { name: '上传计划', exact: true });
  await planSelect.locator('option[value="987654"]').waitFor({ state: 'attached', timeout: 30000 });
  await planSelect.selectOption('987654');
  await page.getByRole('button', { name: '生成预览', exact: true }).click();
  await page.getByRole('button', { name: '查看预览', exact: true }).waitFor({ timeout: 150000 });
  assert.equal((await fixtures[0].inspect()).events.filter(event => event.type === 'files').length, 0);
  assert.equal((await state(page)).douyinUpload.tasks.length, 0);
  await page.getByRole('button', { name: '查看预览', exact: true }).click();
  await page.locator('.cover-review video').evaluate(video => { video.muted = true; return video.play(); });
  await page.waitForFunction(() => document.querySelector('.cover-review video')?.ended);
  await page.getByRole('button', { name: '我已查看此版动态预览', exact: true }).click();
  await page.screenshot({ path: path.join(directory, 'approved-preview.png'), fullPage: true });
  await page.getByRole('button', { name: '确认全部版本、导出并上传千川', exact: true }).click();
  const ready = await until(() => state(page), value => value.douyinUpload.tasks.length === 1 && value.douyinUpload.tasks[0].state === 'WAITING_FOR_CONFIRMATION');
  const draft = ready.project.reviewDrafts.at(-1);
  assert.equal(draft.approval.receipts.length, 1);
  assert.ok(draft.approval.uploadSelectionDigest);
  assert.ok(!JSON.stringify(draft).includes('隔离上传计划'));
  assert.ok(!JSON.stringify(draft).includes('douyinUpload'));
  const before = await fixtures[0].inspect();
  await page.getByRole('button', { name: '核对并继续未提交版本', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.cover-review').innerText.includes('正在保存或准备'));
  await delay(500);
  assert.equal((await fixtures[0].inspect()).events.filter(event => event.type === 'files').length, before.events.filter(event => event.type === 'files').length);
  assert.equal(before.events.filter(event => event.type === 'confirm' || event.type === 'settings').length, 0);
  const ledger = JSON.parse(await readFile(path.join(runtime.userData, 'douyin-upload/state.json'), 'utf8'));
  assert.equal(ledger.intents.length, 1); assert.equal(ledger.tasks.length, 1);
  const task = ledger.tasks[0];
  assert.equal(task.result.advertiserId, '123456'); assert.equal(task.result.adId, '987654');
  assert.ok(!task.input.video_path.includes('previews'));
  const fence = JSON.parse(await readFile(path.join(runtime.userData, 'douyin-upload/selection-fences', `${task.result.upload_task_id}.json`), 'utf8'));
  assert.deepEqual(fence.pageOwnership, task.result.readyEvidence.pageOwnership);
  report.checks.push('real human-region UI preview and explicit upload choice', 'preview zero file selection', 'real FFmpeg formal export', 'production CDP uploader against isolated local page', 'durable private intent and selection fence', 'repeat approval no reselection', 'zero platform confirm/settings clicks');
  Object.assign(report, { result: 'PASS', runtime, formalOutput: task.input.video_path, uploadedReady: 1, confirmClicks: 0, productionOriginInterceptedLocally: true });
} catch (error) {
  report.fixturePages = await Promise.all(routing.flatMap(browser => browser.contexts()[0].pages()).map(async page => ({ url: page.url(), html: await page.content().catch(() => '') })));
  report.result = 'FAIL'; report.failure = String(error.stack ?? error).slice(0, 4000); process.exitCode = 1;
  if (app) { const page = await app.firstWindow(); report.pageText = await page.locator('body').innerText().catch(() => ''); await page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }).catch(() => undefined); }
} finally {
  await closeApp(); await Promise.all(routing.map(browser => browser.close())); await Promise.all(fixtures.map(fixture => fixture.stop()));
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
