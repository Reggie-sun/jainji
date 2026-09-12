import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run the development launcher through npm run dev.");
const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronCli = path.join(root, "node_modules", "electron", "cli.js");
const children = [];

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
  children.push(child);
  return child;
}

function waitForExit(child) {
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

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    for (const child of children) child.kill(signal);
    process.exitCode = 1;
  });
}

const build = start(process.execPath, [npmCli, "run", "build"]);
if (await waitForExit(build) !== 0) process.exit(1);

const port = await reservePort();
const devServerUrl = `http://127.0.0.1:${port}`;
const vite = start(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(port), "--strictPort"]);
try {
  await waitForVite(vite, devServerUrl);
  const electron = start(process.execPath, [electronCli, "."], { env: { ...process.env, JIANJI_DEV_SERVER_URL: devServerUrl } });
  process.exitCode = await waitForExit(electron);
} finally {
  if (vite.exitCode === null) vite.kill("SIGTERM");
}
