import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js/dist/sql-asm.js";
import { parse as parseToml } from "smol-toml";
import { ConnectionInputSchema, type ConnectionInput } from "../shared/agent.js";

const DATABASE_NAME = "cc-switch.db";
const MAX_DATABASE_BYTES = 128 * 1024 * 1024;
const BUSY_MESSAGE = "CC Switch 正在写入配置，请先关闭 CC Switch 后刷新。";
const READ_ERROR_MESSAGE = "无法读取 CC Switch 当前配置，请确认配置完整后刷新。";

export interface CCSwitchProvider {
  id: string;
  appType: "claude" | "codex";
  name: string;
  available: boolean;
  reason?: string;
  model?: string;
  protocol?: "chat-completions" | "responses" | "anthropic";
  baseUrl?: string;
}

interface ProviderRecord {
  id: string;
  appType: "claude" | "codex";
  name: string;
  settingsConfig: string;
}

interface ParsedProvider {
  metadata: CCSwitchProvider;
  connection?: ConnectionInput;
}

class CCSwitchError extends Error {}

let sqlPromise: ReturnType<typeof initSqlJs> | undefined;

function directoryPath(directory?: string): string {
  return directory ?? join(homedir(), ".cc-switch");
}

function databasePath(directory?: string): string {
  return join(directoryPath(directory), DATABASE_NAME);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeConnection(input: ConnectionInput): ConnectionInput | undefined {
  const parsed = ConnectionInputSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

function unavailable(record: ProviderRecord, reason: string): ParsedProvider {
  return { metadata: { id: record.id, appType: record.appType, name: record.name, available: false, reason } };
}

function parseClaude(record: ProviderRecord, settings: Record<string, unknown>): ParsedProvider {
  const env = isPlainRecord(settings.env) ? settings.env : undefined;
  if (!env) return unavailable(record, "Claude 配置不完整，请在 CC Switch 中重新保存。");
  const token = stringValue(env.ANTHROPIC_AUTH_TOKEN);
  const apiKey = stringValue(env.ANTHROPIC_API_KEY);
  const key = token ?? apiKey;
  const authHeader = token ? "bearer" : "x-api-key";
  const baseUrl = stringValue(env.ANTHROPIC_BASE_URL);
  const model = stringValue(env.ANTHROPIC_MODEL) ?? stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  if (!key) return unavailable(record, "未找到 Claude API Key，请在 CC Switch 中重新保存。");
  if (!baseUrl || !model) return unavailable(record, "Claude 配置缺少地址或模型，请在 CC Switch 中重新保存。");
  const connection = safeConnection({ baseUrl, model, apiKey: key, protocol: "anthropic", authHeader });
  if (!connection) return unavailable(record, "Claude 配置包含不受支持的地址或模型。");
  return {
    metadata: { id: record.id, appType: record.appType, name: record.name, available: true, model: connection.model, protocol: "anthropic", baseUrl: connection.baseUrl },
    connection,
  };
}

function parseCodex(record: ProviderRecord, settings: Record<string, unknown>): ParsedProvider {
  const auth = isPlainRecord(settings.auth) ? settings.auth : undefined;
  const apiKey = auth && stringValue(auth.OPENAI_API_KEY);
  if (!apiKey) {
    return unavailable(record, "此 Codex 配置使用 ChatGPT 登录或缺少 API Key，请使用 ChatGPT 登录。");
  }
  const configText = stringValue(settings.config);
  if (!configText) return unavailable(record, "Codex 配置不完整，请在 CC Switch 中重新保存。");

  let config: Record<string, unknown>;
  try {
    const parsed = parseToml(configText);
    if (!isPlainRecord(parsed)) return unavailable(record, "Codex 配置格式不受支持。");
    config = parsed;
  } catch {
    return unavailable(record, "Codex 配置格式不受支持。");
  }

  const model = stringValue(config.model);
  if (!model) return unavailable(record, "Codex 配置缺少模型，请在 CC Switch 中重新保存。");
  const providerId = stringValue(config.model_provider);
  if (!providerId) {
    const connection = safeConnection({ baseUrl: "https://api.openai.com/v1", model, apiKey, protocol: "responses", authHeader: "bearer" });
    if (!connection) return unavailable(record, "Codex 配置包含不受支持的模型。");
    return {
      metadata: { id: record.id, appType: record.appType, name: record.name, available: true, model: connection.model, protocol: "responses", baseUrl: connection.baseUrl },
      connection,
    };
  }

  const providers = isPlainRecord(config.model_providers) ? config.model_providers : undefined;
  const provider = providers && isPlainRecord(providers[providerId]) ? providers[providerId] : undefined;
  const baseUrl = provider && stringValue(provider.base_url);
  const wireApi = provider && stringValue(provider.wire_api);
  const envKey = provider && stringValue(provider.env_key);
  const protocol = wireApi === "responses" ? "responses" : wireApi === "chat" ? "chat-completions" : undefined;
  if (!baseUrl || !protocol || envKey !== "OPENAI_API_KEY") return unavailable(record, "Codex 自定义服务商配置不完整或协议不受支持。");
  const connection = safeConnection({ baseUrl, model, apiKey, protocol, authHeader: "bearer" });
  if (!connection) return unavailable(record, "Codex 自定义服务商包含不受支持的地址或模型。");
  return {
    metadata: { id: record.id, appType: record.appType, name: record.name, available: true, model: connection.model, protocol: connection.protocol, baseUrl: connection.baseUrl },
    connection,
  };
}

function parseProvider(record: ProviderRecord): ParsedProvider {
  try {
    const settings: unknown = JSON.parse(record.settingsConfig);
    if (!isPlainRecord(settings)) return unavailable(record, "CC Switch 配置格式不受支持。");
    return record.appType === "claude" ? parseClaude(record, settings) : parseCodex(record, settings);
  } catch {
    return unavailable(record, "CC Switch 配置格式不受支持。");
  }
}

async function fingerprint(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_DATABASE_BYTES) throw new CCSwitchError(READ_ERROR_MESSAGE);
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}

async function assertNotBusy(path: string): Promise<void> {
  for (const suffix of ["-wal", "-journal"]) {
    try {
      if ((await stat(`${path}${suffix}`)).size > 0) throw new CCSwitchError(BUSY_MESSAGE);
    } catch (error) {
      if (error instanceof CCSwitchError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new CCSwitchError(READ_ERROR_MESSAGE);
    }
  }
}

async function readRecords(directory?: string): Promise<ProviderRecord[]> {
  const path = databasePath(directory);
  try {
    await assertNotBusy(path);
    const before = await fingerprint(path);
    const bytes = await readFile(path);
    if (before !== await fingerprint(path)) throw new CCSwitchError(BUSY_MESSAGE);
    const SQL = await (sqlPromise ??= initSqlJs());
    const db = new SQL.Database(bytes);
    try {
      const rows = db.exec("SELECT id, app_type, name, settings_config FROM providers WHERE is_current = 1 AND app_type IN ('claude', 'codex') ORDER BY app_type, id")[0]?.values ?? [];
      const records: ProviderRecord[] = rows.map(([id, appType, name, settingsConfig]) => {
        const currentAppType: ProviderRecord["appType"] = appType === "claude" ? "claude" : "codex";
        return { id: String(id), appType: currentAppType, name: String(name), settingsConfig: String(settingsConfig) };
      });
      await assertNotBusy(path);
      if (before !== await fingerprint(path)) throw new CCSwitchError(BUSY_MESSAGE);
      return records;
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof CCSwitchError) throw error;
    throw new CCSwitchError(READ_ERROR_MESSAGE);
  }
}

export async function listCCSwitchProviders(directory?: string): Promise<CCSwitchProvider[]> {
  return (await readRecords(directory)).map((record) => parseProvider(record).metadata);
}

export async function loadCCSwitchProvider(id: string, appType: "claude" | "codex", directory?: string): Promise<ConnectionInput> {
  const record = (await readRecords(directory)).find((candidate) => candidate.id === id && candidate.appType === appType);
  if (!record) throw new CCSwitchError("所选 CC Switch 配置已变更，请刷新后重试。");
  const parsed = parseProvider(record);
  if (!parsed.connection) throw new CCSwitchError(parsed.metadata.reason ?? READ_ERROR_MESSAGE);
  return parsed.connection;
}
