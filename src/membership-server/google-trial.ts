import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as SqliteDatabase } from "node:sqlite";
import { z } from "zod";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const GOOGLE_TRIAL_MS = 3 * 24 * 60 * 60 * 1000;
export type TrialIdentity = { owner: string; id: string; google?: string };
export interface GoogleTrialStore {
  claim(user: TrialIdentity, now: Date): string | null;
  expiry(user: TrialIdentity, now: Date): string | null;
}

const SCHEMA = `
  CREATE TABLE metadata (version INTEGER NOT NULL CHECK(version = 1));
  INSERT INTO metadata VALUES (1);
  CREATE TABLE trials (
    google_key TEXT PRIMARY KEY NOT NULL,
    user_key TEXT UNIQUE NOT NULL,
    started_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL CHECK(expires_at = started_at + ${GOOGLE_TRIAL_MS})
  ) STRICT;
`;

/** Server-only anti-reuse ledger. Account deletion must never delete these rows. */
export class SqliteGoogleTrialStore implements GoogleTrialStore {
  private readonly db: SqliteDatabase;
  private readonly identity: { dev: number; ino: number };

  static initialize(filename: string): void {
    // Exclusive creation is intentional: initialization must not replace a used ledger.
    const descriptor = openSync(filename, "wx", 0o600);
    closeSync(descriptor);
    const db = new DatabaseSync(filename);
    try {
      db.exec("PRAGMA synchronous = FULL; BEGIN IMMEDIATE;");
      db.exec(SCHEMA);
      db.exec("COMMIT;");
    } finally { db.close(); }
  }

  constructor(private readonly filename: string) {
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size === 0 || realpathSync(filename) !== filename) throw new Error("试用记录文件无效。");
    this.identity = { dev: stat.dev, ino: stat.ino };
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec("PRAGMA synchronous = FULL; PRAGMA busy_timeout = 2000;");
      z.array(z.object({ version: z.literal(1) })).length(1).parse(this.db.prepare("SELECT version FROM metadata").all());
      this.db.prepare("SELECT google_key, user_key, started_at, expires_at FROM trials LIMIT 0").all();
    } catch (error) { this.db.close(); throw error; }
  }

  close(): void { this.db.close(); }

  claim(user: TrialIdentity, now: Date): string | null {
    const keys = this.keys(user);
    if (!keys) return null;
    this.checkFile();
    const start = now.getTime();
    if (!Number.isSafeInteger(start) || start < 0) throw new Error("试用时间无效。");
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.prepare("INSERT INTO trials (google_key, user_key, started_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
        .run(keys.google, keys.user, start, start + GOOGLE_TRIAL_MS);
      const result = this.expiry(user, now);
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  expiry(user: TrialIdentity, now: Date): string | null {
    const keys = this.keys(user);
    if (!keys) return null;
    this.checkFile();
    const row = z.object({ user_key: z.string(), started_at: z.number().int().nonnegative(), expires_at: z.number().int().nonnegative() }).optional()
      .parse(this.db.prepare("SELECT user_key, started_at, expires_at FROM trials WHERE google_key = ?").get(keys.google));
    if (!row || row.user_key !== keys.user) return null;
    if (typeof row.started_at !== "number" || typeof row.expires_at !== "number" || row.expires_at !== row.started_at + GOOGLE_TRIAL_MS) throw new Error("试用记录损坏。");
    const time = now.getTime();
    if (!Number.isSafeInteger(time)) throw new Error("试用时间无效。");
    return time >= row.started_at && time < row.expires_at ? new Date(row.expires_at).toISOString() : null;
  }

  private keys(user: TrialIdentity): { google: string; user: string } | null {
    if (!user.google) return null;
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(user.google) || !user.owner || !user.id) throw new Error("Google 身份无效。");
    const digest = (value: string[]) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    return { google: digest([user.owner, "google", user.google]), user: digest([user.owner, "user", user.id]) };
  }

  private checkFile(): void {
    const stat = lstatSync(this.filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== this.identity.dev || stat.ino !== this.identity.ino || (stat.mode & 0o077) !== 0) throw new Error("试用记录已变化。");
  }
}
