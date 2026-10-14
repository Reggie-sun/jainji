import type { JSHandle, Page } from "playwright-core";
import type { QianguanjiaAccountDirectory, QianguanjiaHomeMetrics, QianguanjiaHomeSummary } from "../shared/qianguanjia.js";
export type { QianguanjiaAccountDirectory, QianguanjiaHomeMetrics, QianguanjiaHomeSummary } from "../shared/qianguanjia.js";
interface SupplierStore {
  getters: { token?: unknown };
  state: { user: { userInfo: { id?: unknown; merchantId?: unknown } } };
}
interface SupplierRoot extends Element { __vue__?: { $store?: SupplierStore } }
interface SupplierSession { document: Document; store: SupplierStore; token: string; userId: string; merchantId: string }
const errors = {
  login: "千管家尚未正常登录，请恢复登录后重新连接。",
  session: "千管家会话已变化，请在正常页面重新连接。",
  query: "千管家读取未完成，请检查正常登录、试用权限或返回数据。",
  cancel: "千管家读取已取消。",
};

/** Main-process, fixed read-only supplier recipes. Customer credentials remain in an opaque browser handle. */
export class QianguanjiaReadonlyAdapter {
  private disposed = false;
  private readonly active = new Set<AbortController>();
  private constructor(private readonly page: Page, private readonly session: JSHandle<SupplierSession | null>,
    private readonly clock: () => Date) {}

