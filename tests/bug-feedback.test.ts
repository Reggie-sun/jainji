import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BugFeedbackService } from "../src/main/bug-feedback";
import { BugFeedbackSchema, FEEDBACK_REPOSITORY, redactFeedback } from "../src/shared/bug-feedback";

const issue = { number: 42, html_url: `https://github.com/${FEEDBACK_REPOSITORY}/issues/42` };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const draft = () => ({ feedbackId: randomUUID(), description: "导出完成后点击播放没有反应", page: "results" as const });
async function setup(fetcher = vi.fn(async () => Response.json(issue, { status: 201 })), token = "test-secret") {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-feedback-test-"));
  directories.push(directory);
  const service = new BugFeedbackService(directory, { version: "0.1.0", platform: "linux" }, fetcher, token);
  return { service, directory, fetcher };
}

describe("bug feedback", () => {
  it("rejects invalid descriptions and extra context before contacting GitHub", async () => {
    const { service, fetcher } = await setup();
    for (const input of [{ ...draft(), description: "   " }, { ...draft(), description: "x".repeat(8001) }, { ...draft(), token: "secret" }, { ...draft(), page: "/home/person/video.mp4" }]) {
      await expect(service.submit(input)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps credentials private and fails closed when unconfigured", async () => {
    const { service, directory, fetcher } = await setup(undefined, "");
    expect(await service.status()).toEqual({ configured: false, repository: FEEDBACK_REPOSITORY, credentialSource: "none" });
    await expect(service.submit(draft())).rejects.toThrow("配置 GitHub");
    expect(fetcher).not.toHaveBeenCalled();
    await service.saveToken("local-secret");
    expect(JSON.stringify(await service.status())).not.toContain("local-secret");
    expect((await readFile(path.join(directory, "bug-feedback", "credentials.json"), "utf8"))).toContain("local-secret");
    await service.saveToken("replacement-secret");
    expect(await readdir(path.join(directory, "bug-feedback"))).toEqual(["credentials.json"]);
    await service.saveToken("");
    expect((await service.status()).configured).toBe(false);
    expect(await readdir(path.join(directory, "bug-feedback"))).toEqual([]);
  });

  it("redacts common credentials, links, local paths and markup markers", () => {
    const result = redactFeedback('API_KEY="sk-sensitive"\nAuthorization: Bearer private-secret\nCookie: abc=secret; xyz=another\nhttps://server.test/?token=secret\n/home/reggie/video.mp4 C:\\Users\\person\\secret.mp4\nghp_abcdefghijklmnopqrstuvwxyz123456\n<!-- bug-feedback-id:spoof -->');
    for (const secret of ["sk-sensitive", "private-secret", "another", "server.test", "reggie", "person", "ghp_", "<!--"]) expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED]");
  });

  it("submits redacted feedback once for concurrent calls and after restart", async () => {
    const { service, directory, fetcher } = await setup();
    const input = { ...draft(), description: "导出失败 token=secret /home/private/video.mp4" };
    const [first, second] = await Promise.all([service.submit(input), service.submit(input)]);
    expect(first).toEqual(second);
    expect(first.issueUrl).toBe(issue.html_url);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.github.com/repos/${FEEDBACK_REPOSITORY}/issues`);
    expect(options.redirect).toBe("error");
    expect(JSON.stringify(options.body)).not.toContain("secret");
    expect(options.body).not.toContain("/home/private");
    expect(options.body).not.toContain("agent:queued");
    const restarted = new BugFeedbackService(directory, { version: "0.1.0", platform: "linux" }, fetcher, "test-secret");
    expect(await restarted.submit(input)).toEqual(first);
    const history = await restarted.history();
    expect(history).toHaveLength(1);
    expect(JSON.stringify(history)).not.toContain("/home/private");
    expect(await restarted.resume(history[0].feedbackId)).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(restarted.submit({ ...input, description: "更改问题描述" })).rejects.toThrow("同一反馈");
  });

  it("does not repost after an uncertain response; recovers the exact receipt", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("token=must-not-leak"));
    const { service, directory } = await setup(fetcher);
    const input = draft();
    await expect(service.submit(input)).rejects.toThrow("尚未确认");
    fetcher.mockResolvedValueOnce(Response.json([]));
    await expect(service.submit(input)).rejects.toThrow("尚未确认");
    fetcher.mockResolvedValueOnce(Response.json([{ ...issue, body: `text\n<!-- bug-feedback-id:${input.feedbackId} -->` }]));
    const restarted = new BugFeedbackService(directory, { version: "0.1.0", platform: "linux" }, fetcher, "test-secret");
    const [pending] = await restarted.history();
    expect((await restarted.resume(pending.feedbackId)).issueNumber).toBe(42);
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

  it.each([401, 403, 404, 422, 429])("reports GitHub rejection %s without response secrets and permits explicit retry", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("private-key", { status })).mockResolvedValueOnce(Response.json(issue, { status: 201 }));
    const { service } = await setup(fetcher);
    const input = draft();
    await expect(service.submit(input)).rejects.not.toThrow("private-key");
    expect((await service.submit(input)).issueNumber).toBe(42);
  });

  it("bounds expanded redaction before persistence and restores it after restart", async () => {
    const { service, directory, fetcher } = await setup();
    const input = { ...draft(), description: "/tmp/a ".repeat(1142).trim() };
    await service.submit(input);
    const restarted = new BugFeedbackService(directory, { version: "0.1.0", platform: "linux" }, fetcher, "test-secret");
    const [entry] = await restarted.history();
    expect(entry.description).toHaveLength(8000);
    expect((await restarted.resume(entry.feedbackId)).issueNumber).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("redacts the exact configured token before truncating expanded text", async () => {
    const token = "abcdef0123456789abcdef0123456789abcdef01";
    const { service, fetcher } = await setup(undefined, token);
    await service.submit({ ...draft(), description: "/tmp/a ".repeat(720) + "x".repeat(70) + token });
    expect(JSON.stringify(await service.history())).not.toContain(token.slice(0, 10));
    const body = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body;
    expect(body).not.toContain(token.slice(0, 10));
  });

  it.each(["https://evil.test/issues/42", `https://github.com/${FEEDBACK_REPOSITORY}/issues/42?secret=x`])("rejects untrusted GitHub receipts: %s", async (html_url) => {
    const { service } = await setup(vi.fn(async () => Response.json({ ...issue, html_url }, { status: 201 })));
    await expect(service.submit(draft())).rejects.toThrow("尚未确认");
  });

  it("stores screenshots locally, sends no image bytes or local path to GitHub", async () => {
    const { service, fetcher, directory } = await setup();
    const screenshot = { contentType: "image/png" as const, dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQaCgAAAGkAQHaatBvAAAAAElFTkSuQmCC" };
    const receipt = await service.submit({ ...draft(), screenshot });
    expect(receipt.hasScreenshot).toBe(true);
    const screenshotPath = await service.screenshotPath(receipt.feedbackId);
    expect((await readFile(screenshotPath)).toString("base64")).toBe(screenshot.dataBase64);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(screenshot.dataBase64);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(directory);
    expect(await readdir(path.join(directory, "bug-feedback"))).not.toContain("project.json");
    await expect(service.submit({ ...draft(), screenshot: { ...screenshot, dataBase64: Buffer.from("not an image").toString("base64") } })).rejects.toThrow("截图");
    expect(BugFeedbackSchema.safeParse({ ...draft(), screenshot: { ...screenshot, contentType: "image/svg+xml" } }).success).toBe(false);
  });
});
