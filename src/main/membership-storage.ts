import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  const binding = createHash("sha256").update(JSON.stringify(config ?? null)).digest("hex");
  const secure = () => encryption.isEncryptionAvailable() && encryption.getSelectedStorageBackend?.() !== "basic_text";
  return {
    async read() {
      if (!secure()) return undefined;
      const bytes = await readFile(file);
      if (bytes.length > 65_536) throw new Error("账号缓存无效。");
      const value: unknown = JSON.parse(encryption.decryptString(bytes));
      if (!value || typeof value !== "object" || !("binding" in value) || value.binding !== binding || !("token" in value) || typeof value.token !== "string" || !value.token || value.token.length > 32_768) return undefined;
      return value.token;
    },
    async write(token) {
      if (!token || !secure()) { await rm(file, { force: true }); return; }
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encryption.encryptString(JSON.stringify({ binding, token })), { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
    },
  };
}
