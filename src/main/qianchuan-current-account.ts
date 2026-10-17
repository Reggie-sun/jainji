import WebSocket from "ws";
import { setTimeout as delay } from "node:timers/promises";
import { isLoopbackUrl } from "../shared/douyin-upload.js";
import { VIDEO_LIBRARY_ROUTE } from "../shared/qianchuan-video-library.js";
import { QianchuanCurrentAccountSchema, type QianchuanCurrentAccount } from "../shared/qianchuan-plan-selection.js";

const ORIGIN = "https://qianchuan.jinritemai.com";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_TARGETS = 256;
const MAX_CANDIDATES = 32;
const OPERATION_TIMEOUT_MS = 4_000;
const DETACH_TIMEOUT_MS = 1_000;
const readTimeout = () => Object.assign(new Error("读取千川浏览器连接超时，尚未选择文件。"), { code: "ETIMEDOUT" });
const ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const ACCOUNT_ROUTES = new Set(["/home", "/uni-prom", "/finance", "/account-center/account-info", VIDEO_LIBRARY_ROUTE]);
const FAILURE = "无法确认千川网页当前子账户，请检查当前页面后重试。";

interface Candidate { targetId: string; url: string; advertiserId: string; }
interface PageSnapshot { href: string; visibilityState: string; accountTexts: string[]; accountBlocked?: boolean; }
export class AccountPageLoading extends Error { constructor() { super(FAILURE); } }

function transportFailure(cause: unknown): Error {
  return new Error(FAILURE, { cause });
}

function closeFailure(code: number): Error {
  if (code === 1006 || code === 1001) {
    return transportFailure(Object.assign(new Error("Browser connection closed during account read."), { code: "ECONNRESET" }));
  }
  return new Error(FAILURE);
}

function accountPageUrlIdentity(value: string): string | undefined {
  const url = new URL(value), hash = new URLSearchParams(url.hash.slice(1));
  const times = hash.getAll("dut");
  if (url.origin !== ORIGIN || url.pathname !== "/uni-prom" || times.length !== 1 ||
    !/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d$/.test(times[0]!)) return undefined;
  const offset = value.indexOf("#");
  // The dashboard refresh clock is not account state. Preserve every other URL byte.
  return value.slice(0, offset + 1) + value.slice(offset + 1).replace(/(^|&)dut=[^&]*/, "$1dut=");
}

export function sameQianchuanAccountPageUrl(left: string, right: string): boolean {
  if (left === right) return true;
  const identity = accountPageUrlIdentity(left);
  return identity !== undefined && identity === accountPageUrlIdentity(right);
}

function validPort(value: string): boolean {
  const port = Number(value);
  return /^[1-9][0-9]{0,4}$/.test(value) && port <= 65535;
}

function browserWebSocket(value: string): URL {
  const url = new URL(value);
  if (!isLoopbackUrl(value, true) || !validPort(url.port) || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(url.pathname)) throw new Error(FAILURE);
  return url;
}

async function boundedBody(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error(FAILURE);
  if (!response.body) throw new Error(FAILURE);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) throw new Error(FAILURE);
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString("utf8");
}

