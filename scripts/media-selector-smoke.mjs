// Real React panels and Chrome interaction; synthetic videos, isolated state, no model calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const directory = await mkdtemp(path.join(tmpdir(), "jianji-media-selector-"));
let server, browser;
try {
  const video = path.join(directory, "preview.mp4");
  execFileSync(process.env.JIANJI_FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=12", "-t", "8", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  const bytes = await readFile(video);
  server = await createServer({ cacheDir: path.join(directory, "vite-cache"), plugins: [{ name: "media-selector-smoke", configureServer(instance) {
    instance.middlewares.use(async (request, response, next) => {
      if (request.url?.startsWith("/__video")) {
        response.setHeader("Content-Type", "video/mp4"); response.setHeader("Accept-Ranges", "bytes");
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
        const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        if (range) { response.statusCode = 206; response.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`); }
        response.setHeader("Content-Length", end - start + 1); response.end(bytes.subarray(start, end + 1)); return;
      }
      if (request.url !== "/__media-selector") return next();
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(await server.transformIndexHtml(request.url, `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" style="max-width:1050px;margin:auto;padding:24px"></main><script type="module">
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {CoverStickerPanel} from '/src/renderer/CoverStickerPanel.tsx';
        import {TemplatePanel} from '/src/renderer/TemplatePanel.tsx';
        import {DecorationSchema} from '/src/shared/decorations.ts';
        import {DEFAULT_EXPORT_SETTINGS} from '/src/shared/export-settings.ts';
        import '/src/renderer/styles.css';
        window.jianji={decorationCatalog:async()=>({fonts:[],stickers:[]})};
        const initialMedia=Array.from({length:30},(_,i)=>({id:crypto.randomUUID(),displayName:'逐个审查视频-'+(i+1)+'.mp4',width:320,height:180,durationMs:8000,previewUrl:'/__video?id='+i}));
        function Fixture(){const [media,setMedia]=React.useState(initialMedia);const [busy,setBusy]=React.useState(false);const [tick,setTick]=React.useState(0);
          const [cover,setCover]=React.useState({enabled:true,trackingMode:'manual',stickerIds:[],rectangle:{x:.35,y:.4,width:.3,height:.2},regions:[{id:crypto.randomUUID(),rectangle:{x:.35,y:.4,width:.3,height:.2}}]});
          const [options,setOptions]=React.useState(DecorationSchema.parse({mode:'manual',sticker:'none',productPrice:'手动共用文字'}));
          React.useEffect(()=>{const timer=setInterval(()=>setTick(v=>v+1),50);return()=>clearInterval(timer)},[]);
          window.fixture={media,options,cover,tick};window.setFixtureMedia=setMedia;window.setFixtureBusy=setBusy;
          return React.createElement(React.Fragment,null,
            React.createElement('section',{id:'text-panel'},React.createElement(TemplatePanel,{selected:'clean',onSelect:()=>{},brief:'',onBrief:()=>{},outputDirectory:'',automaticOutput:true,onOutput:()=>{},onStart:()=>{},count:media.length,disabled:busy,decorationOptions:options,selectedMedia:media.map(m=>({...m})),exportSettings:DEFAULT_EXPORT_SETTINGS,exportFormat:'mp4',onExportFormat:()=>{},usesModel:false,onDisplayText:(settings,id)=>setOptions(o=>id?({...o,displayTextByMedia:{...o.displayTextByMedia,[id]:settings}}):({...o,displayText:settings})),onSaveDisplayText:()=>{window.savedText=structuredClone(options)},onProductPrice:productPrice=>setOptions(o=>({...o,productPrice})),onDisplayMode:displayMode=>setOptions(o=>({...o,displayMode})),onRequestedCount:()=>{}})),
            React.createElement(CoverStickerPanel,{projectId:'fixture',value:structuredClone(cover),selectedMedia:media.map(m=>({...m})),revision:0,disabled:busy,onSave:async v=>{setCover(v);window.savedCover=structuredClone(v)}}));
        }createRoot(document.getElementById('root')).render(React.createElement(Fixture));
      </script></body></html>`));
    });
  } }], server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.JIANJI_SMOKE_CHROME || "/usr/bin/google-chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__media-selector`);
  const text = page.getByRole("combobox", { name: "选择展示文字素材" });
  const cover = page.getByRole("combobox", { name: "选择覆盖素材" });
  await text.waitFor(); await cover.waitFor();
  const background = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(await background(text), await background(cover), "both selectors share cover styling");

  assert.equal(await page.locator('.display-text-settings input[type="number"]').count(), 0, "positions use the preview instead of coordinate inputs");
  assert.equal(await text.evaluate(el => {
    const card = el.closest('.card');
    return card === document.getElementById('product-price').closest('.card') && card === document.getElementById('decoration-display-mode').closest('.card');
  }), true, "shared text, timing and per-media controls belong to one card");
  const textVideo = page.locator('.template-preview video');
  assert.equal(await textVideo.evaluate(v => v.controls), true, "each selected text material offers video playback controls");
  assert.equal(await textVideo.evaluate(v => v.closest('.display-text-settings') !== null), true, "selected video preview belongs beside its per-media settings");
  await textVideo.evaluate(async v => { await v.play(); });
  await page.waitForFunction(() => document.querySelector('.template-preview video').currentTime > .1);
  await textVideo.evaluate(v => v.pause());
  await page.locator('#decoration-display-mode').selectOption('first-5s');
  assert.equal(await page.evaluate(() => window.fixture.options.displayMode), 'first-5s');
  const drag = page.getByRole("button", { name: "拖动展示文字位置" });
  await textVideo.evaluate(v => { v.currentTime = 5.2; });
  await drag.waitFor({ state: "detached" });
  await page.locator('#decoration-display-mode').selectOption('full');
  await drag.waitFor();
  await textVideo.evaluate(v => { v.currentTime = 0; });
  await page.locator('#decoration-display-mode').selectOption('first-5s');
  await drag.scrollIntoViewIfNeeded();
  const box = await drag.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 5 }); await page.mouse.up();
  const moved = await page.evaluate(() => window.fixture.options.displayTextByMedia[window.fixture.media[0].id]);
  assert.ok(moved.y > .13, "drag updates the selected material position");
  await drag.focus(); await page.keyboard.press("ArrowDown");
  const positioned = await page.evaluate(() => window.fixture.options.displayTextByMedia[window.fixture.media[0].id]);
  assert.ok(positioned.y > moved.y, "keyboard fine adjustment remains available");
  await page.getByRole("button", { name: "保存到当前项目" }).click();
  assert.deepEqual(await page.evaluate(() => window.savedText.displayTextByMedia[window.fixture.media[0].id]), positioned);
  await text.click();
  const textList = page.getByRole("listbox", { name: "展示文字素材列表" });
  await textList.getByRole("option", { name: "2. 逐个审查视频-2.mp4", exact: true }).hover();
  const tick = await page.evaluate(() => window.fixture.tick);
  await page.waitForFunction(t => window.fixture.tick >= t + 30, tick);
  assert.equal(await textList.isVisible(), true, "snapshot updates cannot collapse the open list");
  assert.ok((await text.textContent()).includes("视频-1.mp4"), "highlight does not commit selection");
  await textList.getByRole("option", { name: "2. 逐个审查视频-2.mp4", exact: true }).click();
  assert.equal(await textList.count(), 0);
  assert.equal(await textVideo.getAttribute("src"), "/__video?id=1");
  assert.equal(await textVideo.evaluate(v => v.paused && v.currentTime === 0), true, "switching text materials resets playback");
  assert.ok((await page.locator('.template-preview-info h2').textContent()).includes("视频-2.mp4"), "preview identifies the selected material");
  await page.getByLabel("此素材显示展示文字 / 价格").uncheck();
  await page.getByRole("button", { name: "上一个展示文字素材" }).click();
  assert.deepEqual(await page.evaluate(() => window.fixture.options.displayTextByMedia[window.fixture.media[0].id]), positioned);
  assert.equal(await page.getByLabel("此素材显示展示文字 / 价格").isChecked(), true);
  await text.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  assert.ok((await text.textContent()).includes("视频-1.mp4"));
  await page.keyboard.press("Enter");
  assert.ok((await text.textContent()).includes("视频-2.mp4"));
  assert.equal(await page.getByLabel("此素材显示展示文字 / 价格").isChecked(), false);
  assert.equal(await page.evaluate(() => window.fixture.options.productPrice), "手动共用文字");

  await page.getByRole("button", { name: "播放预览", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.cover-track-preview video').currentTime > .1);
  await cover.click();
  const coverList = page.getByRole("listbox", { name: "覆盖素材列表" });
  await coverList.getByRole("option", { name: "2. 逐个审查视频-2.mp4", exact: true }).hover();
  const playbackTick = await page.evaluate(() => window.fixture.tick);
  await page.waitForFunction(t => window.fixture.tick >= t + 30, playbackTick);
  assert.equal(await coverList.isVisible(), true, "playback and repeated parent renders preserve the popup");
  assert.ok((await cover.textContent()).includes("视频-1.mp4"));
  await coverList.getByRole("option", { name: "2. 逐个审查视频-2.mp4", exact: true }).click();
  await page.getByRole("button", { name: "此素材不覆盖", exact: true }).click();
  await page.getByRole("button", { name: "上一个覆盖素材" }).click();
  assert.equal(await page.locator(".cover-sticker-frame").count(), 1, "switching preserves independent cover drafts");
  await page.getByRole("button", { name: "下一个覆盖素材" }).click();
  assert.equal(await page.locator(".cover-sticker-frame").count(), 0);
  assert.equal(await page.locator(".cover-track-preview video").getAttribute("src"), "/__video?id=1");
  assert.equal(await page.locator(".cover-track-preview video").evaluate(v => v.paused && v.currentTime === 0), true);
  await page.getByRole("button", { name: "保存覆盖设置", exact: true }).click();
  assert.equal(await page.evaluate(() => window.savedCover.mediaRegions[window.fixture.media[1].id].length), 0);

  await cover.click(); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  assert.ok((await cover.textContent()).includes("视频-30.mp4"));
  assert.equal(await page.getByRole("button", { name: "下一个覆盖素材" }).isDisabled(), true);
  await cover.click(); await page.keyboard.press("Escape"); assert.equal(await coverList.count(), 0);
  await cover.click(); await page.getByRole("heading", { name: "覆盖原贴纸" }).click(); assert.equal(await coverList.count(), 0);
  await cover.click(); await page.evaluate(() => window.setFixtureBusy(true)); await coverList.waitFor({ state: "detached" });
  await page.evaluate(() => window.setFixtureBusy(false));
  await page.evaluate(() => window.setFixtureMedia(window.fixture.media.slice(0, 1)));
  await page.waitForFunction(() => document.querySelector('[aria-label="选择覆盖素材"]').textContent.includes('视频-1.mp4'));
  assert.ok((await cover.textContent()).includes("视频-1.mp4"));
  assert.equal(await page.getByRole("button", { name: "上一个覆盖素材" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "下一个覆盖素材" }).isDisabled(), true);
  await page.setViewportSize({ width: 800, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => window.setFixtureMedia([]));
  await page.waitForFunction(() => document.querySelector('[aria-label="选择覆盖素材"]').disabled);
  assert.equal(await cover.isDisabled(), true); assert.equal(await text.isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log("PASS: shared styling; delayed explicit selection under 30 snapshot updates and live playback; keyboard selection; sequential navigation; independent text/cover drafts; save; playback reset; bounds/removal/empty/busy; narrow layout; no renderer errors.");
} finally {
  await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true });
}
