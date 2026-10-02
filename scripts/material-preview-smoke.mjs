// Real App, local playback and ProjectStore persistence; isolated synthetic media, no models.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const directory = await mkdtemp(path.join(tmpdir(), "jianji-material-preview-"));
let server, browser;
try {
  const ownerBundle = path.join(directory, "owner.mjs");
  await build({ stdin: { contents: 'export {ApplicationService} from "./src/main/application.ts"; export {FfmpegAdapter} from "./src/main/ffmpeg.ts";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", outfile: ownerBundle });
  const { ApplicationService, FfmpegAdapter } = await import(pathToFileURL(ownerBundle));
  const adapter = new FfmpegAdapter(process.env.JIANJI_FFMPEG_PATH || "ffmpeg", process.env.JIANJI_FFPROBE_PATH || "ffprobe");
  const createOwner = () => new ApplicationService(adapter, { resolve: async () => null });
  let owner = createOwner();
  const sources = [];
  for (let index = 1; index <= 3; index++) {
    const source = path.join(directory, `素材-${index}.mp4`);
    execFileSync(adapter.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${["red", "green", "blue"][index - 1]}:s=320x180:r=12`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
    sources.push(source);
  }
  const originalBytes = await Promise.all(sources.map(source => readFile(source)));
  await owner.addMedia([...sources, path.join(directory, "无法读取.mp4")]);
  owner.renameProject("预览筛选测试");
  const savedFile = path.join(directory, "filtered.jianji-project.json");
  let rejectRemove = false;
  const state = () => {
    const next = owner.view({ revision: 0, batches: [] });
    next.project.mediaItems = next.project.mediaItems.map(item => ({ ...item, previewUrl: `/__video?id=${item.id}` }));
    return { ...next, capabilities: { ready: true, executionLimits: { exports: 1 } }, connection: { configured: false } };
  };
  server = await createServer({ cacheDir: path.join(directory, "vite-cache"), server: { host: "127.0.0.1", port: 5199, strictPort: false }, plugins: [{ name: "material-preview-fixture", configureServer(instance) {
    instance.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/__video") {
        const media = owner.getMedia(url.searchParams.get("id"));
        if (!media) { response.statusCode = 404; response.end(); return; }
        response.setHeader("Content-Type", "video/mp4"); response.end(await readFile(media.sourcePath)); return;
      }
      if (url.pathname.startsWith("/__api/")) {
        try {
          let body = ""; for await (const chunk of request) body += chunk;
          const input = body ? JSON.parse(body) : {};
          if (url.pathname === "/__api/remove") { if (rejectRemove) throw new Error("模拟移除失败"); owner.removeMedia(input.id); }
          if (url.pathname === "/__api/save") await owner.saveProject(savedFile, input.name, input.workspace);
          if (url.pathname === "/__api/reopen") { owner = createOwner(); await owner.loadProject(savedFile); }
          if (url.pathname === "/__api/reject") rejectRemove = input.value;
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(state()));
        } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })); }
        return;
      }
      if (url.pathname !== "/__material-preview") return next();
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(await server.transformIndexHtml(request.url, `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
        import React from 'react'; import {createRoot} from 'react-dom/client'; import App from '/src/renderer/App.tsx'; import '/src/renderer/styles.css'; import '/src/renderer/workspace-redesign.css';
        const api=async(action,input={})=>{const r=await fetch('/__api/'+action,{method:'POST',body:JSON.stringify(input)});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;};
        window.jianji={getState:()=>api('state'),onExportSnapshot:()=>()=>{},removeMedia:id=>api('remove',{id}),saveProject:(name,workspace)=>api('save',{name,workspace})};
        createRoot(document.getElementById('root')).render(React.createElement(App));
      </script></body></html>`));
    });
  } }] });
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__material-preview`;
  browser = await chromium.launch({ executablePath: process.env.JIANJI_SMOKE_CHROME || "/usr/bin/google-chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 850 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole("button", { name: "预览 素材-2.mp4", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "素材预览", exact: true });
  await dialog.waitFor();
  await page.waitForFunction(() => document.querySelector('dialog video')?.currentTime > .1);
  await dialog.getByRole("button", { name: "下一条", exact: true }).click();
  await page.getByLabel("播放 素材-3.mp4", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "下一条", exact: true }).isDisabled(), true);
  await dialog.getByRole("button", { name: "上一条", exact: true }).click();
  await dialog.getByRole("button", { name: "移出清单", exact: true }).click();
  await page.getByLabel("播放 素材-3.mp4", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "预览 素材-2.mp4", exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "保存素材清单", exact: true }).click();
  await page.getByText("项目已保存，下次可从已保存项目列表继续。", { exact: true }).waitFor();
  await page.request.post(url.replace("/__material-preview", "/__api/reopen"), { data: {} });
  await page.reload();
  await page.getByRole("button", { name: "预览 素材-1.mp4", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "预览 素材-2.mp4", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("选择 素材-3.mp4", { exact: true }).isChecked(), true);
  assert.equal(await page.getByRole("button", { name: "预览 无法读取.mp4", exact: true }).isDisabled(), true);
  await page.request.post(url.replace("/__material-preview", "/__api/reject"), { data: { value: true } });
  await page.getByRole("button", { name: "预览 素材-1.mp4", exact: true }).click();
  await dialog.getByRole("button", { name: "移出清单", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "模拟移除失败" }).waitFor();
  assert.equal(await page.getByLabel("播放 素材-1.mp4", { exact: true }).count(), 1, "failure retains current preview");
  await page.request.post(url.replace("/__material-preview", "/__api/reject"), { data: { value: false } });
  await dialog.getByRole("button", { name: "移出清单", exact: true }).click();
  await page.getByLabel("播放 素材-3.mp4", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "移出清单", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "移除 无法读取.mp4", exact: true }).click();
  await page.getByText("你的素材即将在这里就位", { exact: true }).waitFor();
  await page.getByRole("button", { name: "保存素材清单", exact: true }).click();
  await page.getByText("项目已保存，下次可从已保存项目列表继续。", { exact: true }).waitFor();
  const saved = JSON.parse(await readFile(savedFile, "utf8"));
  assert.deepEqual(saved.mediaItems, []);
  assert.deepEqual(saved.workspaceDraft.selectedMediaIds, []);
  for (const [index, source] of sources.entries()) assert.deepEqual(await readFile(source), originalBytes[index]);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "PASS", playback: true, narrowViewport: true, failedRemovalRetained: true, savedReopened: true, emptyListSaved: true, originalFilesUnchanged: true }));
  if (process.argv.includes("--serve")) {
    owner = createOwner(); await owner.addMedia(sources); owner.renameProject("MCP预览筛选测试");
    console.log(`MCP_URL=${url}`);
    await new Promise(resolve => process.once("SIGTERM", resolve));
  }
} finally {
  await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true });
}
