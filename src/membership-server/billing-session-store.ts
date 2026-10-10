import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { MembershipServerConfig } from "./policy.js";

export const BILLING_SESSION_SECONDS = 30 * 24 * 3600;
const SessionSchema = z.object({ token: z.string().min(1).max(16384), csrf: z.string().regex(/^[a-f0-9]{64}$/), expires: z.number().int().positive() }).strict();
export type BillingSession = z.infer<typeof SessionSchema>;
const validId = (id: string) => /^[a-f0-9]{64}$/.test(id);

/** Durable browser transport only. Casdoor remains the authority on every authenticated request. */
export class FileBillingSessionStore {
  private readonly root: string;
  private readonly binding: Buffer;
  private readonly key: Buffer;
  private writes = Promise.resolve();
  constructor(root: string, config: MembershipServerConfig, private readonly clock = Date.now) {
    this.root = path.join(root, "sessions");
    const { clientSecret, ...publicConfig } = config;
    this.binding = createHash("sha256").update(JSON.stringify(publicConfig)).digest();
    this.key = Buffer.from(hkdfSync("sha256", clientSecret, this.binding, "jianji-billing-session-v1", 32));
  }
  private async directory(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const s = await lstat(this.root);
    if (!s.isDirectory() || s.mode & 0o077 || process.getuid && s.uid !== process.getuid()) throw new Error("Invalid session directory.");
  }
  async get(id: string): Promise<BillingSession | undefined> {
    if (!validId(id)) return undefined;
    await this.directory();
    let file;
    try { file = await open(path.join(this.root, id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; }
    let bytes: Buffer;
    try {
      const s = await file.stat();
      if (!s.isFile() || s.mode & 0o077 || s.size > 65536 || process.getuid && s.uid !== process.getuid()) throw new Error("Invalid session file.");
      bytes = Buffer.alloc(65537);
      const result = await file.read(bytes, 0, bytes.length, 0); bytes = bytes.subarray(0, result.bytesRead);
      if (bytes.length > 65536) throw new Error("Invalid session size.");
    } finally { await file.close(); }
    let session: BillingSession;
    try {
      if (bytes.length < 29 || bytes[0] !== 1) return undefined;
      const cipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(1, 13));
      cipher.setAAD(Buffer.concat([this.binding, Buffer.from(id)])); cipher.setAuthTag(bytes.subarray(13, 29));
      session = SessionSchema.parse(JSON.parse(Buffer.concat([cipher.update(bytes.subarray(29)), cipher.final()]).toString()));
    } catch { return undefined; }
    if (session.expires <= this.clock()) { await this.remove(id); return undefined; }
    return session;
  }
  put(id: string, session: BillingSession): Promise<void> {
    const write = this.writes.then(() => this.create(id, session));
    this.writes = write.catch(() => {}); return write;
  }
  private async create(id: string, session: BillingSession): Promise<void> {
    if (!validId(id)) throw new Error("Invalid session id.");
    SessionSchema.parse(session); await this.directory();
    // Bound disk usage and reclaim expired or invalid records when a new login is created.
    const files = (await readdir(this.root)).filter(validId);
    let active = 0;
    for (const file of files) { if (await this.get(file)) ++active; else await this.remove(file); }
    if (active >= 1000) throw new Error("Session capacity reached.");
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.concat([this.binding, Buffer.from(id)]));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
    const file = await open(path.join(this.root, id), "wx", 0o600);
    try { await file.writeFile(Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted])); await file.sync(); }
    finally { await file.close(); }
    await this.syncDirectory();
  }
  async remove(id: string): Promise<void> {
    if (validId(id)) {
      await unlink(path.join(this.root, id)).catch(e => { if (e.code !== "ENOENT") throw e; });
      await this.syncDirectory();
    }
  }
  private async syncDirectory(): Promise<void> {
    const directory = await open(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
