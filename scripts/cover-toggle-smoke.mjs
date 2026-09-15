// Exercise the real React panels in isolated Chrome; no model calls or user state.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";

const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-toggle-"));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server, chrome, socket;
try {
  server = await createServer({ cacheDir: path.join(directory, "vite-cache"), plugins: [{ name: "cover-toggle-smoke", configureServer(instance) {
    instance.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__cover-toggle") return next();
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(await server.transformIndexHtml(request.url, `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" style="max-width:1050px;margin:auto;padding:24px"></main><script type="module">
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {CoverStickerPanel} from '/src/renderer/CoverStickerPanel.tsx';
        import {CornerDecorationPicker} from '/src/renderer/CornerDecorationPicker.tsx';
        import '/src/renderer/styles.css';
        const sticker={id:'uploaded-'+'a'.repeat(64),source:'uploaded',label:'测试覆盖贴纸',url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',animated:false};
        window.fixtureStickers=[];window.saves=[];
        window.jianji={decorationCatalog:async()=>({fonts:[],stickers:window.fixtureStickers}),libraryAsset:async()=>{throw Error('offline fixture');}};
        function Fixture(){const [value,setValue]=React.useState();const [options,setOptions]=React.useState({mode:'agent',sticker:'none',fontFamily:'serif',productPrice:'手动内容'});const [revision,setRevision]=React.useState(0);const [disabled,setDisabled]=React.useState(false);const [dirty,setDirty]=React.useState(false);const [projectId,setProjectId]=React.useState('fixture');
          window.fixture={value,mode:options.mode,dirty};window.setFixtureDisabled=setDisabled;
          window.addFixtureSticker=()=>{window.fixtureStickers=[sticker];setRevision(v=>v+1);};
          window.resetFixture=()=>{setValue(undefined);setProjectId('other');};
          return React.createElement(React.Fragment,null,
            React.createElement(CornerDecorationPicker,{value:options,onChange:setOptions,onSelect:()=>{},disabled}),
            React.createElement(CoverStickerPanel,{projectId,value,selectedMedia:[],revision,disabled,onSave:async v=>{window.saves.push(structuredClone(v));setValue(v);},onDirtyChange:setDirty}));}
        createRoot(document.getElementById('root')).render(React.createElement(Fixture));
      </script></body></html>`));
    });
  } }], server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const profile = path.join(directory, "chrome");
  chrome = spawn("google-chrome", ["--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
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
  const clickText = async (text) => { await evaluate(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(text)}).click()`); await pause(100); };
  const toggle = ".cover-sticker-toggle input";
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${server.httpServer.address().port}/__cover-toggle` });
  await waitFor("document.querySelector('.cover-sticker-toggle input') && window.fixture && !window.fixture.dirty");
  assert.equal(await evaluate(`document.querySelector('${toggle}').checked`), false, "full Agent starts with coverage off");
  assert.equal(await evaluate("Boolean(document.querySelector('.cover-tracking-tabs'))"), false, "off hides optional details");
  await clickText("保存覆盖设置");
  await waitFor("window.saves.length===1 && !window.fixture.dirty");
  assert.equal(await evaluate("window.saves[0].enabled"), false, "off can save without uploaded assets");
  await clickText("自己设置"); await clickText("全部交给 Agent");
  assert.equal(await evaluate(`document.querySelector('${toggle}').checked`), false, "mode switching cannot enable coverage");
  await click(toggle);
  await waitFor("window.fixture.dirty && document.querySelector('.cover-tracking-tabs')");
  await clickText("保存覆盖设置");
  assert.equal(await evaluate("window.saves.length"), 1, "enabled without a candidate cannot save");
  await evaluate("window.addFixtureSticker()");
  await waitFor("document.querySelector('.cover-sticker-choice input')");
  await click(".cover-sticker-choice input");
  await clickText("手动设置");
  await clickText("保存覆盖设置");
  await waitFor("window.saves.length===2 && !window.fixture.dirty");
  assert.equal(await evaluate("window.fixture.value.trackingMode"), "manual", "full Agent honors manual cover choice");
  await clickText("自己设置"); await clickText("全部交给 Agent");
  assert.equal(await evaluate("document.querySelector('.cover-tracking-tabs button:nth-child(2)').getAttribute('aria-pressed')"), "true");
  assert.equal(await evaluate("window.fixture.dirty"), false, "decoration modes do not rewrite cover draft");
  await clickText("Agent 自动识别全部原贴纸");
  await clickText("保存覆盖设置");
  await waitFor("window.saves.length===3 && !window.fixture.dirty");
  assert.equal(await evaluate("window.fixture.value.trackingMode"), "agent");
  await click(toggle);
  await waitFor("window.fixture.dirty");
  await clickText("保存覆盖设置");
  await waitFor("window.saves.length===4 && !window.fixture.dirty");
  assert.equal(await evaluate("window.fixture.value.enabled"), false);
  assert.equal(await evaluate("window.fixture.value.stickerIds.length"), 1, "disabling preserves candidate selection");
  await evaluate("window.setFixtureDisabled(true)");
  await waitFor(`document.querySelector('${toggle}').disabled`);
  await click(toggle);
  assert.equal(await evaluate(`document.querySelector('${toggle}').checked`), false, "busy state locks switch");
  await evaluate("window.setFixtureDisabled(false);window.resetFixture()");
  await waitFor("window.fixture.value===undefined && !window.fixture.dirty");
  assert.equal(await evaluate(`document.querySelector('${toggle}').checked`), false, "new project defaults off");
  await send("Emulation.setDeviceMetricsOverride", { width: 800, height: 1000, deviceScaleFactor: 1, mobile: false });
  await pause(100);
  assert.equal(await evaluate("document.documentElement.scrollWidth<=window.innerWidth"), true, "narrow layout fits");
  console.log("PASS: independent off/on, no-upload admission, save/dirty state, mode isolation, manual/automatic tracking, candidate retention, busy lock, new-project default, narrow layout.");
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    await new Promise((resolve) => { chrome.once("exit", resolve); chrome.kill("SIGTERM"); });
  }
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
