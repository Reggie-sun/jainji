import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { QianchuanSubaccountCatalogSchema, type QianchuanSubaccountCatalog } from "../shared/qianchuan-subaccounts.js";
import { QianchuanPlanListSchema, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";
import { ExtensionSnapshotSchema, extensionChanged, sameExtensionSnapshot, type ExtensionCall, type ExtensionSnapshot } from "./qianchuan-extension-protocol.js";

const infoPath = "/ad/api/v1/account/user/info", listPath = "/ad/api/v1/account/user-list";
const id = z.string().regex(/^[1-9][0-9]{0,19}$/);
const name = ExtensionSnapshotSchema.shape.account.shape.name;
const InfoSchema = z.object({ kind: z.literal("user-info"), accountInfo: z.object({ advId: id, advName: name }).strict() }).strict();
const ListSchema = z.object({ kind: z.literal("user-list"), accounts: z.array(z.object({ advertiserId: id, name }).strict()).max(100),
  totalPages: z.number().int().min(1).max(100), totalCount: z.number().int().min(1).max(1000), currentPage: z.number().int().min(1).max(100),
}).strict();

/** Reproduces the observed public frontend GET validator; no login secret leaves Chrome. */
export function signQianchuanRequest(path: typeof infoPath | typeof listPath, params: Record<string, string | number>, date = Date.now(), key = randomBytes(6).toString("hex").slice(0, 8)): Record<string, string> {
  const body = JSON.stringify(params).replace(/"/g, "");
  const text = [key, [body, "GET", path, date].join("M#N"), key].join("X&Y").toUpperCase();
  return { "qc-date": String(date), "qc-key": key, "qc-auth": createHash("md5").update(text).digest("hex") };
}

export class QianchuanExtensionCatalog {
  constructor(private readonly call: ExtensionCall) {}
  private async fresh(snapshot: ExtensionSnapshot, signal: AbortSignal, guard: () => Promise<void>): Promise<void> {
    signal.throwIfAborted(); await guard();
    if (!sameExtensionSnapshot(snapshot, ExtensionSnapshotSchema.parse(await this.call({ kind: "identity" }, signal)))) throw extensionChanged();
  }
  private request(snapshot: ExtensionSnapshot, path: typeof infoPath | typeof listPath, params: Record<string, string | number>, signal: AbortSignal): Promise<unknown> {
    return this.call({ kind: "request", snapshot, path, params, headers: signQianchuanRequest(path, params) }, signal);
  }
  private async info(snapshot: ExtensionSnapshot, signal: AbortSignal): Promise<void> {
    const result = InfoSchema.parse(await this.request(snapshot, infoPath, { aavid: snapshot.account.advertiserId, gfversion: snapshot.gfversion }, signal));
    if (result.accountInfo.advId !== snapshot.account.advertiserId || result.accountInfo.advName !== snapshot.account.name) throw extensionChanged();
  }
  async accounts(snapshot: ExtensionSnapshot, signal: AbortSignal, guard: () => Promise<void> = async () => {}): Promise<QianchuanSubaccountCatalog> {
    await this.fresh(snapshot, signal, guard); await this.info(snapshot, signal);
    let totalPages = 0, totalCount = 0;
    const accounts: QianchuanSubaccountCatalog["accounts"] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= (totalPages || 1); page++) {
      await this.fresh(snapshot, signal, guard);
      const result = ListSchema.parse(await this.request(snapshot, listPath, { page, limit: 100, keyword: "", aavid: snapshot.account.advertiserId, gfversion: snapshot.gfversion }, signal));
      if (page === 1) { totalPages = result.totalPages; totalCount = result.totalCount; }
      if (result.currentPage !== page || result.totalPages !== totalPages || result.totalCount !== totalCount || !result.accounts.length) throw extensionChanged();
      for (const row of result.accounts) {
        if (seen.has(row.advertiserId)) throw extensionChanged();
        seen.add(row.advertiserId); accounts.push(row);
      }
      if (accounts.length > totalCount) throw extensionChanged();
    }
    if (accounts.length !== totalCount) throw extensionChanged();
    await this.info(snapshot, signal); await this.fresh(snapshot, signal, guard);
    return QianchuanSubaccountCatalogSchema.parse({ current: snapshot.account, accounts });
  }
  async switch(snapshot: ExtensionSnapshot, advertiserId: string, signal: AbortSignal, guard: () => Promise<void>): Promise<ExtensionSnapshot> {
    const catalog = await this.accounts(snapshot, signal, guard), chosen = catalog.accounts.find(account => account.advertiserId === advertiserId);
    if (!chosen) throw extensionChanged();
    await this.fresh(snapshot, signal, guard);
    if (chosen.advertiserId === snapshot.account.advertiserId) return snapshot;
    const after = ExtensionSnapshotSchema.parse(await this.call({ kind: "switch", snapshot, chosen }, signal));
    if (after.tabId !== snapshot.tabId || after.account.advertiserId !== chosen.advertiserId || after.account.name !== chosen.name || after.documentId === snapshot.documentId) throw extensionChanged();
    await this.info(after, signal); await this.fresh(after, signal, guard); return after;
  }
  async plans(snapshot: ExtensionSnapshot, signal: AbortSignal, guard: () => Promise<void> = async () => {}): Promise<QianchuanPlanOption[]> {
    await this.fresh(snapshot, signal, guard);
    const plans = QianchuanPlanListSchema.parse(await this.call({ kind: "plans", snapshot }, signal));
    if (plans.some(plan => plan.advertiserId !== snapshot.account.advertiserId)) throw extensionChanged();
    await this.fresh(snapshot, signal, guard); return plans;
  }
}
