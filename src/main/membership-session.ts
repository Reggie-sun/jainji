import { MEMBERSHIP_HEARTBEAT_MS, MembershipStatusSchema, signedOutMembership, type MembershipConfig, type MembershipStatus } from "../shared/membership.js";

export interface MembershipStorage { read(): Promise<string | undefined>; write(token?: string): Promise<void>; }
interface Dependencies {
  localDevelopment?: boolean;
  storage: MembershipStorage;
  check(token: string): Promise<MembershipStatus>;
  login(signal: AbortSignal): Promise<string>;
  changed(status: MembershipStatus): void;
  lostAccess(): Promise<void>;
}

/** The single desktop session owner. Cached status is display-only, never admission. */
export class MembershipSession {
  private status: MembershipStatus;
  private token?: string;
  private generation = 0;
  private loginController?: AbortController;
  private pendingLogin?: Promise<MembershipStatus>;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<MembershipStatus>;
  private writes = Promise.resolve();
  private stopping = Promise.resolve();
  constructor(readonly config: MembershipConfig | undefined, private readonly deps: Dependencies) {
    this.status = this.isLocalDevelopment() ? { state: "local-development", reason: "local-development", message: "本地开发模式" }
      : config ? signedOutMembership() : { state: "unconfigured", reason: "unconfigured", message: "账号服务尚未配置，请联系管理员。" };
  }
  private isLocalDevelopment(): boolean { return !this.config && this.deps.localDevelopment === true; }
  snapshot(): MembershipStatus { return structuredClone(this.status); }
  private update(next: MembershipStatus): void { this.status = next; this.deps.changed(this.snapshot()); }
  private persist(token?: string): Promise<void> {
    const next = this.writes.then(() => this.deps.storage.write(token));
    this.writes = next.catch(() => {}); return next;
  }
  async restore(): Promise<void> {
    if (!this.config) return;
    const generation = this.generation;
    this.update({ state: "signing-in", reason: "signing-in", message: "正在恢复上次登录…" });
    const token = await this.deps.storage.read().catch(() => undefined);
    if (generation !== this.generation) return;
    this.token = token;
    if (this.token) await this.refresh();
    else this.update(signedOutMembership());
  }
  login(): Promise<MembershipStatus> {
    if (this.pendingLogin) return this.pendingLogin;
    const pending = this.performLogin();
    this.pendingLogin = pending;
    void pending.finally(() => { if (this.pendingLogin === pending) this.pendingLogin = undefined; }).catch(() => {});
    return pending;
  }
  private async performLogin(): Promise<MembershipStatus> {
    if (!this.config) return this.snapshot();
    if (this.loginController) return this.snapshot();
    await this.logout();
    await this.stopping;
    const controller = new AbortController(); this.loginController = controller;
    const generation = this.generation;
    this.update({ state: "signing-in", reason: "signing-in", message: "请在浏览器中完成登录。" });
    try {
      const token = await this.deps.login(controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return this.snapshot();
      this.token = token;
      await this.persist(token);
      if (generation === this.generation) await this.refresh();
    } catch {
      if (generation === this.generation) {
        this.token = undefined; await this.persist().catch(() => {});
        this.update({ state: "signed-out", reason: "signed-out", message: "登录未完成或已取消，请重试。" });
      }
    } finally { if (this.loginController === controller) this.loginController = undefined; }
    return this.snapshot();
  }
  async logout(): Promise<MembershipStatus> {
    const wasAllowed = this.status.state === "allowed";
    ++this.generation; this.loginController?.abort(); this.loginController = undefined;
    this.token = undefined; this.pending = undefined;
    if (this.config) this.update(signedOutMembership());
    const stopped = wasAllowed ? this.stopWork() : this.stopping;
    try { await this.persist(); } finally { await stopped; }
    return this.snapshot();
  }
  refresh(): Promise<MembershipStatus> {
    if (!this.token || !this.config) return Promise.resolve(this.snapshot());
    if (this.pending) return this.pending;
    const generation = this.generation, token = this.token;
    const request = this.check(generation, token);
    this.pending = request;
    void request.finally(() => { if (this.pending === request) this.pending = undefined; }).catch(() => {});
    return request;
  }
  private async check(generation: number, token: string): Promise<MembershipStatus> {
    let next: MembershipStatus;
    try { next = MembershipStatusSchema.parse(await this.deps.check(token)); }
    catch { next = { state: "unavailable", reason: "unavailable", message: "无法核验账号权限，请检查网络后重试。" }; }
    if (generation !== this.generation) return this.snapshot();
    const wasAllowed = this.status.state === "allowed";
    this.update(next);
    // Cancellation may be awaiting this admission. Release it before draining running work.
    if (wasAllowed && next.state !== "allowed") void this.stopWork();
    if (next.reason === "session-expired" || next.reason === "forbidden") { this.token = undefined; await this.persist(); }
    return this.snapshot();
  }
  async assertAllowed(): Promise<void> {
    if (this.isLocalDevelopment()) return;
    const status = await this.refresh();
    if (!this.token || status.state !== "allowed") throw new Error(status.message);
  }
  async billingUrl(): Promise<string> {
    if (!this.config) throw new Error("账号服务尚未配置。");
    if (!this.token) return `${this.config.serviceUrl}/billing`;
    const generation = this.generation;
    const response = await fetch(`${this.config.serviceUrl}/billing/ticket`, {
      method: "POST", headers: { Authorization: `Bearer ${this.token}` },
      redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || generation !== this.generation) throw new Error("续费页面未打开，请重新登录后重试。");
    const text = await response.text();
    if (text.length > 1024) throw new Error("续费链接无效。");
    const ticket: unknown = JSON.parse(text).ticket;
    if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/.test(ticket)) throw new Error("续费链接无效。");
    return `${this.config.serviceUrl}/billing#ticket=${ticket}`;
  }
  private stopWork(): Promise<void> {
    this.stopping = this.deps.lostAccess().catch(() => {});
    return this.stopping;
  }
  startHeartbeat(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.refresh().catch(() => {}); }, MEMBERSHIP_HEARTBEAT_MS);
    this.timer.unref();
  }
  dispose(): void { clearInterval(this.timer); this.timer = undefined; ++this.generation; this.loginController?.abort(); }
}

export async function fetchMembership(config: MembershipConfig, token: string): Promise<MembershipStatus> {
  const response = await fetch(`${config.serviceUrl}/v1/membership`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("账号核验失败。");
  const text = await response.text();
  if (text.length > 16_384) throw new Error("账号响应无效。");
  return MembershipStatusSchema.parse(JSON.parse(text));
}