export async function browserEndpoint(endpoint: string, signal: AbortSignal): Promise<string> {
  const url = new URL(endpoint);
  if (url.protocol === "ws:") return browserWebSocket(endpoint).href;
  if (!isLoopbackUrl(endpoint) || !validPort(url.port) || url.pathname !== "/") throw new Error(FAILURE);
  const response = await fetch(new URL("/json/version", url), { redirect: "error", signal, headers: { accept: "application/json" } });
  if (!response.ok || response.redirected) throw new Error(FAILURE);
  let metadata: unknown;
  try { metadata = JSON.parse(await boundedBody(response, 64 * 1024, signal)); }
  catch (error) { if (signal.aborted) throw signal.reason; throw error; }
  if (!metadata || typeof metadata !== "object" || typeof (metadata as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl !== "string") throw new Error(FAILURE);
  const socket = browserWebSocket((metadata as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl);
  if (socket.hostname !== url.hostname || socket.port !== url.port) throw new Error(FAILURE);
  return socket.href;
}

class CdpConnection {
  private nextId = 0;
  private receivedBytes = 0;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>();
  private readonly sessions = new Set<string>();

  constructor(private readonly socket: WebSocket, private readonly signal: AbortSignal) {
    socket.on("message", data => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
      this.receivedBytes += bytes.byteLength;
      if (bytes.byteLength > MAX_RESPONSE_BYTES || this.receivedBytes > MAX_TOTAL_BYTES) { this.fail(new Error(FAILURE)); socket.terminate(); return; }
      let message: { id?: unknown; result?: unknown; error?: unknown };
      try { message = JSON.parse(bytes.toString("utf8")) as typeof message; }
      catch { this.fail(new Error(FAILURE)); socket.terminate(); return; }
      if (typeof message.id !== "number") return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(FAILURE)); else waiter.resolve(message.result);
    });
    socket.on("error", error => this.fail(transportFailure(error)));
    socket.on("close", code => this.fail(closeFailure(code)));
    signal.addEventListener("abort", () => this.fail(signal.reason), { once: true });
  }

  private fail(error: unknown): void {
    for (const [id, waiter] of this.pending) { this.pending.delete(id); waiter.reject(error); }
  }

  async call(method: string, params: Record<string, unknown> = {}, sessionId?: string, cleanup = false): Promise<unknown> {
    if (!cleanup) this.signal.throwIfAborted();
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error(FAILURE);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const message = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
      if (Buffer.byteLength(message) > 64 * 1024) { this.pending.delete(id); reject(new Error(FAILURE)); return; }
      this.socket.send(message, error => { if (error) { this.pending.delete(id); reject(transportFailure(error)); } });
    });
  }

  track(sessionId: string): void { this.sessions.add(sessionId); }

  async detach(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) return;
    if (this.socket.readyState !== WebSocket.OPEN) { this.sessions.delete(sessionId); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.call("Target.detachFromTarget", { sessionId }, undefined, true),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(readTimeout()), DETACH_TIMEOUT_MS); }),
      ]);
    }
    finally { if (timer) clearTimeout(timer); this.sessions.delete(sessionId); }
  }

  async close(): Promise<void> {
    for (const sessionId of this.sessions) await this.detach(sessionId).catch(() => undefined);
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.socket.terminate(); resolve(); }, 250);
      this.socket.once("close", () => { clearTimeout(timer); resolve(); });
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000);
      else this.socket.terminate();
    });
  }
}

function candidates(value: unknown, excludedTargets: ReadonlySet<string>, allowRoot: boolean, browserContextId?: string): Candidate[] {
  if (!Array.isArray(value) || value.length > MAX_TARGETS) throw new Error(FAILURE);
  const result: Candidate[] = [];
  const seenTargets = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") throw new Error(FAILURE);
    const target = entry as { targetId?: unknown; type?: unknown; url?: unknown; browserContextId?: unknown };
    if (browserContextId !== undefined && target.browserContextId !== browserContextId) continue;
    if (target.type !== "page" || typeof target.url !== "string") continue;
    let url: URL;
    try { url = new URL(target.url); } catch { continue; }
    if (url.origin !== ORIGIN || !(ACCOUNT_ROUTES.has(url.pathname) || allowRoot && url.pathname === "/")) continue;
    if (url.username || url.password) throw new Error(FAILURE);
    if (url.searchParams.has("jianjiPlanPicker")) continue;
    if (typeof target.targetId !== "string" || !target.targetId) throw new Error(FAILURE);
    if (excludedTargets.has(target.targetId)) continue;
    if (seenTargets.has(target.targetId)) throw new Error(FAILURE);
    seenTargets.add(target.targetId);
    const ids = url.searchParams.getAll("aavid");
    if (ids.length !== 1 || !ID_PATTERN.test(ids[0]!)) throw new Error(FAILURE);
    result.push({ targetId: target.targetId, url: target.url, advertiserId: ids[0]! });
    if (result.length > MAX_CANDIDATES) throw new Error(FAILURE);
  }
  return result.sort((left, right) => left.targetId.localeCompare(right.targetId));
}

