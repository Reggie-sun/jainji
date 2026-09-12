import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
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
let briefRequests = 0;
let briefPayload;
let failBrief = false;
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", async () => {
    const input = JSON.parse(body);
    const anthropic = request.url === "/anthropic/v1/messages";
    assert.equal(request.url, anthropic ? "/anthropic/v1/messages" : "/v1/chat/completions");
    const userContent = input.messages[anthropic ? 0 : 1].content;
    if (typeof userContent === "string") {
      assert.equal(request.headers.authorization, anthropic ? "Bearer cc-switch-fixture-key" : "Bearer local-smoke-key");
      briefRequests += 1; briefPayload = input;
      await new Promise(resolve => setTimeout(resolve, 300));
      response.setHeader("Content-Type", "application/json");
      if (failBrief) { response.writeHead(503); response.end('{}'); return; }
      const text = "保持清爽自然，保留已选贴纸与文字，按画面需要留白。";
      response.end(JSON.stringify(anthropic ? { content: [{ type: "text", text }] } : { choices: [{ message: { content: text } }] }));
      return;
    }
    assert.equal(input.messages[anthropic ? 0 : 1].content.filter((item) => item.type === (anthropic ? "image" : "image_url")).length, 3);
    assert.equal(input.model, anthropic ? "MiniMax-M3" : "smoke-vision-next", "video analysis uses the selected model");
    if (!anthropic) assert.equal(input.reasoning_effort, "high", "video analysis uses selected effort");
    assert.equal(request.headers.authorization, anthropic ? "Bearer cc-switch-fixture-key" : "Bearer local-smoke-key");
    requests += 1;
    if (requests === 2) await unlink(source); // Repro a local render failure after analysis.
    response.setHeader("Content-Type", "application/json");
    const text = JSON.stringify({ summary: "保留主体，添加清透角标", captions: [{ text: "把日常过成喜欢", corner: "top-left", size: 0.026 }], filter: "cool", intensity: 0.3 });
    response.end(JSON.stringify(anthropic ? { content: [{ type: "text", text }] } : { choices: [{ message: { content: text } }] }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const apiPort = server.address().port;
const fixtureHome = path.join(directory, "home");
await mkdir(path.join(fixtureHome, ".cc-switch"), { recursive: true });
const SQL = await require("sql.js/dist/sql-asm.js")();
const db = new SQL.Database();
db.run("CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT, is_current INTEGER)");
db.run("INSERT INTO providers VALUES (?, ?, ?, ?, 1)", ["fixture", "claude", "MiniMax fixture", JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "cc-switch-fixture-key", ANTHROPIC_BASE_URL: `http://127.0.0.1:${apiPort}/anthropic`, ANTHROPIC_MODEL: "MiniMax-M3" } })]);
await writeFile(path.join(fixtureHome, ".cc-switch", "cc-switch.db"), Buffer.from(db.export())); db.close();
const portServer = createSocketServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const debugPort = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const bootstrap = path.join(directory, "bootstrap.cjs");
await writeFile(bootstrap, `const { app, dialog, shell } = require("electron");
require("node:os").homedir = () => ${JSON.stringify(fixtureHome)};
const childProcess = require("node:child_process");
const nativeSpawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => /[\\\\/]vendor[\\\\/].*[\\\\/]bin[\\\\/]codex(?:\\.exe)?$/.test(command) ? nativeSpawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(path.join(root, "tests/fixtures/codex-app-server.cjs"))}, ${JSON.stringify(path.join(directory, "codex.pid"))}], options) : nativeSpawn(command, args, options);
shell.openExternal = async (url) => { if (!url.startsWith("https://auth.openai.com/")) throw new Error("Unexpected login URL"); };
app.setPath("userData", ${JSON.stringify(directory)});
require("node:fs").watch(${JSON.stringify(directory)}, (_event, name) => { if (name === "quit.signal") app.quit(); });
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
  const duplicate = spawn(require("electron"), [bootstrap], { cwd: root, env: environment, stdio: "ignore" });
  const duplicateExit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { duplicate.kill(); reject(new Error("Second instance failed to exit")); }, 5000);
    duplicate.once("exit", (code) => { clearTimeout(timeout); resolve(code); });
  });
  assert.equal(duplicateExit, 0, "Second instance must leave the existing connection owner running");
  await screenshot("01-connection");
  await click("使用 ChatGPT 登录");
  await waitFor("document.body.innerText.includes('取消登录')");
  await screenshot("01a-login-pending");
  await click("取消登录");
  await waitFor("document.body.innerText.includes('使用 ChatGPT 登录')");
  await click("使用 ChatGPT 登录");
  await waitFor("document.body.innerText.includes('smoke@example.test')");
  assert.equal((await evaluate("window.jianji.getState()")).connection.source, "chatgpt");
  assert.deepEqual(await evaluate("[...document.querySelector('.model-picker select').options].map(option => option.value)"), ["", "smoke-codex-vision", "smoke-codex-next"]);
  await evaluate("document.querySelector('.model-picker select').value = 'smoke-codex-next'; document.querySelector('.model-picker select').dispatchEvent(new Event('change', { bubbles: true }))");
  await waitFor("document.body.innerText.includes('创作模型已切换并保存')");
  assert.equal((await evaluate("window.jianji.getState()")).connection.model, "smoke-codex-next");
  assert.deepEqual(await evaluate("[...document.querySelector('.effort-picker select').options].map(option => option.value)"), ["", "medium", "xhigh", "ultra"], "efforts come from the chosen model");
  await evaluate("document.querySelector('.effort-picker select').value = 'xhigh'; document.querySelector('.effort-picker select').dispatchEvent(new Event('change', { bubbles: true }))");
  await waitFor("document.querySelector('.effort-picker select').value === 'xhigh' && !document.querySelector('.effort-picker select').disabled");
  assert.equal((await evaluate("window.jianji.getState()")).connection.reasoningEffort, "xhigh");
  await click("刷新登录状态");
  assert.equal((await evaluate("window.jianji.getState()")).chatgpt.status, "ready");
  assert.equal((await evaluate("window.jianji.getState()")).connection.model, "smoke-codex-next");
  assert.equal(JSON.parse(await readFile(path.join(directory, "connections/connections.json"), "utf8")).chatgptModel, "smoke-codex-next");
  assert.equal(JSON.parse(await readFile(path.join(directory, "connections/connections.json"), "utf8")).chatgptReasoningEffort, "xhigh");
  await screenshot("01b-chatgpt-ready");
  await click("断开");
  await waitFor("document.body.innerText.includes('使用 ChatGPT 登录')");
  await click("API 连接管理");
  await click("添加 API 连接");
  for (const [index, value] of ["Smoke API", `http://127.0.0.1:${apiPort}/v1/`, "smoke-vision", "local-smoke-key"].entries()) {
    await evaluate(`document.querySelectorAll('.connection-form input')[${index}].focus();document.querySelectorAll('.connection-form input')[${index}].select()`);
    await send("Input.insertText", { text: value });
  }
  await click("保存连接");
  await waitFor("document.body.innerText.includes('使用此连接')");
  await click("编辑");
  assert.equal(await evaluate("document.querySelector('input[type=password]').value"), "");
  await click("保存连接");
  await click("使用此连接");
  await waitFor("document.body.innerText.includes('把视频拖到这里')");
  await evaluate("(async () => { const state = await window.jianji.getState(); const { protocol, ...profile } = state.connections.profiles[0]; await window.jianji.saveConnection(profile); })()");
  assert.equal(await evaluate("localStorage.length"), 0);
  await click("选择本地素材");
  await waitFor("document.body.innerText.includes('测试素材.mp4')");
  await screenshot("02-materials");
  await click("下一步");
  assert.equal(await evaluate("document.querySelectorAll('.template-card').length"), 8);
  assert.equal(await evaluate("document.body.innerText.includes('贴纸 · 青色箭头') && document.body.innerText.includes('滤镜 · 清透')"), true);
  await click("清爽日常");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.model-picker datalist option')].map(option => option.value)"), ["smoke-vision"], "saved candidates survive trailing slash and legacy default protocol");
  await evaluate("document.querySelector('.model-picker input').focus(); document.querySelector('.model-picker input').select()");
  await send("Input.insertText", { text: "smoke-vision-next" });
  await evaluate("document.querySelector('.effort-picker select').value = 'high'; document.querySelector('.effort-picker select').dispatchEvent(new Event('change', { bubbles: true }))");
  await click("应用模型");
  await waitFor("document.body.innerText.includes('当前模型：smoke-vision-next')");
  assert.equal((await evaluate("window.jianji.getState()")).connection.model, "smoke-vision-next");
  await evaluate("document.querySelector('.model-picker').scrollIntoView()");
  await screenshot("02a-api-model");
  assert.equal(await evaluate("document.querySelector('.template-card.clean').getAttribute('aria-pressed')"), "true");
  await waitFor("document.body.innerText.includes('公主请下单（动效）') && document.body.innerText.includes('特别推荐')");
  assert.equal(await evaluate("document.querySelectorAll('.sticker-choices button').length"), 24);
  assert.equal(await evaluate("document.querySelectorAll('.sticker-choices img[src^=\"data:image/gif\"]').length"), 3);
  await click("公主请下单（动效）");
  assert.equal(await evaluate("[...document.querySelectorAll('.sticker-choices button')].find(button => button.textContent.includes('公主请下单')).getAttribute('aria-pressed')"), "true");
  await click("自动生成提示词");
  await waitFor("document.querySelector('.generate-brief').disabled && document.querySelector('#creative-brief').disabled");
  assert.equal(await evaluate("document.querySelector('.model-picker input').disabled"), true);
  assert.equal(await evaluate("document.querySelector('.effort-picker select').disabled"), true);
  assert.equal(await evaluate("(async () => { const state = await window.jianji.getState(); try { await window.jianji.selectModel({ connectionId: state.connections.selected, model: 'forbidden-switch' }); return false; } catch { return true; } })()"), true, "IPC rejects model switch during a request");
  await waitFor("document.querySelector('#creative-brief').value.includes('保持清爽自然')");
  assert.equal(briefRequests, 1, "one explicit API request");
  assert.equal(briefPayload.model, "smoke-vision-next", "selected model reaches provider request");
  assert.equal(briefPayload.reasoning_effort, "high", "selected effort reaches provider request");
  assert.equal(requests, 0, "prompt generation does not export");
  assert.equal(JSON.stringify(briefPayload).includes("公主请下单"), true, "selected sticker label sent");
  const generatedBrief = await evaluate("document.querySelector('#creative-brief').value");
  failBrief = true;
  await click("自动生成提示词");
  await waitFor("!document.querySelector('.generate-brief').disabled");
  assert.equal(await evaluate("document.querySelector('#creative-brief').value"), generatedBrief, "API error preserves existing text");
  assert.equal(briefRequests, 2, "no automatic retries");
  failBrief = false;
  await evaluate("document.querySelector('#creative-brief').focus();document.querySelector('#creative-brief').select()");
  await send("Input.insertText", { text: "生成后仍可编辑" });
  assert.equal(await evaluate("document.querySelector('#creative-brief').value"), "生成后仍可编辑");
  await screenshot("03-templates");
  await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 720, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, "1080px viewport overflows");
  await screenshot("04-compact");
  await send("Emulation.clearDeviceMetricsOverride");
  await click("选择本地文件夹");
  await click("交给 Agent，制作");
  await waitFor("document.querySelector('.result-row .status-tag.completed') !== null");
  assert.equal(requests, 1);
  const state = await evaluate("window.jianji.getState()");
  assert.equal(state.queue.batches[0].batch.tasks[0].status, "completed");
  assert.equal(JSON.stringify(state).includes("local-smoke-key"), false);
  assert.equal(state.agentRun.items[0].summary, "保留主体，添加清透角标");
  await screenshot("05-results");
  await click("模型与 API");
  await click("API 连接管理");
  await evaluate("document.querySelector('details').open = true");
  await click("读取可导入配置");
  await waitFor("document.body.innerText.includes('MiniMax fixture')");
  assert.equal(await evaluate("document.body.innerText.includes('cc-switch-fixture-key')"), false);
  await screenshot("06-cc-switch");
  await click("导入到简辑");
  await waitFor("document.querySelectorAll('.provider-choice').length === 3");
  await click("删除");
  await click("确认删除");
  await waitFor("document.querySelectorAll('.provider-choice').length === 2");
  assert.equal((await evaluate("window.jianji.getState()")).connection.configured, false);
  await evaluate("[...document.querySelectorAll('.provider-choice')].find(p => p.querySelector('strong').textContent.includes('MiniMax') && p.textContent.includes('使用此连接')).querySelector('button').click()");
  await waitFor("document.body.innerText.includes('把视频拖到这里')");
  const imported = await evaluate("window.jianji.getState()");
  assert.equal(imported.connection.source, "api");
  assert.equal(imported.connection.protocol, "anthropic");
  assert.equal(JSON.stringify(imported).includes("cc-switch-fixture-key"), false);
  await click("规则模板");
  await click("交给 Agent，制作");
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
  const codexPid = Number(await readFile(path.join(directory, "codex.pid"), "utf8"));
  const exit = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Application did not finish shutdown")), 10_000);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
  await writeFile(path.join(directory, "quit.signal"), "quit");
  assert.equal(await exit, 0);
  assert.throws(() => process.kill(codexPid, 0), { code: "ESRCH" }, "App must wait for its Codex child to exit");
  console.log(JSON.stringify({ result: "PASS", providerRequests: requests, briefRequests, screenshotDirectory: directory, output: state.queue.batches[0].batch.tasks[0].outputPath, runtimeExceptions: exceptions }, null, 2));
} catch (error) {
  console.error(processLog.slice(-3000));
  throw error;
} finally {
  socket?.close();
  child.kill("SIGKILL");
  try {
    const pid = Number(await readFile(path.join(directory, "codex.pid"), "utf8"));
    if (Number.isSafeInteger(pid) && pid > 0) {
      const owned = process.platform !== "linux" || (await readFile(`/proc/${pid}/cmdline`, "utf8")).includes(path.join(root, "tests/fixtures/codex-app-server.cjs"));
      if (owned) process.kill(pid, "SIGKILL");
    }
  } catch { /* The task-owned fixture has already exited. */ }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
