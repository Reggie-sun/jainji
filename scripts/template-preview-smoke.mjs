// Real browser rendering of the production panel; local assets, no provider calls.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createServer } from "vite";

const directory = await mkdtemp(path.join(tmpdir(), "jianji-template-preview-"));
const bundle = path.join(directory, "stickers.mjs");
await build({ entryPoints: ["src/main/builtin-stickers.ts"], bundle: true, platform: "node", format: "esm", outfile: bundle });
const { ensureBuiltinStickerAssets } = await import(pathToFileURL(bundle).href);
const assets = await ensureBuiltinStickerAssets(path.join(directory, "stickers"));
const stickers = await Promise.all(Object.entries(assets).map(async ([id, asset]) => ({ id, label: id, animated: false, source: "builtin", url: `data:image/png;base64,${(await readFile(asset.assetPath)).toString("base64")}` })));
let server;
server = await createServer({ cacheDir: path.join(directory, "vite-cache"), plugins: [{ name: "template-preview-smoke", configureServer(instance) {
  instance.middlewares.use(async (request, response, next) => {
    if (request.url !== "/__template-preview") return next();
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(await server.transformIndexHtml(request.url, `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" style="max-width:1050px;margin:auto;padding:24px"></main><script type="module">
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {TemplatePanel} from '/src/renderer/TemplatePanel.tsx';
      import {CornerDecorationPicker} from '/src/renderer/CornerDecorationPicker.tsx';
      import '/src/renderer/styles.css';
      window.failCatalog=false;
      window.jianji={decorationCatalog:async()=>{if(window.failCatalog)throw Error('fixture failure');return {fonts:['Noto Sans CJK SC','serif'],stickers:${JSON.stringify(stickers)}};},libraryAsset:async()=>{throw Error('offline fixture');}};
      function Fixture(){const [selected,onSelect]=React.useState('black-gold');const [options,setOptions]=React.useState({sticker:'template',fontFamily:'Noto Sans CJK SC'});window.fixtureOptions=options;const [selectedCorner,onCornerSelect]=React.useState();const [exportFormat,onExportFormat]=React.useState('mp4');const [requestedCount,onRequestedCount]=React.useState();const [disabled,setDisabled]=React.useState(false);window.setFixtureDisabled=setDisabled;return React.createElement(TemplatePanel,{requestedCount,onRequestedCount,onProductPrice:(productPrice)=>setOptions(current=>({...current,productPrice})),selected,onSelect,selectedCorner,onCornerSelect,exportFormat,onExportFormat,decorationOptions:options,decorations:React.createElement(CornerDecorationPicker,{selected:selectedCorner,onSelect:onCornerSelect,value:options,onChange:setOptions,disabled}),onGenerateBrief:()=>{window.generatedBrief=true;},brief:'',onBrief:()=>{},outputDirectory:'/tmp/example',onOutput:()=>{},onStart:()=>{throw Error('must not start');},count:3,disabled});}
      createRoot(document.getElementById('root')).render(React.createElement(Fixture));
    </script></body></html>`));
  });
} }], server: { host: "127.0.0.1", port: 5197, strictPort: false } });
await server.listen();
const port = server.httpServer.address().port;
const profile = path.join(directory, "chrome");
const chrome = spawn("google-chrome", ["--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let debugPort;
  for (let i = 0; i < 100; i++) { try { debugPort = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { await pause(100); } }
  assert.ok(debugPort, "Chrome debugging port");
  const target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((entry) => entry.type === "page");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0; const pending = new Map();
  socket.onmessage = (event) => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 10000);
    pending.set(id, (message) => { clearTimeout(timer); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const waitFor = async (expression) => { for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); } throw Error(`Timeout: ${expression}`); };
  const click = async (selector) => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(100); };
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/__template-preview` });
  await waitFor("document.querySelector('.template-preview canvas') && !document.querySelector('.template-preview [role=status]')");
  assert.equal(await evaluate("Boolean(document.querySelector('.template-preview [role=alert]'))"), false);
  assert.equal(await evaluate("document.querySelector('#export-format').value"), "mp4", "default remains MP4");
  for (const format of ["mov", "mkv", "mp4"]) {
    await evaluate(`{const select=document.querySelector('#export-format');select.value=${JSON.stringify(format)};select.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await waitFor(`document.querySelector('.export-card p').textContent.includes(${JSON.stringify(format.toUpperCase())})`);
    assert.equal(await evaluate("document.querySelector('#export-format').value"), format);
  }
  await evaluate("window.setFixtureDisabled(true)");
  await waitFor("document.querySelector('#export-format').disabled");
  await evaluate("window.setFixtureDisabled(false)");
  await waitFor("!document.querySelector('#export-format').disabled");
  const picture = () => evaluate("document.querySelector('.template-preview canvas').toDataURL()");
  await click('[aria-label="快捷制作条数"] button:nth-child(2)');
  assert.equal(await evaluate("document.querySelector('#production-count').value"), '10');
  assert.equal(await evaluate("document.querySelector('.step-footer').textContent.includes('制作 12 条成片')"), true);
  for (const value of ['0', '1.5', '100', '']) {
    await evaluate(`{const el=document.querySelector('#production-count');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await pause(100);
    assert.equal(await evaluate("document.querySelector('.step-footer button').disabled"), true, 'invalid or rounded-over-limit quantity blocks export');
  }
  await click('[aria-label="快捷制作条数"] button:nth-child(2)');
  const emptyPricePicture = await picture();
  const fillPrice = async (value) => {
    await evaluate(`{const input=document.querySelector('#product-price');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await waitFor(`window.fixtureOptions.productPrice===${JSON.stringify(value)}`);
  };
  await fillPrice('19.90');
  assert.notEqual(await picture(), emptyPricePicture, 'manual price appears in preview');
  await fillPrice('产品名');
  assert.equal(await evaluate("document.querySelector('.step-footer button').disabled"), true, 'invalid price blocks export');
  assert.equal(await picture(), emptyPricePicture, 'invalid price is not drawn');
  await fillPrice('');
  assert.equal(await picture(), emptyPricePicture, 'cleared price disappears');
  await fillPrice('19.9元30贴');
  assert.equal(await evaluate("document.querySelector('#product-price').getAttribute('aria-invalid')"), 'false');
  assert.equal(await evaluate("document.querySelector('.generate-brief').disabled"), false);
  await click('.generate-brief');
  assert.equal(await evaluate('window.generatedBrief'), true, 'valid quantity price enables prompt generation');
  assert.notEqual(await picture(), emptyPricePicture, 'quantity price appears in preview');
  await fillPrice('19.90');
  const initial = await picture();
  await click(".template-card.clean");
  await waitFor("!document.querySelector('.template-preview [role=status]')");
  assert.notEqual(await picture(), initial, "switching template updates picture");
  const clean = await picture();
  await evaluate("[...document.querySelectorAll('.sticker-choices button')].find(b=>b.textContent==='不加贴纸').click()");
  await pause(100); assert.notEqual(await picture(), clean, "no sticker removes image");
  const noSticker = await picture();
  await evaluate("const select=document.querySelector('#caption-font');select.value='serif';select.dispatchEvent(new Event('change',{bubbles:true}))");
  await pause(100); assert.notEqual(await picture(), noSticker, "font changes actual pixels");
  await evaluate("window.failCatalog=true;[...document.querySelectorAll('.sticker-choices button')].find(b=>b.textContent==='heart').click()");
  await waitFor("document.querySelector('.template-preview [role=alert]')");
  const failedPicture = await picture();
  await pause(250);
  assert.equal(await picture(), failedPicture, "preview remains a static canvas");
  await evaluate("window.failCatalog=false;[...document.querySelectorAll('.sticker-choices button')].find(b=>b.textContent==='跟随模板').click()");
  await waitFor("!document.querySelector('.template-preview [role=status]') && !document.querySelector('.template-preview [role=alert]')");
  for (const name of ["mono", "coral-pop", "mint-fresh", "sunset", "electric", "cream-studio"]) {
    await click(`.template-card.${name}`);
    await waitFor("!document.querySelector('.template-preview [role=status]') && !document.querySelector('.template-preview [role=alert]')");
  }
  await click('.corner-slot.bottom-right');
  await evaluate("{const el=document.querySelector('[aria-label=角落内容类型]');el.value='sticker';el.dispatchEvent(new Event('change',{bubbles:true}));}");
  await waitFor("window.fixtureOptions.corners?.['bottom-right']?.type==='sticker'");
  await evaluate("[...document.querySelectorAll('.sticker-choices button')].find(b=>b.textContent==='heart').click()");
  await click('.corner-slot.bottom-left');
  await evaluate("{const el=document.querySelector('[aria-label=角落内容类型]');el.value='text';el.dispatchEvent(new Event('change',{bubbles:true}));}");
  await waitFor("window.fixtureOptions.corners?.['bottom-left']?.type==='text'");
  await evaluate("{const el=document.querySelector('[aria-label=角落文字]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'限时好物');el.dispatchEvent(new Event('input',{bubbles:true}));}");
  await waitFor("window.fixtureOptions.corners['bottom-left'].text==='限时好物'");
  await evaluate("{const el=document.querySelector('#caption-font');el.value='Noto Sans CJK SC';el.dispatchEvent(new Event('change',{bubbles:true}));}");
  await waitFor("window.fixtureOptions.corners['bottom-left'].fontFamily==='Noto Sans CJK SC'");
  await evaluate(`{
    const NativeFontFace=window.FontFace;window.restoreFontFace=()=>{window.FontFace=NativeFontFace};
    window.FontFace=function(family){return new NativeFontFace(family,'local("Noto Sans CJK SC")')};
    window.jianji.libraryAsset=()=>new Promise(resolve=>{window.releaseFont=()=>resolve({url:'fixture-font'})});
    const select=document.querySelector('#caption-font');
    select.value=[...select.options].find(option=>option.textContent.includes('在线字体')).value;
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }`);
  await waitFor("window.releaseFont");
  await evaluate("{const el=document.querySelector('[aria-label=角落文字]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'下载时改字');el.dispatchEvent(new Event('input',{bubbles:true}));}");
  await waitFor("window.fixtureOptions.corners['bottom-left'].text==='下载时改字'");
  await evaluate('window.releaseFont()');
  await waitFor("!document.querySelector('#caption-font').disabled");
  assert.notEqual(await evaluate("window.fixtureOptions.corners['bottom-left'].fontFamily"), "Noto Sans CJK SC", "online font committed");
  assert.equal(await evaluate("window.fixtureOptions.corners['bottom-left'].text"), '下载时改字', 'font download completion preserves latest text');
  await evaluate("window.restoreFontFace();window.jianji.libraryAsset=async()=>{throw Error('offline fixture')};");
  await evaluate("{const el=document.querySelector('#caption-font');el.value='Noto Sans CJK SC';el.dispatchEvent(new Event('change',{bubbles:true}));}");
  await evaluate("{const el=document.querySelector('[aria-label=角落文字]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'限时好物');el.dispatchEvent(new Event('input',{bubbles:true}));}");
  await click('.corner-slot.bottom-right');
  assert.equal(await evaluate("window.fixtureOptions.corners['bottom-right'].sticker"), 'heart', 'independent right sticker retained');
  assert.equal(await evaluate("window.fixtureOptions.corners['bottom-left'].text"), '限时好物', 'independent left text retained');
  assert.equal(await evaluate("window.fixtureOptions.corners['bottom-left'].fontFamily"), 'Noto Sans CJK SC', 'corner font independent from global serif');
  for (const corner of ['top-left','top-right']) {
    await click(`.corner-slot.${corner}`);
    await evaluate("{const el=document.querySelector('[aria-label=角落内容类型]');el.value='none';el.dispatchEvent(new Event('change',{bubbles:true}));}");
    await waitFor(`window.fixtureOptions.corners['${corner}'].type==='none'`);
  }
  await evaluate('window.setFixtureDisabled(true)');
  await waitFor("[...document.querySelectorAll('.corner-slot')].every(b=>b.disabled)");
  assert.equal(await evaluate("document.querySelector('[aria-label=角落内容类型]').disabled"), true);
  await evaluate('window.setFixtureDisabled(false)');
  await waitFor("!document.querySelector('.corner-slot').disabled");
  const manualSettings = await evaluate('JSON.stringify(window.fixtureOptions.corners)');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='全部交给 Agent').click()");
  await waitFor("window.fixtureOptions.mode==='agent'");
  assert.equal(await evaluate("document.querySelector('#product-price').value"), "19.90", "price survives mode switch");
  assert.equal(await evaluate("document.querySelectorAll('.corner-slot').length"), 0, 'auto mode hides manual selection slots');
  assert.equal(await evaluate("Boolean(document.querySelector('.decoration-picker'))"), false, 'auto mode requires no manual picker');
  assert.equal(await evaluate("document.querySelector('.template-preview').textContent.includes('全部留空')"), true, 'auto mode explicitly allows empty corners');
  await evaluate("document.querySelector('#corner-decoration-editor').scrollIntoView({block:'center'})");
  const autoScreenshot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(directory, "agent-mode.png"), Buffer.from(autoScreenshot.data, "base64"));
  await evaluate('window.setFixtureDisabled(true)');
  await waitFor("[...document.querySelectorAll('[aria-label=装饰选择方式] button')].every(b=>b.disabled)");
  await evaluate('window.setFixtureDisabled(false)');
  await waitFor("![...document.querySelectorAll('[aria-label=装饰选择方式] button')][0].disabled");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='自己设置').click()");
  await waitFor("document.querySelectorAll('.corner-slot').length===4");
  assert.equal(await evaluate('JSON.stringify(window.fixtureOptions.corners)'), manualSettings, 'returning to manual preserves selections');
  await evaluate("document.querySelector('.template-preview').scrollIntoView({block:'center'})");
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(directory, "preview.png"), Buffer.from(screenshot.data, "base64"));
  await evaluate("document.querySelector('.export-card').scrollIntoView({block:'center'})");
  const exportScreenshot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(directory, "export-format.png"), Buffer.from(exportScreenshot.data, "base64"));
  await send("Emulation.setDeviceMetricsOverride", { width: 760, height: 1000, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "no horizontal overflow at minimum width");
  console.log(`PASS: agent/manual modes and restoration, four independent corners, mixed text/sticker, retained choices, disabled controls, export formats/default/disabled, eight templates, sticker removal, font pixels, asset error/recovery, narrow layout. Screenshots: ${directory}`);
} finally {
  socket?.close(); chrome.kill(); await server.close();
}
