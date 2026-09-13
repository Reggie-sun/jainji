import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

// Real Electron -> real local relay -> fixture GitHub; no real credentials or remote issues.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), "jianji-feedback-smoke-"));
const imageFile = path.join(directory, "screenshot.png");
const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQaCgAAAGkAQHaatBvAAAAAElFTkSuQmCC";
await writeFile(imageFile, Buffer.from(imageBase64, "base64"));
const repository = "Reggie-sun/jainji";
let rejectNext = true;
let dropNext = false;
const posts = [];
const created = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", async () => {
    if (request.method === "GET") {
      assert.ok(request.url.startsWith(`/repos/${repository}/issues?state=all`));
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(created)); return;
    }
    assert.equal(request.url, `/repos/${repository}/issues`);
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer fixture-github-secret");
    posts.push(JSON.parse(body));
    await new Promise((resolve) => setTimeout(resolve, 200));
    response.setHeader("Content-Type", "application/json");
    if (rejectNext) { rejectNext = false; response.writeHead(403); response.end('{"message":"fixture-github-secret"}'); return; }
    const receipt = { number: 42 + created.length, html_url: `https://github.com/${repository}/issues/${42 + created.length}` };
    created.push({ ...receipt, body: JSON.parse(body).body });
    if (dropNext) { dropNext = false; response.destroy(); return; }
    response.writeHead(201);
    response.end(JSON.stringify(receipt));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const apiPort = server.address().port;
