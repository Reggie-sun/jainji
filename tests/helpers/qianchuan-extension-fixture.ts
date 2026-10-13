import { createHash, X509Certificate } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { connect, createServer as createTcpServer, type Server as TcpServer, type Socket } from "node:net";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import path from "node:path";

export const FIXTURE_HOST = "qianchuan.jinritemai.com";
export const FIXTURE_ACCOUNTS = [
  { advertiserId: "1876294500004864", name: "隔离测试账户一" },
  { advertiserId: "1876294500004865", name: "隔离测试账户二" },
] as const;
export const FIXTURE_PLANS = [
  { advertiserId: FIXTURE_ACCOUNTS[0].advertiserId, adId: "73001", name: "账户一测试计划" },
  { advertiserId: FIXTURE_ACCOUNTS[1].advertiserId, adId: "73002", name: "账户二测试计划" },
] as const;

export interface FixtureState {
  planPageLoads: number;
  closedPlanPages: number[];
  accountDocumentLoads: Map<string, number>;
  apiRequests: Array<{ path: string; advertiserId: string; csrf: string | undefined; signed: boolean }>;
  acceptedProxyTargets: string[];
  rejectedProxyTargets: string[];
}

export interface QianchuanFixture {
  proxyPort: number;
  certificateSpki: string;
  state: FixtureState;
  waitFor(predicate: () => boolean, description: string, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

function listen(server: TcpServer | HttpsServer): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { server.removeListener("listening", onListening); reject(error); };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") { reject(new Error("fixture listen failed")); return; }
      resolve((address as AddressInfo).port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function accountHtml(advertiserId: string, name: string, planPage: number | undefined): string {
  const account = FIXTURE_ACCOUNTS.find(value => value.advertiserId === advertiserId);
  const plan = FIXTURE_PLANS.find(value => value.advertiserId === advertiserId);
  const isStablePlanPage = planPage === 1;
  const pagination = isStablePlanPage && plan
    ? `<div data-e2e="oc_emptyKey_uni-prom__ocTable_pagination_group">
        <span class="ovui-page-total">共 1 条记录</span>
        <ul><li class="ovui-page-turner__item ovui-page-turner__item--active">1</li>
        <li class="ovui-page-turner__item ovui-page-turner__item--disabled"><span class="ovui-page-turner__next-icon"></span></li></ul>
      </div>
      <table><tbody><tr class="ovui-tr"><td class="p-c-ad-name-col">
        <div class="oc-promotion-product-adinfo-name"><span class="oc-typography-value-int">${plan.name}</span></div>
        <div class="oc-promotion-product-adinfo-id-fade">ID：${plan.adId}</div>
      </td></tr></tbody></table>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title>
    <script>
      if (new URL(location.href).searchParams.get("jianjiExtensionPlanPicker") === "1") {
        const load = ${planPage ?? 0};
        addEventListener("pagehide", () => navigator.sendBeacon("/__fixture/plan-closed?load=" + load, "closed"));
      }
    </script>
    <style>body{font:16px sans-serif}.account-info-container{display:block;width:600px;height:32px}</style>
    </head><body>
      <div class="account-info-container"><div class="account-info-box">${name} ID：${advertiserId}</div></div>
      ${planPage === undefined ? "" : `<div class="ovui-tabs__tab ovui-tabs__tab--active"><span data-e2e="oc_emptyKey_uni-prom_1">商品自选</span></div>
      <div class="ovui-tabs__tab"><span data-e2e="oc_emptyKey_uni-prom_2">全店托管</span></div>
      <div class="ovui-radio-item ovui-radio-item--checked"><span data-e2e="oc_emptyKey_uni-prom_0">控成本投放</span></div>
      <div class="ovui-radio-item"><span data-e2e="oc_emptyKey_uni-prom_7">放量投放</span></div>${pagination}`}
    </body></html>`;
}

function sendJson(response: import("node:http").ServerResponse, value: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value));
}

export async function createQianchuanFixture(root: string): Promise<QianchuanFixture> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const keyPath = path.join(root, "fixture.key.pem"), certificatePath = path.join(root, "fixture.crt.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certificatePath,
    "-days", "1", "-subj", `/CN=${FIXTURE_HOST}`, "-addext", `subjectAltName=DNS:${FIXTURE_HOST}`], { stdio: "ignore", timeout: 10_000 });
  await chmod(keyPath, 0o600);
  const [key, certificate] = await Promise.all([readFile(keyPath), readFile(certificatePath)]);
  const publicKey = new X509Certificate(certificate).publicKey.export({ type: "spki", format: "der" });
  const certificateSpki = createHash("sha256").update(publicKey).digest("base64");
  const state: FixtureState = { planPageLoads: 0, closedPlanPages: [], accountDocumentLoads: new Map(), apiRequests: [], acceptedProxyTargets: [], rejectedProxyTargets: [] };
  const tlsSockets = new Set<Duplex>(), proxySockets = new Set<Socket>(), upstreamSockets = new Set<Socket>();

  const httpsServer = createHttpsServer({ key, cert: certificate }, (request, response) => {
    let url: URL;
    try { url = new URL(request.url ?? "/", `https://${FIXTURE_HOST}`); }
    catch { response.writeHead(400).end(); return; }
    const advertiserId = url.searchParams.get("aavid") ?? "";
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/uni-prom")) {
      const account = FIXTURE_ACCOUNTS.find(value => value.advertiserId === advertiserId);
      if (!account) { response.writeHead(404).end(); return; }
      const isPlan = url.searchParams.get("jianjiExtensionPlanPicker") === "1";
      let planPage: number | undefined;
      if (isPlan) planPage = ++state.planPageLoads;
      else state.accountDocumentLoads.set(advertiserId, (state.accountDocumentLoads.get(advertiserId) ?? 0) + 1);
      response.setHeader("set-cookie", "csrftoken=fixture-only-csrf; Path=/; Secure; SameSite=Lax");
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.end(accountHtml(advertiserId, account.name, planPage));
      return;
    }
    if (request.method === "POST" && url.pathname === "/__fixture/plan-closed") {
      request.resume();
      request.on("end", () => { const load = Number(url.searchParams.get("load")); if (Number.isSafeInteger(load)) state.closedPlanPages.push(load); response.writeHead(204).end(); });
      return;
    }
    if (request.method === "GET" && (url.pathname === "/ad/api/v1/account/user/info" || url.pathname === "/ad/api/v1/account/user-list")) {
      const csrfHeader = request.headers["x-csrftoken"];
      const csrf = typeof csrfHeader === "string" ? csrfHeader : undefined;
      const signed = ["qc-date", "qc-key", "qc-auth"].every(header => typeof request.headers[header] === "string");
      state.apiRequests.push({ path: url.pathname, advertiserId, csrf, signed });
      if (csrf !== "fixture-only-csrf" || !signed) { sendJson(response, { status_code: 1, data: {} }, 403); return; }
      if (url.pathname === "/ad/api/v1/account/user/info") {
        const account = FIXTURE_ACCOUNTS.find(value => value.advertiserId === advertiserId);
        if (!account) { sendJson(response, { status_code: 1, data: {} }, 404); return; }
        sendJson(response, { status_code: 0, data: { accountInfo: { advId: account.advertiserId, advName: account.name } } });
        return;
      }
      const accounts = FIXTURE_ACCOUNTS.map(value => ({ id: value.advertiserId, advid: value.advertiserId, name: value.name }));
      sendJson(response, { status_code: 0, data: { userAccountInfos: accounts, totalPages: 1, totalCount: 2, currentPage: Number(url.searchParams.get("page")) } });
      return;
    }
    response.writeHead(404).end();
  });
  httpsServer.on("connection", socket => { tlsSockets.add(socket); socket.once("close", () => tlsSockets.delete(socket)); });
  const tlsPort = await listen(httpsServer);

  const proxyServer = createTcpServer(client => {
    proxySockets.add(client);
    client.once("close", () => proxySockets.delete(client));
    let header = Buffer.alloc(0), connecting = false;
    const inspect = (chunk: Buffer) => {
      if (connecting || client.destroyed) return;
      header = Buffer.concat([header, chunk]);
      if (header.length > 8192) { client.destroy(); return; }
      const boundary = header.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      connecting = true;
      client.removeListener("data", inspect);
      const requestHead = header.subarray(0, boundary).toString("latin1");
      const requestLine = requestHead.split("\r\n", 1)[0] ?? "";
      const match = /^CONNECT ([^ ]+) HTTP\/1\.[01]$/.exec(requestLine);
      const target = match?.[1] ?? "INVALID";
      if (target !== `${FIXTURE_HOST}:443`) {
        state.rejectedProxyTargets.push(target);
        client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      state.acceptedProxyTargets.push(target);
      const upstream = connect(tlsPort, "127.0.0.1");
      upstreamSockets.add(upstream);
      upstream.once("close", () => upstreamSockets.delete(upstream));
      upstream.once("error", () => client.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const rest = header.subarray(boundary + 4);
        if (rest.length) upstream.write(rest);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    };
    client.on("data", inspect);
    client.on("error", () => undefined);
  });
  const proxyPort = await listen(proxyServer);

  return {
    proxyPort,
    certificateSpki,
    state,
    waitFor: async (predicate, description, timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`fixture timeout waiting for ${description}`);
    },
    close: async () => {
      for (const socket of [...proxySockets, ...upstreamSockets, ...tlsSockets]) socket.destroy();
      await Promise.all([proxyServer, httpsServer].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    },
  };
}

export interface XServer {
  display: string;
  stop(): Promise<void>;
}

export async function startXvfb(): Promise<XServer> {
  const child = spawn("Xvfb", ["-displayfd", "1", "-screen", "0", "1280x900x24", "-nolisten", "tcp"], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "", displayOutput = "", resolveDisplay!: (value: string) => void, rejectDisplay!: (error: Error) => void;
  const displayReady = new Promise<string>((resolve, reject) => { resolveDisplay = resolve; rejectDisplay = reject; });
  const startupTimer = setTimeout(() => rejectDisplay(new Error(`Xvfb startup timed out: ${stderr.slice(-1000)}`)), 5000);
  child.stdout?.on("data", chunk => {
    displayOutput += chunk.toString("utf8");
    const number = /(?:^|\n)([0-9]+)\n/.exec(displayOutput)?.[1];
    if (number !== undefined) { clearTimeout(startupTimer); resolveDisplay(`:${number}`); }
  });
  child.stderr?.on("data", chunk => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2000); });
  child.once("error", error => { clearTimeout(startupTimer); rejectDisplay(error); });
  child.once("exit", (code, signal) => {
    if (code !== 0) { clearTimeout(startupTimer); rejectDisplay(new Error(`Xvfb exited ${code ?? signal ?? "unknown"}: ${stderr.slice(-1000)}`)); }
  });
  const display = await displayReady;
  return { display, stop: () => stopChild(child) };
}

