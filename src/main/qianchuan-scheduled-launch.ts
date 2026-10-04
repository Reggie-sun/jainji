import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { QianchuanLibraryScheduleSettings, QianchuanAutomaticLaunchStatus } from "../shared/qianchuan-video-library-schedule.js";

const execute = promisify(execFile);
const timer = "jianji-video-library-clear.timer";
const service = "jianji-video-library-clear.service";
const marker = "# Managed by Jianji video-library schedule v1\n";

export function scheduledClearTime(argv: string[]): string | undefined {
  const flags = argv.filter(arg => arg.startsWith("--jianji-scheduled-clear="));
  if (flags.length !== 1) return undefined;
  const time = flags[0]!.slice("--jianji-scheduled-clear=".length);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : undefined;
}
export function scheduledClearReceivedAt(argv: string[]): Date {
  const flags = argv.filter(arg => arg.startsWith("--jianji-scheduled-at="));
  if (!flags.length) return new Date();
  if (flags.length !== 1 || !/^--jianji-scheduled-at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(flags[0]!)) return new Date(NaN);
  return new Date(flags[0]!.slice("--jianji-scheduled-at=".length));
}

function unitArgument(value: string): string {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error("定时启动路径无效。");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;
}

/** Owns only OS startup wiring. The original schedule owns authorization and deletion. */
export class QianchuanScheduledLaunch {
  private state: QianchuanAutomaticLaunchStatus = { supported: process.platform === "linux", enabled: false,
    message: process.platform === "linux" ? "系统定时启动尚未启用。" : "当前系统尚未支持自动启动；请保持软件打开。" };
  constructor(private readonly application: { packaged: boolean; executable: string; root: string; node?: string }) {}
  snapshot(): QianchuanAutomaticLaunchStatus { return { ...this.state }; }

  private async installFile(directory: string, name: string, contents: string): Promise<void> {
    const file = path.join(directory, name);
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid!()) throw new Error("同名系统任务的所有权无效。");
      if (!(await readFile(file, "utf8")).startsWith(marker)) throw new Error("同名系统任务不属于简辑，未覆盖。");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temporary = path.join(directory, `${name}.${randomUUID()}.tmp`);
    try { await writeFile(temporary, contents, { flag: "wx", mode: 0o600 }); await rename(temporary, file); }
    finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
  }

  async configure(settings: QianchuanLibraryScheduleSettings): Promise<void> {
    if (!this.state.supported) return;
    const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid!()}`;
    const environment = { ...process.env, XDG_RUNTIME_DIR: runtime,
      DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtime}/bus` };
    const command = (...args: string[]) => execute("systemctl", ["--user", ...args], { env: environment, timeout: 15000, maxBuffer: 65536 });
    try {
      const directory = path.join(os.homedir(), ".config", "systemd", "user");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!()) throw new Error("系统任务目录无效。");
      const args = this.application.packaged
        ? [this.application.executable, `--jianji-scheduled-clear=${settings.time}`]
        : [this.application.node || "", path.join(this.application.root, "scripts", "qianchuan-scheduled-launch.mjs"), `--time=${settings.time}`];
      if (!args[0] || !path.isAbsolute(args[0])) throw new Error("无法确定软件启动程序，请通过 make frontend 启动后保存设置。");
      const programPath = `${path.dirname(args[0])}:/usr/local/bin:/usr/bin:/bin`;
      await this.installFile(directory, service, `${marker}[Unit]\nDescription=Jianji scheduled video library clearing\n\n[Service]\nType=simple\nWorkingDirectory=${this.application.root.replace(/%/g, "%%")}\nExecStart=${args.map(unitArgument).join(" ")}\nEnvironment=${unitArgument(`PATH=${programPath}`)}\nUnsetEnvironment=ELECTRON_RUN_AS_NODE\nRestart=no\nKillMode=process\nTimeoutStopSec=infinity\n`);
      await this.installFile(directory, timer, `${marker}[Unit]\nDescription=Start Jianji for daily video library clearing\n\n[Timer]\nOnCalendar=*-*-* ${settings.time}:00\nAccuracySec=1s\nRandomizedDelaySec=0\nPersistent=false\nWakeSystem=false\nUnit=${service}\n\n[Install]\nWantedBy=timers.target\n`);
      await command("daemon-reload");
      await command(settings.enabled ? "enable" : "disable", "--now", timer);
      if (settings.enabled) await command("restart", timer);
      this.state = { supported: true, enabled: settings.enabled, message: settings.enabled
        ? "系统已设置到时自动启动简辑。电脑需开机并登录桌面，账号 Chrome 需打开。"
        : "系统定时启动已关闭。" };
    } catch {
      this.state = { supported: true, enabled: false, message: "系统定时启动未能设置，请检查用户 systemd 服务并重新保存；保持软件打开仍可定时清空。" };
      throw new Error(this.state.message);
    }
  }
}
