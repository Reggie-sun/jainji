import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicWriteJson } from "./store.js";
import { BugFeedbackSchema, FEEDBACK_REPOSITORY, FeedbackReceiptSchema, MAX_FEEDBACK_IMAGE_BYTES, redactFeedback, type BugFeedback, type FeedbackHistoryEntry, type FeedbackReceipt, type FeedbackStatus } from "../shared/bug-feedback.js";

const uncertainMessage = "提交结果尚未确认。再次点击提交会核对已有 Issue，不会重复创建；也可打开仓库 Issues 检查。";
export class FeedbackError extends Error {}
const tokenSchema = z.string().trim().max(500).refine((value) => !/\s/.test(value), "GitHub Token 格式不正确。");
const recordSchema = z.object({
  fingerprint: z.string(),
  createdAt: z.string().datetime(),
  state: z.enum(["ready", "pending", "submitted"]),
  screenshotExtension: z.enum([".png", ".jpg", ".webp"]).optional(),
  receipt: FeedbackReceiptSchema.optional(),
  submission: BugFeedbackSchema.omit({ screenshot: true }),
}).strict();
type RecordState = z.infer<typeof recordSchema>;

export class BugFeedbackService {
  private readonly root: string;
  private serial: Promise<unknown> = Promise.resolve();

  constructor(
    userData: string,
    private readonly context: { version: string; platform: string },
    private readonly fetcher: typeof fetch = fetch,
    private readonly environmentToken = process.env.JIANJI_GITHUB_TOKEN ?? "",
  ) { this.root = path.join(userData, "bug-feedback"); }

  async status(): Promise<FeedbackStatus> {
    const configured = Boolean(await this.token());
    return { configured, repository: FEEDBACK_REPOSITORY, credentialSource: this.environmentToken.trim() ? "environment" : configured ? "local" : "none" };
  }

  async saveToken(input: unknown): Promise<FeedbackStatus> {
    const token = tokenSchema.parse(input);
    const operation = this.serial.catch(() => undefined).then(() => this.writeToken(token));
    this.serial = operation;
    await operation;
    return this.status();
  }

