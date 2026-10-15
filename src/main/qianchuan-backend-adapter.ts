import type { JSHandle, Page } from "playwright-core";
import { QianchuanBackendQuerySchema, QIANCHUAN_QUERY_METRICS,
  type QianchuanBackendQuery, type QianchuanBackendResult, type QianchuanQueryMetrics,
} from "../shared/qianchuan-backend.js";

const origin = "https://qianchuan.jinritemai.com";
const failure = () => new Error("千川后端查询未完成，请检查账号登录、页面或数据格式后重试。");
const identityFailure = () => new Error("千川账号或查询页面已变化，请重新选择账号后查询。");
const dataFailure = () => new Error("千川返回的数据结构无法核对，未将缺失指标当作零。");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw dataFailure();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 255): string {
  if (typeof value !== "string" || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw dataFailure();
  return value;
}
function scalar(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return String(value);
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value) && value.length < 128) return value;
  throw dataFailure();
}
function readMetrics(value: unknown, capital: boolean): QianchuanQueryMetrics {
  const values = record(value);
  return Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(metric => {
    const key = capital ? metric : metric.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const cell = record(values[key]);
    return [metric, { value: scalar(cell[capital ? "Value" : "value"]), display: text(cell[capital ? "ValueStr" : "valueStr"], 128) }];
  })) as QianchuanQueryMetrics;
}
function period(query: Exclude<QianchuanBackendQuery, { kind: "plan" }>, now: Date) {
  // Qianchuan report dates use China Standard Time, independent of the host timezone.
  if (query.asOf) {
    const cutoff = new Date(query.asOf);
    if (cutoff.getTime() > now.getTime()) throw new Error("千川查询截止时刻不能在未来。");
    now = cutoff;
  }
  const current = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
  const startTime = `${query.startDate} 00:00:00`;
  const endTime = [`${query.endDate} 23:59:59`, current].sort()[0]!;
  if (endTime < startTime) throw new Error("千川查询日期尚未开始，请选择当前或历史日期。");
  return { startTime, endTime };
}
function condition(Field: string, Values: string[]) { return { Field, Operator: 7, Values }; }

/** Fixed read-only recipes, backed by REA observation; no official API or credential export. */
export class QianchuanBackendAdapter {
  private disposed = false;
  private readonly active = new Set<AbortController>();
  private constructor(private readonly page: Page, private readonly advertiserId: string,
    private readonly document: JSHandle<Document>, private readonly clock: () => Date) {}

