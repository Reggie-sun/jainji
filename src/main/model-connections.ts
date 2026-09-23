import { access, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";
import { AgentProvider } from "./agent-provider.js";
import { ApiRequestScheduler } from "./api-request-scheduler.js";
import { ChatGPTSession } from "./chatgpt-session.js";
import { CodexRpc } from "./codex-rpc.js";
import { ProviderError } from "./api-transport.js";
import { loadCCSwitchProvider, listCCSwitchProviders } from "./cc-switch.js";
import { ConnectionStore } from "./connection-store.js";
import { DEFAULT_QWEN_CONNECTION, SelectModelSchema } from "../shared/connections.js";

const ChatGPTExecutionCredentialSchema = z.object({
  tokens: z.object({
    access_token: z.string().trim().min(1).max(20_000),
    account_id: z.string().trim().min(1).max(512),
  }),
});

export async function readChatGPTExecutionCredential(userData: string): Promise<{ accessToken: string; accountId: string }> {
  try {
    try {
      await access(path.join(userData, "codex-execution", "auth.json"));
      throw new Error("execution auth must remain absent");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const raw = await readFile(path.join(userData, "codex", "auth.json"), "utf8");
    if (raw.length > 1_000_000) throw new Error("credential file too large");
    const parsed = ChatGPTExecutionCredentialSchema.parse(JSON.parse(raw));
    return { accessToken: parsed.tokens.access_token, accountId: parsed.tokens.account_id };
  } catch {
    throw new ProviderError("ChatGPT 登录凭据不可用，请刷新登录状态。");
  }
}

export function codexLaunch(appPath: string, userData: string): { command: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string } {
  return codexRuntimeLaunch(appPath, path.join(userData, "codex"), {
    cli_auth_credentials_store: "file", model_provider: "openai", ...restrictedCodexSettings(),
  });
}

export function codexCompletionLaunch(appPath: string, userData: string, credential: { accessToken: string; accountId: string }): { command: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string } {
  if (!credential.accessToken.trim() || !credential.accountId.trim()) throw new ProviderError("ChatGPT 登录凭据不可用，请刷新登录状态。");
  const launch = codexRuntimeLaunch(appPath, path.join(userData, "codex-execution"), {
    cli_auth_credentials_store: "file", model_provider: "jianji_openai_once", ...restrictedCodexSettings(),
    "features.unbounded_connection_retries": false,
    "model_providers.jianji_openai_once.name": "OpenAI",
    "model_providers.jianji_openai_once.base_url": "https://chatgpt.com/backend-api/codex",
    "model_providers.jianji_openai_once.env_key": "JIANJI_CODEX_ACCESS_TOKEN",
    "model_providers.jianji_openai_once.env_http_headers.ChatGPT-Account-ID": "JIANJI_CODEX_ACCOUNT_ID",
    "model_providers.jianji_openai_once.wire_api": "responses",
    "model_providers.jianji_openai_once.requires_openai_auth": false,
    "model_providers.jianji_openai_once.request_max_retries": 0,
    "model_providers.jianji_openai_once.stream_max_retries": 0,
    "model_providers.jianji_openai_once.supports_websockets": false,
  });
  launch.env.JIANJI_CODEX_ACCESS_TOKEN = credential.accessToken;
  launch.env.JIANJI_CODEX_ACCOUNT_ID = credential.accountId;
  return launch;
}

function restrictedCodexSettings(): Record<string, unknown> {
  return {
    approval_policy: "never", sandbox_mode: "read-only",
    web_search: "disabled", "features.shell_tool": false, "features.unified_exec": false,
    "features.multi_agent": false, "features.apps": false,
    "features.shell_snapshot": false, "features.skill_mcp_dependency_install": false,
    "orchestrator.skills.enabled": false,
    check_for_update_on_startup: false,
  };
}

function codexRuntimeLaunch(appPath: string, cwd: string, settings: Record<string, unknown>): { command: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string } {
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : undefined;
  if (!arch || !["linux", "win32"].includes(process.platform)) throw new ProviderError("当前系统暂不支持内置 Codex。");
  const require = createRequire(path.join(appPath, "package.json"));
  const codexRequire = createRequire(require.resolve("@openai/codex/package.json"));
  const pkg = codexRequire.resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`);
  const target = `${arch}-${process.platform === "win32" ? "pc-windows-msvc" : "unknown-linux-musl"}`;
  const command = path.join(path.dirname(pkg), "vendor", target, "bin", process.platform === "win32" ? "codex.exe" : "codex").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  // Only OS/runtime and network routing variables reach the dedicated child.
  // In particular, no inherited API keys, Codex configuration, or agent environment.
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(PATH|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|LANG|LC_.*|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR)$/i.test(key)) env[key] = value;
  }
  env.CODEX_HOME = cwd;
  return { command, env, cwd: env.CODEX_HOME, args: ["app-server", ...Object.entries(settings).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`])] };
}

