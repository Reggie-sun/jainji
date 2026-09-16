import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Isolated Electron, fixture HTTP, and real FFmpeg proof. It never opens a user profile.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const work = await mkdtemp(path.join(tmpdir(), "jianji-assisted-smoke-"));
const validation = path.join("/home/reggie/jianji-validation", `assisted-cover-smoke-${Date.now()}`);
await mkdir(validation, { recursive: true, mode: 0o700 });
const source = path.join(work, "source.mp4"), output = path.join(work, "output"), collection = path.join(work, "assisted.jianji-project.json");
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-c:a", "aac", "-shortest", "-pix_fmt", "yuv420p", source]);
let totalRequests = 0, visionRequests = 0, reviewRequests = 0, creativeRequests = 0;
const fixture = createServer((request, response) => {
  let body = ""; request.on("data", (chunk) => { body += chunk; }); request.on("end", () => {
    try {
      const input = JSON.parse(body), system = input.messages?.[0]?.content ?? "", content = input.messages?.[1]?.content ?? [];
      totalRequests++;
      assert.equal(JSON.stringify(input).includes(work), false, "fixture must not receive local paths");
      let result;
      if (system.includes("视频画面覆盖物追踪器")) { visionRequests++; const times = content.flatMap((item) => item.type === "text" && /^抽帧时间：(\d+)ms。$/.test(item.text) ? [Number(item.text.match(/\d+/)[0])] : []); result = { status: "uncertain", frames: times.map((timeMs) => ({ timeMs, targets: [] })) }; }
      else if (system.includes("视频贴纸选材师")) { const entries = JSON.parse(system.split("完整目录为 [编号,名称,资格]：")[1]); result = { candidates: [(entries.find((item) => item[1] === "爱心") ?? entries[0])[0]] }; }
      else if (system.includes("原贴纸覆盖层的选材师")) { const entry = content.find((item) => item.type === "text" && item.text.startsWith("候选贴纸 1，ID：")); result = { sticker: entry.text.match(/ID：([^，]+)/)[1] }; }
      else if (system.includes("independent visual reviewer")) { reviewRequests++; result = { status: "no_issue_observed", findings: [] }; }
      else { creativeRequests++; result = { summary: "fixture", captions: [], filter: "cool", intensity: 0.3 }; }
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const port = fixture.address().port;
const portServer = createSocketServer(); await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve)); const debugPort = portServer.address().port; await new Promise((resolve) => portServer.close(resolve));
await writeFile(path.join(work, "recent-projects.json"), '{"schemaVersion":1,"entries":[]}\n', { mode: 0o600 });
const bootstrap = path.join(work, "bootstrap.cjs");
await writeFile(bootstrap, `const {app,dialog}=require('electron');app.setPath('userData',${JSON.stringify(work)});app.setPath('documents',${JSON.stringify(work)});app.getAppPath=()=>${JSON.stringify(root)};process.defaultApp=true;app.commandLine.appendSwitch('remote-debugging-port',${JSON.stringify(String(debugPort))});dialog.showOpenDialog=async(_w,o)=>({canceled:false,filePaths:o.properties.includes('openDirectory')?[${JSON.stringify(output)}]:o.title==='打开项目'?[${JSON.stringify(collection)}]:[${JSON.stringify(source)}]});dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(collection)}});dialog.showMessageBox=async()=>({response:0});require(${JSON.stringify(path.join(root, "dist-electron/main.cjs"))});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.JIANJI_DEV_SERVER_URL;
const child = spawn(require("electron"), [bootstrap], { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] }); let log = ""; child.stderr.on("data", (b) => { log += b; });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); let socket;
try {
  let target; for (let i = 0; i < 100 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((item) => item.type === "page"); } catch {} await pause(100); }
  assert.ok(target, log); socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let seq = 0; const pending = new Map(); socket.addEventListener("message", ({ data }) => { const message = JSON.parse(data); if (message.id) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const wait = async (expression) => { for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`timeout ${expression}\n${await evaluate("document.body.innerText.slice(0,4000)")}`); };
  const shot = async (name, selector = ".cover-review") => {
    await send("DOM.enable");
    const documentNode = await send("DOM.getDocument");
    const found = await send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector });
    assert.ok(found.nodeId, `missing screenshot target ${selector}`);
    await send("DOM.scrollIntoViewIfNeeded", { nodeId: found.nodeId });
    await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'start'});for(let p=e.parentElement;p;p=p.parentElement){if(p.scrollHeight>p.clientHeight){const top=e.getBoundingClientRect().top;p.scrollTop=Math.max(0,p.scrollTop+top-48);}}})()`); await pause(100);
    const metrics = await send("Page.getLayoutMetrics");
    const rect = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight}})()`);
    const visible = { x: rect.x, y: rect.y, width: Math.min(rect.width, rect.viewportWidth - rect.x), height: Math.min(rect.height, rect.viewportHeight - rect.y) };
    const clip = { x: visible.x + metrics.visualViewport.pageX, y: visible.y + metrics.visualViewport.pageY, width: visible.width, height: visible.height, scale: 1 };
    assert.ok(visible.width > 0 && visible.height > 0 && visible.x >= 0 && visible.y >= 0 && visible.x + visible.width <= rect.viewportWidth && visible.y + visible.height <= rect.viewportHeight && metrics.contentSize.width >= clip.width, `invalid screenshot target ${selector}: ${JSON.stringify({ clip, rect, metrics: metrics.contentSize })}`);
    assert.match(await evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ""`), /半自动覆盖审阅/);
    const image = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    await writeFile(path.join(validation, `${name}.png`), Buffer.from(image.data, "base64"));
  };
  await wait("Boolean(window.jianji)");
  await evaluate(`window.jianji.saveConnection({name:'fixture',baseUrl:'http://127.0.0.1:${port}/v1',model:'fixture',apiKey:'fixture-key'})`);
  let state = await evaluate("window.jianji.getState()"); const connection = state.connections.profiles.find((item) => item.name === "fixture");
  await evaluate(`window.jianji.selectConnection(${JSON.stringify(connection.id)}).then(()=>window.jianji.selectVisionConnection({connectionId:${JSON.stringify(connection.id)},model:'fixture'}))`);
  await evaluate("window.jianji.selectAndProbe()"); await evaluate("window.jianji.selectOutputDirectory()");
  state = await evaluate("window.jianji.getState()"); const media = state.project.mediaItems[0];
  await evaluate(`window.jianji.saveProject('assisted fixture')`);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('规则模板'))?.click()"); await wait("document.body.innerText.includes('覆盖')");
  await evaluate(`window.jianji.setCoverSticker({enabled:true,trackingMode:'assisted',stickerIds:[],rectangle:{x:0.1,y:0.1,width:0.2,height:0.1}})`);
  await evaluate(`window.jianji.createCoverReview([${JSON.stringify(media.id)}])`); state = await evaluate("window.jianji.getState()"); let draft = state.project.reviewDrafts.at(-1); await evaluate("location.reload()"); await pause(500); await evaluate("window.jianji.loadProject().then(()=>window.jianji.getState())"); await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('规则模板'))?.click()"); await wait("document.body.innerText.includes('半自动覆盖审阅')"); await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('下一原帧'))?.click()"); await shot("review-draft");
  await wait("document.querySelector('.cover-review video')?.readyState >= 2");
  await evaluate("[...document.querySelectorAll('.cover-review button')].find(b=>b.textContent==='下一原帧').click()");
  await pause(300);
  const steppedTime = await evaluate("document.querySelector('.cover-review video').currentTime");
  assert.ok(steppedTime > 0, `next frame did not seek: ${steppedTime}`);
  await evaluate("(()=>{const s=document.querySelector('.cover-review input[type=range]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,'600');s.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await pause(300);
  assert.ok(Math.abs(await evaluate("document.querySelector('.cover-review video').currentTime") - 0.6) < 0.01, "timeline did not seek to 600ms");
  await evaluate("[...document.querySelectorAll('.cover-review button')].find(b=>b.textContent==='上一原帧').click()");
  await pause(300);
  const previousTime = await evaluate("document.querySelector('.cover-review video').currentTime");
  assert.ok(previousTime > 0.5 && previousTime < 0.6, `previous frame did not seek: ${previousTime}`);
  await evaluate(`window.jianji.analyzeCoverReview(${JSON.stringify(draft.id)},${draft.revision})`); state = await evaluate("window.jianji.getState()"); draft = state.project.reviewDrafts.at(-1); assert.equal(draft.media[0].analysis, "incomplete");
  await evaluate(`document.querySelector('.cover-review input[type="checkbox"]')?.click()`); await wait("Boolean(document.querySelector('.cover-review select[aria-label=\"复核连接\"]'))");
  await evaluate(`(()=>{const select=document.querySelector('.cover-review select[aria-label="复核连接"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,${JSON.stringify(connection.id)});select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait("[...document.querySelectorAll('.cover-review button')].some(b=>b.textContent.includes('运行一轮复核')&&!b.disabled)");
  await evaluate("[...document.querySelectorAll('.cover-review button')].find(b=>b.textContent.includes('运行一轮复核'))?.click()"); await wait("window.jianji.getState().then(s=>s.project.reviewDrafts.at(-1)?.review?.status==='complete')"); state = await evaluate("window.jianji.getState()"); draft = state.project.reviewDrafts.at(-1); assert.equal(draft.review.usedRequests, 2); assert.equal(reviewRequests, 2);
  const identity = { id: randomUUID(), label: "manual", semantics: "unknown", origin: "human" }, segment = { id: randomUUID(), identityId: identity.id, origin: "human", track: { startMs: 0, endMs: 500, keyframes: [{ timeMs: 0, rectangle: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 } }] } };
  await evaluate(`window.jianji.editCoverReview(${JSON.stringify({ type:"put_segment", projectId: draft.projectId, draftId:draft.id, expectedRevision:draft.revision, mediaId:media.id, identity, segment })})`); state = await evaluate("window.jianji.getState()"); draft = state.project.reviewDrafts.at(-1);
  for (const issue of draft.media[0].issues) { await evaluate(`window.jianji.editCoverReview(${JSON.stringify({ type:"resolve_issue", projectId:draft.projectId,draftId:draft.id,expectedRevision:draft.revision,mediaId:media.id,issueId:issue.id,action:"correct" })})`); state = await evaluate("window.jianji.getState()"); draft = state.project.reviewDrafts.at(-1); }
  await evaluate(`window.jianji.editCoverReview(${JSON.stringify({ type:"confirm_geometry", projectId:draft.projectId,draftId:draft.id,expectedRevision:draft.revision,mediaId:media.id })})`); state = await evaluate("window.jianji.getState()"); draft = state.project.reviewDrafts.at(-1); await shot("review-manual-edit");
  const input = { ruleId:"clean", brief:"", mediaIds:[media.id], outputDirectory:output, decorations:{mode:"manual",productPrice:"测试",sticker:"none",fontFamily:"Noto Sans CJK SC"}, multiplier:2 };
  await evaluate(`window.jianji.prepareCoverReview(${JSON.stringify(draft.id)},${draft.revision},${JSON.stringify(input)})`); state = await evaluate("window.jianji.getState()"); draft = state.project.reviewDrafts.at(-1); assert.equal(draft.frozen.length, 2);
  for (const frozen of draft.frozen) await evaluate(`window.jianji.viewCoverReview(${JSON.stringify(draft.id)},${draft.revision},${JSON.stringify(frozen.mediaId)},${frozen.version})`);
  await evaluate("location.reload()"); await pause(500); await evaluate("window.jianji.loadProject().then(()=>window.jianji.getState())"); await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('规则模板'))?.click()"); await wait("Boolean(document.querySelector('.cover-review video'))");
  for (const frozen of draft.frozen) { await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('第 ${frozen.version} 版动态预览'))?.click()`); await evaluate(`new Promise((resolve,reject)=>{const v=document.querySelector('.cover-review video');if(!v)return reject(new Error('preview video unavailable'));v.oncanplay=()=>{v.play().then(()=>{v.pause();resolve()}).catch(reject)};v.onerror=()=>reject(new Error('preview video failed'));v.load()})`);
    await evaluate("(()=>{const v=document.querySelector('.cover-review video');v.pause();v.currentTime=0.6;})()");
    await wait("Math.abs(document.querySelector('.cover-review video').currentTime-0.6)<0.01 && !document.querySelector('.cover-review video').seeking");
    const partial = await evaluate("(async()=>{const r=await fetch(document.querySelector('.cover-review video').src,{headers:{Range:'bytes=0-99'}});return {status:r.status,length:r.headers.get('content-length'),range:r.headers.get('content-range'),bytes:(await r.arrayBuffer()).byteLength}})()");
    assert.equal(partial.status, 206); assert.equal(partial.length, "100"); assert.equal(partial.bytes, 100); assert.match(partial.range, /^bytes 0-99\//);
  }
  state = await evaluate("window.jianji.getState()"); assert.equal(state.queue.batches.length, 0); await evaluate(`window.jianji.approveCoverReview(${JSON.stringify(draft.id)},${draft.revision},${JSON.stringify(input)})`); state = await evaluate("window.jianji.getState()"); const batches = state.queue.batches.length; await evaluate(`window.jianji.approveCoverReview(${JSON.stringify(draft.id)},${draft.revision},${JSON.stringify(input)})`); assert.equal((await evaluate("window.jianji.getState()")).queue.batches.length, batches);
  await wait("window.jianji.getState().then(s=>s.queue.batches.length>0&&s.queue.batches.every(b=>b.batch.tasks.every(t=>t.status==='completed')))"); state = await evaluate("window.jianji.getState()");
  const tasks = state.queue.batches.flatMap((batch) => batch.batch.tasks), frozenTemplates = state.project.reviewDrafts.at(-1).frozen.map((item) => item.templateDigest);
  for (const task of tasks) { const probe = JSON.parse(execFileSync("ffprobe", ["-v","error","-show_format","-show_streams","-of","json",task.outputPath], { encoding:"utf8" })); assert.ok(Number(probe.format.duration) > 0); assert.ok(probe.streams.some((stream) => stream.codec_type === "audio")); }
  const requestsBeforeRetry = totalRequests;
  await unlink(tasks[0].outputPath); await evaluate("location.reload()"); await pause(500); await wait("Boolean(window.jianji)"); await evaluate("window.jianji.loadProject()");
  await wait("window.jianji.getState().then(s=>s.queue.batches.flatMap(b=>b.batch.tasks).some(t=>t.status==='failed'&&t.errorCode==='artifact_missing'))"); state = await evaluate("window.jianji.getState()");
  assert.deepEqual(state.project.reviewDrafts.at(-1).frozen.map((item) => item.templateDigest), frozenTemplates);
  const failed = state.queue.batches.flatMap((batch) => batch.batch.tasks).find((task) => task.status === "failed" && task.errorCode === "artifact_missing"); await evaluate(`window.jianji.retryExport([${JSON.stringify(failed.id)}])`);
  await wait(`window.jianji.getState().then(s=>s.queue.batches.flatMap(b=>b.batch.tasks).find(t=>t.id===${JSON.stringify(failed.id)})?.status==='completed')`); state = await evaluate("window.jianji.getState()");
  const retryRequestsDelta = totalRequests - requestsBeforeRetry; assert.equal(retryRequestsDelta, 0); assert.ok(visionRequests > 0 && reviewRequests === 2 && creativeRequests > 0);
  for (const task of state.queue.batches.flatMap((batch) => batch.batch.tasks)) { const probe = JSON.parse(execFileSync("ffprobe", ["-v","error","-show_format","-show_streams","-of","json",task.outputPath], { encoding:"utf8" })); assert.ok(Number(probe.format.duration) > 0); assert.ok(probe.streams.some((stream) => stream.codec_type === "audio")); } await shot("approved-output");
  const report = { result:"PASS", validation, outputs: state.queue.batches.flatMap((batch) => batch.batch.tasks.map((task) => task.outputPath)), totalRequests, visionRequests, reviewRequests, creativeRequests, retryRequestsDelta, frozenVersions: draft.frozen.length, taskCount: state.queue.batches.flatMap((batch) => batch.batch.tasks).length }; await writeFile(path.join(validation, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); console.log(JSON.stringify(report, null, 2));
} finally { socket?.close(); child.kill("SIGKILL"); fixture.closeAllConnections(); await new Promise((resolve) => fixture.close(resolve)); }
