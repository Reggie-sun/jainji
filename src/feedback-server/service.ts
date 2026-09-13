import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FEEDBACK_REPOSITORY, FeedbackReceiptSchema, FeedbackSubmissionSchema, MAX_FEEDBACK_IMAGE_BYTES, redactFeedback, type FeedbackReceipt, type FeedbackSubmission } from "../shared/bug-feedback.js";

const MAX_BODY_BYTES = 7_100_000;
const MAX_IN_FLIGHT = 4;
const MAX_CONNECTIONS = 16;
const MAX_SCREENSHOT_STORAGE_BYTES = 512 * 1024 * 1024;
const DEFAULT_TIMEOUTS = { headersMs: 5_000, bodyMs: 10_000, socketMs: 15_000 };
const MARKER = "bug-feedback-id";
const screenshotSchema = z.object({ extension: z.enum([".png", ".jpg", ".webp"]), contentType: z.enum(["image/png", "image/jpeg", "image/webp"]) }).strict();
const storedSubmissionSchema = FeedbackSubmissionSchema.omit({ screenshot: true });
const recordSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  state: z.enum(["ready", "pending", "submitted"]),
  submission: storedSubmissionSchema,
  screenshot: screenshotSchema.optional(),
  receipt: FeedbackReceiptSchema.optional(),
}).strict();
const rateEventSchema = z.object({ at: z.number().int().nonnegative(), feedbackId: z.string().uuid(), ip: z.string().max(100) }).strict();
const rateSchema = z.object({ newIssues: z.array(rateEventSchema), githubAttempts: z.array(rateEventSchema) }).strict();
type RelayRecord = z.infer<typeof recordSchema>;

export type FeedbackServerOptions = {
  directory: string;
  token: string;
  publicUrl: string;
  fetcher?: typeof fetch;
  trustCloudflare?: boolean;
  /** Test-only overrides; production callers use conservative defaults. */
  timeouts?: Partial<typeof DEFAULT_TIMEOUTS>;
  /** Test-only override; production keeps a 512 MiB non-evicting screenshot budget. */
  screenshotBudgetBytes?: number;
};

class RelayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function createFeedbackServer(options: FeedbackServerOptions): Server {
  const timeouts = requestTimeouts(options.timeouts);
  const relay = new FeedbackRelay(options, timeouts.bodyMs, screenshotBudget(options.screenshotBudgetBytes));
  let inFlight = 0;
  const server = createServer((request, response) => {
    if (inFlight >= MAX_IN_FLIGHT) { reply(response, 503, { error: "服务繁忙，请稍后重试。" }); return; }
    inFlight += 1;
    let handlerSettled = false;
    let responseSettled = false;
    let released = false;
    const deadline = setTimeout(() => response.destroy(), timeouts.socketMs);
    deadline.unref();
    const release = () => {
      if (!released && handlerSettled && responseSettled) { released = true; clearTimeout(deadline); inFlight -= 1; }
    };
    const responseDone = () => { responseSettled = true; release(); };
    response.once("finish", responseDone); response.once("close", responseDone);
    response.setTimeout(timeouts.socketMs, () => response.destroy());
    void relay.handle(request, response).catch(() => reply(response, 500, { error: "反馈服务暂时不可用，请稍后重试。" })).finally(() => { handlerSettled = true; release(); });
  });
  server.headersTimeout = timeouts.headersMs;
  server.requestTimeout = timeouts.bodyMs;
  server.timeout = timeouts.socketMs;
  server.keepAliveTimeout = Math.min(5_000, timeouts.socketMs);
  server.maxConnections = MAX_CONNECTIONS;
  server.on("timeout", (socket) => socket.destroy());
  return server;
}

