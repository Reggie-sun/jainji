import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { FEEDBACK_ENDPOINT } from "../shared/bug-feedback.js";
import { createFeedbackServer } from "./service.js";

const execFileAsync = promisify(execFile);

export async function feedbackToken(): Promise<string> {
  if (process.env.JIANJI_GITHUB_TOKEN?.trim()) return process.env.JIANJI_GITHUB_TOKEN.trim();
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token", "--hostname", "github.com"], { timeout: 5_000, windowsHide: true, maxBuffer: 2048 });
    return stdout.trim();
  } catch { return ""; }
}

export async function startFeedbackServer(): Promise<void> {
  const token = await feedbackToken();
  if (!token) throw new Error("反馈中继未配置。");
  const port = Number(process.env.JIANJI_FEEDBACK_PORT ?? "18181");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("JIANJI_FEEDBACK_PORT is invalid.");
  const directory = process.env.JIANJI_FEEDBACK_DATA_DIR ?? path.join(homedir(), ".local", "share", "jianji-feedback");
  const publicUrl = process.env.JIANJI_FEEDBACK_PUBLIC_URL ?? FEEDBACK_ENDPOINT;
  const server = createFeedbackServer({ directory, token, publicUrl, trustCloudflare: true });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const stop = () => {
    const timeout = setTimeout(() => process.exit(0), 5_000);
    timeout.unref();
    server.close(() => { clearTimeout(timeout); process.exit(0); });
  };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startFeedbackServer().catch(() => { process.exitCode = 1; });
}
