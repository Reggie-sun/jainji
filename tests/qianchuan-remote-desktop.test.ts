import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RemoteDesktop } from "../src/main/qianchuan-remote-desktop";
import { RemoteDesktopProtocols } from "../src/main/qianchuan-remote-desktop-protocols";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), "jianji-dock-")); roots.push(home);
  const root = path.join(home, ".local/share/jianji-remote/state");
  for (const id of ["123", "456", "789"]) await mkdir(path.join(root, "browsers/account-browsers", id, "Default"), { recursive: true, mode: 0o700 });
  const plugins = new Map<string, number>();
  const panel = { register: vi.fn(async (id: string, install: (pluginId: number) => Promise<void>) => {
    const pluginId = plugins.get(id) ?? plugins.size + 23; await install(pluginId); plugins.set(id, pluginId);
  }), focus: vi.fn(async () => true) };
  const protocols = { ensure: vi.fn(async () => {}) };
  return { home, root, panel, plugins, protocols, dock: new RemoteDesktop(root, home, panel, protocols) };
}

it("persists three distinct account launchers, reuses the same profile and updates presentation without duplicate icons", async () => {
  const f = await fixture();
  await f.dock.sync("123", "予浅好物"); await f.dock.sync("456", "安序居家"); await f.dock.sync("789", "第二家");
  await f.dock.sync("123", '予浅 "新名" & 好物');
  expect(f.plugins.size).toBe(3);
  expect(f.protocols.ensure).toHaveBeenCalledTimes(4);
  const entry = await readFile(path.join(f.home, ".local/share/applications/jianji-account-123.desktop"), "utf8");
  expect(entry).toContain('Name=予浅 "新名" & 好物 · 千川');
  expect(entry).toContain("--desktop-focus 123"); expect(entry).not.toContain("新名\" & 好物 --");
  const registry = JSON.parse(await readFile(path.join(f.root, "desktop/accounts.json"), "utf8"));
  expect(registry.accounts.map((v: { advertiserId: string }) => v.advertiserId)).toEqual(["123", "456", "789"]);
  expect(await f.dock.focus("123")).toBe(true);
  expect(f.panel.focus).toHaveBeenCalledWith(path.join(f.root, "browsers/account-browsers/123"));
  await expect(f.dock.focus("999")).rejects.toThrow();
});

async function protocolFixture(initial = "") {
  const f = await fixture(), calls: string[][] = [];
  let current = initial;
  const run = vi.fn(async (_file: string, args: string[]) => {
    calls.push(args);
    if (args.length === 2) return current ? `Default application for ${args[1]}: ${current}` : `No default applications for ${args[1]}`;
    current = args[2]; return "";
  });
  return { ...f, calls, run, protocols: new RemoteDesktopProtocols(f.root, f.home, async () => ({}), run) };
}

it("registers only the absent Bytedance native handler and reuses it without changing browser profiles", async () => {
  const f = await protocolFixture();
  await f.protocols.ensure(); await f.protocols.ensure();
  const entry = await readFile(path.join(f.home, ".local/share/applications/jianji-bytedance-web.desktop"), "utf8");
  expect(entry).toContain("Exec=/usr/bin/true %u\n");
  expect(entry).toContain("MimeType=x-scheme-handler/bytedance;\n");
  expect(entry).toContain("NoDisplay=true\n");
  expect(entry).not.toMatch(/worker|chrome|sh -c/);
  expect(f.calls.filter(args => args.length === 3)).toEqual([["mime", "x-scheme-handler/bytedance", "jianji-bytedance-web.desktop"]]);
  expect(f.panel.register).not.toHaveBeenCalled();
});

it("preserves an existing native application and refuses foreign or redirected handler files", async () => {
  const f = await protocolFixture("real-bytedance.desktop");
  await f.protocols.ensure(); expect(f.calls).toEqual([["mime", "x-scheme-handler/bytedance"]]);
  const g = await protocolFixture(), entry = path.join(g.home, ".local/share/applications/jianji-bytedance-web.desktop");
  await mkdir(path.dirname(entry), { recursive: true, mode: 0o700 }); await writeFile(entry, "foreign", { mode: 0o600 });
  await expect(g.protocols.ensure()).rejects.toThrow("Foreign"); expect(g.calls.some(args => args.length === 3)).toBe(false);
  await rm(entry); await symlink(path.join(g.home, "other"), entry);
  await expect(g.protocols.ensure()).rejects.toThrow();
});

it("does not claim a failed registration succeeded, and rejects redirected MIME configuration", async () => {
  const f = await protocolFixture();
  f.run.mockImplementation(async () => "No default applications for x-scheme-handler/bytedance");
  await expect(f.protocols.ensure()).rejects.toThrow("registration");
  const g = await protocolFixture(), config = path.join(g.home, ".config"); await mkdir(config, { mode: 0o700 });
  await symlink(path.join(g.home, "foreign"), path.join(config, "mimeapps.list"));
  await expect(g.protocols.ensure()).rejects.toThrow();
  expect(g.calls.some(args => args.length === 3)).toBe(false);
});

it("rejects redirected parent directories before creating files outside the dedicated home", async () => {
  const f = await protocolFixture(), outside = await mkdtemp(path.join(os.tmpdir(), "jianji-uri-outside-")); roots.push(outside);
  await symlink(outside, path.join(f.home, ".config"));
  await expect(f.protocols.ensure()).rejects.toThrow("Unsafe");
  await expect(lstat(path.join(outside, "mimeapps.list"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.calls.some(args => args.length === 3)).toBe(false);
});

it("rejects absent or redirected profiles, unsafe labels and foreign desktop files before changing the panel", async () => {
  const f = await fixture();
  await expect(f.dock.sync("999", "缺失")).rejects.toThrow();
  await expect(f.dock.sync("123", "注入\nExec=bad")).rejects.toThrow();
  await symlink(path.join(f.root, "browsers/account-browsers/123"), path.join(f.root, "browsers/account-browsers/999"));
  await expect(f.dock.sync("999", "链接")).rejects.toThrow();
  const file = path.join(f.home, ".local/share/applications/jianji-account-123.desktop");
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, "[Desktop Entry]\nExec=foreign\n");
  await expect(f.dock.sync("123", "冲突")).rejects.toThrow();
  expect(await readFile(file, "utf8")).toContain("Exec=foreign");
  expect(f.plugins.size).toBe(0);
});

it("fails closed for damaged presentation state and never creates a missing Chrome profile on focus", async () => {
  const f = await fixture(); await f.dock.sync("123", "予浅");
  const registry = path.join(f.root, "desktop/accounts.json");
  await writeFile(registry, "bad", { mode: 0o600 }); await chmod(registry, 0o600);
  await expect(f.dock.sync("456", "安序")).rejects.toThrow();
  await expect(f.dock.focus("123")).rejects.toThrow();
  expect(f.plugins.size).toBe(1);
});