export class ModelConnections {
  private readonly apiRequests = new ApiRequestScheduler();
  readonly provider = new AgentProvider(fetch, undefined, this.apiRequests);
  readonly visionProvider = new AgentProvider(fetch, undefined, this.apiRequests);
  readonly reviewerProvider = new AgentProvider(fetch, undefined, this.apiRequests);
  readonly chatgpt: ChatGPTSession;
  private pending = false;
  private disposed = false;
  private wantChatGPT = false;
  readonly store: ConnectionStore;
  constructor(private readonly userData: string, appPath: string, openBrowser: (url: string) => Promise<void>, private readonly changed: () => void) {
    this.store = new ConnectionStore(path.join(userData, "connections"));
    const startCodex = async (launch: ReturnType<typeof codexLaunch>) => {
      await mkdir(launch.cwd, { recursive: true, mode: 0o700 });
      const client = new CodexRpc(launch.command, launch.args, launch.env, launch.cwd);
      try { await client.initialize(); return client; } catch (error) { client.close(); throw error; }
    };
    this.chatgpt = new ChatGPTSession(async () => startCodex(codexLaunch(appPath, userData)), openBrowser, path.join(userData, "codex", "workspace"), () => {
      const state = this.chatgpt.status();
      if (this.wantChatGPT) {
        if (state.status === "ready" && state.model) this.provider.useChatGPT(state.model, (messages, signal, options) => this.chatgpt.complete(messages, signal, options), state.reasoningEffort);
        else this.provider.clear();
      }
      this.activateVision();
      this.activateReviewer();
      this.changed();
    }, () => this.store.snapshot().chatgptModel, () => this.store.snapshot().chatgptReasoningEffort, async () => {
      const credential = await readChatGPTExecutionCredential(userData);
      return startCodex(codexCompletionLaunch(appPath, userData, credential));
    });
  }
  assertIdle(): void { if (this.pending || ["starting", "logging-in"].includes(this.chatgpt.status().status)) throw new ProviderError("连接正在处理中，请等待或取消登录。"); }
  private async exclusive(action: () => Promise<void>): Promise<void> {
    this.assertIdle(); this.pending = true;
    try { await action(); } finally { this.pending = false; this.changed(); }
  }
  async restore(): Promise<void> {
    await this.store.load();
    const saved = this.store.snapshot();
    if (saved.error) { this.changed(); return; }
    if (saved.selected && saved.selected !== "chatgpt") {
      await this.exclusive(async () => { this.activate(saved.selected!); });
    }
    this.activateVision();
    this.activateReviewer();
    if (this.store.exists && saved.selected !== "chatgpt" && saved.vision?.connectionId !== "chatgpt" && saved.reviewer?.connectionId !== "chatgpt") { this.changed(); return; }
    try { await access(path.join(this.userData, "codex", "auth.json")); }
    catch { return; }
    await this.exclusive(async () => {
      if (!this.store.exists) await this.store.select("chatgpt");
      this.wantChatGPT = this.store.snapshot().selected === "chatgpt"; await this.chatgpt.refresh();
    }).catch(() => undefined);
  }
  async login(): Promise<void> { await this.exclusive(async () => { await this.store.select("chatgpt"); this.wantChatGPT = true; this.provider.clear(); await this.chatgpt.login(); }); }
  async cancelLogin(): Promise<void> {
    if (this.pending && !["starting", "logging-in"].includes(this.chatgpt.status().status)) throw new ProviderError("连接正在处理中，请稍后取消。");
    this.wantChatGPT = false;
    this.provider.clear();
    await this.chatgpt.cancelLogin();
  }
  async refreshLogin(): Promise<void> {
    if (this.pending) throw new ProviderError("连接正在处理中，请稍后刷新。");
    this.pending = true;
    try { await this.chatgpt.refresh(); } finally { this.pending = false; this.changed(); }
  }
  private activate(id: string): void { const profile = this.store.get(id); this.provider.configure(profile.input, profile.name); this.wantChatGPT = false; }
  private activateVision(): void {
    if (this.disposed) return;
    const selection = this.store.snapshot().vision;
    this.visionProvider.clear();
    if (!selection) return;
    const { connectionId, model, reasoningEffort } = selection;
    if (connectionId === "chatgpt") {
      try { this.chatgpt.assertModel(model, reasoningEffort); } catch { return; }
      this.visionProvider.useChatGPT(model, (messages, signal, options) => this.chatgpt.completeWithModel(model, reasoningEffort, messages, signal, options), reasoningEffort);
    } else {
      const profile = this.store.get(connectionId);
      this.visionProvider.configure({ ...profile.input, model, reasoningEffort }, profile.name);
    }
  }
  private activateReviewer(): void {
    if (this.disposed) return;
    const selection = this.store.snapshot().reviewer;
    this.reviewerProvider.clear();
    if (!selection) return;
    const { connectionId, model, reasoningEffort } = selection;
    if (connectionId === "chatgpt") {
      try { this.chatgpt.assertModel(model, reasoningEffort); } catch { return; }
      this.reviewerProvider.useChatGPT(model, (messages, signal, options) => this.chatgpt.completeWithModel(model, reasoningEffort, messages, signal, options), reasoningEffort);
    } else {
      const profile = this.store.get(connectionId);
      this.reviewerProvider.configure({ ...profile.input, model, reasoningEffort }, profile.name);
    }
  }
  async selectVision(input: unknown): Promise<void> {
    const parsed = SelectModelSchema.nullable().safeParse(input);
    if (!parsed.success) throw new ProviderError("请选择视觉识别连接并填写有效的模型名称。");
    await this.exclusive(async () => {
      if (parsed.data?.connectionId === "chatgpt") this.chatgpt.assertModel(parsed.data.model, parsed.data.reasoningEffort);
      await this.store.selectVision(parsed.data);
      this.activateVision();
    });
  }
  async selectReviewer(input: unknown): Promise<void> {
    const parsed = SelectModelSchema.nullable().safeParse(input);
    if (!parsed.success) throw new ProviderError("请选择复核连接并填写有效的模型名称。");
    await this.exclusive(async () => {
      if (parsed.data?.connectionId === "chatgpt") this.chatgpt.assertModel(parsed.data.model, parsed.data.reasoningEffort);
      await this.store.selectReviewer(parsed.data);
      this.activateReviewer();
    });
  }
  reviewProvider(input: unknown): AgentProvider {
    this.assertIdle();
    const { connectionId, model, reasoningEffort } = SelectModelSchema.parse(input);
    const provider = new AgentProvider(fetch, undefined, this.apiRequests);
    if (connectionId === "chatgpt") {
      this.chatgpt.assertModel(model, reasoningEffort);
      provider.useChatGPT(model, (messages, signal, options) => this.chatgpt.completeWithModel(model, reasoningEffort, messages, signal, options), reasoningEffort);
    } else {
      const profile = this.store.get(connectionId);
      provider.configure({ ...profile.input, model, reasoningEffort }, profile.name);
    }
    return provider;
  }
  async save(input: unknown): Promise<void> {
    await this.exclusive(async () => {
      const firstConnection = !this.store.exists;
      const id = await this.store.save(input);
      const profile = this.store.get(id);
      if (firstConnection && profile.input.baseUrl === DEFAULT_QWEN_CONNECTION.baseUrl &&
          profile.input.model === DEFAULT_QWEN_CONNECTION.model && profile.input.protocol === DEFAULT_QWEN_CONNECTION.protocol &&
          profile.input.authHeader === DEFAULT_QWEN_CONNECTION.authHeader) await this.store.select(id);
      if (this.store.snapshot().selected === id) this.activate(id);
      if (this.store.snapshot().vision?.connectionId === id) this.activateVision();
      if (this.store.snapshot().reviewer?.connectionId === id) this.activateReviewer();
    });
  }
  async select(id: string): Promise<void> { await this.exclusive(async () => { this.store.get(id); await this.store.select(id); this.activate(id); }); }
  async selectModel(input: unknown): Promise<void> {
    const parsed = SelectModelSchema.safeParse(input);
    if (!parsed.success) throw new ProviderError("请选择连接并填写有效的模型名称。");
    await this.exclusive(async () => {
      const { connectionId, model, reasoningEffort } = parsed.data;
      if (this.store.snapshot().selected !== connectionId) throw new ProviderError("当前连接已变更，请重新选择模型。");
      if (connectionId === "chatgpt") {
        this.chatgpt.assertModel(model, reasoningEffort);
        await this.store.saveChatGPTModel(model, reasoningEffort);
        this.chatgpt.selectModel(model, reasoningEffort);
      } else {
        const profile = this.store.get(connectionId);
        await this.store.save({ ...profile.input, id: connectionId, name: profile.name, model, reasoningEffort });
        this.activate(connectionId);
      }
    });
  }
  async remove(id: string): Promise<void> {
    await this.exclusive(async () => { const active = this.store.snapshot().selected === id; await this.store.remove(id); if (active) this.provider.clear(); this.activateVision(); this.activateReviewer(); });
  }
  async importCCSwitch(id: string, appType: "claude" | "codex"): Promise<void> {
    await this.exclusive(async () => {
      const input = await loadCCSwitchProvider(id, appType);
      const metadata = (await listCCSwitchProviders()).find((p) => p.id === id && p.appType === appType);
      await this.store.save({ ...input, name: metadata?.name ?? `${appType} 导入配置` });
    });
  }
  async listCCSwitch() { return listCCSwitchProviders(); }
  async disconnect(): Promise<void> {
    await this.exclusive(async () => {
      const logout = this.wantChatGPT;
      await this.store.select(null);
      this.wantChatGPT = false; this.provider.clear();
      if (logout) await this.chatgpt.logout();
    });
  }
  async dispose(): Promise<void> { this.disposed = true; this.wantChatGPT = false; this.provider.clear(); this.visionProvider.clear(); this.reviewerProvider.clear(); await this.chatgpt.dispose(); }
}
