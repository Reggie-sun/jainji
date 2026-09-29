import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.env.JIANJI_SMOKE_ELECTRON || path.join(root, "node_modules/electron/dist/electron");
const packaged = process.argv.includes("--packaged");
const fixedPort = process.argv.includes("--fixed-port");
const directory = await mkdtemp(path.join(tmpdir(), "jianji-default-cdp-smoke-"));
const profile = path.join(directory, "profile");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await mkdir(profile, { mode: 0o700 });
await mkdir(path.join(directory, "home"), { mode: 0o700 });
const environment = { ...process.env, HOME: path.join(directory, "home"), XDG_CONFIG_HOME: path.join(directory, "config") };
delete environment.ELECTRON_RUN_AS_NODE;
const report = { executable, packaged, fixedPort, directory, runs: [] };
let child, socket;
let requestId = 0;
function request(method, params = {}) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.removeEventListener("message", receive); reject(new Error(`${method} timed out`)); }, 15_000);
    function receive(event) {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer); socket.removeEventListener("message", receive);
      if (message.error || message.result.exceptionDetails) reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
      else resolve(message.result);
    }
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  for (let run = 0; run < (fixedPort ? 1 : 2); run++) {
    await unlink(path.join(profile, "DevToolsActivePort")).catch((error) => { if (error.code !== "ENOENT") throw error; });
    let requestedPort;
    if (fixedPort) {
      const server = createServer();
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      requestedPort = server.address().port;
      await new Promise((resolve) => server.close(resolve));
    }
    const args = [...(packaged ? [] : [root]), `--user-data-dir=${profile}`];
    if (fixedPort) args.push(`--remote-debugging-port=${requestedPort}`, "--remote-debugging-address=0.0.0.0");
    const log = await open(path.join(directory, `launch-${run}.log`), "w", 0o600);
    child = spawn(executable, args, { cwd: root, env: environment, stdio: ["ignore", log.fd, log.fd] });
    await log.close();
    let port, page, version;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, `app exited before CDP became ready: ${child.exitCode}`);
      try {
        port = requestedPort || Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
        assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
        const endpoint = `http://127.0.0.1:${port}`;
        version = await (await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) })).json();
        page = (await (await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(1000) })).json()).find((target) => target.type === "page" && target.url.endsWith("/dist/index.html"));
        if (page) break;
      } catch { /* starting */ }
      await delay(100);
    }
    assert.ok(page, "normal app launch did not expose its renderer through CDP");
    if (requestedPort) assert.equal(port, requestedPort, "explicit test port remains supported");
    let listeners;
    if (process.platform === "linux") {
      const tables = await Promise.all(["tcp", "tcp6"].map((name) => readFile(`/proc/net/${name}`, "utf8")));
      listeners = tables.flatMap((table) => table.trim().split("\n").slice(1).map((line) => line.trim().split(/\s+/)))
        .filter((fields) => fields[3] === "0A" && parseInt(fields[1].split(":")[1], 16) === port).map((fields) => fields[1].split(":")[0]);
      assert.ok(listeners.length > 0, "CDP listener is observable");
      assert.ok(listeners.every((address) => address === "0100007F" || address === "00000000000000000000000001000000"), `CDP must bind only loopback: ${listeners}`);
    }
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let state;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const result = await request("Runtime.evaluate", {
          expression: "(async () => { const state = await window.jianji.getState(); return { title: document.title, projectName: state.project.name, apiReady: typeof window.jianji.loadProject === 'function' && typeof window.jianji.startBatchProduction === 'function' && typeof window.jianji.resumeDouyinUpload === 'function', buttonCount: document.querySelectorAll('button').length }; })()",
          awaitPromise: true, returnByValue: true,
        });
        state = result.result.value;
        if (state.apiReady && state.buttonCount > 0) break;
      } catch { /* preload and app owners are starting */ }
      await delay(100);
    }
    assert.ok(state?.apiReady && state.buttonCount > 0, "real renderer and existing preload owners are ready");
    const screenshot = await request("Page.captureScreenshot");
    await writeFile(path.join(directory, `renderer-${run}.png`), Buffer.from(screenshot.data, "base64"));
    report.runs.push({ args, pid: child.pid, port, browser: version.Browser, browserWebSocket: version.webSocketDebuggerUrl, rendererUrl: page.url, listeners, state });
    const exited = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("app did not close normally")), 20_000);
      child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
    });
    socket.send(JSON.stringify({ id: ++requestId, method: "Runtime.evaluate", params: { expression: "window.close()" } }));
    assert.equal(await exited, 0, "normal close succeeds");
    socket.close(); socket = undefined;
    const knowledgeFiles = await readdir(profile, { recursive: true });
    assert.ok(!knowledgeFiles.some((file) => file.endsWith("owner.lock")), "normal close releases knowledge ownership");
  }
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.message;
  throw error;
} finally {
  socket?.close();
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    for (let attempt = 0; attempt < 50 && child.exitCode === null; attempt++) await delay(100);
  }
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, report: path.join(directory, "report.json") }));
}
