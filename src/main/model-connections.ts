import { access, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { AgentProvider } from "./agent-provider.js";
import { ChatGPTSession } from "./chatgpt-session.js";
import { CodexRpc } from "./codex-rpc.js";
import { ProviderError } from "./api-transport.js";
import { loadCCSwitchProvider, listCCSwitchProviders } from "./cc-switch.js";
import { ConnectionStore } from "./connection-store.js";
import { DEFAULT_QWEN_CONNECTION, SelectModelSchema } from "../shared/connections.js";

export function codexLaunch(appPath: string, userData: string): { command: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string } {
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
  env.CODEX_HOME = path.join(userData, "codex");
  const settings: Record<string, unknown> = {
    cli_auth_credentials_store: "file", model_provider: "openai", approval_policy: "never", sandbox_mode: "read-only",
    web_search: "disabled", "features.shell_tool": false, "features.unified_exec": false,
    "features.multi_agent": false, "features.apps": false,
    "features.shell_snapshot": false, "features.skill_mcp_dependency_install": false,
    "orchestrator.skills.enabled": false,
    check_for_update_on_startup: false,
  };
  return { command, env, cwd: env.CODEX_HOME, args: ["app-server", ...Object.entries(settings).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`])] };
}

export class ModelConnections {
  readonly provider = new AgentProvider();
  readonly chatgpt: ChatGPTSession;
  private pending = false;
  private wantChatGPT = false;
  private activeRpc?: CodexRpc;
  readonly store: ConnectionStore;
  constructor(private readonly userData: string, appPath: string, openBrowser: (url: string) => Promise<void>, private readonly changed: () => void) {
    this.store = new ConnectionStore(path.join(userData, "connections"));
    this.chatgpt = new ChatGPTSession(async () => {
      const launch = codexLaunch(appPath, userData);
      await mkdir(launch.cwd, { recursive: true, mode: 0o700 });
      const client = new CodexRpc(launch.command, launch.args, launch.env, launch.cwd);
      this.activeRpc = client;
      try { await client.initialize(); return client; } catch (error) { client.close(); throw error; }
    }, openBrowser, path.join(userData, "codex", "workspace"), () => {
      const state = this.chatgpt.status();
      if (this.wantChatGPT) {
        if (state.status === "ready" && state.model) this.provider.useChatGPT(state.model, (messages, signal) => this.chatgpt.complete(messages, signal), state.reasoningEffort);
        else this.provider.clear();
      }
      this.changed();
    }, () => this.store.snapshot().chatgptModel, () => this.store.snapshot().chatgptReasoningEffort);
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
      return;
    }
    if (this.store.exists && saved.selected === null) { this.changed(); return; }
    try { await access(path.join(this.userData, "codex", "auth.json")); }
    catch { return; }
    await this.exclusive(async () => {
      if (!this.store.exists) await this.store.select("chatgpt");
      this.wantChatGPT = true; await this.chatgpt.refresh();
    }).catch(() => undefined);
  }
  async login(): Promise<void> { await this.exclusive(async () => { await this.store.select("chatgpt"); this.wantChatGPT = true; this.provider.clear(); await this.chatgpt.login(); }); }
  async cancelLogin(): Promise<void> { if (this.pending) throw new ProviderError("连接正在处理中，请稍后取消。"); this.wantChatGPT = false; this.provider.clear(); await this.chatgpt.cancelLogin(); }
  async refreshLogin(): Promise<void> {
    if (this.pending) throw new ProviderError("连接正在处理中，请稍后刷新。");
    this.pending = true;
    try { await this.chatgpt.refresh(); } finally { this.pending = false; this.changed(); }
  }
  private activate(id: string): void { const profile = this.store.get(id); this.provider.configure(profile.input, profile.name); this.wantChatGPT = false; }
  async save(input: unknown): Promise<void> {
    await this.exclusive(async () => {
      const firstConnection = !this.store.exists;
      const id = await this.store.save(input);
      const profile = this.store.get(id);
      if (firstConnection && profile.input.baseUrl === DEFAULT_QWEN_CONNECTION.baseUrl &&
          profile.input.model === DEFAULT_QWEN_CONNECTION.model && profile.input.protocol === DEFAULT_QWEN_CONNECTION.protocol &&
          profile.input.authHeader === DEFAULT_QWEN_CONNECTION.authHeader) await this.store.select(id);
      if (this.store.snapshot().selected === id) this.activate(id);
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
    await this.exclusive(async () => { const active = this.store.snapshot().selected === id; await this.store.remove(id); if (active) this.provider.clear(); });
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
  async dispose(): Promise<void> { this.wantChatGPT = false; this.provider.clear(); await Promise.all([this.chatgpt.dispose(), this.activeRpc?.close()]); }
}
