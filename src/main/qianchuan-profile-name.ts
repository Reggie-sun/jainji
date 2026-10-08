import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { verifyOriginalProfile, type QianchuanBrowserBinding } from "./qianchuan-browser-bindings.js";

/** Optional display metadata only. Never reads cookies, Preferences or login state. */
export async function readQianchuanProfileName(binding: QianchuanBrowserBinding): Promise<string | undefined> {
  try {
    await verifyOriginalProfile(binding);
    const file = path.join(binding.profile, "Local State"), limit = 1024 * 1024;
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o022) || before.size > limit || await realpath(file) !== file) return undefined;
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.ctimeMs !== before.ctimeMs) return undefined;
      const bytes = Buffer.alloc(limit + 1); let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat(), current = await lstat(file);
      if (length !== before.size || after.ctimeMs !== before.ctimeMs || current.dev !== before.dev || current.ino !== before.ino || current.ctimeMs !== before.ctimeMs || await realpath(file) !== file) return undefined;
      const state = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
      const name: unknown = state?.profile?.info_cache?.[binding.profileDirectory]?.name;
      if (typeof name !== "string" || !name.trim() || name.length > 256 || /[\u0000-\u001f\u007f]/.test(name)) return undefined;
      return name.trim();
    } finally { await handle.close(); }
  } catch { return undefined; }
}
