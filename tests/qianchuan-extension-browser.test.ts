import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
// The extension resources are executable JavaScript and intentionally have no shared TypeScript API surface.
// @ts-expect-error Native Messaging helper is tested as a runtime resource.
import { NativeFrameDecoder, deriveChromeProfile, encodeNativeFrame, readNativeHostConfig, validateCancelEnvelope, validateOperationCommand } from "../resources/qianchuan-extension/native-host.mjs";
// @ts-expect-error MV3 service worker is tested as a runtime resource.
import { createQianchuanDispatcher, selectUniqueActiveQianchuanTab, startQianchuanNativeBridge } from "../resources/qianchuan-extension/background.js";

const contentScope: Record<string, unknown> = { URL, Date, TextEncoder, TextDecoder, AbortController };
vm.runInNewContext(readFileSync("resources/qianchuan-extension/content.js", "utf8"), contentScope);
const { createContentController, projectAccountList, collectPlanCatalog } = contentScope["__jianjiQianchuanContent"] as {
  createContentController: (env: Record<string, unknown>) => { handleMessage: (message: unknown) => Promise<unknown>; readAccountIdentity: () => unknown };
  projectAccountList: (data: unknown, page: number, limit: number) => unknown;
  collectPlanCatalog: (readPage: (page: number) => Promise<unknown>, advance: () => Promise<void>, check: () => void, advertiserId: string) => Promise<unknown>;
};

const advertiserId = "1876294500004864";
const origin = "https://qianchuan.jinritemai.com";
const documentId = "a1b2c3d4-e5f6-4789-8abc-def012345678";
const snapshot = { tabId: 7, documentId, account: { advertiserId, name: "测试账户" }, gfversion: "dev" };
const extensionId = "piikkbehnnhbhaolgflpmnkpneejdncm";
const contentCommand = (operation: unknown, id = documentId, extras: Record<string, unknown> = {}) => ({ kind: "command", id, tabId: 7, operation, ...extras });

