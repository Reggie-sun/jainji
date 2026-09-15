import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createModelGateway } from "./gateway.js";

const PORT = 18182;

type GatewayCredentials = { keys: string[]; upstreamKey: string };

export async function readGatewayCredentials(file: string | undefined = process.env.MODEL_GATEWAY_KEYS_FILE): Promise<GatewayCredentials> {
  if (!file) throw new Error("MODEL_GATEWAY_KEYS_FILE is required.");
  const details = await stat(file);
  if (!details.isFile() || (details.mode & 0o077) !== 0) throw new Error("MODEL_GATEWAY_KEYS_FILE must be a private file.");
  let input: unknown;
  try { input = JSON.parse(await readFile(file, "utf8")); }
  catch { throw new Error("MODEL_GATEWAY_KEYS_FILE is invalid."); }
  if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("MODEL_GATEWAY_KEYS_FILE is invalid.");
  const value = input as { members?: unknown; upstreamKey?: unknown };
  if (!Array.isArray(value.members) || typeof value.upstreamKey !== "string" || !value.upstreamKey.trim()) throw new Error("MODEL_GATEWAY_KEYS_FILE is invalid.");
  const members = value.members.map((member) => member && typeof member === "object" && !Array.isArray(member)
    ? member as { name?: unknown; key?: unknown } : undefined);
  if (members.length !== 5 || members.some((member) => typeof member?.name !== "string" || !member.name.trim() || typeof member.key !== "string" || member.key.trim().length < 16)) {
    throw new Error("MODEL_GATEWAY_KEYS_FILE is invalid.");
  }
  const keys = members.map((member) => member!.key as string).map((key) => key.trim());
  if (new Set(keys).size !== keys.length) throw new Error("MODEL_GATEWAY_KEYS_FILE is invalid.");
  return { keys, upstreamKey: value.upstreamKey.trim() };
}

export async function startModelGateway(): Promise<void> {
  const credentials = await readGatewayCredentials();
  const server = createModelGateway(credentials);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(PORT, "127.0.0.1", resolve); });
  const stop = () => {
    const timeout = setTimeout(() => process.exit(0), 5_000);
    timeout.unref();
    server.close(() => { clearTimeout(timeout); process.exit(0); });
  };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startModelGateway().catch(() => { process.exitCode = 1; });
}