const SNAPSHOT_EXPRESSION = `(() => {
  const onscreen = rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  const visible = element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && onscreen(rect);
  };
  const blocked = () => {
    if (!document.body) return false;
    const prompt = value => {
      const text = value.replace(/\\s+/g, "");
      return /请.{0,12}(?:登录|验证码|验证)|登录.{0,8}失效|验证码|人机验证|安全验证|访问验证|无权限|权限不足/.test(text);
    };
    for (const element of document.querySelectorAll("body, body *")) {
      const ownText = Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent || "").join("");
      if ((!prompt(element.innerText || "") && !prompt(ownText)) || !visible(element)) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let rendered = "", ownRendered = "";
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement || !visible(node.parentElement)) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        if (!Array.from(range.getClientRects()).some(onscreen)) continue;
        rendered += node.textContent || "";
        if (node.parentElement === element) ownRendered += node.textContent || "";
      }
      if (prompt(rendered) || prompt(ownRendered)) return true;
    }
    return false;
  };
  return { href: location.href, visibilityState: document.visibilityState,
    accountTexts: Array.from(document.querySelectorAll(".account-info-container")).filter(visible).map(element => (element.querySelector(".account-info-box") || element).innerText),
    accountBlocked: blocked() };
})()`;

function validateSnapshot(value: unknown, candidate: Candidate): PageSnapshot {
  if (!value || typeof value !== "object") throw new Error(FAILURE);
  const snapshot = value as Partial<PageSnapshot>;
  if (typeof snapshot.href !== "string" || !sameQianchuanAccountPageUrl(snapshot.href, candidate.url) || !["visible", "hidden"].includes(snapshot.visibilityState ?? "") || !Array.isArray(snapshot.accountTexts) || snapshot.accountTexts.some(text => typeof text !== "string")) throw new Error(FAILURE);
  const url = new URL(snapshot.href);
  const ids = url.searchParams.getAll("aavid");
  if (url.origin !== ORIGIN || ids.length !== 1 || ids[0] !== candidate.advertiserId) throw new Error(FAILURE);
  if (snapshot.accountBlocked !== undefined && typeof snapshot.accountBlocked !== "boolean") throw new Error(FAILURE);
  return { href: snapshot.href, visibilityState: snapshot.visibilityState!, accountTexts: snapshot.accountTexts as string[], accountBlocked: snapshot.accountBlocked };
}

function domAccount(texts: string[]): QianchuanCurrentAccount {
  if (texts.length !== 1) throw new Error(FAILURE);
  const text = texts[0]!.replace(/\s+/g, " ").trim();
  const markers = [...text.matchAll(/ID\s*[：:]/gi)];
  const match = /ID\s*[：:]\s*([0-9]+)(?![\p{L}\p{N}_])/iu.exec(text);
  if (markers.length !== 1 || !match || !ID_PATTERN.test(match[1]!)) throw new Error(FAILURE);
  const name = text.slice(0, match.index).trim();
  return QianchuanCurrentAccountSchema.parse({ advertiserId: match[1]!, ...(name ? { name } : {}) });
}

async function readPage(connection: CdpConnection, candidate: Candidate): Promise<PageSnapshot> {
  const attached = await connection.call("Target.attachToTarget", { targetId: candidate.targetId, flatten: true }) as { sessionId?: unknown };
  if (!attached || typeof attached.sessionId !== "string" || !attached.sessionId) throw new Error(FAILURE);
  const sessionId = attached.sessionId;
  connection.track(sessionId);
  try {
    const evaluated = await connection.call("Runtime.evaluate", { expression: SNAPSHOT_EXPRESSION, returnByValue: true }, sessionId) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    if (evaluated?.exceptionDetails || !evaluated?.result || !("value" in evaluated.result)) throw new Error(FAILURE);
    return validateSnapshot(evaluated.result.value, candidate);
  } finally { await connection.detach(sessionId); }
}

