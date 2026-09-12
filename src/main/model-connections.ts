import { access, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { AgentProvider } from "./agent-provider.js";
import { ChatGPTSession } from "./chatgpt-session.js";
import { CodexRpc } from "./codex-rpc.js";
import { ProviderError } from "./api-transport.js";
import { loadCCSwitchProvider, listCCSwitchProviders } from "./cc-switch.js";

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
  constructor(private readonly userData: string, appPath: string, openBrowser: (url: string) => Promise<void>, private readonly changed: () => void) {
    this.chatgpt = new ChatGPTSession(async () => {
      const launch = codexLaunch(appPath, userData);
      await mkdir(launch.cwd, { recursive: true, mode: 0o700 });
      const client = new CodexRpc(launch.command, launch.args, launch.env, launch.cwd);
      this.activeRpc = client;
      try { await client.initialize(); return client; } catch (error) { client.close(); throw error; }
    }, openBrowser, path.join(userData, "codex", "workspace"), () => {
      const state = this.chatgpt.status();
      if (this.wantChatGPT) {
        if (state.status === "ready" && state.model) this.provider.useChatGPT(state.model, (messages, signal) => this.chatgpt.complete(messages, signal));
        else this.provider.clear();
      }
      this.changed();
    });
  }
  assertIdle(): void { if (this.pending || ["starting", "logging-in"].includes(this.chatgpt.status().status)) throw new ProviderError("连接正在处理中，请等待或取消登录。"); }
  private async exclusive(action: () => Promise<void>): Promise<void> {
    this.assertIdle(); this.pending = true;
    try { await action(); } finally { this.pending = false; this.changed(); }
  }
  async restore(): Promise<void> {
    try { await access(path.join(this.userData, "codex", "auth.json")); }
    catch { return; }
    await this.exclusive(async () => { this.wantChatGPT = true; await this.chatgpt.refresh(); }).catch(() => undefined);
  }
  async login(): Promise<void> { await this.exclusive(async () => { this.wantChatGPT = true; this.provider.clear(); await this.chatgpt.login(); }); }
  async cancelLogin(): Promise<void> { if (this.pending) throw new ProviderError("连接正在处理中，请稍后取消。"); this.wantChatGPT = false; this.provider.clear(); await this.chatgpt.cancelLogin(); }
  async configure(input: unknown): Promise<void> { await this.exclusive(async () => { this.provider.configure(input); this.wantChatGPT = false; }); }
  async useCCSwitch(id: string, appType: "claude" | "codex"): Promise<void> {
    await this.exclusive(async () => {
      const input = await loadCCSwitchProvider(id, appType);
      this.provider.configure(input, "CC Switch"); this.wantChatGPT = false;
    });
  }
  async listCCSwitch() { return listCCSwitchProviders(); }
  async disconnect(): Promise<void> {
    await this.exclusive(async () => {
      const logout = this.wantChatGPT;
      this.wantChatGPT = false; this.provider.clear();
      if (logout) await this.chatgpt.logout();
    });
  }
  async dispose(): Promise<void> { this.wantChatGPT = false; this.provider.clear(); await Promise.all([this.chatgpt.dispose(), this.activeRpc?.close()]); }
}
