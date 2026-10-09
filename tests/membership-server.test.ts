import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MembershipStatusSchema } from "../src/shared/membership.js";
import { DEFAULT_MEMBERSHIP_SERVER_PORT, startMembershipServer } from "../src/membership-server/index.js";
import { MembershipServerConfigSchema, addUtcCalendarMonthClamped, membershipServerConfigFromEnvironment } from "../src/membership-server/policy.js";
import { createMembershipServer } from "../src/membership-server/server.js";

type JsonObject = Record<string, unknown>;
type Fault = { kind: "status" | "redirect" | "raw" | "oversized"; body?: string; status?: number };
type FixtureState = {
  now: string;
  user: JsonObject;
  application: JsonObject;
  pricing: JsonObject;
  plans: Record<string, JsonObject>;
  products: Record<string, JsonObject>;
  subscriptions: JsonObject[];
  tokens: Record<string, JsonObject>;
  faults: Record<string, Fault>;
  requests: Array<{ method: string; path: string; url: string; authorization: string | undefined; body: string }>;
};

const servers: Server[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port.");
  return `http://127.0.0.1:${address.port}`;
}

async function fixture(options: { createdTime?: string; now?: string } = {}) {
  const state: FixtureState = {
    now: options.now ?? "2024-02-01T00:00:00.000Z",
    user: {
      id: "user-uuid",
      owner: "jianji-org",
      name: "alice",
      displayName: "Alice",
      createdTime: options.createdTime ?? "2020-01-01T00:00:00.000Z",
      isAdmin: false,
      isForbidden: false,
      isDeleted: false,
    },
    application: {
      owner: "admin",
      name: "jianji-desktop",
      organization: "jianji-org",
      clientId: "jianji-client-id",
      enableExclusiveSignin: true,
      maxSessions: 1,
      clientSecret: "casdoor-application-secret-in-upstream-response",
    },
    pricing: { owner: "jianji-org", name: "jianji-pricing", application: "jianji-desktop", isEnabled: true, plans: ["jianji-monthly", "jianji-yearly"] },
    plans: {
      "jianji-monthly": { owner: "jianji-org", name: "jianji-monthly", price: 100, currency: "CNY", period: "Monthly", product: "product-monthly", isEnabled: true },
      "jianji-yearly": { owner: "jianji-org", name: "jianji-yearly", price: 666, currency: "CNY", period: "Yearly", product: "product-yearly", isEnabled: true },
    },
    products: {
      "product-monthly": { owner: "jianji-org", name: "product-monthly", price: 100, currency: "CNY" },
      "product-yearly": { owner: "jianji-org", name: "product-yearly", price: 666, currency: "CNY" },
    },
    subscriptions: [],
    tokens: {},
    faults: {},
    requests: [],
  };
  let issuer = "";
  const casdoor = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://casdoor-fixture");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    state.requests.push({ method: request.method ?? "", path: url.pathname, url: `${url.pathname}${url.search}`, authorization: request.headers.authorization, body });

    const fault = state.faults[url.pathname];
    if (fault?.kind === "status") {
      response.writeHead(fault.status ?? 500, { "Content-Type": "text/plain" }).end(fault.body ?? "private upstream detail");
      return;
    }
    if (fault?.kind === "redirect") {
      response.writeHead(302, { Location: "/redirect-target" }).end();
      return;
    }
    if (fault?.kind === "raw") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(fault.body ?? "not-json");
      return;
    }
    if (fault?.kind === "oversized") {
      const data = JSON.stringify({ status: "ok", data: "x".repeat(600_000) });
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }).end(data);
      return;
    }

    if (url.pathname === "/api/login/oauth/introspect" && request.method === "POST") {
      const token = new URLSearchParams(body).get("token") ?? "";
      const claim = state.tokens[token] ?? {
        active: true,
        client_id: "jianji-client-id",
        username: "alice",
        sub: "user-uuid",
        iss: issuer,
        aud: ["jianji-client-id"],
        exp: Date.parse("2030-01-01T00:00:00.000Z") / 1000,
      };
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(claim));
      return;
    }
    if (url.pathname === "/api/get-user") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", data: state.user }));
      return;
    }
    if (url.pathname === "/api/get-application") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", data: state.application }));
      return;
    }
    if (url.pathname === "/api/get-pricing") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", data: state.pricing }));
      return;
    }
    if (url.pathname === "/api/get-plan") {
      const planName = url.searchParams.get("id")?.split("/").at(-1) ?? "";
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", data: state.plans[planName] ?? null }));
      return;
    }
    if (url.pathname === "/api/get-product") {
      const productName = url.searchParams.get("id")?.split("/").at(-1) ?? "";
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", data: state.products[productName] ?? null }));
      return;
    }
    if (url.pathname === "/api/get-subscriptions") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", data: state.subscriptions }));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "error" }));
  });

  const casdoorUrl = await listen(casdoor);
  issuer = casdoorUrl;
  const config = MembershipServerConfigSchema.parse({
    serviceUrl: "http://127.0.0.1:8788",
    issuer: casdoorUrl,
    clientId: "jianji-client-id",
    clientSecret: "membership-server-secret-123",
    organization: "jianji-org",
    application: "jianji-desktop",
    pricingName: "jianji-pricing",
    callbackPort: 43829,
    monthlyPlan: "jianji-monthly",
    yearlyPlan: "jianji-yearly",
    grantPlan: "jianji-grant",
  });
  const service = createMembershipServer({ config, clock: () => new Date(state.now) });
  const base = await listen(service);
  return { state, config, base, service, casdoor };
}

