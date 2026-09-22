// Exercise the real React panels in isolated Chrome; no model calls or user state.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";

const directory = await mkdtemp(path.join(tmpdir(), "jianji-decoration-display-"));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server, chrome, socket;
try {
  server = await createServer({ cacheDir: path.join(directory, "vite-cache"), plugins: [{ name: "decoration-display-smoke", configureServer(instance) {
    instance.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__decoration-display") return next();
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(await server.transformIndexHtml(request.url, `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" style="max-width:1050px;margin:auto;padding:24px"></main><script type="module">
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {TemplatePanel} from '/src/renderer/TemplatePanel.tsx';
        import {CornerDecorationPicker} from '/src/renderer/CornerDecorationPicker.tsx';
        import {WorkspaceSubnav} from '/src/renderer/WorkspaceChrome.tsx';
        import {DecorationSchema} from '/src/shared/decorations.ts';
        import '/src/renderer/styles.css';
        import '/src/renderer/workspace-redesign.css';
        window.jianji={libraryAsset:async()=>({url:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'}),decorationCatalog:async()=>({fonts:[],stickers:[]})};
        function Fixture(){const [options,setOptions]=React.useState(DecorationSchema.parse({mode:'agent',productPrice:'9.9元'}));const [disabled,setDisabled]=React.useState(false);
          const [section,setSection]=React.useState('template');
          window.fixture=options;window.setFixtureDisabled=setDisabled;
          return React.createElement(React.Fragment,null,
            React.createElement(WorkspaceSubnav,{active:section,onNavigate:(id,selector)=>{setSection(id);document.querySelector(selector)?.scrollIntoView({block:'start'});}}),
            React.createElement(TemplatePanel,{selected:'clean',onSelect:()=>{},brief:'',onBrief:()=>{},outputDirectory:'/tmp',onOutput:()=>{},onStart:()=>{window.submitted=options;},count:1,disabled,exportFormat:'mp4',onExportFormat:()=>{},decorationOptions:options,
              onDisplayMode:displayMode=>setOptions(v=>({...v,displayMode})),
              decorations:React.createElement(CornerDecorationPicker,{value:options,onChange:setOptions,onSelect:()=>{},disabled})}));}
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
  await send("Page.navigate", { url: `http://127.0.0.1:${server.httpServer.address().port}/__decoration-display` });
  await waitFor("document.querySelector('#decoration-display-mode') && window.fixture");
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.workspace-subnav button'), button => button.textContent.trim())"), ["显示时段", "四角贴纸"]);
  await clickText("显示时段");
  await waitFor("document.querySelector('.workspace-subnav button.active')?.textContent.trim()==='显示时段'");
  assert.equal(await evaluate("document.querySelector('.workspace-subnav button.active').getAttribute('aria-current')"), "location");
  assert.equal(await evaluate("document.querySelector('#display-time-settings').getBoundingClientRect().top < window.innerHeight"), true);
  assert.equal(await evaluate("document.querySelector('#decoration-display-mode').value"), "full");
  await evaluate("{const el=document.querySelector('#decoration-display-mode');el.value='first-5s';el.dispatchEvent(new Event('change',{bubbles:true}))}");
  await waitFor("window.fixture.displayMode==='first-5s'");
  assert.equal(await evaluate("document.querySelector('.template-preview-info').textContent.includes('最后 0.5 秒渐隐')"), true);
  await clickText("自己设置");
  assert.equal(await evaluate("window.fixture.displayMode"), "first-5s");
  await clickText("全部交给 Agent");
  assert.equal(await evaluate("window.fixture.displayMode"), "first-5s");
  await click(".step-footer .button.primary");
  assert.equal(await evaluate("window.submitted.displayMode"), "first-5s");
  assert.equal(await evaluate("window.submitted.productPrice"), "9.9元");
  await evaluate("window.setFixtureDisabled(true)");
  await waitFor("document.querySelector('#decoration-display-mode').disabled");
  await evaluate("window.setFixtureDisabled(false)");
  await waitFor("!document.querySelector('#decoration-display-mode').disabled");
  await evaluate("{const el=document.querySelector('#decoration-display-mode');el.value='full';el.dispatchEvent(new Event('change',{bubbles:true}))}");
  await waitFor("window.fixture.displayMode==='full'");
  console.log("PASS: display-time navigation stays active and reaches its settings; default full display, first-5s selection, fade preview description, manual/Agent mode retention, submitted choice and text, busy lock, return to full display.");
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    await new Promise((resolve) => { chrome.once("exit", resolve); chrome.kill("SIGTERM"); });
  }
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
