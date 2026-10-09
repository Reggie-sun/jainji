import { serveRemoteWorker } from "./main/qianchuan-remote-worker.js";
void serveRemoteWorker().catch(() => {
  process.stdout.write('{"ok":false}\n'); process.exitCode = 1;
});
