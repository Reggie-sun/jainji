import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import * as filesystem from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { discoverQianchuanBrowser, runningChromeBrowsers, runningChromeEndpoints } from "../src/main/qianchuan-browser-discovery";

vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readlink: vi.fn(original.readlink) };
});

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const endpoint = "http://127.0.0.1:9321";
const socket = "ws://127.0.0.1:9321/devtools/browser/owned";
const tab = (id = "123") => ({ type: "page", url: `https://qianchuan.jinritemai.com/uni-prom?aavid=${id}&adId=456` });
const discover = (tabs: unknown, endpoints = [endpoint]) => discoverQianchuanBrowser("123", {
  endpoints: async () => endpoints, fetch: vi.fn(async () => new Response(JSON.stringify(tabs))),
});

it("matches only a unique browser for the exact advertiser without requiring a port or matching the old plan", async () => {
  expect(await discover([tab(), tab()])).toBe(endpoint);
  await expect(discover([tab()], [endpoint, "http://127.0.0.1:9322"])).rejects.toThrow("多个");
});
it("recognizes the first-login account home without granting upload authority", async () => {
  expect(await discover([{ ...tab(), url: "https://qianchuan.jinritemai.com/home?aavid=123" }])).toBe(endpoint);
  for (const suffix of ["?aavid=124", "?aavid=123&aavid=123", "", "?aavid=0123"]) {
    await expect(discover([{ ...tab(), url: `https://qianchuan.jinritemai.com/home${suffix}` }])).rejects.toThrow("未找到");
  }
});
it("discovers browser-internal remote debugging over websocket without HTTP metadata", async () => {
  const fetch = vi.fn(), targets = vi.fn(async () => [tab()]);
  expect(await discoverQianchuanBrowser("123", { endpoints: async () => [socket], fetch, targets })).toBe(endpoint);
  expect(fetch).not.toHaveBeenCalled(); expect(targets).toHaveBeenCalledWith(socket);
  await expect(discoverQianchuanBrowser("123", { endpoints: async () => [socket, "ws://127.0.0.1:9322/devtools/browser/other"], targets })).rejects.toThrow("多个");
  for (const value of ["ws://example.com:9321/devtools/browser/owned", socket + "?redirect=1", "ws://127.0.0.1:9321/devtools/page/owned"]) {
    targets.mockClear();
    await expect(discoverQianchuanBrowser("123", { endpoints: async () => [value], targets })).rejects.toThrow();
    expect(targets).not.toHaveBeenCalled();
  }
});
it("reads browser-internal debugging metadata without a command-line debugging flag", async () => {
  const f = await processes(), profile = path.join(f.root, "profile"); await mkdir(profile, { mode: 0o700 });
  await f.add([`--user-data-dir=${profile}`]);
  expect(await runningChromeEndpoints(f.proc)).toEqual([]);
  expect(await runningChromeBrowsers(f.proc)).toEqual([{ profile, processId: 10, startedAt: "123" }]);
  await writeFile(path.join(profile, "DevToolsActivePort"), "9321\n/devtools/browser/owned\n", { mode: 0o600 });
  expect(await runningChromeEndpoints(f.proc)).toEqual([socket]);
});
it.each([
  [], [tab("124")], [{ ...tab(), type: "iframe" }],
  [{ ...tab(), url: "https://example.com/uni-prom?aavid=123" }],
  [{ ...tab(), url: "https://qianchuan.jinritemai.com/uni-prom?aavid=123&aavid=124" }],
  [{ ...tab(), url: "https://user@qianchuan.jinritemai.com/uni-prom?aavid=123" }],
].map(tabs => [tabs]))("rejects missing or misleading account metadata without choosing a first browser", async tabs => {
  await expect(discover(tabs)).rejects.toThrow("未找到");
});
it("uses only discovered loopback endpoints and never follows redirects", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify([tab()])));
  await expect(discoverQianchuanBrowser("123", { endpoints: async () => ["http://example.com:9321"], fetch })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(await discoverQianchuanBrowser("123", { endpoints: async () => [endpoint], fetch })).toBe(endpoint);
  expect(fetch).toHaveBeenCalledWith(`${endpoint}/json/list`, expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
});
it("rejects incomplete discovery, redirects, malformed or oversized metadata", async () => {
  for (const response of [new Response("[]", { status: 302 }), new Response("{}"), new Response("x".repeat(262145)), new Response(JSON.stringify(Array(257).fill(tab())))]) {
    await expect(discoverQianchuanBrowser("123", { endpoints: async () => [endpoint], fetch: async () => response })).rejects.toThrow("无法完整连接");
  }
  await expect(discoverQianchuanBrowser("123", { endpoints: async () => Array.from({ length: 17 }, (_, i) => `http://127.0.0.1:${9300 + i}`) })).rejects.toThrow();
  await expect(discoverQianchuanBrowser("123", { endpoints: async () => [endpoint], fetch: async () => { throw new Error("private payload"); } })).rejects.toThrow("无法完整连接");
});
it("bounds actual loopback HTTP reads and never follows an HTTP redirect", async () => {
  const visited: string[] = [];
  let mode = "redirect";
  const server = createServer((request, response) => {
    visited.push(request.url!);
    if (mode === "redirect") { response.writeHead(302, { location: "/never" }); response.end(); }
    else { response.writeHead(200); response.write("["); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const endpoints = async () => [`http://127.0.0.1:${address.port}`];
  try {
    await expect(discoverQianchuanBrowser("123", { endpoints })).rejects.toThrow("无法完整连接");
    expect(visited).toEqual(["/json/list"]);
    mode = "stall";
    await expect(discoverQianchuanBrowser("123", { endpoints })).rejects.toThrow("无法完整连接");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
async function processes() {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-process-")); roots.push(root);
  const proc = path.join(root, "proc"); await mkdir(proc);
  let pid = 10;
  const add = async (args: string[], executable = "/opt/google/chrome/chrome") => {
    const directory = path.join(proc, String(pid++)); await mkdir(directory);
    await symlink(executable, path.join(directory, "exe"));
    await writeFile(path.join(directory, "cmdline"), [executable, ...args, ""].join("\0"));
    await writeFile(path.join(directory, "stat"), `${pid - 1} (chrome) S ${Array(18).fill("0").join(" ")} 123 0`);
  };
  return { root, proc, add };
}
it("discovers current-user Chrome main processes only, with loopback debug flags and no fixed-port scan", async () => {
  const f = await processes();
  await f.add(["--remote-debugging-port=9321"]);
  await f.add(["--remote-debugging-port", "9322", "--remote-debugging-address=localhost"]);
  await f.add(["--type=renderer", "--remote-debugging-port=9323"]);
  await f.add(["--remote-debugging-port=9324", "--remote-debugging-address=0.0.0.0"]);
  await f.add(["--remote-debugging-port=9325"], "/usr/bin/not-chrome");
  await f.add([]);
  expect(await runningChromeEndpoints(f.proc)).toEqual([endpoint, "http://127.0.0.1:9322"]);
  expect(await runningChromeEndpoints(f.proc, process.getuid!() + 1)).toEqual([]);
});
it("retains a running Chrome instance after its executable is replaced by an update", async () => {
  const f = await processes(), profile = path.join(f.root, "profile"); await mkdir(profile, { mode: 0o700 });
  await f.add(["--remote-debugging-port=9321", `--user-data-dir=${profile}`, "--profile-directory=Default"], "/opt/google/chrome/chrome (deleted)");
  expect(await runningChromeBrowsers(f.proc)).toEqual([{ endpoint, profile, profileDirectory: "Default", processId: 10, startedAt: "123" }]);
});
it("reads a bounded DevToolsActivePort only from the running port-zero browser's exact profile", async () => {
  const f = await processes(), profile = path.join(f.root, "profile"); await mkdir(profile, { mode: 0o700 });
  await writeFile(path.join(profile, "DevToolsActivePort"), "9321\n/devtools/browser/owned\n", { mode: 0o600 });
  await f.add(["--remote-debugging-port=0", `--user-data-dir=${profile}`]);
  expect(await runningChromeEndpoints(f.proc)).toEqual([endpoint]);
  // Chrome inherits the process umask; a 0664 file is still private inside its 0700 profile.
  await chmod(path.join(profile, "DevToolsActivePort"), 0o664);
  expect(await runningChromeEndpoints(f.proc)).toEqual([endpoint]);
  await chmod(profile, 0o755);
  await expect(runningChromeEndpoints(f.proc)).rejects.toThrow();
  await chmod(profile, 0o700);
  await rm(path.join(profile, "DevToolsActivePort"));
  const other = path.join(f.root, "other"); await writeFile(other, "9322\n/devtools/browser/other\n");
  await symlink(other, path.join(profile, "DevToolsActivePort"));
  await expect(runningChromeEndpoints(f.proc)).rejects.toThrow();
});
it("ignores a process whose executable cannot be identified instead of blocking every readable Chrome", async () => {
  const f = await processes(); await f.add([]); await f.add(["--remote-debugging-port=9321"]);
  vi.mocked(filesystem.readlink).mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EACCES" }));
  expect(await runningChromeEndpoints(f.proc)).toEqual([endpoint]);
});
it("recognizes a desktop Chrome process title and ignores a pipe-only MCP browser", async () => {
  const f = await processes();
  const desktopProfile = path.join(f.root, "desktop profile"); await mkdir(desktopProfile, { mode: 0o700 });
  await writeFile(path.join(desktopProfile, "DevToolsActivePort"), "9321\n/devtools/browser/owned\n", { mode: 0o600 });
  await f.add([]);
  await writeFile(path.join(f.proc, "10", "cmdline"), `/opt/google/chrome/chrome --user-data-dir=${desktopProfile} --profile-directory=Profile 1 --class=account\0`);
  const profile = path.join(f.root, "pipe-profile"); await mkdir(profile, { mode: 0o775 });
  await f.add(["--remote-debugging-pipe", `--user-data-dir=${profile}`]);
  expect(await runningChromeEndpoints(f.proc)).toEqual([socket]);
  expect(await runningChromeBrowsers(f.proc)).toEqual([{ endpoint: socket, profile: desktopProfile, profileDirectory: "Profile 1", windowClass: "account", processId: 10, startedAt: "123" }]);
});
