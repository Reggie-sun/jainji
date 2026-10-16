import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import WebSocket, { WebSocketServer } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { readCurrentQianchuanAccount, readCurrentQianchuanAccountSnapshot, readCurrentQianchuanPage, waitForCurrentQianchuanAccount } from "../src/main/qianchuan-current-account";
import { readQianchuanSubaccounts, switchQianchuanSubaccount } from "../src/main/qianchuan-subaccounts-browser";
import { QianchuanBrowserManager } from "../src/main/qianchuan-browser-manager";
import { QianchuanBrowserBindings } from "../src/main/qianchuan-browser-bindings";
import { qianchuanEgressRuntime } from "../src/main/qianchuan-egress-runtime";

const origin = "https://qianchuan.jinritemai.com";
const account = (targetId: string, id: string, visibilityState: "visible" | "hidden", route = "/finance") => ({
  targetId, type: "page", url: `${origin}${route}?aavid=${id}`,
  snapshot: { href: `${origin}${route}?aavid=${id}`, visibilityState, accountTexts: [`ID：${id}`] },
});

interface FakeOptions {
  targets?: ReturnType<typeof account>[];
  snapshot?: (target: ReturnType<typeof account>, read: number) => unknown;
  holdTargets?: boolean;
  holdEvaluation?: boolean;
  redirectMetadata?: boolean;
  pageError?: boolean;
  detachDelayMs?: number;
  holdDetach?: boolean;
}

async function fakeBrowser(options: FakeOptions = {}) {
  const targets = options.targets ?? [account("visible", "200", "visible")];
  const counts = new Map<string, number>();
  const sessions = new Map<string, string>();
  const attached: string[] = [], detached: string[] = [], evaluated: string[] = [];
  const sockets = new Set<WebSocket>();
  const server = http.createServer((_request, response) => {
    if (options.redirectMetadata) { response.writeHead(302, { location: "/json/version" }).end(); return; }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ webSocketDebuggerUrl: wsUrl() }));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, client => wss.emit("connection", client, request));
  });
  wss.on("connection", socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", raw => {
      const request = JSON.parse(raw.toString()) as { id: number; method: string; params?: { targetId?: string; sessionId?: string }; sessionId?: string };
      const respond = (result: unknown) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: request.id, result })); };
      if (request.method === "Target.getTargets") {
        if (!options.holdTargets) respond({ targetInfos: targets.map(({ snapshot: _snapshot, ...target }) => target) });
      } else if (request.method === "Target.attachToTarget") {
        const targetId = request.params?.targetId ?? "";
        const sessionId = `session-${targetId}-${attached.length}`;
        attached.push(targetId); sessions.set(sessionId, targetId); respond({ sessionId });
      } else if (request.method === "Runtime.evaluate") {
        const targetId = sessions.get(request.sessionId ?? "") ?? "";
        evaluated.push(targetId);
        if (!options.holdEvaluation) {
          const target = targets.find(value => value.targetId === targetId)!;
          const count = (counts.get(targetId) ?? 0) + 1; counts.set(targetId, count);
          respond(options.pageError ? { exceptionDetails: { text: "fixture page evaluation failed" } } : { result: { value: options.snapshot?.(target, count) ?? target.snapshot } });
        }
      } else if (request.method === "Target.detachFromTarget") {
        const sessionId = request.params?.sessionId ?? "";
        const targetId = sessions.get(sessionId);
        if (targetId) detached.push(targetId);
        sessions.delete(sessionId);
        if (options.holdDetach) return;
        if (options.detachDelayMs) setTimeout(() => respond({}), options.detachDelayMs);
        else respond({});
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  function wsUrl(): string {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing local test port");
    return `ws://127.0.0.1:${address.port}/devtools/browser/fake`;
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing local test port");
  return {
    endpoint: `http://127.0.0.1:${address.port}`, wsEndpoint: wsUrl(), attached, detached, evaluated,
    connected: () => sockets.size > 0,
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
      await new Promise<void>(resolve => wss.close(() => resolve()));
    },
  };
}

