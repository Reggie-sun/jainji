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
import { readCurrentQianchuanAccountSnapshot } from "./qianchuan-current-account.js";
import type { QianchuanCurrentAccount } from "../shared/qianchuan-plan-selection.js";
import type { QianchuanSubaccountListRequest, QianchuanSubaccountSwitchRequest, QianchuanSubaccountCatalog } from "../shared/qianchuan-subaccounts.js";
import { readQianchuanSubaccounts, switchQianchuanSubaccount } from "./qianchuan-subaccounts-browser.js";
import { QianchuanBrowserAccounts } from "./qianchuan-browser-accounts.js";
import type { QianchuanCurrentAccountPort, QianchuanCurrentAccountSession } from "./qianchuan-current-account-port.js";
import type { QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";

const parseSettings = (value: unknown) => QianchuanAccountSettingsSchema.parse(value).accounts;
export type EgressChangeGuard = (advertiserIds: string[], accounts?: readonly QianchuanAccount[], browser?: RunningChromeBrowser) => void;

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
  private readonly discoverExistingBrowser: (advertiserId: string, openLocalIfMissing?: boolean) => Promise<string>;
  private readonly currentAccount: typeof readCurrentQianchuanAccountSnapshot;
  private readonly currentAccounts?: QianchuanCurrentAccountPort;
  private readonly currentSessions = new WeakMap<object, QianchuanCurrentAccountSession>();
  private readonly subaccountCatalogs = new Map<QianchuanProduct, { key: string; readAt: number; catalog: QianchuanSubaccountCatalog }>();
  get currentAccountBacked(): boolean { return !!this.currentAccounts; }
  constructor(root: string, discoverBrowser?: (advertiserId: string) => Promise<string>, discoverExistingBrowser?: (advertiserId: string, openLocalIfMissing?: boolean) => Promise<string>, currentAccount?: typeof readCurrentQianchuanAccountSnapshot,
    private readonly subaccountBrowser = { read: readQianchuanSubaccounts, switch: switchQianchuanSubaccount }, currentAccounts?: QianchuanCurrentAccountPort) {
    super(parseSettings);
    this.directory = path.resolve(root, "accounts"); this.file = path.join(this.directory, "mapping.json");
    this.currentAccount = currentAccount ?? readCurrentQianchuanAccountSnapshot;
    // Explicit adapters remain test seams. Production uses the verified original browser.
    this.currentAccounts = currentAccounts ?? (currentAccount ? undefined : new QianchuanBrowserAccounts(root));
    this.browsers = new QianchuanBrowserManager(root, { egress: id => this.egress(id), displayName: async id => {
      this.assertAvailable();
      const account = (await readPrivateConfig(this.file, parseSettings)).accounts.find(value => value.advertiserId === id);
      if (!account) throw new Error("账号设置已变化，请重新打开账号浏览器。");
      return account.productName ?? account.product;
    } });
    this.discoverBrowser = discoverBrowser ?? (id => this.browsers.prepare(id));
    // The owned catalog page verifies account identity; switching an existing tab must not hide its bound browser.
    this.discoverExistingBrowser = discoverExistingBrowser ?? ((id, openLocalIfMissing) => this.browsers.existingConnection(id, openLocalIfMissing));
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
  async controlBrowser(input: unknown, guard: (advertiserId: string, browser?: RunningChromeBrowser) => void, expectedTarget?: FrozenQianchuanAccount): Promise<void> {
    this.assertAvailable();
    const parsed = QianchuanBrowserControlSchema.parse(input);
    await this.edit(async () => {
      const target = await super.preflight(parsed.product);
      if (target.advertiserId !== parsed.expectedAdvertiserId) throw new Error("账号设置已变化，未关闭任何浏览器，请重新选择账号。");
      if (expectedTarget && (target.configDigest !== expectedTarget.configDigest || target.cdpEndpoint !== expectedTarget.cdpEndpoint ||
        egressIdentity(target.egress) !== egressIdentity(expectedTarget.egress))) throw new Error("VPS 账号配置已变化，未关闭浏览器。");
      guard(target.advertiserId);
      if (parsed.action === "reconnect-egress") {
        if (!target.egress) throw new Error("该账号未配置固定出口。");
        if (target.egress.mode === "remote-browser") {
          await qianchuanRemoteRuntime.reconnect(target.egress, target.advertiserId);
          await this.currentAccounts?.reconnect?.(target);
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
  async withVideoLibraryTargets<T>(input: unknown, action: (targets: FrozenQianchuanAccount[], fresh: (product?: QianchuanProduct) => Promise<void>, connect: (target: FrozenQianchuanAccount) => Promise<FrozenQianchuanAccount>) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertAvailable();
    const parsed = QianchuanLibraryClearSchema.parse(input);
    return this.edit(async () => {
      const currentTargets = new Map<QianchuanProduct, FrozenQianchuanAccount>();
      const targets = await Promise.all(parsed.accounts.map(async account => {
        const target = await super.preflight(account.product);
        if (target.advertiserId !== account.expectedAdvertiserId) throw new Error("账号设置已变化，未删除视频，请重新选择账号。");
        if (parsed.confirmation !== "DELETE_ALL_VIDEOS" && !account.plan && !account.plans && target.adId !== account.expectedAdId) throw new Error("千川计划已变化，未删除素材，请重新选择当前计划。");
        let selected = target;
        if (account.expectedCurrentAdvertiserId) {
          const current = await this.prepareCurrentCatalog(account.product, signal);
          if (current.configured.configDigest !== target.configDigest || current.target.advertiserId !== account.expectedCurrentAdvertiserId) throw new Error("网页子账户已变化，未删除素材，请刷新子账户和计划。");
          selected = current.target;
          currentTargets.set(account.product, selected);
        }
        const plan = account.plan ?? account.plans?.[0];
        return plan ? Object.freeze({ ...selected, adId: plan.adId }) : selected;
      }));
      const fresh = async (product?: QianchuanProduct) => {
        this.assertAvailable();
        signal?.throwIfAborted();
        const checked = product === undefined ? targets : targets.filter(target => target.product === product);
        if (!checked.length) throw new Error("该账号不属于本次清理范围。");
        for (const target of checked) {
          await super.freeze(target.product, target.configDigest);
          const expected = currentTargets.get(target.product);
          if (expected) {
            const current = await this.prepareCurrentCatalog(target.product, signal);
            if (current.target.advertiserId !== expected.advertiserId || current.target.configDigest !== expected.configDigest || current.target.cdpEndpoint !== expected.cdpEndpoint) throw new Error("网页子账户或浏览器连接已变化，已停止清理。");
          }
        }
      };
      await fresh();
      // Resolve per account so one unavailable Chrome does not hide other results.
      return action(targets, fresh, async target => {
        if (currentTargets.has(target.product)) { await fresh(target.product); return target; }
        const cdpEndpoint = await this.discoverBrowser(target.advertiserId);
        await fresh(target.product);
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
  private async save(accounts: QianchuanAccount[], guard?: EgressChangeGuard, closeBrowsers = false): Promise<QianchuanAccountSummary[]> {
    const value = QianchuanAccountSettingsSchema.parse({ version: 1, accounts });
    const before = await this.exists() ? (await readPrivateConfig(this.file, parseSettings)).accounts : [];
    const ids = [...new Set([...before, ...accounts].map(account => account.advertiserId).filter(Boolean))];
    const changed = ids.filter(id => egressIdentity(before.find(account => account.advertiserId === id)?.egress) !== egressIdentity(accounts.find(account => account.advertiserId === id)?.egress));
    if (changed.length) {
      const targets = before.filter(account => changed.includes(account.advertiserId));
      if (closeBrowsers && !guard) throw new Error("缺少任务保护检查，未关闭浏览器或切换上传方式。");
      guard?.(changed, targets);
      if (closeBrowsers) for (const id of changed) {
        await this.browsers.inspectForShutdown(id, browser => guard?.(changed, targets, browser));
        guard?.(changed, targets);
      }
      if (closeBrowsers) for (const id of changed) {
        guard?.(changed, targets);
        await this.browsers.control(id, "close", browser => guard?.(changed, targets, browser));
      }
      for (const id of changed) await this.browsers.assertClosed(id);
      guard?.(changed, targets);
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
    if (await this.exists()) {
      const summaries = await super.authorizeFile(this.file); this.hasMapping = true;
      await Promise.all(summaries.filter(account => account.egress && account.egress.mode !== "remote-browser").map(async account => {
        try { await this.browsers.restoreExistingEgress(account.advertiserId); }
        catch { console.warn(`[qianchuan] ${account.product} 固定出口自动恢复失败，请在账号设置中重连固定出口；未恢复上传。`); }
      }));
      return this.withProfileNames(summaries);
    }
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
  /** Read the authorized config identity without substituting a prepared runtime endpoint. */
  async configuredAccount(product: QianchuanProduct): Promise<FrozenQianchuanAccount> { this.assertAvailable(); return super.preflight(product); }
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
  override async prepareCatalog(product: QianchuanProduct, openLocalIfMissing = false): Promise<FrozenQianchuanAccount> {
    this.assertAvailable();
    const target = await super.preflight(product);
    const endpoint = await (openLocalIfMissing ? this.discoverExistingBrowser(target.advertiserId, true) : this.discoverExistingBrowser(target.advertiserId));
    this.assertAvailable();
    await super.freeze(product, target.configDigest);
    this.preparedBrowsers.set(product, { advertiserId: target.advertiserId, endpoint });
    return this.withPreparedBrowser(target);
  }
  async prepareCurrentCatalog(product: QianchuanProduct, signal?: AbortSignal, excludedTargets?: ReadonlySet<string>, openLocalIfMissing = false): Promise<{ configured: FrozenQianchuanAccount; target: FrozenQianchuanAccount; account: QianchuanCurrentAccount; browserIdentity?: string }> {
    if (this.currentAccounts) {
      this.assertAvailable();
      const configured = await this.preflight(product), combined = signal ?? AbortSignal.timeout(45_000);
      const session = await this.currentAccounts.current(configured, combined, excludedTargets);
      await super.freeze(product, configured.configDigest); combined.throwIfAborted();
      this.preparedBrowsers.set(product, { advertiserId: configured.advertiserId, endpoint: session.endpoint });
      const bound = this.withPreparedBrowser(configured);
      const result = { configured: bound, target: Object.freeze({ ...bound, advertiserId: session.account.advertiserId }), account: session.account, browserIdentity: session.identity };
      this.currentSessions.set(result, session);
      return result;
    }
    const configured = await this.prepareCatalog(product, openLocalIfMissing);
    const account = await this.currentAccount(configured.cdpEndpoint, signal, excludedTargets);
    const { advertiserId } = account;
    const fresh = await this.freeze(product, configured.configDigest);
    if (JSON.stringify(fresh) !== JSON.stringify(configured)) throw new Error("账号连接已变化，请重新读取计划。");
    if (configured.egress?.mode === "remote-browser" && advertiserId !== configured.advertiserId) throw new Error("VPS 浏览器当前子账户与保存绑定不同，请先在账号设置中保存该子账户后重试。");
    return { configured, target: Object.freeze({ ...configured, advertiserId }), account };
  }
  async assertCurrentUploadTarget(target: FrozenQianchuanAccount, signal?: AbortSignal): Promise<void> {
    if (!this.currentAccounts) return;
    const current = await this.prepareCurrentCatalog(target.product, signal), session = this.currentSessions.get(current)!;
    if (!session.uploadEndpointVerified || current.target.configDigest !== target.configDigest || current.target.cdpEndpoint !== target.cdpEndpoint || current.target.advertiserId !== target.advertiserId)
      throw new Error("当前 Chrome 的上传连接未能与原浏览器进程核对，请检查对应账号浏览器。");
  }
  async readCurrentPlans(target: FrozenQianchuanAccount, signal: AbortSignal, excludedTargets?: ReadonlySet<string>): Promise<QianchuanPlanOption[]> {
    if (!this.currentAccounts) throw new Error("当前账户读取未连接原浏览器。");
    const before = await this.prepareCurrentCatalog(target.product, signal, excludedTargets), session = this.currentSessions.get(before)!;
    if (before.target.advertiserId !== target.advertiserId || before.target.configDigest !== target.configDigest || before.target.cdpEndpoint !== target.cdpEndpoint) throw new Error("网页账户或账号连接已变化，请重新读取计划。");
    const fresh = async () => { signal.throwIfAborted(); await this.freeze(target.product, target.configDigest); };
    const plans = await this.currentAccounts.plans(session, signal, fresh);
    const after = await this.prepareCurrentCatalog(target.product, signal, excludedTargets);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("网页账户或浏览器连接已变化，请重新读取计划。");
    return plans;
  }
  async savePlan(input: unknown, guard?: EgressChangeGuard, closeBrowsers = false): Promise<QianchuanAccountSummary[]> {
    const parsed = QianchuanAccountSetupSchema.parse(input), ids = parseQianchuanPlanUrl(parsed.planUrl);
    return this.edit(async () => {
      const accounts = await this.exists() ? (await readPrivateConfig(this.file, parseSettings)).accounts : [];
      const old = accounts.find(account => account.product === parsed.product);
      const egress = parsed.egress === undefined ? old?.advertiserId === ids.advertiserId ? old.egress : undefined : parsed.egress ?? undefined;
      const sameSubjectModeChange = old?.egress && old.advertiserId === ids.advertiserId && egress && egress.mode !== old.egress.mode &&
        egressIdentity({ ...egress, mode: old.egress.mode }) === egressIdentity(old.egress);
      const members = sameSubjectModeChange ? accounts.filter(value => value.egress?.group === old.egress!.group) : [];
      const groupChange = parsed.egressGroupChange ?? (sameSubjectModeChange && members.length > 1
        ? { expected: old.egress!, advertiserIds: members.map(value => value.advertiserId) } : undefined);
      if (groupChange) {
        const { expected, advertiserIds } = groupChange;
        const members = accounts.filter(value => value.egress?.group === expected.group);
        if (!old?.egress || members.some(value => !value.advertiserId) || old.advertiserId !== ids.advertiserId || egressIdentity(old.egress) !== egressIdentity(expected) ||
          JSON.stringify(members.map(value => value.advertiserId).sort()) !== JSON.stringify([...advertiserIds].sort()))
          throw new Error("主体账号或原出口设置已变化，请重新核对整组切换。");
        if (!egress || egressIdentity({ ...egress, mode: expected.mode }) !== egressIdentity(expected) || egressIdentity(egress) === egressIdentity(expected))
          throw new Error("整组切换仅支持同一主体出口下改变上传方式，请保留原主体、SSH 别名、端口和 IP。");
      }
      // A protected new account is saved before any browser/network activity; prepare resolves the real CDP port.
      const cdpEndpoint = old?.advertiserId === ids.advertiserId ? old.cdpEndpoint : egress ? `http://127.0.0.1:${19400 + QIANCHUAN_PRODUCTS.indexOf(parsed.product)}` : await this.discoverBrowser(ids.advertiserId);
      const account: QianchuanAccount = { ...old, product: parsed.product, cdpEndpoint, ...ids, ...(parsed.productName !== undefined ? { productName: parsed.productName } : {}) };
      if (egress) account.egress = egress; else delete account.egress;
      return this.save(old ? accounts.map(value => value.product === parsed.product ? account :
        groupChange && value.egress?.group === groupChange.expected.group ? { ...value, egress } : value) : [...accounts, account], guard, closeBrowsers);
    });
  }

  async listSubaccounts(input: QianchuanSubaccountListRequest, signal: AbortSignal, excluded: ReadonlySet<string>, guard: (target: FrozenQianchuanAccount) => void): Promise<QianchuanSubaccountCatalog> {
    try {
      const before = await this.prepareCurrentCatalog(input.product, signal, excluded);
      if (before.configured.advertiserId !== input.expectedAdvertiserId) throw new Error("登录账号已变化，请重新选择。");
      const fresh = async () => { signal.throwIfAborted(); guard(before.configured); guard(before.target); await this.freeze(input.product, before.configured.configDigest); };
      await fresh();
      const key = JSON.stringify([before, [...excluded].sort()]), cached = this.subaccountCatalogs.get(input.product);
      const reuse = !input.refresh && cached?.key === key && performance.now() - cached.readAt < 5 * 60_000;
      if (!reuse) this.subaccountCatalogs.delete(input.product);
      // Only the display directory is cached; live browser/account and config checks still bracket every read.
      const catalog = reuse ? structuredClone(cached.catalog) : this.currentAccounts ? await this.currentAccounts.accounts(this.currentSessions.get(before)!, signal, fresh) : await this.subaccountBrowser.read(before.configured.cdpEndpoint, signal, excluded, fresh);
      const after = await this.prepareCurrentCatalog(input.product, signal, excluded);
      if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(catalog.current) !== JSON.stringify(after.account)) throw new Error("网页账户或浏览器连接已变化，请刷新子账户。");
      await fresh();
      if (!reuse) this.subaccountCatalogs.set(input.product, { key, readAt: performance.now(), catalog: structuredClone(catalog) });
      return catalog;
    } catch (error) { this.subaccountCatalogs.delete(input.product); throw error; }
  }

  async switchSubaccount(input: QianchuanSubaccountSwitchRequest, signal: AbortSignal, excluded: ReadonlySet<string>, guard: (target: FrozenQianchuanAccount) => void): Promise<QianchuanCurrentAccount> {
    this.subaccountCatalogs.delete(input.product);
    const before = await this.prepareCurrentCatalog(input.product, signal, excluded);
    if (before.configured.advertiserId !== input.expectedAdvertiserId || before.account.advertiserId !== input.expectedCurrentAdvertiserId) throw new Error("网页账户或登录账号已变化，请刷新子账户后重选。");
    if (!this.currentAccounts && before.configured.egress?.mode === "remote-browser" && input.advertiserId !== before.configured.advertiserId) throw new Error("VPS 子账户须先在账号设置中保存绑定，未切换网页。");
    const fresh = async () => { signal.throwIfAborted(); guard(before.configured); guard(before.target); guard({ ...before.target, advertiserId: input.advertiserId }); await this.freeze(input.product, before.configured.configDigest); };
    await fresh();
    const account = this.currentAccounts ? (await this.currentAccounts.switch(this.currentSessions.get(before)!, input.advertiserId, signal, fresh)).account : await this.subaccountBrowser.switch(before.configured.cdpEndpoint, input.expectedCurrentAdvertiserId, input.advertiserId, signal, excluded, fresh);
    const after = await this.prepareCurrentCatalog(input.product, signal, excluded);
    if (JSON.stringify(before.configured) !== JSON.stringify(after.configured) || JSON.stringify(account) !== JSON.stringify(after.account)) throw new Error("切换后的网页账户未能核对，请刷新子账户；未自动重试。");
    await fresh(); return account;
  }
}
