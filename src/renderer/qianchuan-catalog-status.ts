import type { QianchuanCatalogCacheInfo } from "../shared/qianchuan-plan-selection";

export function qianchuanCatalogStatus(cache?: QianchuanCatalogCacheInfo): string | undefined {
  if (!cache) return undefined;
  const readAt = new Intl.DateTimeFormat("zh-HK", { dateStyle: "short", timeStyle: "short" }).format(cache.readAt);
  const history = cache.source === "cache" ? "历史目录" : "网页目录";
  return `${history} · 最近读取 ${readAt}${cache.stale ? " · 较早记录" : ""}${cache.refreshFailed ? " · 刷新失败，保留历史目录" : ""}${cache.persisted === false ? " · 本次未能写入持久缓存" : ""}`;
}

export function retainQianchuanCatalogAfterFailure(cache?: QianchuanCatalogCacheInfo): QianchuanCatalogCacheInfo {
  return { source: "cache", readAt: cache?.readAt ?? Date.now(), stale: true, refreshFailed: true, ...(cache?.persisted === undefined ? {} : { persisted: cache.persisted }) };
}