class FeedbackRelay {
  private readonly publicUrl: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private serial: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: FeedbackServerOptions, private readonly bodyTimeoutMs: number, private readonly screenshotBudgetBytes: number) {
    this.publicUrl = normalizePublicUrl(options.publicUrl);
    this.token = options.token.trim();
    this.fetcher = options.fetcher ?? fetch;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      reply(response, 200, { ok: true, service: "jianji-feedback", repository: FEEDBACK_REPOSITORY });
      return;
    }
    const screenshotId = /^\/api\/feedback\/([0-9a-f-]{36})\/screenshot$/.exec(url.pathname)?.[1];
    if (request.method === "GET" && screenshotId) { await this.screenshot(screenshotId, response); return; }
    if (url.pathname !== "/api/feedback") { reply(response, 404, { error: "未找到接口。" }); return; }
    if (request.method !== "POST") { reply(response, 405, { error: "请求方法不支持。" }); return; }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) { reply(response, 415, { error: "请求内容类型必须为 application/json。" }); return; }
    try {
      const input = await readRequestJson(request, this.bodyTimeoutMs);
      const receipt = await this.lock(() => this.submit(input, clientIp(request, Boolean(this.options.trustCloudflare))));
      reply(response, 201, receipt);
    } catch (error) {
      const known = error instanceof RelayError ? error : new RelayError(500, "反馈服务暂时不可用，请稍后重试。");
      reply(response, known.status, { error: known.message });
    }
  }

  private lock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.serial.catch(() => undefined).then(operation);
    this.serial = next;
    return next;
  }

  private async submit(raw: unknown, ip: string): Promise<FeedbackReceipt> {
    const submission = sanitizeSubmission(raw, this.token);
    const image = validateScreenshot(submission);
    const fingerprint = createHash("sha256").update(JSON.stringify(submission)).digest("hex");
    let record = await this.readRecord(submission.feedbackId);
    if (record && record.fingerprint !== fingerprint) throw new RelayError(409, "同一反馈不能更改内容后重试，请创建新的反馈。");
    if (record?.receipt) return record.receipt;
    if (!this.token) throw new RelayError(503, "反馈服务尚未配置，请稍后重试。");
    if (record?.state === "pending") {
      await this.spendGithubAttempt(submission.feedbackId, ip);
      const receipt = await this.findIssue(record);
      if (!receipt) throw new RelayError(502, "提交结果尚未确认，请稍后用相同反馈重试核对。");
      record = { ...record, state: "submitted", receipt };
      await writeJson(this.recordPath(submission.feedbackId), record);
      return receipt;
    }
    if (!record) {
      await this.spendQuota(submission.feedbackId, ip);
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
      const screenshot = image ? { extension: image.extension, contentType: image.contentType } : undefined;
      if (image) {
        await this.ensureScreenshotBudget(image.bytes.length);
        await this.saveScreenshot(submission.feedbackId, image.extension, image.bytes);
      }
      record = recordSchema.parse({
        fingerprint, createdAt: new Date().toISOString(), state: "ready",
        submission: { feedbackId: submission.feedbackId, description: submission.description, page: submission.page, client: submission.client },
        ...(screenshot ? { screenshot } : {}),
      });
      await writeJson(this.recordPath(submission.feedbackId), record);
    }
    await this.spendGithubAttempt(submission.feedbackId, ip);
    record = { ...record, state: "pending" };
    await writeJson(this.recordPath(submission.feedbackId), record);
    let response: Response;
    try { response = await this.github(`/repos/${FEEDBACK_REPOSITORY}/issues`, { method: "POST", body: JSON.stringify(this.issuePayload(record)) }); }
    catch { throw new RelayError(502, "提交结果尚未确认，请稍后用相同反馈重试核对。"); }
    if (!response.ok) {
      if ([401, 403, 404, 422, 429].includes(response.status)) {
        await writeJson(this.recordPath(submission.feedbackId), { ...record, state: "ready" });
        throw new RelayError(response.status === 429 ? 429 : 502, githubRejection(response.status));
      }
      throw new RelayError(502, "提交结果尚未确认，请稍后用相同反馈重试核对。");
    }
    let receipt: FeedbackReceipt;
    try { receipt = parseReceipt(await response.json(), submission.feedbackId, Boolean(record.screenshot)); }
    catch { throw new RelayError(502, "提交结果尚未确认，请稍后用相同反馈重试核对。"); }
    await writeJson(this.recordPath(submission.feedbackId), { ...record, state: "submitted", receipt });
    return receipt;
  }

  private issuePayload(record: RelayRecord): { title: string; body: string } {
    const title = `[简辑 Bug] ${record.submission.description.split(/\r?\n/)[0].slice(0, 100)}`;
    const screenshot = record.screenshot ? `![Submitted screenshot](${this.publicUrl}/api/feedback/${record.submission.feedbackId}/screenshot)` : "未提供截图。";
    return { title, body: [
      `## Description\n${record.submission.description}`,
      `## Screenshot\n${screenshot}`,
      `## Client Context\napp_version: ${record.submission.client.version}\nplatform: ${record.submission.client.platform}\npage: ${record.submission.page}\nreceived_at: ${record.createdAt}`,
      `<!-- ${MARKER}:${record.submission.feedbackId} -->`,
    ].join("\n\n") };
  }

  private async findIssue(record: RelayRecord): Promise<FeedbackReceipt | undefined> {
    const since = new Date(Date.parse(record.createdAt) - 5 * 60_000).toISOString();
    for (let page = 1; page <= 10; page += 1) {
      let response: Response;
      try { response = await this.github(`/repos/${FEEDBACK_REPOSITORY}/issues?state=all&sort=created&direction=desc&since=${encodeURIComponent(since)}&per_page=100&page=${page}`); }
      catch { throw new RelayError(502, "提交结果尚未确认，请稍后用相同反馈重试核对。"); }
      if (!response.ok) throw new RelayError(response.status === 429 ? 429 : 502, githubRejection(response.status));
      let issues: unknown;
      try { issues = await response.json(); } catch { throw new RelayError(502, "提交结果尚未确认，请稍后用相同反馈重试核对。"); }
      if (!Array.isArray(issues)) throw new RelayError(502, "提交结果尚未确认，请稍后用相同反馈重试核对。");
      for (const value of issues) {
        if (value && typeof value === "object" && !("pull_request" in value) && "body" in value && typeof value.body === "string" && value.body.includes(`<!-- ${MARKER}:${record.submission.feedbackId} -->`)) {
          try { return parseReceipt(value, record.submission.feedbackId, Boolean(record.screenshot)); }
          catch { throw new RelayError(502, "提交结果尚未确认，请稍后用相同反馈重试核对。"); }
        }
      }
      if (issues.length < 100) return undefined;
    }
    throw new RelayError(502, "提交结果尚未确认，请稍后用相同反馈重试核对。");
  }

  private async github(resource: string, init: RequestInit = {}): Promise<Response> {
    return this.fetcher(`https://api.github.com${resource}`, {
      ...init, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "jianji-feedback-relay" },
    });
  }

  private async screenshot(rawId: string, response: ServerResponse): Promise<void> {
    const parsed = z.string().uuid().safeParse(rawId);
    if (!parsed.success) { reply(response, 404, { error: "未找到截图。" }); return; }
    let record: RelayRecord | undefined;
    try { record = await this.readRecord(parsed.data); } catch { reply(response, 404, { error: "未找到截图。" }); return; }
    if (!record?.screenshot) { reply(response, 404, { error: "未找到截图。" }); return; }
    const file = path.join(this.options.directory, `${parsed.data}${record.screenshot.extension}`);
    try {
      if (!(await stat(file)).isFile()) throw new Error("missing");
      const data = await readFile(file);
      response.writeHead(200, { "Content-Type": record.screenshot.contentType, "Content-Length": data.length, "Cache-Control": "private, max-age=0", "X-Content-Type-Options": "nosniff" });
      response.end(data);
    } catch { reply(response, 404, { error: "未找到截图。" }); }
  }

  private async spendQuota(feedbackId: string, ip: string): Promise<void> {
    const now = Date.now();
    const state = await this.rates();
    const newIssues = state.newIssues.filter((event) => event.at > now - 60 * 60_000);
    const githubAttempts = state.githubAttempts.filter((event) => event.at > now - 60 * 60_000);
    if (newIssues.length >= 30 || newIssues.filter((event) => event.ip === ip).length >= 5) throw new RelayError(429, "提交过于频繁，请稍后再试。" );
    newIssues.push({ at: now, feedbackId, ip });
    await writeJson(path.join(this.options.directory, "rates.json"), { newIssues, githubAttempts });
  }

  private async spendGithubAttempt(feedbackId: string, ip: string): Promise<void> {
    const now = Date.now();
    const state = await this.rates();
    const newIssues = state.newIssues.filter((event) => event.at > now - 60 * 60_000);
    const githubAttempts = state.githubAttempts.filter((event) => event.at > now - 60 * 60_000);
    if (githubAttempts.length >= 120 || githubAttempts.filter((event) => event.ip === ip).length >= 20) throw new RelayError(429, "GitHub 核对过于频繁，请稍后再试。" );
    githubAttempts.push({ at: now, feedbackId, ip });
    await writeJson(path.join(this.options.directory, "rates.json"), { newIssues, githubAttempts });
  }

  private async rates(): Promise<z.infer<typeof rateSchema>> {
    try { return rateSchema.parse(JSON.parse(await readFile(path.join(this.options.directory, "rates.json"), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new RelayError(500, "反馈服务暂时不可用，请稍后重试。"); }
    return { newIssues: [], githubAttempts: [] };
  }

  private async saveScreenshot(id: string, extension: ".png" | ".jpg" | ".webp", bytes: Buffer): Promise<void> {
    const file = path.join(this.options.directory, `${id}${extension}`);
    try { await writeFile(file, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await readFile(file)).equals(bytes)) throw new RelayError(409, "同一反馈截图内容不一致，请创建新的反馈。");
    }
  }

  private async ensureScreenshotBudget(nextSize: number): Promise<void> {
    let entries: Dirent[];
    try { entries = await readdir(this.options.directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new RelayError(500, "反馈服务暂时不可用，请稍后重试。");
    }
    let used = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(entry.name)) continue;
      used += (await stat(path.join(this.options.directory, entry.name))).size;
      if (used + nextSize > this.screenshotBudgetBytes) throw new RelayError(507, "截图存储空间已满，请不附截图提交或稍后再试。");
    }
    if (used + nextSize > this.screenshotBudgetBytes) throw new RelayError(507, "截图存储空间已满，请不附截图提交或稍后再试。");
  }

  private recordPath(id: string): string { return path.join(this.options.directory, `${id}.json`); }

  private async readRecord(id: string): Promise<RelayRecord | undefined> {
    try {
      const record = recordSchema.parse(JSON.parse(await readFile(this.recordPath(id), "utf8")));
      if (record.submission.feedbackId !== id || (record.receipt && record.receipt.feedbackId !== id)) throw new Error("identity");
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new RelayError(500, "反馈记录无法读取，请勿重复提交。" );
    }
  }
}

