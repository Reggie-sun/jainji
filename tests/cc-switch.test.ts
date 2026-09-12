import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js/dist/sql-asm.js";
import { afterEach, describe, expect, it } from "vitest";
import { listCCSwitchProviders, loadCCSwitchProvider } from "../src/main/cc-switch";

const directories: string[] = [];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function fixture(rows: Array<{ id: string; appType: "claude" | "codex"; name: string; current?: boolean; settings: unknown }>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "jianji-cc-switch-"));
  directories.push(directory);
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT, is_current INTEGER)");
  for (const row of rows) db.run("INSERT INTO providers VALUES (?, ?, ?, ?, ?)", [row.id, row.appType, row.name, JSON.stringify(row.settings), row.current === false ? 0 : 1]);
  await writeFile(join(directory, "cc-switch.db"), Buffer.from(db.export()));
  db.close();
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (directory) => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
  }));
});

describe("CC Switch provider import", () => {
  it("lists only current providers without exposing their secrets", async () => {
    const directory = await fixture([
      { id: "claude-current", appType: "claude", name: "Claude current", settings: { env: { ANTHROPIC_AUTH_TOKEN: "secret-claude-token", ANTHROPIC_BASE_URL: "https://claude.example/v1", ANTHROPIC_MODEL: "claude-vision" } } },
      { id: "old", appType: "claude", name: "Old", current: false, settings: { env: { ANTHROPIC_API_KEY: "old-secret", ANTHROPIC_BASE_URL: "https://old.example/v1", ANTHROPIC_MODEL: "old" } } },
      { id: "codex-current", appType: "codex", name: "Codex current", settings: { auth: { OPENAI_API_KEY: "secret-openai-key", tokens: { refresh_token: "never-show" } }, config: "model = 'gpt-5.2'\nmodel_provider = 'proxy'\n[model_providers.proxy]\nbase_url = 'https://proxy.example/v1'\nenv_key = 'OPENAI_API_KEY'\nwire_api = 'responses'" } },
    ]);
    const providers = await listCCSwitchProviders(directory);
    expect(providers).toEqual([
      { id: "claude-current", appType: "claude", name: "Claude current", available: true, model: "claude-vision", protocol: "anthropic", baseUrl: "https://claude.example/v1" },
      { id: "codex-current", appType: "codex", name: "Codex current", available: true, model: "gpt-5.2", protocol: "responses", baseUrl: "https://proxy.example/v1" },
    ]);
    expect(JSON.stringify(providers)).not.toContain("secret-");
    expect(JSON.stringify(providers)).not.toContain("refresh_token");
  });

  it("loads the selected current protocol and auth header only", async () => {
    const directory = await fixture([
      { id: "claude", appType: "claude", name: "Claude", settings: { env: { ANTHROPIC_API_KEY: "fixture-key", ANTHROPIC_BASE_URL: "https://claude.example/v1", ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet" } } },
      { id: "codex", appType: "codex", name: "Codex", settings: { auth: { OPENAI_API_KEY: "fixture-openai" }, config: "model = 'gpt-5.2'" } },
    ]);
    await expect(loadCCSwitchProvider("claude", "claude", directory)).resolves.toMatchObject({ model: "claude-sonnet", protocol: "anthropic", authHeader: "x-api-key" });
    await expect(loadCCSwitchProvider("codex", "codex", directory)).resolves.toMatchObject({ baseUrl: "https://api.openai.com/v1", protocol: "responses", authHeader: "bearer" });
  });

  it("marks malformed custom Codex and OAuth-only records unavailable", async () => {
    const directory = await fixture([
      { id: "broken", appType: "codex", name: "Broken", settings: { auth: { OPENAI_API_KEY: "fixture" }, config: "model = 'gpt-5.2'\nmodel_provider = 'bad'\n[model_providers.bad]\nbase_url = 'https://proxy.example/v1'\nwire_api = 'unknown'" } },
      { id: "oauth", appType: "codex", name: "OAuth", settings: { auth: { auth_mode: "chatgpt", tokens: { access_token: "never-import" } }, config: "model = 'gpt-5.2'" } },
    ]);
    const providers = await listCCSwitchProviders(directory);
    expect(providers.map(({ available, reason }) => [available, reason])).toEqual([
      [false, "Codex 自定义服务商配置不完整或协议不受支持。"],
      [false, "此 Codex 配置使用 ChatGPT 登录或缺少 API Key，请使用 ChatGPT 登录。"],
    ]);
    await expect(loadCCSwitchProvider("oauth", "codex", directory)).rejects.toThrow("ChatGPT 登录");
  });

  it("fails closed when CC Switch has a write journal and does not mutate the database", async () => {
    const directory = await fixture([{ id: "claude", appType: "claude", name: "Claude", settings: { env: { ANTHROPIC_API_KEY: "fixture", ANTHROPIC_BASE_URL: "https://claude.example/v1", ANTHROPIC_MODEL: "claude" } } }]);
    const database = join(directory, "cc-switch.db");
    const before = await readFile(database);
    await writeFile(`${database}-journal`, "writing");
    await expect(listCCSwitchProviders(directory)).rejects.toThrow("关闭 CC Switch 后刷新");
    expect(hash(await readFile(database))).toBe(hash(before));
  });
});
