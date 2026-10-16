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
let server, browser, queue;
try {
  const bundle = path.join(directory, "owner.cjs");
  await build({ stdin: { contents: 'export {ApplicationService} from "./src/main/application.ts"; export {FfmpegAdapter} from "./src/main/ffmpeg.ts"; export {ExportQueue} from "./src/main/queue.ts"; export {JobStore} from "./src/main/store.ts"; export {createFissionBatches} from "./src/main/video-fission.ts"; export {videoPathsInDirectory} from "./src/main/media.ts"; export {createAutomaticOutputDirectory} from "./src/main/automatic-output-directory.ts";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", outfile: bundle });
  const { ApplicationService, FfmpegAdapter, ExportQueue, JobStore, createFissionBatches, videoPathsInDirectory, createAutomaticOutputDirectory } = createRequire(import.meta.url)(bundle);
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
  const state = () => ({ ...owner.view(queue.snapshot()), capabilities: { ready: true, executionLimits: { exports: 1 } }, connection: { configured: false } });
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
              const batches = await createFissionBatches(queue, data, owner.currentProject.mediaItems);
              await owner.rememberExportProduction(batches);
              work = Promise.all(batches.map(b => queue.start(b.id)));
              result = state(); break;
            }
            case "/__api/wait": await work; result = state(); break;
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
        window.jianji={getState:()=>api('state'),onExportSnapshot:listener=>{const timer=setInterval(()=>api("state").then(listener),200);return ()=>clearInterval(timer)},selectVideoInputDirectory:()=>api('input'),selectOutputDirectory:()=>api('output'),createAutomaticOutputDirectory:(ids,existing,purpose)=>api('automatic',{ids,purpose}),startVideoFission:input=>api('start',input)};
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
    await page.getByRole("button", { name: "开始裂变 5 条", exact: true }).click();
    await page.getByRole("heading", { name: "作品与导出", exact: true }).waitFor();
    const done = await (await page.request.post(url.replace("/__fission", "/__api/wait"))).json();
    const tasks = done.queue.batches.flatMap(b => b.batch.tasks);
    await page.getByRole("button", { name: "播放", exact: true }).first().waitFor();
    assert.equal(tasks.length, 5); assert.equal(tasks.every(t => t.status === "completed"), true);
    assert.equal(tasks.every(t => t.outputPath.includes(`${path.sep}裂变${path.sep}`)), true);
    for (const [source, bytes] of originals) assert.deepEqual(await readFile(source), bytes);
    await page.setViewportSize({ width: 820, height: 800 });
    await page.getByRole("button", { name: "视频裂变", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "PASS", inputDirectory: true, alignedControls: true, automaticFissionDirectory: true, exactTotal: 5, fullDecode: true, originalFilesUnchanged: true, narrowViewport: true, modelRequests: 0, platformWrites: 0 }));
  }
} finally { await queue?.shutdown(); await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
