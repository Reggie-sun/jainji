import { randomUUID } from "node:crypto";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { QianchuanAccountConfigReader, readPrivateConfig, readPrivateJson, type FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { TemplateAccountBindingSchema, TemplateAccountSettingsSchema, type TemplateAccountBinding } from "../shared/batch-upload.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { QianchuanBrowserManager } from "./qianchuan-browser-manager.js";
import type { RunningChromeBrowser } from "./qianchuan-browser-discovery.js";
import { parseQianchuanPlanUrl, QIANCHUAN_PRODUCTS, QianchuanAccountSettingsSchema, QianchuanAccountSetupSchema, QianchuanBrowserControlSchema, type QianchuanAccount, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account.js";
import { QianchuanLibraryClearSchema } from "../shared/qianchuan-video-library.js";
import { egressIdentity, type QianchuanEgress } from "../shared/qianchuan-egress.js";
import { qianchuanEgressRuntime } from "./qianchuan-egress-runtime.js";
import { qianchuanRemoteRuntime } from "./qianchuan-remote-runtime.js";

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
  private readonly discoverExistingBrowser: (advertiserId: string) => Promise<string>;
  constructor(root: string, discoverBrowser?: (advertiserId: string) => Promise<string>, discoverExistingBrowser?: (advertiserId: string) => Promise<string>) {
    super(parseSettings);
    this.directory = path.resolve(root, "accounts"); this.file = path.join(this.directory, "mapping.json");
    this.browsers = new QianchuanBrowserManager(root, { egress: id => this.egress(id) });
    this.discoverBrowser = discoverBrowser ?? (id => this.browsers.prepare(id));
    this.discoverExistingBrowser = discoverExistingBrowser ?? (id => this.browsers.prepareExisting(id));
  }
  async openBrowser(input: unknown): Promise<void> {
    this.assertAvailable();
    const parsed = QianchuanAccountSetupSchema.parse(input), ids = parseQianchuanPlanUrl(parsed.planUrl);
    if (parsed.egress !== undefined && egressIdentity(parsed.egress ?? undefined) !== egressIdentity(await this.egress(ids.advertiserId))) throw new Error("请先保存固定出口设置，再打开账号浏览器。");
    await this.browsers.open(ids.advertiserId, true);
  }
  private async egress(advertiserId: string): Promise<QianchuanEgress | undefined> {
    this.assertAvailable();
    if (!await this.exists()) { if (this.hasMapping) throw new Error("账号设置丢失，禁止直连。"); return undefined; }
    return (await readPrivateConfig(this.file, parseSettings)).accounts.find(account => account.advertiserId === advertiserId)?.egress;
  }
  async controlBrowser(input: unknown, guard: (advertiserId: string, browser?: RunningChromeBrowser) => void): Promise<void> {
    this.assertAvailable();
    const parsed = QianchuanBrowserControlSchema.parse(input);
    await this.edit(async () => {
      const target = await super.preflight(parsed.product);
      if (target.advertiserId !== parsed.expectedAdvertiserId) throw new Error("账号设置已变化，未关闭任何浏览器，请重新选择账号。");
      guard(target.advertiserId);
      if (parsed.action === "reconnect-egress") {
        if (!target.egress) throw new Error("该账号未配置固定出口。");
        if (target.egress.mode === "remote-browser") {
          await qianchuanRemoteRuntime.reconnect(target.egress, target.advertiserId);
          return super.refresh();
        }
        qianchuanEgressRuntime.recover(target.egress);
        await qianchuanEgressRuntime.ensure(target.egress);
        await qianchuanEgressRuntime.verify(target.egress);
        // Network recovery never touches Chrome, the upload queue or historical outcomes.
        return super.refresh();
      }
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
        if (parsed.confirmation !== "DELETE_ALL_VIDEOS" && !account.plan && !account.plans && target.adId !== account.expectedAdId) throw new Error("千川计划已变化，未删除素材，请重新选择当前计划。");
        const plan = account.plan ?? account.plans?.[0];
        return plan ? Object.freeze({ ...target, adId: plan.adId }) : target;
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
  private async save(accounts: QianchuanAccount[], guard?: (advertiserIds: string[]) => void): Promise<QianchuanAccountSummary[]> {
    const value = QianchuanAccountSettingsSchema.parse({ version: 1, accounts });
    const before = await this.exists() ? (await readPrivateConfig(this.file, parseSettings)).accounts : [];
    const ids = [...new Set([...before, ...accounts].map(account => account.advertiserId).filter(Boolean))];
    const changed = ids.filter(id => egressIdentity(before.find(account => account.advertiserId === id)?.egress) !== egressIdentity(accounts.find(account => account.advertiserId === id)?.egress));
    if (changed.length) {
      guard?.(changed);
      for (const id of changed) await this.browsers.assertClosed(id);
      guard?.(changed);
    }
    await this.savePrivateJson(this.file, value);
    try {
      const summaries = await super.authorizeFile(this.file); this.hasMapping = true;
      if (changed.length) {
        this.preparedBrowsers.clear();
        const routes = accounts.flatMap(account => account.egress ? [account.egress] : []);
        qianchuanEgressRuntime.retireUnused(routes); qianchuanRemoteRuntime.retireUnused(routes);
      }
      return this.withProfileNames(summaries);
    }
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
  override async authorizeFile(source: string, guard?: (advertiserIds: string[]) => void): Promise<QianchuanAccountSummary[]> {
    // Validate through the original strict, private six-account import boundary.
    const importer = new QianchuanAccountConfigReader(); await importer.authorizeFile(source);
    const imported = await readPrivateConfig(path.resolve(source));
    return this.edit(async () => {
      if (await this.exists()) await readPrivateConfig(this.file, parseSettings);
      return this.save(imported.accounts, guard);
    });
  }
  async restore(legacyPath?: string, guard?: (advertiserIds: string[]) => void): Promise<QianchuanAccountSummary[]> {
    if (await this.exists()) { const summaries = await super.authorizeFile(this.file); this.hasMapping = true; return this.withProfileNames(summaries); }
    if (legacyPath) {
      if (path.resolve(legacyPath) === this.file) { this.hasMapping = true; throw new Error("已保存的账号设置丢失，请人工核查。"); }
      return this.authorizeFile(legacyPath, guard);
    }
    return [];
  }
  private assertAvailable(): void { if (this.blocked) throw new Error("账号设置保存结果未知，请重启简辑核查。"); }
  async withProfileNames(accounts: readonly QianchuanAccountSummary[]): Promise<QianchuanAccountSummary[]> {
    return Promise.all(accounts.map(async ({ browserProfileName: _previous, ...account }) => {
      const browserProfileName = await this.browsers.profileName(account.advertiserId);
      return { ...account, ...(browserProfileName ? { browserProfileName } : {}) };
    }));
  }
  override async refresh(): Promise<QianchuanAccountSummary[]> { this.assertAvailable(); return this.withProfileNames(await super.refresh()); }
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
  override async prepareCatalog(product: QianchuanProduct): Promise<FrozenQianchuanAccount> {
    this.assertAvailable();
    const target = await super.preflight(product);
    const endpoint = await this.discoverExistingBrowser(target.advertiserId);
    this.assertAvailable();
    await super.freeze(product, target.configDigest);
    this.preparedBrowsers.set(product, { advertiserId: target.advertiserId, endpoint });
    return this.withPreparedBrowser(target);
  }
  async savePlan(input: unknown, guard?: (advertiserIds: string[]) => void): Promise<QianchuanAccountSummary[]> {
    const parsed = QianchuanAccountSetupSchema.parse(input), ids = parseQianchuanPlanUrl(parsed.planUrl);
    return this.edit(async () => {
      const accounts = await this.exists() ? (await readPrivateConfig(this.file, parseSettings)).accounts : [];
      const old = accounts.find(account => account.product === parsed.product);
      const egress = parsed.egress === undefined ? old?.advertiserId === ids.advertiserId ? old.egress : undefined : parsed.egress ?? undefined;
      // A protected new account is saved before any browser/network activity; prepare resolves the real CDP port.
      const cdpEndpoint = old?.advertiserId === ids.advertiserId ? old.cdpEndpoint : egress ? `http://127.0.0.1:${19400 + QIANCHUAN_PRODUCTS.indexOf(parsed.product)}` : await this.discoverBrowser(ids.advertiserId);
      const account: QianchuanAccount = { ...old, product: parsed.product, cdpEndpoint, ...ids, ...(parsed.productName !== undefined ? { productName: parsed.productName } : {}) };
      if (egress) account.egress = egress; else delete account.egress;
      return this.save(old ? accounts.map(value => value.product === parsed.product ? account : value) : [...accounts, account], guard);
    });
  }
}
