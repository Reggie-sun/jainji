import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(path.join(tmpdir(), "jianji-batch-smoke-"));
const ffmpeg = process.env.JIANJI_FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.JIANJI_FFPROBE_PATH || "ffprobe";
const products = ["蝴蝶贴", "氨糖膏"];
const sources = products.map(name => path.join(directory, name, "素材", "source.mp4"));
const report = { status: "running", checks: [], directory };
let electron;
let page;
let processLog = "";
try {
  for (const source of sources) {
    await mkdir(path.dirname(source), { recursive: true });
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=10", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "6", "-c:v", "libx264", "-c:a", "aac", source]);
  }
  const bootstrap = path.join(directory, "bootstrap.cjs");
  await writeFile(bootstrap, `
if (process.type === "browser") {
  const { app, dialog, shell } = require("electron");
  const path = require("node:path");
  app.setPath("userData", ${JSON.stringify(path.join(directory, "userData"))});
  app.setPath("documents", ${JSON.stringify(directory)});
  app.getAppPath = () => ${JSON.stringify(root)};
  process.resourcesPath = ${JSON.stringify(path.join(root, "resources"))};
  globalThis.fetch = () => { throw new Error("Network forbidden in offline batch smoke"); };
  dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: path.join(${JSON.stringify(directory)}, path.basename(options.defaultPath)) });
  dialog.showMessageBox = async () => ({ response: 0 });
  shell.openExternal = async () => undefined;
  globalThis.fixtureArtifacts = [];
  shell.openPath = async file => { globalThis.fixtureArtifacts.push({ action: "play", file }); return ""; };
  shell.showItemInFolder = file => { globalThis.fixtureArtifacts.push({ action: "folder", file }); };
  require(${JSON.stringify(path.join(root, "dist-electron/main.cjs"))});
}
`);
  const environment = { ...process.env, JIANJI_FFMPEG_PATH: ffmpeg, JIANJI_FFPROBE_PATH: ffprobe };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.JIANJI_DEV_SERVER_URL;
  electron = await require("playwright-core")._electron.launch({ executablePath: require("electron"), args: [bootstrap], cwd: directory, env: environment, timeout: 30000 });
  electron.process().stderr.on("data", chunk => { processLog += chunk.toString(); });
  page = await electron.firstWindow();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.waitForFunction(() => Boolean(window.jianji));
  const waitForState = async (predicate, timeout = 120000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => window.jianji.getState());
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Timed out waiting for batch state");
  };
  const projectFiles = [];
  for (const [index, name] of products.entries()) {
    const materialPaths = [sources[index]];
    if (index === 1) {
      const secondSource = path.join(path.dirname(sources[index]), "second.mp4");
      await copyFile(sources[index], secondSource); materialPaths.push(secondSource);
    }
    await page.evaluate(async ({ materialPaths, name }) => {
      await window.jianji.newProject();
      let state = await window.jianji.addAndProbe(materialPaths);
      state = await window.jianji.setProductPriceDraft(state.project.id, `${name}手动文字`);
      await window.jianji.setCoverSticker({ enabled: false, trackingMode: "manual", stickerIds: [],
        rectangle: { x: 0.02, y: 0.02, width: 0.12, height: 0.12 },
        regions: [{ id: crypto.randomUUID(), rectangle: { x: 0.02, y: 0.02, width: 0.12, height: 0.12 } }] });
      await window.jianji.saveProject(name, { step: "templates", selectedMediaIds: state.project.mediaItems.map(item => item.id),
        ruleId: "clean", brief: "", decorations: { mode: name === "蝴蝶贴" ? "agent" : "random", displayMode: "full" }, requestedCount: 1, exportFormat: "mp4",
        exportSettings: { resolutionMode: "720p", frameRateMode: "source", quality: "balanced" }, outputDirectoryMode: "automatic" });
    }, { name, materialPaths });
    projectFiles.push(path.join(directory, `${name}.jianji-project.json`));
  }
  const original = await Promise.all(projectFiles.map(file => readFile(file, "utf8").then(JSON.parse)));
  const countFixture = structuredClone(original[0]);
  countFixture.mediaItems = Array.from({ length: 33 }, () => ({ ...original[0].mediaItems[0], id: crypto.randomUUID() }));
  countFixture.workspaceDraft.selectedMediaIds = countFixture.mediaItems.map(item => item.id);
  await writeFile(projectFiles[0], JSON.stringify(countFixture));
  const activeId = (await page.evaluate(() => window.jianji.getState())).project.id;
  await page.reload();
  await page.getByRole("button", { name: "批量制作", exact: true }).click();
  await page.getByRole("heading", { name: "批量制作", exact: true }).waitFor();
  const row = name => page.getByRole("region", { name: `${name}制作设置`, exact: true });
  assert.equal(await row("蝴蝶贴").getByRole("button", { name: "全部交给 Agent", exact: true }).getAttribute("aria-pressed"), "true");
  await row("蝴蝶贴").getByRole("button", { name: "自己设置", exact: true }).click();
  await row("蝴蝶贴").getByRole("button", { name: "本地随机", exact: true }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[aria-label="蝴蝶贴制作设置"] button[aria-pressed="true"]')).backgroundColor === "rgb(231, 244, 239)");
  for (const name of products) {
    assert.equal(await page.getByRole("checkbox", { name: `${name}开启覆盖`, exact: true }).isChecked(), true);
    await page.getByRole("checkbox", { name: `选择模板 ${name}`, exact: true }).check();
    await row(name).getByLabel("想制作的视频条数", { exact: true }).fill("2");
  }
  await page.getByRole("checkbox", { name: "蝴蝶贴开启覆盖", exact: true }).uncheck();
  report.checks.push("cover defaults on even for saved cover-off templates; manual off survives refresh and navigation");
  await row("蝴蝶贴").getByLabel("想制作的视频条数", { exact: true }).fill("100");
  await page.getByText("已选择 2 个模板，共制作 102 条视频", { exact: true }).waitFor();
  assert.equal(await row("蝴蝶贴").locator(".batch-template-controls small, .batch-mode-select small").count(), 0);
  const controlHeights = await row("蝴蝶贴").locator('.batch-template-controls input[type="number"], .batch-template-controls textarea, .batch-template-controls select').evaluateAll(controls => controls.map(control => control.getBoundingClientRect().height));
  assert.deepEqual(controlHeights, [40, 40, 40]);
  assert.equal(await row("蝴蝶贴").evaluate(element => getComputedStyle(element).gridTemplateRows.split(" ").length), 1);
  assert.equal(await row("蝴蝶贴").getByText("自动保存到该商品的 视频/M.D HH:MM", { exact: true }).count(), 0);
  report.checks.push("33 sources / requested 100 visibly plans exactly 100");
  await writeFile(projectFiles[0], JSON.stringify(original[0]));
  await row("蝴蝶贴").getByLabel("想制作的视频条数", { exact: true }).fill("2");
  await page.getByRole("button", { name: "刷新模板", exact: true }).click();
  await row("蝴蝶贴").getByText("1 条素材", { exact: true }).waitFor();
  assert.equal(await row("蝴蝶贴").getByRole("button", { name: "本地随机", exact: true }).getAttribute("aria-pressed"), "true");
  await row("氨糖膏").getByLabel("想制作的视频条数", { exact: true }).fill("3");
  await page.getByText("已选择 2 个模板，共制作 5 条视频", { exact: true }).waitFor();
  await row("氨糖膏").getByLabel("价格显示时段").selectOption("first-5s");
  await page.getByRole("checkbox", { name: "氨糖膏开启覆盖", exact: true }).check();
  await row("蝴蝶贴").getByLabel("展示文字 / 价格").fill(" ");
  assert.equal(await page.getByRole("button", { name: "开始批量制作", exact: true }).isDisabled(), true);
  await row("蝴蝶贴").getByLabel("展示文字 / 价格").fill("本批手动价格");
  await page.screenshot({ path: path.join(directory, "batch-settings.png"), fullPage: true });
  await page.getByRole("button", { name: "开始批量制作", exact: true }).click();
  await waitForState(state => state.batchProduction?.status === "running");
  const live = await waitForState(state => state.batchProduction?.jobs.some(job => job.taskIds.length));
  const liveJob = live.batchProduction.jobs.find(job => job.taskIds.length);
  await page.getByRole("button", { name: `查看 ${liveJob.name} 作品`, exact: true }).click();
  await page.getByRole("heading", { name: `${liveJob.name} · 作品与导出`, exact: true }).waitFor();
  const liveDetails = await page.evaluate(async request => window.jianji.batchProductionDetails(request), { runId: live.batchProduction.id, jobId: liveJob.id });
  assert.ok(liveDetails.items.length > 0);
  assert.ok(liveDetails.tasks.every(task => liveDetails.items.some(item => item.taskId === task.id)));
  assert.equal((await page.evaluate(() => window.jianji.getState())).project.id, activeId);
  await page.getByRole("button", { name: "← 返回批量列表", exact: true }).click();
  await row("蝴蝶贴").getByLabel("想制作的视频条数", { exact: true }).fill("3");
  assert.equal(await row("蝴蝶贴").getByLabel("展示文字 / 价格").isEnabled(), true);
  await page.getByRole("button", { name: "制作", exact: true }).click();
  await page.getByRole("button", { name: "批量制作", exact: true }).click();
  assert.equal(await row("蝴蝶贴").getByLabel("想制作的视频条数", { exact: true }).inputValue(), "3");
  assert.equal(await row("蝴蝶贴").getByRole("button", { name: "本地随机", exact: true }).getAttribute("aria-pressed"), "true");
  const state = await waitForState(state => ["finished", "interrupted"].includes(state.batchProduction?.status));
  assert.equal(state.batchProduction.status, "finished", JSON.stringify(state.batchProduction));
  assert.deepEqual(state.batchProduction.jobs.map(job => job.status), ["completed", "completed"], JSON.stringify(state.batchProduction));
  assert.deepEqual(state.batchProduction.jobs.map(job => job.completedCount), [3, 2]);
  assert.equal(state.project.id, activeId);
  for (const job of state.batchProduction.jobs) {
    assert.equal(job.mode, "random");
    await page.getByRole("button", { name: `查看 ${job.name} 作品`, exact: true }).click();
    const works = page.getByRole("region", { name: `${job.name}作品与任务`, exact: true });
    await works.getByRole("button", { name: "播放", exact: true }).first().waitFor();
    assert.equal(await works.locator(".result-row").count(), job.requestedCount);
    await works.getByRole("button", { name: "播放", exact: true }).first().click();
    await works.getByRole("button", { name: /成片文件夹/ }).first().click();
    await page.screenshot({ path: path.join(directory, `${job.name}-works.png`), fullPage: true });
    await page.getByRole("button", { name: "← 返回批量列表", exact: true }).click();
  }
  assert.equal((await electron.evaluate(() => globalThis.fixtureArtifacts)).length, 4);
  report.checks.push("saved Agent mode explicitly overridden to local random without any network calls", "mode drafts survive refresh and navigation", "live and completed job works display only their own tasks without switching editor", "completed video play and folder actions verified with shell stubs");
  const jobsDirectory = path.join(directory, "userData", "jobs");
  const allBatches = await Promise.all((await readdir(jobsDirectory)).filter(file => file.endsWith(".json")).map(async file => JSON.parse(await readFile(path.join(jobsDirectory, file), "utf8")).batch));
  for (const job of state.batchProduction.jobs) {
    assert.equal(job.actualCount, job.requestedCount);
    assert.ok(job.outputDirectory.startsWith(path.join(directory, job.name, "视频")));
    const exports = allBatches.filter(batch => batch.tasks.some(task => job.taskIds.includes(task.id)));
    assert.equal(exports.length, job.requestedCount);
    if (job.name === "氨糖膏") assert.deepEqual(exports.map(batch => batch.tasks[0].mediaId).sort(), [original[1].mediaItems[0].id, original[1].mediaItems[0].id, original[1].mediaItems[1].id].sort());
    for (const batch of exports) {
      assert.equal(batch.templateSnapshot.productPrice, job.productPrice);
      assert.equal(batch.templateSnapshot.decorationDisplayMode, job.displayMode);
      const covers = batch.templateSnapshot.layers.filter(layer => layer.cover);
      assert.equal(covers.length > 0, job.coverEnabled);
      for (const task of batch.tasks) {
        const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", task.outputPath], { encoding: "utf8" }));
        assert.ok(Math.abs(Number(probe.format.duration) - 6) < 0.15);
        assert.ok(probe.streams.some(stream => stream.codec_type === "audio"));
      }
    }
  }
  const first = state.batchProduction.jobs[0], second = state.batchProduction.jobs[1];
  const tasks = allBatches.flatMap(batch => batch.tasks);
  const finishedFirst = Math.max(...tasks.filter(task => first.taskIds.includes(task.id)).map(task => Date.parse(task.finishedAt)));
  const startedSecond = Math.min(...tasks.filter(task => second.taskIds.includes(task.id)).map(task => Date.parse(task.startedAt)));
  assert.ok(startedSecond >= finishedFirst, "Second product started before first export was verified");
  for (const [index, file] of projectFiles.entries()) {
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(saved.workspaceDraft, original[index].workspaceDraft);
    assert.deepEqual(saved.coverSticker, original[index].coverSticker);
    assert.equal(saved.templates[0].productPriceDraft, original[index].templates[0].productPriceDraft);
  }
  report.checks.push("two products / five real FFmpeg exports, two sources request 3 yields exactly 3", "serial verified exports", "cover on/off and full/first-5s frozen independently", "editing and navigation preserve next batch settings", "active editor and original template settings preserved", "duration and audio preserved");
  await page.screenshot({ path: path.join(directory, "batch-results.png"), fullPage: true });
  // Cancel one active product through its row and verify the next product still exports.
  await row("氨糖膏").getByLabel("想制作的视频条数", { exact: true }).fill("75");
  await row("蝴蝶贴").getByLabel("想制作的视频条数", { exact: true }).fill("1");
  await page.getByRole("button", { name: "开始批量制作", exact: true }).click();
  const singleRun = await waitForState(value => value.batchProduction?.id !== state.batchProduction.id && value.batchProduction?.jobs[0].taskIds.length > 0);
  await page.getByRole("button", { name: "取消 氨糖膏 制作", exact: true }).click();
  const singleFinished = await waitForState(value => value.batchProduction?.id === singleRun.batchProduction.id && ["finished", "interrupted"].includes(value.batchProduction?.status));
  assert.equal(singleFinished.batchProduction.status, "finished", JSON.stringify(singleFinished.batchProduction));
  assert.deepEqual(singleFinished.batchProduction.jobs.map(job => job.status), ["cancelled", "completed"]);
  assert.equal(singleFinished.batchProduction.jobs[1].completedCount, 1);
  const cancelledDetail = await page.evaluate(request => window.jianji.batchProductionDetails(request), { runId: singleFinished.batchProduction.id, jobId: singleFinished.batchProduction.jobs[0].id });
  assert.ok(cancelledDetail.tasks.every(task => ["completed", "failed", "cancelled", "interrupted"].includes(task.status)));
  report.checks.push("single active product cancellation drains only its own real exports and continues next product");
  // Waiting product cancellation does not stop the active product; whole-batch stop remains available.
  await page.getByRole("button", { name: "开始批量制作", exact: true }).click();
  const queuedRun = await waitForState(value => value.batchProduction?.id !== singleRun.batchProduction.id && value.batchProduction?.jobs[0].taskIds.length > 0);
  await page.getByRole("button", { name: "取消 蝴蝶贴 制作", exact: true }).click();
  const queuedStopped = await waitForState(value => value.batchProduction?.id === queuedRun.batchProduction.id && value.batchProduction?.jobs[1].status === "cancelled");
  assert.equal(queuedStopped.batchProduction.status, "running");
  assert.equal(queuedStopped.batchProduction.jobs[1].taskIds.length, 0);
  await page.getByRole("button", { name: "停止整批", exact: true }).click();
  await waitForState(value => value.batchProduction?.status === "cancelled");
  report.checks.push("waiting product cancellation skips only that product and whole-batch stop remains usable");
  await row("氨糖膏").getByLabel("想制作的视频条数", { exact: true }).fill("3");
  await row("蝴蝶贴").getByLabel("想制作的视频条数", { exact: true }).fill("3");
  // Reuse only these isolated fixtures to exercise failure continuation through the real IPC path.
  await unlink(sources[1]);
  await page.getByRole("button", { name: "开始批量制作", exact: true }).click();
  const failureRun = await waitForState(value => value.batchProduction?.id !== state.batchProduction.id && value.batchProduction?.status === "finished");
  assert.deepEqual(failureRun.batchProduction.jobs.map(job => job.status), ["failed", "completed"], JSON.stringify(failureRun.batchProduction));
  assert.equal(failureRun.batchProduction.jobs[1].completedCount, 3);
  report.checks.push("missing first product fails and next product continues without retry");
  await page.getByRole("button", { name: "开始批量制作", exact: true }).click();
  await page.getByRole("button", { name: "停止整批", exact: true }).click();
  const stopped = await waitForState(value => value.batchProduction?.status === "cancelled");
  assert.ok(stopped.batchProduction.jobs.some(job => job.status === "cancelled"));
  report.checks.push("stop button cancels the batch and following products");
  assert.deepEqual(pageErrors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.stack : String(error);
  report.processLog = processLog;
  if (page) {
    await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).catch(() => undefined);
    report.visibleText = await page.locator("body").innerText().catch(() => "");
  }
  throw error;
} finally {
  if (electron) await electron.close();
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
