import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";
import { z } from "zod";
import { isLoopbackUrl } from "../shared/douyin-upload.js";
import { QianchuanCurrentAccountSchema, QianchuanPlanListSchema, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";
import { QianchuanAccountCatalog, type CatalogOperation, type CatalogSnapshotBase } from "./qianchuan-account-catalog.js";
import { qianchuanExtensionResources } from "./qianchuan-extension-install.js";
import { readCurrentQianchuanPage, sameQianchuanAccountPageUrl } from "./qianchuan-current-account.js";
import { QianchuanPickerTransport } from "./qianchuan-picker-transport.js";
import { guardedTransport } from "./local-cdp-transport.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { readQianchuanPlans } from "./qianchuan-plan-catalog.js";

const WORLD_NAME = "__jianji_qianchuan_account_reader_v2__";
const STATE_NAME = "__jianjiQianchuanAccountReaderV2";
const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const SWITCH_WAIT_MS = 10_000;
const changed = () => new Error("网页账户或浏览器连接已变化，请刷新后重选；未自动重试切换。");
const switchUnknown = () => new Error("千川账户切换结果无法核对，未重复切换；请检查当前网页后刷新子账户。");

const account = QianchuanCurrentAccountSchema.extend({ name: QianchuanCurrentAccountSchema.shape.name.unwrap() });
export const CdpSnapshotSchema = z.object({
  targetId: z.string().min(8).max(128).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  browserContextId: z.string().min(1).max(128).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  documentId: z.string().uuid(),
  account,
  gfversion: z.string().min(1).max(80).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
}).strict();

export type CdpSnapshot = z.infer<typeof CdpSnapshotSchema>;
interface Metadata { webSocketDebuggerUrl?: unknown; }
interface RuntimeResult { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } }; }
interface BoundTarget { page: Page; session: CDPSession; contextId: number; browserContextId: string; signal: AbortSignal; }

export function sameCdpSnapshot(left: CdpSnapshot, right: CdpSnapshot): boolean {
  return left.targetId === right.targetId && left.browserContextId === right.browserContextId && left.documentId === right.documentId &&
    left.account.advertiserId === right.account.advertiserId && left.account.name === right.account.name && left.gfversion === right.gfversion;
}

export function switchedCdpSnapshot(before: CdpSnapshot, after: CdpSnapshot): boolean {
  return before.targetId === after.targetId && before.browserContextId === after.browserContextId && before.documentId !== after.documentId;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", aborted, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit) || !response.body) throw changed();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) throw changed();
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString("utf8");
}

async function browserWebSocket(endpoint: string, signal: AbortSignal): Promise<string> {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw changed(); }
  if (!isLoopbackUrl(endpoint) || !/^\d+$/.test(url.port) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw changed();
  const response = await fetch(new URL("/json/version", url), { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), headers: { accept: "application/json" } });
  if (!response.ok || response.redirected) throw changed();
  let metadata: Metadata;
  try { metadata = JSON.parse(await readBounded(response, MAX_METADATA_BYTES, signal)) as Metadata; }
  catch (error) { if (signal.aborted) throw signal.reason; throw error; }
  if (typeof metadata.webSocketDebuggerUrl !== "string" || !isLoopbackUrl(metadata.webSocketDebuggerUrl, true)) throw changed();
  const socket = new URL(metadata.webSocketDebuggerUrl);
  if (socket.protocol !== "ws:" || socket.hostname !== url.hostname || socket.port !== url.port ||
    !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(socket.pathname) || socket.search || socket.hash || socket.username || socket.password) throw changed();
  return socket.href;
}

function valueOf(result: RuntimeResult): unknown {
  if (result.exceptionDetails) throw new Error("千川网页账户读取失败，请刷新网页后重试。");
  return result.result?.value;
}

function snapshotContentValue(value: CdpSnapshot): { documentId: string; account: CdpSnapshot["account"]; gfversion: string } {
  return { documentId: value.documentId, account: value.account, gfversion: value.gfversion };
}

/** Reads the existing account page through its actual CDP target and document. */
export class QianchuanCdpAccountSession {
  private contentSource?: Promise<string>;
  private readonly excludedTargets: ReadonlySet<string>;

  constructor(private readonly target: FrozenQianchuanAccount, private readonly verify: () => Promise<void>, excludedTargets: ReadonlySet<string> = new Set(), private readonly expectedBrowserContextId?: string) {
    this.excludedTargets = new Set(excludedTargets);
  }

