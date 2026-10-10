import { open } from "node:fs/promises";
import { z } from "zod";
import { MembershipConfigSchema, MembershipStatusSchema, type MembershipStatus } from "../shared/membership.js";
import { CasdoorClient, type CasdoorMembershipApi, type CasdoorSubscription, type CasdoorUser } from "./casdoor.js";
import type { GoogleTrialStore } from "./google-trial.js";

export const MembershipServerConfigSchema = MembershipConfigSchema.extend({
  clientSecret: z.string().min(16).max(512),
  monthlyPlan: z.literal("jianji-monthly"),
  yearlyPlan: z.literal("jianji-yearly"),
  grantPlan: z.literal("jianji-grant"),
}).strict();

export type MembershipServerConfig = z.infer<typeof MembershipServerConfigSchema>;

const MAX_CONFIG_BYTES = 64 * 1024;

export async function membershipServerConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<MembershipServerConfig | null> {
  const configPath = env.JIANJI_MEMBERSHIP_SERVER_CONFIG;
  if (!configPath) return null;
  let file;
  try {
    file = await open(configPath, "r");
    const metadata = await file.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || metadata.size > MAX_CONFIG_BYTES) throw new Error("Configuration file is invalid.");
    const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_CONFIG_BYTES) throw new Error("Configuration file is too large.");
    return MembershipServerConfigSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")) as unknown);
  } catch {
    throw new Error("JIANJI_MEMBERSHIP_SERVER_CONFIG is invalid.");
  } finally {
    await file?.close().catch(() => undefined);
  }
}

export async function resolveMembershipStatus(
  accessToken: string,
  config: MembershipServerConfig,
  options: { fetcher?: typeof fetch; clock?: () => Date; api?: CasdoorMembershipApi; trials?: GoogleTrialStore } = {},
): Promise<MembershipStatus> {
  const now = options.clock?.() ?? new Date();
  const checkedAt = now.toISOString();
  const api = options.api ?? new CasdoorClient(config, options.fetcher);

  let token;
  try {
    token = await api.introspect(accessToken);
  } catch {
    return unavailable(checkedAt);
  }
  if (!token.active) return denied("session-expired", "登录已失效，请重新登录。", checkedAt);
  const currentSeconds = now.getTime() / 1000;
  const aud = Array.isArray(token.aud) ? token.aud : [token.aud];
  if (token.client_id !== config.clientId || token.iss !== config.issuer || !aud.includes(config.clientId) || token.exp <= currentSeconds || (token.nbf !== undefined && token.nbf > currentSeconds)) {
    return denied("session-expired", "登录已失效，请重新登录。", checkedAt);
  }

  let user: CasdoorUser;
  try {
    user = await api.getUser(config.organization, token.username);
  } catch {
    return unavailable(checkedAt);
  }
  if (user.owner !== config.organization || user.name !== token.username || user.id !== token.sub) {
    return denied("session-expired", "账号身份校验失败，请重新登录。", checkedAt);
  }
  if (user.isForbidden || user.isDeleted) return denied("forbidden", "此账号已被停用。", checkedAt, user);

  let application;
  try {
    application = await api.getApplication(config.application);
  } catch {
    return unavailable(checkedAt);
  }
  if (
    application.owner !== "admin" ||
    application.name !== config.application ||
    application.organization !== config.organization ||
    application.clientId !== config.clientId ||
    !application.enableExclusiveSignin ||
    application.maxSessions !== 1
  ) return unavailable(checkedAt);

  let subscriptions: CasdoorSubscription[];
  try {
    subscriptions = await api.getSubscriptions(config.organization, token.username);
  } catch {
    return unavailable(checkedAt);
  }

  const principal = { id: token.sub, name: user.name, displayName: user.displayName || user.name, isAdmin: user.isAdmin };
  try {
    const entitlements = findActiveEntitlements(subscriptions, config, token.username, now);
    const grants = entitlements.filter((entry) => entry.reason === "grant");
    const grant = selectEntitlement(grants);
    if (grant) return allowed(grant, principal, checkedAt);

    const paid = entitlements.filter((entry) => entry.reason !== "grant");
    if (paid.length > 0) {
      const pricing = await api.getPricing(config.organization, config.pricingName);
      if (pricing.owner !== config.organization || pricing.name !== config.pricingName || pricing.application !== config.application || !pricing.isEnabled) return unavailable(checkedAt);
      for (const planName of new Set(paid.map((entry) => entry.reason === "monthly" ? config.monthlyPlan : config.yearlyPlan))) {
        const reason = planName === config.monthlyPlan ? "monthly" : "yearly";
        const valid = await validatePaidPlan(api, config, pricing.plans, planName, reason);
        if (!valid) return unavailable(checkedAt);
      }
      const entitlement = selectEntitlement(paid);
      if (entitlement) return allowed(entitlement, principal, checkedAt);
    }

    if (user.google && !options.trials) return unavailable(checkedAt);
    const expiresAt = options.trials?.claim(user, now);
    if (expiresAt) {
      return MembershipStatusSchema.parse({
        state: "allowed",
        reason: "trial",
        message: `Google 账号的 3 天免费试用有效至 ${expiresAt}。`,
        user: principal,
        expiresAt,
        checkedAt,
      });
    }
    return denied("expired", user.google ? "试用已领取或已到期，请续费。" : "请关联 Google 账号领取一次 3 天试用，或续费会员。", checkedAt, user);
  } catch {
    return unavailable(checkedAt);
  }
}

