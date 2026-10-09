import { createServer, type Server } from "node:http";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loginMembership } from "../src/main/membership-oauth.js";
import { MembershipConfigSchema } from "../src/shared/membership.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function listen(server: Server) { servers.push(server); await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); return (server.address() as { port: number }).port; }
async function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let authorization: URL, issuer: string;
  let validVerifier = false, secretSent = false, badNonce = false;
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/.well-known/openid-configuration") res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] }));
    else if (req.url === "/jwks") res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "fixture", alg: "RS256", use: "sig" }] }));
    else if (req.url === "/token") {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      validVerifier = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url") === authorization.searchParams.get("code_challenge");
      secretSent = body.has("client_secret") || !!req.headers.authorization;
      const at = Math.floor(Date.now() / 1000);
      const unsigned = [JSON.stringify({ alg: "RS256", kid: "fixture" }), JSON.stringify({ iss: issuer, aud: "desktop", sub: "account", iat: at, exp: at + 300, nonce: badNonce ? "wrong" : authorization.searchParams.get("nonce") })].map(s => Buffer.from(s).toString("base64url")).join(".");
      res.end(JSON.stringify({ access_token: "test-only-access-token", token_type: "Bearer", expires_in: 300, id_token: `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}` }));
    } else { res.writeHead(404); res.end("{}"); }
  });
  issuer = `http://127.0.0.1:${await listen(server)}`;
  const reserve = createServer(); const callbackPort = await listen(reserve); await new Promise<void>(r => reserve.close(() => r()));
  const config = MembershipConfigSchema.parse({ issuer, serviceUrl: issuer, clientId: "desktop", organization: "jianji", application: "jianji", pricingName: "jianji", callbackPort });
  return { config, inspect: () => ({ validVerifier, secretSent }), badNonce: () => { badNonce = true; },
    open: async (url: string) => {
      authorization = new URL(url);
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", "forged"); callback.searchParams.set("code", "fixture-code");
      expect((await fetch(callback)).status).toBe(400);
      callback.searchParams.set("state", authorization.searchParams.get("state")!);
      expect((await fetch(callback)).status).toBe(200);
    },
  };
}
describe("native OAuth PKCE", () => {
  it("uses S256/state/nonce and never sends a desktop client secret", async () => {
    const f = await fixture();
    expect(await loginMembership(f.config, f.open, new AbortController().signal)).toBe("test-only-access-token");
    expect(f.inspect()).toEqual({ validVerifier: true, secretSent: false });
  });
  it("rejects mismatched OIDC nonce without leaking the response", async () => {
    const f = await fixture(); f.badNonce();
    await expect(loginMembership(f.config, f.open, new AbortController().signal)).rejects.toThrow("登录未完成");
  });
  it("allows cancelling the system-browser login", async () => {
    const f = await fixture(); const controller = new AbortController();
    await expect(loginMembership(f.config, async () => { controller.abort(); }, controller.signal)).rejects.toThrow("登录未完成");
  });
});