async function status(base: string, accessToken = "valid-access-token") {
  const headers: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const response = await fetch(`${base}/v1/membership`, { headers });
  expect(response.status).toBe(200);
  return MembershipStatusSchema.parse(await response.json());
}

async function getWithBody(base: string, body: string): Promise<{ statusCode: number; body: string }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: url.hostname, port: Number(url.port), path: "/v1/membership", method: "GET", headers: { "Content-Length": Buffer.byteLength(body) } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

function subscription(plan: string, overrides: JsonObject = {}): JsonObject {
  return {
    owner: "jianji-org",
    user: "alice",
    plan,
    state: "Active",
    startTime: "2024-01-01T00:00:00.000Z",
    endTime: "2024-03-01T00:00:00.000Z",
    payment: "payment-1",
    ...overrides,
  };
}

describe("membership server", () => {
  it("starts on loopback at the default port and returns an unconfigured status without config", async () => {
    const server = await startMembershipServer({ config: null, listenPort: 0 });
    servers.push(server);
    const address = server.address();
    expect(address && typeof address !== "string" ? address.address : "").toBe("127.0.0.1");
    expect(DEFAULT_MEMBERSHIP_SERVER_PORT).toBe(8789);
    const base = `http://127.0.0.1:${(address as { port: number }).port}`;
    const health = await fetch(`${base}/health`);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(health.headers.get("access-control-allow-origin")).toBeNull();
    expect(await status(base, "")).toMatchObject({ state: "unconfigured", reason: "unconfigured" });
  });

  it("uses Casdoor Basic Auth, server-side introspection, and exact user/subscription selectors", async () => {
    const { state, base, config } = await fixture();
    const result = await status(base);
    expect(result).toMatchObject({
      state: "denied",
      reason: "expired",
      checkedAt: "2024-02-01T00:00:00.000Z",
      user: { id: "user-uuid", name: "alice", displayName: "Alice", isAdmin: false },
    });
    expect(state.requests.map((request) => request.path)).toEqual([
      "/api/login/oauth/introspect",
      "/api/get-user",
      "/api/get-application",
      "/api/get-subscriptions",
    ]);
    expect(state.requests[0]).toMatchObject({ method: "POST", body: "token=valid-access-token&token_type_hint=access_token" });
    expect(state.requests[0].authorization).toBe(`Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`);
    expect(new URLSearchParams(new URL(state.requests[1].url, "http://fixture").search).get("id")).toBe("jianji-org/alice");
    expect(new URLSearchParams(new URL(state.requests[2].url, "http://fixture").search).get("id")).toBe("admin/jianji-desktop");
    expect(state.requests[3].url).toBe("/api/get-subscriptions?owner=jianji-org&field=user&value=alice");
    expect(state.requests[3].authorization).toBe(state.requests[0].authorization);
    expect(result.message).not.toContain(config.clientSecret);
    expect(JSON.stringify(result)).not.toContain("casdoor-application-secret-in-upstream-response");
  });

  it("does not accept access tokens in the URL or request body", async () => {
    const { state, base } = await fixture({ createdTime: "2024-01-31T12:00:00.000Z" });
    const fromUrl = await fetch(`${base}/v1/membership?access_token=valid-access-token`);
    expect(MembershipStatusSchema.parse(await fromUrl.json())).toMatchObject({ state: "signed-out", reason: "signed-out" });
    const response = await getWithBody(base, JSON.stringify({ accessToken: "valid-access-token" }));
    expect(response.statusCode).toBe(200);
    expect(MembershipStatusSchema.parse(JSON.parse(response.body))).toMatchObject({ state: "denied", reason: "session-expired" });
    expect(state.requests).toHaveLength(0);
  });

  it("rejects wrong audience, subject, and owner before granting access", async () => {
    const { state, base, config } = await fixture();
    state.tokens.audience = { active: true, client_id: "jianji-client-id", username: "alice", sub: "user-uuid", iss: config.issuer, aud: ["another-client"], exp: 2_000_000_000 };
    state.tokens.subject = { active: true, client_id: "jianji-client-id", username: "alice", sub: "other-user", iss: config.issuer, aud: ["jianji-client-id"], exp: 2_000_000_000 };
    state.tokens.issuer = { active: true, client_id: "jianji-client-id", username: "alice", sub: "user-uuid", iss: "https://wrong-casdoor.example", aud: ["jianji-client-id"], exp: 2_000_000_000 };
    state.tokens.client = { active: true, client_id: "other-client", username: "alice", sub: "user-uuid", iss: config.issuer, aud: ["jianji-client-id"], exp: 2_000_000_000 };
    state.tokens.expired = { active: true, client_id: "jianji-client-id", username: "alice", sub: "user-uuid", iss: config.issuer, aud: ["jianji-client-id"], exp: Date.parse(state.now) / 1000 };
    state.tokens.notYetValid = { active: true, client_id: "jianji-client-id", username: "alice", sub: "user-uuid", iss: config.issuer, aud: ["jianji-client-id"], exp: 2_000_000_000, nbf: Date.parse(state.now) / 1000 + 1 };

    expect(await status(base, "audience")).toMatchObject({ state: "denied", reason: "session-expired" });
    expect(await status(base, "subject")).toMatchObject({ state: "denied", reason: "session-expired" });
    expect(await status(base, "issuer")).toMatchObject({ state: "denied", reason: "session-expired" });
    expect(await status(base, "client")).toMatchObject({ state: "denied", reason: "session-expired" });
    expect(await status(base, "expired")).toMatchObject({ state: "denied", reason: "session-expired" });
    expect(await status(base, "notYetValid")).toMatchObject({ state: "denied", reason: "session-expired" });
    state.user.owner = "other-org";
    expect(await status(base)).toMatchObject({ state: "denied", reason: "session-expired" });
  });

  it("requires live introspection so a second login revokes the first token immediately", async () => {
    const { state, base, config } = await fixture({ createdTime: "2024-01-31T12:00:00.000Z", now: "2024-02-01T00:00:00.000Z" });
    state.tokens.first = { active: false };
    state.tokens.second = { active: true, client_id: "jianji-client-id", username: "alice", sub: "user-uuid", iss: config.issuer, aud: ["jianji-client-id"], exp: 2_000_000_000 };
    expect(await status(base, "first")).toMatchObject({ state: "denied", reason: "session-expired" });
    expect(await status(base, "second")).toMatchObject({ state: "allowed", reason: "trial", expiresAt: "2024-02-29T12:00:00.000Z" });
    expect(state.requests.filter((request) => request.path === "/api/login/oauth/introspect")).toHaveLength(2);
  });

  it("fails closed when exclusive sign-in or the single-session application setting is unavailable", async () => {
    const { state, base } = await fixture({ createdTime: "2020-01-01T00:00:00.000Z" });
    state.application.enableExclusiveSignin = false;
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.application.enableExclusiveSignin = true;
    state.application.maxSessions = 2;
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.application.maxSessions = 1;
    state.application.clientId = "other-client";
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.application.clientId = "jianji-client-id";
    state.application.organization = "other-org";
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
  });

  it("grants exactly one UTC calendar month and denies at the exclusive expiry boundary", async () => {
    const { state, base } = await fixture({ createdTime: "2024-01-31T12:00:00.000Z", now: "2024-02-29T11:59:59.999Z" });
    expect(await status(base)).toMatchObject({ state: "allowed", reason: "trial", expiresAt: "2024-02-29T12:00:00.000Z" });
    state.now = "2024-02-29T12:00:00.000Z";
    expect(await status(base)).toMatchObject({ state: "denied", reason: "expired" });
    expect(addUtcCalendarMonthClamped(new Date("2025-01-31T05:06:07.000Z")).toISOString()).toBe("2025-02-28T05:06:07.000Z");
    expect(addUtcCalendarMonthClamped(new Date("2024-01-31T05:06:07.000Z")).toISOString()).toBe("2024-02-29T05:06:07.000Z");
  });

  it("recognizes active paid and admin grant subscriptions while ignoring other states and plans", async () => {
    const { state, base } = await fixture({ createdTime: "2020-01-01T00:00:00.000Z" });
    const cases: Array<{ subscription: JsonObject; result: string }> = [
      { subscription: subscription("jianji-monthly"), result: "monthly" },
      { subscription: subscription("jianji-yearly"), result: "yearly" },
      { subscription: subscription("jianji-grant", { payment: "" }), result: "grant" },
      { subscription: subscription("jianji-monthly", { state: "Suspended" }), result: "expired" },
      { subscription: subscription("jianji-monthly", { state: "Expired" }), result: "expired" },
      { subscription: subscription("jianji-monthly", { startTime: "2024-03-01T00:00:00.000Z" }), result: "expired" },
      { subscription: subscription("jianji-grant", { payment: "payment-1" }), result: "expired" },
      { subscription: subscription("jianji-monthly", { payment: "" }), result: "expired" },
      { subscription: subscription("other-plan"), result: "expired" },
      { subscription: subscription("jianji-yearly", { owner: "other-org" }), result: "expired" },
      { subscription: subscription("jianji-monthly", { user: "bob" }), result: "expired" },
    ];
    for (const current of cases) {
      state.subscriptions = [current.subscription];
      expect((await status(base)).reason).toBe(current.result);
    }
    state.subscriptions = [subscription("jianji-monthly"), subscription("jianji-grant", { payment: "" })];
    expect(await status(base)).toMatchObject({ state: "allowed", reason: "grant" });
  });

  it("validates current pricing, enabled plan prices, and the referenced product before paid access", async () => {
    const { state, base } = await fixture({ createdTime: "2020-01-01T00:00:00.000Z" });
    state.subscriptions = [subscription("jianji-monthly")];
    expect(await status(base)).toMatchObject({ state: "allowed", reason: "monthly" });
    expect(state.requests.slice(-4).map((request) => request.path)).toEqual([
      "/api/get-subscriptions",
      "/api/get-pricing",
      "/api/get-plan",
      "/api/get-product",
    ]);
    const byPath = state.requests.map((request) => request.path);
    expect(byPath).toContain("/api/get-pricing");
    expect(new URLSearchParams(new URL(state.requests.find((request) => request.path === "/api/get-plan")!.url, "http://fixture").search).get("id")).toBe("jianji-org/jianji-monthly");
    expect(new URLSearchParams(new URL(state.requests.find((request) => request.path === "/api/get-product")!.url, "http://fixture").search).get("id")).toBe("jianji-org/product-monthly");

    state.pricing.application = "other-app";
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.pricing.application = "jianji-desktop";
    state.pricing.isEnabled = false;
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.pricing.isEnabled = true;
    state.pricing.plans = ["jianji-yearly"];
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.pricing.plans = ["jianji-monthly", "jianji-yearly"];
    state.plans["jianji-monthly"].isEnabled = false;
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.plans["jianji-monthly"].isEnabled = true;
    state.plans["jianji-monthly"].price = 99;
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.plans["jianji-monthly"].price = 100;
    state.products["product-monthly"].currency = "USD";
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.products["product-monthly"].currency = "CNY";
    state.products["product-monthly"].price = 99;
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.products["product-monthly"].price = 100;
    state.plans["jianji-monthly"].product = "unsafe/name";
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });

    state.subscriptions = [subscription("jianji-yearly")];
    state.plans["jianji-monthly"].product = "product-monthly";
    state.plans["jianji-yearly"].period = "Monthly";
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.plans["jianji-yearly"].period = "Yearly";
    state.plans["jianji-yearly"].price = 665;
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
  });

  it("applies account bans before subscriptions and never exposes upstream errors or credentials", async () => {
    const { state, base } = await fixture({ createdTime: "2020-01-01T00:00:00.000Z" });
    state.subscriptions = [subscription("jianji-yearly")];
    state.user.isForbidden = true;
    expect(await status(base)).toMatchObject({ state: "denied", reason: "forbidden" });
    expect(state.requests.some((request) => request.path === "/api/get-subscriptions")).toBe(false);

    state.user.isForbidden = false;
    state.faults["/api/login/oauth/introspect"] = { kind: "status", status: 500, body: "secret upstream body membership-server-secret-123" };
    const upstreamFailure = await status(base, "sensitive-access-token");
    expect(upstreamFailure).toMatchObject({ state: "unavailable", reason: "unavailable" });
    const responseText = JSON.stringify(upstreamFailure);
    expect(responseText).not.toContain("membership-server-secret-123");
    expect(responseText).not.toContain("sensitive-access-token");
    state.faults["/api/login/oauth/introspect"] = { kind: "redirect" };
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.faults["/api/login/oauth/introspect"] = { kind: "oversized" };
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
  });

  it("rejects malformed service config and malformed upstream identity schemas", async () => {
    const { state, base } = await fixture();
    expect(() => MembershipServerConfigSchema.parse({ serviceUrl: "http://127.0.0.1", clientSecret: "short" })).toThrow();
    delete state.user.isDeleted;
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
    state.faults["/api/get-user"] = { kind: "raw", body: "not-json" };
    expect(await status(base)).toMatchObject({ state: "unavailable", reason: "unavailable" });
  });

  it("loads strict service config only from a bounded file named by the environment", async () => {
    const { config } = await fixture();
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-membership-config-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "membership.json");
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const loaded = await membershipServerConfigFromEnvironment({ JIANJI_MEMBERSHIP_SERVER_CONFIG: configPath });
    expect(loaded?.clientId).toBe(config.clientId);
    await expect(membershipServerConfigFromEnvironment({ JIANJI_MEMBERSHIP_SERVER_CONFIG: JSON.stringify(config) })).rejects.toThrow("JIANJI_MEMBERSHIP_SERVER_CONFIG is invalid.");
  });
});