export function addUtcCalendarMonthClamped(start: Date): Date {
  const end = new Date(start.getTime());
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = (month + 1) % 12;
  const daysInNextMonth = new Date(0);
  daysInNextMonth.setUTCFullYear(nextYear, nextMonth + 1, 0);
  const day = Math.min(start.getUTCDate(), daysInNextMonth.getUTCDate());
  end.setUTCFullYear(nextYear, nextMonth, day);
  return end;
}

type ActiveEntitlement = { reason: "monthly" | "yearly" | "grant"; expiresAt: string; endTime: number };

function findActiveEntitlements(subscriptions: CasdoorSubscription[], config: MembershipServerConfig, username: string, now: Date): ActiveEntitlement[] {
  const plans = new Map<string, "monthly" | "yearly" | "grant">([
    [config.monthlyPlan, "monthly"],
    [config.yearlyPlan, "yearly"],
    [config.grantPlan, "grant"],
  ]);
  const eligible = subscriptions.flatMap((subscription) => {
    if (subscription.owner !== config.organization || subscription.user !== username) return [];
    const reason = plans.get(subscription.plan);
    if (!reason || subscription.state !== "Active") return [];
    if (reason === "grant" ? subscription.payment !== "" : subscription.payment.length === 0) return [];
    const startTime = parseSubscriptionTime(subscription.startTime);
    const endTime = parseSubscriptionTime(subscription.endTime);
    if (startTime > now.getTime() || endTime <= now.getTime()) return [];
    return [{ reason, endTime, expiresAt: new Date(endTime).toISOString() }];
  });
  return eligible.sort((left, right) => right.endTime - left.endTime || entitlementPriority(right.reason) - entitlementPriority(left.reason));
}

function selectEntitlement(entitlements: ActiveEntitlement[]): ActiveEntitlement | undefined {
  return [...entitlements].sort((left, right) => right.endTime - left.endTime || entitlementPriority(right.reason) - entitlementPriority(left.reason))[0];
}

export async function validatePaidPlan(
  api: CasdoorMembershipApi,
  config: MembershipServerConfig,
  pricingPlans: string[],
  planName: string,
  reason: "monthly" | "yearly",
): Promise<boolean> {
  const monthly = reason === "monthly";
  const price = monthly ? 100 : 666;
  const period = monthly ? "Monthly" : "Yearly";
  if (!pricingPlans.includes(planName)) return false;
  const plan = await api.getPlan(config.organization, planName);
  if (
    plan.owner !== config.organization ||
    plan.name !== planName ||
    plan.price !== price ||
    plan.currency !== "CNY" ||
    plan.period !== period ||
    !plan.isEnabled ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(plan.product)
  ) return false;
  const product = await api.getProduct(config.organization, plan.product);
  return product.owner === config.organization && product.name === plan.product && product.price === price && product.currency === "CNY";
}

function allowed(entitlement: ActiveEntitlement, user: { id: string; name: string; displayName: string; isAdmin: boolean }, checkedAt: string): MembershipStatus {
  return MembershipStatusSchema.parse({
    state: "allowed",
    reason: entitlement.reason,
    message: `使用权限有效至 ${entitlement.expiresAt}。`,
    user,
    expiresAt: entitlement.expiresAt,
    checkedAt,
  });
}

function parseSubscriptionTime(value: string): number {
  if (!z.string().datetime({ offset: true }).safeParse(value).success) throw new Error("Invalid subscription time.");
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error("Invalid subscription time.");
  return time;
}

function entitlementPriority(reason: "monthly" | "yearly" | "grant"): number {
  return reason === "grant" ? 3 : reason === "yearly" ? 2 : 1;
}

function denied(reason: "expired" | "forbidden" | "session-expired", message: string, checkedAt: string, user?: CasdoorUser): MembershipStatus {
  return MembershipStatusSchema.parse({
    state: "denied",
    reason,
    message,
    ...(user ? { user: { id: user.id, name: user.name, displayName: user.displayName || user.name, isAdmin: user.isAdmin } } : {}),
    checkedAt,
  });
}

function unavailable(checkedAt: string): MembershipStatus {
  return MembershipStatusSchema.parse({ state: "unavailable", reason: "unavailable", message: "账号服务暂不可用，请稍后重试。", checkedAt });
}