function sanitizeSubmission(raw: unknown, token: string): FeedbackSubmission {
  const initial = FeedbackSubmissionSchema.safeParse(raw);
  if (!initial.success) throw new RelayError(400, "反馈内容无效，请填写完整的问题描述和客户端信息。" );
  const redact = (value: string) => redactFeedback(token ? value.replaceAll(token, "[REDACTED]") : value).trim();
  const sanitized = { ...initial.data, description: redact(initial.data.description), client: { ...initial.data.client, version: redact(initial.data.client.version) } };
  const final = FeedbackSubmissionSchema.safeParse(sanitized);
  if (!final.success) throw new RelayError(400, "反馈内容脱敏后无效，请调整描述后重试。" );
  return final.data;
}

function validateScreenshot(submission: FeedbackSubmission): { bytes: Buffer; extension: ".png" | ".jpg" | ".webp"; contentType: "image/png" | "image/jpeg" | "image/webp" } | undefined {
  if (!submission.screenshot) return undefined;
  const bytes = Buffer.from(submission.screenshot.dataBase64, "base64");
  const valid = submission.screenshot.contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : submission.screenshot.contentType === "image/jpeg" ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid || !bytes.length || bytes.length > MAX_FEEDBACK_IMAGE_BYTES || bytes.toString("base64") !== submission.screenshot.dataBase64) throw new RelayError(400, "截图内容无效，仅支持不超过 5 MB 的 PNG、JPEG 或 WebP。" );
  const extension = submission.screenshot.contentType === "image/png" ? ".png" : submission.screenshot.contentType === "image/jpeg" ? ".jpg" : ".webp";
  return { bytes, extension, contentType: submission.screenshot.contentType };
}

