import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jianji-qianchuan-smoke-"));
const packaged = process.argv.includes("--packaged");
const source = path.join(tempRoot, "offline-source.mp4"), output = path.join(tempRoot, "output");
const accountFile = path.join(tempRoot, "accounts.json"), projectFile = path.join(tempRoot, "offline.jianji-project.json");
const fixtureHome = path.join(tempRoot, "home"), userData = path.join(tempRoot, "userData");
const reportPath = path.join(tempRoot, "report.json");
const report = { result: "UNVERIFIED", reportPath, productionPage: "SOURCE_QUALIFIED_LIVE_APP_UPLOAD_NOT_EVALUATED", realAccountsUsed: false };
const ffmpeg = process.env.JIANJI_FFMPEG_PATH || "ffmpeg", ffprobe = process.env.JIANJI_FFPROBE_PATH || "ffprobe";
let app, fixture, helperPath, fixtureRoutingBrowser;
async function state(page) { return page.evaluate(() => window.jianji.getState()); }
async function until(page, predicate, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await state(page); if (predicate(value)) return value; await delay(250); }
  throw new Error("UNVERIFIED: desktop state did not reach the expected checkpoint");
}
async function closeApp() {
  if (!app) return;
  const current = app; app = undefined;
  const child = current.process();
  const closed = await Promise.race([current.close().then(() => true, () => true), delay(10_000).then(() => false)]);
  if (!closed && child.exitCode === null) { child.kill("SIGTERM"); await delay(1000); if (child.exitCode === null) child.kill("SIGKILL"); }
}
try {
  if (!process.env.DISPLAY) throw new Error("UNVERIFIED: Electron needs a display; run with xvfb-run -a");
  const help = execFileSync(ffmpeg, ["-hide_banner", "-h", "full"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const filters = execFileSync(ffmpeg, ["-hide_banner", "-filters"], { encoding: "utf8" });
  if (!help.includes("-fps_mode") || !filters.includes("drawtext") || !filters.includes("overlay")) throw new Error("UNVERIFIED: selected FFmpeg lacks required renderer capabilities");
  await Promise.all([mkdir(output), mkdir(fixtureHome), mkdir(userData)]);
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", source], { timeout: 30_000 });
  const original = await readFile(source);
  await symlink(path.join(root,"node_modules"), path.join(tempRoot,"node_modules"), "dir");
  helperPath = path.join(tempRoot, "douyin-cdp-fixture.mjs");
  await require("esbuild").build({ entryPoints: [path.join(root, "tests/helpers/douyin-cdp-fixture.ts")], bundle: true, platform: "node", format: "esm", outfile: helperPath, external: ["playwright-core"] });
  const helper = await import(pathToFileURL(helperPath).href);
  fixture = await helper.startQianchuanFixture({ tempRoot, production: true, chromeExecutable: await helper.resolveChromeExecutable(process.env.JIANJI_CHROME_PATH), fixtureHtml: path.join(root, "tests/fixtures/qianchuan-production-page.html"),
    profileDirectory: path.join(packaged ? path.join(fixtureHome, ".config", "jianji") : userData, "douyin-upload", "account-browsers", "123456") });
  // Keep the first group processing while further formal exports finish, exercising accumulated groups.
  fixture.setControls({ processingDelayMs: 10_000 });
  {
    // Test-only network interception in a fresh profile; package source remains unchanged.
    fixtureRoutingBrowser = await require("playwright-core").chromium.connectOverCDP(fixture.cdpEndpoint);
    await fixtureRoutingBrowser.contexts()[0].route("https://qianchuan.jinritemai.com/**", async route => {
      const requestUrl = new URL(route.request().url());
      if (!["/uni-prom", "/controls", "/events"].includes(requestUrl.pathname)) { await route.abort(); return; }
      const local = new URL(requestUrl.pathname, fixture.contract.origin); local.search = requestUrl.search;
      const method = route.request().method(), body = route.request().postData();
      const response = await fetch(local, { method, ...(body ? { body, headers: { "content-type": "application/json" } } : {}) });
      await route.fulfill({ status: response.status, contentType: response.headers.get("content-type") ?? "text/plain", body: await response.text() });
    });
    report.packagedProductionOriginInterceptedLocally = true;
    await fixtureRoutingBrowser.contexts()[0].pages()[0].goto("https://qianchuan.jinritemai.com/uni-prom?aavid=123456&adId=987654");
  }
  const products = ["蝴蝶贴", "氨糖膏", "滴耳康", "眼贴", "肥皂", "热敷贴"];
  const fixturePort = new URL(fixture.cdpEndpoint).port;
  const basePort = Number(fixturePort) >= 9300 && Number(fixturePort) < 9306 ? 9400 : 9300;
  await writeFile(accountFile, JSON.stringify({ version: 1, accounts: products.map((product, i) => ({ product, cdpEndpoint: product === "眼贴" ? fixture.cdpEndpoint.replace(/\/$/, "") : `http://127.0.0.1:${basePort + i}`, advertiserId: product === "眼贴" ? "123456" : String(100 + i), adId: product === "眼贴" ? "987654" : String(200 + i) })) }), { mode: 0o600 });
  const productionSource = await readFile(path.join(root, "src/main/qianchuan-page-contract.ts"), "utf8");
  const contractPattern = /export const PRODUCTION_QIANCHUAN_CONTRACT: QianchuanPageContract = \{[\s\S]*?\n\};/;
  assert.match(productionSource, contractPattern);
  // This temporary bundle changes only the finite contract. It is outside dist and never packaged.
  const fixtureMain = path.join(tempRoot, "fixture-main.cjs");
  if (!packaged) await require("esbuild").build({ entryPoints: [path.join(root, "src/main/index.ts")], bundle: true, platform: "node", format: "cjs", outfile: fixtureMain, external: ["electron", "playwright-core", "sql.js/*"], plugins: [{ name: "isolated-contract", setup(build) {
    build.onLoad({ filter: /qianchuan-page-contract\.ts$/ }, async args => ({ loader: "ts", contents: (await readFile(args.path, "utf8")).replace(contractPattern, `export const PRODUCTION_QIANCHUAN_CONTRACT: QianchuanPageContract = ${JSON.stringify(fixture.contract)};`) }));
  } }] });
  const bootstrap = path.join(tempRoot, "bootstrap.cjs");
  await writeFile(bootstrap, `if (process.type === "browser") {
    const {app,dialog,shell} = require("electron");
    app.setPath("userData",${JSON.stringify(userData)}); app.setPath("documents",${JSON.stringify(tempRoot)});
    app.getAppPath = () => ${JSON.stringify(root)}; process.resourcesPath = ${JSON.stringify(path.join(root,"resources"))};
    dialog.showOpenDialog = async (_w,o={}) => ({canceled:false,filePaths:[o.properties?.includes("openDirectory") ? ${JSON.stringify(output)} : o.filters?.some(f=>f.extensions?.includes("json")) ? ${JSON.stringify(accountFile)} : ${JSON.stringify(source)}]});
    dialog.showSaveDialog = async () => ({canceled:false,filePath:${JSON.stringify(projectFile)}});
    dialog.showMessageBox = async (_w,o={}) => ({response:o.buttons?.includes("新建") ? 0 : 1,checkboxChecked:false});
    shell.openExternal = async () => undefined;
    try { require(${JSON.stringify(fixtureMain)}); } catch(error) { require("node:fs").writeFileSync(${JSON.stringify(path.join(tempRoot,"bootstrap-error.txt"))}, String(error.stack)); throw error; }
  }`);
  const environment = { PATH: process.env.PATH, DISPLAY: process.env.DISPLAY, ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}), ...(process.env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } : {}), LANG: process.env.LANG || "C.UTF-8", HOME: fixtureHome, NODE_PATH: path.join(root,"node_modules"), XDG_CONFIG_HOME: path.join(fixtureHome,".config"), XDG_CACHE_HOME: path.join(fixtureHome,".cache"), XDG_DATA_HOME: path.join(fixtureHome,".local/share"), JIANJI_FFMPEG_PATH: ffmpeg, JIANJI_FFPROBE_PATH: ffprobe };
  const electron = process.env.JIANJI_SMOKE_ELECTRON || (packaged ? path.join(root,"dist/linux-unpacked/jianji") : require("electron"));
  async function launch() {
    app = await require("playwright-core")._electron.launch({ executablePath: electron, args: packaged ? [] : [bootstrap], cwd: packaged ? fixtureHome : root, env: environment, timeout: 30_000 });
    await app.evaluate(({dialog,shell}, files) => {
      dialog.showOpenDialog = async (_w,o={}) => ({canceled:false,filePaths:[o.properties?.includes("openDirectory") ? files.output : o.filters?.some(f=>f.extensions?.includes("json")) ? files.accountFile : files.source]});
      dialog.showSaveDialog = async () => ({canceled:false,filePath:files.projectFile});
      dialog.showMessageBox = async (_w,o={}) => ({response:o.buttons?.includes("新建") ? 0 : 1,checkboxChecked:false}); shell.openExternal = async () => undefined;
    }, {source,output,accountFile,projectFile});
    app.process().stderr?.on("data", chunk => console.error(String(chunk)));
    const page = await app.firstWindow(); await page.waitForFunction(() => !!window.jianji);
    await until(page, value => value.capabilities.ready, 60_000); return page;
  }
  let page = await launch();
  const runtime = await app.evaluate(({app}) => ({packaged:app.isPackaged,appPath:app.getAppPath(),userData:app.getPath("userData")}));
  assert.equal(runtime.packaged, packaged);
  await page.getByRole("button", {name:"作品",exact:true}).click();
  await page.getByText("高级设置",{exact:true}).click();
  await page.getByRole("button", {name:"导入已有账号配置",exact:true}).click();
  const accounts = (await until(page, value => value.douyinUpload.accounts.length === 6, 15_000)).douyinUpload;
  assert.equal(accounts.accounts.length, 6); assert.equal(accounts.configSelected, true);
  assert.equal(JSON.stringify(accounts).includes(accountFile), false); assert.equal(JSON.stringify(accounts).includes(fixture.cdpEndpoint), false);
  await page.getByLabel("启用千川上传",{exact:true}).check();
  await page.getByRole("button",{name:"保存上传设置",exact:true}).click();
  await until(page, value => value.douyinUpload.config.enabled);
  assert.equal((await state(page)).douyinUpload.ready, true);
  await page.getByRole("button",{name:"制作",exact:true}).click();
  await page.getByRole("button",{name:"选择本地素材",exact:true}).click();
  await page.locator(".media-list").getByText("offline-source.mp4",{exact:true}).waitFor();
  await page.getByRole("button",{name:"下一步，设置制作规则"}).click();
  const choice = () => page.locator('section[aria-labelledby="douyin-upload-title"] input[type="checkbox"]');
  assert.equal(await choice().isChecked(), false);
  await choice().check(); assert.equal(await page.locator("#douyin-upload-product").inputValue(), "");
  // Switching project clears the one-batch choice; global configuration remains.
  const firstProject = (await state(page)).project.id;
  await page.locator(".project-switcher summary").click(); await page.getByRole("button",{name:/新建项目/}).click();
  await until(page, value => value.project.id !== firstProject);
  await page.getByRole("button",{name:"选择本地素材",exact:true}).click();
  await page.locator(".media-list").getByText("offline-source.mp4",{exact:true}).waitFor();
  await page.getByRole("button",{name:"下一步，设置制作规则"}).click(); assert.equal(await choice().isChecked(), false);
  await page.getByRole("button",{name:"本地随机",exact:true}).click(); await page.locator("#product-price").fill("离线12.3元"); await page.locator("#production-count").fill("12");
  await page.locator(".directory-picker").click(); await choice().check();
  await page.locator("#douyin-upload-product").selectOption("眼贴");
  await page.getByRole("button",{name:/本地制作，制作 12 条成片/}).click();
  const completedState = await until(page, value => {
    const tasks = value.queue.batches.filter(({batch}) => batch.projectId === value.project.id).flatMap(({batch}) => batch.tasks);
    return tasks.length === 12 && tasks.every(task => task.status === "completed") && value.douyinUpload.tasks.length === 12 && value.douyinUpload.tasks.every(task => task.state === "WAITING_FOR_CONFIRMATION");
  });
  const completedBatch = completedState.queue.batches.find(({batch}) => batch.tasks.some(task => task.status === "completed"));
  const completed = completedBatch.batch.tasks.find(task=>task.status === "completed");
  await page.getByRole("status",{name:"上传进度",exact:true}).filter({hasText:"已上传 12 / 12 条"}).waitFor();
  assert.equal(await page.getByText("上传记录已保存 · 本计划不会重复上传",{exact:true}).count(),12);
  assert.ok(Number(execFileSync(ffprobe,["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",completed.outputPath],{encoding:"utf8"})) > 0);
  assert.deepEqual(await readFile(source), original); assert.equal(completedState.connection.configured,false);
  {
    const result = completedState.douyinUpload.tasks[0]; assert.equal(result.upload_outcome,"READY"); assert.equal(result.accountProduct,"眼贴");
    const inspected = await fixture.inspect(); assert.equal(inspected.events.filter(event => event.type === "confirm" || event.type === "settings").length,0);
    const groups = inspected.events.filter(event => event.type === "files").map(event => event.names);
    assert.ok(groups.every(group => group.length >= 1 && group.length <= 9));
    assert.ok(groups.some(group => group.length > 1), "desktop path must exercise a multiple-file group");
    const ledger = JSON.parse(await readFile(path.join(runtime.userData,"douyin-upload/state.json"),"utf8"));
    assert.equal(ledger.tasks[0].authorization.target.advertiserId,"123456"); assert.ok(ledger.tasks[0].result.readyEvidence); assert.equal(ledger.version,3); assert.deepEqual(ledger.closedBatches,[]);
    const selected = ledger.tasks.filter(task => !task.result.duplicate_of);
    assert.deepEqual(new Set(groups.flat()),new Set(selected.map(task => task.result.file_name)));
    assert.equal(groups.flat().length,selected.length);
    let cumulative = 0;
    for (const group of groups) {
      cumulative += group.length;
      for (const name of group) {
        const task = selected.find(task => task.result.file_name === name);
        assert.equal(task.result.readyEvidence.selectedCount,cumulative);
        const fence = JSON.parse(await readFile(path.join(runtime.userData,"douyin-upload/selection-fences",`${task.result.upload_task_id}.json`),"utf8"));
        assert.deepEqual(fence.pageOwnership,task.result.readyEvidence.pageOwnership);
      }
    }
    report.groupSizes = groups.map(group => group.length); report.formalOutputs = 12; report.perFileFences = selected.length;
  }
  {
    const ref = completedState.douyinUpload.tasks[0];
    const rejected = await page.evaluate(async ref => {
      const refused = async action => { try { await action(); return false; } catch { return true; } };
      return {
        crossProject: await refused(() => window.jianji.resumeDouyinUpload("11111111-1111-4111-8111-111111111111",ref.upload_task_id)),
        arbitraryPath: await refused(() => window.jianji.saveDouyinUploadConfig({enabled:true,accountConfigPath:"/tmp/not-dialog-authorized.json"})),
        caption: await refused(() => window.jianji.reviseDouyinUploadCaption(ref.project_id,ref.upload_task_id,"old publish caption")),
        confirm: await refused(() => window.jianji.confirmDouyinUpload(ref.project_id,ref.upload_task_id,{platform_content_id:"fixture",accepted_status:"reviewing",url:"https://creator.douyin.com/fixture",observed_at:new Date().toISOString(),confirmation_source:"human",evidence:"legacy fixture only"})),
      };
    },ref);
    assert.deepEqual(rejected,{crossProject:true,arbitraryPath:true,caption:true,confirm:true});
    report.strictIpc = rejected;
    // Each completed version has its own append action; explicitly choose the first.
    await page.getByRole("button",{name:"追加制作",exact:true}).first().click();
    const append = page.getByRole("dialog",{name:"追加制作",exact:true}); await append.waitFor();
    const appendChoice = append.locator('section[aria-labelledby="append-douyin-upload-title"] input[type="checkbox"]');
    assert.equal(await appendChoice.isChecked(),false); await appendChoice.check();
    assert.equal(await append.locator("#append-douyin-upload-product").inputValue(),"");
    await append.locator("#append-douyin-upload-product").selectOption("眼贴");
    await append.locator("#append-count").fill("1");
    await append.locator("#append-directory").click();
    await append.getByRole("button",{name:"追加 1 条并开始渲染",exact:true}).click();
    await until(page,value=>value.douyinUpload.tasks.length===1 && value.douyinUpload.tasks.every(task=>task.state === "WAITING_FOR_CONFIRMATION"));
    const ledger = JSON.parse(await readFile(path.join(runtime.userData,"douyin-upload/state.json"),"utf8"));
    assert.equal(ledger.tasks.length,13,"prior production remains in the private ledger");
    report.currentProductionOnly = true;
    assert.equal((await fixture.inspect()).events.filter(event=>event.type === "confirm" || event.type === "settings").length,0);
    report.appendIndependentChoice = true;
  }
  await page.getByRole("button",{name:"包装",exact:true}).click(); assert.equal(await choice().isChecked(),false);
  const saved = await page.evaluate(()=>window.jianji.saveProject("Qianchuan offline smoke")); assert.ok(saved.activeRecentProjectId);
  const beforeRestart = await fixture.inspect(); await closeApp(); page = await launch(); await delay(1000);
  const reopened = await page.evaluate(id=>window.jianji.loadProject(id),saved.activeRecentProjectId); assert.equal(reopened.project.id,saved.project.id);
  assert.equal((await fixture.inspect()).events.filter(event=>event.type === "files").length,beforeRestart.events.filter(event=>event.type === "files").length,"restart/reopen never selects files");
  assert.equal(reopened.douyinUpload.tasks.length,0,"restart does not reactivate historical production");
  await page.getByRole("button",{name:"作品",exact:true}).click();
  await page.getByText("当前项目没有千川上传任务。",{exact:true}).waitFor();
  const persisted = JSON.parse(await readFile(path.join(runtime.userData,"douyin-upload/state.json"),"utf8"));
  assert.equal(persisted.tasks.length,13); assert.ok(persisted.tasks.every(task=>task.result.upload_outcome === "READY"));
  report.persistedUploadMarkersRetained = true;
  if (packaged) report.packagedAttach = await app.evaluate(async ({app},input)=>{
    const runtimeRequire=process.mainModule.require("node:module").createRequire(`${app.getAppPath()}/package.json`);
    const browser=await runtimeRequire("playwright-core").chromium.connectOverCDP(input.endpoint,{timeout:8000,noDefaults:true});
    try { const page=await browser.contexts()[0].newPage(); await page.goto(input.url); if(await page.title()!=="Offline upload fixture") throw new Error("fixture title mismatch"); await page.close(); return {playwrightPath:runtimeRequire.resolve("playwright-core"),attached:true}; } finally {await browser.close();}
  },{endpoint:fixture.cdpEndpoint,url:fixture.uploadUrl});
  await closeApp();
  Object.assign(report,{result:"PASS",runtime,formalFfmpegOutput:true,desktopFixtureUpload:true,productionNativeDrop:true,preload:true,nativeDialogBoundary:true,defaultOff:true,projectSwitchReset:true,submissionReset:true,restartNoSelection:true,confirmClicks:(await fixture.inspect()).events.filter(event=>event.type === "confirm").length});
} catch(error) { report.result = error.message?.startsWith("UNVERIFIED:") ? "UNVERIFIED" : "FAIL"; report.failure=error.message; process.exitCode=1; console.error(error); }
finally { await closeApp(); await fixtureRoutingBrowser?.close(); await fixture?.stop(); if(helperPath) await rm(helperPath,{force:true}); await writeFile(reportPath,JSON.stringify(report,null,2)+"\n"); console.log(JSON.stringify(report,null,2)); if(process.env.JIANJI_SMOKE_KEEP!=="1") await rm(tempRoot,{recursive:true,force:true}); }