  static async create(page: Page, advertiserId: string, clock = () => new Date()): Promise<QianchuanBackendAdapter> {
    if (!/^[1-9][0-9]{0,19}$/.test(advertiserId)) throw identityFailure();
    const document = await page.evaluateHandle(() => window.document);
    const adapter = new QianchuanBackendAdapter(page, advertiserId, document, clock);
    try { await adapter.guard(); return adapter; }
    catch { await adapter.dispose(); throw identityFailure(); }
  }
  private async guard(): Promise<void> {
    if (this.disposed || this.page.isClosed()) throw identityFailure();
    const valid = await this.page.evaluate(({ document, advertiserId, origin }) => {
      const url = new URL(location.href);
      if (document !== window.document || url.origin !== origin || url.pathname !== "/uni-prom" ||
        url.searchParams.getAll("aavid").length !== 1 || url.searchParams.get("aavid") !== advertiserId) return false;
      const visible = (node: Element) => !!node.getClientRects().length && getComputedStyle(node).visibility === "visible";
      const accounts = Array.from(document.querySelectorAll(".account-info-container")).filter(visible);
      const ids = accounts.flatMap(node => Array.from((node as HTMLElement).innerText.matchAll(/ID[：:]\s*([1-9][0-9]{0,19})/g), match => match[1]));
      return ids.length === 1 && ids[0] === advertiserId &&
        !Array.from(document.querySelectorAll('input[type="password"],iframe[src*="captcha"]')).some(visible);
    }, { document: this.document, advertiserId: this.advertiserId, origin }).catch(() => false);
    if (!valid) throw identityFailure();
  }
  private async request(path: string, method: "GET" | "POST", params: Record<string, string>, body: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
    signal.throwIfAborted(); await this.guard(); signal.throwIfAborted();
    const controller = new AbortController(); this.active.add(controller);
    const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(20000)]);
    const remote = await this.page.evaluateHandle(() => new AbortController());
    const abort = () => { void this.page.evaluate(controller => controller.abort(), remote).catch(() => undefined); };
    combined.addEventListener("abort", abort, { once: true });
    try {
      combined.throwIfAborted();
      const result = await this.page.evaluate(async ({ path, method, params, body, advertiserId, original, controller }) => {
        if (original !== window.document) return { ok: false as const };
        const url = new URL(path, location.origin); url.searchParams.set("aavid", advertiserId);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        try {
          const response = await fetch(url, { method, credentials: "same-origin", redirect: "error",
            headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
            body: method === "POST" ? JSON.stringify(body) : undefined,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          });
          if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json")) return { ok: false as const };
          const reader = response.body?.getReader(); if (!reader) return { ok: false as const };
          const chunks: Uint8Array[] = []; let length = 0;
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            length += value.length;
            if (length > 2 * 1024 * 1024) { await reader.cancel(); return { ok: false as const }; }
            chunks.push(value);
          }
          const bytes = new Uint8Array(length); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          const json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          if (json?.status_code !== 0 || !json.data || typeof json.data !== "object" || Array.isArray(json.data)) return { ok: false as const };
          // The observed playback cell contains signed preview data. Only its VideoId may leave the browser.
          if (path === "/ad/api/pmc/v1/uni-promotion/material/list-required" && Array.isArray(json.data.statsData?.rows)) {
            for (const row of json.data.statsData.rows) {
              const cell = row?.dimensions?.roi2MaterialVideoPlayInfo;
              if (cell === undefined) continue;
              if (typeof cell.value !== "string" || cell.value.length > 65536) return { ok: false as const };
              const play = JSON.parse(cell.value);
              if (!play || typeof play.VideoId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(play.VideoId)) return { ok: false as const };
              row.dimensions.roi2MaterialVideoPlayInfo = { value: JSON.stringify({ VideoId: play.VideoId }) };
            }
          }
          return { ok: true as const, data: json.data as Record<string, unknown> };
        } catch { return { ok: false as const }; }
      }, { path, method, params, body, advertiserId: this.advertiserId, original: this.document, controller: remote }).catch(() => ({ ok: false as const }));
      combined.throwIfAborted(); await this.guard(); combined.throwIfAborted();
      if (!result.ok || !("data" in result)) throw failure();
      return result.data;
    } finally {
      combined.removeEventListener("abort", abort); this.active.delete(controller);
      await this.page.evaluate(controller => controller.abort(), remote).catch(() => undefined);
      await remote.dispose().catch(() => undefined);
    }
  }
  async readDeliverySettings(adId: string, signal: AbortSignal) {
    if (!/^[1-9][0-9]{0,19}$/.test(adId)) throw dataFailure();
    const data = await this.request("/ad/api/creation/v1/ad/ad-detail-basic", "GET", { adid: adId, needCanDeliveryVerticalImage: "true" }, undefined, signal);
    const plan = record(data.adDetailInfo);
    if (plan.id !== adId || plan.budgetMode !== 0 || !Array.isArray(data.goodsInfos) || !data.goodsInfos.length || data.goodsInfos.length > 50) throw dataFailure();
    const productIds = data.goodsInfos.map(value => text(record(value).id));
    if (productIds.some(id => !/^[1-9][0-9]{0,19}$/.test(id)) || new Set(productIds).size !== productIds.length) throw dataFailure();
    return { adId, budget: scalar(plan.budget), budgetMode: 0 as const, roi: scalar(plan.ecpRoi2Goal), modifiedAt: scalar(plan.modifyTime), productIds };
  }
  async query(input: QianchuanBackendQuery, signal: AbortSignal): Promise<QianchuanBackendResult> {
    const query = QianchuanBackendQuerySchema.parse(input);
    if (query.expectedAdvertiserId !== this.advertiserId) throw identityFailure();
    const identity = { advertiserId: this.advertiserId, observedAt: this.clock().toISOString() };
    if (query.kind === "plan") {
      const data = await this.request("/ad/api/creation/v1/ad/ad-detail-basic", "GET", { adid: query.adId, needCanDeliveryVerticalImage: "true" }, undefined, signal);
      const plan = record(data.adDetailInfo);
      if (plan.id !== query.adId) throw new Error("千川返回的计划与查询目标不一致。");
      if (!Array.isArray(data.goodsInfos) || data.goodsInfos.length > 50) throw dataFailure();
      const products = data.goodsInfos.map(value => {
        const product = record(value), id = text(product.id);
        if (!/^[1-9][0-9]{0,19}$/.test(id)) throw dataFailure();
        return { id, name: text(product.name) };
      });
      if (new Set(products.map(product => product.id)).size !== products.length) throw dataFailure();
      return { ...identity, kind: "plan", adId: query.adId, name: text(plan.name), budget: scalar(plan.budget), roiGoal: scalar(plan.ecpRoi2Goal), products };
    }
    const times = period(query, this.clock());
    if (query.kind === "report") {
      const data = await this.request("/ad/api/data/v1/common/statQuery", "POST", {}, {
        Dimensions: ["marketing_goal"], StartTime: times.startTime, EndTime: times.endTime,
        DataSetKey: "product_roi2_promotion", Metrics: [...QIANCHUAN_QUERY_METRICS],
        Filters: { ConditionRelationshipType: 1, Conditions: [condition("advertiser_id", [this.advertiserId]),
          condition("pricing_category", ["2"]), condition("marketing_goal", ["1"]), condition("ecp_app_id", ["1"]),
          condition("campaign_type", ["1"]), condition("adlab_mode", ["1"])] },
        FilterParams: { promotion_overview: ["1"] },
      }, signal);
      const stats = record(data.StatsData);
      return { ...identity, ...times, kind: "report", metrics: readMetrics(stats.Totals, true) };
    }
    const data = await this.request("/ad/api/pmc/v1/uni-promotion/material/list-required", "POST", {}, {
      DataSetKey: "site_promotion_product_post_data_video", Metrics: [...QIANCHUAN_QUERY_METRICS],
      Dimensions: ["material_id", "roi2_material_video_name", "roi2_material_video_play_info"], StartTime: times.startTime, EndTime: times.endTime,
      Filters: { ConditionRelationshipType: 1, Conditions: [condition("query_type", ["all"]), condition("roi2_material_type_v3", ["1001"]),
        condition("marketing_goal", ["1"]), condition("roi2_material_status", ["1"]), condition("ad_id", [query.adId]), condition("roi2_material_video_type", ["11"])] },
      PageParams: { Limit: query.limit, Offset: query.offset }, OrderBy: [{ Type: 2, Field: "stat_cost_for_roi2" }], reqFrom: "uni-prom-creative-tab-list",
    }, signal);
    const stats = record(data.statsData);
    // The platform represents a successful empty material filter as {}.
    if (!Object.keys(stats).length && !query.offset) return { ...identity, ...times, kind: "materials", adId: query.adId, offset: query.offset, limit: query.limit, total: 0, rows: [] };
    if (typeof stats.totalCount !== "string" || !/^(0|[1-9]\d*)$/.test(stats.totalCount)) throw dataFailure();
    const total = Number(stats.totalCount);
    if (!Number.isSafeInteger(total) || total > 20000 || !Array.isArray(stats.rows) ||
      stats.rows.length !== Math.min(query.limit, Math.max(0, total - query.offset)) || total > 0 && query.offset >= total) throw dataFailure();
    const rows = stats.rows.map(value => {
      const row = record(value), dimensions = record(row.dimensions);
      const materialId = text(record(dimensions.materialId).value);
      if (!/^[1-9][0-9]{0,19}$/.test(materialId)) throw dataFailure();
      const play = dimensions.roi2MaterialVideoPlayInfo;
      const videoId = play === undefined ? undefined : text(record(JSON.parse(text(record(play).value, 1024))).VideoId, 128);
      if (videoId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(videoId)) throw dataFailure();
      return { materialId, ...(videoId === undefined ? {} : { videoId }), name: text(record(dimensions.roi2MaterialVideoName).value), metrics: readMetrics(row.metrics, false) };
    });
    if (new Set(rows.map(row => row.materialId)).size !== rows.length) throw dataFailure();
    return { ...identity, ...times, kind: "materials", adId: query.adId, offset: query.offset, limit: query.limit, total, rows };
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const controller of this.active) controller.abort();
    await this.document.dispose().catch(() => undefined);
  }
}
