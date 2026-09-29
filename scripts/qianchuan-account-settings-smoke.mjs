import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

// No videos, login, uploads or confirmation actions. All writes use a fresh test profile.
if (!process.env.DISPLAY) throw new Error("UNVERIFIED: Electron needs a display; run with xvfb-run -a.");
const root = process.cwd(), home = await mkdtemp(path.join(os.tmpdir(), "jianji-account-smoke-"));
const profile = path.join(home, "electron"), mapping = path.join(profile, "douyin-upload/accounts/mapping.json");
const executable = process.env.JIANJI_SMOKE_APP || path.join(root, "node_modules/electron/dist/electron");
const environment = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache") };
delete environment.ELECTRON_RUN_AS_NODE; delete environment.JIANJI_QIANCHUAN_ACCOUNT_CONFIG;
const accountId = "9007199254740911";
const plan = (id = accountId, ad = "9007199254740912") => `https://qianchuan.jinritemai.com/uni-prom?aavid=${id}&adId=${ad}`;
let chrome, duplicate, appBrowser, child, exited, log, productLabel = "蝴蝶贴";
async function fixtureBrowser(name) {
  const context = await chromium.launchPersistentContext(path.join(home, name), {
    executablePath: process.env.JIANJI_CHROME_PATH || "/usr/bin/google-chrome", headless: true,
    args: ["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"],
  });
  await context.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Isolated account fixture</title><p>No login or upload</p>" }));
  await context.pages()[0].goto(plan());
  return context;
}
async function start() {
  const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  log = await open(path.join(home, `electron-${port}.log`), "wx", 0o600);
  child = spawn(executable, [...(process.env.JIANJI_SMOKE_APP ? [] : [root]), `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", "--no-sandbox"], { env: environment, stdio: ["ignore", log.fd, log.fd] });
  exited = new Promise(resolve => child.once("close", resolve));
  for (let i = 0; i < 200; i++) {
    assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
    await delay(200);
  }
  appBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = appBrowser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 60000 });
  await page.waitForFunction(() => !!window.jianji?.saveQianchuanAccount);
  await page.getByRole("navigation", { name: "工作区", exact: true }).getByRole("button", { name: "作品", exact: true }).click();
  await page.locator('[aria-labelledby="douyin-upload-panel-title"]').waitFor();
  return page;
}
async function stop() {
  await appBrowser?.close(); appBrowser = undefined;
  if (child?.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await exited; await log?.close(); child = undefined;
}
async function until(page, predicate) {
  for (let i = 0; i < 100; i++) { const state = await page.evaluate(() => window.jianji.getState()); if (predicate(state)) return state; await delay(100); }
  throw new Error(`Account state did not settle: ${await page.getByRole("alert").allTextContents()}`);
}
async function edit(page, value) {
  await page.locator('.qianchuan-account-products').getByRole("button", { name: `${productLabel} 已设置` }).or(page.locator('.qianchuan-account-products').getByRole("button", { name: `${productLabel} 未设置` })).click();
  assert.equal(await page.locator("#qianchuan-browser-port").count(), 0);
  assert.equal(await page.locator(".qianchuan-account-editor input").count(), 1);
  assert.equal(await page.getByLabel("产品名称", { exact: true }).inputValue(), productLabel);
  await page.getByLabel("千川计划链接", { exact: true }).fill(value);
}
try {
  chrome = await fixtureBrowser("chrome");
  let page = await start();
  const initial = await page.evaluate(() => window.jianji.getState());
  assert.deepEqual(initial.douyinUpload.accounts, []); assert.equal(initial.douyinUpload.config.enabled, false);
  await edit(page, plan());
  await page.getByRole("button", { name: "保存账号", exact: true }).click();
  let saved = await until(page, s => s.douyinUpload.accounts.length === 1);
  const activePort = Number((await readFile(path.join(home, "chrome/DevToolsActivePort"), "utf8")).split("\n")[0]);
  assert.equal(saved.douyinUpload.accounts[0].browserPort, activePort);
  assert.equal(saved.douyinUpload.accounts[0].advertiserId, accountId);
  const before = await readFile(mapping);
  await edit(page, plan("9007199254740919"));
  await page.getByRole("button", { name: "保存账号", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "未找到该账户的可连接浏览器" }).waitFor();
  assert.deepEqual(await readFile(mapping), before); assert.equal(await page.getByLabel("千川计划链接", { exact: true }).inputValue(), plan("9007199254740919"));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  // Duplicate matching browsers must be rejected on a new account binding.
  duplicate = await fixtureBrowser("duplicate");
  const ambiguity = await page.evaluate(async value => {
    try { await window.jianji.saveQianchuanAccount({ product: "眼贴", planUrl: value }); return "unexpected success"; }
    catch (error) { return error.message; }
  }, plan());
  assert.match(ambiguity, /多个/); assert.deepEqual(await readFile(mapping), before);
  await duplicate.close(); duplicate = undefined;
  await chrome.close(); chrome = undefined;
  // Only the display name changes; the browser can remain closed and the target stays fixed.
  await edit(page, plan());
  await page.getByLabel("产品名称", { exact: true }).fill("  ");
  assert.equal(await page.getByRole("button", { name: "保存账号", exact: true }).isEnabled(), false);
  await page.getByLabel("产品名称", { exact: true }).fill("眼贴");
  assert.equal(await page.getByRole("button", { name: "保存账号", exact: true }).isEnabled(), false);
  await page.getByLabel("产品名称", { exact: true }).fill("新产品");
  await page.getByRole("button", { name: "保存账号", exact: true }).click();
  productLabel = "新产品";
  saved = await until(page, s => s.douyinUpload.accounts[0]?.productName === productLabel);
  assert.equal(saved.douyinUpload.accounts[0].product, "蝴蝶贴");
  assert.equal(saved.douyinUpload.accounts[0].browserPort, activePort);
  assert.equal(saved.douyinUpload.accounts[0].advertiserId, accountId);
  assert.equal(saved.douyinUpload.accounts[0].adId, "9007199254740912");
  await edit(page, plan());
  await page.getByLabel("产品名称", { exact: true }).fill("未保存名称");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal((await page.evaluate(() => window.jianji.getState())).douyinUpload.accounts[0].productName, productLabel);
  // Changing the plan in the same advertiser must work with the browser closed.
  await edit(page, plan(accountId, "9007199254740920"));
  await page.getByRole("button", { name: "保存账号", exact: true }).click();
  saved = await until(page, s => s.douyinUpload.accounts[0]?.adId === "9007199254740920");
  assert.equal(saved.douyinUpload.accounts[0].browserPort, activePort);
  const forged = await page.evaluate(async value => {
    try { await window.jianji.saveQianchuanAccount({ product: "蝴蝶贴", planUrl: value, browserPort: 9999 }); return false; } catch { return true; }
  }, plan()); assert.equal(forged, true);
  await edit(page, plan(accountId, "9007199254740920"));
  await page.screenshot({ path: path.join(home, "account-editor.png"), fullPage: true });
  await stop(); page = await start();
  const restored = await until(page, s => s.douyinUpload.accounts.length === 1);
  assert.deepEqual(restored.douyinUpload.accounts, saved.douyinUpload.accounts);
  assert.equal(restored.douyinUpload.config.enabled, false); assert.deepEqual(restored.douyinUpload.tasks, []);
  const state = JSON.parse(await readFile(path.join(profile, "douyin-upload/state.json"), "utf8"));
  assert.deepEqual(state.tasks, []); assert.deepEqual(state.intents, []);
  const report = { result: "PASS", home, executable, automaticPortZeroDiscovery: true, noPortInput: true, actualElectronPreloadIpc: true, failedDiscoveryPreservesDraftAndMapping: true, duplicateBrowserRejected: true, renameWithBrowserClosedKeepsTarget: true, invalidNamesBlocked: true, cancelledNameNotSaved: true, planChangeWithBrowserClosed: true, forgedPortRejected: true, restartRestores: true, uploads: 0, confirmations: 0, adSettingChanges: 0, realAccountAttach: false, browserMetadataReadOnly: true };
  await writeFile(path.join(home, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally { await stop(); await duplicate?.close(); await chrome?.close(); }
