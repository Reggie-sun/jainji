import os from "node:os";
import path from "node:path";
import { RemoteWorker, serveRemoteWorker } from "./main/qianchuan-remote-worker.js";

const args = process.argv.slice(2);
process.umask(0o077); process.env.DISPLAY ||= ":99";
const work = args.length === 0 ? serveRemoteWorker() : args.length === 2 && args[0] === "--desktop-focus" && /^[1-9][0-9]{0,19}$/.test(args[1])
  ? new RemoteWorker(path.join(os.homedir(), ".local/share/jianji-remote/state")).focusDesktop(args[1]) : Promise.reject(new Error("Invalid worker arguments"));
void work.catch(() => { if (!args.length) process.stdout.write('{"ok":false}\n'); process.exitCode = 1; });
