import { z } from "zod";

export const MEMBERSHIP_OFFERS = [
  { id: "monthly", label: "月度会员", price: 100, currency: "CNY", period: "Monthly" },
  { id: "yearly", label: "年度会员", price: 666, currency: "CNY", period: "Yearly" },
] as const;
export const MEMBERSHIP_HEARTBEAT_MS = 30_000;
export const MembershipStatusSchema = z.object({
  state: z.enum(["local-development", "unconfigured", "signed-out", "signing-in", "allowed", "denied", "unavailable"]),
  reason: z.enum(["local-development", "unconfigured", "signed-out", "signing-in", "trial", "monthly", "yearly", "grant", "expired", "forbidden", "session-expired", "unavailable"]),
  message: z.string().max(300),
  user: z.object({ id: z.string().min(1), name: z.string().min(1), displayName: z.string(), isAdmin: z.boolean() }).strict().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  checkedAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;

export function membershipUrl(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("账号服务地址必须为 HTTPS origin；本地调试仅允许 loopback HTTP。");
  }
  return url.origin;
}
const origin = z.string().url().transform(membershipUrl);
const name = z.string().min(1).max(100).regex(/^[\w.-]+$/);
export const MembershipConfigSchema = z.object({
  serviceUrl: origin,
  issuer: origin,
  clientId: z.string().min(1).max(200),
  organization: name,
  application: name,
  pricingName: name,
  callbackPort: z.number().int().min(1024).max(65535).default(43829),
}).strict();
export type MembershipConfig = z.infer<typeof MembershipConfigSchema>;

export const signedOutMembership = (): MembershipStatus => ({ state: "signed-out", reason: "signed-out", message: "请登录简辑账号。新账号可免费试用一个月。" });
