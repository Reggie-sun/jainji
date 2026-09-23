import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const install = path.resolve(process.argv[2] || "dist/win-unpacked");
const resources = path.join(install, "resources");
const ffmpeg = path.join(resources, "ffmpeg", "ffmpeg.exe");
const ffprobe = path.join(resources, "ffmpeg", "ffprobe.exe");
const font = path.join(resources, "fonts", "NotoSansCJKsc-Regular.otf");
const executable = path.join(install, "简辑.exe");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scratch = await mkdtemp(path.join(tmpdir(), "jianji-packaged-smoke-"));
let child;
let socket;

try {
  await Promise.all([ffmpeg, ffprobe, font, executable, path.join(resources, "ffmpeg", "LICENSE"), path.join(resources, "fonts", "LICENSE.txt")].map(access));
  const render = path.join(scratch, "中文价格.mp4");
  const environment = {
    ...process.env,
    PATH: path.join(process.env.SystemRoot || "C:\\Windows", "System32"),
    APPDATA: path.join(scratch, "AppData"),
    LOCALAPPDATA: path.join(scratch, "LocalAppData"),
    JIANJI_FFMPEG_PATH: "",
    JIANJI_FFPROBE_PATH: "",
  };
  await mkdir(environment.APPDATA, { recursive: true });
  await mkdir(environment.LOCALAPPDATA, { recursive: true });
  const encode = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=1", "-vf", "drawtext=fontfile=NotoSansCJKsc-Regular.otf:text=价格100元:fontcolor=white:fontsize=28:x=10:y=10", "-frames:v", "1", "-c:v", "libx264", render], { cwd: path.dirname(font), env: environment, encoding: "utf8", windowsHide: true });
  assert.equal(encode.status, 0, `Bundled FFmpeg/font render failed: ${encode.stderr || encode.error?.message}`);
  const probe = spawnSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1", render], { env: environment, encoding: "utf8", windowsHide: true });
  assert.equal(probe.status, 0, `Bundled ffprobe failed: ${probe.stderr || probe.error?.message}`);
  assert.match(probe.stdout, /codec_name=h264/);

  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  child = spawn(executable, [`--user-data-dir=${path.join(scratch, "profile")}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"], { cwd: install, env: environment, stdio: "ignore", windowsHide: true });
  let page;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error(`Installed app exited: ${child.exitCode}`);
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((target) => target.type === "page"); } catch { /* starting */ }
    if (page) break;
    await pause(100);
  }
  assert.ok(page, "Installed app did not open its main page");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const state = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Installed app IPC timed out")), 20_000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      if (message.error || message.result.exceptionDetails) reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
      else resolve(message.result.result.value);
    });
    socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "window.jianji.getState()", awaitPromise: true, returnByValue: true } }));
  });
  assert.equal(state.capabilities.ready, true, JSON.stringify(state.capabilities));
  assert.equal(state.capabilities.ffmpeg, true);
  assert.equal(state.capabilities.ffprobe, true);
  assert.equal(state.capabilities.fonts, true);
  assert.equal(state.capabilities.h264Encoder, true);
  assert.equal(state.capabilities.aacEncoder, true);
  const owner = (await readdir(scratch, { recursive: true, withFileTypes: true })).find((entry) => entry.name === "owner.lock");
  assert.ok(owner, "installed app acquired a knowledge owner under the isolated profile");
  const ownerLock = path.join(owner.parentPath, owner.name);
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Installed app did not exit cleanly")), 20_000);
    child.once("exit", (code) => { clearTimeout(timeout); resolve(code); });
  });
  socket.send(JSON.stringify({ id: 2, method: "Runtime.evaluate", params: { expression: "window.close()" } }));
  assert.equal(await exited, 0, "normal window close exits successfully");
  await assert.rejects(access(ownerLock), { code: "ENOENT" }, "normal exit releases the knowledge owner");
  console.log("PASS: installed app ready with bundled FFmpeg, ffprobe and Chinese font; normal exit released the knowledge owner.");
} finally {
  socket?.close();
  if (child && child.exitCode === null) child.kill();
  await pause(300);
  if (scratch.startsWith(`${path.resolve(tmpdir())}${path.sep}`)) await rm(scratch, { recursive: true, force: true });
}
