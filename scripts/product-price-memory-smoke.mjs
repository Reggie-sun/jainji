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
localStorage.setItem('jianji.productPrice.fixture','8.8元旧值');localStorage.setItem('jianji.productPrice.collection-c','18.8元迁移值');
const templates=new Map([['fixture',{productPriceDraft:'9.9元'}],['collection-b',{}]]);let currentId='fixture';let notify;
const state=()=>({project:{id:currentId,name:'Fixture',mediaItems:[],hasUnsavedChanges:false,template:templates.get(currentId)},queue:{batches:[]},connection:{configured:true,model:'fixture'},capabilities:{ready:true},templateReadiness:{ready:true,missing:[]},activeRecentProjectId:currentId});
window.jianji={getState:async()=>state(),loadProject:async()=>state(),onExportSnapshot:(listener)=>{notify=listener;window.switchCollection=(id)=>{currentId=id;if(!templates.has(id))templates.set(id,{});notify(state());};return ()=>{};},setProductPriceDraft:async(projectId,value)=>{if(window.failPriceSave)throw Error('fixture failure');if(projectId!==currentId)throw Error('stale project');templates.set(currentId,{productPriceDraft:value});window.savedPrice=value;return state();},decorationCatalog:async()=>({fonts:[],stickers:[]})};window.setStoredPrice=(value)=>templates.set(currentId,{productPriceDraft:value});
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
  assert.equal(await evaluate("document.querySelector('#product-price').value"), "9.9元", 'active template restores its saved draft');
  assert.equal(await evaluate("localStorage.getItem('jianji.productPrice')"), "旧的全局价格", 'legacy local storage is ignored');
  assert.equal(await evaluate("localStorage.getItem('jianji.productPrice.fixture')"), "8.8元旧值", 'template JSON wins over stale per-project storage');
  const switchCollection = async (id) => {
    await evaluate(`window.switchCollection(${JSON.stringify(id)})`);
    await pause(100);
  };
  await switchCollection('collection-b');
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '', 'new collection must not inherit another price');
  await fill('29.9元');
  await waitFor("window.savedPrice==='29.9元'");
  await switchCollection('fixture');
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '9.9元', 'first collection restores its own price');
  await switchCollection('collection-b');
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '29.9元');
  await fill('');
  await waitFor("window.savedPrice==='' ");
  await switchCollection('fixture');
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '9.9元', 'clearing another collection must not change this one');
  await switchCollection('collection-b');
  assert.equal(await evaluate("document.querySelector('#product-price').value"), '');
  await switchCollection('fixture');
  await fill('未完成\n\n草稿');
  assert.equal(await evaluate("document.querySelector('#product-price').getAttribute('aria-invalid')"),'true');
  assert.equal(await evaluate("window.savedPrice"), '', 'invalid intermediate text is not persisted');
  await fill('49.9元');
  await waitFor("window.savedPrice==='49.9元'");
  await evaluate("window.setStoredPrice('9.9元');document.querySelector('[aria-label=\"打开项目\"]').click()");
  await waitFor("[...document.querySelectorAll('nav button')].some(button=>button.textContent.includes('规则模板'))");
  await evaluate("[...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('规则模板')).click()");
  await waitFor("document.querySelector('#product-price')");
  await waitFor("document.querySelector('#product-price').value==='9.9元'");
  await switchCollection('collection-c');
  await waitFor("document.querySelector('#product-price').value==='18.8元迁移值'");
  await waitFor("window.savedPrice==='18.8元迁移值'");
  assert.equal(await evaluate("localStorage.getItem('jianji.productPrice.collection-c')"), null, 'migrated per-project storage is retired');
  await evaluate("window.failPriceSave=true");
  await fill('39.9元');
  await waitFor("document.body.textContent.includes('展示文字未能写入当前素材集')");
  console.log('PASS: template JSON draft restores per collection; edits and clearing are isolated; legacy localStorage is ignored; invalid drafts stay local; IPC failure keeps input usable and shows notice.');
} finally {socket?.close();chrome.kill();await server.close();}
