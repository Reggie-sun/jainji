import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { accountAvailable, accountSummary, parseAccountConfig, QianchuanProductSchema, type QianchuanAccount, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account.js";

const MAX_CONFIG_BYTES = 64 * 1024;
type ConfigErrorCode = "CONFIG_NOT_AUTHORIZED" | "CONFIG_PATH_INVALID" | "CONFIG_FILE_UNSAFE" | "CONFIG_TOO_LARGE" | "CONFIG_INVALID" | "CONFIG_UNAVAILABLE" | "CONFIG_CHANGED" | "ACCOUNT_UNAVAILABLE" | "PLATFORM_UNQUALIFIED";
const messages: Record<ConfigErrorCode, string> = {
  CONFIG_NOT_AUTHORIZED: "请先在简辑中设置千川账号。",
  CONFIG_PATH_INVALID: "账号配置需要有效的本机绝对路径。",
  CONFIG_FILE_UNSAFE: "账号配置必须是当前用户拥有的私有普通文件，不能使用符号链接。",
  CONFIG_TOO_LARGE: "账号配置不能超过 64 KiB。",
  CONFIG_INVALID: "千川账号配置格式无效，请检查六产品映射。",
  CONFIG_UNAVAILABLE: "无法读取千川账号配置，请重新选择可用文件。",
  CONFIG_CHANGED: "账号配置已变化，请重新选择账号后制作。",
  ACCOUNT_UNAVAILABLE: "所选产品没有可用的广告账户和计划配置。",
  PLATFORM_UNQUALIFIED: "当前平台尚未通过账号文件权限验证，千川上传保持阻断。",
};
export class QianchuanAccountConfigError extends Error {
  constructor(readonly code: ConfigErrorCode) { super(messages[code]); this.name = "QianchuanAccountConfigError"; }
}
export type FrozenQianchuanAccount = Readonly<QianchuanAccount & { configDigest: string }>;
export interface ConfigSnapshot { accounts: QianchuanAccount[]; digest: string; }

function assertPrivateFile(info: Stats): void {
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o7777 & ~0o600) || info.uid !== process.getuid!()) {
    throw new QianchuanAccountConfigError("CONFIG_FILE_UNSAFE");
  }
  if (info.size > MAX_CONFIG_BYTES) throw new QianchuanAccountConfigError("CONFIG_TOO_LARGE");
}
function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.mode === right.mode && left.uid === right.uid;
}

export async function readPrivateJson<T>(file: string, parse: (input: unknown) => T): Promise<{ value: T; digest: string }> {
  if (process.platform === "win32" || !process.getuid) throw new QianchuanAccountConfigError("PLATFORM_UNQUALIFIED");
  try {
    const before = await lstat(file);
    assertPrivateFile(before);
    if (await realpath(file) !== file) throw new QianchuanAccountConfigError("CONFIG_FILE_UNSAFE");
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat();
      assertPrivateFile(opened);
      if (!sameFile(before, opened)) throw new QianchuanAccountConfigError("CONFIG_CHANGED");
      // Bound reads even if another process grows the file after stat.
      const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_CONFIG_BYTES) throw new QianchuanAccountConfigError("CONFIG_TOO_LARGE");
      const after = await handle.stat();
      const current = await lstat(file);
      assertPrivateFile(after); assertPrivateFile(current);
      if (!sameFile(opened, after) || !sameFile(after, current) || length !== after.size || await realpath(file) !== file) {
        throw new QianchuanAccountConfigError("CONFIG_CHANGED");
      }
      const content = bytes.subarray(0, length);
      try {
        const value = parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)));
        return { value, digest: createHash("sha256").update(content).digest("hex") };
      } catch { throw new QianchuanAccountConfigError("CONFIG_INVALID"); }
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof QianchuanAccountConfigError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new QianchuanAccountConfigError("CONFIG_FILE_UNSAFE");
    throw new QianchuanAccountConfigError("CONFIG_UNAVAILABLE");
  }
}

export async function readPrivateConfig(file: string, parse = parseAccountConfig): Promise<ConfigSnapshot> {
  const snapshot = await readPrivateJson(file, parse);
  return { accounts: snapshot.value, digest: snapshot.digest };
}

/** Main-process owner: only the trusted file-dialog/settings path may authorize a file.
 * Renderer requests supply a product only; they cannot call authorizeFile or supply a digest.
 */
export class QianchuanAccountConfigReader {
  private authorizedPath?: string;
  constructor(private readonly parse = parseAccountConfig) {}

  async authorizeFile(file: string): Promise<QianchuanAccountSummary[]> {
    if (typeof file !== "string" || !file || file.length > 4096 || file.includes("\0") || !path.isAbsolute(file)) {
      throw new QianchuanAccountConfigError("CONFIG_PATH_INVALID");
    }
    const normalized = path.resolve(file);
    const snapshot = await readPrivateConfig(normalized, this.parse);
    this.authorizedPath = normalized;
    return snapshot.accounts.map(accountSummary);
  }
  private async read(): Promise<ConfigSnapshot> {
    const file = this.authorizedPath;
    if (!file) throw new QianchuanAccountConfigError("CONFIG_NOT_AUTHORIZED");
    const snapshot = await readPrivateConfig(file, this.parse);
    if (this.authorizedPath !== file) throw new QianchuanAccountConfigError("CONFIG_CHANGED");
    return snapshot;
  }
  async refresh(): Promise<QianchuanAccountSummary[]> { return (await this.read()).accounts.map(accountSummary); }
  private selected(snapshot: ConfigSnapshot, product: QianchuanProduct): FrozenQianchuanAccount {
    const parsed = QianchuanProductSchema.safeParse(product);
    const account = parsed.success ? snapshot.accounts.find(value => value.product === parsed.data) : undefined;
    if (!account || !accountAvailable(account)) throw new QianchuanAccountConfigError("ACCOUNT_UNAVAILABLE");
    return Object.freeze({ ...account, configDigest: snapshot.digest });
  }
  async preflight(product: QianchuanProduct): Promise<FrozenQianchuanAccount> { return this.selected(await this.read(), product); }
  async prepare(product: QianchuanProduct): Promise<FrozenQianchuanAccount> { return this.preflight(product); }
  async freeze(product: QianchuanProduct, expectedDigest: string): Promise<FrozenQianchuanAccount> {
    const snapshot = await this.read();
    if (snapshot.digest !== expectedDigest) throw new QianchuanAccountConfigError("CONFIG_CHANGED");
    return this.selected(snapshot, product);
  }
}