export interface ManagedChrome {
  child: ChildProcess;
  stderr(): string;
  exited(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stop(): Promise<void>;
}

export function launchBoundedChrome(binary: string, args: string[], environment: NodeJS.ProcessEnv, maximumRuntimeMs = 55_000): ManagedChrome {
  if (args.some(argument => /remote-debugging|devtools|playwright/i.test(argument))) throw new Error("forbidden browser automation flag in fixture command");
  const child = spawn(binary, args, { env: environment, detached: true, stdio: ["ignore", "ignore", "pipe"] });
  let output = "", closed = false, stopping: Promise<void> | undefined;
  let resolveExit!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => { resolveExit = resolve; });
  child.stderr?.on("data", chunk => { output = `${output}${chunk.toString("utf8")}`.slice(-4000); });
  child.once("error", () => { closed = true; resolveExit({ code: null, signal: null }); });
  child.once("close", (code, signal) => { closed = true; resolveExit({ code, signal }); });
  const signalGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch { if (!closed) child.kill(signal); }
  };
  const hardStop = setTimeout(() => {
    signalGroup("SIGTERM");
    setTimeout(() => signalGroup("SIGKILL"), 1500).unref();
  }, maximumRuntimeMs);
  hardStop.unref();
  const stop = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (!closed) signalGroup("SIGTERM");
      await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 1500))]);
      signalGroup("SIGKILL");
      await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 1000))]);
      clearTimeout(hardStop);
    })();
    return stopping;
  };
  return { child, stderr: () => output, exited: () => exit, stop };
}

export async function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  let closed = child.exitCode !== null || child.signalCode !== null;
  let resolveClose!: () => void;
  const close = new Promise<void>(resolve => { resolveClose = resolve; });
  if (!closed) child.once("close", () => { closed = true; resolveClose(); });
  try { process.kill(-child.pid, "SIGTERM"); }
  catch { if (!closed) child.kill("SIGTERM"); }
  if (!closed) await Promise.race([close, new Promise(resolve => setTimeout(resolve, 500))]);
  if (!closed) {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch { child.kill("SIGKILL"); }
    await Promise.race([close, new Promise(resolve => setTimeout(resolve, 1000))]);
  }
}