  static async create(page: Page, clock = () => new Date()): Promise<QianguanjiaReadonlyAdapter> {
    let session: JSHandle<SupplierSession | null> | undefined;
    try {
      if (page.isClosed()) throw new Error();
      session = await page.evaluateHandle(() => {
        const blocked = location.pathname.startsWith("/dist/login") || Array.from(document.querySelectorAll('input[type="password"],iframe[src*="captcha"]'))
          .some(node => !!node.getClientRects().length && getComputedStyle(node).visibility === "visible");
        if (blocked || location.origin !== "https://qc.uliangtech.com" || !location.pathname.startsWith("/dist/")) return null;
        const store = (document.querySelector("#app") as SupplierRoot | null)?.__vue__?.$store;
        const token = store?.getters?.token, user = store?.state?.user?.userInfo;
        if (!store || typeof token !== "string" || !token.length || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token) ||
          typeof user?.id !== "string" || !/^[1-9]\d{0,19}$/.test(user.id) || typeof user.merchantId !== "string") return null;
        return { document, store, token, userId: user.id, merchantId: user.merchantId };
      });
      if (!await page.evaluate(value => !!value, session)) throw new Error();
      return new QianguanjiaReadonlyAdapter(page, session, clock);
    } catch {
      await session?.dispose().catch(() => undefined);
      throw new Error(errors.login);
    }
  }

  private async read(kind: "accounts" | "home", signal: AbortSignal): Promise<QianguanjiaAccountDirectory | QianguanjiaHomeSummary> {
    if (this.disposed || this.page.isClosed()) throw new Error(errors.session);
    const cancel = new AbortController(); this.active.add(cancel);
    const combined = AbortSignal.any([signal, cancel.signal, AbortSignal.timeout(20000)]);
    let controller: JSHandle<AbortController> | undefined;
    const abort = () => { if (controller) void this.page.evaluate(value => value.abort(), controller).catch(() => undefined); };
    combined.addEventListener("abort", abort, { once: true });
    try {
      combined.throwIfAborted();
      const observedAt = this.clock().toISOString();
      const date = new Date(Date.parse(observedAt) + 8 * 3600000).toISOString().slice(0, 10);
      controller = await this.page.evaluateHandle(() => new AbortController());
      combined.throwIfAborted();
      const result = await this.page.evaluate(async ({ session, controller, kind, date, observedAt }) => {
        const guard = () => {
          const store = (document.querySelector("#app") as SupplierRoot | null)?.__vue__?.$store;
          const user = store?.state?.user?.userInfo;
          const blocked = location.pathname.startsWith("/dist/login") || Array.from(document.querySelectorAll('input[type="password"],iframe[src*="captcha"]'))
            .some(node => !!node.getClientRects().length && getComputedStyle(node).visibility === "visible");
          return !!session && session.document === document && location.origin === "https://qc.uliangtech.com" &&
            !blocked && location.pathname.startsWith("/dist/") && store === session.store && store?.getters?.token === session.token &&
            user?.id === session.userId && user?.merchantId === session.merchantId;
        };
        if (!guard()) return { error: "session" as const };
        const fields = ["statCost", "totalPayOrderGmvIncludeCouponForRoi2", "totalPayOrderCountForRoi2", "totalPrepayAndPayOrderRoi2"] as const;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
          const endpoint = kind === "accounts" ? "https://qc-api.uliangtech.com/mms/qianchuanAdvertiser/listAdvertisers" :
            "https://qc-api.uliangtech.com/qianchuan/homereport/uniHomeTop";
          const response = await fetch(endpoint, { method: "POST", credentials: "omit", redirect: "error", cache: "no-store",
            headers: { "Content-Type": "application/json", token: session!.token, Channel: "PC", appType: "qianchuan" },
            body: JSON.stringify(kind === "accounts" ? {} : { startDate: `${date} 00:00:00`, endDate: `${date} 23:59:59`, selectFields: fields }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
          if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json") || !response.body) throw new Error();
          reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.length; if (size > 2 * 1024 * 1024) throw new Error();
            chunks.push(chunk.value);
          }
          if (!guard()) return { error: "session" as const };
          const bytes = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          const object = (value: unknown): Record<string, unknown> => {
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
            return value as Record<string, unknown>;
          };
          const text = (value: unknown, max: number) => {
            if (typeof value !== "string" || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error();
            return value;
          };
          const json = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
          if (json.code !== 0) throw new Error();
          let data: QianguanjiaAccountDirectory | QianguanjiaHomeSummary;
          if (kind === "accounts") {
            if (!Array.isArray(json.data) || json.data.length > 10000) throw new Error();
            const accounts = json.data.map(value => {
              const row = object(value), advertiserId = text(row.outAdvertiserId, 20);
              if (!/^[1-9]\d{0,19}$/.test(advertiserId) || typeof row.authStatus !== "number" || !Number.isSafeInteger(row.authStatus)) throw new Error();
              return { advertiserId, name: text(row.name, 512), authStatus: row.authStatus, authStatusDesc: text(row.authStatusDesc, 128) };
            });
            if (new Set(accounts.map(row => row.advertiserId)).size !== accounts.length) throw new Error();
            data = { source: "qianguanjia", observedAt, accounts };
          } else {
            const home = object(json.data);
            const metrics = (value: unknown): QianguanjiaHomeMetrics => {
              const row = object(value);
              return Object.fromEntries(fields.map(field => {
                const value = row[field];
                const number = typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? String(value) : value;
                if (typeof number !== "string" || number.length > 128 || !/^-?\d+(?:\.\d+)?$/.test(number)) throw new Error();
                return [field, number];
              })) as unknown as QianguanjiaHomeMetrics;
            };
            const groups = Object.fromEntries((["ALL", "LIVE_PROM_GOODS", "VIDEO_PROM_GOODS"] as const).map(key => {
              const group = object(home[key]); return [key, { current: metrics(group.nowTotalData), comparison: metrics(group.oldTotalData) }];
            })) as QianguanjiaHomeSummary["groups"];
            data = { source: "qianguanjia", scope: "supplier-home-aggregate", date, observedAt, groups };
          }
          // Whitelist inside the browser before crossing CDP; reject credential reflection even in allowed fields.
          const containsToken = (value: unknown): boolean => typeof value === "string" ? value.includes(session!.token) :
            !!value && typeof value === "object" && Object.values(value).some(containsToken);
          if (containsToken(data)) throw new Error();
          return { data };
        } catch { return { error: guard() ? "query" as const : "session" as const }; }
        finally { await reader?.cancel().catch(() => undefined); }
      }, { session: this.session, controller, kind, date, observedAt });
      combined.throwIfAborted();
      if (result.error === "session") { await this.dispose(); throw new Error(errors.session); }
      if (!result.data) throw new Error(errors.query);
      return result.data;
    } catch (error) {
      if (this.disposed) throw new Error(errors.session);
      if (combined.aborted) throw new Error(errors.cancel);
      if (error instanceof Error && error.message === errors.session) throw error;
      throw new Error(errors.query);
    } finally {
      combined.removeEventListener("abort", abort); this.active.delete(cancel);
      if (controller) {
        await this.page.evaluate(value => value.abort(), controller).catch(() => undefined);
        await controller.dispose().catch(() => undefined);
      }
    }
  }

  async listAdvertisers(signal: AbortSignal): Promise<QianguanjiaAccountDirectory> {
    return await this.read("accounts", signal) as QianguanjiaAccountDirectory;
  }
  async todayHomeSummary(signal: AbortSignal): Promise<QianguanjiaHomeSummary> {
    return await this.read("home", signal) as QianguanjiaHomeSummary;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const controller of this.active) controller.abort();
    await this.session.dispose().catch(() => undefined);
  }
}
