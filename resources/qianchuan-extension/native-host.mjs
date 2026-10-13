import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_MESSAGE_BYTES = 1024 * 1024;
const ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIXED_ERRORS = new Set(["UNAVAILABLE", "CHANGED", "INVALID"]);
const USER_LIST = "/ad/api/v1/account/user-list";
const USER_INFO = "/ad/api/v1/account/user/info";

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
  return plainObject(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

function safeText(value, max = 200) {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isIdentitySnapshot(value) {
  return exactKeys(value, ["tabId", "documentId", "account", "gfversion"]) &&
    Number.isSafeInteger(value.tabId) && value.tabId >= 0 && UUID_PATTERN.test(value.documentId) &&
    exactKeys(value.account, ["advertiserId", "name"]) && ID_PATTERN.test(value.account.advertiserId) && safeText(value.account.name) &&
    typeof value.gfversion === "string" && value.gfversion.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value.gfversion);
}

function validParams(operation, snapshot) {
  const params = operation.params;
  if (!plainObject(params) || params.aavid !== snapshot.account.advertiserId || params.gfversion !== snapshot.gfversion) return false;
  const keys = Object.keys(params);
  if (operation.path === USER_INFO) return keys.length === 2 && keys.every(key => ["aavid", "gfversion"].includes(key));
  if (operation.path !== USER_LIST || keys.length !== 5 || !keys.every(key => ["page", "limit", "keyword", "aavid", "gfversion"].includes(key))) return false;
  return Number.isSafeInteger(params.page) && params.page >= 1 && Number.isSafeInteger(params.limit) && params.limit >= 1 && params.limit <= 100 &&
    typeof params.keyword === "string" && params.keyword.length <= 200 && !/[\u0000-\u001f\u007f]/.test(params.keyword);
}

export function validateOperationCommand(message) {
  if (!exactKeys(message, ["kind", "id", "operation"]) || message.kind !== "command" || !UUID_PATTERN.test(message.id) || !plainObject(message.operation)) return false;
  const operation = message.operation;
  if (operation.kind === "identity") return exactKeys(operation, ["kind"]);
  if (operation.kind === "request") return exactKeys(operation, ["kind", "snapshot", "path", "params", "headers"]) &&
    isIdentitySnapshot(operation.snapshot) && (operation.path === USER_LIST || operation.path === USER_INFO) && validParams(operation, operation.snapshot) &&
    exactKeys(operation.headers, ["qc-date", "qc-key", "qc-auth"]) && Object.values(operation.headers).every(value => safeText(value, 1024));
  if (operation.kind === "switch") return exactKeys(operation, ["kind", "snapshot", "chosen"]) && isIdentitySnapshot(operation.snapshot) &&
    exactKeys(operation.chosen, ["advertiserId", "name"]) && ID_PATTERN.test(operation.chosen.advertiserId) && safeText(operation.chosen.name);
  if (operation.kind === "plans") return exactKeys(operation, ["kind", "snapshot"]) && isIdentitySnapshot(operation.snapshot);
  return false;
}

export function validateCancelEnvelope(message, pendingIds) {
  return exactKeys(message, ["kind", "id"]) && message.kind === "cancel" && UUID_PATTERN.test(message.id) && pendingIds.has(message.id);
}

export function encodeNativeFrame(value) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  if (!bytes.length || bytes.length > MAX_MESSAGE_BYTES) throw new Error("INVALID");
  const frame = Buffer.allocUnsafe(bytes.length + 4);
  frame.writeUInt32LE(bytes.length, 0);
  bytes.copy(frame, 4);
  return frame;
}

export class NativeFrameDecoder {
  #buffer = Buffer.alloc(0);

