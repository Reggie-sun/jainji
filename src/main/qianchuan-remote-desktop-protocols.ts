import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { desktopEnvironment } from "./qianchuan-remote-desktop-panel.js";

const mime = "x-scheme-handler/bytedance", entryName = "jianji-bytedance-web.desktop";
// GLib requires %u to recognize URI support. true treats it as data, never a command.
const entry = "[Desktop Entry]\nType=Application\nName=简辑 · 网页客户端唤起兼容\nExec=/usr/bin/true %u\nTerminal=false\nNoDisplay=true\nStartupNotify=false\nMimeType=x-scheme-handler/bytedance;\nX-Jianji-Managed=true\n";
type Command = (file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;
const command: Command = (file, args, env) => new Promise((resolve, reject) => {
  execFile(file, args, { env, timeout: 5000, maxBuffer: 16384 }, (error, stdout) => error ? reject(new Error("Native URI command failed")) : resolve(stdout.trim()));
});
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Dedicated Linux web-only desktop; no Chrome, queue, upload or confirmation authority. */
export class RemoteDesktopProtocols {
  constructor(private readonly root: string, private readonly home: string,
    private readonly environment = desktopEnvironment, private readonly run: Command = command) {}
  private async directory(dir: string): Promise<void> {
    if (path.resolve(this.home) !== this.home || !dir.startsWith(this.home + path.sep)) throw new Error("Native URI directory outside home");
    let current = this.home;
    for (const part of ["", ...path.relative(this.home, dir).split(path.sep)]) {
      if (part) {
        current = path.join(current, part);
        try { await mkdir(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.mode & 0o022 || await realpath(current) !== current) throw new Error("Unsafe native URI directory");
    }
  }
  private async inspect(file: string): Promise<string | undefined> {
    let info;
    try { info = await lstat(file); } catch (error) { if (missing(error)) return undefined; throw error; }
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.mode & 0o022 || info.size > 65536 || await realpath(file) !== file) throw new Error("Unsafe native URI file");
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat(), bytes = Buffer.alloc(65537);
      const read = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
      if (before.ino !== info.ino || before.dev !== info.dev || read.bytesRead !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error("Native URI file changed");
      return bytes.subarray(0, read.bytesRead).toString("utf8");
    } finally { await handle.close(); }
  }
  async ensure(): Promise<void> {
    const env: NodeJS.ProcessEnv = { ...await this.environment(), LC_ALL: "C", LANGUAGE: "C" };
    const data = path.join(this.home, ".local/share"), config = path.join(this.home, ".config");
    if (env.XDG_DATA_HOME && env.XDG_DATA_HOME !== data || env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== config) throw new Error("Custom native URI directories unsupported");
    // xdg-mime can return an advertised handler before GLib can actually launch it.
    // XFCE's exo-open uses GLib, so query and set the effective GLib association.
    const query = async () => {
      const line = (await this.run("/usr/bin/gio", ["mime", mime], env)).split("\n")[0];
      if (line.startsWith("No default applications for ")) return "";
      const result = /^Default application for .+: (.+\.desktop)$/.exec(line);
      if (!result) throw new Error("Native URI association unavailable");
      return result[1];
    };
    const original = await query();
    if (original && original !== entryName) return; // Never replace a real native client.
    const executable = await lstat("/usr/bin/true");
    if (!executable.isFile() || executable.uid !== 0 || executable.mode & 0o022 || !(executable.mode & 0o111)) throw new Error("Native URI executable unavailable");
    await secureUploadDirectory(this.root);
    const lock = path.join(this.root, "native-uri.lock"), handle = await open(lock, "wx", 0o600);
    try {
      const applications = path.join(data, "applications");
      await this.directory(applications); await this.directory(config);
      for (const dir of [applications, config]) for (const name of ["mimeapps.list", "xfce-mimeapps.list", "defaults.list"]) await this.inspect(path.join(dir, name));
      const file = path.join(applications, entryName), existing = await this.inspect(file);
      if (existing !== undefined && existing !== entry) throw new Error("Foreign native URI entry conflict");
      if (existing === undefined) {
        const target = await open(file, "wx", 0o600);
        try { await target.writeFile(entry); await target.sync(); } finally { await target.close(); }
        await strictSyncDirectory(applications);
      }
      const current = await query();
      if (current && current !== entryName) return;
      if (current !== entryName) await this.run("/usr/bin/gio", ["mime", mime, entryName], env);
      if (await query() !== entryName) throw new Error("Native URI registration not applied");
    } finally { await handle.close(); await unlink(lock); await strictSyncDirectory(this.root); }
  }
}