  async current(signal: AbortSignal): Promise<CdpSnapshot> {
    signal.throwIfAborted();
    await this.verify();
    try { return await this.currentUnchecked(signal); }
    finally { await this.verify(); }
  }

  async call(operation: CatalogOperation<CdpSnapshot>, parentSignal?: AbortSignal): Promise<unknown> {
    const signal = parentSignal ?? new AbortController().signal;
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw changed();
    if (operation.kind === "identity") return this.current(signal);
    const snapshot = CdpSnapshotSchema.parse(operation.snapshot);
    if (operation.kind === "request") return this.request(operation, snapshot, signal);
    if (operation.kind === "plans") return this.plans(snapshot, signal);
    if (operation.kind === "switch") return this.switchAccount(snapshot, operation.chosen, signal);
    throw changed();
  }

  private async content(): Promise<string> {
    this.contentSource ??= readFile(`${qianchuanExtensionResources()}/content.js`).then(bytes => {
      if (bytes.length > MAX_CONTENT_BYTES) throw changed();
      return bytes.toString("utf8");
    });
    return this.contentSource;
  }

  private async withTarget<T>(targetId: string, signal: AbortSignal, action: (bound: BoundTarget) => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    let relay: Awaited<ReturnType<typeof guardedTransport>> | undefined;
    let pickerTransport: QianchuanPickerTransport | undefined;
    let browser: Browser | undefined;
    let browserSession: CDPSession | undefined;
    let session: CDPSession | undefined;
    const transportController = new AbortController();
    const commandDeadline = setTimeout(() => transportController.abort(new Error("千川浏览器操作超时，请刷新后重试。")), 10_000);
    commandDeadline.unref();
    const operationSignal = AbortSignal.any([signal, transportController.signal]);
    try {
      const socket = await browserWebSocket(this.target.cdpEndpoint, operationSignal);
      relay = await guardedTransport(socket, operationSignal, 10_000);
      pickerTransport = await QianchuanPickerTransport.connect(relay.url, operationSignal);
      browser = await abortable(chromium.connectOverCDP(pickerTransport, { timeout: 10_000, noDefaults: true }), operationSignal);
      browserSession = await abortable(browser.newBrowserCDPSession(), operationSignal);
      const defaultContext = async (): Promise<string> => {
        const value = await abortable(browserSession!.send("Target.getBrowserContexts"), operationSignal);
        if (!Array.isArray(value.browserContextIds) || !this.expectedBrowserContextId && value.browserContextIds.length !== 0 ||
          typeof value.defaultBrowserContextId !== "string" || !value.defaultBrowserContextId ||
          this.expectedBrowserContextId !== undefined && value.defaultBrowserContextId !== this.expectedBrowserContextId) throw changed();
        return value.defaultBrowserContextId;
      };
      // The list only enumerates DevTools-created contexts. Prove the target's
      // actual identity against the default context used by the upload path.
      const browserContextId = await defaultContext();
      if (!browser.contexts().length || !this.expectedBrowserContextId && browser.contexts().length !== 1) throw changed();
      const context = browser.contexts()[0]!;
      if (context.pages().length !== 0) throw changed();
      const opening = context.waitForEvent("page", { timeout: 10_000 });
      void opening.catch(() => undefined);
      await abortable(pickerTransport.attach(targetId), operationSignal);
      const page = await abortable(opening, operationSignal);
      page.setDefaultTimeout(5_000);
      session = await abortable(context.newCDPSession(page), operationSignal);
      const targetInfo = await abortable(session.send("Target.getTargetInfo"), operationSignal);
      if (targetInfo.targetInfo?.targetId !== targetId || targetInfo.targetInfo.type !== "page" || targetInfo.targetInfo.browserContextId !== browserContextId) throw changed();
      const frameTree = await abortable(session.send("Page.getFrameTree"), operationSignal) as { frameTree?: { frame?: { id?: unknown } } };
      const frameId = frameTree.frameTree?.frame?.id;
      if (typeof frameId !== "string" || !frameId) throw changed();
      const world = await abortable(session.send("Page.createIsolatedWorld", { frameId, worldName: WORLD_NAME, grantUniveralAccess: false }), operationSignal) as { executionContextId?: unknown };
      if (!Number.isSafeInteger(world.executionContextId) || (world.executionContextId as number) < 1) throw changed();
      const content = await this.content();
      const expression = `${content}\n;(() => {\n` +
        `const api = globalThis.__jianjiQianchuanContent; if (!api || typeof api.createContentController !== "function") throw new Error("content unavailable");\n` +
        `if (!Object.hasOwn(globalThis, ${JSON.stringify(STATE_NAME)})) Object.defineProperty(globalThis, ${JSON.stringify(STATE_NAME)}, { value: Object.freeze({ controller: api.createContentController(globalThis) }), configurable: false });\n` +
        `return globalThis[${JSON.stringify(STATE_NAME)}].controller.documentId;\n})()`;
      const installed = await abortable(session.send("Runtime.evaluate", { expression, contextId: world.executionContextId as number, awaitPromise: true, returnByValue: true }), operationSignal) as RuntimeResult;
      if (typeof valueOf(installed) !== "string") throw changed();
      const result = await abortable(action({ page, session, contextId: world.executionContextId as number, browserContextId, signal: operationSignal }), operationSignal);
      const after = await abortable(session.send("Target.getTargetInfo"), operationSignal);
      if (after.targetInfo.targetId !== targetId || after.targetInfo.browserContextId !== browserContextId || await defaultContext() !== browserContextId) throw changed();
      return result;
    } finally {
      clearTimeout(commandDeadline);
      transportController.abort();
      await session?.detach().catch(() => undefined);
      await browserSession?.detach().catch(() => undefined);
      await browser?.close().catch(() => undefined);
      pickerTransport?.close();
      await relay?.close().catch(() => undefined);
    }
  }

