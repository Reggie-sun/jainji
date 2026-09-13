import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BugFeedbackService } from "../src/main/bug-feedback";
import { FEEDBACK_REPOSITORY, redactFeedback } from "../src/shared/bug-feedback";

const directories: string[] = [];
const context = { version: "0.1.0", platform: "linux" };
const draft = () => ({ feedbackId: randomUUID(), description: "导出完成后点击播放没有反应", page: "results" as const });
const receipt = (id: string) => ({ feedbackId: id, issueNumber: 42, issueUrl: `https://github.com/${FEEDBACK_REPOSITORY}/issues/42`, hasScreenshot: false });
const screenshot = { contentType: "image/png" as const, dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQaCgAAAGkAQHaatBvAAAAAElFTkSuQmCC" };
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function setup(fetcher: typeof fetch = vi.fn(async (_url, options) => Response.json(receipt(JSON.parse(String(options?.body)).feedbackId)))) {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-feedback-test-")); directories.push(directory);
  return { directory, fetcher, service: new BugFeedbackService(directory, context, fetcher, "https://feedback.example.test") };
}

describe("feedback relay client", () => {
  it("submits without user credentials, sends only redacted context to the relay", async () => {
    const { service, fetcher, directory } = await setup();
    const input = { ...draft(), description: "出现错误 token=private /home/private/video.mp4" };
    expect((await service.submit(input)).issueNumber).toBe(42);
    const [url, options] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe("https://feedback.example.test/api/feedback");
    expect(options?.headers).not.toHaveProperty("Authorization");
    expect(options?.redirect).toBe("error");
    const body = JSON.parse(String(options?.body));
    expect(body.description).not.toContain("private");
    expect(body.client).toEqual(context);
    expect(await readdir(path.join(directory, "bug-feedback"))).not.toContain("credentials.json");
  });

  it("reuses receipts across concurrent submissions and restarts", async () => {
    const { service, fetcher, directory } = await setup(); const input = draft();
    const [first, second] = await Promise.all([service.submit(input), service.submit(input)]);
    expect(first).toEqual(second); expect(fetcher).toHaveBeenCalledTimes(1);
    const restarted = new BugFeedbackService(directory, context, fetcher);
    expect(await restarted.resume((await restarted.history())[0].feedbackId)).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(service.submit({ ...input, description: "更改问题描述" })).rejects.toThrow("同一反馈");
  });

  it("resends a frozen request to the relay after disconnect/restart, including original client context", async () => {
    const input = draft();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Authorization: private-secret")).mockResolvedValueOnce(Response.json(receipt(input.feedbackId)));
    const { service, directory } = await setup(fetcher);
    await expect(service.submit(input)).rejects.toThrow("反馈服务");
    const restarted = new BugFeedbackService(directory, { version: "next", platform: "win32" }, fetcher);
    expect((await restarted.resume((await restarted.history())[0].feedbackId)).issueNumber).toBe(42);
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
  });

  it("keeps selected screenshots locally and sends them with the report", async () => {
    const { service, fetcher } = await setup(vi.fn(async (_url, options) => {
      const input = JSON.parse(String(options?.body)); return Response.json({ ...receipt(input.feedbackId), hasScreenshot: true });
    }));
    const input = { ...draft(), screenshot };
    const result = await service.submit(input);
    expect(result.hasScreenshot).toBe(true);
    expect((await readFile(await service.screenshotPath(input.feedbackId))).toString("base64")).toBe(screenshot.dataBase64);
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0][1]?.body)).screenshot).toEqual(screenshot);
  });

  it.each(["https://evil.test/issues/42", `https://github.com/${FEEDBACK_REPOSITORY}/issues/42?x=y`])("rejects unsafe receipt URLs: %s", async (issueUrl) => {
    const input = draft(); const { service } = await setup(vi.fn(async () => Response.json({ ...receipt(input.feedbackId), issueUrl })));
    await expect(service.submit(input)).rejects.toThrow("反馈服务");
  });

  it("rejects a receipt bound to another feedback ID", async () => {
    const { service } = await setup(vi.fn(async () => Response.json(receipt(randomUUID()))));
    await expect(service.submit(draft())).rejects.toThrow("反馈服务");
  });

  it.each([400, 429, 500, 503])("does not surface upstream response secrets for HTTP %s", async (status) => {
    const { service } = await setup(vi.fn(async () => new Response("token=private", { status })));
    await expect(service.submit(draft())).rejects.not.toThrow("private");
  });

  it("validates input before the relay and rejects insecure remote endpoints", async () => {
    const { service, fetcher, directory } = await setup();
    for (const input of [{ ...draft(), description: "   " }, { ...draft(), description: "x".repeat(8001) }, { ...draft(), token: "secret" }, { ...draft(), screenshot: { ...screenshot, dataBase64: "aW52YWxpZA==" } }]) await expect(service.submit(input)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => new BugFeedbackService(directory, context, fetcher, "http://example.test")).toThrow();
    expect(() => new BugFeedbackService(directory, context, fetcher, "https://user:pass@example.test")).toThrow();
  });

  it("preserves old receipts and never replays uncertain legacy direct-GitHub submissions", async () => {
    const { service, fetcher, directory } = await setup(); const input = draft();
    const root = path.join(directory, "bug-feedback"); await mkdir(root);
    const record = { fingerprint: "legacy", createdAt: new Date().toISOString(), state: "pending", submission: input };
    await writeFile(path.join(root, `${input.feedbackId}.json`), JSON.stringify(record));
    await expect(service.resume(input.feedbackId)).rejects.toThrow("旧版");
    expect(fetcher).not.toHaveBeenCalled();
    await writeFile(path.join(root, `${input.feedbackId}.json`), JSON.stringify({ ...record, state: "submitted", receipt: receipt(input.feedbackId) }));
    expect(await service.resume(input.feedbackId)).toEqual(receipt(input.feedbackId));
  });

  it("redacts common credentials and bounds expansion", () => {
    const result = redactFeedback('API_KEY="sk-sensitive"\nAuthorization: Bearer secret\nCookie: abc=secret; xyz=another\nhttps://server.test/?token=secret\n/home/reggie/video.mp4 C:\\Users\\person\\secret.mp4\nghp_abcdefghijklmnopqrstuvwxyz123456\n<!-- bug-feedback-id:spoof -->');
    for (const secret of ["sk-sensitive", "another", "server.test", "reggie", "person", "ghp_", "<!--"]) expect(result).not.toContain(secret);
    expect(redactFeedback("/tmp/a ".repeat(1142))).toHaveLength(8000);
  });
});
