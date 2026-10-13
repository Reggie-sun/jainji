import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { QIANCHUAN_EXTENSION_ORIGIN, QIANCHUAN_NATIVE_HOST, extensionUnavailable } from "./qianchuan-extension-protocol.js";

const description = "Jianji Qianchuan native bridge v1";
export interface ExtensionHostConfig { version: 1; port: number; token: string; extensionOrigin: string; }
export function qianchuanExtensionResources(): string {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return resources && !process.defaultApp ? path.join(resources, "qianchuan-extension") : path.resolve(typeof __dirname === "string" ? path.join(__dirname, "..") : process.cwd(), "resources", "qianchuan-extension");
}
async function privateWrite(file: string, bytes: Buffer | string, mode: number): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  let handle;
  try {
    try { const old = await lstat(file); if (!old.isFile() || old.isSymbolicLink() || old.uid !== process.getuid?.() || old.mode & 0o022) throw extensionUnavailable(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    handle = await open(temporary, "wx", mode); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
    await rename(temporary, file); await strictSyncDirectory(path.dirname(file));
  } finally { await handle?.close(); await unlink(temporary).catch(() => undefined); }
}
const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;
/** Chrome resolves native hosts relative to its actual user-data directory. */
export async function registerQianchuanExtensionProfile(root: string, profile: string): Promise<void> {
  if (!path.isAbsolute(profile) || await realpath(profile) !== profile) throw extensionUnavailable();
  const owner = await lstat(profile);
  if (!owner.isDirectory() || owner.isSymbolicLink() || owner.uid !== process.getuid?.() || owner.mode & 0o022) throw extensionUnavailable();
  const hostDirectory = path.join(profile, "NativeMessagingHosts");
  await mkdir(hostDirectory, { recursive: true, mode: 0o700 });
  const info = await lstat(hostDirectory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.mode & 0o022 || await realpath(hostDirectory) !== hostDirectory) throw extensionUnavailable();
  const launcher = path.resolve(root, "qianchuan-extension", "native-host"), file = path.join(hostDirectory, `${QIANCHUAN_NATIVE_HOST}.json`);
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { const old = await handle.stat(); if (!old.isFile() || old.uid !== process.getuid?.() || old.mode & 0o022 || old.size > 4096) throw extensionUnavailable(); const value = JSON.parse(await handle.readFile("utf8")); if (value.name !== QIANCHUAN_NATIVE_HOST || value.description !== description || value.path !== launcher) throw extensionUnavailable(); }
    finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await privateWrite(file, JSON.stringify({ name: QIANCHUAN_NATIVE_HOST, description, path: launcher, type: "stdio", allowed_origins: [QIANCHUAN_EXTENSION_ORIGIN] }) + "\n", 0o600);
}
/** Install only app-owned host metadata; never read or edit Chrome login/settings files. */
export async function installQianchuanExtensionHost(root: string, config: ExtensionHostConfig, options: { home?: string; profiles?: string[]; resources?: string; executable?: string } = {}): Promise<void> {
  if (process.platform !== "linux" || config.extensionOrigin !== QIANCHUAN_EXTENSION_ORIGIN) throw extensionUnavailable();
  const directory = path.resolve(root, "qianchuan-extension");
  await secureUploadDirectory(directory);
  const configFile = path.join(directory, "connection.json"), helper = path.join(directory, "native-host.mjs"), launcher = path.join(directory, "native-host");
  const source = await open(path.join(options.resources ?? qianchuanExtensionResources(), "native-host.mjs"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes: Buffer;
  try { const info = await source.stat(); if (!info.isFile() || info.size > 256 * 1024) throw extensionUnavailable(); bytes = await source.readFile(); } finally { await source.close(); }
  await privateWrite(helper, bytes, 0o600);
  await privateWrite(configFile, `${JSON.stringify(config)}\n`, 0o600);
  await privateWrite(launcher, `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ${quote(options.executable ?? process.execPath)} ${quote(helper)} ${quote(configFile)} "$@"\n`, 0o700);
  for (const profile of options.profiles ?? []) await registerQianchuanExtensionProfile(root, profile);
}
