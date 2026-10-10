import { createHash } from "node:crypto";
import type { Frame, Page, Request, Response } from "playwright-core";

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_WAIT_MS = 120_000;
const BIND_PATH = "/ad/api/creation/material/bind-video-to-owner";
const ADD_PATH = "/ad/api/pmc/v1/uni-promotion/material/add-uni-prom-materials";

type RequestKind = "bind" | "add";
type BoundVideos = { kind: "bind"; bytes: Buffer; videoIdsByFilename: ReadonlyMap<string, string> };
type AddedVideos = { kind: "add"; bytes: Buffer; videoIds: readonly string[] };
type CapturedRequest = BoundVideos | AddedVideos;
type CapturedResponse = { sha256: string };

export type QianchuanConfirmationReceipt = {
  videoIds: string[];
  requestSha256: string;
  responseSha256: string;
  observedAt: string;
};

export type QianchuanConfirmationReceiptObserverOptions = {
  page: Page;
  frame: Frame;
  advertiserId: string;
  adId: string;
  filenames: readonly string[];
  /** Override only for an isolated local HTTP fixture. Production defaults to the real Qianchuan origin. */
  origin?: string;
};

function fail(message: string): never { throw new Error(message); }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("千川确认回执格式无效。");
  return value as Record<string, unknown>;
}

function parseJson(bytes: Buffer): Record<string, unknown> {
  if (!bytes.length || bytes.length > MAX_JSON_BYTES) fail("千川确认回执正文超出大小限制。");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail("千川确认回执正文不是有效 JSON。"); }
  return record(value);
}

function parseVideoId(value: unknown): string {
  if (typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && /^[A-Za-z0-9_-]{1,128}$/.test(String(value))) return String(value);
  return fail("千川素材视频 ID 无效。");
}

function assertKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) fail("千川确认请求包含未授权素材字段。");
}

function assertBodyAdvertiser(body: Record<string, unknown>, advertiserId: string): void {
  if (Object.hasOwn(body, "aavid") && String(body.aavid) !== advertiserId) fail("千川确认请求正文账号不匹配。");
  if (Object.hasOwn(body, "_origin_ajax_") && body._origin_ajax_ !== 1) fail("千川确认请求来源标记无效。");
}

function parseBinding(bytes: Buffer, filenames: readonly string[], advertiserId: string): BoundVideos {
  const body = parseJson(bytes);
  assertKeys(body, ["vids", "aavid", "_origin_ajax_"]);
  assertBodyAdvertiser(body, advertiserId);
  if (!Array.isArray(body.vids) || body.vids.length !== filenames.length) fail("千川绑定素材数量与冻结文件不一致。");
  const expected = new Set(filenames), names = new Set<string>(), videoIds = new Set<string>(), byFilename = new Map<string, string>();
  for (const item of body.vids) {
    const row = record(item), filename = row.file_name;
    assertKeys(row, ["file_name", "video_id", "tags", "NeedAgentAuthorizationProtect"]);
    if (typeof filename !== "string" || !expected.has(filename) || names.has(filename)) fail("千川绑定素材文件名不匹配或重复。");
    const videoId = parseVideoId(row.video_id);
    if (videoIds.has(videoId)) fail("千川绑定素材视频 ID 必须唯一。");
    names.add(filename); videoIds.add(videoId); byFilename.set(filename, videoId);
  }
  if (names.size !== expected.size) fail("千川绑定素材未覆盖全部冻结文件。");
  return { kind: "bind", bytes, videoIdsByFilename: byFilename };
}

function videoIdsFromMaterials(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 250) fail("千川计划素材列表格式无效。");
  return value.map(item => parseVideoId(record(item).videoId));
}

function parseVideoOnlyCreative(value: unknown): string[] {
  const creative = record(value);
  assertKeys(creative, ["videoMaterial", "titleMaterial"]);
  if (Object.hasOwn(creative, "titleMaterial") && (!Array.isArray(creative.titleMaterial) || creative.titleMaterial.length !== 0)) {
    fail("定时上传不接受附加标题素材。");
  }
  return videoIdsFromMaterials(creative.videoMaterial);
}

