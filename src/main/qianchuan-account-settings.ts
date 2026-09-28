import { randomUUID } from "node:crypto";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { QianchuanAccountConfigReader, readPrivateConfig, type FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { parseQianchuanPlanUrl, QianchuanAccountSettingsSchema, QianchuanAccountSetupSchema, type QianchuanAccount, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account.js";

const parseSettings = (value: unknown) => QianchuanAccountSettingsSchema.parse(value).accounts;

/** One app-owned mapping. Imported JSON is read-only input, never a live second owner. */
export class QianchuanAccountSettings extends QianchuanAccountConfigReader {
  readonly file: string;
  private readonly directory: string;
  private writes: Promise<unknown> = Promise.resolve();
  private blocked = false;
  private hasMapping = false;
  constructor(root: string) {
    super(parseSettings);
    this.directory = path.resolve(root, "accounts"); this.file = path.join(this.directory, "mapping.json");
  }
  private async exists(): Promise<boolean> {
    try { await lstat(this.file); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  private edit(action: () => Promise<QianchuanAccountSummary[]>): Promise<QianchuanAccountSummary[]> {
    const pending = this.writes.catch(() => undefined).then(async () => {
      if (this.blocked) throw new Error("账号设置保存结果未知，请重启简辑核查。");
      await secureUploadDirectory(this.directory);
      if (this.hasMapping && !await this.exists()) throw new Error("已保存的账号设置丢失，请人工核查。");
      // Explicit lock rejects another writer; stale locks require human investigation.
      const lock = await open(path.join(this.directory, "write.lock"), "wx", 0o600).catch(() => { throw new Error("账号设置正在保存，请稍后重试。若应用异常退出，请人工核查保存状态。"); });
      try { return await action(); }
      finally {
        try { await lock.close(); await unlink(path.join(this.directory, "write.lock")); }
        catch (error) { this.blocked = true; throw error; }
      }
    });
    this.writes = pending; return pending;
  }
  private async save(accounts: QianchuanAccount[]): Promise<QianchuanAccountSummary[]> {
    const value = QianchuanAccountSettingsSchema.parse({ version: 1, accounts });
    const temporary = path.join(this.directory, `mapping-${randomUUID()}.tmp`);
    let published = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, this.file); published = true; await strictSyncDirectory(this.directory);
      const summaries = await super.authorizeFile(this.file); this.hasMapping = true; return summaries;
    } catch (error) { if (published) this.blocked = true; throw error; }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  override async authorizeFile(source: string): Promise<QianchuanAccountSummary[]> {
    // Validate through the original strict, private six-account import boundary.
    const importer = new QianchuanAccountConfigReader(); await importer.authorizeFile(source);
    const imported = await readPrivateConfig(path.resolve(source));
    return this.edit(async () => {
      if (await this.exists()) await readPrivateConfig(this.file, parseSettings);
      return this.save(imported.accounts);
    });
  }
  async restore(legacyPath?: string): Promise<QianchuanAccountSummary[]> {
    if (await this.exists()) { const summaries = await super.authorizeFile(this.file); this.hasMapping = true; return summaries; }
    if (legacyPath) {
      if (path.resolve(legacyPath) === this.file) { this.hasMapping = true; throw new Error("已保存的账号设置丢失，请人工核查。"); }
      return this.authorizeFile(legacyPath);
    }
    return [];
  }
  private assertAvailable(): void { if (this.blocked) throw new Error("账号设置保存结果未知，请重启简辑核查。"); }
  override async refresh(): Promise<QianchuanAccountSummary[]> { this.assertAvailable(); return super.refresh(); }
  override async preflight(product: QianchuanProduct): Promise<FrozenQianchuanAccount> { this.assertAvailable(); return super.preflight(product); }
  override async freeze(product: QianchuanProduct, digest: string): Promise<FrozenQianchuanAccount> { this.assertAvailable(); return super.freeze(product, digest); }
  async savePlan(input: unknown): Promise<QianchuanAccountSummary[]> {
    const parsed = QianchuanAccountSetupSchema.parse(input), ids = parseQianchuanPlanUrl(parsed.planUrl);
    return this.edit(async () => {
      const accounts = await this.exists() ? (await readPrivateConfig(this.file, parseSettings)).accounts : [];
      const old = accounts.find(account => account.product === parsed.product);
      const cdpEndpoint = parsed.browserPort ? `http://127.0.0.1:${parsed.browserPort}` : old?.cdpEndpoint;
      if (!cdpEndpoint) throw new Error("首次设置该账号时，请填写已登录 Chrome 的浏览器端口。");
      const account: QianchuanAccount = { product: parsed.product, cdpEndpoint, ...ids };
      return this.save(old ? accounts.map(value => value.product === parsed.product ? account : value) : [...accounts, account]);
    });
  }
}