  private async writeToken(token: string): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const file = path.join(this.root, "credentials.json");
    // Credentials must never use the project store's previous-version backup.
    if (token) {
      const temporary = `${file}.tmp-${randomUUID()}`;
      try {
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify({ token })); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, file);
      } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
    } else await unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    await unlink(`${file}.bak`).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }

  submit(input: unknown): Promise<FeedbackReceipt> {
    const parsed = BugFeedbackSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(new FeedbackError("请填写 5–8000 字的问题描述，截图仅支持不超过 5 MB 的 PNG、JPEG 或 WebP。"));
    const result = this.serial.catch(() => undefined).then(() => this.submitLocked(parsed.data));
    this.serial = result;
    return result;
  }

  async history(): Promise<FeedbackHistoryEntry[]> {
    let files: string[];
    try { files = await readdir(this.root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const entries: FeedbackHistoryEntry[] = [];
    for (const file of files.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))) {
      const id = z.string().uuid().parse(file.slice(0, -5));
      const record = await this.readRecord(id);
      if (record) entries.push({ feedbackId: id, createdAt: record.createdAt, description: record.submission.description, ...(record.receipt ? { receipt: record.receipt } : {}) });
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  }

  resume(feedbackId: unknown): Promise<FeedbackReceipt> {
    const id = z.string().uuid().parse(feedbackId);
    const result = this.serial.catch(() => undefined).then(async () => {
      const record = await this.readRecord(id);
      if (!record) throw new FeedbackError("未找到本地反馈记录。");
      if (record.receipt) return record.receipt;
      const extension = record.screenshotExtension;
      const screenshot = extension ? { contentType: extension === ".png" ? "image/png" as const : extension === ".jpg" ? "image/jpeg" as const : "image/webp" as const, dataBase64: (await readFile(await this.screenshotPath(id))).toString("base64") } : undefined;
      return this.submitLocked({ ...record.submission, ...(screenshot ? { screenshot } : {}) }, record.fingerprint);
    });
    this.serial = result;
    return result;
  }

  async issueUrl(feedbackId: unknown): Promise<string> {
    const id = z.string().uuid().parse(feedbackId);
    const record = await this.readRecord(id);
    if (!record?.receipt || record.receipt.feedbackId !== id) throw new FeedbackError("尚无已确认的 Issue。");
    return record.receipt.issueUrl;
  }

  async screenshotPath(feedbackId: unknown): Promise<string> {
    const id = z.string().uuid().parse(feedbackId);
    const record = await this.readRecord(id);
    if (!record?.screenshotExtension) throw new FeedbackError("未找到本地截图。");
    const file = path.join(this.root, `${id}${record.screenshotExtension}`);
    if (!(await stat(file)).isFile()) throw new FeedbackError("未找到本地截图。");
    return file;
  }

  private async token(): Promise<string> {
    if (this.environmentToken.trim()) return tokenSchema.parse(this.environmentToken);
    try { return z.object({ token: tokenSchema }).parse(JSON.parse(await readFile(path.join(this.root, "credentials.json"), "utf8"))).token; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw new FeedbackError("GitHub 配置读取失败，请重新保存 Token。");
    }
  }

  private recordPath(id: string): string { return path.join(this.root, `${id}.json`); }

  private async readRecord(id: string): Promise<RecordState | undefined> {
    try {
      const record = recordSchema.parse(JSON.parse(await readFile(this.recordPath(id), "utf8")));
      if (record.submission.feedbackId !== id || (record.receipt && record.receipt.feedbackId !== id)) throw new FeedbackError("record identity mismatch");
      return record;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new FeedbackError("本地反馈记录无法读取，请先到 GitHub 核对，避免重复提交。");
    }
  }

  private async submitLocked(input: BugFeedback, resumedFingerprint?: string): Promise<FeedbackReceipt> {
    const image = this.validateImage(input);
    const fingerprint = resumedFingerprint ?? createHash("sha256").update(JSON.stringify(input)).digest("hex");
    let record = await this.readRecord(input.feedbackId);
    if (record && record.fingerprint !== fingerprint) throw new FeedbackError("同一反馈不能更改内容后重试，请开始新的反馈。");
    if (record?.receipt) return record.receipt;
    const token = await this.token();
    if (!token) throw new FeedbackError("请先配置 GitHub Token，再提交问题。");
    if (record?.state === "pending") {
      const existing = await this.findIssue(input, record, token);
      if (!existing) throw new FeedbackError(uncertainMessage);
      await atomicWriteJson(this.recordPath(input.feedbackId), { ...record, state: "submitted", receipt: existing });
      return existing;
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (!record) {
      record = recordSchema.parse({ fingerprint, createdAt: new Date().toISOString(), state: "ready", submission: { feedbackId: input.feedbackId, description: redactFeedback(input.description.replaceAll(token, "[REDACTED]")), page: input.page }, ...(image ? { screenshotExtension: image.extension } : {}) });
      if (image) {
        const target = path.join(this.root, `${input.feedbackId}${image.extension}`);
        try { await writeFile(target, image.bytes, { flag: "wx", mode: 0o600 }); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await readFile(target)).equals(image.bytes)) throw new FeedbackError("本地截图保存失败，请开始新的反馈。");
        }
      }
    }
    // Durable intent precedes the remote write. An interrupted POST is only reconciled, never replayed.
    record.state = "pending";
    await atomicWriteJson(this.recordPath(input.feedbackId), record);
    const description = record.submission.description;
    const body = [
      `## Description\n${description}`,
      `## Screenshot\n${image ? "截图已保存在提交者本机，未上传。可在 Issue 页面手动附加。" : "未提供截图。"}`,
      `## Client Context\napp_version: ${this.context.version}\nplatform: ${this.context.platform}\npage: ${input.page}\noccurred_at: ${record.createdAt}`,
      `<!-- bug-feedback-id:${input.feedbackId} -->`,
    ].join("\n\n");
    let response: Response;
    try {
      response = await this.request(`/repos/${FEEDBACK_REPOSITORY}/issues`, token, {
        method: "POST", body: JSON.stringify({ title: `[简辑 Bug] ${description.split(/\r?\n/)[0].slice(0, 100)}`, body }),
      });
    } catch { throw new FeedbackError(uncertainMessage); }
    if (!response.ok) {
      // These explicit rejections cannot have created an issue; server errors remain uncertain.
      if ([400, 401, 403, 404, 410, 422, 429].includes(response.status)) {
        record.state = "ready";
        await atomicWriteJson(this.recordPath(input.feedbackId), record);
        throw new FeedbackError(this.responseError(response));
      }
      throw new FeedbackError(uncertainMessage);
    }
    let receipt: FeedbackReceipt;
    try { receipt = this.receipt(await response.json(), input); }
    catch { throw new FeedbackError(uncertainMessage); }
    await atomicWriteJson(this.recordPath(input.feedbackId), { ...record, state: "submitted", receipt });
    return receipt;
  }

  private validateImage(input: BugFeedback): { bytes: Buffer; extension: ".png" | ".jpg" | ".webp" } | undefined {
    if (!input.screenshot) return;
    const { contentType, dataBase64 } = input.screenshot;
    const bytes = Buffer.from(dataBase64, "base64");
    const valid = contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : contentType === "image/jpeg" ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        : bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!valid || !bytes.length || bytes.length > MAX_FEEDBACK_IMAGE_BYTES || bytes.toString("base64") !== dataBase64) throw new FeedbackError("截图内容无效，仅支持不超过 5 MB 的 PNG、JPEG 或 WebP。");
    return { bytes, extension: contentType === "image/png" ? ".png" : contentType === "image/jpeg" ? ".jpg" : ".webp" };
  }

  private request(resource: string, token: string, options: RequestInit = {}): Promise<Response> {
    return this.fetcher(`https://api.github.com${resource}`, {
      ...options, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "jianji-bug-feedback" },
    });
  }

  private responseError(response: Response): string {
    if (response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) return "GitHub 请求限流，请稍后重试。";
    if (response.status === 401) return "GitHub Token 无效或已过期，请重新配置。";
    if (response.status === 403 || response.status === 404) return "GitHub 拒绝访问，请检查 Token 的仓库访问权限和 Issues 写入权限。";
    if (response.status === 422) return "GitHub 拒绝了反馈内容，请检查描述或稍后重试。";
    return "GitHub 暂时无法处理请求，请稍后重试。";
  }

  private receipt(payload: unknown, input: BugFeedback): FeedbackReceipt {
    const parsed = z.object({ number: z.number(), html_url: z.string() }).parse(payload);
    return FeedbackReceiptSchema.parse({ feedbackId: input.feedbackId, issueNumber: parsed.number, issueUrl: parsed.html_url, hasScreenshot: Boolean(input.screenshot) });
  }

  private async findIssue(input: BugFeedback, record: RecordState, token: string): Promise<FeedbackReceipt | undefined> {
    // List, rather than search, avoids GitHub's asynchronous search-index delay.
    const since = new Date(Date.parse(record.createdAt) - 5 * 60_000).toISOString();
    for (let page = 1; page <= 10; page += 1) {
      let response: Response;
      try { response = await this.request(`/repos/${FEEDBACK_REPOSITORY}/issues?state=all&sort=created&direction=desc&since=${encodeURIComponent(since)}&per_page=100&page=${page}`, token); }
      catch { throw new FeedbackError(uncertainMessage); }
      if (!response.ok) throw new FeedbackError(this.responseError(response));
      let issues: unknown;
      try { issues = await response.json(); } catch { throw new FeedbackError(uncertainMessage); }
      if (!Array.isArray(issues)) throw new FeedbackError(uncertainMessage);
      for (const value of issues) {
        if (value && typeof value === "object" && !value.pull_request && typeof value.body === "string" && value.body.split("\n").includes(`<!-- bug-feedback-id:${input.feedbackId} -->`)) {
          try { return this.receipt(value, input); } catch { throw new FeedbackError(uncertainMessage); }
        }
      }
      if (issues.length < 100) return;
    }
    throw new FeedbackError(uncertainMessage);
  }
}
