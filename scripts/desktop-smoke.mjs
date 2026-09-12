import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Real Electron/IPC/FFmpeg smoke; only the provider and native file picker are fixtures.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), "jianji-desktop-smoke-"));
const source = path.join(directory, "测试素材.mp4");
const output = path.join(directory, "output");
execFileSync(process.env.JIANJI_FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
const sourceBytes = await readFile(source);
let requests = 0;
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", async () => {
    const input = JSON.parse(body);
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(input.messages[1].content.filter((item) => item.type === "image_url").length, 3);
    requests += 1;
    if (requests === 2) await unlink(source); // Repro a local render failure after analysis.
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "保留主体，添加克制的暖色角标", captions: [{ text: "把日常过成喜欢", corner: "top-left", size: 0.026 }], filter: "none", intensity: 0 }) } }] }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const apiPort = server.address().port;
const portServer = createSocketServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const debugPort = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const bootstrap = path.join(directory, "bootstrap.cjs");
await writeFile(bootstrap, `const { app, dialog } = require("electron");
app.setPath("userData", ${JSON.stringify(directory)});
app.getAppPath = () => ${JSON.stringify(root)};
app.commandLine.appendSwitch("remote-debugging-port", ${JSON.stringify(String(debugPort))});
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: options.properties.includes("openDirectory") ? [${JSON.stringify(output)}] : [${JSON.stringify(source)}] });
dialog.showMessageBox = async () => ({ response: 1 });
require(${JSON.stringify(path.join(root, "dist-electron/main.cjs"))});
`);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.JIANJI_DEV_SERVER_URL;
const child = spawn(require("electron"), [bootstrap], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
let processLog = "";
child.stderr.on("data", (chunk) => { processLog += chunk.toString(); });
child.stdout.on("data", (chunk) => { processLog += chunk.toString(); });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
    const image = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(directory, `${name}.png`), Buffer.from(image.data, "base64"));
  };
  await send("Runtime.enable");
  await waitFor("document.body.innerText.includes('接入你的创作搭档')");
  await screenshot("01-connection");
  for (const [index, value] of [`http://127.0.0.1:${apiPort}/v1`, "smoke-vision", "local-smoke-key"].entries()) {
    await evaluate(`document.querySelectorAll('.connection-form input')[${index}].focus();document.querySelectorAll('.connection-form input')[${index}].select()`);
    await send("Input.insertText", { text: value });
  }
  await click("保存连接");
  await waitFor("document.body.innerText.includes('把视频拖到这里')");
  assert.equal(await evaluate("localStorage.length"), 0);
  await click("选择本地素材");
  await waitFor("document.body.innerText.includes('测试素材.mp4')");
  await screenshot("02-materials");
  await click("下一步");
  await click("清爽日常");
  assert.equal(await evaluate("document.querySelector('.template-card.clean').getAttribute('aria-pressed')"), "true");
  await screenshot("03-templates");
  await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 720, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, "1080px viewport overflows");
  await screenshot("04-compact");
  await send("Emulation.clearDeviceMetricsOverride");
  await click("选择本地文件夹");
  await click("交给 Agent，开始出片");
  await waitFor("document.querySelector('.result-row .status-tag.completed') !== null");
  assert.equal(requests, 1);
  const state = await evaluate("window.jianji.getState()");
  assert.equal(state.queue.batches[0].batch.tasks[0].status, "completed");
  assert.equal(JSON.stringify(state).includes("local-smoke-key"), false);
  assert.equal(state.agentRun.items[0].summary, "保留主体，添加克制的暖色角标");
  await screenshot("05-results");
  await click("规则模板");
  await click("交给 Agent，开始出片");
  await waitFor("document.querySelector('.result-row .status-tag.failed') !== null");
  await writeFile(source, sourceBytes);
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === '重试导出').click()");
  await waitFor("document.querySelector('.result-row .status-tag.running') !== null");
  const cancelAvailable = await evaluate("[...document.querySelectorAll('.result-row button')].some(button => button.textContent === '停止' && !button.disabled)");
  assert.equal(cancelAvailable, true, "Retry must leave cancellation available");
  await evaluate("[...document.querySelectorAll('.result-row button')].find(button => button.textContent === '停止').click()");
  await waitFor("document.querySelector('.result-row .status-tag.cancelled') !== null");
  assert.equal(await evaluate("document.querySelector('.result-row:has(.status-tag.cancelled)').innerText.includes('重试导出')"), false);
  assert.equal(requests, 2, "Export retry must not invoke the provider again");
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ result: "PASS", providerRequests: requests, screenshotDirectory: directory, output: state.queue.batches[0].batch.tasks[0].outputPath, runtimeExceptions: exceptions }, null, 2));
} catch (error) {
  console.error(processLog.slice(-3000));
  throw error;
} finally {
  socket?.close();
  child.kill("SIGKILL");
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
