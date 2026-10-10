import { createServer } from "node:http";
import * as oidc from "openid-client";
import type { MembershipConfig } from "../shared/membership.js";

/** Public native OAuth client: no shared secret, no embedded login page, no renderer tokens. */
export async function loginMembership(config: MembershipConfig, open: (url: string) => Promise<void>, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  const timeout = AbortSignal.timeout(180_000);
  const combined = AbortSignal.any([signal, timeout]);
  combined.throwIfAborted();
  // Casdoor's stable endpoints let the browser open without a discovery round trip.
  const native = new oidc.Configuration({
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/login/oauth/authorize`,
    token_endpoint: `${config.issuer}/api/login/oauth/access_token`,
    jwks_uri: `${config.issuer}/.well-known/jwks`,
    id_token_signing_alg_values_supported: ["RS256"],
  }, config.clientId, undefined, oidc.None());
  if (config.issuer.startsWith("http:")) oidc.allowInsecureRequests(native);
  native[oidc.customFetch] = (url, options) => {
    if (new URL(String(url)).origin !== config.issuer) throw new Error("账号服务地址不匹配。");
    return fetcher(url, { ...options, redirect: "error", signal: AbortSignal.any([combined, AbortSignal.timeout(10_000)]) });
  };
  const verifier = oidc.randomPKCECodeVerifier(), state = oidc.randomState(), nonce = oidc.randomNonce();
  const redirect = `http://127.0.0.1:${config.callbackPort}/jianji-login`;
  const authorization = oidc.buildAuthorizationUrl(native, {
    redirect_uri: redirect, scope: "openid profile", response_type: "code",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", state, nonce,
  });
  if (authorization.origin !== config.issuer) throw new Error("登录地址不匹配。");
  return new Promise<string>((resolve, reject) => {
    let settled = false, exchanging = false;
    const finish = (token?: string) => {
      if (settled) return; settled = true;
      combined.removeEventListener("abort", abort);
      server.close(); server.closeAllConnections();
      if (token) resolve(token); else reject(new Error("登录未完成或已取消。"));
    };
    const abort = () => finish();
    const server = createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Content-Security-Policy", "default-src 'none'");
      let url: URL;
      try { url = new URL(request.url ?? "/", redirect); }
      catch { response.writeHead(400); response.end("无效的登录回调。"); return; }
      if (request.method !== "GET" || request.headers.host !== `127.0.0.1:${config.callbackPort}` || url.pathname !== "/jianji-login" || url.searchParams.get("state") !== state || url.searchParams.getAll("state").length !== 1 || exchanging) {
        response.writeHead(400); response.end("无效的登录回调。"); return;
      }
      exchanging = true;
      response.end("已收到登录回调，请返回简辑查看结果。");
      void oidc.authorizationCodeGrant(native, url, { pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce, idTokenExpected: true })
        .then(tokens => {
          if (combined.aborted || !tokens.access_token || tokens.access_token.length > 32_768 || tokens.token_type.toLowerCase() !== "bearer") finish();
          else finish(tokens.access_token);
        }, () => finish());
    });
    server.requestTimeout = 10_000; server.headersTimeout = 10_000;
    server.once("error", () => finish());
    combined.addEventListener("abort", abort, { once: true });
    if (combined.aborted) { finish(); return; }
    server.listen(config.callbackPort, "127.0.0.1", () => { void open(authorization.href).catch(() => finish()); });
  });
}
