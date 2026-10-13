/** Main-process read-only Open API port; credentials must come from an authorized owner. */
export interface QianchuanVideoQuery { advertiserId: string; page: number; pageSize: number }
export interface QianchuanVideoPage {
  advertiserId: string; page: number; pageSize: number; total: number;
  videos: { videoId: string; filename: string; signature: string; durationSeconds: number }[];
}
export interface QianchuanVideoAuthorization { accessToken: string; advertiserIds: readonly string[] }
const endpoint = "https://api.oceanengine.com/open_api/v1.0/qianchuan/video/get/";
const fail = () => new Error("千川官方素材查询未完成，请检查授权、权限或返回数据。");
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail();
  return value as Record<string, unknown>;
};
const string = (value: unknown, maximum: number): string => {
  if (typeof value !== "string" || !value.length || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw fail();
  return value;
};
const integer = (value: unknown, minimum: number, maximum: number): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw fail();
  return value;
};

/** Only GET video/get is exposed; no browser tokens, redirects, writes, retries or URL projection. */
export class QianchuanOpenApiVideos {
  constructor(private readonly authorize: (advertiserId: string) => QianchuanVideoAuthorization,
    private readonly transport: typeof fetch = fetch) {}

  async list(input: QianchuanVideoQuery, signal: AbortSignal): Promise<QianchuanVideoPage> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      // Capture the target before credentials are resolved; caller mutation cannot change it.
      const advertiserId = string(input.advertiserId, 20);
      if (!/^[1-9]\d{0,19}$/.test(advertiserId)) throw fail();
      const pageSize = integer(input.pageSize, 1, 100);
      const page = integer(input.page, 1, Math.ceil(10000 / pageSize));
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
      timeout.throwIfAborted();
      const authorization = this.authorize(advertiserId);
      timeout.throwIfAborted();
      if (!Array.isArray(authorization.advertiserIds) || !authorization.advertiserIds.includes(advertiserId)) throw fail();
      const token = string(authorization.accessToken, 4096);
      if (!/^[\x21-\x7e]+$/.test(token)) throw fail();
      const url = new URL(endpoint);
      url.searchParams.set("advertiser_id", advertiserId);
      url.searchParams.set("page", String(page)); url.searchParams.set("page_size", String(pageSize));
      const response = await this.transport(url, { method: "GET", headers: { "Access-Token": token },
        credentials: "omit", redirect: "error", cache: "no-store", signal: timeout });
      if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json") || !response.body) throw fail();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        timeout.throwIfAborted();
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length; if (size > 2 * 1024 * 1024) throw fail();
        chunks.push(chunk.value);
      }
      timeout.throwIfAborted();
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const result = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      if (result.code !== 0) throw fail();
      const data = object(result.data), pagination = object(data.page_info);
      if (pagination.page !== page || pagination.page_size !== pageSize) throw fail();
      const total = integer(pagination.total_number, 0, 10000);
      const totalPages = integer(pagination.total_page, 0, 10000);
      if (totalPages !== Math.ceil(total / pageSize) || !Array.isArray(data.list) || data.list.length > pageSize ||
        data.list.length > total || total > 0 && page > totalPages || total === 0 && page !== 1) throw fail();
      const videos = data.list.map(value => {
        const video = object(value);
        // The documented id is a string; numeric material_id is deliberately not parsed as an ID.
        const videoId = string(video.id, 128), filename = string(video.filename, 512);
        const signature = string(video.signature, 32);
        if (!/^[a-fA-F0-9]{32}$/.test(signature) || typeof video.duration !== "number" ||
          !Number.isFinite(video.duration) || video.duration < 0) throw fail();
        return { videoId, filename, signature, durationSeconds: video.duration };
      });
      if (new Set(videos.map(video => video.videoId)).size !== videos.length) throw fail();
      return { advertiserId, page, pageSize, total, videos };
    } catch { throw fail(); }
    finally { await reader?.cancel().catch(() => undefined); }
  }
}