const relayBundle = path.join(directory, "relay.cjs");
await require("esbuild").build({ entryPoints: [path.join(root, "src/feedback-server/service.ts")], bundle: true, platform: "node", format: "cjs", outfile: relayBundle });
const { createFeedbackServer } = require(relayBundle);
const relay = createFeedbackServer({ directory: path.join(directory, "relay-data"), token: "fixture-github-secret", publicUrl: "https://feedback.example.test",
  fetcher: (url, options) => {
    assert.ok(String(url).startsWith("https://api.github.com/"));
    return fetch(String(url).replace("https://api.github.com", `http://127.0.0.1:${apiPort}`), options);
  },
});
await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
const relayPort = relay.address().port;
const portServer = createSocketServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const debugPort = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const bootstrap = path.join(directory, "bootstrap.cjs");
await writeFile(bootstrap, `const { app, shell } = require("electron");
app.setPath("userData", ${JSON.stringify(directory)});
app.getAppPath = () => ${JSON.stringify(root)};
app.commandLine.appendSwitch("remote-debugging-port", ${JSON.stringify(String(debugPort))});
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
shell.openExternal = async (url) => { require("node:fs").writeFileSync(${JSON.stringify(path.join(directory, "opened-url.txt"))}, url); };
shell.showItemInFolder = (file) => { require("node:fs").writeFileSync(${JSON.stringify(path.join(directory, "revealed-file.txt"))}, file); };
require(${JSON.stringify(path.join(root, "dist-electron/main.cjs"))});
`);
const environment = { ...process.env, JIANJI_GITHUB_TOKEN: "client-canary-must-not-be-used", JIANJI_FEEDBACK_URL: `http://127.0.0.1:${relayPort}` };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.JIANJI_DEV_SERVER_URL;
let processLog = "";
const launch = () => {
  const process = spawn(require("electron"), [bootstrap], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  process.stderr.on("data", (chunk) => { processLog += chunk.toString(); });
  process.stdout.on("data", (chunk) => { processLog += chunk.toString(); });
  return process;
};
let child = launch();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let attempt = 0; attempt < 400; attempt++) {
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
  const handleMessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.id) { const entry = pending.get(message.id); pending.delete(message.id); if (message.error) entry?.reject(new Error(JSON.stringify(message.error))); else entry?.resolve(message.result); }
  };
  socket.addEventListener("message", handleMessage);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression: `(async () => (${expression}))()`, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 200; attempt++) { if (await evaluate(expression)) return; await pause(100); }
    throw new Error(`Timed out: ${expression}; posts=${posts.length}; dialog=${await evaluate("document.querySelector('dialog')?.innerText")}`);
  };
  const click = async (text) => {
    const selector = `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)})`;
    assert.equal(await evaluate(`Boolean(${selector} && !${selector}.disabled)`), true, `Button unavailable: ${text}`);
    await evaluate(`${selector}.click()`); await pause(80);
  };
  const fill = async (id, value, tag = "HTMLInputElement") => {
    await evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(${tag}.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await pause(80);
  };
  await send("Runtime.enable");
  await waitFor("document.body.innerText.includes('反馈问题')");
  await click("反馈问题");
  await waitFor("document.querySelector('dialog').open");
  assert.equal(await evaluate("document.querySelector('.feedback-dialog button.button.primary').disabled"), true);
  assert.equal(await evaluate("Boolean(document.querySelector('#feedback-token'))"), false);
  assert.equal(await evaluate("'configureFeedback' in window.jianji || 'feedbackStatus' in window.jianji"), false);
  const description = "点击导出后无响应 token=private-description /home/private/video.mp4";
  await fill("feedback-description", description, "HTMLTextAreaElement");
  const { root: documentNode } = await send("DOM.getDocument");
  const { nodeId } = await send("DOM.querySelector", { nodeId: documentNode.nodeId, selector: 'input[aria-label="选择反馈截图"]' });
  await send("DOM.setFileInputFiles", { nodeId, files: [imageFile] });
  await waitFor("Boolean(document.querySelector('.feedback-image img'))");
  await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 720, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate("document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth"), true);
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(directory, "feedback-form.png"), Buffer.from(screenshot.data, "base64"));
  await click("提交到 GitHub");
  await waitFor("document.querySelector('dialog').innerText.includes('反馈服务暂时无法确认')");
  assert.equal(await evaluate("document.querySelector('dialog').innerText.includes('fixture-github-secret')"), false);
  assert.equal(await evaluate("document.getElementById('feedback-description').value"), description);
  await click("重试 / 核对提交");
  await waitFor("document.querySelector('dialog').innerText.includes('已提交 Issue #42')");
  assert.equal(posts.length, 2, "one rejected POST and one successful explicit retry");
  assert.ok(!JSON.stringify(posts).includes("private-description"));
  assert.ok(!JSON.stringify(posts).includes("/home/private"));
  assert.ok(!JSON.stringify(posts).includes(imageBase64));
  assert.ok(posts[1].body.includes("https://feedback.example.test/api/feedback/"));
  const id = posts[1].body.match(/bug-feedback-id:([a-f0-9-]+)/)[1];
  const input = { feedbackId: id, description, page: "connection", screenshot: { contentType: "image/png", dataBase64: imageBase64 } };
  assert.equal((await evaluate(`await window.jianji.submitFeedback(${JSON.stringify(input)})`)).issueNumber, 42);
  assert.equal(posts.length, 2, "duplicate submission returns the saved receipt");
  await click("打开 Issue #42");
  assert.equal(await readFile(path.join(directory, "opened-url.txt"), "utf8"), `https://github.com/${repository}/issues/42`);
  await click("打开截图所在文件夹");
  const localImage = await readFile(path.join(directory, "revealed-file.txt"), "utf8");
  assert.equal((await readFile(localImage)).toString("base64"), imageBase64);
  const publishedImage = await fetch(`http://127.0.0.1:${relayPort}/api/feedback/${id}/screenshot`);
  assert.equal(publishedImage.status, 200);
  assert.equal(Buffer.from(await publishedImage.arrayBuffer()).toString("base64"), imageBase64);
  const receiptImage = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(directory, "feedback-receipt.png"), Buffer.from(receiptImage.data, "base64"));
  await evaluate("document.querySelector('button[aria-label=\"关闭问题反馈\"]').click()");
  await click("反馈问题");
  assert.equal(await evaluate("document.querySelector('dialog').innerText.includes('已提交 Issue #42')"), true);
  await click("再反馈一个问题");
  await fill("feedback-description", "结果不明后的重启恢复检查", "HTMLTextAreaElement");
  dropNext = true;
  await click("提交到 GitHub");
  await waitFor("document.querySelector('dialog').innerText.includes('反馈服务暂时无法确认')");
  assert.equal(posts.length, 3);
  socket.close();
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  child = launch();
  target = undefined;
  for (let attempt = 0; attempt < 400; attempt++) {
    if (child.exitCode !== null) throw new Error(`Restart failed: ${processLog}`);
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((page) => page.type === "page"); } catch {}
    if (target) break;
    await pause(100);
  }
  assert.ok(target, "restarted Electron exposes its new renderer");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", handleMessage);
  await send("Runtime.enable");
  await waitFor("document.body.innerText.includes('反馈问题')");
  await click("反馈问题");
  await waitFor("document.querySelector('.feedback-history')?.innerText.includes('恢复 / 核对反馈')");
  await click("恢复 / 核对反馈");
  await waitFor("document.querySelector('dialog').innerText.includes('已提交 Issue #43')");
  assert.equal(posts.length, 3, "restarting and reconciling an uncertain submission never reposts");
  await click("再反馈一个问题");
  await click("查看回执 #42");
  await waitFor("document.querySelector('dialog').innerText.includes('已提交 Issue #42')");
  await click("打开截图所在文件夹");
  assert.equal(await readFile(path.join(directory, "revealed-file.txt"), "utf8"), localImage);
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ status: "PASS", relay: "real local service", github: "local fixture only", posts: posts.length, screenshotDirectory: directory, runtimeExceptions: exceptions }, null, 2));
} catch (error) { console.error(processLog.slice(-2000)); throw error; }
finally {
  socket?.close(); child.kill("SIGKILL");
  relay.closeAllConnections(); await new Promise((resolve) => relay.close(resolve));
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
}