  private async readBoundSnapshot(bound: BoundTarget, expectedUrl: string | undefined, signal: AbortSignal): Promise<CdpSnapshot> {
    signal.throwIfAborted();
    const targetInfo = await abortable(bound.session.send("Target.getTargetInfo"), signal);
    if (typeof targetInfo.targetInfo?.targetId !== "string" || targetInfo.targetInfo.type !== "page" ||
      typeof targetInfo.targetInfo.url !== "string" || targetInfo.targetInfo.targetId.length < 8 ||
      targetInfo.targetInfo.browserContextId !== bound.browserContextId || !sameQianchuanAccountPageUrl(targetInfo.targetInfo.url, bound.page.url()) || expectedUrl !== undefined && !sameQianchuanAccountPageUrl(bound.page.url(), expectedUrl)) throw changed();
    const expression = `globalThis[${JSON.stringify(STATE_NAME)}].controller.readAccountIdentity()`;
    const runtime = await abortable(bound.session.send("Runtime.evaluate", { expression, contextId: bound.contextId, returnByValue: true }), signal) as RuntimeResult;
    const identity = valueOf(runtime) as { documentId?: unknown; account?: unknown };
    const versionRuntime = await abortable(bound.session.send("Runtime.evaluate", { expression: "window.gfdatav1?.ver", returnByValue: true }), signal) as RuntimeResult;
    const gfversion = valueOf(versionRuntime);
    return CdpSnapshotSchema.parse({ targetId: targetInfo.targetInfo.targetId, browserContextId: bound.browserContextId, documentId: identity?.documentId, account: identity?.account, gfversion });
  }

  private async currentUnchecked(signal: AbortSignal): Promise<CdpSnapshot> {
    const options = { allowSingleHidden: true, allowRoot: true, browserContextId: this.expectedBrowserContextId };
    const observed = await readCurrentQianchuanPage(this.target.cdpEndpoint, signal, this.excludedTargets, options);
    const snapshot = await this.withTarget(observed.targetId, signal, async bound => {
      const current = await this.readBoundSnapshot(bound, observed.url, bound.signal);
      if (current.account.advertiserId !== observed.account.advertiserId || current.account.name !== observed.account.name) throw changed();
      return current;
    });
    const fresh = await readCurrentQianchuanPage(this.target.cdpEndpoint, signal, this.excludedTargets, options);
    if (fresh.targetId !== observed.targetId || !sameQianchuanAccountPageUrl(fresh.url, observed.url) || fresh.account.advertiserId !== snapshot.account.advertiserId || fresh.account.name !== snapshot.account.name) throw changed();
    return snapshot;
  }

