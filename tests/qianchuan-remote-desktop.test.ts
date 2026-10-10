import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RemoteDesktop } from "../src/main/qianchuan-remote-desktop";

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
  return { home, root, panel, plugins, dock: new RemoteDesktop(root, home, panel) };
}

it("persists three distinct account launchers, reuses the same profile and updates presentation without duplicate icons", async () => {
  const f = await fixture();
  await f.dock.sync("123", "予浅好物"); await f.dock.sync("456", "安序居家"); await f.dock.sync("789", "第二家");
  await f.dock.sync("123", '予浅 "新名" & 好物');
  expect(f.plugins.size).toBe(3);
  const entry = await readFile(path.join(f.home, ".local/share/applications/jianji-account-123.desktop"), "utf8");
  expect(entry).toContain('Name=予浅 "新名" & 好物 · 千川');
  expect(entry).toContain("--desktop-focus 123"); expect(entry).not.toContain("新名\" & 好物 --");
  const registry = JSON.parse(await readFile(path.join(f.root, "desktop/accounts.json"), "utf8"));
  expect(registry.accounts.map((v: { advertiserId: string }) => v.advertiserId)).toEqual(["123", "456", "789"]);
  expect(await f.dock.focus("123")).toBe(true);
  expect(f.panel.focus).toHaveBeenCalledWith(path.join(f.root, "browsers/account-browsers/123"));
  await expect(f.dock.focus("999")).rejects.toThrow();
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