  push(chunk) {
    if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) throw new Error("INVALID");
    const messages = [];
    const input = Buffer.from(chunk);
    let offset = 0;
    while (offset < input.length) {
      let needed;
      if (this.#buffer.length < 4) needed = 4 - this.#buffer.length;
      else {
        const length = this.#buffer.readUInt32LE(0);
        if (length < 2 || length > MAX_MESSAGE_BYTES) throw new Error("INVALID");
        needed = length + 4 - this.#buffer.length;
      }
      const count = Math.min(needed, input.length - offset);
      this.#buffer = Buffer.concat([this.#buffer, input.subarray(offset, offset + count)]);
      offset += count;
      if (this.#buffer.length < 4) continue;
      const length = this.#buffer.readUInt32LE(0);
      if (length < 2 || length > MAX_MESSAGE_BYTES) throw new Error("INVALID");
      if (this.#buffer.length < length + 4) continue;
      const text = this.#buffer.subarray(4, length + 4).toString("utf8");
      let value;
      try { value = JSON.parse(text); } catch { throw new Error("INVALID"); }
      if (!plainObject(value)) throw new Error("INVALID");
      messages.push(value);
      this.#buffer = this.#buffer.subarray(length + 4);
    }
    return messages;
  }
}

export async function readNativeHostConfig(configPath, callerOrigin, uid = typeof process.getuid === "function" ? process.getuid() : -1) {
  if (typeof configPath !== "string" || !path.isAbsolute(configPath) || typeof callerOrigin !== "string") throw new Error("INVALID");
  let before;
  try { before = await lstat(configPath); } catch { throw new Error("UNAVAILABLE"); }
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== uid || (before.mode & 0o077) !== 0 || before.size < 2 || before.size > 65536) throw new Error("INVALID");
  let handle;
  try { handle = await open(configPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)); } catch { throw new Error("UNAVAILABLE"); }
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.uid !== uid || (after.mode & 0o077) !== 0 || after.size > 65536) throw new Error("INVALID");
    const bytes = await handle.readFile();
    if (bytes.length > 65536) throw new Error("INVALID");
    let config;
    try { config = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("INVALID"); }
    if (!exactKeys(config, ["version", "port", "token", "extensionOrigin"]) || config.version !== 1 ||
      !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
      typeof config.token !== "string" || !/^[A-Za-z0-9._~-]{32,256}$/.test(config.token) ||
      typeof config.extensionOrigin !== "string" || config.extensionOrigin !== callerOrigin ||
      !/^chrome-extension:\/\/[a-p]{32}\/$/.test(config.extensionOrigin)) throw new Error("INVALID");
    return config;
  } finally { await handle.close(); }
}

