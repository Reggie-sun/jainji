import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createServer } from "vite";
import { _electron } from "playwright-core";

if (process.platform === "linux" && !process.env.JIANJI_SMOKE_DISPLAY_READY) {
  const child = spawnSync("xvfb-run", ["-a", process.execPath, fileURLToPath(import.meta.url)], {
    stdio: "inherit", env: { ...process.env, JIANJI_SMOKE_DISPLAY_READY: "1" },
  });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

const execute = promisify(execFile);
const root = process.cwd();
const directory = await mkdtemp(path.join(os.tmpdir(), "jianji-multi-instance-smoke-"));
const fixture = path.join(directory, "app"), userData = path.join(directory, "profile");
await mkdir(path.join(fixture, "resources"), { recursive: true });
await mkdir(path.join(fixture, "dist-electron"));
await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
await writeFile(path.join(fixture, "package.json"), JSON.stringify({ name: "jianji", version: "0.1.6", main: "dist-electron/main.cjs" }));
for (const entry of await readdir(path.join(root, "resources"))) {
  // No production account configuration or authentication is used by this fixture.
  if (entry === "membership.json") continue;
  await symlink(path.join(root, "resources", entry), path.join(fixture, "resources", entry));
}
await build({ entryPoints: ["src/main/index.ts"], bundle: true, platform: "node", format: "cjs",
  external: ["electron", "playwright-core", "sql.js/*"], outfile: path.join(fixture, "dist-electron/main.cjs") });
await build({ entryPoints: ["src/main/preload.ts"], bundle: true, platform: "node", format: "cjs",
  external: ["electron"], outfile: path.join(fixture, "dist-electron/preload.cjs") });
const media = path.join(directory, "fixture.mp4");
await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x240:r=10:d=1", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", media]);
const server = await createServer({ root, cacheDir: path.join(directory, "vite-cache"), server: { host: "127.0.0.1", port: 0, strictPort: false } });
await server.listen();
const serverUrl = server.resolvedUrls.local[0];
const require = createRequire(import.meta.url);
const env = { ...process.env, JIANJI_DEV_SERVER_URL: serverUrl };
delete env.ELECTRON_RUN_AS_NODE; delete env.JIANJI_MEMBERSHIP_CONFIG; delete env.JIANJI_DEV_USER_DATA; delete env.JIANJI_DEV_REUSE_PRIMARY;
const applications = new Set();
async function launch(directoryOverride) {
  const application = await _electron.launch({ executablePath: require("electron"), args: [fixture, `--user-data-dir=${userData}`],
    env: { ...env, ...(directoryOverride ? { JIANJI_DEV_USER_DATA: directoryOverride } : {}) }, timeout: 60_000 });
  applications.add(application);
  // All dialogs belong to disposable fixtures; failures must not strand a save prompt.
  await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  const page = await application.firstWindow();
  await page.waitForFunction(() => !!window.jianji, { timeout: 60_000 });
  const state = await page.evaluate(() => window.jianji.getState());
  const actualDirectory = await application.evaluate(({ app }) => app.getPath("userData"));
  return { application, page, state, directory: actualDirectory };
}
async function close(instance) {
  await instance.application.close(); applications.delete(instance.application);
}
try {
  const first = await launch();
  const second = await launch();
  assert.equal(first.directory, userData);
  assert.equal(second.directory, path.join(userData, "instances", "1"));
  assert.notEqual(first.state.project.id, second.state.project.id);
  for (const [instance, name] of [[first, "独立窗口A"], [second, "独立窗口B"]]) {
    await instance.application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, path.join(directory, `${name}.json`));
    await instance.page.evaluate(async ({ media, name }) => {
      await window.jianji.addAndProbe([media]);
      await window.jianji.saveProject(name);
    }, { media, name });
  }
  assert.equal((await first.page.evaluate(() => window.jianji.getState())).project.name, "独立窗口A");
  assert.equal((await second.page.evaluate(() => window.jianji.getState())).project.name, "独立窗口B");
  const beforeReuse = await readdir(path.join(userData, "instances"));
  await first.application.evaluate(({ app }) => {
    globalThis.jianjiReuseRequests = 0;
    app.on("second-instance", () => { globalThis.jianjiReuseRequests++; });
  });
  await execute(require("electron"), [fixture, `--user-data-dir=${userData}`], {
    env: { ...env, JIANJI_DEV_REUSE_PRIMARY: "1" }, timeout: 30_000,
  });
  assert.equal(await first.application.evaluate(() => globalThis.jianjiReuseRequests), 1);
  assert.deepEqual(await readdir(path.join(userData, "instances")), beforeReuse);
  assert.equal((await first.page.evaluate(() => window.jianji.getState())).project.name, "独立窗口A");
  assert.equal((await second.page.evaluate(() => window.jianji.getState())).project.name, "独立窗口B");
  await close(first);
  await assert.rejects(access(path.join(userData, "source-sticker-knowledge", "owner.lock")));
  assert.equal((await second.page.evaluate(() => window.jianji.getState())).project.name, "独立窗口B");
  await second.page.screenshot({ path: path.join(directory, "second-still-running.png") });
  await close(second);
  const restarted = await launch(second.directory);
  assert.equal(restarted.directory, second.directory);
  assert.equal(await restarted.application.evaluate(({ app }) => app.getPath("sessionData")), second.directory);
  const restored = await restarted.page.evaluate(async () => {
    const state = await window.jianji.getState();
    const entry = state.recentProjects.find(project => project.name === "独立窗口B");
    if (!entry) throw new Error("Independent profile was not retained.");
    return window.jianji.loadProject(entry.id);
  });
  assert.equal(restored.project.name, "独立窗口B");
  assert.equal(restored.project.mediaItems[0].probeStatus, "ready");
  assert.equal(restored.recentProjects.some(project => project.name === "独立窗口A"), false);
  const report = { result: "PASS", directory, primaryDirectoryRetained: true, separateProjectIds: true,
    independentEditing: true, closingFirstKeepsSecond: true, gracefulLockRelease: true, restartProfilePinned: true,
    independentHistoryRetained: true, primaryReusePreservesWorkspace: true, primaryReuseCreatesNoProfile: true,
    realAccounts: false, modelRequests: 0, uploads: 0 };
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  for (const application of applications) await application.close().catch(() => undefined);
  await server.close();
}
