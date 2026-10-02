import { randomUUID } from "node:crypto";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { QianchuanAccountConfigReader, readPrivateConfig, type FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { QianchuanBrowserManager } from "./qianchuan-browser-manager.js";
import type { RunningChromeBrowser } from "./qianchuan-browser-discovery.js";
import { parseQianchuanPlanUrl, QianchuanAccountSettingsSchema, QianchuanAccountSetupSchema, QianchuanBrowserControlSchema, type QianchuanAccount, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account.js";

const parseSettings = (value: unknown) => QianchuanAccountSettingsSchema.parse(value).accounts;

/** One app-owned mapping. Imported JSON is read-only input, never a live second owner. */
export class QianchuanAccountSettings extends QianchuanAccountConfigReader {
  readonly file: string;
  private readonly directory: string;
  private writes: Promise<unknown> = Promise.resolve();
  private blocked = false;
  private hasMapping = false;
  private readonly preparedBrowsers = new Map<QianchuanProduct, { advertiserId: string; endpoint: string }>();
  private readonly browsers: QianchuanBrowserManager;
  private readonly discoverBrowser: (advertiserId: string) => Promise<string>;
  constructor(root: string, discoverBrowser?: (advertiserId: string) => Promise<string>) {
    super(parseSettings);
    this.directory = path.resolve(root, "accounts"); this.file = path.join(this.directory, "mapping.json");
    this.browsers = new QianchuanBrowserManager(root);
    this.discoverBrowser = discoverBrowser ?? (id => this.browsers.prepare(id));
  }
  async openBrowser(input: unknown): Promise<void> {
    this.assertAvailable();
    const parsed = QianchuanAccountSetupSchema.parse(input), ids = parseQianchuanPlanUrl(parsed.planUrl);
    await this.browsers.open(ids.advertiserId, true);
  }
  async controlBrowser(input: unknown, guard: (advertiserId: string, browser?: RunningChromeBrowser) => void): Promise<void> {
    this.assertAvailable();
    const parsed = QianchuanBrowserControlSchema.parse(input);
    await this.edit(async () => {
      const target = await super.preflight(parsed.product);
      if (target.advertiserId !== parsed.expectedAdvertiserId) throw new Error("账号设置已变化，未关闭任何浏览器，请重新选择账号。");
      guard(target.advertiserId);
      this.preparedBrowsers.delete(parsed.product);
      await this.browsers.control(target.advertiserId, parsed.action, browser => guard(target.advertiserId, browser));
      return super.refresh();
    });
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
  private withPreparedBrowser(target: FrozenQianchuanAccount): FrozenQianchuanAccount {
    const prepared = this.preparedBrowsers.get(target.product);
    return prepared?.advertiserId === target.advertiserId ? Object.freeze({ ...target, cdpEndpoint: prepared.endpoint }) : target;
  }
  override async preflight(product: QianchuanProduct): Promise<FrozenQianchuanAccount> { this.assertAvailable(); return this.withPreparedBrowser(await super.preflight(product)); }
  override async freeze(product: QianchuanProduct, digest: string): Promise<FrozenQianchuanAccount> { this.assertAvailable(); return this.withPreparedBrowser(await super.freeze(product, digest)); }
  /** Only new production discovers live connections; frozen and historical tasks retain their target. */
  override async prepare(product: QianchuanProduct): Promise<FrozenQianchuanAccount> {
    this.assertAvailable();
    const target = await super.preflight(product);
    const endpoint = await this.discoverBrowser(target.advertiserId);
    this.assertAvailable();
    await super.freeze(product, target.configDigest);
    this.preparedBrowsers.set(product, { advertiserId: target.advertiserId, endpoint });
    return this.withPreparedBrowser(target);
  }
  async savePlan(input: unknown): Promise<QianchuanAccountSummary[]> {
    const parsed = QianchuanAccountSetupSchema.parse(input), ids = parseQianchuanPlanUrl(parsed.planUrl);
    return this.edit(async () => {
      const accounts = await this.exists() ? (await readPrivateConfig(this.file, parseSettings)).accounts : [];
      const old = accounts.find(account => account.product === parsed.product);
      const cdpEndpoint = old?.advertiserId === ids.advertiserId ? old.cdpEndpoint : await this.discoverBrowser(ids.advertiserId);
      const account: QianchuanAccount = { ...old, product: parsed.product, cdpEndpoint, ...ids, ...(parsed.productName !== undefined ? { productName: parsed.productName } : {}) };
      return this.save(old ? accounts.map(value => value.product === parsed.product ? account : value) : [...accounts, account]);
    });
  }
}
