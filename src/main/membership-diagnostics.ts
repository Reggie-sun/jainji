import { constants } from "node:fs";
import { mkdir, lstat, open, rename } from "node:fs/promises";
import path from "node:path";
import { MembershipDiagnosticSchema, type MembershipDiagnostic } from "./membership-check.js";

const MAX_BYTES = 64 * 1024;
export function membershipDiagnostics(root: string): (event: MembershipDiagnostic) => Promise<void> {
  const directory = path.join(root, "diagnostics");
  const file = path.join(directory, "membership-network.jsonl"), previous = `${file}.1`;
  let pending = Promise.resolve();
  return event => {
    const safe = MembershipDiagnosticSchema.safeParse(event);
    if (!safe.success) return Promise.resolve();
    const line = `${JSON.stringify(safe.data)}\n`;
    pending = pending.then(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const dir = await lstat(directory);
      if (!dir.isDirectory() || dir.isSymbolicLink()) return;
      for (const target of [file, previous]) {
        const stat = await lstat(target).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
        if (stat && (!stat.isFile() || stat.isSymbolicLink())) return;
      }
      const stat = await lstat(file).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
      if (stat && stat.size + Buffer.byteLength(line) > MAX_BYTES) await rename(file, previous);
      const handle = await open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try { await handle.appendFile(line, "utf8"); } finally { await handle.close(); }
    }).catch(() => {});
    return pending;
  };
}
