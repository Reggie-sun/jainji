import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";

const unavailable = "原账号浏览器绑定丢失、损坏或保存结果未知，请人工核查；不会另开登录目录。";
const BindingSchema = z.object({
  advertiserId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  profile: z.string().min(1).max(4096).refine(value => path.isAbsolute(value) && !/[\x00-\x1f]/.test(value)),
  profileDirectory: z.string().min(1).max(100).refine(value => !/[\/\\\x00-\x1f]/.test(value) && ![".", ".."].includes(value)),
  windowClass: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
}).strict();
const StateSchema = z.object({ version: z.literal(1), bindings: z.array(BindingSchema).max(6) }).strict().superRefine((state, ctx) => {
  for (const field of ["advertiserId", "profile"] as const) {
    if (new Set(state.bindings.map(binding => binding[field])).size !== state.bindings.length) ctx.addIssue({ code: "custom", message: "duplicate binding" });
  }
});
export type QianchuanBrowserBinding = z.infer<typeof BindingSchema>;

/** A private user-data root protects its owned direct child; never opens Chrome login state. */
export async function verifyOriginalProfile(binding: QianchuanBrowserBinding): Promise<void> {
  try {
    BindingSchema.parse(binding);
    for (const directory of [binding.profile, path.join(binding.profile, binding.profileDirectory)]) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (directory === binding.profile && (info.mode & 0o077)) || await realpath(directory) !== directory) throw new Error(unavailable);
    }
  } catch { throw new Error(unavailable); }
}

/** Private canonical metadata. Presence of this directory commits to a valid binding file. */
export class QianchuanBrowserBindings {
  private readonly directory: string;
  private readonly file: string;
  private writes: Promise<unknown> = Promise.resolve();
  private known = false;
  private blocked = false;
  constructor(root: string) { this.directory = path.resolve(root, "account-browser-bindings"); this.file = path.join(this.directory, "bindings.json"); }

  private async read(): Promise<QianchuanBrowserBinding[]> {
    if (this.blocked) throw new Error(unavailable);
    try {
      try { await lstat(this.directory); }
      catch (error) { if (!this.known && (error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
      this.known = true; await secureUploadDirectory(this.directory);
      const before = await lstat(this.file);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o7177) || before.size > 8192 || await realpath(this.file) !== this.file) throw new Error(unavailable);
      const handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = await handle.stat();
        if (opened.dev !== before.dev || opened.ino !== before.ino || opened.ctimeMs !== before.ctimeMs) throw new Error(unavailable);
        const bytes = Buffer.alloc(8193); let length = 0;
        while (length < bytes.length) { const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null); if (!bytesRead) break; length += bytesRead; }
        const after = await handle.stat(), current = await lstat(this.file);
        if (length !== before.size || after.size !== before.size || after.ctimeMs !== before.ctimeMs || current.dev !== before.dev || current.ino !== before.ino || current.ctimeMs !== before.ctimeMs || await realpath(this.file) !== this.file) throw new Error(unavailable);
        return StateSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)))).bindings;
      } finally { await handle.close(); }
    } catch { throw new Error(unavailable); }
  }
  get(advertiserId: string): Promise<QianchuanBrowserBinding | undefined> {
    const pending = this.writes.catch(() => undefined).then(async () => (await this.read()).find(binding => binding.advertiserId === advertiserId));
    this.writes = pending; return pending;
  }

  save(binding: QianchuanBrowserBinding): Promise<void> {
    const pending = this.writes.catch(() => undefined).then(async () => {
      await verifyOriginalProfile(binding);
      // Read before creating the directory: a missing file in an existing directory is a failure.
      await this.read();
      await secureUploadDirectory(path.dirname(this.directory)); await secureUploadDirectory(this.directory);
      const lockPath = path.join(this.directory, "write.lock");
      const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error(unavailable); });
      let published = false;
      const temporary = path.join(this.directory, `binding-${randomUUID()}.tmp`);
      try {
        // First writer owns the empty directory. A concurrent writer or a later read cannot treat it as unbound.
        let bindings: QianchuanBrowserBinding[];
        try { await lstat(this.file); bindings = await this.read(); }
        catch (error) { if (!this.known && (error as NodeJS.ErrnoException).code === "ENOENT") bindings = []; else throw error; }
        const old = bindings.find(value => value.advertiserId === binding.advertiserId);
        if (old) { if (JSON.stringify(old) !== JSON.stringify(binding)) throw new Error(unavailable); return; }
        if (bindings.some(value => value.profile === binding.profile)) throw new Error("该原浏览器已绑定其他账号，请使用各账号独立窗口。");
        const state = StateSchema.parse({ version: 1, bindings: [...bindings, binding] });
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, this.file); published = true;
        await strictSyncDirectory(this.directory); await strictSyncDirectory(path.dirname(this.directory)); this.known = true;
      } catch (error) { if (published) this.blocked = true; throw error; }
      finally {
        await unlink(temporary).catch(() => undefined);
        try { await lock.close(); await unlink(lockPath); } catch { this.blocked = true; throw new Error(unavailable); }
      }
    });
    this.writes = pending; return pending;
  }
}
