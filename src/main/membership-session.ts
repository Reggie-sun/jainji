import { MEMBERSHIP_HEARTBEAT_MS, MembershipPasswordLoginSchema, MembershipStatusSchema, signedOutMembership, type MembershipConfig, type MembershipPasswordLogin, type MembershipStatus } from "../shared/membership.js";
import { checkMembershipWithRecovery, MembershipCheckError, membershipFailure, type MembershipDiagnostic } from "./membership-check.js";
import { isOfflineAdminToken, type OfflineAdminAuthority } from "./membership-offline-admin.js";

export interface MembershipStorage { read(): Promise<string | undefined>; write(token?: string): Promise<void>; }
interface Dependencies {
  fetcher?: typeof fetch;
  localDevelopment?: boolean;
  offlineAdmin?: OfflineAdminAuthority;
  storage: MembershipStorage;
  check(token: string, signal?: AbortSignal): Promise<MembershipStatus>;
  recover?(signal?: AbortSignal): Promise<void>;
  diagnostic?(event: MembershipDiagnostic): void | Promise<void>;
  login(signal: AbortSignal): Promise<string>;
  changed(status: MembershipStatus): void;
  lostAccess(): Promise<void>;
}

/** The single desktop session owner. Admission checks the current cloud or local authority. */
export class MembershipSession {
  private status: MembershipStatus;
  private token?: string;
  private generation = 0;
  private loginController?: AbortController;
  private pendingLogin?: Promise<MembershipStatus>;
  private pendingLoginIsOffline = false;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<MembershipStatus>;
  private checkController?: AbortController;
  private writes = Promise.resolve();
  private stopping = Promise.resolve();
  constructor(readonly config: MembershipConfig | undefined, private readonly deps: Dependencies) {
    this.status = this.isLocalDevelopment() ? { state: "local-development", reason: "local-development", message: "本地开发模式" }
      : config || deps.offlineAdmin ? signedOutMembership() : { state: "unconfigured", reason: "unconfigured", message: "账号服务尚未配置，请联系管理员。" };
    if (deps.offlineAdmin) this.status.offlineLoginAvailable = true;
  }
  private isLocalDevelopment(): boolean { return !this.config && !this.deps.offlineAdmin && this.deps.localDevelopment === true; }
  snapshot(): MembershipStatus { return structuredClone(this.status); }
  private update(next: MembershipStatus): void { this.status = this.deps.offlineAdmin ? { ...next, offlineLoginAvailable: true } : next; this.deps.changed(this.snapshot()); }
  private persist(token?: string): Promise<void> {
    const next = this.writes.then(() => this.deps.storage.write(token));
    this.writes = next.catch(() => {}); return next;
  }
  async restore(): Promise<void> {
    if (!this.config && !this.deps.offlineAdmin) return;
    const generation = this.generation;
    this.update({ state: "signing-in", reason: "signing-in", message: "正在恢复上次登录…" });
    const token = await this.deps.storage.read().catch(() => undefined);
    if (generation !== this.generation) return;
    this.token = token;
    if (this.token) await this.refresh();
    else this.update(signedOutMembership());
  }
  login(input?: MembershipPasswordLogin): Promise<MembershipStatus> {
    if (input !== undefined) MembershipPasswordLoginSchema.parse(input);
    if (this.pendingLogin) {
      if (input || this.pendingLoginIsOffline) throw new Error("登录正在进行，请先取消后重试。");
      return this.pendingLogin;
    }
    this.pendingLoginIsOffline = input !== undefined;
    const pending = this.performLogin(input);
    this.pendingLogin = pending;
    void pending.finally(() => { if (this.pendingLogin === pending) this.pendingLogin = undefined; }).catch(() => {});
    return pending;
  }
  private async performLogin(input?: MembershipPasswordLogin): Promise<MembershipStatus> {
    if (input && !this.deps.offlineAdmin) throw new Error("本机管理员尚未配置。");
    if (!input && !this.config) return this.snapshot();
    if (this.loginController) return this.snapshot();
    const logout = this.logout();
    const generation = this.generation;
    await logout;
    await this.stopping;
    if (generation !== this.generation) return this.snapshot();
    const controller = new AbortController(); this.loginController = controller;
    this.update({ state: "signing-in", reason: "signing-in", message: input ? "正在核验本机帐号…" : "请在浏览器中完成登录。" });
    try {
      const token = input ? await this.deps.offlineAdmin!.login(input, controller.signal) : await this.deps.login(controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return this.snapshot();
      this.token = token;
      await this.persist(token);
      if (generation === this.generation) await this.refresh();
    } catch {
      if (generation === this.generation) {
        this.token = undefined; await this.persist().catch(() => {});
        this.update({ state: "signed-out", reason: "signed-out", message: input ? "帐号或密码错误，或本机授权不可用。" : "登录未完成或已取消，请重试。" });
      }
    } finally { if (this.loginController === controller) this.loginController = undefined; }
    return this.snapshot();
  }
  async logout(): Promise<MembershipStatus> {
    const wasAllowed = this.status.state === "allowed";
    ++this.generation; this.loginController?.abort(); this.loginController = undefined;
    this.checkController?.abort(); this.checkController = undefined;
    this.token = undefined; this.pending = undefined;
    if (this.config || this.deps.offlineAdmin) this.update(signedOutMembership());
    const stopped = wasAllowed ? this.stopWork() : this.stopping;
    try { await this.persist(); } finally { await stopped; }
    return this.snapshot();
  }
  refresh(): Promise<MembershipStatus> {
    if (!this.token) return Promise.resolve(this.snapshot());
    if (this.pending) return this.pending;
    const generation = this.generation, token = this.token;
    const controller = new AbortController(); this.checkController = controller;
    const request = this.check(generation, token, controller.signal);
    this.pending = request;
    void request.finally(() => {
      if (this.pending === request) this.pending = undefined;
      if (this.checkController === controller) this.checkController = undefined;
    }).catch(() => {});
    return request;
  }
  private async check(generation: number, token: string, signal: AbortSignal): Promise<MembershipStatus> {
    let next: MembershipStatus;
    if (isOfflineAdminToken(token)) {
      next = this.deps.offlineAdmin ? await this.deps.offlineAdmin.check(token, signal)
        : { state: "denied", reason: "session-expired", message: "本机管理员授权已失效。" };
    } else {
      next = this.config ? await checkMembershipWithRecovery({ check: signal => this.deps.check(token, signal), signal,
        recover: this.deps.recover, diagnostic: this.deps.diagnostic })
        : { state: "denied", reason: "session-expired", message: "账号服务尚未配置。" };
      if (next.reason === "offline-admin") next = { state: "unavailable", reason: "unavailable", message: "账号服务返回了无效权限。" };
    }
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
    const generation = this.generation;
    const status = await this.refresh();
    if (generation !== this.generation) throw new Error("账号已变更，请重试。");
    if (!this.token || status.state !== "allowed") throw new Error(status.message);
  }
  async billingUrl(): Promise<string> {
    if (this.token && isOfflineAdminToken(this.token)) throw new Error("本机管理员无需续费；云端服务需要单独登录。");
    if (!this.config) throw new Error("账号服务尚未配置。");
    if (!this.token) return `${this.config.serviceUrl}/billing`;
    const generation = this.generation;
    const response = await (this.deps.fetcher ?? fetch)(`${this.config.serviceUrl}/billing/ticket`, {
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
  dispose(): void { clearInterval(this.timer); this.timer = undefined; ++this.generation; this.loginController?.abort(); this.checkController?.abort(); }
}

export async function fetchMembership(config: MembershipConfig, token: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<MembershipStatus> {
  try {
    const timeout = AbortSignal.timeout(10_000);
    const response = await fetcher(`${config.serviceUrl}/v1/membership`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new MembershipCheckError({ kind: "http", httpStatus: response.status,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500 });
    const text = await response.text();
    if (text.length > 16_384) throw new MembershipCheckError({ kind: "invalid-response", retryable: false });
    const status = MembershipStatusSchema.parse(JSON.parse(text));
    if (status.reason === "offline-admin" || status.offlineLoginAvailable !== undefined) throw new MembershipCheckError({ kind: "invalid-response", retryable: false });
    return status;
  } catch (error) { throw error instanceof MembershipCheckError ? error : new MembershipCheckError(membershipFailure(error)); }
}
