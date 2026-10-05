import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { QianchuanPlanListSchema, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";

interface SharedRead {
  controller: AbortController;
  consumers: Set<symbol>;
  started: boolean;
  result: Promise<QianchuanPlanOption[]>;
}

/** Display catalogs may be reused briefly; production requests always check Chrome. */
export class QianchuanPlanReads {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, SharedRead>();
  private readonly catalogs = new Map<string, { key: string; readAt: number; plans: QianchuanPlanOption[] }>();

  constructor(private readonly read: (target: FrozenQianchuanAccount, signal: AbortSignal) => Promise<QianchuanPlanOption[]>, private readonly clock = () => performance.now()) {}

  private key(target: FrozenQianchuanAccount): string { return JSON.stringify([target.product, target.advertiserId, target.cdpEndpoint, target.configDigest]); }
  invalidate(product: FrozenQianchuanAccount["product"]): void { this.catalogs.delete(product); }
  cached(target: FrozenQianchuanAccount): QianchuanPlanOption[] | undefined {
    const cached = this.catalogs.get(target.product);
    if (cached?.key === this.key(target) && this.clock() - cached.readAt < 5 * 60_000) return structuredClone(cached.plans);
  }
  catalog(target: FrozenQianchuanAccount, signal?: AbortSignal, refresh = false): Promise<QianchuanPlanOption[]> {
    signal?.throwIfAborted();
    const cached = !refresh ? this.cached(target) : undefined;
    if (cached) return Promise.resolve(cached);
    return this.request(target, signal);
  }

  request(target: FrozenQianchuanAccount, signal?: AbortSignal): Promise<QianchuanPlanOption[]> {
    signal?.throwIfAborted();
    const key = this.key(target);
    let shared = this.pending.get(key);
    if (!shared || shared.controller.signal.aborted) {
      this.catalogs.delete(target.product);
      const current: SharedRead = { controller: new AbortController(), consumers: new Set(), started: false, result: Promise.resolve([]) };
      current.result = this.tail.catch(() => undefined).then(async () => {
        current.controller.signal.throwIfAborted();
        current.started = true;
        const combined = AbortSignal.any([current.controller.signal, AbortSignal.timeout(60_000)]);
        const plans = QianchuanPlanListSchema.parse(await this.read(target, combined));
        combined.throwIfAborted();
        if (plans.some(plan => plan.advertiserId !== target.advertiserId)) throw new Error("计划列表不属于所选广告账户。");
        this.catalogs.set(target.product, { key, readAt: this.clock(), plans: structuredClone(plans) });
        return plans;
      }).finally(() => { if (this.pending.get(key) === current) this.pending.delete(key); });
      this.tail = current.result;
      shared = current;
      this.pending.set(key, current);
    }
    const work = shared, consumer = Symbol();
    work.consumers.add(consumer);
    return new Promise((resolve, reject) => {
      const release = () => {
        signal?.removeEventListener("abort", aborted);
        work.consumers.delete(consumer);
      };
      const aborted = () => {
        release();
        if (!work.consumers.size) {
          work.controller.abort();
          // Hold the caller's browser protection until its active tab is cleaned up.
          if (work.started) { void work.result.then(() => reject(signal?.reason), () => reject(signal?.reason)); return; }
        }
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", aborted, { once: true });
      work.result.then(plans => { release(); signal?.aborted ? reject(signal.reason) : resolve(structuredClone(plans)); }, cause => { release(); reject(cause); });
      if (signal?.aborted) aborted();
    });
  }
}