function parseReceipt(payload: unknown, feedbackId: string, hasScreenshot: boolean): FeedbackReceipt {
  const parsed = z.object({ number: z.number().int().positive(), html_url: z.string() }).parse(payload);
  return FeedbackReceiptSchema.parse({ feedbackId, issueNumber: parsed.number, issueUrl: parsed.html_url, hasScreenshot });
}

function normalizePublicUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Invalid public URL"); }
  const local = url.protocol === "http:" && url.hostname === "localhost";
  if (!(url.protocol === "https:" || local) || url.username || url.password || url.search || url.hash) throw new Error("Invalid public URL");
  return url.toString().replace(/\/$/, "");
}

function requestTimeouts(overrides: FeedbackServerOptions["timeouts"]): typeof DEFAULT_TIMEOUTS {
  const values = { ...DEFAULT_TIMEOUTS, ...overrides };
  for (const value of Object.values(values)) if (!Number.isInteger(value) || value < 1 || value > 60_000) throw new Error("Invalid request timeout");
  return values;
}

function screenshotBudget(override: number | undefined): number {
  const value = override ?? MAX_SCREENSHOT_STORAGE_BYTES;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SCREENSHOT_STORAGE_BYTES) throw new Error("Invalid screenshot budget");
  return value;
}

function clientIp(request: IncomingMessage, trustCloudflare: boolean): string {
  const remote = request.socket.remoteAddress ?? "unknown";
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const forwarded = request.headers["cf-connecting-ip"];
  return trustCloudflare && loopback && typeof forwarded === "string" && forwarded.length <= 100 ? forwarded : remote;
}

