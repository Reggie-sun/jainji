import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = process.env.JIANJI_SMOKE_APP_ROOT || root;
const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), "jianji-random-mode-smoke-"));
const source = path.join(directory, "offline-source.mp4");
const projectFile = path.join(directory, "project.json");
const output = path.join(directory, "output");
const failureMarker = path.join(directory, "fail-workspace-save");
const ffmpeg = process.env.JIANJI_FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.JIANJI_FFPROBE_PATH || "ffprobe";
let modelRequests = 0;
const server = createServer((_request, response) => {
  modelRequests++;
  response.writeHead(500).end("Model requests are forbidden in this smoke.");
});
let electron;
let processLog = "";
const report = { status: "running", checks: [], modelRequests: 0 };
try {
  await mkdir(output);
  await mkdir(path.join(directory, "home"));
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=10", "-t", "1", "-c:v", "libx264", source]);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const bootstrap = path.join(directory, "bootstrap.cjs");
  await writeFile(bootstrap, `
if (process.type === "browser") {
  const { app, dialog, shell } = require("electron");
  const fs = require("node:fs");
  const files = require("node:fs/promises");
  process.chdir(${JSON.stringify(directory)});
  app.setPath("userData", ${JSON.stringify(path.join(directory, "userData"))});
  app.setPath("documents", ${JSON.stringify(directory)});
  app.getAppPath = () => ${JSON.stringify(appRoot)};
  process.resourcesPath = ${JSON.stringify(path.join(root, "resources"))};
  const write = files.writeFile;
  files.writeFile = async (file, ...args) => {
    if (String(file).startsWith(${JSON.stringify(`${projectFile}.tmp-`)}) && fs.existsSync(${JSON.stringify(failureMarker)})) throw new Error("fixture workspace save failure");
    return write(file, ...args);
  };
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, ...args) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    if (url.hostname !== "127.0.0.1") throw new Error("External network forbidden in smoke");
    return fetch(input, ...args);
  };
  dialog.showOpenDialog = async (_window, options = {}) => ({ canceled: false, filePaths: [options.properties?.includes("openDirectory") ? ${JSON.stringify(output)} : ${JSON.stringify(source)}] });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(projectFile)} });
  dialog.showMessageBox = async () => ({ response: 1 });
  shell.openExternal = async () => undefined;
  require(${JSON.stringify(path.join(appRoot, "dist-electron/main.cjs"))});
}
`);
  const environment = { ...process.env, HOME: path.join(directory, "home"), XDG_CONFIG_HOME: path.join(directory, "home", ".config"), JIANJI_FFMPEG_PATH: ffmpeg, JIANJI_FFPROBE_PATH: ffprobe };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.JIANJI_DEV_SERVER_URL;
  electron = await require("playwright-core")._electron.launch({ executablePath: require("electron"), args: [bootstrap], cwd: root, env: environment, timeout: 30000 });
  electron.process().stderr.on("data", chunk => { processLog += chunk.toString(); });
  electron.process().stdout.on("data", chunk => { processLog += chunk.toString(); });
  const page = await electron.firstWindow();
  const waitForState = async (predicate, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => window.jianji.getState());
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Timed out waiting for desktop state");
  };
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.getByRole("button", { name: "选择本地素材" }).click();
  await page.locator(".media-list").getByText("offline-source.mp4", { exact: true }).waitFor();
  await page.getByRole("button", { name: "下一步，设置制作规则" }).click();
  await page.locator("#product-price").fill("手动文字");
  await waitForState(state => state.project.template.productPriceDraft === "手动文字");
  await page.getByRole("button", { name: "保存项目", exact: true }).last().click();
  await waitForState(state => !state.project.hasUnsavedChanges);
  const randomButton = () => page.getByRole("button", { name: "本地随机", exact: true });
  for (const configured of [false, true]) {
    if (configured) await page.evaluate(async baseUrl => {
      const saved = await window.jianji.saveConnection({ name: "offline fixture", baseUrl, apiKey: "fixture", model: "fixture", protocol: "chat-completions" });
      const profile = saved.connections.profiles.find(profile => profile.name === "offline fixture");
      await window.jianji.selectConnection(profile.id);
    }, baseUrl);
    assert.equal((await page.evaluate(() => window.jianji.getState())).connection.configured, configured);
    await randomButton().click();
    await waitForState(state => state.project.workspaceDraft?.decorations.mode === "random");
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.includes("本地制作，制作 1 条成片") && !button.disabled));
    assert.equal(JSON.parse(await readFile(projectFile, "utf8")).workspaceDraft.decorations.mode, "random");
    await page.reload();
    await randomButton().waitFor();
    assert.equal(await randomButton().getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByRole("button", { name: "自动生成提示词", exact: true }).isDisabled(), true);
    await page.locator("#production-count").fill("1");
    await page.locator(".directory-picker").click();
    await page.getByRole("button", { name: "本地制作，制作 1 条成片", exact: true }).click();
    const state = await waitForState(state => {
      const tasks = state.agentRun?.items.flatMap(item => item.taskId ? [item.taskId] : []) ?? [];
      if (state.agentRun?.items.some(item => item.status === "failed")) throw new Error(JSON.stringify(state.agentRun));
      return tasks.length === 1 && state.queue.batches.flatMap(({ batch }) => batch.tasks).some(task => tasks.includes(task.id) && task.status === "completed");
    }, 120000);
    assert.equal(state.agentRun.usesModel, false);
    assert.equal(state.project.latestProduction.usesModel, false);
    assert.equal(modelRequests, 0);
    report.checks.push({ configured, modeAfterReload: "random", usesModel: false, export: "completed", modelRequests });
    await page.reload();
    await randomButton().waitFor();
  }
  await writeFile(failureMarker, "fixture");
  await page.getByRole("button", { name: "全部交给 Agent", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "fixture workspace save failure" }).waitFor();
  const beforeRun = await page.evaluate(async () => (await window.jianji.getState()).agentRun.id);
  await page.getByRole("button", { name: "交给 Agent，制作 1 条成片", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "fixture workspace save failure" }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.includes("交给 Agent，制作 1 条成片") && !button.disabled));
  assert.equal(await page.evaluate(async () => (await window.jianji.getState()).agentRun.id), beforeRun);
  assert.equal(modelRequests, 0);
  await unlink(failureMarker);
  await randomButton().click();
  await waitForState(state => state.project.workspaceDraft.decorations.mode === "random");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.includes("本地制作，制作 1 条成片") && !button.disabled));
  assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  report.checks.push({ workspaceSaveFailureBlocksProduction: true, pageErrors });
  await page.screenshot({ path: path.join(directory, "random-mode.png") });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.stack : String(error);
  report.processLog = processLog;
  throw error;
} finally {
  report.modelRequests = modelRequests;
  if (electron) await electron.close();
  await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, directory }, null, 2));
}
