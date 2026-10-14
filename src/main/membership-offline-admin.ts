import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MembershipPasswordLoginSchema, type MembershipPasswordLogin, type MembershipStatus } from "../shared/membership.js";

export interface OfflineAdminEncryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export interface OfflineAdminAuthority {
  login(input: MembershipPasswordLogin, signal: AbortSignal): Promise<string>;
  check(token: string, signal: AbortSignal): Promise<MembershipStatus>;
}
const PREFIX = "jianji-offline-admin:";
export const isOfflineAdminToken = (token: string): boolean => token.startsWith(PREFIX);
const CredentialSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), username: z.string().email().max(254),
  salt: z.string().regex(/^[a-f0-9]{32}$/), verifier: z.string().regex(/^[a-f0-9]{128}$/),
  sessionKey: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const secure = (encryption: OfflineAdminEncryption) => encryption.isEncryptionAvailable()
  && encryption.getSelectedStorageBackend?.() !== "basic_text";
const derive = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, Buffer.from(salt, "hex"), 64, (error, key) => error ? reject(error) : resolve(key));
});
const privateFile = (mode: number, uid: number) => process.platform === "win32"
  || ((mode & 0o077) === 0 && uid === process.getuid?.());

async function readCredential(root: string, encryption: OfflineAdminEncryption) {
  if (!secure(encryption)) throw new Error("本机管理员需要安全的系统密钥环。");
  const directory = path.join(root, "membership");
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !privateFile(metadata.mode, metadata.uid)) throw new Error("本机授权目录无效。");
  const filename = path.join(directory, "offline-admin.enc");
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("本机授权文件无效。");
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !privateFile(stat.mode, stat.uid) || stat.size > 16_384) throw new Error("本机授权文件无效。");
    const bytes = Buffer.alloc(16_385);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead === 0 || bytesRead > 16_384) throw new Error("本机授权文件无效。");
    const after = await lstat(filename);
    if (before.dev !== stat.dev || before.ino !== stat.ino || stat.dev !== after.dev || stat.ino !== after.ino
      || !after.isFile() || after.isSymbolicLink() || !privateFile(after.mode, after.uid)) throw new Error("本机授权文件已变化。");
    return CredentialSchema.parse(JSON.parse(encryption.decryptString(bytes.subarray(0, bytesRead))));
  } finally { await file.close(); }
}

/** OS-local provisioning only; never exposed as renderer IPC or a public account API. */
export async function provisionOfflineAdmin(root: string, input: MembershipPasswordLogin, encryption: OfflineAdminEncryption): Promise<void> {
  const credentials = MembershipPasswordLoginSchema.parse(input);
  if (!secure(encryption)) throw new Error("本机管理员需要安全的系统密钥环。");
  const salt = randomBytes(16).toString("hex");
  const record = { version: 1, id: randomUUID(), username: credentials.username, salt,
    verifier: (await derive(credentials.password, salt)).toString("hex"), sessionKey: randomBytes(32).toString("hex") };
  const bytes = encryption.encryptString(JSON.stringify(record));
  const directory = path.join(root, "membership");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !privateFile(stat.mode, stat.uid)) throw new Error("本机授权目录无效。");
  const temporary = path.join(directory, `offline-admin.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    // Publish completely written bytes exclusively; never replace an existing authorization.
    await link(temporary, path.join(directory, "offline-admin.enc"));
    if (process.platform !== "win32") {
      const directoryHandle = await open(directory, "r");
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    }
  } finally { await rm(temporary, { force: true }); }
}

export async function loadOfflineAdmin(root: string, encryption: OfflineAdminEncryption): Promise<OfflineAdminAuthority | undefined> {
  try { await readCredential(root, encryption); } catch { return undefined; }
  return {
    async login(input, signal) {
      const credentials = MembershipPasswordLoginSchema.parse(input);
      const record = await readCredential(root, encryption);
      signal.throwIfAborted();
      const hash = await derive(credentials.password, record.salt);
      signal.throwIfAborted();
      if (credentials.username !== record.username || !timingSafeEqual(hash, Buffer.from(record.verifier, "hex"))) throw new Error("帐号或密码错误。");
      const payload = `${record.id}.${randomBytes(32).toString("hex")}`;
      const signature = createHmac("sha256", Buffer.from(record.sessionKey, "hex")).update(payload).digest("hex");
      return `${PREFIX}${payload}.${signature}`;
    },
    async check(token, signal) {
      const denied: MembershipStatus = { state: "denied", reason: "session-expired", message: "本机管理员登录已失效，请重新登录。" };
      try {
        if (!isOfflineAdminToken(token) || token.length > 200) return denied;
        const record = await readCredential(root, encryption);
        signal.throwIfAborted();
        const [id, nonce, signature, extra] = token.slice(PREFIX.length).split(".");
        if (extra !== undefined || id !== record.id || !/^[a-f0-9]{64}$/.test(nonce ?? "") || !/^[a-f0-9]{64}$/.test(signature ?? "")) return denied;
        const expected = createHmac("sha256", Buffer.from(record.sessionKey, "hex")).update(`${id}.${nonce}`).digest();
        if (!timingSafeEqual(expected, Buffer.from(signature!, "hex"))) return denied;
        return { state: "allowed", reason: "offline-admin", message: "本机超级管理员 · 永久使用权限",
          user: { id: record.id, name: record.username, displayName: record.username, isAdmin: true }, checkedAt: new Date().toISOString() };
      } catch { return denied; }
    },
  };
}