function parsePpid(statText) {
  const close = statText.lastIndexOf(")");
  if (close < 0) return undefined;
  const fields = statText.slice(close + 1).trim().split(/\s+/);
  const value = Number(fields[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function switchValue(args, name) {
  const prefix = `${name}=`;
  const direct = args.find(argument => argument.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function chromeExecutable(command) {
  const executable = path.basename(command[0] ?? "").toLowerCase();
  return /^(google-chrome|chrome|chromium|chromium-browser)(-stable)?$/.test(executable);
}

function chromeArguments(commandText) {
  if (Buffer.byteLength(commandText, "utf8") > 65536) throw new Error("INVALID");
  const raw = commandText.split("\0").filter(Boolean);
  return raw.length === 1 ? raw[0].split(/ (?=--)/).flatMap(argument => argument.startsWith("--") && !argument.includes("=") ? argument.split(" ") : [argument]) : raw;
}

export async function deriveChromeProfile(startPid = process.ppid, procRoot = "/proc", home = homedir(), hostUid = typeof process.getuid === "function" ? process.getuid() : -1) {
  let pid = startPid;
  for (let depth = 0; depth < 8 && Number.isSafeInteger(pid) && pid > 0; depth++) {
    let statText, commandText, statusText;
    try {
      [statText, commandText, statusText] = await Promise.all([
        readFile(path.join(procRoot, String(pid), "stat"), "utf8"),
        readFile(path.join(procRoot, String(pid), "cmdline"), "utf8"),
        readFile(path.join(procRoot, String(pid), "status"), "utf8"),
      ]);
    } catch { break; }
    const command = chromeArguments(commandText);
    const uidLine = /^Uid:\s+(\d+)/m.exec(statusText);
    const processUid = uidLine ? Number(uidLine[1]) : NaN;
    if (chromeExecutable(command) && !command.some(argument => argument === "--type" || argument.startsWith("--type=")) && processUid === hostUid) {
      const userData = switchValue(command, "--user-data-dir") || path.join(home, ".config", "google-chrome");
      const profileDirectory = switchValue(command, "--profile-directory") || "Default";
      if (!path.isAbsolute(userData) || !profileDirectory || path.basename(profileDirectory) !== profileDirectory || profileDirectory === "." || profileDirectory === "..") throw new Error("INVALID");
      return { pid, profile: path.resolve(userData), profileDirectory };
    }
    const parent = parsePpid(statText);
    if (!parent || parent === pid) break;
    pid = parent;
  }
  throw new Error("UNAVAILABLE");
}

function validateProjectedValue(operation, value) {
  if (operation.kind === "identity" || operation.kind === "switch") return isIdentitySnapshot(value);
  if (operation.kind === "plans") return Array.isArray(value) && value.length <= 1000 && value.every(plan => exactKeys(plan, ["advertiserId", "adId", "name"]) &&
    plan.advertiserId === operation.snapshot.account.advertiserId && ID_PATTERN.test(plan.adId) && safeText(plan.name));
  if (operation.path === USER_LIST) return exactKeys(value, ["kind", "accounts", "totalPages", "totalCount", "currentPage"]) && value.kind === "user-list" &&
    Array.isArray(value.accounts) && value.accounts.length <= 100 && value.accounts.every(account => exactKeys(account, ["advertiserId", "name"]) && ID_PATTERN.test(account.advertiserId) && safeText(account.name)) &&
    [value.totalPages, value.totalCount, value.currentPage].every(number => Number.isSafeInteger(number) && number >= 0);
  return exactKeys(value, ["kind", "accountInfo"]) && value.kind === "user-info" && exactKeys(value.accountInfo, ["advId", "advName"]) &&
    value.accountInfo.advId === operation.snapshot.account.advertiserId && safeText(value.accountInfo.advName);
}

function validExtensionResult(message, operation, id) {
  if (!plainObject(message) || message.kind !== "result" || message.id !== id || typeof message.ok !== "boolean") return false;
  if (!message.ok) return exactKeys(message, ["kind", "id", "ok", "error"]) && FIXED_ERRORS.has(message.error);
  return exactKeys(message, ["kind", "id", "ok", "value"]) && validateProjectedValue(operation, message.value);
}

function writeLine(socket, value) {
  const line = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (line.length > MAX_MESSAGE_BYTES + 1) throw new Error("INVALID");
  socket.write(line);
}

export async function runNativeHost({ argv = process.argv, stdin = process.stdin, stdout = process.stdout, createConnection = net.createConnection,
  procRoot = "/proc", startPid = process.ppid, home = homedir(), hostUid = typeof process.getuid === "function" ? process.getuid() : -1 } = {}) {
  const callerOrigin = argv[3];
  const config = await readNativeHostConfig(argv[2], callerOrigin, hostUid);
  const browser = await deriveChromeProfile(startPid, procRoot, home, hostUid);
  const socket = createConnection({ host: "127.0.0.1", port: config.port });
  const pending = new Map();
  const decoder = new NativeFrameDecoder();
  let lineBuffer = Buffer.alloc(0);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    socket.destroy();
    stdin.pause?.();
  };
  const finishConnect = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error("UNAVAILABLE")); }, 10_000);
    socket.once("connect", () => { clearTimeout(timeout); resolve(); });
    socket.once("error", error => { clearTimeout(timeout); reject(error); });
  });
  await finishConnect;
  writeLine(socket, { kind: "hello", version: 1, token: config.token, ...browser });
  socket.on("data", chunk => {
    if (closed) return;
    lineBuffer = Buffer.concat([lineBuffer, Buffer.from(chunk)]);
    if (lineBuffer.length > MAX_MESSAGE_BYTES + 1 && !lineBuffer.includes(10)) { close(); return; }
    for (;;) {
      const newline = lineBuffer.indexOf(10);
      if (newline < 0) break;
      if (newline > MAX_MESSAGE_BYTES) { close(); return; }
      const line = lineBuffer.subarray(0, newline);
      lineBuffer = lineBuffer.subarray(newline + 1);
      let command;
      try { command = JSON.parse(line.toString("utf8")); } catch { close(); return; }
      if (command?.kind === "cancel") {
        if (!validateCancelEnvelope(command, pending)) { close(); return; }
        try { stdout.write(encodeNativeFrame(command)); } catch { close(); return; }
        continue;
      }
      if (!validateOperationCommand(command) || pending.has(command.id) || pending.size >= 64) { close(); return; }
      pending.set(command.id, command.operation);
      try { stdout.write(encodeNativeFrame(command)); } catch { close(); return; }
    }
    if (lineBuffer.length > MAX_MESSAGE_BYTES + 1) close();
  });
  socket.on("error", close);
  socket.on("end", close);
  socket.on("close", close);
  stdin.on("data", chunk => {
    if (closed) return;
    let messages;
    try { messages = decoder.push(chunk); } catch { close(); return; }
    for (const message of messages) {
      const operation = pending.get(message.id);
      if (!operation || !validExtensionResult(message, operation, message.id)) { close(); return; }
      pending.delete(message.id);
      try { writeLine(socket, message); } catch { close(); return; }
    }
  });
  stdin.on("end", close);
  stdin.on("error", close);
  stdin.resume?.();
  return { close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runNativeHost().catch(() => { process.exitCode = 1; });
}
