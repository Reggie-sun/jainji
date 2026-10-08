import { link, lstat, open, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readPrivateJson, type FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { QianchuanPlanRecoverySchema, type QianchuanPendingPlanDeletion } from "../shared/qianchuan-video-library.js";

const id = z.string().regex(/^[1-9][0-9]{0,19}$/);
const pendingSchema = z.object({ version: z.literal(1), attempt: z.string().uuid(), advertiserId: id, adId: id,
  ids: z.array(id).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
  zeroWindow: z.object({ startTime: z.string(), endTime: z.string(), createdBefore: z.string().optional() }).strict().optional(),
}).strict();
const dispositionSchema = QianchuanPlanRecoverySchema.extend({ version: z.literal(1), outcome: z.literal("UNKNOWN"), handledAt: z.string().datetime() }).strict();
const changed = () => new Error("待核查清理记录或历史凭据无法核对，请重新查看；未恢复自动清理。");
async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** Persistence helper for the existing plan-cleanup owner; never connects to the platform. */
export class QianchuanPlanMaterialRecovery {
  readonly gate: string;
  private readonly history: string;
  constructor(private readonly directory: string, private readonly target: FrozenQianchuanAccount) {
    this.gate = path.join(directory, `${target.advertiserId}-${target.adId}.pending.json`);
    this.history = path.join(directory, "manual-history", `${target.advertiserId}-${target.adId}`);
  }
  private async readPending(file: string) {
    const result = await readPrivateJson(file, input => pendingSchema.parse(input));
    if (result.value.advertiserId !== this.target.advertiserId || result.value.adId !== this.target.adId) throw changed();
    return result;
  }
  async pending(): Promise<QianchuanPendingPlanDeletion | undefined> {
    if (!await exists(this.gate)) return undefined;
    const { value, digest } = await this.readPending(this.gate);
    return { adId: value.adId, attempt: value.attempt, digest, ids: value.ids, ...(value.zeroWindow ? { zeroWindow: value.zeroWindow } : {}) };
  }
  async protectedIds(): Promise<Set<string>> {
    if (!await exists(this.history)) return new Set();
    await secureUploadDirectory(this.history);
    const names = await readdir(this.history), ids = new Set<string>();
    if (names.length > 2000 || names.length % 2) throw changed();
    for (const name of names) {
      if (name.endsWith(".pending.json")) continue;
      const attempt = name.replace(/\.json$/, "");
      if (!z.string().uuid().safeParse(attempt).success || !names.includes(`${attempt}.pending.json`)) throw changed();
      const archived = await this.readPending(path.join(this.history, `${attempt}.pending.json`));
      const { value: disposition } = await readPrivateJson(path.join(this.history, name), input => dispositionSchema.parse(input));
      if (archived.value.attempt !== attempt || disposition.attempt !== attempt || disposition.digest !== archived.digest ||
        disposition.advertiserId !== this.target.advertiserId || disposition.adId !== this.target.adId) throw changed();
      for (const id of archived.value.ids) ids.add(id);
    }
    if (names.filter(name => name.endsWith(".pending.json")).length !== names.length / 2) throw changed();
    return ids;
  }
  async resolve(input: unknown, guard: () => Promise<void>): Promise<void> {
    const request = QianchuanPlanRecoverySchema.parse(input);
    if (request.product !== this.target.product || request.advertiserId !== this.target.advertiserId || request.adId !== this.target.adId) throw changed();
    await secureUploadDirectory(this.directory);
    const lockPath = path.join(this.directory, `${this.target.advertiserId}.operation.lock`);
    const lock = await open(lockPath, "wx", 0o600);
    try {
      await guard();
      const pending = await this.pending();
      if (!pending || pending.digest !== request.digest || pending.attempt !== request.attempt) throw changed();
      await secureUploadDirectory(path.dirname(this.history)); await strictSyncDirectory(this.directory);
      await secureUploadDirectory(this.history); await strictSyncDirectory(path.dirname(this.history));
      const archive = path.join(this.history, `${pending.attempt}.pending.json`), receipt = path.join(this.history, `${pending.attempt}.json`);
      // A hard link preserves the exact raw bytes; exclusive publication never overwrites history.
      if (!await exists(archive)) await link(this.gate, archive);
      await strictSyncDirectory(this.history);
      if ((await this.readPending(archive)).digest !== request.digest) throw changed();
      await guard();
      if (!await exists(receipt)) {
        const file = await open(receipt, "wx", 0o600);
        try { await file.writeFile(JSON.stringify({ ...request, version: 1, outcome: "UNKNOWN", handledAt: new Date().toISOString() })); await file.sync(); }
        finally { await file.close(); }
        await strictSyncDirectory(this.history);
      }
      // Partial or mismatched archive/receipt pairs never authorize removing the active gate.
      await this.protectedIds();
      const durableReceipt = await open(receipt, "r");
      try { await durableReceipt.sync(); } finally { await durableReceipt.close(); }
      await strictSyncDirectory(this.history);
      await guard();
      if ((await this.pending())?.digest !== request.digest) throw changed();
      await unlink(this.gate); await strictSyncDirectory(this.directory);
    } finally { await lock.close(); await unlink(lockPath); await strictSyncDirectory(this.directory); }
  }
}
