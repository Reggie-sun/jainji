import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { ProviderError, type ModelMessage } from "./api-transport.js";
import type { ChatGPTStatus } from "../shared/agent.js";
import type { RpcClient } from "./codex-rpc.js";

export function trustedLoginUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !["auth.openai.com", "chatgpt.com"].includes(url.hostname)) throw new ProviderError("登录服务返回的地址无效。");
  return url.toString();
}

export class ChatGPTSession {
  private rpc?: RpcClient;
  private starting?: Promise<RpcClient>;
  private loginId?: string;
  private awaitingAccountUpdate = false;
  private loginTimer?: ReturnType<typeof setTimeout>;
  private state: ChatGPTStatus = { status: "signed-out" };
  private disposed = false;
  private revision = 0;
  private refreshGeneration = 0;
  constructor(private readonly create: () => Promise<RpcClient>, private readonly openBrowser: (url: string) => Promise<void>, private readonly cwd: string, private readonly changed: () => void) {}
  status(): ChatGPTStatus { return { ...this.state }; }
  private set(state: ChatGPTStatus): void { this.state = state; this.changed(); }
  private async client(): Promise<RpcClient> {
    if (this.disposed) throw new ProviderError("应用正在关闭。");
    if (this.rpc) return this.rpc;
    if (!this.starting) this.starting = (async () => {
      const rpc = await this.create();
      if (this.disposed) { rpc.close(); throw new ProviderError("应用正在关闭。"); }
      rpc.on("notification", this.notification);
      rpc.on("closed", () => {
        if (this.rpc !== rpc) return;
        this.rpc = undefined; this.loginId = undefined; this.awaitingAccountUpdate = false; clearTimeout(this.loginTimer);
        this.set({ status: "error", message: "Codex 连接已断开，请重新登录。" });
      });
      this.rpc = rpc;
      return rpc;
    })().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  private notification = (method: string, params: any): void => {
    if (method === "account/login/completed" && this.loginId && params?.loginId === this.loginId) {
      this.loginId = undefined;
      if (params.success) {
        this.awaitingAccountUpdate = true;
        void this.refresh().catch(() => undefined);
      } else {
        clearTimeout(this.loginTimer);
        this.awaitingAccountUpdate = false;
        this.set({ status: "error", message: "ChatGPT 登录未完成，请重试。" });
      }
    }
    if (method === "account/updated" && params?.authMode === "chatgpt" && this.awaitingAccountUpdate) {
      void this.refresh().catch(() => undefined);
    }
  };
  async refresh(): Promise<boolean> {
    const revision = this.revision;
    const generation = ++this.refreshGeneration;
    try { return await this.readAccount(generation); }
    catch (error) {
      if (revision === this.revision && generation === this.refreshGeneration && !this.disposed) this.set({ status: "error", message: "账户或模型信息读取失败，请检查网络并刷新登录状态。" });
      throw error;
    }
  }
  private async readAccount(generation: number): Promise<boolean> {
    const revision = this.revision;
    const rpc = await this.client();
    const response = z.object({ account: z.object({ type: z.string(), email: z.string().nullable().optional(), planType: z.string().optional() }).nullable() }).parse(await rpc.request("account/read", { refreshToken: false }));
    if (revision !== this.revision || generation !== this.refreshGeneration || this.disposed) return false;
    if (response.account?.type !== "chatgpt") { this.set(this.awaitingAccountUpdate || this.loginId ? { status: "logging-in", message: "等待登录状态同步，可在完成授权后刷新。" } : { status: "signed-out" }); return false; }
    const models = z.object({ data: z.array(z.object({ model: z.string(), isDefault: z.boolean(), hidden: z.boolean(), inputModalities: z.array(z.string()).default(["text", "image"]) })) }).parse(await rpc.request("model/list", { includeHidden: false }));
    const eligible = models.data.filter((model) => !model.hidden && model.inputModalities.includes("image"));
    const selected = eligible.find((model) => model.isDefault) ?? eligible[0];
    if (!selected) throw new ProviderError("当前账户没有可用的视觉模型。");
    if (revision !== this.revision || generation !== this.refreshGeneration || this.disposed) return false;
    this.loginId = undefined; this.awaitingAccountUpdate = false; clearTimeout(this.loginTimer);
    this.set({ status: "ready", email: response.account.email ?? undefined, plan: response.account.planType, model: selected.model });
    return true;
  }
  async login(): Promise<void> {
    if (this.loginId || this.state.status === "starting") throw new ProviderError("登录正在进行中。");
    this.set({ status: "starting" });
    // A metadata/network failure must not erase an already persisted login.
    try { if (await this.refresh()) return; }
    catch { this.set({ status: "error", message: "账户信息读取失败，请检查网络并刷新登录状态。" }); throw new ProviderError("无法读取 ChatGPT 账户信息，请重试。"); }
    try {
      const rpc = await this.client();
      const result = z.object({ type: z.literal("chatgpt"), loginId: z.string(), authUrl: z.string() }).parse(await rpc.request("account/login/start", { type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "chatgpt" }));
      this.loginId = result.loginId;
      this.set({ status: "logging-in" });
      this.loginTimer = setTimeout(() => {
        if (this.awaitingAccountUpdate) {
          this.awaitingAccountUpdate = false;
          this.set({ status: "error", message: "授权已完成，但账户同步超时，请刷新登录状态。" });
        } else { void this.cancelLogin().catch(() => undefined); }
      }, 5 * 60_000);
      await this.openBrowser(trustedLoginUrl(result.authUrl));
    } catch {
      await this.cancelLogin().catch(() => undefined);
      this.set({ status: "error", message: "无法打开 ChatGPT 登录，请检查网络后重试。" });
      throw new ProviderError("无法完成 ChatGPT 连接，请检查网络后重试。");
    }
  }
  async cancelLogin(): Promise<void> {
    this.revision += 1;
    const id = this.loginId;
    const hadAttempt = Boolean(id) || this.awaitingAccountUpdate || ["starting", "logging-in"].includes(this.state.status);
    this.loginId = undefined; this.awaitingAccountUpdate = false; clearTimeout(this.loginTimer);
    try {
      if (id && this.rpc) await this.rpc.request("account/login/cancel", { loginId: id });
      // The callback may have persisted credentials just before cancellation.
      // Logout clears that completed login too, including a cancel/notFound race.
      if (hadAttempt && this.rpc) await this.rpc.request("account/logout", {});
      this.set({ status: "signed-out" });
    } catch {
      this.set({ status: "error", message: "未能确认退出登录，请重新连接后退出。" });
      throw new ProviderError("取消登录未完成，请重新连接后退出。");
    }
  }
  async logout(): Promise<void> {
    await this.cancelLogin();
    try {
      const rpc = await this.client(); await rpc.request("account/logout", {});
      this.set({ status: "signed-out" });
    } catch {
      this.set({ status: "error", message: "未能确认退出登录，请重新连接后退出。" });
      throw new ProviderError("退出登录未完成，请重新连接后退出。");
    }
  }
  async complete(messages: ModelMessage[], signal: AbortSignal): Promise<string> {
    if (this.state.status !== "ready" || !this.state.model) throw new ProviderError("请先使用 ChatGPT 登录。");
    const rpc = await this.client();
    await mkdir(this.cwd, { recursive: true, mode: 0o700 });
    const aborted = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
    aborted.throwIfAborted();
    const thread = z.object({ thread: z.object({ id: z.string() }) }).parse(await rpc.request("thread/start", {
      model: this.state.model, cwd: this.cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only", environments: [],
      baseInstructions: "You are a video packaging planner. Return only the requested JSON. Do not use tools, commands, files, skills, or external services.",
      developerInstructions: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n"),
    }));
    let turnId: string | undefined;
    try {
      return await new Promise<string>((resolve, reject) => {
        let finalText = "";
        const cleanup = () => { rpc.off("notification", receive); rpc.off("closed", closed); aborted.removeEventListener("abort", stop); };
        const fail = (message: string) => { cleanup(); reject(new ProviderError(message)); };
        const closed = () => fail("Codex 连接中断，请重新连接。");
        const stop = () => {
          if (turnId) void rpc.request("turn/interrupt", { threadId: thread.thread.id, turnId }).catch(() => undefined);
          fail(signal.aborted ? "已停止生成。" : "ChatGPT 请求超时，请重试。");
        };
        const receive = (method: string, params: any) => {
          if (params?.threadId !== thread.thread.id) return;
          if (method === "item/completed" && params.item?.type === "agentMessage" && params.item.phase !== "commentary") finalText = params.item.text;
          if (method === "turn/completed") {
            if (params.turn?.status !== "completed") { fail("ChatGPT 任务失败，请检查账户额度、模型权限或网络。"); return; }
            if (typeof finalText !== "string" || !finalText || finalText.length > 16_000) { fail("ChatGPT 未返回有效的包装方案。"); return; }
            cleanup(); resolve(finalText);
          }
        };
        rpc.on("notification", receive); rpc.on("closed", closed); aborted.addEventListener("abort", stop, { once: true });
        if (aborted.aborted) { stop(); return; }
        const input = messages.filter((m) => m.role === "user").flatMap<Record<string, unknown>>((m) => typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content.map((item) => item.type === "text" ? item : { type: "image", url: item.image_url.url, detail: "low" }));
        void rpc.request("turn/start", { threadId: thread.thread.id, input, environments: [],
          approvalPolicy: "never", sandboxPolicy: { type: "readOnly", networkAccess: false },
        }).then((result) => {
          turnId = z.object({ turn: z.object({ id: z.string() }) }).parse(result).turn.id;
          if (aborted.aborted) void rpc.request("turn/interrupt", { threadId: thread.thread.id, turnId }).catch(() => undefined);
        }).catch(() => fail("ChatGPT 请求未完成，请检查账户额度或网络。"));
      });
    } finally { void rpc.request("thread/unsubscribe", { threadId: thread.thread.id }).catch(() => undefined); }
  }
  async dispose(): Promise<void> { this.disposed = true; clearTimeout(this.loginTimer); await this.rpc?.close(); }
}
