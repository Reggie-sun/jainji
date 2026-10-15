import type { QianchuanProduct } from "../shared/qianchuan-account.js";
import { QianchuanPlanCatalogSchema, QianchuanPlanListSchema, QianchuanPlanDisplaySchema, type QianchuanPlanListRequest, type QianchuanPlanListResult, type QianchuanPlanDisplay, type QianchuanCatalogCacheInfo, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";
import { QianchuanSubaccountCatalogSchema, type QianchuanSubaccountListRequest, type QianchuanSubaccountCatalog } from "../shared/qianchuan-subaccounts.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { QianchuanCatalogCache, type CatalogBinding, type CatalogRecord } from "./qianchuan-catalog-cache.js";

interface Readers {
  configured(product: QianchuanProduct): Promise<FrozenQianchuanAccount>;
  plans(input: QianchuanPlanListRequest, signal: AbortSignal): Promise<QianchuanPlanListResult>;
  directory(input: QianchuanSubaccountListRequest): Promise<QianchuanSubaccountCatalog>;
}

/** Opt-in historical projections, separate from the live production/catalog readers. */
export class QianchuanDisplayCatalogs {
  private readonly cache: QianchuanCatalogCache;
  private readonly planObservations = new Map<string, QianchuanPlanOption[]>();
  constructor(root: string, private readonly readers: Readers) { this.cache = new QianchuanCatalogCache(root); }
  async hasHistory(product: QianchuanProduct, anchor: string): Promise<boolean> {
    await this.configured(product, anchor);
    const binding: CatalogBinding = { product, anchor, kind: "directory", advertiserId: anchor };
    return !!(await this.cache.get(binding) ?? await this.cache.get({ ...binding, kind: "saved-plans" }));
  }
  private info(record: CatalogRecord, target: FrozenQianchuanAccount, refreshFailed = false): QianchuanCatalogCacheInfo {
    return { source: "cache", readAt: record.readAt, stale: refreshFailed || record.configDigest !== target.configDigest || Date.now() - record.readAt >= 5 * 60_000,
      ...(refreshFailed ? { refreshFailed: true } : {}) };
  }
  private async configured(product: QianchuanProduct, anchor: string): Promise<FrozenQianchuanAccount> {
    const configured = await this.readers.configured(product);
    if (configured.advertiserId !== anchor) throw new Error("广告账户已变化，请重新选择账号。");
    return configured;
  }
  private async unchanged(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const after = await this.configured(target.product, target.advertiserId);
    signal.throwIfAborted();
    if (after.configDigest !== target.configDigest) throw new Error("账号配置已变化，请重新读取目录。");
  }
  /** Reuse complete live observations without making cache availability an operation gate. */
  async readPlans(target: FrozenQianchuanAccount, signal: AbortSignal, current: boolean,
    read: (target: FrozenQianchuanAccount, signal: AbortSignal) => Promise<QianchuanPlanOption[]>): Promise<QianchuanPlanOption[]> {
    const plans = QianchuanPlanListSchema.parse(await read(target, signal));
    signal.throwIfAborted();
    if (plans.some(plan => plan.advertiserId !== target.advertiserId)) throw new Error("计划列表不属于所选广告账户。");
    try {
      const configured = await this.readers.configured(target.product);
      if (configured.configDigest !== target.configDigest || !current && configured.advertiserId !== target.advertiserId) return plans;
      const binding: CatalogBinding = { product: target.product, anchor: configured.advertiserId,
        kind: current ? "current-plans" : "saved-plans", advertiserId: target.advertiserId };
      const previous = await this.cache.get(binding);
      const account = previous && "plans" in previous.data ? previous.data.account : undefined;
      const data = current ? { plans: plans.map(plan => ({ ...plan, accountSource: "current-browser" as const })), account: account ?? { advertiserId: target.advertiserId } } : { plans };
      await this.unchanged(configured, signal);
      this.planObservations.set(JSON.stringify(binding), data.plans);
      await this.cache.put(binding, configured.configDigest, data, Date.now());
    } catch { /* Display persistence must not change the live reader's outcome. */ }
    return plans;
  }
  async plans(input: QianchuanPlanListRequest, signal: AbortSignal): Promise<QianchuanPlanDisplay> {
    signal.throwIfAborted();
    const target = await this.configured(input.product, input.expectedAdvertiserId);
    const current = input.accountSource === "current-browser";
    const binding: CatalogBinding = { product: input.product, anchor: input.expectedAdvertiserId, kind: current ? "current-plans" : "saved-plans", advertiserId: input.expectedAdvertiserId };
    if (current) {
      const directory = await this.cache.get({ ...binding, kind: "directory" });
      binding.advertiserId = input.expectedCurrentAdvertiserId ?? (directory && "current" in directory.data ? directory.data.current.advertiserId : "");
    }
    const previous = binding.advertiserId ? await this.cache.get(binding) : undefined;
    await this.unchanged(target, signal);
    const historical = (failed = false) => QianchuanPlanDisplaySchema.parse({ ...previous!.data, cache: this.info(previous!, target, failed) });
    if (previous && !input.refresh) return historical();
    let data: { plans: QianchuanPlanDisplay["plans"]; account?: QianchuanPlanDisplay["account"] };
    try {
      const live = await this.readers.plans({ product: input.product, expectedAdvertiserId: input.expectedAdvertiserId, refresh: true,
        ...(current ? { accountSource: "current-browser", includeAccount: true } : {}) }, signal);
      if (current) {
        const catalog = QianchuanPlanCatalogSchema.parse(live);
        if (input.expectedCurrentAdvertiserId && catalog.account.advertiserId !== input.expectedCurrentAdvertiserId) throw new Error("网页子账户已变化，请刷新子账户后重新选择计划。");
        binding.advertiserId = catalog.account.advertiserId;
        data = catalog;
      } else {
        data = { plans: QianchuanPlanListSchema.parse(live) };
        if (data.plans.some(plan => plan.advertiserId !== binding.advertiserId || plan.accountSource)) throw new Error("计划列表不属于所选广告账户。");
      }
    } catch (error) {
      await this.unchanged(target, signal);
      if (previous) return historical(true);
      throw error;
    }
    const key = JSON.stringify(binding), observation = this.planObservations.get(key);
    await this.unchanged(target, signal);
    const readAt = Date.now(), persisted = this.planObservations.get(key) === observation &&
      (!observation || JSON.stringify(observation) === JSON.stringify(data.plans)) && await this.cache.put(binding, target.configDigest, data, readAt);
    await this.unchanged(target, signal);
    return QianchuanPlanDisplaySchema.parse({ ...data, cache: { source: "live", readAt, stale: false, persisted } });
  }
  async directory(input: QianchuanSubaccountListRequest, signal: AbortSignal): Promise<QianchuanSubaccountCatalog> {
    signal.throwIfAborted();
    const target = await this.configured(input.product, input.expectedAdvertiserId);
    const binding: CatalogBinding = { product: input.product, anchor: input.expectedAdvertiserId, kind: "directory", advertiserId: input.expectedAdvertiserId };
    const previous = await this.cache.get(binding);
    await this.unchanged(target, signal);
    const historical = (failed = false) => QianchuanSubaccountCatalogSchema.parse({ ...previous!.data, cache: this.info(previous!, target, failed) });
    if (previous && !input.refresh) return historical();
    let data: QianchuanSubaccountCatalog;
    try {
      const live = QianchuanSubaccountCatalogSchema.parse(await this.readers.directory({ product: input.product, expectedAdvertiserId: input.expectedAdvertiserId, refresh: true }));
      data = { current: live.current, accounts: live.accounts };
    } catch (error) {
      await this.unchanged(target, signal);
      if (previous) return historical(true);
      throw error;
    }
    await this.unchanged(target, signal);
    const readAt = Date.now(), persisted = await this.cache.put(binding, target.configDigest, data, readAt);
    await this.unchanged(target, signal);
    return { ...data, cache: { source: "live", readAt, stale: false, persisted } };
  }
}