import { CasdoorClient, type ManualSubscription } from "../src/membership-server/casdoor.js";
import { ManualPayments } from "../src/membership-server/manual-payments.js";
import type { MembershipServerConfig } from "../src/membership-server/policy.js";
import { BillingPortal } from "../src/membership-server/billing.js";
import { FileBillingWriteGuard } from "../src/membership-server/billing-write-guard.js";

const config: MembershipServerConfig = { serviceUrl: "http://127.0.0.1:8789", issuer: "http://127.0.0.1:8000", clientId: "client", clientSecret: "test-secret-123456789", organization: "jianji", application: "app", pricingName: "pricing", callbackPort: 43829, monthlyPlan: "jianji-monthly", yearlyPlan: "jianji-yearly", grantPlan: "jianji-grant" };
class Fake extends CasdoorClient {
  rows = new Map<string, ManualSubscription>(); writes = 0; afterCommit = false; beforeCommit = false; banned = false; currentId = "alice-id";
  override async introspect(token: string) { return token === "invalid" ? { active: false as const } : { active: true as const, client_id: "client", username: token, sub: token === "alice" ? this.currentId : token + "-id", iss: config.issuer, aud: "client", exp: 2e10 }; }
  override async getUser(_org: string, name: string) { return { owner: "jianji", name, id: name === "alice" ? this.currentId : name + "-id", displayName: name, createdTime: "2020-01-01T00:00:00Z", isAdmin: name === "admin", isDeleted: false, isForbidden: this.banned && name === "alice" }; }
  override async getApplication() { return { owner: "admin", name: "app", organization: "jianji", clientId: "client", enableExclusiveSignin: true, maxSessions: 1 }; }
  override async getSubscriptions(_org: string, name: string) { return [...this.rows.values()].filter(r => r.user === name).map(r => structuredClone(r)); }
  override async listManualSubscriptions(name?: string) { return [...this.rows.values()].filter(r => !name || r.user === name).map(r => structuredClone(r)); }
  override async getManualSubscription(name: string) { return structuredClone(this.rows.get(name) ?? null); }
  override async getPricing() { return { owner: "jianji", name: "pricing", application: "app", isEnabled: true, plans: ["jianji-monthly", "jianji-yearly"] }; }
  override async getPlan(_org: string, name: string) { return { owner: "jianji", name, price: name === "jianji-monthly" ? 100 : 666, currency: "CNY", period: name === "jianji-monthly" ? "Monthly" : "Yearly", product: name, isEnabled: true }; }
  override async getProduct(_org: string, name: string) { return { owner: "jianji", name, price: name === "jianji-monthly" ? 100 : 666, currency: "CNY" }; }
  override async writeManualSubscription(row: ManualSubscription, create: boolean) { ++this.writes; if (this.beforeCommit) throw new Error("timeout"); if (create && this.rows.has(row.name)) throw new Error("duplicate"); this.rows.set(row.name, structuredClone(row)); if (this.afterCommit) throw new Error("timeout"); }
}
const submission = { plan: "monthly", channel: "wechat", transaction: "20261010000001" };
const approval = { action: "approve", received: true, amount: 100, note: "已核对收款账单" };
function manualFixture(now = "2024-01-31T12:00:00Z") { const api = new Fake(config); return { api, service: new ManualPayments(config, api, () => new Date(now), { run: async (_row, write) => write() }) }; }