function selectedPages(pages: Array<{ candidate: Candidate; snapshot: PageSnapshot }>, allowSingleHidden: boolean) {
  const visible = pages.filter(page => page.snapshot.visibilityState === "visible");
  return visible.length || !allowSingleHidden || pages.length !== 1 ? visible : pages;
}

function uniqueAccount(pages: Array<{ candidate: Candidate; snapshot: PageSnapshot }>): QianchuanCurrentAccount {
  if (pages.some(page => page.snapshot.accountBlocked)) throw new Error(FAILURE);
  if (pages.length === 1 && !pages[0]!.snapshot.accountTexts.length && !pages[0]!.snapshot.accountBlocked) throw new AccountPageLoading();
  const accounts = new Map<string, QianchuanCurrentAccount>();
  for (const page of pages) {
    const account = domAccount(page.snapshot.accountTexts);
    if (account.advertiserId !== page.candidate.advertiserId) throw new Error(FAILURE);
    accounts.set(JSON.stringify(account), account);
  }
  if (accounts.size !== 1) throw new Error(FAILURE);
  return [...accounts.values()][0]!;
}

function candidateSignature(pages: Candidate[]): string {
  return JSON.stringify([...pages].sort((left, right) => left.targetId.localeCompare(right.targetId)).map(page => ({ ...page, url: accountPageUrlIdentity(page.url) ?? page.url })));
}

/** Reads the active advertiser from the already-bound local browser without changing its pages. */
export async function readCurrentQianchuanAccount(endpoint: string, parentSignal?: AbortSignal, excludedTargets: ReadonlySet<string> = new Set()): Promise<string> {
  return (await readCurrentQianchuanAccountSnapshot(endpoint, parentSignal, excludedTargets)).advertiserId;
}

export async function readCurrentQianchuanAccountSnapshot(endpoint: string, parentSignal?: AbortSignal, excludedTargets: ReadonlySet<string> = new Set()): Promise<QianchuanCurrentAccount> {
  return (await readCurrentAccountState(endpoint, parentSignal, excludedTargets)).account;
}

/** Only a newly opened upload browser may wait for its account DOM; conflicts are never retried. */
export async function waitForCurrentQianchuanAccount(endpoint: string, advertiserId: string, signal: AbortSignal): Promise<QianchuanCurrentAccount> {
  const waiting = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  while (true) {
    waiting.throwIfAborted();
    try {
      return (await readCurrentAccountState(endpoint, waiting, new Set(), false, false, undefined, advertiserId)).account;
    } catch (error) {
      waiting.throwIfAborted();
      if (!(error instanceof AccountPageLoading)) throw error;
      await delay(100, undefined, { signal: waiting });
    }
  }
}

/** The catalog may address the sole verified account page while another browser tab is active. */
export async function readCurrentQianchuanPage(endpoint: string, signal?: AbortSignal, excludedTargets: ReadonlySet<string> = new Set(), options: { allowSingleHidden?: boolean; allowRoot?: boolean; browserContextId?: string } = {}): Promise<{ account: QianchuanCurrentAccount; targetId: string; url: string }> {
  const state = await readCurrentAccountState(endpoint, signal, excludedTargets, options.allowSingleHidden === true, options.allowRoot === true, options.browserContextId);
  if (state.pages.length !== 1) throw new Error(FAILURE);
  return { account: state.account, targetId: state.pages[0]!.targetId, url: state.pages[0]!.url };
}

