import { createServer, type Server } from "node:http";
import { createConnection } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFeedbackServer } from "../src/feedback-server/service";
import { FEEDBACK_REPOSITORY } from "../src/shared/bug-feedback";

const directories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const submission = (overrides: Record<string, unknown> = {}) => ({
  feedbackId: randomUUID(), description: "导出完成后点击播放没有反应", page: "results", client: { version: "0.1.0", platform: "linux" }, ...overrides,
});
const issue = (number = 42) => ({ number, html_url: `https://github.com/${FEEDBACK_REPOSITORY}/issues/${number}` });

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function start(fetcher: typeof fetch = vi.fn(async () => Response.json(issue(), { status: 201 })), options: { timeouts?: { headersMs?: number; bodyMs?: number; socketMs?: number }; screenshotBudgetBytes?: number } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-feedback-relay-"));
  directories.push(directory);
  const server = createFeedbackServer({ directory, token: "relay-secret", publicUrl: "http://localhost:18181", fetcher, ...options });
  return { directory, base: await listen(server), fetcher, server };
}

async function slowBodyResponse(base: string): Promise<string> {
  const url = new URL(base);
  const socket = createConnection({ host: "127.0.0.1", port: Number(url.port) });
  try {
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    socket.write("POST /api/feedback HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{");
    return await new Promise<string>((resolve, reject) => {
      let response = "";
      const timeout = setTimeout(() => reject(new Error("slow request was not released")), 250);
      socket.on("data", (chunk) => {
        response += chunk.toString();
        if (response.includes("\r\n\r\n")) { clearTimeout(timeout); resolve(response); }
      });
      socket.once("end", () => { clearTimeout(timeout); resolve(response); });
      socket.once("error", (error) => { clearTimeout(timeout); reject(error); });
    });
  } finally { socket.destroy(); }
}
async function request(base: string, input: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/feedback`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(input) });
}

describe("feedback relay", () => {
  it("rejects malformed, oversized, and wrong-content-type HTTP requests before GitHub", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { base } = await start(fetcher);
    expect((await request(base, { nope: true })).status).toBe(400);
    expect((await fetch(`${base}/api/feedback`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "bad" })).status).toBe(415);
    expect((await fetch(`${base}/api/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(7_100_001) })).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("times out a real slow HTTP request body and releases its request slot", async () => {
    const { base } = await start(undefined, { timeouts: { headersMs: 30, bodyMs: 30, socketMs: 60 } });
    expect(await slowBodyResponse(base)).toContain("408");
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("persists a pending post, never reposts after a dropped GitHub response, and reconciles after restart", async () => {
    const input = submission();
    let posts = 0;
    const github = createServer((req, res) => {
      if (req.method === "POST") { posts += 1; req.socket.destroy(); return; }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify([{ ...issue(), body: `text\n<!-- bug-feedback-id:${input.feedbackId} -->` }]));
    });
    const githubBase = await listen(github);
    const fetcher: typeof fetch = (url, options) => fetch(`${githubBase}${new URL(String(url)).pathname}${new URL(String(url)).search}`, options);
    const first = await start(fetcher);
    expect((await request(first.base, input)).status).toBe(502);
    expect(posts).toBe(1);
    await new Promise<void>((resolve) => first.server.close(() => resolve()));
    servers.splice(servers.indexOf(first.server), 1);
    const restarted = createFeedbackServer({ directory: first.directory, token: "relay-secret", publicUrl: "http://localhost:18181", fetcher });
    const secondBase = await listen(restarted);
    const receipt = await (await request(secondBase, input)).json();
    expect(receipt).toMatchObject({ feedbackId: input.feedbackId, issueNumber: 42, issueUrl: issue().html_url });
    expect(posts).toBe(1);
  });

  it("rejects untrusted receipts without leaking relay credentials", async () => {
    const { base } = await start(vi.fn(async () => Response.json({ number: 42, html_url: "https://evil.test/relay-secret" }, { status: 201 })));
    const response = await request(base, submission());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("relay-secret");
  });

  it("stores a validated screenshot and serves only that image through the public endpoint", async () => {
    let githubBody = "";
    const fetcher = vi.fn(async (_url: URL | RequestInfo, options?: RequestInit) => { githubBody = String(options?.body); return Response.json(issue(), { status: 201 }); });
    const { base, directory } = await start(fetcher);
    const screenshot = { contentType: "image/png", dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQaCgAAAGkAQHaatBvAAAAAElFTkSuQmCC" };
    const result = await request(base, submission({ screenshot }));
    const receipt = await result.json() as { feedbackId: string };
    const image = await fetch(`${base}/api/feedback/${receipt.feedbackId}/screenshot`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await image.arrayBuffer()).toString("base64")).toBe(screenshot.dataBase64);
    expect(githubBody).toContain("http://localhost:18181/api/feedback/");
    expect(await readFile(path.join(directory, `${receipt.feedbackId}.png`))).toBeTruthy();
  });

  it("rejects a new screenshot when the durable screenshot budget is full without calling GitHub", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { base } = await start(fetcher, { screenshotBudgetBytes: 1 });
    const screenshot = { contentType: "image/png", dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQaCgAAAGkAQHaatBvAAAAAElFTkSuQmCC" };
    expect((await request(base, submission({ screenshot }))).status).toBe(507);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a changed payload for the same feedback id", async () => {
    const { base } = await start();
    const input = submission();
    expect((await request(base, input)).status).toBe(201);
    expect((await request(base, { ...input, description: "这是不同的反馈内容" })).status).toBe(409);
  });

  it("persists per-IP new-submission quotas without charging same-id retries", async () => {
    const { base, fetcher } = await start();
    const initial = submission();
    expect((await request(base, initial)).status).toBe(201);
    expect((await request(base, initial)).status).toBe(201);
    for (let index = 0; index < 4; index += 1) expect((await request(base, submission())).status).toBe(201);
    expect((await request(base, submission())).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("caps same-id GitHub retries independently from new-submission quota", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("dropped")).mockResolvedValue(Response.json([]));
    const { base } = await start(fetcher);
    const input = submission();
    expect((await request(base, input)).status).toBe(502);
    for (let index = 0; index < 19; index += 1) expect((await request(base, input)).status).toBe(502);
    expect((await request(base, input)).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(20);
  });
});
