import { z } from "zod";
import type { MembershipServerConfig } from "./policy.js";

const ActiveTokenIntrospectionSchema = z.object({
  active: z.literal(true),
  client_id: z.string().min(1),
  username: z.string().min(1),
  sub: z.string().min(1),
  iss: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  exp: z.number().finite(),
  nbf: z.number().finite().optional(),
});
const InactiveTokenIntrospectionSchema = z.object({ active: z.literal(false) });

const CasdoorUserSchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string(),
  createdTime: z.string().datetime({ offset: true }),
  isAdmin: z.boolean(),
  isForbidden: z.boolean(),
  isDeleted: z.boolean(),
});

const CasdoorApplicationSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  organization: z.string().min(1),
  clientId: z.string().min(1),
  enableExclusiveSignin: z.boolean(),
  maxSessions: z.number().int().nonnegative(),
});

const CasdoorPricingSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  application: z.string().min(1),
  isEnabled: z.boolean(),
  plans: z.array(z.string()),
});

const CasdoorPlanSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  price: z.number().finite(),
  currency: z.string(),
  period: z.string(),
  product: z.string(),
  isEnabled: z.boolean(),
});

const CasdoorProductSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  price: z.number().finite(),
  currency: z.string(),
});

const CasdoorSubscriptionSchema = z.object({
  owner: z.string(),
  user: z.string(),
  plan: z.string(),
  state: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  payment: z.string(),
});

export const ManualSubscriptionSchema = CasdoorSubscriptionSchema.extend({
  name: z.string().min(1), createdTime: z.string(), displayName: z.string(), description: z.string(),
  group: z.string(), pricing: z.string(), period: z.string(),
});
export type ManualSubscription = z.infer<typeof ManualSubscriptionSchema>;

export type TokenIntrospection = z.infer<typeof ActiveTokenIntrospectionSchema> | z.infer<typeof InactiveTokenIntrospectionSchema>;
export type CasdoorUser = z.infer<typeof CasdoorUserSchema>;
export type CasdoorApplication = z.infer<typeof CasdoorApplicationSchema>;
export type CasdoorPricing = z.infer<typeof CasdoorPricingSchema>;
export type CasdoorPlan = z.infer<typeof CasdoorPlanSchema>;
export type CasdoorProduct = z.infer<typeof CasdoorProductSchema>;
export type CasdoorSubscription = z.infer<typeof CasdoorSubscriptionSchema>;

export interface CasdoorMembershipApi {
  introspect(accessToken: string): Promise<TokenIntrospection>;
  getUser(organization: string, username: string): Promise<CasdoorUser>;
  getApplication(application: string): Promise<CasdoorApplication>;
  getPricing(organization: string, pricing: string): Promise<CasdoorPricing>;
  getPlan(organization: string, plan: string): Promise<CasdoorPlan>;
  getProduct(organization: string, product: string): Promise<CasdoorProduct>;
  getSubscriptions(organization: string, username: string): Promise<CasdoorSubscription[]>;
}

const MAX_RESPONSE_BYTES = 512 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

export class CasdoorClient implements CasdoorMembershipApi {
  constructor(private readonly config: MembershipServerConfig, private readonly fetcher: typeof fetch = fetch) {}

  async listManualSubscriptions(username?: string): Promise<ManualSubscription[]> {
    const url = this.apiUrl("/api/get-subscriptions");
    url.searchParams.set("owner", this.config.organization);
    if (username) { url.searchParams.set("field", "user"); url.searchParams.set("value", username); }
    return z.array(ManualSubscriptionSchema).parse(await this.getData(url));
  }

  async getManualSubscription(name: string): Promise<ManualSubscription | null> {
    const url = this.apiUrl("/api/get-subscription");
    url.searchParams.set("id", `${this.config.organization}/${name}`);
    return ManualSubscriptionSchema.nullable().parse(await this.getData(url));
  }

  async writeManualSubscription(value: ManualSubscription, create: boolean): Promise<void> {
    const url = this.apiUrl(create ? "/api/add-subscription" : "/api/update-subscription");
    if (!create) url.searchParams.set("id", `${this.config.organization}/${value.name}`);
    const payload = await this.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    z.object({ status: z.literal("ok"), data: z.literal(true) }).parse(payload);
  }

  async introspect(accessToken: string): Promise<TokenIntrospection> {
    const body = new URLSearchParams({ token: accessToken, token_type_hint: "access_token" });
    const payload = await this.request("/api/login/oauth/introspect", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const record = z.object({ active: z.boolean() }).parse(payload);
    return record.active ? ActiveTokenIntrospectionSchema.parse(payload) : InactiveTokenIntrospectionSchema.parse(payload);
  }

  async getUser(organization: string, username: string): Promise<CasdoorUser> {
    const url = this.apiUrl("/api/get-user");
    url.searchParams.set("id", `${organization}/${username}`);
    return CasdoorUserSchema.parse(await this.getData(url));
  }

  async getApplication(application: string): Promise<CasdoorApplication> {
    const url = this.apiUrl("/api/get-application");
    url.searchParams.set("id", `admin/${application}`);
    return CasdoorApplicationSchema.parse(await this.getData(url));
  }

  async getPricing(organization: string, pricing: string): Promise<CasdoorPricing> {
    const url = this.apiUrl("/api/get-pricing");
    url.searchParams.set("id", `${organization}/${pricing}`);
    return CasdoorPricingSchema.parse(await this.getData(url));
  }

  async getPlan(organization: string, plan: string): Promise<CasdoorPlan> {
    const url = this.apiUrl("/api/get-plan");
    url.searchParams.set("id", `${organization}/${plan}`);
    return CasdoorPlanSchema.parse(await this.getData(url));
  }

  async getProduct(organization: string, product: string): Promise<CasdoorProduct> {
    const url = this.apiUrl("/api/get-product");
    url.searchParams.set("id", `${organization}/${product}`);
    return CasdoorProductSchema.parse(await this.getData(url));
  }

  async getSubscriptions(organization: string, username: string): Promise<CasdoorSubscription[]> {
    const url = this.apiUrl("/api/get-subscriptions");
    url.searchParams.set("owner", organization);
    url.searchParams.set("field", "user");
    url.searchParams.set("value", username);
    const data = await this.getData(url);
    return z.array(CasdoorSubscriptionSchema).parse(data);
  }

  private apiUrl(path: string): URL {
    return new URL(path, this.config.issuer);
  }

  private async getData(url: URL): Promise<unknown> {
    const payload = await this.request(url, { method: "GET" });
    const envelope = z.object({ status: z.literal("ok"), data: z.unknown() }).parse(payload);
    return envelope.data;
  }

  private async request(pathOrUrl: string | URL, init: RequestInit): Promise<unknown> {
    const url = typeof pathOrUrl === "string" ? this.apiUrl(pathOrUrl) : pathOrUrl;
    const response = await this.fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`, "utf8").toString("base64")}`,
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error("Casdoor request failed.");
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error("Casdoor response is too large.");
    const text = await readBoundedText(response);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Casdoor response is invalid.");
    }
  }
}

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) throw new Error("Casdoor response is empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Casdoor response is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Casdoor response is invalid.");
  }
}
