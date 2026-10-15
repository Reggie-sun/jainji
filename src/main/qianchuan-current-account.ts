import WebSocket from "ws";
import { isLoopbackUrl } from "../shared/douyin-upload.js";
import { VIDEO_LIBRARY_ROUTE } from "../shared/qianchuan-video-library.js";
import { QianchuanCurrentAccountSchema, type QianchuanCurrentAccount } from "../shared/qianchuan-plan-selection.js";

const ORIGIN = "https://qianchuan.jinritemai.com";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_TARGETS = 256;
const MAX_CANDIDATES = 32;
const OPERATION_TIMEOUT_MS = 4_000;
const ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const ACCOUNT_ROUTES = new Set(["/home", "/uni-prom", "/finance", VIDEO_LIBRARY_ROUTE]);
const FAILURE = "无法确认千川网页当前子账户，请检查当前页面后重试。";

interface Candidate { targetId: string; url: string; advertiserId: string; }
interface PageSnapshot { href: string; visibilityState: string; accountTexts: string[]; }

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

async function browserEndpoint(endpoint: string, signal: AbortSignal): Promise<string> {
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
    socket.on("error", () => this.fail(new Error(FAILURE)));
    socket.on("close", () => this.fail(new Error("千川浏览器连接已关闭，请重试。")));
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
      this.socket.send(message, error => { if (error) { this.pending.delete(id); reject(error); } });
    });
  }

  track(sessionId: string): void { this.sessions.add(sessionId); }

  async detach(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.call("Target.detachFromTarget", { sessionId }, undefined, true),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(FAILURE)), 150); }),
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
  const visible = element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  };
  return { href: location.href, visibilityState: document.visibilityState,
    accountTexts: Array.from(document.querySelectorAll(".account-info-container")).filter(visible).map(element => (element.querySelector(".account-info-box") || element).innerText) };
})()`;

function validateSnapshot(value: unknown, candidate: Candidate): PageSnapshot {
  if (!value || typeof value !== "object") throw new Error(FAILURE);
  const snapshot = value as Partial<PageSnapshot>;
  if (snapshot.href !== candidate.url || !["visible", "hidden"].includes(snapshot.visibilityState ?? "") || !Array.isArray(snapshot.accountTexts) || snapshot.accountTexts.some(text => typeof text !== "string")) throw new Error(FAILURE);
  const url = new URL(snapshot.href);
  const ids = url.searchParams.getAll("aavid");
  if (url.origin !== ORIGIN || ids.length !== 1 || ids[0] !== candidate.advertiserId) throw new Error(FAILURE);
  return { href: snapshot.href, visibilityState: snapshot.visibilityState!, accountTexts: snapshot.accountTexts as string[] };
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
  return JSON.stringify([...pages].sort((left, right) => left.targetId.localeCompare(right.targetId)));
}

/** Reads the active advertiser from the already-bound local browser without changing its pages. */
export async function readCurrentQianchuanAccount(endpoint: string, parentSignal?: AbortSignal, excludedTargets: ReadonlySet<string> = new Set()): Promise<string> {
  return (await readCurrentQianchuanAccountSnapshot(endpoint, parentSignal, excludedTargets)).advertiserId;
}

export async function readCurrentQianchuanAccountSnapshot(endpoint: string, parentSignal?: AbortSignal, excludedTargets: ReadonlySet<string> = new Set()): Promise<QianchuanCurrentAccount> {
  return (await readCurrentAccountState(endpoint, parentSignal, excludedTargets)).account;
}

/** The catalog may address the sole verified account page while another browser tab is active. */
export async function readCurrentQianchuanPage(endpoint: string, signal?: AbortSignal, excludedTargets: ReadonlySet<string> = new Set(), options: { allowSingleHidden?: boolean; allowRoot?: boolean; browserContextId?: string } = {}): Promise<{ account: QianchuanCurrentAccount; targetId: string; url: string }> {
  const state = await readCurrentAccountState(endpoint, signal, excludedTargets, options.allowSingleHidden === true, options.allowRoot === true, options.browserContextId);
  if (state.pages.length !== 1) throw new Error(FAILURE);
  return { account: state.account, targetId: state.pages[0]!.targetId, url: state.pages[0]!.url };
}

async function readCurrentAccountState(endpoint: string, parentSignal?: AbortSignal, excludedTargets: ReadonlySet<string> = new Set(), allowSingleHidden = false, allowRoot = false, browserContextId?: string): Promise<{ account: QianchuanCurrentAccount; pages: Candidate[] }> {
  parentSignal?.throwIfAborted();
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort(parentSignal?.reason ?? new DOMException("Aborted", "AbortError"));
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(new Error("读取千川当前子账户超时，请刷新页面后重试。")); }, OPERATION_TIMEOUT_MS);
  let connection: CdpConnection | undefined;
  let socket: WebSocket | undefined;
  try {
    const socketUrl = await browserEndpoint(endpoint, controller.signal);
    controller.signal.throwIfAborted();
    socket = new WebSocket(socketUrl, { followRedirects: false, handshakeTimeout: 1_500, maxPayload: MAX_RESPONSE_BYTES, perMessageDeflate: false });
    await new Promise<void>((resolve, reject) => {
      const opened = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(controller.signal.aborted ? controller.signal.reason : new Error(FAILURE)); };
      const aborted = () => { cleanup(); reject(controller.signal.reason); };
      const cleanup = () => { socket?.off("open", opened); socket?.off("error", failed); controller.signal.removeEventListener("abort", aborted); };
      socket!.once("open", opened); socket!.once("error", failed); controller.signal.addEventListener("abort", aborted, { once: true });
    });
    connection = new CdpConnection(socket, controller.signal);
    if (browserContextId !== undefined && (!browserContextId || (await connection.call("Target.getBrowserContexts") as { defaultBrowserContextId?: unknown }).defaultBrowserContextId !== browserContextId)) throw new Error(FAILURE);
    const initialCandidates = candidates((await connection.call("Target.getTargets") as { targetInfos?: unknown })?.targetInfos, excludedTargets, allowRoot, browserContextId);
    const first = [] as Array<{ candidate: Candidate; snapshot: PageSnapshot }>;
    for (const candidate of initialCandidates) first.push({ candidate, snapshot: await readPage(connection, candidate) });
    const selected = selectedPages(first, allowSingleHidden);
    const expected = uniqueAccount(selected);
    const currentCandidates = candidates((await connection.call("Target.getTargets") as { targetInfos?: unknown })?.targetInfos, excludedTargets, allowRoot, browserContextId);
    if (candidateSignature(currentCandidates) !== candidateSignature(initialCandidates)) throw new Error(FAILURE);
    const second = [] as Array<{ candidate: Candidate; snapshot: PageSnapshot }>;
    for (const candidate of currentCandidates) second.push({ candidate, snapshot: await readPage(connection, candidate) });
    if (first.some((page, index) => page.snapshot.href !== second[index]?.snapshot.href || page.snapshot.visibilityState !== second[index]?.snapshot.visibilityState || selected.includes(page) && JSON.stringify(page.snapshot.accountTexts) !== JSON.stringify(second[index]?.snapshot.accountTexts))) throw new Error(FAILURE);
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
      socket!.once("close", resolve); socket!.terminate(); setTimeout(resolve, 100);
    });
  }
}
