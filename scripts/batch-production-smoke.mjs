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
        ruleId: "clean", brief: "", decorations: { mode: "random", displayMode: "full" }, requestedCount: 1, exportFormat: "mp4",
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
  for (const name of products) {
    assert.equal(await page.getByRole("checkbox", { name: `${name}开启覆盖`, exact: true }).isChecked(), true);
    await page.getByRole("checkbox", { name: `选择模板 ${name}`, exact: true }).check();
    await row(name).getByLabel("想制作的视频条数", { exact: true }).fill("2");
  }
  await page.getByRole("checkbox", { name: "蝴蝶贴开启覆盖", exact: true }).uncheck();
  report.checks.push("cover defaults on even for saved cover-off templates; manual off survives refresh and navigation");
  await row("蝴蝶贴").getByLabel("想制作的视频条数", { exact: true }).fill("100");
  await row("蝴蝶贴").getByText("实际制作 100 条（使用 33 条素材）", { exact: true }).waitFor();
  report.checks.push("33 sources / requested 100 visibly plans exactly 100");
  await writeFile(projectFiles[0], JSON.stringify(original[0]));
  await row("蝴蝶贴").getByLabel("想制作的视频条数", { exact: true }).fill("2");
  await page.getByRole("button", { name: "刷新模板", exact: true }).click();
  await row("蝴蝶贴").getByText("实际制作 2 条（使用 1 条素材）", { exact: true }).waitFor();
  await row("氨糖膏").getByLabel("想制作的视频条数", { exact: true }).fill("3");
  await row("氨糖膏").getByText("实际制作 3 条（使用 2 条素材）", { exact: true }).waitFor();
  await row("氨糖膏").getByLabel("价格显示时段").selectOption("first-5s");
  await page.getByRole("checkbox", { name: "氨糖膏开启覆盖", exact: true }).check();
  await row("蝴蝶贴").getByLabel("展示文字 / 价格").fill(" ");
  assert.equal(await page.getByRole("button", { name: "开始批量制作", exact: true }).isDisabled(), true);
  await row("蝴蝶贴").getByLabel("展示文字 / 价格").fill("本批手动价格");
  await page.screenshot({ path: path.join(directory, "batch-settings.png"), fullPage: true });
  await page.getByRole("button", { name: "开始批量制作", exact: true }).click();
  await waitForState(state => state.batchProduction?.status === "running");
  await row("蝴蝶贴").getByLabel("想制作的视频条数", { exact: true }).fill("3");
  assert.equal(await row("蝴蝶贴").getByLabel("展示文字 / 价格").isEnabled(), true);
  await page.getByRole("button", { name: "制作", exact: true }).click();
  await page.getByRole("button", { name: "批量制作", exact: true }).click();
  assert.equal(await row("蝴蝶贴").getByLabel("想制作的视频条数", { exact: true }).inputValue(), "3");
  const state = await waitForState(state => ["finished", "interrupted"].includes(state.batchProduction?.status));
  assert.equal(state.batchProduction.status, "finished", JSON.stringify(state.batchProduction));
  assert.deepEqual(state.batchProduction.jobs.map(job => job.status), ["completed", "completed"], JSON.stringify(state.batchProduction));
  assert.deepEqual(state.batchProduction.jobs.map(job => job.completedCount), [3, 2]);
  assert.equal(state.project.id, activeId);
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
