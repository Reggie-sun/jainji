import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { discoverQianchuanBrowser, discoverQianchuanProfile, runningChromeBrowsers, type RunningChromeBrowser } from "./qianchuan-browser-discovery.js";
import { QianchuanBrowserBindings, verifyOriginalProfile, type QianchuanBrowserBinding } from "./qianchuan-browser-bindings.js";
import { secureUploadDirectory } from "./douyin-upload-store.js";

const browserUnavailable = "账号浏览器未能启动。请安装 Google Chrome，并检查是否已有异常的账号窗口；不要删除登录目录。";
const accountUrl = (id: string) => `https://qianchuan.jinritemai.com/uni-prom?aavid=${id}`;

type OriginalProfileOptions = Pick<QianchuanBrowserBinding, "profileDirectory" | "windowClass">;
export function accountChromeArguments(profile: string, advertiserId: string, original?: OriginalProfileOptions): string[] {
  return [`--user-data-dir=${profile}`, ...(original ? [`--profile-directory=${original.profileDirectory}`, ...(original.windowClass ? [`--class=${original.windowClass}`] : [])] : []), "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--start-maximized", accountUrl(advertiserId)];
}

async function launchChrome(profile: string, advertiserId: string, original?: OriginalProfileOptions): Promise<void> {
  for (const executable of ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
    try { await access(executable, constants.X_OK); } catch { continue; }
    const child = spawn(executable, accountChromeArguments(profile, advertiserId, original), { detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    return;
  }
  throw new Error(browserUnavailable);
}

async function browserReady(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/json/version`, { redirect: "error", signal: AbortSignal.timeout(1000) });
    await response.body?.cancel();
    return response.ok && !response.redirected;
  } catch { return false; }
}

/** Owns browser startup only. Chrome retains login data; uploads keep their original authority owner. */
export class QianchuanBrowserManager {
  private readonly pending = new Map<string, Promise<string>>();
  private readonly bindings: QianchuanBrowserBindings;
  constructor(private readonly root: string, private readonly dependencies: {
    launch?: typeof launchChrome;
    browsers?: () => Promise<RunningChromeBrowser[]>;
    startupMs?: number;
    ready?: typeof browserReady;
  } = {}) { this.bindings = new QianchuanBrowserBindings(root); }

  private profile(advertiserId: string): string {
    if (!/^[1-9][0-9]{0,19}$/.test(advertiserId)) throw new Error("无效的千川账号。");
    return path.resolve(this.root, "account-browsers", advertiserId);
  }
  private async endpoint(profile: string, original?: OriginalProfileOptions, starting = false): Promise<string | undefined> {
    const matches = (await (this.dependencies.browsers ?? runningChromeBrowsers)()).filter(browser => browser.profile === profile);
    if (matches.length > 1) throw new Error("账号浏览器连接不唯一，请检查专用窗口。");
    if (!matches.length) return undefined;
    if (!matches[0].endpoint) {
      if (starting) return undefined;
      throw new Error("已打开的原账号浏览器没有常规 CDP，请正常关闭并重新打开原窗口；不会另开登录目录。");
    }
    if (original && (matches[0].profileDirectory !== original.profileDirectory || matches[0].windowClass !== original.windowClass)) throw new Error("原账号浏览器目录或窗口身份已变化，请核查绑定。");
    if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(matches[0].endpoint) || Number(new URL(matches[0].endpoint).port) > 65535) throw new Error("请正常关闭该专用账号窗口，再从简辑打开；当前窗口不是简辑启动的连接方式。");
    return matches[0].endpoint;
  }
  private async ensure(advertiserId: string, show: boolean): Promise<string> {
    if (process.platform !== "linux" || !process.getuid) throw new Error("当前系统的账号浏览器尚未通过验证。");
    let binding = await this.bindings.get(advertiserId);
    if (!binding) {
      const originalBrowsers = (await (this.dependencies.browsers ?? runningChromeBrowsers)()).filter(browser => browser.profile && !browser.profile.startsWith(`${path.resolve(this.root)}${path.sep}`));
      const original = await discoverQianchuanProfile(advertiserId, originalBrowsers);
      if (original) {
        binding = { advertiserId, profile: original.profile!, profileDirectory: original.profileDirectory!, ...(original.windowClass ? { windowClass: original.windowClass } : {}) };
        await this.bindings.save(binding);
      } else if (originalBrowsers.some(browser => !browser.endpoint || browser.endpoint.startsWith("ws:"))) throw new Error("原账号 Chrome 尚未启用常规连接，请正常关闭并重新打开原窗口；不会另开登录目录。");
    }
    const profile = binding?.profile ?? this.profile(advertiserId);
    const original = binding ? { profileDirectory: binding.profileDirectory, ...(binding.windowClass ? { windowClass: binding.windowClass } : {}) } : undefined;
    await secureUploadDirectory(path.resolve(this.root));
    if (binding) await verifyOriginalProfile(binding);
    else { await secureUploadDirectory(path.dirname(profile)); await secureUploadDirectory(profile); }
    const launch = () => original ? (this.dependencies.launch ?? launchChrome)(profile, advertiserId, original) : (this.dependencies.launch ?? launchChrome)(profile, advertiserId);
    const existing = await this.endpoint(profile, original);
    if (existing) {
      if (show) await launch();
      return existing;
    }
    await launch();
    const deadline = Date.now() + (this.dependencies.startupMs ?? 15_000);
    do {
      const endpoint = await this.endpoint(profile, original, true);
      if (endpoint && await (this.dependencies.ready ?? browserReady)(endpoint)) return endpoint;
      await delay(100);
    } while (Date.now() < deadline);
    throw new Error(browserUnavailable);
  }
  /** Explicit user action or new-production preflight only; restore never calls this. */
  open(advertiserId: string, show = false): Promise<string> {
    this.profile(advertiserId);
    const existing = this.pending.get(advertiserId);
    if (existing) return existing;
    const pending = this.ensure(advertiserId, show).finally(() => { this.pending.delete(advertiserId); });
    this.pending.set(advertiserId, pending);
    return pending;
  }
  async prepare(advertiserId: string): Promise<string> {
    const endpoint = await this.open(advertiserId);
    try { return await discoverQianchuanBrowser(advertiserId, { endpoints: async () => [endpoint] }); }
    catch { throw new Error("请先在已绑定的账号浏览器中登录千川并打开该账户，再开始制作。"); }
  }
}
