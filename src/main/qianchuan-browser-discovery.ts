import { constants } from "node:fs";
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { readChromeTargets } from "./local-cdp-transport.js";

const unavailable = "无法完整连接千川浏览器。请保持账号 Chrome 打开；若 Chrome 提示允许远程调试，请先允许后重试。";
const missing = "未找到该账户的可连接浏览器，请在已登录 Chrome 中打开对应的千川计划。";
const maxEndpoints = 16;
const portNumber = (value: string | undefined) => value && /^[1-9][0-9]{0,4}$/.test(value) && Number(value) <= 65535 ? Number(value) : undefined;
function flag(args: string[], name: string): string | undefined {
  const matches = args.flatMap((value, index) => value === name ? [args[index + 1] ?? ""] : value.startsWith(`${name}=`) ? [value.slice(name.length + 1)] : []);
  if (matches.length > 1) throw new Error(unavailable);
  return matches[0];
}
async function boundedRead(file: string, limit: number, owner?: { uid: number; privateDirectory: boolean }): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (owner) {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.uid !== owner.uid || (!owner.privateDirectory && (info.mode & 0o022) !== 0) || info.size > limit) throw new Error(unavailable);
    }
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size <= limit) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) return buffer.subarray(0, size).toString("utf8");
      size += bytesRead;
    }
    throw new Error(unavailable);
  } finally { await handle.close(); }
}

/** Read debugging metadata only from this user's running Chrome main processes. */
export interface RunningChromeBrowser { endpoint?: string; profile?: string; profileDirectory?: string; windowClass?: string; processId?: number; startedAt?: string; }
export async function runningChromeBrowsers(procRoot = "/proc", uid = process.getuid?.(), exactProfile?: string): Promise<RunningChromeBrowser[]> {
  if (process.platform !== "linux" || uid === undefined) throw new Error("当前系统暂不支持自动识别浏览器连接。");
  const pids = (await readdir(procRoot)).filter(name => /^[1-9][0-9]*$/.test(name));
  if (pids.length > 4096) throw new Error(unavailable);
  const endpoints = new Map<string, RunningChromeBrowser>();
  for (const pid of pids) {
    const directory = path.join(procRoot, pid);
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.uid !== uid) continue;
      let executable: string;
      try { executable = path.basename(await readlink(path.join(directory, "exe"))).replace(/ \(deleted\)$/, ""); }
      catch (error) {
        // Linux may deny exe metadata for unrelated non-dumpable processes owned by this user.
        if ((error as NodeJS.ErrnoException).code === "EACCES") continue;
        throw error;
      }
      if (!["chrome", "chromium", "chromium-browser", "google-chrome", "google-chrome-stable"].includes(executable)) continue;
      const rawArgs = (await boundedRead(path.join(directory, "cmdline"), 65536)).split("\0").filter(Boolean);
      // Desktop Chrome can rewrite argv as one space-joined process title.
      const args = rawArgs.length === 1 ? rawArgs[0].split(/ (?=--)/).flatMap(arg => arg.startsWith("--") && !arg.includes("=") ? arg.split(" ") : [arg]) : rawArgs;
      if (args.some(value => value === "--type" || value.startsWith("--type="))) continue;
      const profile = flag(args, "--user-data-dir");
      // A bound account must not inspect another application's debugging metadata.
      if (exactProfile !== undefined && profile !== exactProfile) continue;
      const address = flag(args, "--remote-debugging-address");
      if (address && !["127.0.0.1", "localhost"].includes(address)) continue;
      if (args.includes("--remote-debugging-pipe")) continue;
      const declared = flag(args, "--remote-debugging-port");
      const stat = await boundedRead(path.join(directory, "stat"), 4096);
      const startedAt = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
      if (!startedAt || !/^[0-9]+$/.test(startedAt)) throw new Error(unavailable);
      const metadata = { profile, profileDirectory: flag(args, "--profile-directory"), windowClass: flag(args, "--class"), processId: Number(pid), startedAt };
      let port = portNumber(declared);
      let socket: string | undefined;
      if (declared === "0" || declared === undefined && flag(args, "--user-data-dir")) {
        if (!profile || !path.isAbsolute(profile) || await realpath(profile) !== path.resolve(profile)) throw new Error(unavailable);
        // A regular browser without debugging enabled is not a discovery candidate.
        try { await lstat(path.join(profile, "DevToolsActivePort")); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          endpoints.set(`process:${pid}`, metadata);
          if (endpoints.size > maxEndpoints) throw new Error(unavailable);
          continue;
        }
        const profileInfo = await lstat(profile);
        if (!profileInfo.isDirectory() || profileInfo.uid !== uid || (profileInfo.mode & 0o022) !== 0) throw new Error(unavailable);
        const active = await boundedRead(path.join(profile, "DevToolsActivePort"), 1024, { uid, privateDirectory: (profileInfo.mode & 0o077) === 0 });
        const lines = active.trimEnd().split("\n");
        if (lines.length !== 2 || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(lines[1])) throw new Error(unavailable);
        port = portNumber(lines[0]);
        if (!port) throw new Error(unavailable);
        if (declared === undefined) socket = `ws://127.0.0.1:${port}${lines[1]}`;
      }
      if (port) {
        const endpoint = socket ?? `http://127.0.0.1:${port}`;
        endpoints.set(`process:${pid}`, { endpoint, ...metadata });
      }
      if (endpoints.size > maxEndpoints) throw new Error(unavailable);
    } catch (error) {
      // A process can exit while its metadata is read; all other incomplete reads fail closed.
      if (!["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new Error(unavailable);
    }
  }
  return [...endpoints.values()];
}

