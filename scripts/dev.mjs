import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";
import { requestDevelopmentQuit, waitForDevelopmentQuit } from "./dev-lifecycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run the development launcher through npm run dev.");
const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronBinary = require("electron");
const children = new Set();
const buildContexts = [];
let electron;
let restartTimer;
let restartRequested = false;
let stopping = false;
let shutdownPromise;

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode ?? 1);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not reserve a local development port."));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForVite(child, serverUrl) {
  let startupError;
  let exitCode;
  child.once("error", (error) => { startupError = error; });
  child.once("exit", (code) => { exitCode = code ?? 1; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (startupError) throw new Error(`Vite failed to start: ${startupError.message}`);
    if (exitCode !== undefined) throw new Error(`Vite exited before becoming ready (code ${exitCode}).`);
    try {
      const response = await fetch(serverUrl);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not start at ${serverUrl} within 30 seconds`);
}

function scheduleElectronRestart(bundle) {
  if (stopping) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (stopping) return;
    restartRequested = true;
    console.log(`[dev] ${bundle} rebuilt; requesting normal Electron exit. Save or cancel in the app if prompted.`);
    try { requestDevelopmentQuit(electron); }
    catch (error) { restartRequested = false; console.error(`[dev] ${error.message}`); }
  }, 100);
}

function reloadPlugin(bundle) {
  let initial = true;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  return {
    ready,
    plugin: {
      name: `jianji-${bundle}-reload`,
      setup(build) {
        build.onEnd((result) => {
          if (initial) {
            initial = false;
            if (result.errors.length === 0) resolveReady();
            else rejectReady(new Error(`${bundle} failed to build.`));
          } else if (result.errors.length === 0) {
            scheduleElectronRestart(bundle);
          }
        });
      },
    },
  };
}

async function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  clearTimeout(restartTimer);
  if (signal) process.exitCode = signal === "SIGINT" ? 130 : 143;
  shutdownPromise = (async () => {
    if (electron?.exitCode === null && electron.signalCode === null) {
      console.log("[dev] Waiting for normal Electron shutdown; no forced-quit timeout.");
      await waitForDevelopmentQuit(electron);
    }
    const remaining = [...children].filter(child => child !== electron);
    for (const child of remaining) if (child.exitCode === null) child.kill("SIGTERM");
    setTimeout(() => {
      for (const child of remaining) {
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    }, 1_000).unref();
    await Promise.all(buildContexts.map((buildContext) => buildContext.dispose()));
  })();
  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void shutdown(signal).catch(error => console.error(`[dev] ${error.message}`)); });

const port = await reservePort();
const devServerUrl = `http://127.0.0.1:${port}`;
const mainReload = reloadPlugin("main process");
const preloadReload = reloadPlugin("preload");
const mainContext = await context({
  entryPoints: [path.join(root, "src/main/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "sql.js/*"],
  outfile: path.join(root, "dist-electron/main.cjs"),
  plugins: [mainReload.plugin],
});
const preloadContext = await context({
  entryPoints: [path.join(root, "src/main/preload.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: path.join(root, "dist-electron/preload.cjs"),
  plugins: [preloadReload.plugin],
});
buildContexts.push(mainContext, preloadContext);

let vite;
try {
  await Promise.all([mainContext.watch(), preloadContext.watch(), mainReload.ready, preloadReload.ready]);
  vite = start(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(port), "--strictPort"]);
  await waitForVite(vite, devServerUrl);
  while (!stopping) {
    // A terminal Ctrl+C must reach the launcher, not kill Electron before cleanup.
    electron = start(electronBinary, ["."], { stdio: ["inherit", "inherit", "inherit", "ipc"], detached: process.platform !== "win32",
      env: { ...process.env, JIANJI_DEV_SERVER_URL: devServerUrl } });
    const exitCode = await waitForExit(electron);
    if (stopping) break;
    if (restartRequested) {
      restartRequested = false;
      continue;
    }
    process.exitCode = exitCode;
    break;
  }
} finally {
  await shutdown();
}
