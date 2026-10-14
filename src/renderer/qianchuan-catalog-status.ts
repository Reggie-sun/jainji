import type { QianchuanCatalogCacheInfo } from "../shared/qianchuan-plan-selection";

export function retainQianchuanCatalogAfterFailure(cache?: QianchuanCatalogCacheInfo): QianchuanCatalogCacheInfo {
  return { source: "cache", readAt: cache?.readAt ?? Date.now(), stale: true, refreshFailed: true, ...(cache?.persisted === undefined ? {} : { persisted: cache.persisted }) };
}
