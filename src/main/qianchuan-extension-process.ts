import { constants } from "node:fs";
import { lstat, open, readFile, readlink, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ExtensionProcessSchema, extensionChanged, type ExtensionProcess } from "./qianchuan-extension-protocol.js";
import { verifyOriginalProfile } from "./qianchuan-browser-bindings.js";

function chromeArguments(bytes: Buffer): string[] {
  if (bytes.length > 65536) throw extensionChanged();
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0").filter(Boolean);
  return raw.length === 1 ? raw[0].split(/ (?=--)/).flatMap(arg => arg.startsWith("--") && !arg.includes("=") ? arg.split(" ") : [arg]) : raw;
}

/** Native messaging supplies metadata; independently check the live OS process, never Chrome login files. */
export async function verifyExtensionProcess(input: ExtensionProcess, procRoot = "/proc", home = os.homedir()): Promise<string> {
  const value = ExtensionProcessSchema.parse(input), directory = path.join(procRoot, String(value.pid));
  if (process.platform !== "linux" || !path.isAbsolute(value.profile)) throw extensionChanged();
  const before = await lstat(directory);
  if (!before.isDirectory() || before.uid !== process.getuid?.()) throw extensionChanged();
  const executable = path.basename(await readlink(path.join(directory, "exe"))).replace(/ \(deleted\)$/, "");
  if (!["chrome", "chromium", "chromium-browser", "google-chrome", "google-chrome-stable"].includes(executable)) throw extensionChanged();
  const bytes = await readFile(path.join(directory, "cmdline"));
  const args = chromeArguments(bytes);
  if (!args.length || args.some(arg => arg === "--type" || arg.startsWith("--type="))) throw extensionChanged();
  const flag = (name: string) => {
    const matches = args.flatMap((arg, index) => arg === name ? [args[index + 1] ?? ""] : arg.startsWith(`${name}=`) ? [arg.slice(name.length + 1)] : []);
    if (matches.length > 1) throw extensionChanged(); return matches[0];
  };
  const profile = flag("--user-data-dir") ?? path.join(home, ".config", "google-chrome");
  if (profile !== value.profile || (flag("--profile-directory") ?? "Default") !== value.profileDirectory || await realpath(profile) !== profile) throw extensionChanged();
  await verifyOriginalProfile({ advertiserId: "1", profile, profileDirectory: value.profileDirectory });
  const profiles = await readdir(profile, { withFileTypes: true });
  if (profiles.length > 1024) throw extensionChanged();
  // Linux native messaging identifies the Chrome process, not a tab's profile within a shared process.
  for (const entry of profiles) {
    if (entry.name === value.profileDirectory) continue;
    if (/^(Default|Profile [0-9]+|Guest Profile)$/.test(entry.name) || entry.isSymbolicLink() && !/^Singleton(Lock|Cookie|Socket)$/.test(entry.name)) throw extensionChanged();
    if (entry.isDirectory()) {
      // Preferences is only a profile marker: do not open or read its contents.
      try { await lstat(path.join(profile, entry.name, "Preferences")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      throw extensionChanged();
    }
  }
  const stat = await readFile(path.join(directory, "stat"), "utf8");
  if (stat.length > 4096) throw extensionChanged();
  const startedAt = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  if (!/^[0-9]+$/.test(startedAt ?? "")) throw extensionChanged();
  const after = await lstat(directory);
  if (before.ino !== after.ino || before.uid !== after.uid) throw extensionChanged();
  return startedAt;
}

async function metadataText(file: string, maximum: number): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const bytes = Buffer.alloc(maximum + 1); let length = 0;
    while (length < bytes.length) { const result = await handle.read(bytes, length, bytes.length - length, null); if (!result.bytesRead) break; length += result.bytesRead; }
    if (length > maximum) throw extensionChanged();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
  } finally { await handle.close(); }
}

