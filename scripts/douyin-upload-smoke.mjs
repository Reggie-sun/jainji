import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jianji-douyin-upload-smoke-"));
const userData = path.join(tempRoot, "electron-user-data");
const fixtureHome = path.join(tempRoot, "home");
const source = path.join(tempRoot, "offline-source.mp4");
const output = path.join(tempRoot, "output");
const bootstrap = path.join(tempRoot, "bootstrap.cjs");
const projectFile = path.join(tempRoot, "offline-project.jianji-project.json");
const reportPath = path.join(tempRoot, "report.json");
const sentinelHits = [];
const report = { result: "UNVERIFIED", reportPath, createdAt: new Date().toISOString() };
let actualUserDataPath = userData;
let electronApp;
let sentinel;
let chromeHelperPath;

function inspectExecutable(configured, fallback, name) {
  const executable = configured || fallback;
  try {
    const version = execFileSync(executable, ["-version"], { encoding: "utf8", timeout: 5000 }).trim().split(/\r?\n/, 1)[0];
    return { executable, version };
  } catch {
    throw new Error(`UNVERIFIED: required local ${name} executable is unavailable: ${executable}`);
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/`;
}

async function waitForCapabilities(page, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (Date.now() < deadline) {
    state = await page.evaluate(() => window.jianji.getState());
    if (state.capabilities.ready) return state.capabilities;
    await delay(250);
  }
  state = await page.evaluate(() => window.jianji.getState());
  throw new Error(`UNVERIFIED: local engine did not become ready; capabilities=${JSON.stringify(state.capabilities)}`);
}

async function launchElectron(electronPath, environment, packagedMode) {
  const app = await require("playwright-core")._electron.launch({
    executablePath: electronPath,
    args: packagedMode ? [] : [bootstrap],
    cwd: packagedMode ? environment.HOME : root,
    env: environment,
    timeout: 30_000,
  });
  const runtime = await app.evaluate(({ app: electronAppValue }) => ({
    version: process.versions.electron,
    isPackaged: electronAppValue.isPackaged,
    appPath: electronAppValue.getAppPath(),
    userDataPath: electronAppValue.getPath("userData"),
  }));
  assert.equal(runtime.isPackaged, packagedMode, "the selected Electron entry matches the requested development or packaged mode");
  if (packagedMode) assert.ok(runtime.userDataPath.startsWith(`${environment.HOME}${path.sep}`), "packaged Electron userData stays under the isolated smoke HOME");
  const dialogFixtureInstalled = await app.evaluate(({ dialog, shell }, paths) => {
    dialog.showOpenDialog = async (_window, options = {}) => ({
      canceled: false,
      filePaths: [options.properties?.includes("openDirectory") ? paths.output : paths.source],
    });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.projectFile });
    dialog.showMessageBox = async (_window, options = {}) => ({ response: options.buttons?.includes("新建") ? 0 : 1, checkboxChecked: false });
    shell.openExternal = async () => undefined;
    return true;
  }, { source, output, projectFile });
  assert.equal(dialogFixtureInstalled, true, "native dialog fixtures are installed in the actual Electron main process");
  const page = await app.firstWindow();
  page.on("pageerror", error => { throw new Error(`Renderer runtime error: ${error.message}`); });
  await page.waitForFunction(() => !!window.jianji && document.body.innerText.length > 0, undefined, { timeout: 30_000 });
  await page.getByRole("button", { name: "选择本地素材" }).waitFor({ state: "visible", timeout: 30_000 });
  const capabilities = await waitForCapabilities(page);
  return { app, page, runtime, capabilities };
}

async function closeElectron(app) {
  if (!app) return;
  const child = app.process();
  const closePromise = app.close();
  const closed = await Promise.race([closePromise.then(() => true, () => true), delay(10_000).then(() => false)]);
  if (closed) return;
  if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  const exited = await Promise.race([new Promise(resolve => child.once("exit", () => resolve(true))), delay(3000).then(() => false)]);
  if (!exited && child.exitCode === null) child.kill("SIGKILL");
  await Promise.race([closePromise.catch(() => undefined), delay(2000)]);
  if (child.exitCode === null) throw new Error("UNVERIFIED: isolated Electron child did not exit after graceful and forced cleanup");
}

async function waitForCompletedUploadBlock(page, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let current;
  while (Date.now() < deadline) {
    current = await page.evaluate(() => window.jianji.getState());
    const completed = current.queue.batches.flatMap(({ batch }) => batch.tasks).find(task => task.status === "completed" && task.outputArtifact);
    const blocked = current.douyinUpload?.tasks.find(task => task.state === "NEEDS_HUMAN" && task.failure?.code === "PAGE_CONTRACT_UNVERIFIED");
    if (completed && blocked) return { state: current, completed, blocked };
    await delay(400);
  }
  throw new Error(`UNVERIFIED: timed out waiting for completed export and fail-closed upload; page=${(await page.locator("body").innerText()).slice(-1200)} state=${JSON.stringify({ agentRun: current?.agentRun, batches: current?.queue.batches.map(value => value.batch.tasks.map(task => ({ status: task.status, error: task.errorMessage }))), upload: current?.douyinUpload?.tasks })}`);
}

try {
  if (!process.env.DISPLAY) throw new Error("UNVERIFIED: Electron needs a display; run with xvfb-run -a");
  const packagedMode = process.argv.includes("--packaged") || !!process.env.JIANJI_SMOKE_ELECTRON;
  const configuredElectron = process.env.JIANJI_SMOKE_ELECTRON;
  const electronPath = configuredElectron
    ? path.resolve(configuredElectron)
    : packagedMode
      ? path.join(root, "dist", "linux-unpacked", "jianji")
      : require("electron");
  if (typeof electronPath !== "string" || !electronPath) throw new Error("UNVERIFIED: Electron executable is unavailable");
  report.electronExecutable = electronPath;
  report.packagedMode = packagedMode;
  if (typeof require("playwright-core")._electron?.launch !== "function") throw new Error("UNVERIFIED: playwright-core Electron control is unavailable");
  const ffmpegInfo = inspectExecutable(process.env.JIANJI_FFMPEG_PATH, "ffmpeg", "FFmpeg");
  const ffprobeInfo = inspectExecutable(process.env.JIANJI_FFPROBE_PATH, "ffprobe", "FFprobe");
  const ffmpeg = ffmpegInfo.executable;
  const ffprobe = ffprobeInfo.executable;
  let ffmpegHelp;
  try {
    ffmpegHelp = execFileSync(ffmpeg, ["-hide_banner", "-h", "full"], { encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`UNVERIFIED: could not inspect selected FFmpeg ${ffmpegInfo.version}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!ffmpegHelp.includes("-fps_mode")) {
    throw new Error(`UNVERIFIED: selected FFmpeg lacks -fps_mode required by the current renderer: ${ffmpegInfo.executable} (${ffmpegInfo.version})`);
  }
  let ffmpegFilters;
  try {
    ffmpegFilters = execFileSync(ffmpeg, ["-hide_banner", "-filters"], { encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`UNVERIFIED: could not inspect selected FFmpeg filters ${ffmpegInfo.version}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const missingRendererFilters = ["drawtext", "overlay"].filter(filter => !new RegExp(`\\b${filter}\\b`).test(ffmpegFilters));
  if (missingRendererFilters.length) {
    throw new Error(`UNVERIFIED: selected FFmpeg lacks required renderer filters (${missingRendererFilters.join(", ")}): ${ffmpegInfo.executable} (${ffmpegInfo.version})`);
  }
  report.rendererSupport = { fpsMode: true, filters: { drawtext: true, overlay: true } };
  report.rendererFpsModeSupported = true;
  report.ffmpeg = ffmpegInfo;
  report.ffprobe = ffprobeInfo;
  for (const file of [path.join(root, "dist", "index.html"), path.join(root, "dist-electron", "main.cjs"), path.join(root, "dist-electron", "preload.cjs")]) {
    try { await stat(file); } catch { throw new Error(`UNVERIFIED: built Electron application file is missing: ${file}`); }
  }
  if (packagedMode) {
    try { await stat(electronPath); } catch { throw new Error(`UNVERIFIED: packaged Electron executable is missing: ${electronPath}`); }
  }
  chromeHelperPath = path.join(root, "tests/helpers/.douyin-cdp-fixture-smoke.mjs");
  await require("esbuild").build({
    entryPoints: [path.join(root, "tests/helpers/douyin-cdp-fixture.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: chromeHelperPath,
    packages: "bundle",
    external: ["playwright-core"],
  });
  const fixtureHelper = await import(pathToFileURL(chromeHelperPath).href);
  const chromeExecutable = await fixtureHelper.resolveChromeExecutable(process.env.JIANJI_CHROME_PATH);
  const chromeVersion = execFileSync(chromeExecutable, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
  report.chrome = { executable: chromeExecutable, version: chromeVersion };

  await mkdir(userData, { recursive: true });
  await mkdir(fixtureHome, { recursive: true });
  await mkdir(output, { recursive: true });
  const encoder = ffmpeg;
  execFileSync(encoder, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", source], { stdio: "ignore", timeout: 30_000 });
  const originalSource = await readFile(source);
  assert.equal(originalSource.subarray(4, 8).toString("ascii"), "ftyp", "FFmpeg created a synthetic MP4 source");

  sentinel = createServer((request, response) => {
    sentinelHits.push({ method: request.method, path: request.url });
    response.writeHead(500, { "content-type": "application/json" }).end("{}");
  });
  const sentinelUrl = await listen(sentinel);
  const appRoot = root;
  const mainEntry = path.join(root, "dist-electron", "main.cjs");
  await writeFile(bootstrap, `
if (process.type === "browser") {
const { app, dialog, shell } = require("electron");
const path = require("node:path");
process.chdir(${JSON.stringify(tempRoot)});
app.setPath("userData", ${JSON.stringify(userData)});
app.setPath("documents", ${JSON.stringify(tempRoot)});
dialog.showOpenDialog = async (_window, options = {}) => ({
  canceled: false,
  filePaths: [options.properties?.includes("openDirectory") ? ${JSON.stringify(output)} : ${JSON.stringify(source)}],
});
dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(projectFile)} });
dialog.showMessageBox = async (_window, options = {}) => ({ response: options.buttons?.includes("新建") ? 0 : 1, checkboxChecked: false });
shell.openExternal = async () => undefined;
if (!${JSON.stringify(packagedMode)}) {
  app.getAppPath = () => ${JSON.stringify(appRoot)};
  process.resourcesPath = path.join(${JSON.stringify(appRoot)}, "resources");
  require(${JSON.stringify(mainEntry)});
}
}
`);

  const environment = {
    PATH: process.env.PATH,
    ...(process.env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } : {}),
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
    ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
    HOME: fixtureHome,
    XDG_CONFIG_HOME: path.join(fixtureHome, ".config"),
    XDG_CACHE_HOME: path.join(fixtureHome, ".cache"),
    XDG_DATA_HOME: path.join(fixtureHome, ".local", "share"),
    JIANJI_FFMPEG_PATH: ffmpeg,
    JIANJI_FFPROBE_PATH: ffprobe,
  };
  let firstPage;
  let firstRuntime;
  let firstCapabilities;
  ({ app: electronApp, page: firstPage, runtime: firstRuntime, capabilities: firstCapabilities } = await launchElectron(electronPath, environment, packagedMode));
  actualUserDataPath = firstRuntime.userDataPath;
  report.firstRuntime = firstRuntime;
  report.firstCapabilities = firstCapabilities;
  console.log("Electron production entry started with isolated userData and native-dialog fixture.");
  await firstPage.getByRole("button", { name: "选择本地素材" }).click();
  await firstPage.locator(".media-list").getByText("offline-source.mp4", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await firstPage.getByRole("button", { name: "下一步，设置制作规则" }).click();
  const uploadCheckbox = () => firstPage.locator('section[aria-labelledby="douyin-upload-title"] input[type="checkbox"]');
  await uploadCheckbox().waitFor({ state: "visible" });
  assert.equal(await uploadCheckbox().isChecked(), false, "upload selection defaults off");
  await uploadCheckbox().check();
  await firstPage.locator("#douyin-upload-caption").fill("project-switch-reset-check");
  await firstPage.locator(".project-switcher summary").click();
  await firstPage.getByRole("button", { name: "新建项目" }).click();
  await firstPage.getByRole("button", { name: "选择本地素材" }).waitFor({ state: "visible", timeout: 15_000 });
  await firstPage.getByRole("button", { name: "选择本地素材" }).click();
  await firstPage.locator(".media-list").getByText("offline-source.mp4", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await firstPage.getByRole("button", { name: "下一步，设置制作规则" }).click();
  await uploadCheckbox().waitFor({ state: "visible" });
  assert.equal(await uploadCheckbox().isChecked(), false, "project switch clears the ephemeral upload choice");
  await firstPage.getByRole("button", { name: "本地随机", exact: true }).click();
  await firstPage.locator("#product-price").fill("离线 12.3元");
  await firstPage.locator("#production-count").fill("1");
  await firstPage.locator(".directory-picker").click();
  await firstPage.getByText(output, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  await uploadCheckbox().check();
  await firstPage.locator("#douyin-upload-caption").fill("fixture-only publish caption");

  const configured = await firstPage.evaluate(async endpoint => window.jianji.saveDouyinUploadConfig({
    enabled: true,
    cdpEndpoint: endpoint,
    timeouts: { connect: 1000, navigation: 1000, fileInput: 1000, processing: 1000, action: 1000, confirmation: 1000 },
    captureFailureDiagnostics: false,
  }), sentinelUrl);
  assert.equal(configured.douyinUpload?.ready, false, "the unverified production page contract keeps readiness false");
  assert.match(configured.douyinUpload?.message ?? "", /合同尚未核实/);
  assert.equal(sentinelHits.length, 0, "configuring the blocked production uploader makes no Chrome discovery request");

  console.log("Production contract remains blocked; starting the local-random FFmpeg export.");
  await firstPage.getByRole("button", { name: /本地制作，制作 1 条成片/ }).click();
  const { state, completed: completedTask, blocked: blockedUpload } = await waitForCompletedUploadBlock(firstPage);
  assert.ok(completedTask?.outputPath && completedTask.outputArtifact, "the original Electron queue committed a completed MP4");
  const completedBatch = state.queue.batches.find(({ batch }) => batch.id === completedTask.batchId);
  assert.ok(completedBatch, "completed queue state is available to the offline CDP leg");
  assert.deepEqual({ state: blockedUpload.state, outcome: blockedUpload.publish_outcome, failure: blockedUpload.failure?.code }, { state: "NEEDS_HUMAN", outcome: "NOT_SUBMITTED", failure: "PAGE_CONTRACT_UNVERIFIED" });
  assert.equal(state.douyinUpload?.ready, false);
  assert.equal(sentinelHits.length, 0, "production fails before any Chrome discovery or file transfer");
  assert.deepEqual(await readFile(source), originalSource, "local rendering leaves the synthetic source bytes unchanged");
  const outputDuration = Number(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", completedTask.outputPath], { encoding: "utf8", timeout: 10_000 }).trim());
  assert.ok(Number.isFinite(outputDuration) && outputDuration > 0, "the real FFmpeg output is probeable");
  const ledger = JSON.parse(await readFile(path.join(actualUserDataPath, "douyin-upload", "state.json"), "utf8"));
  const persistedTask = ledger.tasks.find(task => task.result.upload_task_id === blockedUpload?.upload_task_id);
  assert.equal(persistedTask?.input.caption, "fixture-only publish caption", "manual publish text persists independently in upload data");
  assert.equal(state.project.template.productPriceDraft, "离线 12.3元", "manual display price remains independently stored in the project");
  assert.equal(state.connection.configured, false, "the isolated app has no configured model provider");

  await firstPage.getByRole("button", { name: "包装", exact: true }).click();
  await uploadCheckbox().waitFor({ state: "visible" });
  assert.equal(await uploadCheckbox().isChecked(), false, "submitting the local batch clears the ephemeral upload choice");
  assert.equal(await firstPage.locator("#douyin-upload-caption").count(), 0, "the manual publish caption is no longer in the next batch draft");
  const savedProject = await firstPage.evaluate(async () => window.jianji.saveProject("Offline Douyin Smoke"));
  assert.ok(savedProject, "the desktop project saves through its native dialog boundary");
  assert.equal(savedProject.project.id, state.project.id, "saving retains the project identity associated with the upload task");
  const savedProjectId = savedProject.project.id;
  const savedRecentProjectId = savedProject.activeRecentProjectId;
  assert.ok(savedRecentProjectId, "saving records the isolated project in recent projects");
  report.savedProject = { path: projectFile, projectId: savedProjectId, recentProjectId: savedRecentProjectId };
  await closeElectron(electronApp); electronApp = undefined;

  console.log("Completed artifact and upload state persisted; restarting the production Electron entry.");
  let restartedPage;
  let restartedRuntime;
  let restartedCapabilities;
  ({ app: electronApp, page: restartedPage, runtime: restartedRuntime, capabilities: restartedCapabilities } = await launchElectron(electronPath, environment, packagedMode));
  assert.equal(restartedRuntime.userDataPath, actualUserDataPath, "Electron restart uses the same isolated userData location");
  report.restartedRuntime = restartedRuntime;
  report.restartedCapabilities = restartedCapabilities;
  await delay(1500);
  const startupState = await restartedPage.evaluate(() => window.jianji.getState());
  assert.equal(startupState.douyinUpload?.config.enabled, true, "uploader configuration survives an actual Electron restart");
  assert.equal(startupState.douyinUpload?.ready, false);
  assert.equal(sentinelHits.length, 0, "startup and queue recovery do not contact the local Chrome endpoint");
  assert.deepEqual(await readFile(source), originalSource);
  const reopenedState = await restartedPage.evaluate(async recentProjectId => window.jianji.loadProject(recentProjectId), savedRecentProjectId);
  assert.equal(reopenedState?.project.id, savedProjectId, "the same saved project is explicitly reopened after Electron restart");
  const restartedState = await restartedPage.evaluate(() => window.jianji.getState());
  assert.ok(restartedState.douyinUpload?.tasks.some(task => task.upload_task_id === blockedUpload?.upload_task_id && task.failure?.code === "PAGE_CONTRACT_UNVERIFIED"), "the reopened project's blocked upload state survives restart");
  assert.equal(sentinelHits.length, 0, "reopening a project never discovers or attaches to Chrome");
  if (!packagedMode) { await closeElectron(electronApp); electronApp = undefined; }

  console.log("Electron restart stayed fail-closed; exercising the isolated Chrome fixture adapter.");
  const packagedAttach = packagedMode ? async ({ cdpEndpoint, uploadUrl }) => electronApp.evaluate(async ({ app: electronAppValue }, input) => {
    if (!electronAppValue.isPackaged) throw new Error("packaged Electron runtime is required for the in-asar Playwright check");
    const runtimeRequire = process.mainModule?.require?.("node:module")?.createRequire?.(`${electronAppValue.getAppPath()}/package.json`);
    if (!runtimeRequire) throw new Error("packaged Electron main-module require is unavailable");
    const playwrightPath = runtimeRequire.resolve("playwright-core");
    const { chromium } = runtimeRequire("playwright-core");
    const browser = await chromium.connectOverCDP(input.cdpEndpoint, { timeout: 8000 });
    let page;
    try {
      const context = browser.contexts()[0];
      if (!context) throw new Error("packaged Playwright found no default Chrome context");
      page = await context.newPage();
      await page.goto(input.uploadUrl, { waitUntil: "domcontentloaded", timeout: 8000 });
      const title = await page.title();
      if (title !== "Offline upload fixture") throw new Error(`unexpected local fixture title: ${title}`);
      return { appPath: electronAppValue.getAppPath(), playwrightPath, title, attachedAndNavigated: true };
    } finally {
      if (page) await page.close().catch(() => undefined);
      await browser.close();
    }
  }, { cdpEndpoint, uploadUrl }) : undefined;
  const chromeResult = await fixtureHelper.runDouyinCdpFixture({
    chromeExecutable,
    fixtureHtml: path.join(root, "tests/fixtures/douyin-upload-page.html"),
    tempRoot,
    queueState: completedBatch,
    ...(packagedAttach ? { packagedAttach } : {}),
  });
  if (electronApp) { await closeElectron(electronApp); electronApp = undefined; }
  assert.deepEqual(sentinelHits, [], "the production Electron path never reaches the sentinel CDP endpoint");
  Object.assign(report, {
    result: "PASS",
    electron: { entry: packagedMode ? restartedRuntime.appPath : mainEntry, binary: electronPath, runtime: restartedRuntime, productionPreload: true, completedOutput: completedTask.outputPath, outputDurationSeconds: outputDuration, pageContract: blockedUpload.failure.code, readiness: state.douyinUpload.ready, sentinelCdpRequests: sentinelHits.length, persistedAcrossRestart: true },
    selection: { defaultOff: true, clearedOnProjectSwitch: true, clearedAfterSubmission: true, captionIndependentOfDisplayPrice: true },
    isolatedChromeFixture: chromeResult,
    accountOrProviderUse: "none; isolated HOME/userData and a temporary headless Chrome profile",
  });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`reportPath=${reportPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  report.result = error instanceof Error && error.message.startsWith("UNVERIFIED:") ? "UNVERIFIED" : "FAIL";
  report.failure = error instanceof Error ? error.message : String(error);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`).catch(writeError => console.error(writeError));
  console.error(`reportPath=${reportPath}`);
  process.exitCode = 1;
} finally {
  if (electronApp) await closeElectron(electronApp).catch(error => { console.error(error); process.exitCode = 1; });
  if (sentinel?.listening) await new Promise(resolve => { sentinel.close(() => resolve()); sentinel.closeAllConnections(); });
  if (chromeHelperPath) await rm(chromeHelperPath, { force: true });
  if (process.env.JIANJI_SMOKE_KEEP !== "1") await rm(tempRoot, { recursive: true, force: true });
}
