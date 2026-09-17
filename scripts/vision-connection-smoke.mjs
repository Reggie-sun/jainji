import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Isolated Electron/IPC/FFmpeg proof with two local model fixtures, no real account.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), "jianji-vision-smoke-"));
const source = path.join(directory, "source.mp4"), output = path.join(directory, "output");
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=640x480:r=24", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
const requests = [];
const fixtureErrors = [];
let releaseVision;
let uncertain = false;
const server = createServer((request, response) => {
  let body = "";
  request.on("data", chunk => { body += chunk; });
  request.on("end", async () => {
    try {
      const input = JSON.parse(body), system = input.messages[0].content, content = input.messages[1].content;
      const detecting = system.includes("你是视频画面覆盖物追踪器");
      requests.push({ model: input.model, detecting });
      assert.equal(request.headers.authorization, detecting ? "Bearer vision-fixture" : "Bearer creative-fixture");
      assert.equal(input.model, detecting ? "detector-next" : "creative");
      assert.equal(JSON.stringify(input).includes(directory), false);
      let result;
      if (detecting) {
        assert.equal(input.reasoning_effort, "high");
        if (!uncertain && !releaseVision) await new Promise(resolve => { releaseVision = resolve; });
        const times = content.flatMap(item => item.type === "text" && /^抽帧时间：(\d+)ms。$/.test(item.text) ? [Number(item.text.match(/\d+/)[0])] : []);
        assert.ok(times.length);
        result = { status: uncertain ? "uncertain" : "ok", frames: times.map(timeMs => ({ timeMs, targets: uncertain ? [] : [{ id: "one", rectangle: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 } }] })) };
      } else if (system.includes("你是视频贴纸选材师")) {
        const entries = JSON.parse(system.split("完整目录为 [编号,名称,资格]：")[1]);
        result = { candidates: [(entries.find(entry => entry[1] === "爱心") ?? entries.find(entry => entry[1] === "星芒") ?? entries[0])[0]] };
      } else if (system.includes("你是视频原贴纸覆盖层的选材师")) result = { sticker: content.find(item => item.type === "text" && item.text.startsWith("候选贴纸 1，ID：")).text.match(/ID：([^，]+)/)[1] };
      else {
        const sticker = content.find(item => item.type === "text" && item.text.startsWith("贴纸候选 1，ID："))?.text.match(/ID：([^。，]+)/)?.[1];
        assert.ok(sticker);
        result = { summary: "模拟包装", captions: [], stickers: ["top-left", "top-right", "bottom-left", "bottom-right"].map(corner => ({ corner, sticker, width: 0.08, rotationDeg: 0 })), priceStyle: "ice", filter: "none", intensity: 0 };
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    } catch (error) { fixtureErrors.push(String(error)); response.writeHead(500); response.end("fixture assertion failed"); }
  });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const apiPort = server.address().port;
const portServer = createSocketServer();
await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
const debugPort = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
await writeFile(path.join(directory, "recent-projects.json"), '{"schemaVersion":1,"entries":[]}\n', { mode: 0o600 });
const bootstrap = path.join(directory, "bootstrap.cjs");
await writeFile(bootstrap, `const { app, dialog } = require("electron");
app.setPath("userData", ${JSON.stringify(directory)});
app.setPath("documents", ${JSON.stringify(directory)});
app.getAppPath = () => ${JSON.stringify(root)};
process.defaultApp = true; // Bootstrap loads the development build and its repository resources.
app.commandLine.appendSwitch("remote-debugging-port", ${JSON.stringify(String(debugPort))});
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: options.properties.includes("openDirectory") ? [${JSON.stringify(output)}] : [${JSON.stringify(source)}] });
require(${JSON.stringify(path.join(root, "dist-electron/main.cjs"))});`);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE; delete environment.JIANJI_DEV_SERVER_URL;
const child = spawn(require("electron"), [bootstrap], { cwd: directory, env: environment, stdio: ["ignore", "pipe", "pipe"] });
let processLog = "";
child.stderr.on("data", chunk => { processLog += chunk; }); child.stdout.on("data", chunk => { processLog += chunk; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Electron exited: ${processLog}`);
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((page) => page.type === "page"); } catch {}
    if (target) break;
    await pause(100);
  }
  assert.ok(target, processLog);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.id) {
      const entry = pending.get(message.id); pending.delete(message.id);
      if (message.error) entry?.reject(new Error(JSON.stringify(message.error)));
      else entry?.resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 200; attempt++) { if (await evaluate(expression)) return; await pause(100); }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async (text) => {
    const selector = `[...document.querySelectorAll('button')].find(button => button.textContent.includes(${JSON.stringify(text)}))`;
    assert.equal(await evaluate(`Boolean(${selector} && !${selector}.disabled)`), true, `Button unavailable: ${text}`);
    await evaluate(`${selector}.click()`);
    await pause(80);
  };
  const screenshot = async (name) => {
    await send("Page.bringToFront");
    const image = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(directory, `${name}.png`), Buffer.from(image.data, "base64"));
  };
  await send("Runtime.enable");
  await waitFor("Boolean(window.jianji)");
  await evaluate(`(async () => {
    await window.jianji.saveConnection({ name:'Creative fixture', baseUrl:'http://127.0.0.1:${apiPort}/v1', model:'creative', apiKey:'creative-fixture' });
    await window.jianji.saveConnection({ name:'Vision fixture', baseUrl:'http://127.0.0.1:${apiPort}/v1', model:'detector', apiKey:'vision-fixture' });
    const s = await window.jianji.getState();
    await window.jianji.selectConnection(s.connections.profiles.find(p=>p.name==='Creative fixture').id);
  })()`);
  await click("模型与 API");
  await waitFor("Boolean(document.querySelector('#vision-connection'))");
  const initial = await evaluate("window.jianji.getState()");
  assert.equal(initial.connections.vision, null);
  const visionId = initial.connections.profiles.find(p => p.name === "Vision fixture").id;
  await evaluate(`(() => { const input=document.querySelector('#vision-connection'); input.value=${JSON.stringify(visionId)}; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await waitFor("document.body.innerText.includes('当前视觉识别模型：detector')");
  const visionCard = "[...document.querySelectorAll('.model-picker')].find(card=>card.textContent.includes('当前视觉识别模型：'))";
  await evaluate(`${visionCard}.querySelector('input').focus(); ${visionCard}.querySelector('input').select()`);
  await send("Input.insertText", { text: "detector-next" });
  await evaluate(`(() => { const input=${visionCard}.querySelector('select'); input.value='high'; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await evaluate(`${visionCard}.querySelector('button').click()`);
  await waitFor("document.body.innerText.includes('当前视觉识别模型：detector-next')");
  const configured = await evaluate("window.jianji.getState()");
  assert.equal(configured.connection.model, "creative");
  assert.equal(configured.visionConnection.model, "detector-next");
  assert.equal(configured.visionConnection.reasoningEffort, "high");
  assert.equal(JSON.stringify(configured).includes("vision-fixture"), false);
  await screenshot("vision-configuration");
  await evaluate("window.jianji.selectAndProbe()");
  await evaluate("window.jianji.selectOutputDirectory()");
  await evaluate("window.jianji.setCoverSticker({enabled:true,trackingMode:'agent',stickerIds:[],rectangle:{x:0,y:0,width:0.1,height:0.1}})");
  const state = await evaluate("window.jianji.getState()");
  const input = { ruleId: "clean", brief: "", mediaIds: [state.project.mediaItems[0].id], outputDirectory: output, decorations: { mode: "agent", productPrice: "测试展示", sticker: "none", fontFamily: "Noto Sans CJK SC" } };
  await evaluate(`window.jianji.startAgent(${JSON.stringify(input)})`);
  for (let i=0; i<200 && !releaseVision; i++) await pause(100);
  assert.equal(typeof releaseVision, "function");
  for (const expression of ["window.jianji.selectVisionConnection(null)", `window.jianji.selectModel({connectionId:${JSON.stringify(configured.connections.selected)},model:'changed'})`]) {
    assert.match(await evaluate(`(async()=>{try{await ${expression};return 'unexpected success'}catch(e){return e.message}})()`), /正在处理/);
  }
  releaseVision();
  await waitFor("window.jianji.getState().then(s=>s.queue.batches.some(b=>b.batch.tasks.some(t=>t.status==='completed')))");
  const completed = await evaluate("window.jianji.getState()");
  const task = completed.queue.batches[0].batch.tasks[0];
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", task.outputPath], { encoding: "utf8" }));
  assert.ok(Math.abs(Number(probe.format.duration)-2)<0.1);
  const job = JSON.parse(await readFile(path.join(directory, "jobs", `${completed.queue.batches[0].batch.id}.json`), "utf8"));
  assert.ok(job.batch.templateSnapshot.layers.some(layer=>layer.cover?.automatic));
  assert.ok(requests.some(r=>r.detecting) && requests.some(r=>!r.detecting));
  await evaluate("window.jianji.setCoverSticker({enabled:false,trackingMode:'agent',stickerIds:[],rectangle:{x:0,y:0,width:0.1,height:0.1}})");
  const beforePreserving = requests.filter(r=>r.detecting).length;
  await evaluate(`window.jianji.startAgent(${JSON.stringify(input)})`);
  await waitFor("window.jianji.getState().then(s=>s.queue.batches.length===2 && s.queue.batches.every(b=>b.batch.tasks.every(t=>t.status==='completed')))");
  const preserved = await evaluate("window.jianji.getState()");
  const preservedBatch = preserved.queue.batches.find(b=>b.batch.id!==job.batch.id).batch;
  const preservedJob = JSON.parse(await readFile(path.join(directory, "jobs", `${preservedBatch.id}.json`), "utf8"));
  assert.ok(requests.filter(r=>r.detecting).length > beforePreserving, "coverage off still identifies source occupancy");
  const decorations = preservedJob.batch.templateSnapshot.layers.filter(layer=>layer.type==='sticker');
  assert.equal(decorations.length, 3, "original top-left sticker replaces that corner's new decoration");
  assert.ok(decorations.every(layer=>!layer.cover && !(layer.x<0.5 && layer.y<0.5)));
  uncertain = true;
  const detections = requests.filter(request => request.detecting).length;
  await evaluate(`window.jianji.startAgent(${JSON.stringify(input)})`);
  await waitFor("window.jianji.getState().then(s=>s.agentRun.items.every(i=>i.status==='failed'))");
  const failed = await evaluate("window.jianji.getState()");
  assert.ok(requests.filter(request => request.detecting).length > detections);
  assert.match(JSON.stringify(failed.agentRun.items), /无法可靠识别全部原贴纸/);
  assert.equal(failed.queue.batches.length, preserved.queue.batches.length);
  await evaluate("window.jianji.selectVisionConnection(null)");
  const count = requests.length;
  assert.match(await evaluate(`(async()=>{try{await window.jianji.startAgent(${JSON.stringify(input)});return 'unexpected success'}catch(e){return e.message}})()`), /独立的视觉识别模型/);
  assert.equal(requests.length, count);
  assert.deepEqual(exceptions, []);
  assert.deepEqual(fixtureErrors, []);
  const saved = JSON.parse(await readFile(path.join(directory,"connections/connections.json"),"utf8"));
  assert.equal(saved.vision, null);
  console.log(JSON.stringify({ result:"PASS", directory, output:task.outputPath, requests, runtimeExceptions:exceptions },null,2));
} catch(error) { console.error(processLog.slice(-3000)); throw error; }
finally {
  releaseVision?.(); socket?.close(); child.kill("SIGKILL");
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}