export async function runningChromeEndpoints(procRoot = "/proc", uid = process.getuid?.()): Promise<string[]> {
  return (await runningChromeBrowsers(procRoot, uid)).flatMap(browser => browser.endpoint ? [browser.endpoint] : []);
}

export async function browserWebSocketForEndpoint(endpoint: string): Promise<string> {
  const matches = (await runningChromeEndpoints()).filter(value => value.startsWith("ws:") && `http://${new URL(value).host}` === endpoint);
  if (matches.length !== 1) throw new Error(unavailable);
  return matches[0];
}

async function accountVisible(endpoint: string, advertiserId: string, request: typeof fetch, targets: typeof readChromeTargets): Promise<boolean> {
  let tabs: unknown;
  if (endpoint.startsWith("ws:")) tabs = await targets(endpoint);
  else {
    const response = await request(`${endpoint}/json/list`, { redirect: "error", signal: AbortSignal.timeout(1500) });
    if (!response.ok || response.redirected || !response.body) throw new Error(unavailable);
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > 262144) throw new Error(unavailable);
        chunks.push(item.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    tabs = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  if (Buffer.byteLength(JSON.stringify(tabs) ?? "") > 262144) throw new Error(unavailable);
  if (!Array.isArray(tabs) || tabs.length > 256) throw new Error(unavailable);
  let matched = false;
  for (const tab of tabs) {
    if (!tab || typeof tab !== "object" || typeof tab.type !== "string" || typeof tab.url !== "string" || tab.url.length > 16384) throw new Error(unavailable);
    if (tab.type !== "page") continue;
    let url: URL;
    try { url = new URL(tab.url); } catch { continue; }
    if (url.origin !== "https://qianchuan.jinritemai.com" || !["/uni-prom", "/home"].includes(url.pathname) || url.username || url.password) continue;
    const ids = url.searchParams.getAll("aavid");
    if (ids.length === 1 && ids[0] === advertiserId) matched = true;
  }
  return matched;
}

/** Conventional startup CDP only: discovery never initiates a browser permission prompt. */
export async function discoverQianchuanProfile(advertiserId: string, browsers: RunningChromeBrowser[]): Promise<RunningChromeBrowser | undefined> {
  if (!/^[1-9][0-9]{0,19}$/.test(advertiserId) || browsers.length > maxEndpoints) throw new Error(unavailable);
  const candidates = browsers.filter((browser): browser is RunningChromeBrowser & { endpoint: string } => !!browser.profile && !!browser.profileDirectory && !!browser.endpoint && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(browser.endpoint) && !!portNumber(new URL(browser.endpoint).port));
  let visible: boolean[];
  try { visible = await Promise.all(candidates.map(browser => accountVisible(browser.endpoint, advertiserId, fetch, readChromeTargets))); }
  catch { throw new Error(unavailable); }
  const matches = candidates.filter((_, index) => visible[index]);
  if (matches.length > 1) throw new Error("该账户在多个原浏览器中打开，请检查重复窗口后重试。");
  return matches[0];
}

/** A URL is discovery evidence only; the uploader still verifies the actual page before selection. */
export async function discoverQianchuanBrowser(advertiserId: string, dependencies: {
  endpoints?: () => Promise<string[]>; fetch?: typeof fetch; targets?: typeof readChromeTargets;
} = {}): Promise<string> {
  if (!/^[1-9][0-9]{0,19}$/.test(advertiserId)) throw new Error(unavailable);
  let matches: string[];
  try {
    const endpoints = [...new Set(await (dependencies.endpoints ?? runningChromeEndpoints)())];
    if (endpoints.length > maxEndpoints || endpoints.some(value => !/^(?:http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}|ws:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/devtools\/browser\/[A-Za-z0-9-]+)$/.test(value) || !portNumber(new URL(value).port))) throw new Error(unavailable);
    const visible = await Promise.all(endpoints.map(endpoint => accountVisible(endpoint, advertiserId, dependencies.fetch ?? fetch, dependencies.targets ?? readChromeTargets)));
    matches = endpoints.filter((_, index) => visible[index]).map(value => `http://${new URL(value).host}`);
  } catch { throw new Error(unavailable); }
  if (matches.length === 0) throw new Error(missing);
  if (matches.length > 1) throw new Error("该账户在多个可连接浏览器中打开，请关闭重复的浏览器后重试。");
  return matches[0];
}
