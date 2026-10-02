import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { runningChromeBrowsers, type RunningChromeBrowser } from "./qianchuan-browser-discovery.js";

const changed = "账号浏览器进程身份已变化，未继续关闭或重启。";
const execute = promisify(execFile);
// pidfd pins the process instance before /proc validation; never fall back to numeric-PID kill.
const exitScript = String.raw`
import json, os, re, signal, sys
target = json.loads(sys.argv[1])
if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
    sys.exit(43)
fd = os.pidfd_open(target["processId"])
try:
    root = "/proc/" + str(target["processId"])
    if os.stat(root).st_uid != os.getuid():
        sys.exit(42)
    executable = os.path.basename(os.readlink(root + "/exe")).removesuffix(" (deleted)")
    if executable not in ("chrome", "chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        sys.exit(42)
    with open(root + "/cmdline", "rb") as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        sys.exit(42)
    args = [value for value in raw.decode().split("\0") if value]
    if len(args) == 1:
        args = [part for value in re.split(r" (?=--)", args[0]) for part in (value.split(" ") if value.startswith("--") and "=" not in value else [value])]
    if any(value == "--type" or value.startswith("--type=") for value in args):
        sys.exit(42)
    def flag(name):
        values = [args[index + 1] if index + 1 < len(args) else "" for index, value in enumerate(args) if value == name]
        values += [value[len(name) + 1:] for value in args if value.startswith(name + "=")]
        if len(values) > 1:
            sys.exit(42)
        return values[0] if values else None
    if any(flag(name) != target.get(key) for name, key in (("--user-data-dir", "profile"), ("--profile-directory", "profileDirectory"), ("--class", "windowClass"))):
        sys.exit(42)
    with open(root + "/stat") as stream:
        stat = stream.read(4097)
    if len(stat) > 4096 or stat[stat.rfind(")") + 2:].split()[19] != target["startedAt"]:
        sys.exit(42)
    signal.pidfd_send_signal(fd, signal.SIGTERM)
finally:
    os.close(fd)
`;
async function signalChromeInstance(browser: RunningChromeBrowser): Promise<void> {
  try { await execute("/usr/bin/python3", ["-I", "-c", exitScript, JSON.stringify(browser)], { timeout: 3000, maxBuffer: 4096 }); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || Number(code) === 43) throw new Error("当前系统缺少安全关闭账号浏览器所需的 Python 3.9 / pidfd 支持，未关闭浏览器。");
    throw new Error(changed);
  }
}
/** A normal exit request only; never force-kill, retry signals or touch Chrome's locks. */
export async function shutdownAccountChrome(browser: RunningChromeBrowser, browsers = runningChromeBrowsers, options: {
  signal?: (browser: RunningChromeBrowser) => void | Promise<void>;
  timeoutMs?: number;
} = {}): Promise<void> {
  if (!browser.processId || browser.processId <= 1 || !browser.startedAt || !browser.profile) throw new Error(changed);
  const matches = (await browsers()).filter(value => value.profile === browser.profile);
  if (matches.length !== 1 || matches[0].processId !== browser.processId || matches[0].startedAt !== browser.startedAt || matches[0].profileDirectory !== browser.profileDirectory || matches[0].windowClass !== browser.windowClass) throw new Error(changed);
  await (options.signal ?? signalChromeInstance)(browser);
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  do {
    const remaining = (await browsers()).filter(value => value.profile === browser.profile || value.processId === browser.processId);
    if (!remaining.length) return;
    if (remaining.some(value => value.processId !== browser.processId || value.startedAt !== browser.startedAt)) throw new Error(changed);
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error("账号浏览器未正常退出，已停止操作；不会强制关闭或另开窗口。");
}
