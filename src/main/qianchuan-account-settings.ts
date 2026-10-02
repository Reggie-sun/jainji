import { randomUUID } from "node:crypto";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { QianchuanAccountConfigReader, readPrivateConfig, readPrivateJson, type FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { TemplateAccountBindingSchema, TemplateAccountSettingsSchema, type TemplateAccountBinding } from "../shared/batch-upload.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { QianchuanBrowserManager } from "./qianchuan-browser-manager.js";
import type { RunningChromeBrowser } from "./qianchuan-browser-discovery.js";
import { parseQianchuanPlanUrl, QianchuanAccountSettingsSchema, QianchuanAccountSetupSchema, QianchuanBrowserControlSchema, type QianchuanAccount, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account.js";
import { QianchuanLibraryClearSchema } from "../shared/qianchuan-video-library.js";

const parseSettings = (value: unknown) => QianchuanAccountSettingsSchema.parse(value).accounts;

/** One app-owned mapping. Imported JSON is read-only input, never a live second owner. */
export class QianchuanAccountSettings extends QianchuanAccountConfigReader {
  readonly file: string;
  private readonly directory: string;
  private writes: Promise<unknown> = Promise.resolve();
  private blocked = false;
  private hasMapping = false;
  private hasTemplateAccounts = false;
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
  async withVideoLibraryTargets<T>(input: unknown, action: (targets: FrozenQianchuanAccount[], fresh: () => Promise<void>, connect: (target: FrozenQianchuanAccount) => Promise<FrozenQianchuanAccount>) => Promise<T>): Promise<T> {
    this.assertAvailable();
    const parsed = QianchuanLibraryClearSchema.parse(input);
    return this.edit(async () => {
      const targets = await Promise.all(parsed.accounts.map(async account => {
        const target = await super.preflight(account.product);
        if (target.advertiserId !== account.expectedAdvertiserId) throw new Error("账号设置已变化，未删除视频，请重新选择账号。");
        return target;
      }));
      const fresh = async () => {
        this.assertAvailable();
        for (const target of targets) await super.freeze(target.product, target.configDigest);
      };
      await fresh();
      // Resolve per account so one unavailable Chrome does not hide other results.
      return action(targets, fresh, async target => {
        const cdpEndpoint = await this.discoverBrowser(target.advertiserId);
        await fresh();
        return Object.freeze({ ...target, cdpEndpoint });
      });
    });
  }
  private async exists(): Promise<boolean> {
    try { await lstat(this.file); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  private edit<T>(action: () => Promise<T>): Promise<T> {
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
    await this.savePrivateJson(this.file, value);
    try { const summaries = await super.authorizeFile(this.file); this.hasMapping = true; return summaries; }
    catch (error) { this.blocked = true; throw error; }
  }
  private async savePrivateJson(file: string, value: unknown): Promise<void> {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(content) > 64 * 1024) throw new Error("设置内容超过 64 KiB，请减少模板关联。");
    const temporary = path.join(this.directory, `settings-${randomUUID()}.tmp`);
    let published = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file); published = true; await strictSyncDirectory(this.directory);
    } catch (error) { if (published) this.blocked = true; throw error; }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  private async templateAccounts(): Promise<TemplateAccountBinding[]> {
    this.assertAvailable();
    const file = path.join(this.directory, "template-accounts.json");
    try { await lstat(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (this.hasTemplateAccounts) throw new Error("已保存的模板账号关联丢失，请人工核查。");
      return [];
    }
    this.hasTemplateAccounts = true;
    return (await readPrivateJson(file, value => TemplateAccountSettingsSchema.parse(value))).value.bindings;
  }
  async templateAccount(recentProjectId: string, projectId: string): Promise<TemplateAccountBinding | undefined> {
    const binding = (await this.templateAccounts()).find(binding => binding.recentProjectId === recentProjectId);
    if (binding && binding.projectId !== projectId) throw new Error("模板项目已变化，请在本行重新选择上传账号。");
    return binding;
  }
  async saveTemplateAccount(input: unknown): Promise<TemplateAccountBinding> {
    const binding = TemplateAccountBindingSchema.parse(input);
    return this.edit(async () => {
      const target = await super.preflight(binding.accountProduct);
      if (target.advertiserId !== binding.advertiserId) throw new Error("广告账户已变化，请重新选择账号。");
      const bindings = (await this.templateAccounts()).filter(value => value.recentProjectId !== binding.recentProjectId);
      const value = TemplateAccountSettingsSchema.parse({ version: 1, bindings: [...bindings, binding] });
      await this.savePrivateJson(path.join(this.directory, "template-accounts.json"), value);
      this.hasTemplateAccounts = true;
      return binding;
    });
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