function parseAdd(bytes: Buffer, advertiserId: string, adId: string, expectedCount: number): AddedVideos {
  const body = parseJson(bytes);
  assertKeys(body, ["aggregateAID", "proceduralCreative", "createMultiProductsCreative", "aavid", "_origin_ajax_"]);
  assertBodyAdvertiser(body, advertiserId);
  if (body.aggregateAID !== adId) fail("千川添加素材计划与冻结计划不一致。");
  const hasDirect = Object.hasOwn(body, "proceduralCreative"), hasMulti = Object.hasOwn(body, "createMultiProductsCreative");
  if (hasDirect === hasMulti) fail("千川添加素材格式存在歧义。");
  let videoIds: string[];
  if (hasDirect) {
    videoIds = parseVideoOnlyCreative(body.proceduralCreative);
  } else {
    const products = body.createMultiProductsCreative;
    if (!Array.isArray(products) || products.length < 1 || products.length > 250) fail("千川多商品素材格式无效。");
    const productIds = new Set<string>();
    videoIds = products.flatMap(product => {
      const productRow = record(product);
      assertKeys(productRow, ["productId", "createCreativeInfo"]);
      const productId = parseVideoId(productRow.productId);
      if (productIds.has(productId)) fail("千川多商品计划商品 ID 必须唯一。");
      productIds.add(productId);
      const info = record(productRow.createCreativeInfo);
      assertKeys(info, ["proceduralCreative"]);
      return parseVideoOnlyCreative(info.proceduralCreative);
    });
  }
  if (videoIds.length !== expectedCount || new Set(videoIds).size !== expectedCount) fail("千川添加素材视频 ID 数量或唯一性不匹配。");
  return { kind: "add", bytes, videoIds };
}

function requestKind(url: URL): RequestKind | null {
  if (url.pathname === BIND_PATH) return "bind";
  if (url.pathname === ADD_PATH) return "add";
  return null;
}

function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

/**
 * Passively observes the exact two requests made by the platform's second confirmation.
 * Construct immediately before that click; this class never issues or modifies a request.
 */
export class QianchuanConfirmationReceiptObserver {
  private readonly expectedFiles: readonly string[];
  private readonly origin: string;
  private readonly requests = new Map<Request, CapturedRequest>();
  private readonly responses = new Map<Request, CapturedResponse>();
  private readonly responseSeen = new Set<Request>();
  private readonly requestCounts: Record<RequestKind, number> = { bind: 0, add: 0 };
  private waitCalled = false;
  private detached = false;
  private failure?: Error;
  private receipt?: QianchuanConfirmationReceipt;
  private timer?: ReturnType<typeof setTimeout>;
  private abortSignal?: AbortSignal;
  private abortListener?: () => void;
  private resolveWait?: (receipt: QianchuanConfirmationReceipt) => void;
  private rejectWait?: (error: Error) => void;

  private readonly onRequest = (request: Request): void => {
    if (this.detached) return;
    let url: URL;
    try { url = new URL(request.url()); } catch { return; }
    const kind = requestKind(url);
    if (!kind) return;
    try {
      if (request.frame() !== this.options.frame) return;
      if (url.origin !== this.origin || url.username || url.password) fail("千川确认请求来源不匹配。");
      if (request.method() !== "POST") fail("千川确认请求方法不匹配。");
      const advertiserValues = url.searchParams.getAll("aavid");
      if (advertiserValues.length !== 1 || advertiserValues[0] !== this.options.advertiserId) fail("千川确认请求账号不匹配。");
      if (request.redirectedFrom()) fail("千川确认请求发生重定向。");
      this.requestCounts[kind]++;
      if (this.requestCounts[kind] !== 1) fail("千川确认请求重复提交。");
      const bytes = request.postDataBuffer();
      if (!bytes || !bytes.length || bytes.length > MAX_JSON_BYTES) fail("千川确认请求正文超出大小限制。");
      const parsed = kind === "bind" ? parseBinding(bytes, this.expectedFiles, this.options.advertiserId) : parseAdd(bytes, this.options.advertiserId, this.options.adId, this.expectedFiles.length);
      this.requests.set(request, parsed);
      this.maybeComplete();
    } catch (error) { this.fail(error); }
  };

  private readonly onResponse = (response: Response): void => {
    if (this.detached) return;
    let request: Request;
    try { request = response.request(); } catch { return; }
    const captured = this.requests.get(request);
    if (!captured) return;
    if (this.responseSeen.has(request)) { this.fail(new Error("千川确认请求出现重复响应。")); return; }
    this.responseSeen.add(request);
    void this.captureResponse(response, request).catch(error => this.fail(error));
  };

  private readonly onRequestFailed = (request: Request): void => {
    if (this.requests.has(request)) this.fail(new Error("千川确认请求未收到平台响应。"));
  };

  constructor(private readonly options: QianchuanConfirmationReceiptObserverOptions) {
    const { advertiserId, adId, filenames } = options;
    if (!advertiserId || advertiserId.length > 128 || !adId || adId.length > 128 || !Array.isArray(filenames) || filenames.length < 1 || filenames.length > 250 ||
      filenames.some(name => typeof name !== "string" || name.length < 1 || name.length > 255) || new Set(filenames).size !== filenames.length) {
      throw new Error("千川确认观察器的冻结身份或文件列表无效。");
    }
    const origin = options.origin ?? "https://qianchuan.jinritemai.com";
    let parsedOrigin: URL;
    try { parsedOrigin = new URL(origin); } catch { throw new Error("千川确认观察器来源无效。"); }
    if (!/^https?:$/.test(parsedOrigin.protocol) || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash || parsedOrigin.username || parsedOrigin.password) {
      throw new Error("千川确认观察器来源无效。");
    }
    if (options.frame.page() !== options.page) throw new Error("千川确认观察器页面与冻结帧不一致。");
    this.origin = parsedOrigin.origin;
    this.expectedFiles = [...filenames];
    options.page.on("request", this.onRequest);
    options.page.on("response", this.onResponse);
    options.page.on("requestfailed", this.onRequestFailed);
  }