  private async accountCommand(bound: BoundTarget, operation: unknown, signal: AbortSignal, issued?: () => void): Promise<unknown> {
    const id = randomUUID();
    const command = { kind: "account-command", id, operation };
    const expression = `globalThis[${JSON.stringify(STATE_NAME)}].controller.handleAccountMessage(${JSON.stringify(command)})`;
    signal.throwIfAborted();
    const pending = bound.session.send("Runtime.evaluate", { expression, contextId: bound.contextId, awaitPromise: true, returnByValue: true });
    issued?.();
    try {
      const runtime = await abortable(pending, signal) as RuntimeResult;
      return valueOf(runtime);
    } finally {
      if (signal.aborted) {
        const cancel = `globalThis[${JSON.stringify(STATE_NAME)}].controller.handleAccountMessage(${JSON.stringify({ kind: "cancel", id })})`;
        await Promise.race([
          bound.session.send("Runtime.evaluate", { expression: cancel, contextId: bound.contextId, awaitPromise: true, returnByValue: true }).catch(() => undefined),
          new Promise(resolve => setTimeout(resolve, 150)),
        ]);
      }
    }
  }

  private async request(operation: Extract<CatalogOperation<CdpSnapshot>, { kind: "request" }>, snapshot: CdpSnapshot, signal: AbortSignal): Promise<unknown> {
    await this.verify();
    try {
      // The catalog checks the unique current page between requests; bind this GET
      // to its exact original target/document before and after the browser fetch.
      return await this.withTarget(snapshot.targetId, signal, async bound => {
        if (!sameCdpSnapshot(snapshot, await this.readBoundSnapshot(bound, undefined, bound.signal))) throw changed();
        const result = await this.accountCommand(bound, { ...operation, snapshot: snapshotContentValue(snapshot) }, bound.signal);
        if (!sameCdpSnapshot(snapshot, await this.readBoundSnapshot(bound, undefined, bound.signal))) throw changed();
        return result;
      });
    } finally { await this.verify(); }
  }

  private async plans(snapshot: CdpSnapshot, signal: AbortSignal): Promise<QianchuanPlanOption[]> {
    await this.verify();
    try {
      if (!sameCdpSnapshot(snapshot, await this.currentUnchecked(signal))) throw changed();
      const target = Object.freeze({ ...this.target, advertiserId: snapshot.account.advertiserId });
      const plans = QianchuanPlanListSchema.parse(await readQianchuanPlans(target, signal, snapshot.browserContextId));
      if (plans.some(plan => plan.advertiserId !== snapshot.account.advertiserId) || !sameCdpSnapshot(snapshot, await this.currentUnchecked(signal))) throw changed();
      return plans;
    } finally { await this.verify(); }
  }

  private async switchAccount(snapshot: CdpSnapshot, chosen: CdpSnapshot["account"], signal: AbortSignal): Promise<CdpSnapshot> {
    await this.verify();
    let issued = false;
    try {
      if (!sameCdpSnapshot(snapshot, await this.currentUnchecked(signal))) throw changed();
      if (chosen.advertiserId === snapshot.account.advertiserId) {
        if (chosen.name !== snapshot.account.name) throw changed();
        return snapshot;
      }
      let commandResult: unknown;
      try {
        commandResult = await this.withTarget(snapshot.targetId, signal, async bound => {
          if (!sameCdpSnapshot(snapshot, await this.readBoundSnapshot(bound, undefined, bound.signal))) throw changed();
          const result = await this.accountCommand(bound, { kind: "switch", snapshot: snapshotContentValue(snapshot), chosen }, bound.signal, () => { issued = true; });
          if (!isRecord(result) || typeof result.navigating !== "boolean") throw changed();
          return result;
        });
      } catch (error) {
        if (!issued) throw error;
        commandResult = undefined;
      }
      if (commandResult && (commandResult as { navigating?: unknown }).navigating !== true) throw changed();
      return await this.observeSwitch(snapshot, chosen, signal);
    } finally { await this.verify(); }
  }

  private async observeSwitch(before: CdpSnapshot, chosen: CdpSnapshot["account"], signal: AbortSignal): Promise<CdpSnapshot> {
    const deadline = Date.now() + SWITCH_WAIT_MS;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      try {
        const current = await this.currentUnchecked(signal);
        if (current.targetId !== before.targetId) throw switchUnknown();
        if (current.account.advertiserId === chosen.advertiserId) {
          if (current.account.name !== chosen.name || current.documentId === before.documentId) throw switchUnknown();
          return current;
        }
        if (current.account.advertiserId !== before.account.advertiserId) throw switchUnknown();
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof Error && error.message === switchUnknown().message) throw error;
      }
      await abortable(new Promise<void>(resolve => setTimeout(resolve, 200)), signal);
    }
    throw switchUnknown();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
