import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const time = process.argv[2]?.match(/^--time=(([01]\d|2[0-3]):[0-5]\d)$/)?.[1];
if (!time || process.argv.length !== 3) throw new Error("Invalid scheduled launch time.");
const require = createRequire(import.meta.url);
const electron = require("electron");
const flag = `--jianji-scheduled-clear=${time}`;
const timestamp = `--jianji-scheduled-at=${new Date().toISOString()}`;
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let child;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { child?.kill(signal); });
function run(executable, args) {
  return new Promise((resolve, reject) => {
    child = spawn(executable, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject); child.once("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
}
// A probe only forwards to a live instance; without one it exits before bootstrap.
const probe = await run(electron, [".", flag, timestamp, "--jianji-schedule-probe"]);
if (probe === 75) process.exitCode = await run(process.execPath, [path.join(root, "scripts", "dev.mjs"), flag, timestamp]);
else process.exitCode = probe;