async function realChrome(): Promise<{ context: BrowserContext; profile: string; endpoint: string }> {
  const profile = await mkdtemp(path.join(tmpdir(), "jianji-current-account-"));
  const context = await chromium.launchPersistentContext(profile, { executablePath: await resolveChromeExecutable(), headless: true,
    args: ["--no-sandbox", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"] });
  await context.route(`${origin}/**`, route => {
    const id = new URL(route.request().url()).searchParams.get("aavid") ?? "";
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<div class="account-info-container"><div>新</div><div class="account-info-box"><div class="shop-name">新子账户商贸</div><div>ID：${id}</div></div></div>` });
  });
  const port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
  return { context, profile, endpoint: `http://127.0.0.1:${port}` };
}

afterEach(() => vi.restoreAllMocks());

it("waits for the reopened account DOM before returning its original child", async () => {
  const f = await fakeBrowser({ snapshot: (target, read) => ({ ...target.snapshot, accountTexts: read < 3 ? [] : target.snapshot.accountTexts }) });
  try {
    expect(await waitForCurrentQianchuanAccount(f.endpoint, "200", AbortSignal.timeout(2000))).toEqual({ advertiserId: "200" });
    expect(f.evaluated.length).toBeGreaterThan(2);
  } finally { await f.close(); }
});

it.each(["different child", "different child loading", "conflicting DOM", "challenge", "challenge with account header"])("does not wait through a reopened page with %s", async failure => {
  const f = await fakeBrowser({ snapshot: target => ({ ...target.snapshot,
    ...(failure === "conflicting DOM" ? { accountTexts: ["ID：300"] } : failure.startsWith("challenge") ? { ...(failure === "challenge" ? { accountTexts: [] } : {}), accountBlocked: true } : failure === "different child loading" ? { accountTexts: [] } : {}) }) });
  try {
    await expect(waitForCurrentQianchuanAccount(f.endpoint, failure.startsWith("different child") ? "300" : "200", AbortSignal.timeout(2000))).rejects.toThrow(failure.startsWith("different child") ? "原网页子账户" : "无法确认");
    expect(f.evaluated.length).toBeLessThanOrEqual(2);
  } finally { await f.close(); }
});

it("cancels the reopened account DOM wait without returning a later account", async () => {
  const f = await fakeBrowser({ snapshot: target => ({ ...target.snapshot, accountTexts: [] }) });
  try {
    await expect(waitForCurrentQianchuanAccount(f.endpoint, "200", AbortSignal.timeout(100))).rejects.toThrow();
    expect(f.connected()).toBe(false);
  } finally { await f.close(); }
});

it("rejects a verification prompt that appears during the final account recheck", async () => {
  const f = await fakeBrowser({ snapshot: (target, read) => ({ ...target.snapshot, accountBlocked: read > 1 }) });
  try {
    await expect(waitForCurrentQianchuanAccount(f.endpoint, "200", AbortSignal.timeout(2000))).rejects.toThrow("无法确认");
    expect(f.evaluated).toHaveLength(2);
  } finally { await f.close(); }
});

it("waits for delayed account DOM in an isolated real Chrome without navigating or selecting files", async () => {
  const f = await realChrome();
  try {
    await f.context.route(`${origin}/**`, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<body>正在加载<script>setTimeout(() => { document.body.innerHTML = '<div class="account-info-container">子账户 ID：200</div>'; }, 300)</script></body>` }));
    const page = f.context.pages()[0]!;
    await page.goto(`${origin}/uni-prom?aavid=200`);
    expect(await waitForCurrentQianchuanAccount(f.endpoint, "200", AbortSignal.timeout(3000))).toEqual({ advertiserId: "200", name: "子账户" });
    expect(new URL(page.url()).searchParams.get("aavid")).toBe("200");
  } finally { await f.context.close(); await rm(f.profile, { recursive: true, force: true }); }
});

it("stops at a real Chrome verification page instead of treating it as delayed account DOM", async () => {
  const f = await realChrome();
  try {
    await f.context.route(`${origin}/**`, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<body>请完成安全验证</body>" }));
    await f.context.pages()[0]!.goto(`${origin}/uni-prom?aavid=200`);
    await expect(waitForCurrentQianchuanAccount(f.endpoint, "200", AbortSignal.timeout(2000))).rejects.toThrow("无法确认");
  } finally { await f.context.close(); await rm(f.profile, { recursive: true, force: true }); }
});

it.each(["请完成安全验证", "请完成安全验证后继续", "请登录后继续操作", "当前操作需要安全验证",
  "demo.mp4：请完成安全验证", "demo.mp4 上传受限，请完成安全验证", "demo.mp4 请完成安全验证",
  "请完成安全验证 demo.mp4", "demo.mp4 请通过安全验证 demo.mp4",
  "demo.mp4 请登录 demo.mp4", "请登录 demo.mp4", "demo.mp4 请先完成安全验证 demo.mp4",
  "安全验证教学.mp4 验证码素材.mp4", "权限不足说明.mp4", "请登录操作说明.mp4"])("preserves a real Chrome verification overlay with its original account header: %s", async prompt => {
  const f = await realChrome(), root = await mkdtemp(path.join(tmpdir(), "jianji-challenge-guard-"));
  try {
    await f.context.route(`${origin}/**`, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div class="account-info-container">原子账户 ID：200</div><div role="dialog" style="position:fixed;top:100px">' + prompt + '</div>' }));
    await f.context.pages()[0]!.goto(`${origin}/uni-prom?aavid=200`);
    await new QianchuanBrowserBindings(root).save({ advertiserId: "200", profile: f.profile, profileDirectory: "Default" });
    const shutdown = vi.fn(), launch = vi.fn();
    vi.spyOn(qianchuanEgressRuntime, "ensure").mockResolvedValue({ identity: "fixture", signal: new AbortController().signal });
    vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValue({ identity: "fixture", signal: new AbortController().signal });
    const manager = new QianchuanBrowserManager(root, { browsers: async () => [{ profile: f.profile, profileDirectory: "Default", endpoint: f.endpoint, egressArguments: [] }], shutdown, launch,
      egress: async () => ({ group: "fixture", sshHost: "fixture", localPort: 19381, expectedIp: "203.0.113.11" }) });
    await expect(manager.prepareUpload("200", () => {}, AbortSignal.timeout(2000), "200")).rejects.toThrow();
    expect(shutdown).not.toHaveBeenCalled(); expect(launch).not.toHaveBeenCalled();
    await expect(readCurrentQianchuanAccountSnapshot(f.endpoint)).rejects.toThrow("无法确认");
    await expect(waitForCurrentQianchuanAccount(f.endpoint, "200", AbortSignal.timeout(2000))).rejects.toThrow("无法确认");
    expect(await f.context.pages()[0]!.getByRole("dialog").innerText()).toBe(prompt);
  } finally { await f.context.close(); await rm(f.profile, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
});

it("accepts ordinary materials while ignoring a hidden challenge", async () => {
  const f = await realChrome();
  try {
    await f.context.route(`${origin}/**`, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div class="account-info-container">原子账户 ID：200</div><div>教学.mp4 普通素材.mp4</div><div style="display:none">请完成安全验证</div>' }));
    await f.context.pages()[0]!.goto(`${origin}/uni-prom?aavid=200`);
    await expect(readCurrentQianchuanAccountSnapshot(f.endpoint)).resolves.toEqual({ advertiserId: "200", name: "原子账户" });
  } finally { await f.context.close(); await rm(f.profile, { recursive: true, force: true }); }
});

it.each(['<div>普通素材.mp4</div>', '<div>操作说明.mp4</div>', '<div style="position:absolute;top:2000px">请完成安全验证</div>'])("ignores ordinary content or an offscreen prompt: %s", async content => {
  const f = await realChrome();
  try {
    await f.context.route(`${origin}/**`, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div class="account-info-container">原子账户 ID：200</div>' + content }));
    await f.context.pages()[0]!.goto(`${origin}/uni-prom?aavid=200`);
    await expect(readCurrentQianchuanAccountSnapshot(f.endpoint)).resolves.toEqual({ advertiserId: "200", name: "原子账户" });
  } finally { await f.context.close(); await rm(f.profile, { recursive: true, force: true }); }
});

it.each(['<div><span>请</span><span>完成安全验证</span></div>', '请完成安全验证'])("rejects a rendered verification prompt without relying on a particular wrapper: %s", async content => {
  const f = await realChrome();
  try {
    await f.context.route(`${origin}/**`, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div class="account-info-container">原子账户 ID：200</div>' + content }));
    await f.context.pages()[0]!.goto(`${origin}/uni-prom?aavid=200`);
    await expect(waitForCurrentQianchuanAccount(f.endpoint, "200", AbortSignal.timeout(2000))).rejects.toThrow("无法确认");
  } finally { await f.context.close(); await rm(f.profile, { recursive: true, force: true }); }
});

it("accepts valid account reads when CDP detach acknowledgements take 200ms", async () => {
  const fixture = await fakeBrowser({ detachDelayMs: 200 });
  try {
    await expect(readCurrentQianchuanAccount(fixture.endpoint)).resolves.toBe("200");
    expect(fixture.detached).toEqual(fixture.attached);
    expect(fixture.connected()).toBe(false);
  } finally { await fixture.close(); }
});

it("classifies a missing detach acknowledgement as a bounded transport timeout and closes its socket", async () => {
  const fixture = await fakeBrowser({ holdDetach: true });
  try {
    await expect(readCurrentQianchuanAccount(fixture.endpoint)).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(fixture.attached).toHaveLength(1);
    expect(fixture.connected()).toBe(false);
  } finally { await fixture.close(); }
});

it.each([{ menuDelay: 0, directList: false }, { menuDelay: 150, directList: false }, { menuDelay: 0, directList: true }, { menuDelay: 150, directList: true }])("lists child accounts after the hover menu renders ($menuDelay ms, direct list $directList) and switches only the explicit target", async ({ menuDelay, directList }) => {
  const fixture = await realChrome();
  try {
    await fixture.context.unroute(`${origin}/**`);
    await fixture.context.route(`${origin}/**`, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `
      <div class="account-info-container"><div class="account-info-box">账户甲<br>ID：200</div></div>
      <div class="qc-ui-navigator-account-detail"><div class="checkout-account" onclick="document.querySelector('.qc-ui-navigator-account-list').hidden=false">切换</div></div>
      <div class="qc-ui-navigator-account-list" hidden><div class="back-text" onclick="window.backCount++">返回</div><input placeholder="请输入账户名称或完整ID">
        <div class="tools-vmok-plugin-infinite-scroll" style="height:80px;overflow:auto">
          <div class="qc-ui-navigator-account-item" style="height:100px"><span class="account-name">账户甲</span><span class="account-id">ID 200</span></div>
          <div class="tools-vmok-plugin-infinite-scroll__loader">加载中</div>
        </div></div>
      <script>window.switchCount=0;window.backCount=0;const scroll=document.querySelector('.tools-vmok-plugin-infinite-scroll');
      const detail=document.querySelector('.qc-ui-navigator-account-detail');
      if(${directList}){detail.remove();document.querySelector('.account-info-container').onmouseenter=()=>setTimeout(()=>{document.querySelector('.qc-ui-navigator-account-list').hidden=false;},${menuDelay});}
      else if(${menuDelay}>0){detail.remove();document.querySelector('.account-info-container').onmouseenter=()=>setTimeout(()=>{if(!detail.isConnected)document.body.append(detail);},${menuDelay});}
      scroll.addEventListener('scroll',()=>{if(document.querySelectorAll('.qc-ui-navigator-account-item').length>1)return;
        const row=document.createElement('div');row.className='qc-ui-navigator-account-item';row.innerHTML='<span class="account-name">账户乙</span><span class="account-id">ID 300</span>';
        row.onclick=()=>{window.switchCount++;history.replaceState(null,'','/uni-prom?aavid=300');document.querySelector('.account-info-box').innerHTML='账户乙<br>ID：300';};
        scroll.insertBefore(row,scroll.lastElementChild);scroll.lastElementChild.textContent='没有更多了';});</script>` }));
    const untouched = fixture.context.pages()[0]!;
    await untouched.goto("about:blank");
    const page = await fixture.context.newPage(); await page.goto(`${origin}/uni-prom?aavid=200`); await page.bringToFront();
    const guard = vi.fn(async () => undefined);
    const catalog = await readQianchuanSubaccounts(fixture.endpoint, new AbortController().signal, new Set(), guard);
    expect(catalog).toEqual({ current: { name: "账户甲", advertiserId: "200" }, accounts: [{ name: "账户甲", advertiserId: "200" }, { name: "账户乙", advertiserId: "300" }] });
    await expect(switchQianchuanSubaccount(fixture.endpoint, "200", "999", new AbortController().signal, new Set(), guard)).rejects.toThrow();
    expect(await page.evaluate(() => (window as any).switchCount)).toBe(0);
    await expect(switchQianchuanSubaccount(fixture.endpoint, "200", "300", new AbortController().signal, new Set(), async () => { throw new Error("protected upload"); })).rejects.toThrow();
    expect(await page.evaluate(() => (window as any).switchCount)).toBe(0);
    expect(await switchQianchuanSubaccount(fixture.endpoint, "200", "300", new AbortController().signal, new Set(), guard)).toEqual({ name: "账户乙", advertiserId: "300" });
    expect(await page.evaluate(() => (window as any).switchCount)).toBe(1);
    expect(await page.evaluate(() => (window as any).backCount)).toBe(0);
    expect(untouched.url()).toBe("about:blank"); expect(fixture.context.pages()).toHaveLength(2);
    await expect(switchQianchuanSubaccount(fixture.endpoint, "200", "300", new AbortController().signal, new Set(), guard)).rejects.toThrow();
    expect(await page.evaluate(() => (window as any).switchCount)).toBe(1);
  } finally { await fixture.context.close(); await rm(fixture.profile, { recursive: true, force: true }); }
}, 30_000);

it("reads the current webpage name with its ID and rejects name drift", async () => {
  const fixture = await fakeBrowser({ snapshot: target => ({ ...target.snapshot, accountTexts: ["新子账户商贸\nID：200"] }) });
  try { await expect(readCurrentQianchuanAccountSnapshot(fixture.endpoint)).resolves.toEqual({ advertiserId: "200", name: "新子账户商贸" }); }
  finally { await fixture.close(); }
  const drift = await fakeBrowser({ snapshot: (target, read) => ({ ...target.snapshot, accountTexts: [`${read === 1 ? "旧名称" : "新名称"}\nID：200`] }) });
  try { await expect(readCurrentQianchuanAccountSnapshot(drift.endpoint)).rejects.toThrow(); }
  finally { await drift.close(); }
});

it("reads the active account in isolated Chrome and leaves other browser tabs untouched", async () => {
  const fixture = await realChrome();
  let observer: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    const oldPage = fixture.context.pages()[0]!;
    await oldPage.goto("about:blank");
    const currentPage = await fixture.context.newPage();
    await currentPage.goto(`${origin}/uni-prom?aavid=200`, { waitUntil: "domcontentloaded" });
    observer = await chromium.connectOverCDP(fixture.endpoint, { noDefaults: true });
    const visiblePage = observer.contexts()[0]!.pages().find(page => page.url().includes("aavid=200")) as Page;
    await visiblePage.bringToFront();
    expect(await currentPage.evaluate(() => document.visibilityState)).toBe("visible");
    const before = await Promise.all(fixture.context.pages().map(async page => ({ url: page.url(), state: await page.evaluate(() => document.visibilityState) })));

    await expect(readCurrentQianchuanAccount(fixture.endpoint)).resolves.toBe("200");
    await expect(readCurrentQianchuanAccountSnapshot(fixture.endpoint)).resolves.toEqual({ advertiserId: "200", name: "新子账户商贸" });

    expect(fixture.context.pages()).toHaveLength(2);
    expect(before).toEqual(await Promise.all(fixture.context.pages().map(async page => ({ url: page.url(), state: await page.evaluate(() => document.visibilityState) }))));
  } finally { await observer?.close(); await fixture.context.close(); await rm(fixture.profile, { recursive: true, force: true }); }
}, 20_000);

it("uses only visible eligible pages and detaches every inspected target session", async () => {
  const fixture = await fakeBrowser({ targets: [
    account("old-hidden", "100", "hidden"), account("new-visible", "200", "visible", "/uni-prom"),
    { ...account("picker", "300", "visible"), url: `${origin}/uni-prom?aavid=300&jianjiPlanPicker=1` },
    account("upload", "400", "visible"), { ...account("login", "invalid", "visible", "/login"), url: `${origin}/login` },
  ] });
  try {
    await expect(readCurrentQianchuanAccount(fixture.endpoint, undefined, new Set(["upload"]))).resolves.toBe("200");
    expect(fixture.evaluated).toEqual(["new-visible", "old-hidden", "new-visible", "old-hidden"]);
    expect(fixture.detached).toEqual(fixture.attached);
    expect(fixture.connected()).toBe(false);
  } finally { await fixture.close(); }
});

it("allows the catalog to address one hidden account page without relaxing existing active-account reads", async () => {
  const fixture = await fakeBrowser({ targets: [account("sole-hidden", "200", "hidden")] });
  try {
    await expect(readCurrentQianchuanAccount(fixture.endpoint)).rejects.toThrow();
    await expect(readCurrentQianchuanPage(fixture.endpoint)).rejects.toThrow();
    await expect(readCurrentQianchuanPage(fixture.endpoint, undefined, new Set(), { allowSingleHidden: true })).resolves.toMatchObject({
      account: { advertiserId: "200" }, targetId: "sole-hidden",
    });
    expect(fixture.detached).toEqual(fixture.attached);
  } finally { await fixture.close(); }
});

it.each(["visible", "hidden"] as const)("reads the verified account information page when %s", async visibility => {
  const fixture = await fakeBrowser({ targets: [account("account-info", "200", visibility, "/account-center/account-info")] });
  try {
    await expect(readCurrentQianchuanPage(fixture.endpoint, undefined, new Set(), { allowSingleHidden: true })).resolves.toMatchObject({
      account: { advertiserId: "200" }, targetId: "account-info",
    });
    expect(fixture.detached).toEqual(fixture.attached);
  } finally { await fixture.close(); }
});

it.each(["visible", "hidden"] as const)("reads a %s root-path catalog page while legacy reads still reject it", async visibility => {
  const fixture = await fakeBrowser({ targets: [account("root-page", "200", visibility, "/")] });
  try {
    await expect(readCurrentQianchuanAccount(fixture.endpoint)).rejects.toThrow();
    await expect(readCurrentQianchuanPage(fixture.endpoint)).rejects.toThrow();
    await expect(readCurrentQianchuanPage(fixture.endpoint, undefined, new Set(), { allowRoot: true, allowSingleHidden: true })).resolves.toMatchObject({
      account: { advertiserId: "200" }, targetId: "root-page",
    });
    await expect(readCurrentQianchuanPage(fixture.endpoint, undefined, new Set(["root-page"]), { allowRoot: true, allowSingleHidden: true })).rejects.toThrow();
  } finally { await fixture.close(); }
});

it("still rejects a root catalog page whose DOM account differs from its URL", async () => {
  const fixture = await fakeBrowser({ targets: [account("root-page", "200", "visible", "/")], snapshot: target => ({ ...target.snapshot, accountTexts: ["ID：999"] }) });
  try { await expect(readCurrentQianchuanPage(fixture.endpoint, undefined, new Set(), { allowRoot: true })).rejects.toThrow(); }
  finally { await fixture.close(); }
});

it("rejects ambiguous hidden account pages and still prefers a visible account", async () => {
  const ambiguous = await fakeBrowser({ targets: [account("one", "200", "hidden"), account("two", "200", "hidden")] });
  try { await expect(readCurrentQianchuanPage(ambiguous.endpoint, undefined, new Set(), { allowSingleHidden: true })).rejects.toThrow(); }
  finally { await ambiguous.close(); }
  const visible = await fakeBrowser({ targets: [account("one", "100", "hidden"), account("two", "200", "visible")] });
  try { await expect(readCurrentQianchuanPage(visible.endpoint, undefined, new Set(), { allowSingleHidden: true })).resolves.toMatchObject({ targetId: "two", account: { advertiserId: "200" } }); }
  finally { await visible.close(); }
});

it.each(["mismatch", "name drift"])("rejects %s on an explicitly qualified hidden page", async failure => {
  const fixture = await fakeBrowser({ targets: [account("hidden", "200", "hidden")], snapshot: (target, read) => ({
    ...target.snapshot, accountTexts: [failure === "mismatch" ? "ID：999" : `${read === 1 ? "旧名称" : "新名称"} ID：200`],
  }) });
  try { await expect(readCurrentQianchuanPage(fixture.endpoint, undefined, new Set(), { allowSingleHidden: true })).rejects.toThrow(); }
  finally { await fixture.close(); }
});

it("rejects conflicting visible accounts, URL and DOM identity mismatches, and duplicate URL IDs", async () => {
  const conflicts = await fakeBrowser({ targets: [account("one", "100", "visible"), account("two", "200", "visible")] });
  try { await expect(readCurrentQianchuanAccount(conflicts.endpoint)).rejects.toThrow(); }
  finally { await conflicts.close(); }

  const mismatch = await fakeBrowser({ snapshot: target => ({ ...target.snapshot, accountTexts: ["ID：999"] }) });
  try { await expect(readCurrentQianchuanAccount(mismatch.endpoint)).rejects.toThrow(); expect(mismatch.detached).toEqual(mismatch.attached); }
  finally { await mismatch.close(); }

  const duplicate = await fakeBrowser({ targets: [{ ...account("duplicate", "100", "visible"), url: `${origin}/finance?aavid=100&aavid=200` }] });
  try { await expect(readCurrentQianchuanAccount(duplicate.endpoint)).rejects.toThrow(); expect(duplicate.evaluated).toEqual([]); }
  finally { await duplicate.close(); }

  const malformed = await fakeBrowser({ targets: [{ ...account("malformed", "100", "visible"), url: `${origin}/finance?aavid=0` }] });
  try { await expect(readCurrentQianchuanAccount(malformed.endpoint)).rejects.toThrow(); expect(malformed.evaluated).toEqual([]); }
  finally { await malformed.close(); }

  const pageError = await fakeBrowser({ pageError: true });
  try { await expect(readCurrentQianchuanAccount(pageError.endpoint)).rejects.toThrow(); expect(pageError.detached).toEqual(pageError.attached); }
  finally { await pageError.close(); }
});

it("rejects identity drift while reading an eligible page", async () => {
  const fixture = await fakeBrowser({ snapshot: (target, read) => read === 1 ? target.snapshot : { ...target.snapshot, href: `${origin}/finance?aavid=300` } });
  try {
    await expect(readCurrentQianchuanAccount(fixture.endpoint)).rejects.toThrow();
    expect(fixture.detached).toEqual(fixture.attached);
  } finally { await fixture.close(); }
});

it("reads the same account while the platform updates only its hash refresh time", async () => {
  const target = account("refreshing", "200", "visible", "/uni-prom");
  target.url += "#shop=&dut=2026-10-15%2021%3A58&uni=unchanged";
  const fixture = await fakeBrowser({ targets: [target], snapshot: (current, read) => {
    current.url = current.url.replace(/dut=[^&]+/, `dut=2026-10-15%20${read === 1 ? "21%3A59" : "22%3A00"}`);
    return { ...current.snapshot, href: current.url };
  } });
  try {
    await expect(readCurrentQianchuanPage(fixture.endpoint)).resolves.toMatchObject({ account: { advertiserId: "200" }, targetId: target.targetId });
    expect(fixture.detached).toEqual(fixture.attached);
  } finally { await fixture.close(); }
});

it.each([
  "/uni-prom?aavid=300#shop=&dut=2026-10-15%2021%3A59",
  "/uni-prom?aavid=200&adId=700#shop=&dut=2026-10-15%2021%3A59",
  "/finance?aavid=200#shop=&dut=2026-10-15%2021%3A59",
  "/uni-prom?aavid=200#shop=other&dut=2026-10-15%2021%3A59",
  "/uni-prom?aavid=200#shop=&dut=invalid",
  "/uni-prom?aavid=200#shop=&dut=",
  "/uni-prom?aavid=200#shop=&dut=2026-10-15%2021%3A99",
  "/uni-prom?aavid=200#shop=&dut=2026-10-15%2021%3A59&dut=2026-10-15%2021%3A58",
  "/uni-prom?aavid=200#shop=",
])("rejects account, route, state or malformed refresh-time drift: %s", async route => {
  const target = account("refreshing", "200", "visible", "/uni-prom");
  target.url += "#shop=&dut=2026-10-15%2021%3A58";
  const fixture = await fakeBrowser({ targets: [target], snapshot: current => ({ ...current.snapshot, href: `${origin}${route}` }) });
  try { await expect(readCurrentQianchuanPage(fixture.endpoint)).rejects.toThrow(); }
  finally { await fixture.close(); }
});

it("accepts canonical HTTP and browser WebSocket endpoints, and refuses redirects", async () => {
  const fixture = await fakeBrowser();
  try {
    await expect(readCurrentQianchuanAccount(fixture.endpoint)).resolves.toBe("200");
    await expect(readCurrentQianchuanAccount(fixture.wsEndpoint)).resolves.toBe("200");
    await expect(readCurrentQianchuanAccount("http://example.com:9222")).rejects.toThrow();
  } finally { await fixture.close(); }

  const redirect = await fakeBrowser({ redirectMetadata: true });
  try { await expect(readCurrentQianchuanAccount(redirect.endpoint)).rejects.toThrow(); expect(redirect.connected()).toBe(false); }
  finally { await redirect.close(); }
});

it("cancels a stalled page read, detaches the session and closes its socket", async () => {
  const protocol = await fakeBrowser({ holdEvaluation: true });
  const controller = new AbortController();
  try {
    const pending = readCurrentQianchuanAccount(protocol.endpoint, controller.signal);
    const deadline = Date.now() + 2_000;
    while (!protocol.evaluated.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    expect(protocol.evaluated.length).toBeGreaterThan(0);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(protocol.detached).toEqual(protocol.attached);
    expect(protocol.connected()).toBe(false);
  } finally { controller.abort(); await protocol.close(); }
}, 20_000);

it("times out a stalled CDP command and closes its socket", async () => {
  const fixture = await fakeBrowser({ holdTargets: true });
  try {
    await expect(readCurrentQianchuanAccount(fixture.endpoint)).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(fixture.connected()).toBe(false);
  } finally { await fixture.close(); }
}, 8_000);
