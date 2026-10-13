import { QianchuanBackendCancelSchema, QianchuanBackendQuerySchema,
  type QianchuanBackendQuery, type QianchuanBackendResult,
} from "../shared/qianchuan-backend.js";
import type { QianchuanAccountConfigReader, FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { readQianchuanBackendQuery } from "./qianchuan-backend-query.js";
import { egressIdentity } from "../shared/qianchuan-egress.js";

type ReadQuery = (target: FrozenQianchuanAccount, query: QianchuanBackendQuery, signal: AbortSignal) => Promise<QianchuanBackendResult>;

/** In-memory query lifetime; does not create upload tasks, cache results or restore requests. */
export class QianchuanBackendQueries {
  private active?: { key: string; controller: AbortController; done: Promise<QianchuanBackendResult> };
  get busy(): boolean { return !!this.active; }
  constructor(private readonly accounts: QianchuanAccountConfigReader, private readonly read: ReadQuery = readQianchuanBackendQuery) {}

  run(input: unknown, senderId: number): Promise<QianchuanBackendResult> {
    const query = QianchuanBackendQuerySchema.parse(input);
    if (this.active) throw new Error("千川查询正在进行，请等待或取消后再查询。");
    const key = `${senderId}:${query.requestId}`, controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]);
    const done = Promise.resolve().then(async () => {
      signal.throwIfAborted();
      const configured = await this.accounts.preflight(query.product);
      signal.throwIfAborted();
      if (configured.advertiserId !== query.expectedAdvertiserId) throw new Error("广告账户已变化，请重新选择账号。");
      const target = await (configured.egress?.mode === "remote-browser" ? this.accounts.prepare(query.product) :
        this.accounts.prepareCatalog(query.product, true));
      signal.throwIfAborted();
      if (target.advertiserId !== query.expectedAdvertiserId || target.configDigest !== configured.configDigest ||
        egressIdentity(target.egress) !== egressIdentity(configured.egress)) throw new Error("账号连接或查询目标已变化，请重新查询。");
      const result = await this.read(target, query, signal);
      signal.throwIfAborted();
      const current = await this.accounts.freeze(target.product, target.configDigest);
      signal.throwIfAborted();
      if (JSON.stringify(current) !== JSON.stringify(target) || result.advertiserId !== target.advertiserId || result.kind !== query.kind) {
        throw new Error("账号连接或查询目标已变化，请重新查询。");
      }
      return result;
    }).finally(() => { if (this.active?.key === key) this.active = undefined; });
    this.active = { key, controller, done };
    return done;
  }
  cancel(input: unknown, senderId: number): void {
    const { requestId } = QianchuanBackendCancelSchema.parse(input);
    if (this.active?.key === `${senderId}:${requestId}`) this.active.controller.abort();
  }
  async stop(): Promise<void> {
    const active = this.active;
    active?.controller.abort();
    await active?.done.catch(() => undefined);
  }
}