async function readCurrentAccountState(endpoint: string, parentSignal?: AbortSignal, excludedTargets: ReadonlySet<string> = new Set(), allowSingleHidden = false, allowRoot = false, browserContextId?: string, expectedAdvertiserId?: string): Promise<{ account: QianchuanCurrentAccount; pages: Candidate[] }> {
  parentSignal?.throwIfAborted();
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort(parentSignal?.reason ?? new DOMException("Aborted", "AbortError"));
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(readTimeout()); }, OPERATION_TIMEOUT_MS);
  let connection: CdpConnection | undefined;
  let socket: WebSocket | undefined;
  try {
    const socketUrl = await browserEndpoint(endpoint, controller.signal);
    controller.signal.throwIfAborted();
    socket = new WebSocket(socketUrl, { followRedirects: false, maxPayload: MAX_RESPONSE_BYTES, perMessageDeflate: false });
    await new Promise<void>((resolve, reject) => {
      const opened = () => { cleanup(); resolve(); };
      const failed = (error: Error) => { cleanup(); reject(controller.signal.aborted ? controller.signal.reason : transportFailure(error)); };
      const aborted = () => { cleanup(); reject(controller.signal.reason); };
      const cleanup = () => { socket?.off("open", opened); socket?.off("error", failed); controller.signal.removeEventListener("abort", aborted); };
      socket!.once("open", opened); socket!.once("error", failed); controller.signal.addEventListener("abort", aborted, { once: true });
    });
    connection = new CdpConnection(socket, controller.signal);
    if (browserContextId !== undefined && (!browserContextId || (await connection.call("Target.getBrowserContexts") as { defaultBrowserContextId?: unknown }).defaultBrowserContextId !== browserContextId)) throw new Error(FAILURE);
    const initialTargets = (await connection.call("Target.getTargets") as { targetInfos?: unknown })?.targetInfos;
    const initialCandidates = candidates(initialTargets, excludedTargets, allowRoot, browserContextId);
    if (!initialCandidates.length && excludedTargets.size && candidates(initialTargets, new Set(), allowRoot, browserContextId).length) {
      throw new Error("原千川网页仍被待确认或结果未知的上传记录保护，已保留原页并暂停当前操作。请在上传任务中核查原记录。");
    }
    if (!initialCandidates.length && Array.isArray(initialTargets) && initialTargets.every(target => target.type !== "page" || target.url === "about:blank")) throw new AccountPageLoading();
    const first = [] as Array<{ candidate: Candidate; snapshot: PageSnapshot }>;
    for (const candidate of initialCandidates) first.push({ candidate, snapshot: await readPage(connection, candidate) });
    const selected = selectedPages(first, allowSingleHidden);
    if (expectedAdvertiserId && selected.some(page => page.candidate.advertiserId !== expectedAdvertiserId)) throw new Error("原网页子账户已变化，未授权上传。");
    const expected = uniqueAccount(selected);
    const currentCandidates = candidates((await connection.call("Target.getTargets") as { targetInfos?: unknown })?.targetInfos, excludedTargets, allowRoot, browserContextId);
    if (candidateSignature(currentCandidates) !== candidateSignature(initialCandidates)) throw new Error(FAILURE);
    const second = [] as Array<{ candidate: Candidate; snapshot: PageSnapshot }>;
    for (const candidate of currentCandidates) second.push({ candidate, snapshot: await readPage(connection, candidate) });
    if (first.some((page, index) => !sameQianchuanAccountPageUrl(page.snapshot.href, second[index]!.snapshot.href) || page.snapshot.visibilityState !== second[index]?.snapshot.visibilityState || selected.includes(page) && JSON.stringify(page.snapshot.accountTexts) !== JSON.stringify(second[index]?.snapshot.accountTexts))) throw new Error(FAILURE);
    const finalPages = selectedPages(second, allowSingleHidden);
    if (JSON.stringify(uniqueAccount(finalPages)) !== JSON.stringify(expected)) throw new Error(FAILURE);
    return { account: expected, pages: finalPages.map(page => page.candidate) };
  } catch (error) {
    if (controller.signal.aborted) {
      if (timedOut) throw controller.signal.reason;
      throw parentSignal?.reason ?? new DOMException("Aborted", "AbortError");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
    if (connection) await connection.close();
    else if (socket && socket.readyState !== WebSocket.CLOSED) await new Promise<void>(resolve => {
      socket!.once("close", resolve); socket!.once("error", () => undefined); socket!.terminate(); setTimeout(resolve, 100);
    });
  }
}
