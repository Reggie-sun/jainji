import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelGateway } from "../src/model-server/gateway";

const servers: Server[] = [];
const memberKey = "member-key-123456789";

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

async function start(fetcher: typeof fetch = vi.fn(async (url) => new URL(String(url)).pathname.endsWith("/models")
  ? Response.json({ object: "list", data: [{ id: valid.model }] })
  : Response.json({ id: "chatcmpl-test", choices: [] }))): Promise<{ base: string; fetcher: typeof fetch }> {
  const server = createModelGateway({ keys: [memberKey], upstreamKey: "local-jainji", fetcher });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, fetcher };
}

function authorized(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { Authorization: `Bearer ${memberKey}`, ...(init.headers ?? {}) } };
}

const valid = { model: "Qwen/Qwen3-VL-8B-Instruct", messages: [{ role: "user", content: "hello" }] };

describe("shared local Qwen gateway", () => {
  it("authenticates the two public endpoints with a constant-time member key check", async () => {
    const { base, fetcher } = await start();
    expect((await fetch(`${base}/v1/models`)).status).toBe(401);
    expect((await fetch(`${base}/v1/models`, { headers: { Authorization: "Bearer wrong-key" } })).status).toBe(401);
    const models = await fetch(`${base}/v1/models`, authorized());
    expect(models.status).toBe(200);
    expect(await models.json()).toMatchObject({ data: [{ id: valid.model }] });
    expect((await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid) }))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, "http://127.0.0.1:8000/v1/models", expect.objectContaining({
      method: "GET", headers: expect.objectContaining({ Authorization: "Bearer local-jainji" }),
    }));
  });

  it("fails closed for vLLM internals, unsupported methods, and invalid requests before upstream", async () => {
    const { base, fetcher } = await start();
    for (const path of ["/invocations", "/metrics", "/docs", "/openapi.json", "/v1/models/anything"]) {
      expect((await fetch(`${base}${path}`, authorized())).status).toBe(404);
    }
    expect((await fetch(`${base}/v1/chat/completions`, authorized())).status).toBe(405);
    expect((await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...valid, model: "other" }) }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("forwards only the supported model with the upstream key and a bounded output", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "chatcmpl-test", choices: [] }));
    const { base } = await start(fetcher);
    const response = await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json", "X-Do-Not-Forward": "no" }, body: JSON.stringify(valid) }));
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer local-jainji", "Content-Type": "application/json" }),
    }));
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect((init?.headers as Record<string, string>)["X-Do-Not-Forward"]).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: valid.model, max_tokens: 2048 });
    for (const body of [{ ...valid, n: 2 }, { ...valid, max_tokens: 32769 }, { ...valid, max_completion_tokens: 32769 }, { ...valid, max_tokens: 1.5 }]) {
      expect((await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).status).toBe(400);
    }
    expect((await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...valid, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://internal.example/image.png" } }] }] }) }))).status).toBe(400);
    expect((await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...valid, multi_modal_data: { image: "file:///etc/passwd" } }) }))).status).toBe(400);
    expect((await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...valid, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }] }] }) }))).status).toBe(200);
    const largeImage = `data:image/jpeg;base64,${"A".repeat(5_000_000)}`;
    expect((await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...valid, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: largeImage } }] }] }) }))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("forwards an explicitly bounded cover output budget while retaining the ordinary default", async () => {
    const { base, fetcher } = await start();
    for (const field of ["max_tokens", "max_completion_tokens"]) {
      const response = await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...valid, [field]: 32768 }) }));
      expect(response.status).toBe(200);
      const body = JSON.parse(String(vi.mocked(fetcher).mock.calls.at(-1)?.[1]?.body));
      expect(body[field]).toBe(32768);
      expect(body).not.toHaveProperty(field === "max_tokens" ? "max_completion_tokens" : "max_tokens");
    }
  });

  it("accepts only the bounded JSON object response format", async () => {
    const { base, fetcher } = await start();
    const post = (format: unknown) => fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...valid, response_format: format }) }));
    expect((await post({ type: "json_object" })).status).toBe(200);
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body)).response_format).toEqual({ type: "json_object" });
    for (const format of [null, [], "json_object", { type: "json_schema", json_schema: {} }, { type: "json_object", schema: {} }]) {
      expect((await post(format)).status).toBe(400);
    }
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects oversized bodies and aborts the upstream request on a timeout", async () => {
    const { base, fetcher } = await start();
    expect((await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(32 * 1024 * 1024 + 1) }))).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("relays requested event streams and cancels the upstream when its client disconnects", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("data: {\\\"choices\\\":[]}\\n\\n")); controller.close();
    } }), { headers: { "Content-Type": "text/event-stream" } }));
    const { base } = await start(fetcher);
    const streamed = await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...valid, stream: true }) }));
    expect(streamed.headers.get("content-type")).toContain("text/event-stream");
    expect(await streamed.text()).toContain("data:");

    let aborted = false;
    fetcher.mockImplementationOnce(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) { aborted = true; reject(new DOMException("aborted", "AbortError")); return; }
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")); }, { once: true });
    }));
    const controller = new AbortController();
    const pending = fetch(`${base}/v1/chat/completions`, { ...authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid) }), signal: controller.signal }).catch(() => undefined);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    controller.abort();
    await pending;
    await vi.waitFor(() => expect(aborted).toBe(true));

    let sourceCancelled = false;
    fetcher.mockImplementationOnce(async () => new Response(new ReadableStream({
      start(source) { source.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { sourceCancelled = true; },
    })));
    const streamController = new AbortController();
    const backpressured = await fetch(`${base}/v1/chat/completions`, { ...authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...valid, stream: true }) }), signal: streamController.signal });
    streamController.abort();
    await backpressured.arrayBuffer().catch(() => undefined);
    await vi.waitFor(() => expect(sourceCancelled).toBe(true));
  });

  it("uses the single 85-second upstream deadline", async () => {
    const originalSetTimeout = global.setTimeout;
    const timer = vi.spyOn(global, "setTimeout").mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 85_000) queueMicrotask(() => typeof callback === "function" && callback(...args));
      return originalSetTimeout(() => undefined, delay) as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    try {
      const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
        if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      });
      const { base } = await start(fetcher);
      expect((await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid) }))).status).toBe(504);
    } finally { timer.mockRestore(); }
  });

  it("destroys an already-started stream when its upstream deadline expires", async () => {
    const originalSetTimeout = global.setTimeout;
    let expire!: () => void;
    const timer = vi.spyOn(global, "setTimeout").mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 85_000) expire = () => typeof callback === "function" && callback(...args);
      return originalSetTimeout(() => undefined, delay) as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    try {
      let sourceCancelled = false;
      const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
        start(source) { source.enqueue(new TextEncoder().encode("data: first\\n\\n")); },
        cancel() { sourceCancelled = true; },
      })));
      const { base } = await start(fetcher);
      const response = await fetch(`${base}/v1/chat/completions`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...valid, stream: true }) }));
      expire();
      await expect(response.arrayBuffer()).rejects.toThrow();
      await vi.waitFor(() => expect(sourceCancelled).toBe(true));
    } finally { timer.mockRestore(); }
  });

  it("cancels a rejected upstream response body before returning the generic error", async () => {
    let sourceCancelled = false;
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel() { sourceCancelled = true; } }), { status: 500 }));
    const { base } = await start(fetcher);
    expect((await fetch(`${base}/v1/models`, authorized())).status).toBe(502);
    await vi.waitFor(() => expect(sourceCancelled).toBe(true));
  });
});
