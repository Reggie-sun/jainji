// Isolated Chrome with real App, fixture desktop state, no provider calls.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
const directory = await mkdtemp(path.join(tmpdir(), "jianji-price-memory-"));
let server;
server = await createServer({ cacheDir: path.join(directory,"vite"), plugins: [{name:"price-memory-fixture",configureServer(instance){instance.middlewares.use(async(req,res,next)=>{
if(req.url!=="/__price_memory") return next();
res.setHeader("Content-Type","text/html");
res.end(await server.transformIndexHtml(req.url, `<!doctype html><html><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';import App from '/src/renderer/App.tsx';
localStorage.setItem('jianji.productPrice','旧的全局价格');
const state={project:{id:'fixture',name:'Fixture',mediaItems:[],hasUnsavedChanges:false},queue:{batches:[]},connection:{configured:true,model:'fixture'},capabilities:{ready:true},templateReadiness:{ready:true,missing:[]}};
window.jianji={getState:async()=>state,onExportSnapshot:(notify)=>{window.switchCollection=(id)=>notify({...state,project:{...state.project,id}});return ()=>{};},decorationCatalog:async()=>({fonts:[],stickers:[]})};
createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>`));
});}}],server:{host:"127.0.0.1",port:5199,strictPort:true}});
await server.listen();
const port=5199;
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
  const open = async () => {
    await send("Page.navigate", {url:`http://127.0.0.1:${port}/__price_memory`});
    await waitFor("document.querySelector('nav button')");
    await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('规则模板')).click()");
    await waitFor("document.querySelector('#product-price')");
  };
  const fill = async (value) => {
    await evaluate(`{const el=document.querySelector('#product-price');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await waitFor(`document.querySelector('#product-price').value===${JSON.stringify(value)}`);
  };
  await open();
  assert.equal(await evaluate("document.querySelector('#product-price').value"), "");
  const switchCollection = async (id) => {
    await evaluate(`window.switchCollection(${JSON.stringify(id)})`);
    await pause(100);
  };
  await fill('9.9元');
  await switchCollection('collection-b');
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '', 'new collection must not inherit another price');
  await fill('29.9元');
  await switchCollection('fixture');
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '9.9元', 'first collection restores its own price');
  await open();
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '9.9元', 'collection price survives reload');
  await switchCollection('collection-b');
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '29.9元');
  await fill('');
  await switchCollection('fixture');
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '9.9元', 'clearing another collection must not change this one');
  await switchCollection('collection-b');
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '');
  await switchCollection('fixture');
  for(const value of ['9.9元到手5卷\n19.9元拍一发三','29.9元','', '未完成\n\n草稿']) {
    await fill(value);
    await open();
    assert.equal(await evaluate("document.querySelector('#product-price').value"),value);
  }
  assert.equal(await evaluate("document.querySelector('#product-price').getAttribute('aria-invalid')"),'true');
  await evaluate("Storage.prototype.getItem=function(){throw Error('fixture unavailable')}");
  await switchCollection('collection-c');
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '', 'read failure must not retain the previous collection price');
  await waitFor("document.body.textContent.includes('未能读取此素材集保存的展示文字')");
  await evaluate("Storage.prototype.setItem=function(){throw Error('fixture full')}");
  await fill('39.9元');
  await waitFor("document.body.textContent.includes('展示文字未能保存到本机')");
  console.log('PASS: collection isolation, switching, independent clearing; first use empty; multiline remembered across reload; edits replace previous value; clearing persists; invalid draft restores and stays invalid; storage failure keeps input usable and shows notice.');
} finally {socket?.close();chrome.kill();await server.close();}
