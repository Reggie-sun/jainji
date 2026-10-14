import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { QianchuanSubaccountCatalogSchema, type QianchuanSubaccountCatalog } from "../shared/qianchuan-subaccounts.js";
import { QianchuanCurrentAccountSchema, QianchuanPlanListSchema, type QianchuanCurrentAccount, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";

const infoPath = "/ad/api/v1/account/user/info", listPath = "/ad/api/v1/account/user-list";
const id = QianchuanCurrentAccountSchema.shape.advertiserId;
const name = QianchuanCurrentAccountSchema.shape.name.unwrap();
const InfoSchema = z.object({ kind: z.literal("user-info"), accountInfo: z.object({ advId: id, advName: name }).strict() }).strict();
const ListSchema = z.object({ kind: z.literal("user-list"), accounts: z.array(z.object({ advertiserId: id, name }).strict()).max(100),
  totalPages: z.number().int().min(1).max(100), totalCount: z.number().int().min(1).max(1000), currentPage: z.number().int().min(1).max(100),
}).strict();

export interface CatalogSnapshotBase {
  account: QianchuanCurrentAccount & { name: string };
  gfversion: string;
}

export type CatalogOperation<S extends CatalogSnapshotBase> =
  | { kind: "identity" }
  | { kind: "request"; snapshot: S; path: typeof infoPath | typeof listPath; params: Record<string, string | number>; headers: Record<string, string> }
  | { kind: "switch"; snapshot: S; chosen: S["account"] }
  | { kind: "plans"; snapshot: S };

export interface CatalogBinding<S extends CatalogSnapshotBase> {
  parse(value: unknown): S;
  same(before: S, after: S): boolean;
  switched(before: S, after: S): boolean;
}

/** Reproduces the observed public frontend GET validator; no login secret leaves the browser. */
export function signQianchuanRequest(path: typeof infoPath | typeof listPath, params: Record<string, string | number>, date = Date.now(), key = randomBytes(6).toString("hex").slice(0, 8)): Record<string, string> {
  const body = JSON.stringify(params).replace(/"/g, "");
  const text = [key, [body, "GET", path, date].join("M#N"), key].join("X&Y").toUpperCase();
  return { "qc-date": String(date), "qc-key": key, "qc-auth": createHash("md5").update(text).digest("hex") };
}

const accountChanged = () => new Error("网页账户或浏览器连接已变化，请刷新后重选；未自动重试切换。");

/** Shared signed account and plan catalog logic; a transport owns identity and navigation proof. */
export class QianchuanAccountCatalog<S extends CatalogSnapshotBase> {
  constructor(private readonly call: (operation: CatalogOperation<S>, signal?: AbortSignal) => Promise<unknown>, private readonly binding: CatalogBinding<S>) {}

  private async fresh(snapshot: S, signal: AbortSignal, guard: () => Promise<void>): Promise<void> {
    signal.throwIfAborted(); await guard();
    if (!this.binding.same(snapshot, this.binding.parse(await this.call({ kind: "identity" }, signal)))) throw accountChanged();
  }

  private request(snapshot: S, path: typeof infoPath | typeof listPath, params: Record<string, string | number>, signal: AbortSignal): Promise<unknown> {
    return this.call({ kind: "request", snapshot, path, params, headers: signQianchuanRequest(path, params) }, signal);
  }

  private async info(snapshot: S, signal: AbortSignal): Promise<void> {
    const result = InfoSchema.parse(await this.request(snapshot, infoPath, { aavid: snapshot.account.advertiserId, gfversion: snapshot.gfversion }, signal));
    if (result.accountInfo.advId !== snapshot.account.advertiserId || result.accountInfo.advName !== snapshot.account.name) throw accountChanged();
  }

  async accounts(snapshot: S, signal: AbortSignal, guard: () => Promise<void> = async () => {}): Promise<QianchuanSubaccountCatalog> {
    await this.fresh(snapshot, signal, guard); await this.info(snapshot, signal);
    let totalPages = 0, totalCount = 0;
    const accounts: QianchuanSubaccountCatalog["accounts"] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= (totalPages || 1); page++) {
      await this.fresh(snapshot, signal, guard);
      const result = ListSchema.parse(await this.request(snapshot, listPath, { page, limit: 100, keyword: "", aavid: snapshot.account.advertiserId, gfversion: snapshot.gfversion }, signal));
      if (page === 1) { totalPages = result.totalPages; totalCount = result.totalCount; }
      if (result.currentPage !== page || result.totalPages !== totalPages || result.totalCount !== totalCount || !result.accounts.length) throw accountChanged();
      for (const row of result.accounts) {
        if (seen.has(row.advertiserId)) throw accountChanged();
        seen.add(row.advertiserId); accounts.push(row);
      }
      if (accounts.length > totalCount) throw accountChanged();
    }
    if (accounts.length !== totalCount) throw accountChanged();
    await this.info(snapshot, signal); await this.fresh(snapshot, signal, guard);
    return QianchuanSubaccountCatalogSchema.parse({ current: snapshot.account, accounts });
  }

  async switch(snapshot: S, advertiserId: string, signal: AbortSignal, guard: () => Promise<void>): Promise<S> {
    const catalog = await this.accounts(snapshot, signal, guard), chosen = catalog.accounts.find(value => value.advertiserId === advertiserId);
    if (!chosen) throw accountChanged();
    await this.fresh(snapshot, signal, guard);
    if (chosen.advertiserId === snapshot.account.advertiserId) return snapshot;
    const after = this.binding.parse(await this.call({ kind: "switch", snapshot, chosen }, signal));
    if (!this.binding.switched(snapshot, after) || after.account.advertiserId !== chosen.advertiserId || after.account.name !== chosen.name) throw accountChanged();
    await this.info(after, signal); await this.fresh(after, signal, guard); return after;
  }

  async plans(snapshot: S, signal: AbortSignal, guard: () => Promise<void> = async () => {}): Promise<QianchuanPlanOption[]> {
    await this.fresh(snapshot, signal, guard);
    const plans = QianchuanPlanListSchema.parse(await this.call({ kind: "plans", snapshot }, signal));
    if (plans.some(plan => plan.advertiserId !== snapshot.account.advertiserId)) throw accountChanged();
    await this.fresh(snapshot, signal, guard); return plans;
  }
}
