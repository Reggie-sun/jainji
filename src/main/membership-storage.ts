import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { MembershipStorage } from "./membership-session.js";
import type { MembershipConfig } from "../shared/membership.js";

interface Encryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export function membershipStorage(root: string, config: MembershipConfig | undefined, encryption: Encryption): MembershipStorage {
  const directory = path.join(root, "membership");
  const file = path.join(directory, "session.enc");
  const logoutIntent = path.join(directory, "logout-pending");
  const binding = createHash("sha256").update(JSON.stringify(config ?? null)).digest("hex");
  const secure = () => encryption.isEncryptionAvailable() && encryption.getSelectedStorageBackend?.() !== "basic_text";
  const syncDirectory = async () => {
    if (process.platform === "win32") return;
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  };
  return {
    async read() {
      if (!secure()) return undefined;
      try { await lstat(logoutIntent); return undefined; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      const bytes = await readFile(file);
      if (bytes.length > 65_536) throw new Error("账号缓存无效。");
      const value: unknown = JSON.parse(encryption.decryptString(bytes));
      if (!value || typeof value !== "object" || !("binding" in value) || value.binding !== binding || !("token" in value) || typeof value.token !== "string" || !value.token || value.token.length > 32_768) return undefined;
      return value.token;
    },
    async write(token) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (!token || !secure()) {
        // Persist logout before clearing credentials. A failed deletion must not revive them on restart.
        const intent = await open(logoutIntent, "w", 0o600);
        try { await intent.writeFile("logout\n"); await intent.sync(); } finally { await intent.close(); }
        await syncDirectory(); await rm(file, { force: true }); await syncDirectory(); return;
      }
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(encryption.encryptString(JSON.stringify({ binding, token }))); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, file);
        await syncDirectory();
        // Only a newly persisted login can remove the logout fence.
        await rm(logoutIntent, { force: true });
        await syncDirectory();
      } finally { await rm(temporary, { force: true }); }
    },
  };
}
