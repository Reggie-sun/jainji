import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";

const limit = 8 * 1024 * 1024;
export const automationDigest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
export async function readAutomationFile<T>(file: string, parse: (value: unknown) => T): Promise<T> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit || before.mode & 0o077 || process.getuid && before.uid !== process.getuid() || await realpath(file) !== file) throw new Error("定时配置文件权限或大小无效。");
    const buffer = Buffer.alloc(before.size + 1); let length = 0;
    while (length < buffer.length) { const read = await handle.read(buffer, length, buffer.length - length, null); if (!read.bytesRead) break; length += read.bytesRead; }
    const after = await handle.stat(), current = await lstat(file);
    if (length !== before.size || before.ino !== current.ino || before.dev !== current.dev || before.ctimeMs !== after.ctimeMs || before.mtimeMs !== current.mtimeMs || before.size !== after.size || current.isSymbolicLink()) throw new Error("定时配置读取期间发生变化。");
    return parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(buffer.subarray(0, length))));
  } finally { await handle.close(); }
}
export async function writeAutomationFile(file: string, value: unknown, exclusive = false): Promise<void> {
  const data = JSON.stringify(value);
  if (Buffer.byteLength(data) > limit) throw new Error("定时配置超过保存上限。");
  const directory = path.dirname(file); await secureUploadDirectory(directory);
  const temporary = exclusive ? file : path.join(directory, `${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    if (!exclusive) await rename(temporary, file);
    await strictSyncDirectory(directory);
  } finally { if (!exclusive) await unlink(temporary).catch(() => undefined); }
}
