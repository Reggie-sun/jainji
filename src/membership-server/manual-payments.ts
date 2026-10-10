import { createHash } from "node:crypto";
import { z } from "zod";
import { MEMBERSHIP_OFFERS } from "../shared/membership.js";
import type { GoogleTrialStore } from "./google-trial.js";
import { CasdoorClient, type ManualSubscription } from "./casdoor.js";
import { addUtcCalendarMonthClamped, resolveMembershipStatus, validatePaidPlan, type MembershipServerConfig } from "./policy.js";
import type { BillingWriteGuard } from "./billing-write-guard.js";

const submission = z.object({
  plan: z.enum(["monthly", "yearly"]), channel: z.enum(["wechat", "alipay"]),
  transaction: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
const audit = z.object({ action: z.enum(["approve", "reject"]), by: z.string(), at: z.string().datetime(), note: z.string(), amount: z.number() });
const description = submission.extend({ kind: z.literal("jianji-manual-v1"), userId: z.string(), amount: z.number(), audit: audit.optional() }).strict();
export type ManualRequest = ReturnType<ManualPayments["view"]>;
export class BillingError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Casdoor Subscription remains the sole durable request and entitlement record. One service writer. */
export class ManualPayments {
  private readonly locks = new Map<string, Promise<unknown>>();
  constructor(readonly config: MembershipServerConfig, readonly api: CasdoorClient, readonly clock: () => Date, private readonly guard: BillingWriteGuard, private readonly trials?: GoogleTrialStore) {}

  async principal(token: string) {
    const status = await resolveMembershipStatus(token, this.config, { api: this.api, clock: this.clock, trials: this.trials });
    if (!status.user || !(status.state === "allowed" || status.reason === "expired")) throw new BillingError(401, "登录已失效或账号不可用，请重新登录。");
    return status.user;
  }

  view(row: ManualSubscription) {
    const data = description.parse(JSON.parse(row.description));
    const offer = MEMBERSHIP_OFFERS.find(o => o.id === data.plan)!;
    if (row.owner !== this.config.organization || row.group !== "" || row.pricing !== this.config.pricingName || row.plan !== (data.plan === "monthly" ? this.config.monthlyPlan : this.config.yearlyPlan) || data.amount !== offer.price || row.name !== this.name(data.channel, data.transaction)) throw new BillingError(409, "申请记录不匹配，请联系管理员。");
    return { id: row.name, user: row.user, userId: data.userId, plan: data.plan, channel: data.channel, transaction: data.transaction, amount: data.amount,
      submittedAt: row.createdTime, state: data.audit?.action === "approve" ? "approved" : data.audit?.action === "reject" ? "rejected" : "pending",
      startTime: row.startTime, endTime: row.endTime, audit: data.audit };
  }

  async list(token: string) {
    const user = await this.principal(token);
    const rows = await this.api.listManualSubscriptions(user.isAdmin ? undefined : user.name);
    const requests = rows.filter(r => r.name.startsWith("manual_") && r.owner === this.config.organization)
      .map(r => this.view(r)).filter(r => user.isAdmin || (r.user === user.name && r.userId === user.id));
    return { user, requests };
  }

  async submit(token: string, input: unknown) {
    const parsed = submission.safeParse(input);
    if (!parsed.success) throw new BillingError(400, "请选择套餐、付款渠道并填写完整付款单号（8–80 位字母或数字）。");
    const data = parsed.data, user = await this.principal(token);
    const name = this.name(data.channel, data.transaction);
    return this.serial(`user:${user.name}`, async () => {
      const existing = await this.api.getManualSubscription(name);
      if (existing) {
        const found = this.view(existing);
        if (found.userId !== user.id || found.user !== user.name || found.plan !== data.plan) throw new BillingError(409, "该付款单号已有申请，请联系管理员核对。");
        return found;
      }
      const mine = await this.api.listManualSubscriptions(user.name);
      if (mine.filter(r => r.state === "Pending" && r.name.startsWith("manual_")).length >= 10) throw new BillingError(429, "待审核申请较多，请先等待管理员处理。");
      const offer = MEMBERSHIP_OFFERS.find(o => o.id === data.plan)!;
      const row: ManualSubscription = {
        owner: this.config.organization, name, user: user.name, group: "", pricing: this.config.pricingName,
        plan: data.plan === "monthly" ? this.config.monthlyPlan : this.config.yearlyPlan, period: offer.period,
        createdTime: this.clock().toISOString(), displayName: `${offer.label} · 人工核款`,
        description: JSON.stringify({ ...data, kind: "jianji-manual-v1", userId: user.id, amount: offer.price }),
        state: "Pending", payment: "", startTime: "", endTime: "",
      };
      await this.writeOnce(row, true);
      return this.view(row);
    });
  }

  async review(token: string, name: string, input: unknown) {
    const parsed = z.object({ action: z.enum(["approve", "reject"]), received: z.boolean(), amount: z.number().finite(), note: z.string().trim().min(1).max(200) }).strict().safeParse(input);
    if (!parsed.success || !/^manual_[a-f0-9]{64}$/.test(name)) throw new BillingError(400, "请填写审核说明和核对金额。");
    const admin = await this.principal(token);
    if (!admin.isAdmin) throw new BillingError(403, "需要管理员账号。");
    const initial = await this.api.getManualSubscription(name);
    if (!initial) throw new BillingError(404, "申请不存在。");
    return this.serial(`user:${initial.user}`, async () => {
      // Recheck authority inside the serialized operation, after any waiting.
      if (!(await this.principal(token)).isAdmin) throw new BillingError(403, "需要管理员账号。");
      const row = await this.api.getManualSubscription(name);
      if (!row || row.user !== initial.user) throw new BillingError(409, "申请已变化，请刷新。");
      const request = this.view(row), decision = parsed.data;
      if (request.audit) {
        if (request.audit.action !== decision.action) throw new BillingError(409, "申请已处理，不可重复改变决定。");
        return request;
      }
      if (row.state !== "Pending" || row.payment) throw new BillingError(409, "申请已被修改，请在后台核对。");
      const user = await this.api.getUser(this.config.organization, row.user);
      if (user.id !== request.userId || user.owner !== this.config.organization || user.name !== row.user || user.isDeleted) throw new BillingError(409, "申请账号已变化，不能开通。");
      if (decision.action === "approve") {
        if (user.isForbidden) throw new BillingError(409, "账号已停用，不能开通。");
        if (!decision.received || decision.amount !== request.amount) throw new BillingError(400, "必须确认实际到账且金额与套餐一致。");
        const pricing = await this.api.getPricing(this.config.organization, this.config.pricingName);
        if (pricing.owner !== this.config.organization || pricing.name !== this.config.pricingName || pricing.application !== this.config.application || !pricing.isEnabled || !await validatePaidPlan(this.api, this.config, pricing.plans, row.plan, request.plan)) throw new BillingError(409, "套餐配置异常，不能开通。");
        const now = this.clock();
        const trialExpiry = this.trials?.expiry(user, now);
        let start = Math.max(now.getTime(), trialExpiry ? Date.parse(trialExpiry) : now.getTime());
        for (const sub of await this.api.listManualSubscriptions(user.name)) {
          if (sub.owner !== this.config.organization || sub.user !== user.name || sub.group !== "" || !["Active", "Upcoming"].includes(sub.state)) continue;
          if (!new Set<string>([this.config.monthlyPlan, this.config.yearlyPlan, this.config.grantPlan]).has(sub.plan)) continue;
          if (sub.plan === this.config.grantPlan ? sub.payment !== "" : !sub.payment) continue;
          if (!z.string().datetime({ offset: true }).safeParse(sub.endTime).success || !z.string().datetime({ offset: true }).safeParse(sub.startTime).success) throw new BillingError(409, "已有订阅日期缺少明确时区，请先在后台核对。");
          const end = Date.parse(sub.endTime), begin = Date.parse(sub.startTime);
          if (!Number.isFinite(end) || !Number.isFinite(begin) || end <= begin) throw new BillingError(409, "已有订阅日期异常，请先在后台核对。");
          start = Math.max(start, end);
        }
        const begin = new Date(start);
        const end = request.plan === "monthly" ? addUtcCalendarMonthClamped(begin) : addYear(begin);
        row.startTime = begin.toISOString(); row.endTime = end.toISOString(); row.state = "Active";
        row.payment = `manual:${name}`;
      } else { row.state = "Suspended"; }
      const data = description.parse(JSON.parse(row.description));
      row.description = JSON.stringify({ ...data, audit: { action: decision.action, by: admin.id, at: this.clock().toISOString(), note: decision.note, amount: decision.amount } });
      await this.writeOnce(row, false);
      return this.view(row);
    });
  }

  private name(channel: string, transaction: string) { return `manual_${createHash("sha256").update(`${channel}:${transaction}`).digest("hex")}`; }
  private async writeOnce(row: ManualSubscription, create: boolean) {
    try {
      await this.guard.run(row, async () => {
        try { await this.api.writeManualSubscription(row, create); }
        catch {
          // An upstream timeout can mean committed. Read only; never repeat the mutation blindly.
          const actual = await this.api.getManualSubscription(row.name).catch(() => null);
          if (!actual || actual.description !== row.description || actual.user !== row.user || actual.payment !== row.payment || actual.startTime !== row.startTime || actual.endTime !== row.endTime || (actual.state !== row.state && !(row.state === "Active" && actual.state === "Upcoming"))) throw new Error("Unconfirmed write.");
        }
      });
    } catch { throw new BillingError(503, "写入暂不可用或结果尚未确认。请刷新查看，勿重复付款；管理员需核对服务写入记录后恢复。"); }
  }
  private async serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(work); this.locks.set(key, current);
    try { return await current; } finally { if (this.locks.get(key) === current) this.locks.delete(key); }
  }
}

function addYear(start: Date): Date {
  const end = new Date(start), year = start.getUTCFullYear() + 1, month = start.getUTCMonth();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  end.setUTCFullYear(year, month, Math.min(start.getUTCDate(), days)); return end;
}