/** Bind debugging metadata to the native host's exact live process using OS sockets only. */
export async function readExtensionBrowserMetadata(identity: ExtensionProcess, procRoot = "/proc"): Promise<{ port: number; browserPath?: string } | undefined> {
  const startedAt = await verifyExtensionProcess(identity, procRoot), directory = path.join(procRoot, String(identity.pid));
  const args = chromeArguments(await readFile(path.join(directory, "cmdline")));
  const flag = (name: string) => {
    const values = args.flatMap((arg, index) => arg === name ? [args[index + 1] ?? ""] : arg.startsWith(`${name}=`) ? [arg.slice(name.length + 1)] : []);
    if (values.length > 1) throw extensionChanged(); return values[0];
  };
  const declared = flag("--remote-debugging-port"), address = flag("--remote-debugging-address");
  if (declared === undefined || args.includes("--remote-debugging-pipe")) return undefined;
  if (address && !["127.0.0.1", "localhost"].includes(address) || !/^(0|[1-9][0-9]{0,4})$/.test(declared)) throw extensionChanged();
  let port = Number(declared), browserPath: string | undefined;
  const file = path.join(identity.profile, "DevToolsActivePort");
  let before: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    before = await lstat(file);
    // The already verified 0700 profile prevents other users reaching Chrome's default 0664 metadata.
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.getuid?.() || before.mode & 0o002 || before.size > 1024) throw extensionChanged();
    const lines = (await metadataText(file, 1024)).trimEnd().split("\n");
    if (lines.length !== 2 || !/^[1-9][0-9]{0,4}$/.test(lines[0]) || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(lines[1])) throw extensionChanged();
    if (port && Number(lines[0]) !== port) throw extensionChanged();
    port = Number(lines[0]); browserPath = lines[1];
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !port) throw extensionChanged(); }
  if (port < 1 || port > 65535) throw extensionChanged();
  const descriptors = await readdir(path.join(directory, "fd"));
  if (descriptors.length > 4096) throw extensionChanged();
  const sockets = new Set<string>();
  for (const fd of descriptors) {
    if (!/^[0-9]+$/.test(fd)) throw extensionChanged();
    try { const match = /^socket:\[([0-9]+)\]$/.exec(await readlink(path.join(directory, "fd", fd))); if (match) sockets.add(match[1]); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const listeners = (await metadataText(path.join(directory, "net", "tcp"), 1024 * 1024)).trim().split("\n").slice(1)
    .map(line => line.trim().split(/\s+/)).filter(fields => fields[3] === "0A" && fields[1] === `0100007F:${port.toString(16).toUpperCase().padStart(4, "0")}`);
  if (listeners.length !== 1 || !sockets.has(listeners[0][9])) throw extensionChanged();
  if (before) { const after = await lstat(file); if (after.dev !== before.dev || after.ino !== before.ino || after.ctimeMs !== before.ctimeMs || after.size !== before.size) throw extensionChanged(); }
  if (await verifyExtensionProcess(identity, procRoot) !== startedAt) throw extensionChanged();
  return { port, ...(browserPath ? { browserPath } : {}) };
}

export async function findExtensionProcess(profile: string, profileDirectory: string, procRoot = "/proc"): Promise<ExtensionProcess> {
  const pids = (await readdir(procRoot)).filter(value => /^[1-9][0-9]*$/.test(value));
  if (pids.length > 4096) throw extensionChanged();
  const matches: ExtensionProcess[] = [];
  for (const pid of pids) {
    try {
      const directory = path.join(procRoot, pid), info = await lstat(directory);
      if (info.uid !== process.getuid?.()) continue;
      const executable = path.basename(await readlink(path.join(directory, "exe"))).replace(/ \(deleted\)$/, "");
      if (!["chrome", "chromium", "chromium-browser", "google-chrome", "google-chrome-stable"].includes(executable)) continue;
      const args = chromeArguments(await readFile(path.join(directory, "cmdline")));
      if (args.some(arg => arg === "--type" || arg.startsWith("--type="))) continue;
      if (!args.some((arg, index) => arg === `--user-data-dir=${profile}` || arg === "--user-data-dir" && args[index + 1] === profile)) continue;
      const candidate = { pid: Number(pid), profile, profileDirectory };
      await verifyExtensionProcess(candidate, procRoot); matches.push(candidate);
    } catch (error) { if (!["ENOENT", "ESRCH", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  }
  if (matches.length !== 1) throw extensionChanged(); return matches[0];
}
