import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicWriteJson } from "./store.js";
import { BugFeedbackSchema, FEEDBACK_ENDPOINT, FeedbackReceiptSchema, FeedbackSubmissionSchema, MAX_FEEDBACK_IMAGE_BYTES, redactFeedback, type BugFeedback, type FeedbackHistoryEntry, type FeedbackReceipt } from "../shared/bug-feedback.js";

export class FeedbackError extends Error {}
const recordSchema = z.object({
  fingerprint: z.string(), createdAt: z.string().datetime(), state: z.enum(["ready", "pending", "submitted"]),
  screenshotExtension: z.enum([".png", ".jpg", ".webp"]).optional(), receipt: FeedbackReceiptSchema.optional(),
  submission: BugFeedbackSchema.omit({ screenshot: true }),
  transport: z.literal("relay").optional(), client: FeedbackSubmissionSchema.shape.client.optional(),
}).strict();
type RecordState = z.infer<typeof recordSchema>;

/** Local retry snapshots and receipts. Only the owner's relay can create GitHub issues. */
export class BugFeedbackService {
  private readonly root: string;
  private readonly endpoint: string;
  private serial: Promise<unknown> = Promise.resolve();

  constructor(userData: string, private readonly context: { version: string; platform: string }, private readonly fetcher: typeof fetch = fetch, endpoint = process.env.JIANJI_FEEDBACK_URL || FEEDBACK_ENDPOINT) {
    this.root = path.join(userData, "bug-feedback");
    const url = new URL(endpoint);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new FeedbackError("反馈服务地址无效。");
    this.endpoint = url.origin;
  }

  submit(input: unknown): Promise<FeedbackReceipt> {
    const parsed = BugFeedbackSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(new FeedbackError("请填写 5–8000 字的问题描述，截图仅支持不超过 5 MB 的 PNG、JPEG 或 WebP。"));
    const result = this.serial.catch(() => undefined).then(() => this.submitLocked(parsed.data));
    this.serial = result; return result;
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
    this.serial = result; return result;
  }

  async issueUrl(feedbackId: unknown): Promise<string> {
    const id = z.string().uuid().parse(feedbackId); const record = await this.readRecord(id);
    if (!record?.receipt) throw new FeedbackError("尚无已确认的 Issue。");
    return record.receipt.issueUrl;
  }

  async screenshotPath(feedbackId: unknown): Promise<string> {
    const id = z.string().uuid().parse(feedbackId); const record = await this.readRecord(id);
    if (!record?.screenshotExtension) throw new FeedbackError("未找到本地截图。");
    const file = path.join(this.root, `${id}${record.screenshotExtension}`);
    if (!(await stat(file)).isFile()) throw new FeedbackError("未找到本地截图。");
    return file;
  }

  private recordPath(id: string): string { return path.join(this.root, `${id}.json`); }
  private async readRecord(id: string): Promise<RecordState | undefined> {
    try {
      const record = recordSchema.parse(JSON.parse(await readFile(this.recordPath(id), "utf8")));
      if (record.submission.feedbackId !== id || (record.receipt && record.receipt.feedbackId !== id)) throw new Error("identity mismatch");
      return record;
    } catch (error) {
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
    if (record?.state === "pending" && !record.transport) throw new FeedbackError("此条反馈来自旧版，提交结果尚未确认。请先打开仓库 Issues 检查，再决定是否开始新的反馈。");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (!record) {
      record = recordSchema.parse({ fingerprint, createdAt: new Date().toISOString(), state: "ready", transport: "relay", client: this.context,
        submission: { feedbackId: input.feedbackId, description: redactFeedback(input.description), page: input.page }, ...(image ? { screenshotExtension: image.extension } : {}) });
      if (image) {
        const target = path.join(this.root, `${input.feedbackId}${image.extension}`);
        try { await writeFile(target, image.bytes, { flag: "wx", mode: 0o600 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await readFile(target)).equals(image.bytes)) throw new FeedbackError("本地截图保存失败，请开始新的反馈。"); }
      }
    }
    record.transport = "relay"; record.client ??= FeedbackSubmissionSchema.shape.client.parse(this.context); record.state = "pending";
    await atomicWriteJson(this.recordPath(input.feedbackId), record);
    const submission = FeedbackSubmissionSchema.parse({ ...record.submission, client: record.client, ...(input.screenshot ? { screenshot: input.screenshot } : {}) });
    let response: Response;
    try {
      response = await this.fetcher(`${this.endpoint}/api/feedback`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission) });
    } catch { throw new FeedbackError("暂时无法连接反馈服务，请稍后重试。已保留本次反馈，重试会核对原提交。"); }
    if (!response.ok) {
      if (response.status === 429) throw new FeedbackError("反馈提交较频繁，请稍后再试。");
      if (response.status === 507) throw new FeedbackError("反馈服务的截图空间已满，此次尚未创建 Issue。请开始新的反馈并移除截图后提交。");
      if (response.status === 400 || response.status === 413) throw new FeedbackError("反馈服务拒绝了此内容，请检查描述或截图。");
      if (response.status === 409) throw new FeedbackError("反馈服务检测到同一反馈的内容冲突，请先到仓库检查。");
      throw new FeedbackError("反馈服务暂时无法确认提交结果，请稍后重试核对原提交。");
    }
    let receipt: FeedbackReceipt;
    try {
      receipt = FeedbackReceiptSchema.parse(await response.json());
      if (receipt.feedbackId !== input.feedbackId || receipt.hasScreenshot !== Boolean(input.screenshot)) throw new Error("receipt mismatch");
    } catch { throw new FeedbackError("反馈服务返回的回执无效，请稍后重试核对原提交。"); }
    await atomicWriteJson(this.recordPath(input.feedbackId), { ...record, state: "submitted", receipt });
    return receipt;
  }

  private validateImage(input: BugFeedback): { bytes: Buffer; extension: ".png" | ".jpg" | ".webp" } | undefined {
    if (!input.screenshot) return;
    const { contentType, dataBase64 } = input.screenshot; const bytes = Buffer.from(dataBase64, "base64");
    const valid = contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : contentType === "image/jpeg" ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) : bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!valid || !bytes.length || bytes.length > MAX_FEEDBACK_IMAGE_BYTES || bytes.toString("base64") !== dataBase64) throw new FeedbackError("截图内容无效，仅支持不超过 5 MB 的 PNG、JPEG 或 WebP。");
    return { bytes, extension: contentType === "image/png" ? ".png" : contentType === "image/jpeg" ? ".jpg" : ".webp" };
  }
}
