import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RemoteDisplayNameSchema } from "../shared/qianchuan-remote.js";
import { readPrivateJson } from "./qianchuan-account-config.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { XfceDesktopPanel, type DesktopPanel } from "./qianchuan-remote-desktop-panel.js";

const Id = z.string().regex(/^[1-9][0-9]{0,19}$/);
const Registry = z.object({ version: z.literal(1), accounts: z.array(z.object({ advertiserId: Id, displayName: RemoteDisplayNameSchema, pluginId: z.number().int().min(1).max(99999) }).strict()).max(100) }).strict().refine(v => new Set(v.accounts.map(a => a.advertiserId)).size === v.accounts.length && new Set(v.accounts.map(a => a.pluginId)).size === v.accounts.length);
type RegistryValue = z.infer<typeof Registry>;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const desktopString = (value: string) => value.replace(/\\/g, "\\\\");
// Desktop Entry string escaping precedes Exec quoting; no shell or user labels.
function execArgument(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid desktop path");
  return '"' + value.replace(/%/g, "%%").replace(/[\\"`$]/g, c => `\\${c}`).replace(/\\/g, "\\\\") + '"';
}

function icon(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><circle cx="60" cy="60" r="54" fill="#fbbc05"/><path d="M60 6a54 54 0 0 1 47 27H60a27 27 0 0 0-24 40L13 33A54 54 0 0 1 60 6" fill="#ea4335"/><path d="M13 33l24 41a27 27 0 0 0 47 0L60 114A54 54 0 0 1 13 33" fill="#34a853"/><circle cx="60" cy="60" r="28" fill="white"/><circle cx="60" cy="60" r="24" fill="#4285f4"/><circle cx="101" cy="101" r="25" fill="#3754dc"/><text x="101" y="110" text-anchor="middle" font-family="Noto Sans CJK SC,sans-serif" font-size="28" font-weight="bold" fill="white">${xml(Array.from(label)[0])}</text></svg>`;
}

/** Presentation only: the original account/profile and worker retain all authority. */
export class RemoteDesktop {
  private readonly directory: string;
  constructor(private readonly root: string, private readonly home: string, private readonly panel: DesktopPanel = new XfceDesktopPanel()) {
    this.directory = path.join(root, "desktop");
  }
  private async profile(id: string): Promise<string> {
    Id.parse(id);
    const profile = path.join(this.root, "browsers/account-browsers", id);
    for (const dir of [this.root, path.join(this.root, "browsers"), path.dirname(profile), profile, path.join(profile, "Default")]) await this.checkDirectory(dir);
    return profile;
  }
  private async checkDirectory(dir: string): Promise<void> {
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.mode & 0o002 || info.gid !== process.getgid?.() || await realpath(dir) !== dir) throw new Error("Unsafe desktop directory");
  }
  private async sharedDirectory(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 }); await this.checkDirectory(dir);
  }
  private async registry(): Promise<RegistryValue> {
    const file = path.join(this.directory, "accounts.json");
    try { await lstat(file); } catch (error) { if (missing(error)) return { version: 1, accounts: [] }; throw error; }
    return (await readPrivateJson(file, input => Registry.parse(input))).value;
  }
  private async inspect(file: string): Promise<string | undefined> {
    let info;
    try { info = await lstat(file); } catch (error) { if (missing(error)) return undefined; throw error; }
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.mode & 0o002 || info.size > 16384 || await realpath(file) !== file) throw new Error("Unsafe desktop file");
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat();
      if (opened.ino !== info.ino || opened.dev !== info.dev || opened.size !== info.size) throw new Error("Desktop file changed");
      const bytes = Buffer.alloc(16385), result = await handle.read(bytes, 0, bytes.length, 0);
      if (result.bytesRead !== info.size || (await handle.stat()).mtimeMs !== info.mtimeMs) throw new Error("Desktop file changed");
      return bytes.subarray(0, result.bytesRead).toString("utf8");
    } finally { await handle.close(); }
  }
  private async write(file: string, content: string): Promise<void> {
    if (await this.inspect(file) === content) return;
    const temp = `${file}.${randomUUID()}.tmp`, handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file); await strictSyncDirectory(path.dirname(file));
  }
  private ownedEntry(value: string | undefined, id: string, expectedExec: string): void {
    if (value === undefined) return;
    const fields = new Map(value.split("\n").filter(line => line.includes("=")).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    const legacy = fields.get("Exec") === `${this.home}/.local/bin/jianji-vps-account ${id}` && fields.get("Icon") === `${this.home}/.local/share/icons/jianji/${id}.png`;
    const managed = fields.get("X-Jianji-Managed") === "true" && fields.get("X-Jianji-AdvertiserId") === id && fields.get("Exec") === expectedExec;
    if (!value.startsWith("[Desktop Entry]\n") || fields.get("Type") !== "Application" || (!legacy && !managed)) throw new Error("Foreign desktop entry conflict");
  }
  async sync(id: string, inputName: string): Promise<void> {
    const label = RemoteDisplayNameSchema.parse(inputName); await this.profile(id);
    await secureUploadDirectory(this.directory);
    const lock = path.join(this.directory, "sync.lock"), handle = await open(lock, "wx", 0o600);
    try {
      const registry = await this.registry();
      const worker = path.join(path.dirname(this.root), "worker.cjs");
      const exec = `${execArgument(process.execPath)} ${execArgument(worker)} --desktop-focus ${id}`;
      const applications = path.join(this.home, ".local/share/applications");
      const panelRoot = path.join(this.home, ".config/xfce4/panel");
      await this.sharedDirectory(applications); await this.sharedDirectory(panelRoot);
      const fileName = `jianji-account-${id}.desktop`, application = path.join(applications, fileName);
      this.ownedEntry(await this.inspect(application), id, exec);
      await this.panel.register(id, async pluginId => {
        const old = registry.accounts.find(v => v.advertiserId === id);
        if (old && old.pluginId !== pluginId || registry.accounts.some(v => v.advertiserId !== id && v.pluginId === pluginId)) throw new Error("Launcher binding changed");
        const launcherDir = path.join(panelRoot, `launcher-${pluginId}`), launcher = path.join(launcherDir, fileName);
        await this.sharedDirectory(launcherDir); this.ownedEntry(await this.inspect(launcher), id, exec);
        const icons = path.join(this.directory, "icons"); await secureUploadDirectory(icons);
        const iconFile = path.join(icons, `${id}.svg`);
        const value = `[Desktop Entry]\nVersion=1.0\nType=Application\nName=${desktopString(label)} · 千川\nComment=打开或切换此账号的专用 Chrome\nExec=${exec}\nIcon=${desktopString(iconFile)}\nTerminal=false\nStartupNotify=false\nCategories=Network;WebBrowser;\nX-Jianji-Managed=true\nX-Jianji-AdvertiserId=${id}\n`;
        await this.write(iconFile, icon(label)); await this.write(application, value); await this.write(launcher, value);
        const next = Registry.parse({ version: 1, accounts: old ? registry.accounts.map(v => v === old ? { ...v, displayName: label } : v) : [...registry.accounts, { advertiserId: id, displayName: label, pluginId }] });
        await this.write(path.join(this.directory, "accounts.json"), JSON.stringify(next));
      }, registry.accounts.map(v => v.pluginId));
    } finally { await handle.close(); await unlink(lock); await strictSyncDirectory(this.directory); }
  }
  async focus(id: string): Promise<boolean> {
    Id.parse(id);
    if (!(await this.registry()).accounts.some(v => v.advertiserId === id)) throw new Error("Account launcher not registered");
    return this.panel.focus(await this.profile(id));
  }
}
