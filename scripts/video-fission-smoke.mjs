// Real renderer, preparation, queue and FFmpeg; local file-dialog bridge fixture only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const directory = await mkdtemp(path.join(tmpdir(), "jianji-fission-smoke-"));
let server, browser, queue, automation;
try {
  const bundle = path.join(directory, "owner.cjs");
  await build({ stdin: { contents: 'export {ApplicationService} from "./src/main/application.ts"; export {FfmpegAdapter} from "./src/main/ffmpeg.ts"; export {ExportQueue} from "./src/main/queue.ts"; export {JobStore} from "./src/main/store.ts"; export {prepareFissionProduction,executeScheduledFission} from "./src/main/video-fission.ts"; export {AutomationRuntime} from "./src/main/automation-runtime.ts"; export {AutomationScheduler} from "./src/main/automation-scheduler.ts"; export {videoPathsInDirectory} from "./src/main/media.ts"; export {createAutomaticOutputDirectory} from "./src/main/automatic-output-directory.ts";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", outfile: bundle, plugins: [{ name: "installed-runtime-package", setup(build) { build.onResolve({ filter: /^playwright-core$/ }, () => ({ path: createRequire(import.meta.url).resolve("playwright-core"), external: true })); } }] });
  const { ApplicationService, FfmpegAdapter, ExportQueue, JobStore, prepareFissionProduction, executeScheduledFission, AutomationRuntime, AutomationScheduler, videoPathsInDirectory, createAutomaticOutputDirectory } = createRequire(import.meta.url)(bundle);
  const ffmpeg = new FfmpegAdapter(process.env.JIANJI_FFMPEG_PATH || "ffmpeg", process.env.JIANJI_FFPROBE_PATH || "ffprobe");
  const fonts = { resolve: async () => null };
  const owner = new ApplicationService(ffmpeg, fonts);
  queue = new ExportQueue({ ffmpeg, jobStore: new JobStore(path.join(directory, "jobs")), fontResolver: fonts });
  queue.setMediaLookup(id => owner.getMedia(id));
  const input = path.join(directory, "用户输入"); await mkdir(input);
  const originals = [];
  for (let i = 0; i < 3; i++) {
    const source = path.join(input, `素材${i + 1}.mp4`);
    execFileSync(ffmpeg.ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", `testsrc2=s=180x320:r=30:d=2`, "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac", source]);
    originals.push([source, await readFile(source)]);
  }
  // Isolated upload UI/admission fixture; no platform adapter or credentials.
  const plan = { advertiserId: "1876000000000001", adId: "1876000000000002", name: "隔离测试计划", accountSource: "current-browser" };
  const uploadEvents = [];
  const scheduledRequests = [];
  const scheduledRuntime = new AutomationRuntime(path.join(directory, "automation"), {
    loadProject: async () => { throw Error("fixture has no saved templates"); },
    account: async product => ({product,advertiserId:plan.advertiserId,adId:plan.adId,cdpEndpoint:"http://127.0.0.1:9222",configDigest:"a".repeat(64)}),
    modelBinding: () => { throw Error("fission requires no model"); }, approvedDirectories:new Set(), controller:{},queue,task:id=>automation.task(id),
    produce:async()=>{throw Error("no ordinary production");},clear:async()=>{throw Error("no cleanup");},upload:async()=>{throw Error("no platform upload");},finishUploadAccount:async()=>{},releaseUploadAccounts:()=>{},
    fission:{loadProject:async id=>{assert.equal(id,owner.currentProject.id);return structuredClone(owner.currentProject);},execute:(input,project,signal)=>executeScheduledFission(queue,input,project.mediaItems,batches=>owner.rememberExportProduction(batches),signal)},
  });
  automation=new AutomationScheduler(path.join(directory,"automation"),{prepare:(input,id)=>scheduledRuntime.prepare(input,id),configure:task=>scheduledRuntime.configure(task),configurationIssue:task=>scheduledRuntime.configurationIssue(task),execute:(task,signal)=>scheduledRuntime.execute(task,signal),busy:()=>false,changed:()=>{}});
  await automation.load();

  const state = () => ({ ...owner.view(queue.snapshot()), capabilities: { ready: true, executionLimits: { exports: 1 } }, connection: { configured: false }, douyinUpload: { config: { enabled: true }, accounts: [{ product: "眼贴", ...plan, available: true }], tasks: [], legacyTasks: [], batches: [], historicalBatches: [], accountBatches: [], closedBatches: [], ready: true, configSelected: true } });
  let work;
  server = await createServer({ cacheDir: path.join(directory, "vite-cache"), server: { host: "127.0.0.1", port: 5197, strictPort: false, watch: null }, plugins: [{ name: "fission-fixture", configureServer(instance) {
    instance.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/__api/")) {
        try {
          let body = ""; for await (const part of request) body += part;
          const data = body ? JSON.parse(body) : {};
          let result;
          switch (url.pathname) {
            case "/__api/input": {
              const paths = await videoPathsInDirectory(input); await owner.addMedia(paths);
              result = { directory: input, mediaIds: owner.currentProject.mediaItems.map(m => m.id), state: state() }; break;
            }
            case "/__api/automatic": result = await createAutomaticOutputDirectory(data.ids.map(id => owner.getMedia(id).sourcePath), new Date(), undefined, data.purpose); break;
            case "/__api/output": result = path.join(directory, "手动输出"); break;
            case "/__api/start": {
              const batches = await prepareFissionProduction(queue, data, owner.currentProject.mediaItems, {
                preflight: async (selection, total) => { uploadEvents.push({ event: "preflight", selection, total }); return selection ? { pageBatchId: "isolated-fixture" } : undefined; },
                remember: batches => owner.rememberExportProduction(batches),
                registerBatches: async (batches, selection) => { assert.ok(batches.flatMap(batch => batch.tasks).every(task => task.status === "queued")); uploadEvents.push({ event: "register", selection, total: batches.flatMap(batch => batch.tasks).length }); },
              });
              work = Promise.all(batches.map(b => queue.start(b.id)));
              result = state(); break;
            }
            case "/__api/wait": await work; result = { ...state(), uploadEvents }; break;
            case "/__api/automation": result={...automation.snapshot(),scheduledRequests};break;
            case "/__api/schedule": scheduledRequests.push(data);result=await automation.create(data);break;

            default: result = state();
          }
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(result));
        } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })); }
        return;
      }
      if (url.pathname !== "/__fission") return next();
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(await server.transformIndexHtml(request.url, `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
        import React from 'react'; import {createRoot} from 'react-dom/client'; import App from '/src/renderer/App.tsx'; import '/src/renderer/styles.css'; import '/src/renderer/workspace-redesign.css';
        const api=async(action,input={})=>{const r=await fetch('/__api/'+action,{method:'POST',body:JSON.stringify(input)});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;};
        window.jianji={getAutomation:()=>api('automation'),createAutomation:input=>api('schedule',input),configureAutomation:async()=>api('automation'),removeAutomation:async()=>api('automation'),onAutomation:()=>()=>{},listQianchuanPlans:async()=>({account:{advertiserId:'1876000000000001',name:'隔离测试账户'},plans:[${JSON.stringify(plan)}]}),getState:()=>api('state'),onExportSnapshot:listener=>{const timer=setInterval(()=>api("state").then(listener),200);return ()=>clearInterval(timer)},selectVideoInputDirectory:()=>api('input'),selectOutputDirectory:()=>api('output'),createAutomaticOutputDirectory:(ids,existing,purpose)=>api('automatic',{ids,purpose}),startVideoFission:input=>api('start',input)};
        createRoot(document.getElementById('root')).render(React.createElement(App));</script></body></html>`));
    });
  } }] });
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/__fission`;
  if (process.argv.includes("--serve")) {
    console.log(`MCP_URL=${url}`);
    await new Promise(resolve => process.once("SIGTERM", resolve));
  } else {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await page.getByRole("button", { name: "视频裂变", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "开始裂变 100 条", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "请选择视频输入目录", exact: true }).click();
    await page.getByText("34 条", { exact: true }).waitFor();
    assert.equal(await page.getByText("33 条", { exact: true }).count(), 2);
    const inputBox = await page.locator("#video-fission-total").boundingBox();
    const outputBox = await page.locator(".video-fission-output .directory-picker").boundingBox();
    assert.ok(Math.abs(inputBox.y - outputBox.y) <= 1 && Math.abs(inputBox.height - outputBox.height) <= 1, "input/output controls align");
    await page.locator(".video-fission-output .directory-picker").click();
    await page.getByRole("button", { name: "使用自动目录", exact: true }).click();
    await page.locator("#video-fission-total").fill("251");
    assert.equal(await page.getByRole("button", { name: "开始裂变", exact: true }).isDisabled(), true);
    await page.locator("#video-fission-total").fill("5");
    await page.getByRole("checkbox", { name: "本次成片导出完成后自动上传并确认", exact: true }).check();
    await page.getByRole("button", { name: "开始裂变 5 条", exact: true }).click();
    await page.getByText("请选择上传计划后再开始裂变。", { exact: true }).waitFor();
    assert.deepEqual(uploadEvents, []);
    await page.getByRole("combobox", { name: "本次产品账号", exact: true }).selectOption("眼贴");
    await page.getByRole("combobox", { name: "上传计划", exact: true }).selectOption({ label: "隔离测试计划 · ID 1876000000000002" });
    await page.getByRole("button", { name: "开始裂变 5 条", exact: true }).click();
    await page.getByRole("heading", { name: "作品与导出", exact: true }).waitFor();
    const done = await (await page.request.post(url.replace("/__fission", "/__api/wait"))).json();
    const tasks = done.queue.batches.flatMap(b => b.batch.tasks);
    await page.getByRole("button", { name: "播放", exact: true }).first().waitFor();
    assert.deepEqual(uploadEvents.map(event => event.event), ["preflight", "register"]);
    for (const event of uploadEvents) { assert.equal(event.total, 5); assert.equal(event.selection.accountProduct, "眼贴"); assert.deepEqual(event.selection.plan, plan); }
    assert.equal(tasks.length, 5); assert.equal(tasks.every(t => t.status === "completed"), true);
    assert.equal(tasks.every(t => t.outputPath.includes(`${path.sep}裂变${path.sep}`)), true);
    for (const [source, bytes] of originals) assert.deepEqual(await readFile(source), bytes);
    await page.getByRole("button", { name: "视频裂变", exact: true }).click();
    await page.getByRole("button", { name: "使用自动目录", exact: true }).click();
    await page.getByRole("checkbox", { name: "本次成片导出完成后自动上传并确认", exact: true }).check();
    await page.getByRole("combobox", { name: "本次产品账号", exact: true }).selectOption("眼贴");
    await page.getByRole("combobox", { name: "上传计划", exact: true }).selectOption({ label: "隔离测试计划 · ID 1876000000000002" });
    await page.getByRole("button", { name: "保存为定时任务", exact: true }).click();
    await page.getByRole("heading", { name: "保存每日自动化", exact: true }).waitFor();
    await page.getByLabel("任务名称", { exact: true }).fill("隔离测试每日裂变");
    await page.getByLabel("每天执行时间", { exact: true }).fill("03:20");
    await page.getByRole("checkbox", { name: "裂变完成后自动上传并确认所选批次", exact: true }).check();
    await page.getByRole("checkbox", { name: /我授权简辑/ }).check();
    await page.getByRole("button", { name: "保存定时任务", exact: true }).click();
    await page.getByRole("article", { name: "隔离测试每日裂变", exact: true }).waitFor();
    const saved = await (await page.request.post(url.replace("/__fission", "/__api/automation"))).json();
    assert.equal(saved.tasks.length, 1); assert.equal(saved.tasks[0].request.enabled, false);
    assert.equal(saved.tasks[0].request.upload, true); assert.equal(saved.tasks[0].request.fission.total, 5);
    assert.equal(saved.tasks[0].request.fission.outputDirectory, undefined);
    assert.equal(saved.tasks[0].request.fission.mediaIds.length, 3);
    assert.deepEqual(saved.tasks[0].request.fission.douyinUpload.plan, plan);
    assert.equal(saved.tasks[0].lastRun, undefined); assert.equal(queue.snapshot().batches.flatMap(b=>b.batch.tasks).length,5);
    await page.setViewportSize({ width: 820, height: 800 });
    await page.getByRole("button", { name: "视频裂变", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "PASS", inputDirectory: true, alignedControls: true, uploadSelectionAndAdmission: true, scheduledFissionSavedWithoutExecution: true, missingPlanBlocked: true, automaticFissionDirectory: true, exactTotal: 5, fullDecode: true, originalFilesUnchanged: true, narrowViewport: true, modelRequests: 0, platformWrites: 0 }));
  }
} finally { await automation?.stop(); await queue?.shutdown(); await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