it.each(["nul", "process-title"])("derives the original Chrome profile from %s arguments", async encoding => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-qianchuan-native-proc-"));
  const pid = 412, directory = path.join(root, String(pid)), profile = path.join(root, "Chrome data");
  const args = ["/opt/google/chrome/chrome", `--user-data-dir=${profile}`, "--profile-directory=Profile 11", "--no-first-run"];
  try {
    await mkdir(directory);
    await writeFile(path.join(directory, "cmdline"), args.join(encoding === "nul" ? "\0" : " ") + "\0");
    await writeFile(path.join(directory, "stat"), `${pid} (chrome) S 1 0 0`);
    await writeFile(path.join(directory, "status"), `Uid:\t${process.getuid!()}\t${process.getuid!()}\t${process.getuid!()}\t${process.getuid!()}\n`);
    await expect(deriveChromeProfile(pid, root)).resolves.toEqual({ pid, profile, profileDirectory: "Profile 11" });
    await writeFile(path.join(directory, "cmdline"), args.join(encoding === "nul" ? "\0" : " ") + (encoding === "nul" ? "\0" : " ") + "--type=renderer\0");
    await expect(deriveChromeProfile(pid, root)).rejects.toThrow("UNAVAILABLE");
    await writeFile(path.join(directory, "cmdline"), args.join(encoding === "nul" ? "\0" : " ") + "\0");
    await writeFile(path.join(directory, "status"), `Uid:\t${process.getuid!() + 1}\n`);
    await expect(deriveChromeProfile(pid, root)).rejects.toThrow("UNAVAILABLE");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("accepts only the exact extension origin with Chrome's trailing slash", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-qianchuan-native-"));
  const configPath = path.join(directory, "config.json");
  const callerOrigin = "chrome-extension://piikkbehnnhbhaolgflpmnkpneejdncm/";
  const config = { version: 1, port: 43121, token: "t".repeat(48), extensionOrigin: callerOrigin };
  try {
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    await chmod(configPath, 0o600);
    await expect(readNativeHostConfig(configPath, callerOrigin)).resolves.toMatchObject(config);
    const missingSlash = { ...config, extensionOrigin: callerOrigin.slice(0, -1) };
    await writeFile(configPath, JSON.stringify(missingSlash), { mode: 0o600 });
    await chmod(configPath, 0o600);
    await expect(readNativeHostConfig(configPath, callerOrigin.slice(0, -1))).rejects.toThrow("INVALID");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("decodes bounded native frames across arbitrary chunks", () => {
  const frame = encodeNativeFrame({ kind: "result", id: "a1b2c3d4-e5f6-4789-8abc-def012345678", ok: true, value: { ready: true } });
  const decoder = new NativeFrameDecoder();
  expect(decoder.push(frame.subarray(0, 3))).toEqual([]);
  expect(decoder.push(frame.subarray(3))).toEqual([{ kind: "result", id: documentId, ok: true, value: { ready: true } }]);
  expect(() => decoder.push(Buffer.from([1, 0, 16, 0]))).toThrow();
});

it("accepts only the two exact read routes and the fixed account operations", () => {
  expect(validateOperationCommand({ kind: "command", id: documentId, operation: { kind: "identity" } })).toBe(true);
  expect(validateOperationCommand({ kind: "command", id: documentId, operation: { kind: "request", snapshot,
    path: "/ad/api/v1/account/user-list", params: { page: 1, limit: 10, keyword: "", aavid: advertiserId, gfversion: "dev" },
    headers: { "qc-date": "1", "qc-key": "k", "qc-auth": "a" } } })).toBe(true);
  expect(validateOperationCommand({ kind: "command", id: documentId, operation: { kind: "request", snapshot,
    path: "https://example.invalid/upload", params: {}, headers: {} } })).toBe(false);
  expect(validateOperationCommand({ kind: "command", id: documentId, operation: { kind: "upload" } })).toBe(false);
  expect(validateCancelEnvelope({ kind: "cancel", id: documentId }, new Set([documentId]))).toBe(true);
  expect(validateCancelEnvelope({ kind: "cancel", id: documentId }, new Set())).toBe(false);
  expect(validateCancelEnvelope({ kind: "cancel", id: documentId, operation: {} }, new Set([documentId]))).toBe(false);
});

function extensionEvent() {
  const listeners: Array<(value?: unknown) => void> = [];
  return { addListener: (listener: (value?: unknown) => void) => { listeners.push(listener); }, fire: (value?: unknown) => { for (const listener of listeners) listener(value); } };
}

function contentFixture(blockedConfirmation = false) {
  const header = { innerText: `测试账户 ID：${advertiserId}` };
  const accountContainer = { querySelector: () => header, getClientRects: () => [{}], getBoundingClientRect: () => ({ width: 100, height: 20, bottom: 20, right: 100, top: 0, left: 0 }) };
  const confirmationSurface = { getClientRects: () => [{}] };
  const document = { cookie: "csrftoken=mock-csrf", querySelectorAll: (selector: string) => selector === ".account-info-container" ? [accountContainer]
    : blockedConfirmation && selector !== ".account-info-container" ? [confirmationSurface] : [] };
  const location = { href: `${origin}/?aavid=${advertiserId}`, origin, pathname: "/", search: `?aavid=${advertiserId}`, replace: vi.fn() };
  const env = { document, location, crypto: { randomUUID: () => documentId }, URL, TextDecoder, fetch: vi.fn(), AbortController,
    innerHeight: 800, innerWidth: 1200, setTimeout, clearTimeout, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
  return { env, document, location, header };
}

it.each(["", "&adId="])("reads the current account on the official overview URL with %s", async query => {
  const url = `${origin}/uni-prom?aavid=${advertiserId}${query}&productId=&materialId=&ct=1`;
  expect(selectUniqueActiveQianchuanTab([{ id: 7, url }])).toEqual({ id: 7, url });
  const f = contentFixture(); f.location.href = url;
  await expect(createContentController(f.env).handleMessage(contentCommand({ kind: "identity" })))
    .resolves.toMatchObject({ tabId: 7, account: snapshot.account });
});

it("observes a plan drawer identity while command identity stays blocked", async () => {
  const f = contentFixture(true);
  f.location.href = `${origin}/uni-prom?aavid=${advertiserId}&adId=73001`;
  const controller = createContentController(f.env);
  expect(controller.readAccountIdentity()).toEqual({ documentId, account: snapshot.account });
  await expect(controller.handleMessage(contentCommand({ kind: "identity" }))).rejects.toMatchObject({ code: "CHANGED" });
  expect(f.env.fetch).not.toHaveBeenCalled();
  expect(f.location.replace).not.toHaveBeenCalled();
});

it("observes account information identity without granting account command authority", async () => {
  const f = contentFixture();
  f.location.href = `${origin}/account-center/account-info?aavid=${advertiserId}`;
  const controller = createContentController(f.env);
  expect(controller.readAccountIdentity()).toEqual({ documentId, account: snapshot.account });
  await expect(controller.handleMessage(contentCommand({ kind: "identity" }))).rejects.toMatchObject({ code: "CHANGED" });
  f.header.innerText = "错误账户 ID：999";
  expect(() => controller.readAccountIdentity()).toThrow("CHANGED");
  expect(f.env.fetch).not.toHaveBeenCalled();
  expect(f.location.replace).not.toHaveBeenCalled();
});

it.each([
  `/?aavid=${advertiserId}&adId=73001`,
  `/uni-prom?aavid=${advertiserId}&adId=invalid`,
  `/uni-prom?aavid=${advertiserId}&adId=73001&adId=73001`,
  `/uni-prom?aavid=${advertiserId}&jianjiPlanPicker=1`,
  `/uni-prom?aavid=${advertiserId}&jianjiExtensionPlanPicker=1`,
  `/uni-prom?aavid=${advertiserId}&aavid=${advertiserId}`,
])("rejects ambiguous or picker URLs during read-only identity: %s", query => {
  const f = contentFixture(); f.location.href = `${origin}${query}`;
  expect(() => createContentController(f.env).readAccountIdentity()).toThrow("CHANGED");
});

function delayedPickerFixture() {
  const f = contentFixture();
  f.location.href = `${origin}/uni-prom?aavid=${advertiserId}&jianjiExtensionPlanPicker=1`;
  const query = f.document.querySelectorAll;
  let ready = false;
  f.document.querySelectorAll = selector => selector === ".account-info-container" && !ready ? [] : query(selector);
  return { ...f, ready: () => { ready = true; } };
}

it("waits for the owned picker account header after Chrome reports load complete", async () => {
  const f = delayedPickerFixture(), controller = createContentController(f.env);
  const pending = controller.handleMessage(contentCommand({ kind: "identity" }, documentId, { picker: true, budgetMs: 500 }));
  const timer = setTimeout(f.ready, 30);
  try { await expect(pending).resolves.toMatchObject({ tabId: 7, account: snapshot.account }); }
  finally { clearTimeout(timer); }
  expect(f.env.fetch).not.toHaveBeenCalled();
});

it("bounds a missing picker header and cancels its read without navigation", async () => {
  const f = delayedPickerFixture(), controller = createContentController(f.env);
  await expect(controller.handleMessage(contentCommand({ kind: "identity" }, documentId, { picker: true, budgetMs: 120 })))
    .rejects.toMatchObject({ code: "UNAVAILABLE" });
  const pending = controller.handleMessage(contentCommand({ kind: "identity" }, documentId, { picker: true, budgetMs: 500 }));
  const rejected = expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(controller.handleMessage({ kind: "cancel", id: documentId, tabId: 7 })).resolves.toEqual({ cancelled: true });
  await rejected;
  expect(f.location.replace).not.toHaveBeenCalled();
  expect(f.env.fetch).not.toHaveBeenCalled();
});

it("rejects a picker account change while its header is still loading", async () => {
  const f = delayedPickerFixture(), controller = createContentController(f.env);
  const pending = controller.handleMessage(contentCommand({ kind: "identity" }, documentId, { picker: true, budgetMs: 500 }));
  const rejected = expect(pending).rejects.toMatchObject({ code: "CHANGED" });
  f.location.href = `${origin}/uni-prom?aavid=1876294500004865&jianjiExtensionPlanPicker=1`;
  f.ready();
  await rejected;
  expect(f.location.replace).not.toHaveBeenCalled();
});

it("immediately rejects a present wrong picker identity and a wait budget on an original tab", async () => {
  const f = delayedPickerFixture(); f.ready(); f.header.innerText = "其他账户 ID：1876294500004865";
  await expect(createContentController(f.env).handleMessage(contentCommand({ kind: "identity" }, documentId, { picker: true, budgetMs: 500 })))
    .rejects.toMatchObject({ code: "CHANGED" });
  await expect(createContentController(contentFixture().env).handleMessage(contentCommand({ kind: "identity" }, documentId, { budgetMs: 500 })))
    .rejects.toMatchObject({ code: "INVALID" });
});

it.each(["&adId=7001", "&adId=&adId=", "&adId=&adId=7001", "&adId=7001&adId="])("rejects selected or duplicate plan parameters %s", async query => {
  const url = `${origin}/uni-prom?aavid=${advertiserId}${query}`;
  expect(() => selectUniqueActiveQianchuanTab([{ id: 7, url }])).toThrow("CHANGED");
  const f = contentFixture(); f.location.href = url;
  await expect(createContentController(f.env).handleMessage(contentCommand({ kind: "identity" })))
    .rejects.toMatchObject({ code: "CHANGED" });
});

it("rejects a request when the bound account or document snapshot has drifted", async () => {
  const f = contentFixture();
  const controller = createContentController(f.env);
  await expect(controller.handleMessage(contentCommand({ kind: "request", snapshot: { ...snapshot, account: { ...snapshot.account, advertiserId: "999" } },
    path: "/ad/api/v1/account/user/info", params: { aavid: advertiserId, gfversion: "dev" },
    headers: { "qc-date": "1", "qc-key": "k", "qc-auth": "a" } }))).rejects.toMatchObject({ code: "CHANGED" });
  expect(f.env.fetch).not.toHaveBeenCalled();
});

it("projects only the requested same-origin account info and bounds streamed response bytes", async () => {
  const f = contentFixture();
  const controller = createContentController(f.env);
  const operation = { kind: "request", snapshot, path: "/ad/api/v1/account/user/info", params: { aavid: advertiserId, gfversion: "dev" },
    headers: { "qc-date": "1", "qc-key": "k", "qc-auth": "a" } };
  const accountInfo = { advId: advertiserId, advName: "测试账户" };
  f.env.fetch = vi.fn(async () => ({ status: 200, url: `${origin}/ad/api/v1/account/user/info`, headers: { get: () => null },
    body: new ReadableStream({ start: stream => { stream.enqueue(new TextEncoder().encode(JSON.stringify({ status_code: 0, data: { accountInfo } }))); stream.close(); } }) }));
  await expect(controller.handleMessage(contentCommand(operation))).resolves.toEqual({ kind: "user-info", accountInfo });
  expect(f.env.fetch).toHaveBeenCalledWith(`${origin}/ad/api/v1/account/user/info?aavid=${advertiserId}&gfversion=dev`, expect.objectContaining({
    method: "GET", credentials: "same-origin", redirect: "error", headers: expect.objectContaining({ "X-CSRFToken": "mock-csrf" }),
  }));

  const oversized = contentFixture();
  const oversizeController = createContentController(oversized.env);
  oversized.env.fetch = vi.fn(async () => ({ status: 200, url: `${origin}/ad/api/v1/account/user/info`, headers: { get: () => null },
    body: new ReadableStream({ start: stream => { stream.enqueue(new Uint8Array(1024 * 1024 + 1)); } }) }));
  await expect(oversizeController.handleMessage(contentCommand(operation))).rejects.toMatchObject({ code: "INVALID" });
});

it("aborts an in-flight authenticated read only for its matching command ID", async () => {
  const f = contentFixture();
  const controller = createContentController(f.env);
  const operation = { kind: "request", snapshot, path: "/ad/api/v1/account/user/info", params: { aavid: advertiserId, gfversion: "dev" },
    headers: { "qc-date": "1", "qc-key": "k", "qc-auth": "a" } };
  f.env.fetch = vi.fn(async (_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const pending = controller.handleMessage(contentCommand(operation));
  await vi.waitFor(() => expect(f.env.fetch).toHaveBeenCalledTimes(1));
  await expect(controller.handleMessage({ kind: "cancel", id: "b1b2c3d4-e5f6-4789-8abc-def012345678", tabId: 7 }))
    .resolves.toEqual({ cancelled: false });
  await expect(controller.handleMessage({ kind: "cancel", id: documentId, tabId: 8 })).resolves.toEqual({ cancelled: false });
  await expect(controller.handleMessage({ kind: "cancel", id: documentId, tabId: 7 })).resolves.toEqual({ cancelled: true });
  await expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

it("rejects identity and account switching while a Qianchuan upload confirmation is open", async () => {
  const f = contentFixture(true);
  const controller = createContentController(f.env);
  await expect(controller.handleMessage(contentCommand({ kind: "identity" }))).rejects.toMatchObject({ code: "CHANGED" });
  await expect(controller.handleMessage(contentCommand({ kind: "switch", snapshot, chosen: { advertiserId: "1876294500004865", name: "另一个账户" } })))
    .rejects.toMatchObject({ code: "CHANGED" });
  expect(f.location.replace).not.toHaveBeenCalled();
});

it("issues an explicit account navigation once and never retries it", async () => {
  const f = contentFixture();
  const controller = createContentController(f.env);
  const operation = { kind: "switch", snapshot, chosen: { advertiserId: "1876294500004865", name: "另一个账户" } };
  await expect(controller.handleMessage(contentCommand(operation))).resolves.toEqual({ navigating: true });
  expect(f.location.replace).toHaveBeenCalledTimes(1);
  await expect(controller.handleMessage(contentCommand(operation))).rejects.toMatchObject({ code: "CHANGED" });
  expect(f.location.replace).toHaveBeenCalledTimes(1);
});

it("preserves account IDs as strings and rejects unsafe numeric IDs", () => {
  expect(JSON.parse(JSON.stringify(projectAccountList({ userAccountInfos: [{ id: "1876294500004864", advid: "1876294500004864", name: "字符串 ID" }], totalPages: 1, totalCount: 1, currentPage: 1 }, 1, 10))))
    .toEqual({ accounts: [{ advertiserId, name: "字符串 ID" }], totalPages: 1, totalCount: 1, currentPage: 1 });
  expect(() => projectAccountList({ userAccountInfos: [{ id: 9007199254740992, name: "不安全" }], totalPages: 1, totalCount: 1, currentPage: 1 }, 1, 10)).toThrow();
  expect(() => projectAccountList({ userAccountInfos: [{ id: advertiserId, advid: "1876294500004865", name: "账户不匹配" }], totalPages: 1, totalCount: 1, currentPage: 1 }, 1, 10)).toThrow();
  expect(() => projectAccountList({ userAccountInfos: [{ id: advertiserId, advid: 9007199254740992, name: "不安全 advid" }], totalPages: 1, totalCount: 1, currentPage: 1 }, 1, 10)).toThrow();
});

it("returns the fixed user-list projection only when id and advid agree", async () => {
  const operation = { kind: "request", snapshot, path: "/ad/api/v1/account/user-list",
    params: { page: 1, limit: 10, keyword: "", aavid: advertiserId, gfversion: "dev" },
    headers: { "qc-date": "1", "qc-key": "k", "qc-auth": "a" } };
  const run = async (advid: unknown) => {
    const f = contentFixture();
    const controller = createContentController(f.env);
    f.env.fetch = vi.fn(async () => ({ status: 200, url: `${origin}/ad/api/v1/account/user-list`, headers: { get: () => null },
      body: new ReadableStream({ start: stream => { stream.enqueue(new TextEncoder().encode(JSON.stringify({ status_code: 0, data: {
        userAccountInfos: [{ id: advertiserId, advid, name: "测试账户" }], totalPages: 1, totalCount: 1, currentPage: 1,
      } }))); stream.close(); } }) }));
    return controller.handleMessage(contentCommand(operation));
  };
  await expect(run(advertiserId)).resolves.toEqual({ kind: "user-list", accounts: [{ advertiserId, name: "测试账户" }], totalPages: 1, totalCount: 1, currentPage: 1 });
  await expect(run("1876294500004865")).rejects.toMatchObject({ code: "CHANGED" });
  await expect(run(9007199254740992)).rejects.toMatchObject({ code: "INVALID" });
});

it("accepts the trusted extension service worker when Chrome omits sender.tab", async () => {
  const f = contentFixture();
  let listener!: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean;
  const scope = { ...f.env, chrome: { runtime: { id: extensionId, onMessage: { addListener: (handler: typeof listener) => { listener = handler; } } } } };
  vm.runInNewContext(readFileSync("resources/qianchuan-extension/content.js", "utf8"), scope);
  const sender = { id: extensionId, origin: `chrome-extension://${extensionId}`, url: `chrome-extension://${extensionId}/background.js` };
  let response: unknown;
  expect(listener(contentCommand({ kind: "identity" }), sender, value => { response = value; })).toBe(true);
  await vi.waitFor(() => expect(response).toMatchObject({ ok: true, value: { tabId: 7, account: snapshot.account } }));

  response = undefined;
  expect(listener(contentCommand({ kind: "identity" }), { ...sender, id: "wrong-extension-id" }, value => { response = value; })).toBe(false);
  expect(response).toEqual({ ok: false, error: "CHANGED" });
  response = undefined;
  expect(listener(contentCommand({ kind: "identity" }), { ...sender, url: "https://qianchuan.jinritemai.com/" }, value => { response = value; })).toBe(false);
  expect(response).toEqual({ ok: false, error: "CHANGED" });
});

it("collects complete pages, filters deleted rows, and keeps the requested advertiser", async () => {
  const pages = [
    { total: 3, pageNumber: 1, nextDisabled: false, rows: [
      { cellCount: 1, names: ["计划一"], ids: [`ID：7001`], deletedTags: [], rowText: "计划一 7001" },
      { cellCount: 1, names: ["已删除"], ids: ["ID：7002"], deletedTags: ["已删除"], rowText: "已删除计划" },
    ] },
    { total: 3, pageNumber: 2, nextDisabled: true, rows: [
      { cellCount: 1, names: ["计划二"], ids: ["ID：7003"], deletedTags: [], rowText: "计划二 7003" },
    ] },
  ];
  let page = 0;
  const check = vi.fn();
  const result = await collectPlanCatalog(async expected => ({ ...pages[page]!, pageNumber: expected }), async () => { page++; }, check, advertiserId);
  expect(JSON.parse(JSON.stringify(result))).toEqual([{ advertiserId, adId: "7001", name: "计划一" }, { advertiserId, adId: "7003", name: "计划二" }]);
  expect(check).toHaveBeenCalled();
});

it("reads a full account-bearing plan page and closes only its owned inactive tab", async () => {
  const original = { id: 7, active: true, status: "complete", url: `${origin}/?aavid=${advertiserId}` };
  const picker = { id: 8, active: false, status: "complete", url: `${origin}/uni-prom?aavid=${advertiserId}&jianjiExtensionPlanPicker=1` };
  let embeddedView = false;
  const removed: number[] = [];
  const tabs = [original, picker];
  const api = {
    tabs: {
      query: vi.fn(async () => [original]), create: vi.fn(async ({ url }: { url: string }) => {
        picker.url = url;
        embeddedView = new URL(url).searchParams.get("ct") === "1";
        return picker;
      }), get: vi.fn(async (id: number) => tabs.find(tab => tab.id === id)),
      sendMessage: vi.fn(async (id: number, message: { kind: string; budgetMs?: number; operation?: { kind: string } }) => id === 8 && embeddedView && message.operation?.kind === "identity"
        ? { ok: false, error: "CHANGED" }
        : ({ ok: true, value: message.kind === "cancel" ? { cancelled: true }
        : message.operation?.kind === "identity" ? { tabId: id, documentId: id === 7 ? documentId : "b1b2c3d4-e5f6-4789-8abc-def012345678", account: snapshot.account }
        : [{ advertiserId, adId: "7001", name: "计划" }] })),
      remove: vi.fn(async (id: number) => { removed.push(id); }),
    },
    scripting: { executeScript: vi.fn(async ({ world }: { world?: string }) => world === "MAIN" ? [{ frameId: 0, result: "dev" }] : []) },
    runtime: {},
  };
  const dispatcher = createQianchuanDispatcher(api as never);
  const result = await dispatcher.dispatch({ kind: "command", id: documentId, operation: { kind: "plans", snapshot } });
  expect(result).toMatchObject({ kind: "result", ok: true, value: [{ advertiserId, adId: "7001", name: "计划" }] });
  expect(api.tabs.create).toHaveBeenCalledWith({ url: picker.url, active: false });
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(8, expect.objectContaining({ kind: "command", tabId: 8 }));
  const planEnvelope = api.tabs.sendMessage.mock.calls.map(([, message]) => message).find(message => message.operation?.kind === "plans");
  expect(planEnvelope?.budgetMs).toBeGreaterThan(0);
  expect(planEnvelope?.budgetMs).toBeLessThanOrEqual(30_000);
  expect(removed).toEqual([8]);
  expect(tabs).toContain(original);
  expect(api.tabs.remove).not.toHaveBeenCalledWith(7);
});

it("cancels a plan read and awaits removal of only its owned tab before returning", async () => {
  const original = { id: 7, active: true, status: "complete", url: `${origin}/?aavid=${advertiserId}` };
  const picker = { id: 8, active: false, status: "complete", url: `${origin}/uni-prom?aavid=${advertiserId}&ct=1&jianjiExtensionPlanPicker=1` };
  const removed: number[] = [];
  let plansStarted!: () => void;
  let finishPlans!: (value: unknown) => void;
  const started = new Promise<void>(resolve => { plansStarted = resolve; });
  const api = {
    tabs: {
      query: vi.fn(async () => [original]), create: vi.fn(async () => picker), get: vi.fn(async (id: number) => id === 8 ? picker : original),
      sendMessage: vi.fn((id: number, message: { kind: string; id: string; operation?: { kind: string } }) => {
        if (message.kind === "cancel") {
          finishPlans({ ok: false, error: "UNAVAILABLE" });
          return Promise.resolve({ ok: true, value: { cancelled: true } });
        }
        if (message.operation?.kind === "identity") return Promise.resolve({ ok: true, value: {
          tabId: id, documentId: id === 7 ? documentId : "b1b2c3d4-e5f6-4789-8abc-def012345678", account: snapshot.account,
        } });
        plansStarted();
        return new Promise(resolve => { finishPlans = resolve; });
      }),
      remove: vi.fn(async (id: number) => { removed.push(id); }),
    },
    scripting: { executeScript: vi.fn(async ({ world }: { world?: string }) => world === "MAIN" ? [{ frameId: 0, result: "dev" }] : []) },
  };
  const dispatcher = createQianchuanDispatcher(api as never);
  const pending = dispatcher.dispatch({ kind: "command", id: documentId, operation: { kind: "plans", snapshot } });
  await started;
  expect(dispatcher.cancel(documentId)).toBe(true);
  const result = await pending;
  expect(result).toMatchObject({ kind: "result", id: documentId, ok: false, error: "UNAVAILABLE" });
  expect(removed).toEqual([8]);
  expect(api.tabs.remove).not.toHaveBeenCalledWith(7);
});

it("cancels all active commands when the native port disconnects", async () => {
  const original = { id: 7, active: true, status: "complete", url: `${origin}/?aavid=${advertiserId}` };
  const onMessage = extensionEvent();
  const onDisconnect = extensionEvent();
  let commandStarted!: () => void;
  let finishCommand!: (value: unknown) => void;
  const started = new Promise<void>(resolve => { commandStarted = resolve; });
  const port = { onMessage, onDisconnect, postMessage: vi.fn() };
  const api = {
    tabs: { query: vi.fn(async () => [original]), sendMessage: vi.fn((id: number, message: { kind: string }) => {
      if (message.kind === "cancel") { finishCommand({ ok: false, error: "UNAVAILABLE" }); return Promise.resolve({ ok: true, value: { cancelled: true } }); }
      commandStarted(); return new Promise(resolve => { finishCommand = resolve; });
    }) },
    scripting: { executeScript: vi.fn(async () => []) },
    runtime: { connectNative: vi.fn(() => port), onStartup: extensionEvent(), onInstalled: extensionEvent() },
    alarms: { create: vi.fn(), onAlarm: extensionEvent() },
  };
  startQianchuanNativeBridge(api as never);
  onMessage.fire({ kind: "command", id: documentId, operation: { kind: "identity" } });
  await started;
  onDisconnect.fire();
  await vi.waitFor(() => expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, { kind: "cancel", id: documentId, tabId: 7 }));
  expect(port.postMessage).not.toHaveBeenCalled();
});
