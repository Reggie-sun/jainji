import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findExtensionProcess, readExtensionBrowserMetadata, verifyExtensionProcess } from "../src/main/qianchuan-extension-process";
import type { ExtensionProcess } from "../src/main/qianchuan-extension-protocol";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), readlink: vi.fn(actual.readlink) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

interface Listener {
  address?: string;
  port: number;
  inode: number;
  state?: string;
}

interface FakeChromeOptions {
  args: string[];
  listeners?: Listener[];
  fdInodes?: number[];
  activePort?: string;
  activePortMode?: number;
}

async function fakeChrome(options: FakeChromeOptions) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jianji-qianchuan-extension-proc-"));
  roots.push(root);
  const proc = path.join(root, "proc"), profile = path.join(root, "profile"), pid = 4242;
  const executable = "/opt/chrome/chrome";
  await Promise.all([
    mkdir(path.join(proc, "net"), { recursive: true }),
    mkdir(path.join(proc, String(pid), "fd"), { recursive: true }),
    mkdir(path.join(proc, String(pid), "net"), { recursive: true }),
    mkdir(path.join(profile, "Default"), { recursive: true, mode: 0o700 }),
  ]);
  await chmod(profile, 0o700);
  await symlink(executable, path.join(proc, String(pid), "exe"));
  await writeFile(path.join(proc, String(pid), "cmdline"), [executable, ...options.args, ""].join("\0"));
  await writeFile(path.join(proc, String(pid), "stat"), `${pid} (chrome) S ${Array(18).fill("0").join(" ")} 123 0`);
  for (const [index, inode] of (options.fdInodes ?? []).entries()) {
    await symlink(`socket:[${inode}]`, path.join(proc, String(pid), "fd", String(index + 3)));
  }

  const rows = (options.listeners ?? []).map((listener, index) => {
    const address = listener.address ?? "0100007F";
    const port = listener.port.toString(16).toUpperCase().padStart(4, "0");
    return `${index}: ${address}:${port} 00000000:0000 ${listener.state ?? "0A"} 00000000:00000000 00:00000000 00000000 ${process.getuid?.() ?? 1000} 0 ${listener.inode}`;
  });
  const tcp = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n${rows.join("\n")}\n`;
  await writeFile(path.join(proc, String(pid), "net", "tcp"), tcp);
  await writeFile(path.join(proc, String(pid), "net", "tcp6"), "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n");

  const activePortPath = path.join(profile, "DevToolsActivePort");
  if (options.activePort !== undefined) await writeFile(activePortPath, options.activePort, { mode: options.activePortMode ?? 0o600 });
  const identity: ExtensionProcess = { pid, profile, profileDirectory: "Default" };
  return { root, proc, profile, pid, identity, activePortPath, executable };
}

const debugArguments = (profile: string, port: string | number) => [
  `--user-data-dir=${profile}`,
  "--profile-directory=Default",
  `--remote-debugging-port=${port}`,
];

describe("Qianchuan extension browser process metadata", () => {
  it("rejects multiple verified processes for the same bound profile", async () => {
    const f = await fakeChrome({ args: debugArguments("/placeholder", 9321) });
    const args = [f.executable, ...debugArguments(f.profile, 9321), ""].join("\0");
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), args);
    const other = path.join(f.proc, "4243"); await mkdir(other);
    await symlink(f.executable, path.join(other, "exe"));
    await writeFile(path.join(other, "cmdline"), args);
    await writeFile(path.join(other, "stat"), `4243 (chrome) S ${Array(18).fill("0").join(" ")} 124 0`);
    await expect(findExtensionProcess(f.profile, "Default", f.proc)).rejects.toThrow();
  });

  it.each(["processes", "descriptors"])("drains active %s reads and stops scheduling after a fatal metadata error", async kind => {
    const f = await fakeChrome({ args: debugArguments("/placeholder", 9321), listeners: [{ port: 9321, inode: 7001 }], fdInodes: [7001] });
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 9321), ""].join("\0"));
    for (let index = 0; index < 64; index++) {
      if (kind === "processes") {
        const directory = path.join(f.proc, String(100 + index)); await mkdir(directory); await symlink("/usr/bin/node", path.join(directory, "exe"));
      } else await symlink("/dev/null", path.join(f.proc, String(f.pid), "fd", String(100 + index)));
    }
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let active = 0, started = 0;
    vi.mocked(fsPromises.readlink).mockImplementation(async (...args) => {
      const match = kind === "processes" ? String(args[0]).endsWith("/exe") : String(args[0]).includes("/fd/");
      if (!match) return actual.readlink(...args);
      const first = ++started === 1; active++;
      try {
        await new Promise(resolve => setTimeout(resolve, first ? 5 : 30));
        if (first) throw Object.assign(new Error("denied"), { code: "EPERM" });
        return await actual.readlink(...args);
      } finally { active--; }
    });
    const work = kind === "processes" ? findExtensionProcess(f.profile, "Default", f.proc) : readExtensionBrowserMetadata(f.identity, f.proc);
    await expect(work).rejects.toThrow("denied"); expect(active).toBe(0); expect(started).toBeLessThan(64);
    const atRejection = started; await new Promise(resolve => setTimeout(resolve, 50)); expect(started).toBe(atRejection);
  });

  it.each(["processes", "descriptors"])("keeps %s proof within budget when production delays filesystem callbacks", async kind => {
    const f = await fakeChrome({ args: debugArguments("/placeholder", 9321), listeners: [{ port: 9321, inode: 7001 }], fdInodes: [7001] });
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 9321), ""].join("\0"));
    if (kind === "processes") {
      for (let index = 0; index < 63; index++) {
        const directory = path.join(f.proc, String(100 + index)); await mkdir(directory);
        await symlink("/usr/bin/node", path.join(directory, "exe"));
      }
    } else {
      for (let index = 0; index < 63; index++) await symlink("/dev/null", path.join(f.proc, String(f.pid), "fd", String(100 + index)));
    }
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let active = 0, maximum = 0;
    vi.mocked(fsPromises.readlink).mockImplementation(async (...args) => {
      const delayed = kind === "processes" ? String(args[0]).endsWith("/exe") : String(args[0]).includes("/fd/");
      if (!delayed) return actual.readlink(...args);
      active++; maximum = Math.max(maximum, active);
      try { await new Promise(resolve => setTimeout(resolve, 40)); return await actual.readlink(...args); }
      finally { active--; }
    });
    const work = kind === "processes" ? findExtensionProcess(f.profile, "Default", f.proc) : readExtensionBrowserMetadata(f.identity, f.proc);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([work, new Promise(resolve => { timer = setTimeout(() => resolve("deadline"), 1000); })]);
      expect(result).toEqual(kind === "processes" ? f.identity : { port: 9321 });
      expect(maximum).toBeGreaterThan(1); expect(maximum).toBeLessThanOrEqual(16); expect(active).toBe(0);
    } finally { if (timer) clearTimeout(timer); await work; }
  });

  it("returns a fixed port only when the exact browser process owns its unique loopback listener", async () => {
    const f = await fakeChrome({
      args: debugArguments("/placeholder", 9321),
      listeners: [{ port: 9321, inode: 7001 }],
      fdInodes: [7001],
    });
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 9321), ""].join("\0"));

    await expect(verifyExtensionProcess(f.identity, f.proc)).resolves.toBe("123");
    await expect(readExtensionBrowserMetadata(f.identity, f.proc)).resolves.toEqual({ port: 9321 });
  });

  it.each([0o600, 0o664])("returns port-zero metadata mode %s inside the private profile with an owned listener", async mode => {
    const f = await fakeChrome({
      args: debugArguments("/placeholder", 0),
      activePort: "9411\n/devtools/browser/owned-uuid\n",
      listeners: [{ port: 9411, inode: 7002 }],
      fdInodes: [7002],
    });
    await chmod(f.activePortPath, mode);
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 0), ""].join("\0"));
    await expect(readExtensionBrowserMetadata(f.identity, f.proc)).resolves.toEqual({ port: 9411, browserPath: "/devtools/browser/owned-uuid" });
  });

  it("returns undefined when debugging is not declared, without trusting a stale ActivePort file", async () => {
    const f = await fakeChrome({ args: [`--user-data-dir=/placeholder`], activePort: "9421\n/devtools/browser/stale\n" });
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, `--user-data-dir=${f.profile}`, ""].join("\0"));
    await expect(readExtensionBrowserMetadata(f.identity, f.proc)).resolves.toBeUndefined();
  });

  it("rejects a stale port-zero file without a process-owned listener", async () => {
    const f = await fakeChrome({ args: debugArguments("/placeholder", 0), activePort: "9431\n/devtools/browser/stale\n" });
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 0), ""].join("\0"));
    await expect(readExtensionBrowserMetadata(f.identity, f.proc)).rejects.toThrow();
  });

  it("rejects a listener whose socket inode is not open by the exact Chrome PID", async () => {
    const f = await fakeChrome({
      args: debugArguments("/placeholder", 9322),
      listeners: [{ port: 9322, inode: 7100 }],
      fdInodes: [7101],
    });
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 9322), ""].join("\0"));
    await expect(readExtensionBrowserMetadata(f.identity, f.proc)).rejects.toThrow();
  });

  it("rejects non-loopback and ambiguous listeners even when one socket inode matches", async () => {
    const publicBind = await fakeChrome({
      args: debugArguments("/placeholder", 9323),
      listeners: [{ address: "0100000A", port: 9323, inode: 7200 }],
      fdInodes: [7200],
    });
    await writeFile(path.join(publicBind.proc, String(publicBind.pid), "cmdline"), [publicBind.executable, ...debugArguments(publicBind.profile, 9323), ""].join("\0"));
    await expect(readExtensionBrowserMetadata(publicBind.identity, publicBind.proc)).rejects.toThrow();

    const duplicate = await fakeChrome({
      args: debugArguments("/placeholder", 9324),
      listeners: [{ port: 9324, inode: 7201 }, { port: 9324, inode: 7202 }],
      fdInodes: [7201, 7202],
    });
    await writeFile(path.join(duplicate.proc, String(duplicate.pid), "cmdline"), [duplicate.executable, ...debugArguments(duplicate.profile, 9324), ""].join("\0"));
    await expect(readExtensionBrowserMetadata(duplicate.identity, duplicate.proc)).rejects.toThrow();
  });

  it.each([
    ["symlink", "symlink"],
    ["writable file", "writable"],
    ["oversized file", "oversized"],
    ["non-private profile", "profile-permissions"],
  ])("rejects an unsafe DevToolsActivePort (%s)", async (_label, mode) => {
    const f = await fakeChrome({ args: debugArguments("/placeholder", 0), activePort: "9441\n/devtools/browser/owned\n", listeners: [{ port: 9441, inode: 7300 }], fdInodes: [7300] });
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 0), ""].join("\0"));
    if (mode === "symlink") {
      const replacement = path.join(f.root, "active-port-copy");
      await writeFile(replacement, "9441\n/devtools/browser/owned\n", { mode: 0o600 });
      await rm(f.activePortPath);
      await symlink(replacement, f.activePortPath);
    } else if (mode === "writable") await chmod(f.activePortPath, 0o666);
    else if (mode === "oversized") await writeFile(f.activePortPath, `9441\n/devtools/browser/${"x".repeat(1100)}\n`, { mode: 0o600 });
    else await chmod(f.profile, 0o755);
    await expect(readExtensionBrowserMetadata(f.identity, f.proc)).rejects.toThrow();
  });

  it.each(["Profile 1", "Guest Profile"]) ("rejects a profile root containing another Chrome profile directory (%s)", async otherProfile => {
    const f = await fakeChrome({ args: debugArguments("/placeholder", 9325), listeners: [{ port: 9325, inode: 7400 }], fdInodes: [7400] });
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 9325), ""].join("\0"));
    await mkdir(path.join(f.profile, otherProfile), { mode: 0o700 });
    await expect(verifyExtensionProcess(f.identity, f.proc)).rejects.toThrow();
    await expect(readExtensionBrowserMetadata(f.identity, f.proc)).rejects.toThrow();
  });

  it("rejects another profile with a custom directory name using only file metadata", async () => {
    const f = await fakeChrome({ args: debugArguments("/placeholder", 9326) });
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 9326), ""].join("\0"));
    await mkdir(path.join(f.profile, "Custom Account"), { mode: 0o700 });
    await writeFile(path.join(f.profile, "Custom Account", "Preferences"), "not readable login data", { mode: 0o000 });
    await expect(verifyExtensionProcess(f.identity, f.proc)).rejects.toThrow();
  });

  it("rejects a replaced ActivePort file rather than accepting mixed inode evidence", async () => {
    const f = await fakeChrome({ args: debugArguments("/placeholder", 0), activePort: "9451\n/devtools/browser/original\n", listeners: [{ port: 9451, inode: 7500 }], fdInodes: [7500] });
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 0), ""].join("\0"));
    const originalOpen = vi.mocked(fsPromises.open).getMockImplementation()!;
    vi.mocked(fsPromises.open).mockImplementationOnce(async (...args) => {
      const handle = await originalOpen(...args);
      if (path.resolve(String(args[0])) === f.activePortPath) {
        const next = `${f.activePortPath}.replacement`;
        await writeFile(next, "9451\n/devtools/browser/replaced\n", { mode: 0o600 });
        await rename(next, f.activePortPath);
      }
      return handle;
    });
    await expect(readExtensionBrowserMetadata(f.identity, f.proc)).rejects.toThrow();
  });

  it("rejects metadata if the Chrome process becomes a renderer while it is being read", async () => {
    const f = await fakeChrome({ args: debugArguments("/placeholder", 0), activePort: "9461\n/devtools/browser/owned\n", listeners: [{ port: 9461, inode: 7600 }], fdInodes: [7600] });
    await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 0), ""].join("\0"));
    const originalOpen = vi.mocked(fsPromises.open).getMockImplementation()!;
    vi.mocked(fsPromises.open).mockImplementationOnce(async (...args) => {
      const handle = await originalOpen(...args);
      if (path.resolve(String(args[0])) === f.activePortPath) {
        await writeFile(path.join(f.proc, String(f.pid), "cmdline"), [f.executable, ...debugArguments(f.profile, 0), "--type=renderer", ""].join("\0"));
      }
      return handle;
    });
    await expect(readExtensionBrowserMetadata(f.identity, f.proc)).rejects.toThrow();
  });
});
