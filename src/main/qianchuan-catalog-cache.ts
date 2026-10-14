import { createHash, randomUUID } from "node:crypto";
import { lstat, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { QianchuanProductSchema } from "../shared/qianchuan-account.js";
import { QianchuanCurrentAccountSchema, QianchuanPlanListSchema } from "../shared/qianchuan-plan-selection.js";
import { QianchuanSubaccountCatalogSchema } from "../shared/qianchuan-subaccounts.js";
import { readPrivateJson } from "./qianchuan-account-config.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";

const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const BindingSchema = z.object({ product: QianchuanProductSchema, anchor: QianchuanCurrentAccountSchema.shape.advertiserId,
  kind: z.enum(["directory", "saved-plans", "current-plans"]), advertiserId: QianchuanCurrentAccountSchema.shape.advertiserId }).strict();
export type CatalogBinding = z.infer<typeof BindingSchema>;
const PlanDataSchema = z.object({ plans: QianchuanPlanListSchema, account: QianchuanCurrentAccountSchema.optional() }).strict();
const RecordSchema = z.object({ version: z.literal(1), binding: BindingSchema, configDigest: z.string().regex(/^[a-f0-9]{64}$/),
  readAt: z.number().int().nonnegative(), data: z.union([PlanDataSchema, QianchuanSubaccountCatalogSchema]) }).strict().superRefine((record, ctx) => {
  const { binding, data } = record;
  const valid = binding.kind === "directory"
    ? binding.advertiserId === binding.anchor && "accounts" in data && !data.cache
    : "plans" in data && data.plans.every(plan => plan.advertiserId === binding.advertiserId) && (binding.kind === "current-plans"
      ? data.account?.advertiserId === binding.advertiserId && data.plans.every(plan => plan.accountSource === "current-browser")
      : binding.advertiserId === binding.anchor && !data.account && data.plans.every(plan => !plan.accountSource));
  if (!valid) ctx.addIssue({ code: "custom", message: "目录缓存身份不匹配。" });
});
export type CatalogRecord = z.infer<typeof RecordSchema>;
export type CatalogData = CatalogRecord["data"];

/** Historical display only. Production readers never consume these records. */
export class QianchuanCatalogCache {
  private readonly directory: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(root: string) { this.directory = path.join(path.resolve(root), "catalog-cache"); }
  private file(binding: CatalogBinding): string {
    const key = JSON.stringify([binding.product, binding.anchor, binding.kind, binding.advertiserId]);
    return path.join(this.directory, `${createHash("sha256").update(key).digest("hex")}.json`);
  }
  async get(binding: CatalogBinding): Promise<CatalogRecord | undefined> {
    try {
      BindingSchema.parse(binding);
      const directory = await lstat(this.directory);
      if (!directory.isDirectory() || directory.isSymbolicLink() || directory.mode & 0o7077 || directory.uid !== process.getuid?.() || await realpath(this.directory) !== this.directory) return;
      const { value } = await readPrivateJson(this.file(binding), input => RecordSchema.parse(input), MAX_CACHE_BYTES);
      if (JSON.stringify(value.binding) !== JSON.stringify(binding) || value.readAt > Date.now()) return;
      return value;
    } catch { return; }
  }
  async put(binding: CatalogBinding, configDigest: string, data: CatalogData, readAt: number): Promise<boolean> {
    const write = this.tail.catch(() => undefined).then(async () => {
      let temporary: string | undefined;
      try {
        const record = RecordSchema.parse({ version: 1, binding, configDigest, data, readAt });
        const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
        if (bytes.length > MAX_CACHE_BYTES) return false;
        await secureUploadDirectory(this.directory);
        const file = this.file(binding);
        // Refuse an unsafe existing target; replacing a private corrupt JSON record is safe.
        try {
          const info = await lstat(file);
          if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o7177 || info.uid !== process.getuid?.()) return false;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        temporary = `${file}.${randomUUID()}.tmp`;
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await secureUploadDirectory(this.directory);
        await rename(temporary, file); temporary = undefined;
        await strictSyncDirectory(this.directory);
        return true;
      } catch { return false; }
      finally { if (temporary) await rm(temporary, { force: true }).catch(() => undefined); }
    });
    this.tail = write;
    return write;
  }
}
