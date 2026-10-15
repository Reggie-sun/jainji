import { QianchuanBackendCancelSchema, type QianchuanBackendQuery, type QianchuanBackendResult } from "../shared/qianchuan-backend.js";
import type { FrozenQianchuanAccount, QianchuanAccountConfigReader } from "./qianchuan-account-config.js";
import { egressIdentity } from "../shared/qianchuan-egress.js";

type Scope = Pick<QianchuanBackendQuery, "product" | "expectedAdvertiserId" | "requestId">;
type Read = (query: QianchuanBackendQuery, senderId: number, signal: AbortSignal) => Promise<QianchuanBackendResult>;

/** One subordinate lease owner shared with the original upload/account coordinator. */
export class QianchuanAccountOperations {
  private active?: { key: string; controller: AbortController; done: Promise<unknown> };
  constructor(private readonly accounts: QianchuanAccountConfigReader, private readonly read: Read) {}
  get busy(): boolean { return !!this.active; }
  assertIdle(): void {
    if (this.active) throw new Error("报表或投放操作尚未结束，请等待或停止后再操作账号。");
  }
  run<T>(scope: Scope, senderId: number, work: (signal: AbortSignal, read: (query: QianchuanBackendQuery) => Promise<QianchuanBackendResult>, prepareAccount: () => Promise<FrozenQianchuanAccount>) => Promise<T>, prepare: () => Promise<void>, publish?: (value: T, signal: AbortSignal) => Promise<void>): Promise<T> {
    this.assertIdle();
    QianchuanBackendCancelSchema.parse({ requestId: scope.requestId });
    const key = `${senderId}:${scope.requestId}`, controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]);
    const reads = new Set<Promise<unknown>>();
    const done = Promise.resolve().then(async () => {
      await prepare(); signal.throwIfAborted();
      const before = await this.accounts.preflight(scope.product);
      signal.throwIfAborted();
      if (before.advertiserId !== scope.expectedAdvertiserId) throw new Error("广告账户已变化，请重新选择账号。");
      const value = await work(signal, query => {
        signal.throwIfAborted();
        if (query.product !== scope.product || query.expectedAdvertiserId !== scope.expectedAdvertiserId) throw new Error("查询目标与冻结账号不一致。");
        const pending = this.read(query, senderId, signal);
        reads.add(pending);
        void pending.then(() => reads.delete(pending), () => reads.delete(pending));
        return pending;
      }, async () => {
        signal.throwIfAborted();
        const target = await this.accounts.prepareCatalog(scope.product, false);
        signal.throwIfAborted();
        if (target.configDigest !== before.configDigest || target.advertiserId !== before.advertiserId || egressIdentity(target.egress) !== egressIdentity(before.egress)) throw new Error("账号连接或设置已变化，请重新预检。");
        return target;
      });
      signal.throwIfAborted();
      const after = await this.accounts.freeze(scope.product, before.configDigest);
      signal.throwIfAborted();
      if (after.advertiserId !== before.advertiserId || after.configDigest !== before.configDigest || egressIdentity(after.egress) !== egressIdentity(before.egress)) throw new Error("账号连接或设置已变化，本次结果不可使用。");
      await publish?.(value, signal); signal.throwIfAborted();
      return value;
    }).finally(async () => {
      // A timed-out capture can finish before its underlying CDP cleanup.
      controller.abort(); await Promise.allSettled(reads);
      if (this.active?.key === key) this.active = undefined;
    });
    this.active = { key, controller, done };
    return done;
  }
  cancel(input: unknown, senderId: number): void {
    const { requestId } = QianchuanBackendCancelSchema.parse(input);
    if (this.active?.key === `${senderId}:${requestId}`) this.active.controller.abort();
  }
  async stop(): Promise<void> {
    const active = this.active;
    active?.controller.abort(); await active?.done.catch(() => undefined);
  }
  async stopForSender(senderId: number): Promise<void> {
    if (this.active?.key.startsWith(`${senderId}:`)) await this.stop();
  }
}