  wait(signal: AbortSignal, timeoutMs: number): Promise<QianchuanConfirmationReceipt> {
    if (this.waitCalled) return Promise.reject(new Error("千川确认回执只能等待一次。"));
    this.waitCalled = true;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_WAIT_MS) {
      this.fail(new Error("千川确认回执等待时限无效。"));
      return Promise.reject(this.failure!);
    }
    if (this.receipt) return Promise.resolve(this.receipt);
    if (this.failure) return Promise.reject(this.failure);
    if (this.detached) return Promise.reject(new Error("千川确认观察器已停止。"));
    return new Promise((resolve, reject) => {
      this.resolveWait = resolve; this.rejectWait = reject;
      if (signal.aborted) { this.fail(new Error("千川确认回执等待已中止。")); return; }
      this.abortSignal = signal;
      this.abortListener = () => this.fail(new Error("千川确认回执等待已中止。"));
      signal.addEventListener("abort", this.abortListener, { once: true });
      this.timer = setTimeout(() => this.fail(new Error("等待千川确认回执超时。")), timeoutMs);
      this.maybeComplete();
    });
  }

  dispose(): void {
    if (!this.receipt && !this.failure) this.fail(new Error("千川确认观察器已停止。"));
    else this.detach();
  }

  private async captureResponse(response: Response, request: Request): Promise<void> {
    if (response.status() !== 200) fail("千川确认请求 HTTP 状态不成功。");
    const contentLength = response.headers()["content-length"];
    if (contentLength === undefined || !/^\d+$/.test(contentLength) || Number(contentLength) > MAX_JSON_BYTES) {
      fail("千川确认响应正文超出大小限制。");
    }
    const bytes = await response.body();
    if (this.detached) return;
    if (!bytes.length || bytes.length > MAX_JSON_BYTES) fail("千川确认响应正文超出大小限制。");
    const body = parseJson(bytes);
    if (body.status_code !== 0) fail("千川平台未确认接受素材。");
    this.responses.set(request, { sha256: sha256(bytes) });
    this.maybeComplete();
  }

  private maybeComplete(): void {
    if (this.failure || this.receipt) return;
    const bindRequest = [...this.requests.entries()].find(([, value]) => value.kind === "bind");
    const addRequest = [...this.requests.entries()].find(([, value]) => value.kind === "add");
    if (!bindRequest || !addRequest) return;
    const bindResponse = this.responses.get(bindRequest[0]), addResponse = this.responses.get(addRequest[0]);
    if (!bindResponse || !addResponse) return;
    const binding = bindRequest[1];
    const addition = addRequest[1];
    if (binding.kind !== "bind" || addition.kind !== "add") { this.fail(new Error("千川确认回执请求类型不一致。")); return; }
    const expectedVideoIds = this.expectedFiles.map(filename => binding.videoIdsByFilename.get(filename));
    if (expectedVideoIds.some(id => !id) || new Set(expectedVideoIds).size !== this.expectedFiles.length ||
      addition.videoIds.length !== expectedVideoIds.length || addition.videoIds.some(id => !expectedVideoIds.includes(id))) {
      this.fail(new Error("千川绑定素材与计划素材视频 ID 不一致。")); return;
    }
    this.receipt = { videoIds: expectedVideoIds as string[], requestSha256: sha256(addition.bytes), responseSha256: addResponse.sha256, observedAt: new Date().toISOString() };
    this.detach();
    if (this.resolveWait) this.resolveWait(this.receipt);
  }

  private fail(error: unknown): void {
    if (this.receipt || this.failure) return;
    this.failure = error instanceof Error ? error : new Error("千川确认回执观察失败。");
    this.detach();
    if (this.rejectWait) this.rejectWait(this.failure);
  }

  private detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.options.page.off("request", this.onRequest);
    this.options.page.off("response", this.onResponse);
    this.options.page.off("requestfailed", this.onRequestFailed);
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.abortSignal && this.abortListener) this.abortSignal.removeEventListener("abort", this.abortListener);
    this.abortSignal = undefined; this.abortListener = undefined;
  }
}

export function createQianchuanConfirmationReceiptObserver(options: QianchuanConfirmationReceiptObserverOptions): QianchuanConfirmationReceiptObserver {
  return new QianchuanConfirmationReceiptObserver(options);
}
