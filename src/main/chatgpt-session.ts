import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { ProviderError, type CompletionOptions, type ModelMessage } from "./api-transport.js";
import { ReasoningEffortSchema, type ChatGPTStatus } from "../shared/agent.js";
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
  constructor(private readonly create: () => Promise<RpcClient>, private readonly openBrowser: (url: string) => Promise<void>, private readonly cwd: string, private readonly changed: () => void, private readonly preferredModel: () => string | undefined = () => undefined, private readonly preferredEffort: () => string | undefined = () => undefined) {}
  status(): ChatGPTStatus { return { ...this.state }; }
  assertModel(model: string, reasoningEffort?: string): void {
    const selected = this.state.models?.find((item) => item.model === model);
    if (this.state.status !== "ready" || !selected) throw new ProviderError("请选择当前账户可用的视觉模型。");
    if (reasoningEffort !== undefined && !selected.supportedReasoningEfforts.some((item) => item.reasoningEffort === reasoningEffort)) throw new ProviderError("此模型不支持所选推理档位，请重新选择。");
  }
  selectModel(model: string, reasoningEffort?: string): void {
    this.assertModel(model, reasoningEffort);
    this.set({ ...this.state, model, reasoningEffort: reasoningEffort ?? this.state.models!.find((item) => item.model === model)!.defaultReasoningEffort, message: undefined });
  }
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
    const schema = z.object({ data: z.array(z.object({ model: z.string(), displayName: z.string().optional(), isDefault: z.boolean(), hidden: z.boolean(), inputModalities: z.array(z.string()),
      supportedReasoningEfforts: z.array(z.object({ reasoningEffort: ReasoningEffortSchema, description: z.string() })).default([]), defaultReasoningEffort: ReasoningEffortSchema.optional(),
    })), nextCursor: z.string().nullable().optional() });
    const available: z.infer<typeof schema>["data"] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = await rpc.request("model/list", { includeHidden: false, ...(cursor ? { cursor } : {}) });
      if (revision !== this.revision || generation !== this.refreshGeneration || this.disposed) return false;
      const page = schema.parse(response);
      available.push(...page.data);
      cursor = page.nextCursor ?? undefined;
      if (cursor && cursors.has(cursor)) throw new ProviderError("模型列表分页无效，请刷新登录状态。");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const eligible = available.filter((model) => !model.hidden && model.inputModalities.includes("image"));
    if (!eligible.length) throw new ProviderError("当前账户没有可用的视觉模型。");
    const preferred = this.preferredModel() ?? this.state.model;
    const selected = preferred ? eligible.find((model) => model.model === preferred) : eligible.find((model) => model.isDefault) ?? eligible[0];
    const requestedEffort = this.preferredEffort();
    const invalidEffort = requestedEffort !== undefined && !selected?.supportedReasoningEfforts.some((item) => item.reasoningEffort === requestedEffort);
    if (revision !== this.revision || generation !== this.refreshGeneration || this.disposed) return false;
    this.loginId = undefined; this.awaitingAccountUpdate = false; clearTimeout(this.loginTimer);
    this.set({ status: "ready", email: response.account.email ?? undefined, plan: response.account.planType, model: invalidEffort ? undefined : selected?.model,
      reasoningEffort: invalidEffort ? undefined : requestedEffort ?? selected?.defaultReasoningEffort,
      models: [...new Map(eligible.map((item) => [item.model, { model: item.model, displayName: item.displayName || item.model, supportedReasoningEfforts: item.supportedReasoningEfforts, defaultReasoningEffort: item.defaultReasoningEffort }])).values()],
      ...(!selected ? { message: "上次使用的模型当前不可用，请重新选择模型。" } : invalidEffort ? { message: "上次使用的推理档位当前不可用，请重新选择模型和档位。" } : {}),
    });
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
  async complete(messages: ModelMessage[], signal: AbortSignal, options: CompletionOptions = {}): Promise<string> {
    return this.completeUsing(this.state.model, this.state.reasoningEffort, messages, signal, options);
  }
  async completeWithModel(model: string, reasoningEffort: string | undefined, messages: ModelMessage[], signal: AbortSignal, options: CompletionOptions = {}): Promise<string> {
    this.assertModel(model, reasoningEffort);
    const effort = reasoningEffort ?? this.state.models!.find((item) => item.model === model)!.defaultReasoningEffort;
    return this.completeUsing(model, effort, messages, signal, options);
  }
  private async completeUsing(model: string | undefined, effort: string | undefined, messages: ModelMessage[], signal: AbortSignal, options: CompletionOptions): Promise<string> {
    if (this.state.status !== "ready" || !model) throw new ProviderError("请先使用 ChatGPT 登录。");
    const rpc = await this.client();
    await mkdir(this.cwd, { recursive: true, mode: 0o700 });
    const aborted = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
    aborted.throwIfAborted();
    const thread = z.object({ thread: z.object({ id: z.string() }) }).parse(await rpc.request("thread/start", {
      model, cwd: this.cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only", environments: [],
      baseInstructions: "You are a video packaging planner. Follow the response format requested by the current task. Do not use tools, commands, files, skills, or external services.",
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
            if (typeof finalText !== "string" || !finalText || finalText.length > (options.maxOutputCharacters ?? 16_000)) { fail("ChatGPT 未返回有效的包装方案。"); return; }
            cleanup(); resolve(finalText);
          }
        };
        rpc.on("notification", receive); rpc.on("closed", closed); aborted.addEventListener("abort", stop, { once: true });
        if (aborted.aborted) { stop(); return; }
        const input = messages.filter((m) => m.role === "user").flatMap<Record<string, unknown>>((m) => typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content.map((item) => item.type === "text" ? item : { type: "image", url: item.image_url.url, detail: item.image_url.detail }));
        void rpc.request("turn/start", { threadId: thread.thread.id, input, environments: [], ...(effort ? { effort } : {}),
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