async function readRequestJson(request: IncomingMessage, timeoutMs: number): Promise<unknown> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) throw new RelayError(413, "反馈内容过大。" );
  const chunks: Buffer[] = [];
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (result: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.off("data", onData); request.off("end", onEnd); request.off("error", onError); request.off("aborted", onAborted);
      result();
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { request.resume(); finish(() => reject(new RelayError(413, "反馈内容过大。"))); return; }
      chunks.push(chunk);
    };
    const onEnd = () => finish(resolve);
    const onError = (error: Error) => finish(() => reject(error));
    const onAborted = () => finish(() => reject(new RelayError(400, "请求已中断。")));
    const timer = setTimeout(() => { request.resume(); finish(() => reject(new RelayError(408, "请求内容接收超时。"))); }, timeoutMs);
    timer.unref();
    request.on("data", onData); request.once("end", onEnd); request.once("error", onError); request.once("aborted", onAborted);
  });
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new RelayError(400, "反馈请求不是有效 JSON。" ); }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, file); await fsyncDirectory(directory); }
  finally { await unlink(temporary).catch(() => undefined); }
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); }
  finally { await handle.close(); }
}

function githubRejection(status: number): string {
  if (status === 429) return "GitHub 请求限流，请稍后重试。";
  if (status === 401 || status === 403 || status === 404) return "GitHub 暂时拒绝接收反馈，请稍后重试。";
  if (status === 422) return "GitHub 暂时无法接收该反馈，请调整描述后重试。";
  return "提交结果尚未确认，请稍后用相同反馈重试核对。";
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}
