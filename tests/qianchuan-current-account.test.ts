import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import WebSocket, { WebSocketServer } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { readCurrentQianchuanAccount } from "../src/main/qianchuan-current-account";

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
        sessions.delete(sessionId); respond({});
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
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<div class="account-info-container">ID：${id}</div>` });
  });
  const port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
  return { context, profile, endpoint: `http://127.0.0.1:${port}` };
}

afterEach(() => vi.restoreAllMocks());

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
    await expect(readCurrentQianchuanAccount(fixture.endpoint)).rejects.toThrow("超时");
    expect(fixture.connected()).toBe(false);
  } finally { await fixture.close(); }
}, 8_000);