describe("manual membership requests", () => {
  it("creates pending without entitlement and ignores no caller-supplied authority or price", async () => {
    const { service, api } = manualFixture(); const request = await service.submit("alice", submission);
    expect(request.state).toBe("pending"); expect(api.rows.get(request.id)).toMatchObject({ state: "Pending", payment: "", startTime: "", endTime: "" });
    await expect(service.submit("alice", { ...submission, amount: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(service.submit("invalid", submission)).rejects.toMatchObject({ status: 401 });
  });
  it("deduplicates retries and conceals another account's transaction", async () => {
    const { service, api } = manualFixture(); const a = await service.submit("alice", submission); const b = await service.submit("alice", submission);
    expect(a.id).toBe(b.id); expect(api.writes).toBe(1);
    await expect(service.submit("bob", submission)).rejects.toMatchObject({ status: 409 });
    expect((await service.list("bob")).requests).toEqual([]);
    await expect(service.review("alice", a.id, approval)).rejects.toMatchObject({ status: 403 });
  });
  it("requires actual amount confirmation and produces one clamped month exactly once", async () => {
    const { service, api } = manualFixture(); const a = await service.submit("alice", submission);
    await expect(service.review("admin", a.id, { ...approval, received: false })).rejects.toMatchObject({ status: 400 });
    await expect(service.review("admin", a.id, { ...approval, amount: 1 })).rejects.toMatchObject({ status: 400 });
    const [r, repeat] = await Promise.all([service.review("admin", a.id, approval), service.review("admin", a.id, approval)]);
    expect(r.endTime).toBe("2024-02-29T12:00:00.000Z"); expect(repeat.endTime).toBe(r.endTime); expect(api.writes).toBe(2);
    expect(api.rows.get(a.id)?.payment).toBe(`manual:${a.id}`);
  });
  it("serializes separate approvals for one user and extends existing end", async () => {
    const { service } = manualFixture(); const a = await service.submit("alice", submission); const b = await service.submit("alice", { ...submission, transaction: "20261010000002" });
    const results = await Promise.all([service.review("admin", a.id, approval), service.review("admin", b.id, approval)]);
    expect(results[1].startTime).toBe(results[0].endTime); expect(results[1].endTime).toBe("2024-03-29T12:00:00.000Z");
  });
  it("clamps a leap day annual term and retains rejection audit", async () => {
    const { service, api } = manualFixture("2024-02-29T00:00:00Z"); const a = await service.submit("alice", { ...submission, plan: "yearly" });
    expect((await service.review("admin", a.id, { ...approval, amount: 666 })).endTime).toBe("2025-02-28T00:00:00.000Z");
    const b = await service.submit("bob", { ...submission, transaction: "20261010000002" });
    const rejected = await service.review("admin", b.id, { action: "reject", received: false, amount: 0, note: "未查询到到账" });
    expect(rejected.state).toBe("rejected"); expect(api.rows.get(b.id)?.state).toBe("Suspended");
    await expect(service.review("admin", b.id, approval)).rejects.toMatchObject({ status: 409 });
  });
  it("never retries unknown writes and recovers a committed response by readback", async () => {
    const { service, api } = manualFixture(); api.afterCommit = true;
    const a = await service.submit("alice", submission); expect(api.writes).toBe(1);
    await service.review("admin", a.id, approval); expect(api.writes).toBe(2);
    api.beforeCommit = true;
    await expect(service.submit("alice", { ...submission, transaction: "20261010000002" })).rejects.toMatchObject({ status: 503 }); expect(api.writes).toBe(3);
  });
  it("cannot approve banned or recreated accounts", async () => {
    const { service, api } = manualFixture(); const a = await service.submit("alice", submission); api.banned = true;
    await expect(service.review("admin", a.id, approval)).rejects.toMatchObject({ status: 409 });
    api.banned = false; api.currentId = "replacement-id";
    await expect(service.review("admin", a.id, approval)).rejects.toMatchObject({ status: 409 });
    expect((await service.list("alice")).requests).toEqual([]);
  });
  it("refuses offset-less dates in prior grants instead of extending a guessed date", async () => {
    const { service, api } = manualFixture(); const a = await service.submit("alice", submission);
    api.rows.set("grant", { ...api.rows.get(a.id)!, name: "grant", plan: config.grantPlan, payment: "", state: "Active", startTime: "2024-01-01 00:00:00", endTime: "2024-03-01 00:00:00" });
    await expect(service.review("admin", a.id, approval)).rejects.toMatchObject({ status: 409 });
  });
  it("persists unknown-write fencing across restarts and never retries the unresolved mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "billing-guard-")); temporaryDirectories.push(root);
    const api = new Fake(config); const clock = () => new Date("2024-01-31T12:00:00Z");
    const service = new ManualPayments(config, api, clock, new FileBillingWriteGuard(root));
    const first = await service.submit("alice", submission); expect(first.state).toBe("pending");
    api.beforeCommit = true;
    await expect(service.review("admin", first.id, approval)).rejects.toMatchObject({ status: 503 });
    expect(api.writes).toBe(2); api.beforeCommit = false;
    const restarted = new ManualPayments(config, api, clock, new FileBillingWriteGuard(root));
    await expect(restarted.review("admin", first.id, approval)).rejects.toMatchObject({ status: 503 });
    await expect(restarted.submit("bob", { ...submission, transaction: "20261010000002" })).rejects.toMatchObject({ status: 503 });
    expect(api.writes).toBe(2);
    expect((await restarted.list("alice")).requests[0].state).toBe("pending");
  });
});

describe("billing browser transport", () => {
  it("requires single-use tickets, same origin and session CSRF; never exposes upstream tokens", async () => {
    const { service } = manualFixture();
    let portal: BillingPortal;
    const server = createServer((req, res) => { void portal.handle(req, res); });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const address = server.address(); if (!address || typeof address === "string") throw new Error();
    const origin = `http://127.0.0.1:${address.port}`;
    portal = new BillingPortal({ ...config, serviceUrl: origin }, "/absent-test-assets", service);
    const post = (route: string, body: unknown, cookie = "", csrf = "", source = origin) => fetch(origin + route, { method: "POST", headers: { "Content-Type": "application/json", Origin: source, Cookie: cookie, "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    try {
      expect((await fetch(origin + "/billing/requests")).status).toBe(401);
      const ticketReply = await fetch(origin + "/billing/ticket", { method: "POST", headers: { Authorization: "Bearer alice" } });
      const { ticket } = await ticketReply.json(); expect(ticket).toMatch(/^[a-f0-9]{64}$/);
      expect((await post("/billing/session", { ticket }, "", "", "https://evil.example")).status).toBe(403);
      const sessionReply = await post("/billing/session", { ticket });
      const cookie = sessionReply.headers.get("set-cookie")!.split(";")[0];
      expect(sessionReply.headers.get("set-cookie")).toContain("HttpOnly");
      expect((await post("/billing/session", { ticket })).status).toBe(401);
      const list = await fetch(origin + "/billing/requests", { headers: { Cookie: cookie } });
      const body = await list.json(); expect(body.user.name).toBe("alice"); expect(body).not.toHaveProperty("token");
      expect((await post("/billing/requests", submission, cookie)).status).toBe(403);
      // Valid authentication still fails closed when the deployment lacks payment images.
      expect((await post("/billing/requests", submission, cookie, body.csrf)).status).toBe(503);
      expect((await post("/billing/logout", {}, cookie, body.csrf)).status).toBe(200);
      expect((await fetch(origin + "/billing/requests", { headers: { Cookie: cookie } })).status).toBe(401);
      const page = await fetch(origin + "/billing"); expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    } finally { await new Promise<void>(r => { server.close(() => r()); server.closeAllConnections(); }); }
  });
});
