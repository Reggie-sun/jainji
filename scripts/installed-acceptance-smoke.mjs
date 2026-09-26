import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { availableParallelism, freemem, totalmem } from "node:os";
import path from "node:path";

const install = path.resolve(process.argv[2] || path.join(process.env.LOCALAPPDATA, "Programs", "jianji"));
const evidenceRoot = path.resolve(process.argv[3] || "work/windows-installed-acceptance");
const mode = process.argv[4] || "random";
const machine = { cores: availableParallelism(), totalBytes: totalmem(), availableBytes: freemem() };
const driver = spawnSync("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"], { encoding: "utf8", windowsHide: true });
const gpuDriver = driver.status === 0 ? driver.stdout.trim() : undefined;
assert.ok(mode === "random" || mode === "manual", `Unknown decoration mode: ${mode}`);
const executable = path.join(install, "简辑.exe");
const ffmpeg = path.join(install, "resources", "ffmpeg", "ffmpeg.exe");
const ffprobe = path.join(install, "resources", "ffmpeg", "ffprobe.exe");
await Promise.all([executable, ffmpeg, ffprobe].map(access));
await mkdir(evidenceRoot, { recursive: true });
const directory = await mkdtemp(path.join(evidenceRoot, "run-"));
const mediaDirectory = path.join(directory, "测试产品", "素材");
await mkdir(mediaDirectory, { recursive: true });
const environment = {
  ...process.env,
  APPDATA: path.join(directory, "AppData"),
  LOCALAPPDATA: path.join(directory, "LocalAppData"),
  JIANJI_FFMPEG_PATH: "",
  JIANJI_FFPROBE_PATH: "",
};
await Promise.all([environment.APPDATA, environment.LOCALAPPDATA].map((folder) => mkdir(folder, { recursive: true })));
const sources = [
  { file: path.join(mediaDirectory, "横屏 中文 1.mp4"), size: "640x360", rate: 24, audio: true },
  { file: path.join(mediaDirectory, "竖屏 中文 2.mp4"), size: "360x640", rate: 30, audio: false },
];
const damaged = path.join(mediaDirectory, "损坏素材.mp4");
await writeFile(damaged, "not a video");
for (const source of sources) {
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=${source.size}:rate=${source.rate}`];
  if (source.audio) args.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000");
  args.push("-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (source.audio) args.push("-c:a", "aac");
  args.push(source.file);
  const result = spawnSync(ffmpeg, args, { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}
const digest = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const sourceHashes = await Promise.all(sources.map(({ file }) => digest(file)));
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child;
let socket;
try {
  child = spawn(executable, [`--user-data-dir=${path.join(directory, "profile")}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"], { cwd: install, env: environment, stdio: "ignore", windowsHide: true });
  let page;
  for (let attempt = 0; attempt < 400; attempt++) {
    if (child.exitCode !== null) throw new Error(`Installed app exited: ${child.exitCode}`);
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((target) => target.type === "page"); } catch { /* starting */ }
    if (page) break;
    await pause(100);
  }
  assert.ok(page, "Installed app did not open its main page");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error || message.result?.exceptionDetails) request.reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 120_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  await send("Runtime.enable");
  let state = await evaluate("window.jianji.getState()");
  assert.equal(state.capabilities.ready, true, JSON.stringify(state.capabilities));
  assert.equal(state.connection.configured, false, "isolated install must have no model connection");
  state = await evaluate(`window.jianji.addAndProbe(${JSON.stringify(sources.map(({ file }) => file))})`);
  const media = state.project.mediaItems;
  assert.equal(media.length, sources.length);
  assert.ok(media.every((item) => item.probeStatus === "ready"), JSON.stringify(media));
  state = await evaluate(`window.jianji.addAndProbe(${JSON.stringify([damaged])})`);
  assert.equal(state.project.mediaItems.find((item) => item.displayName === path.basename(damaged))?.probeStatus, "invalid");
  const output = await evaluate(`window.jianji.createAutomaticOutputDirectory(${JSON.stringify(media.map(({ id }) => id))})`);
  const decorations = mode === "random"
    ? { mode, productPrice: "测试文字", sticker: "template", fontFamily: "Noto Sans CJK SC" }
    : { mode, productPrice: "自己设置测试", priceStyle: "comic", sticker: "heart", fontFamily: "Noto Sans CJK SC", corners: { "top-left": { type: "sticker", sticker: "heart" }, "top-right": { type: "sticker", sticker: "arrow" }, "bottom-left": { type: "none" }, "bottom-right": { type: "sticker", sticker: "sparkle" } } };
  const request = { ruleId: "clean", mediaIds: media.map(({ id }) => id), outputDirectory: output, brief: "", decorations };
  for (const invalid of ["", "   ", "第一行\n第二行\n第三行", "1234567890123"]) {
    const response = await evaluate(`(async () => { try { await window.jianji.startAgent(${JSON.stringify({ ...request, decorations: { ...request.decorations, productPrice: invalid } })}); return "unexpected"; } catch (error) { return String(error); } })()`);
    assert.notEqual(response, "unexpected", `Invalid display text was admitted: ${JSON.stringify(invalid)}`);
  }
  assert.equal((await evaluate("window.jianji.getState()")).queue.batches.length, 0, "invalid text created a queue batch");
  const exportStarted = Date.now();
  state = await evaluate(`window.jianji.startAgent(${JSON.stringify(request)})`);
  let tasks = [];
  let observedPeakRunning = 0;
  for (let attempt = 0; attempt < 360; attempt++) {
    state = await evaluate("window.jianji.getState()");
    tasks = state.queue.batches.flatMap(({ batch }) => batch.tasks);
    observedPeakRunning = Math.max(observedPeakRunning, tasks.filter((task) => task.status === "running").length);
    if (tasks.length === sources.length && tasks.every((task) => ["completed", "failed", "cancelled", "interrupted"].includes(task.status))) break;
    if (state.agentRun?.items.some((item) => item.status === "failed")) throw new Error(JSON.stringify(state.agentRun.items));
    await pause(500);
  }
  assert.equal(tasks.length, sources.length, JSON.stringify(state.agentRun));
  assert.ok(tasks.every((task) => task.status === "completed"), JSON.stringify(tasks));
  const exportElapsedMs = Date.now() - exportStarted;
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const outputs = [];
  for (const task of tasks) {
    await access(task.outputPath);
    const result = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "json", task.outputPath], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const probe = JSON.parse(result.stdout);
    const original = sources.find(({ file }) => path.basename(file) === mediaById.get(task.mediaId)?.displayName);
    assert.ok(original, `Unknown media ${task.mediaId}`);
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    assert.deepEqual([video.width, video.height], original.size === "640x360" ? [1280, 720] : [720, 1280]);
    assert.equal(video.r_frame_rate, `${original.rate}/1`);
    assert.equal(probe.streams.some((stream) => stream.codec_type === "audio"), original.audio);
    assert.ok(Math.abs(Number(probe.format.duration) - 4) < 0.1, probe.format.duration);
    const decode = spawnSync(ffmpeg, ["-v", "error", "-i", task.outputPath, "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
    assert.equal(decode.status, 0, decode.stderr || decode.error?.message);
    outputs.push({ file: task.outputPath, sha256: await digest(task.outputPath), probe });
  }
  assert.deepEqual(await Promise.all(sources.map(({ file }) => digest(file))), sourceHashes, "source videos changed");
  assert.deepEqual(exceptions, []);
  if (state.capabilities.videoEncoder?.kind === "software-fallback") {
    assert.equal(await evaluate("document.body.innerText.includes('GPU 编码不可用')"), true, "GPU fallback label is misleading");
  }
  const owner = (await readdir(directory, { recursive: true, withFileTypes: true })).find((entry) => entry.name === "owner.lock");
  assert.ok(owner, "knowledge owner lock missing while app runs");
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Installed app did not close")), 20_000);
    child.once("exit", (code) => { clearTimeout(timeout); resolve(code); });
  });
  socket.send(JSON.stringify({ id: ++sequence, method: "Runtime.evaluate", params: { expression: "window.close()" } }));
  assert.equal(await exited, 0);
  await assert.rejects(access(path.join(owner.parentPath, owner.name)), { code: "ENOENT" });
  const report = { result: "PASS", mode, decorations, install, directory, outputDirectory: output, machine, gpuDriver, ffmpegVersion: state.capabilities.ffmpegVersion, encoder: state.capabilities.videoEncoder, executionLimits: state.capabilities.executionLimits, observedPeakRunning, exportElapsedMs, modelConfigured: state.connection.configured, damagedMediaRejected: true, invalidDisplayTextRejected: 4, sources: sources.map((source, index) => ({ ...source, sha256: sourceHashes[index] })), outputs, runtimeExceptions: exceptions };
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket?.close();
  if (child && child.exitCode === null) child.kill();
}
