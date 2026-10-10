import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as oidc from "openid-client";
import { BillingError, ManualPayments } from "./manual-payments.js";
import { billingPage, billingScript } from "./billing-page.js";
import type { MembershipServerConfig } from "./policy.js";
import { BILLING_SESSION_SECONDS, FileBillingSessionStore, type BillingSession } from "./billing-session-store.js";

type Login = { state: string; nonce: string; verifier: string; expires: number; client: oidc.Configuration };
const opaque = () => randomBytes(32).toString("hex");

/** Browser cookies reference private durable credentials, never contain upstream tokens. */
export class BillingPortal {
  private readonly tickets = new Map<string, BillingSession>();
  private readonly logins = new Map<string, Login>();
  constructor(readonly config: MembershipServerConfig, readonly assets: string, readonly payments: ManualPayments, private readonly sessions: FileBillingSessionStore) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", this.config.serviceUrl);
    if (url.pathname !== "/billing" && !url.pathname.startsWith("/billing/")) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    this.prune();
    try { await this.route(req, res, url); }
    catch (e) {
      const known = e instanceof BillingError;
      this.json(res, known ? e.status : 503, { error: known ? e.message : "账号或审核服务暂不可用，请刷新查看。" });
    }
    return true;
  }

  private async route(req: IncomingMessage, res: ServerResponse, url: URL) {
    const route = url.pathname, method = req.method;
    if (method === "GET" && route === "/billing") { this.send(res, "text/html; charset=utf-8", billingPage); return; }
    if (method === "GET" && route === "/billing/app.js") { this.send(res, "text/javascript; charset=utf-8", billingScript); return; }
    if (method === "GET" && /^\/billing\/qr\/(wechat|alipay)$/.test(route)) {
      const file = path.join(this.assets, `${route.endsWith("wechat") ? "wechat" : "alipay"}.jpg`);
      const metadata = await stat(file);
      if (!metadata.isFile() || metadata.size > 3 * 1024 * 1024) throw new BillingError(503, "收款码不可用，请勿付款。");
      this.send(res, "image/jpeg", await readFile(file)); return;
    }
    if (method === "POST" && route === "/billing/ticket") {
      const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i.exec(req.headers.authorization ?? "");
      if (!match || match[1].length > 16384) throw new BillingError(401, "请先登录。");
      await this.payments.principal(match[1]);
      const ticket = opaque(); this.reserve(this.tickets);
      this.tickets.set(ticket, { token: match[1], csrf: opaque(), expires: Date.now() + 60_000 });
      this.json(res, 200, { ticket }); return;
    }
    if (method === "POST" && route === "/billing/session") {
      this.sameOrigin(req); const body = await this.body(req); const ticket = typeof body.ticket === "string" ? body.ticket : "";
      const session = this.tickets.get(ticket); this.tickets.delete(ticket);
      if (!session) throw new BillingError(401, "续费链接已过期，请从简辑重新打开。");
      await this.payments.principal(session.token);
      await this.createSession(res, session.token); this.json(res, 200, { ok: true }); return;
    }
    if (method === "GET" && route === "/billing/login") {
      this.reserve(this.logins);
      const client = await oidc.discovery(new URL(this.config.issuer), this.config.clientId, undefined, oidc.None(), {
        execute: this.config.issuer.startsWith("http:") ? [oidc.allowInsecureRequests] : undefined,
        [oidc.customFetch]: (target, options) => {
          if (new URL(String(target)).origin !== this.config.issuer) throw new Error("Invalid issuer.");
          return fetch(target, { ...options, redirect: "error", signal: AbortSignal.timeout(10_000) });
        },
      });
      const id = opaque(), login: Login = { client, state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier(), expires: Date.now() + 180_000 };
      const target = oidc.buildAuthorizationUrl(client, { redirect_uri: `${this.config.serviceUrl}/billing/callback`, scope: "openid profile", response_type: "code", code_challenge: await oidc.calculatePKCECodeChallenge(login.verifier), code_challenge_method: "S256", state: login.state, nonce: login.nonce });
      if (target.origin !== this.config.issuer) throw new Error("Invalid authorization endpoint.");
      this.logins.set(id, login); this.cookie(res, "jianji_billing_login", id, 180); this.redirect(res, target.href); return;
    }
    if (method === "GET" && route === "/billing/callback") {
      const id = this.readCookie(req, "jianji_billing_login"), login = this.logins.get(id);
      this.logins.delete(id); this.cookie(res, "jianji_billing_login", "", 0);
      if (!login || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== login.state) throw new BillingError(401, "登录链接已失效，请返回续费页重新登录。");
      const result = await oidc.authorizationCodeGrant(login.client, url, { pkceCodeVerifier: login.verifier, expectedState: login.state, expectedNonce: login.nonce, idTokenExpected: true });
      if (!result.access_token || result.access_token.length > 16384 || result.token_type.toLowerCase() !== "bearer") throw new Error("Invalid token.");
      await this.payments.principal(result.access_token);
      await this.createSession(res, result.access_token); this.redirect(res, "/billing"); return;
    }
    const session = await this.sessions.get(this.readCookie(req, "jianji_billing"));
    if (!session) throw new BillingError(401, "请登录后查看或提交申请。");
    if (method === "GET" && route === "/billing/requests") {
      this.json(res, 200, { ...await this.payments.list(session.token), csrf: session.csrf }); return;
    }
    if (method !== "POST") throw new BillingError(404, "页面不存在。");
    this.sameOrigin(req);
    if (req.headers["x-csrf-token"] !== session.csrf) throw new BillingError(403, "页面已失效，请刷新后重试。");
    if (route === "/billing/logout") {
      try { await this.sessions.remove(this.readCookie(req, "jianji_billing")); }
      finally { this.cookie(res, "jianji_billing", "", 0); }
      this.json(res, 200, { ok: true }); return;
    }
    const body = await this.body(req);
    if (route === "/billing/requests") {
      // Do not accept applications if the configured payment images are unavailable.
      for (const channel of ["wechat", "alipay"]) { const s = await stat(path.join(this.assets, `${channel}.jpg`)); if (!s.isFile() || s.size > 3 * 1024 * 1024) throw new Error("Unavailable QR."); }
      this.json(res, 200, await this.payments.submit(session.token, body)); return;
    }
    const match = /^\/billing\/requests\/(manual_[a-f0-9]{64})\/review$/.exec(route);
    if (match) { this.json(res, 200, await this.payments.review(session.token, match[1], body)); return; }
    throw new BillingError(404, "页面不存在。");
  }

  private async createSession(res: ServerResponse, token: string) { const id = opaque(); await this.sessions.put(id, { token, csrf: opaque(), expires: Date.now() + BILLING_SESSION_SECONDS * 1000 }); this.cookie(res, "jianji_billing", id, BILLING_SESSION_SECONDS); }
  private prune() { for (const map of [this.tickets, this.logins]) for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key); }
  private reserve(map: Map<string, unknown>) { if (map.size >= 1000) throw new BillingError(429, "当前请求较多，请稍后重试。"); }
  private readCookie(req: IncomingMessage, name: string) { return (req.headers.cookie ?? "").split(";").map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1) ?? ""; }
  private cookie(res: ServerResponse, name: string, value: string, seconds: number) {
    const current = res.getHeader("Set-Cookie");
    res.setHeader("Set-Cookie", [...(Array.isArray(current) ? current.map(String) : current ? [String(current)] : []), `${name}=${value}; Path=/billing; HttpOnly; SameSite=Lax; Max-Age=${seconds}${this.config.serviceUrl.startsWith("https:") ? "; Secure" : ""}`]);
  }
  private sameOrigin(req: IncomingMessage) { if (req.headers.origin !== this.config.serviceUrl) throw new BillingError(403, "请求来源无效。"); }
  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (req.headers["content-type"] !== "application/json") throw new BillingError(415, "请求格式无效。");
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new BillingError(413, "请求过大。"); chunks.push(Buffer.from(chunk)); }
    try { const data = JSON.parse(Buffer.concat(chunks).toString()); if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(); return data; }
    catch { throw new BillingError(400, "请求格式无效。"); }
  }
  private json(res: ServerResponse, status: number, body: unknown) { if (!res.headersSent) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); } }
  private send(res: ServerResponse, type: string, body: string | Buffer) { res.writeHead(200, { "Content-Type": type }); res.end(body); }
  private redirect(res: ServerResponse, target: string) { res.writeHead(303, { Location: target }); res.end(); }
}
