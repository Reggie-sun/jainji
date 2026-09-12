import { describe, expect, it, vi } from "vitest";
import { completeApi, type ModelMessage } from "../src/main/api-transport";
import type { ConnectionInput } from "../src/shared/agent";

const key = "synthetic-key-not-real";
const jpeg = "data:image/jpeg;base64,aGVsbG8=";
const messages: ModelMessage[] = [
  { role: "system", content: "只返回 JSON" },
  { role: "user", content: [{ type: "text", text: "看图包装" }, { type: "image_url", image_url: { url: jpeg, detail: "low" } }] },
];

function requestReply(body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body))) as unknown as typeof fetch;
}

describe("completeApi protocol transport", () => {
  it.each(["chat-completions", "responses", "anthropic"] as const)("sends explicit effort using the %s field", async (protocol) => {
    const reply = protocol === "anthropic" ? { content: [{ type: "text", text: "ok" }] } : protocol === "responses" ? { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] } : { choices: [{ message: { content: "ok" } }] };
    const request = requestReply(reply);
    await completeApi({ baseUrl: "https://example.test/v1", model: "vision", apiKey: key, protocol, reasoningEffort: "high" }, messages, new AbortController().signal, request);
    const body = JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body));
    if (protocol === "anthropic") expect(body.output_config).toEqual({ effort: "high" });
    else if (protocol === "responses") expect(body.reasoning).toEqual({ effort: "high" });
    else expect(body.reasoning_effort).toBe("high");
  });
  it("converts JPEG frames and system messages to an Anthropic Bearer request", async () => {
    const request = requestReply({ content: [{ type: "text", text: "{\"summary\":\"ok\"}" }] });
    const connection: ConnectionInput = { baseUrl: "https://minimax.example/anthropic", model: "MiniMax-VL", apiKey: key, protocol: "anthropic", authHeader: "bearer" };

    await expect(completeApi(connection, messages, new AbortController().signal, request)).resolves.toBe('{"summary":"ok"}');
    const [url, options] = vi.mocked(request).mock.calls[0];
    expect(url).toBe("https://minimax.example/anthropic/v1/messages");
    expect(options?.headers).toMatchObject({ Authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" });
    expect(JSON.parse(String(options?.body))).toEqual({
      model: "MiniMax-VL", max_tokens: 2048, stream: false, system: "只返回 JSON",
      messages: [{ role: "user", content: [
        { type: "text", text: "看图包装" },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" } },
      ] }],
    });
  });

  it("uses x-api-key and avoids a duplicate v1 segment for official Anthropic", async () => {
    const request = requestReply({ content: [{ type: "text", text: "ok" }] });
    const connection: ConnectionInput = { baseUrl: "https://api.anthropic.com/v1", model: "claude-test", apiKey: key, protocol: "anthropic", authHeader: "x-api-key" };

    await expect(completeApi(connection, [{ role: "user", content: "hello" }], new AbortController().signal, request)).resolves.toBe("ok");
    const [url, options] = vi.mocked(request).mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options?.headers).toMatchObject({ "x-api-key": key, "anthropic-version": "2023-06-01" });
    expect(options?.headers).not.toHaveProperty("Authorization");
  });

  it("uses the Responses protocol with ephemeral image input and completed output extraction", async () => {
    const request = requestReply({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "response text" }] }] });
    const connection: ConnectionInput = { baseUrl: "https://api.openai.com/v1", model: "gpt-test", apiKey: key, protocol: "responses", authHeader: "bearer" };

    await expect(completeApi(connection, messages, new AbortController().signal, request)).resolves.toBe("response text");
    const [url, options] = vi.mocked(request).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options?.headers).toMatchObject({ Authorization: `Bearer ${key}` });
    expect(JSON.parse(String(options?.body))).toEqual({
      model: "gpt-test", store: false, stream: false,
      input: [
        { role: "system", content: "只返回 JSON" },
        { role: "user", content: [{ type: "input_text", text: "看图包装" }, { type: "input_image", image_url: jpeg, detail: "low" }] },
      ],
    });
  });

  it("keeps Chat Completions available", async () => {
    const request = requestReply({ choices: [{ message: { content: "chat text" } }] });
    const connection: ConnectionInput = { baseUrl: "https://chat.example/v1", model: "vision-test", apiKey: key };

    await expect(completeApi(connection, [{ role: "user", content: "hello" }], new AbortController().signal, request)).resolves.toBe("chat text");
    const [url, options] = vi.mocked(request).mock.calls[0];
    expect(url).toBe("https://chat.example/v1/chat/completions");
    expect(JSON.parse(String(options?.body))).toEqual({ model: "vision-test", messages: [{ role: "user", content: "hello" }], stream: false });
  });

  it("rejects raw error bodies and secret responses without retrying every protocol", async () => {
    const connections: ConnectionInput[] = [
      { baseUrl: "https://chat.example/v1", model: "chat", apiKey: key },
      { baseUrl: "https://api.anthropic.com/v1", model: "claude", apiKey: key, protocol: "anthropic", authHeader: "x-api-key" },
      { baseUrl: "https://api.openai.com/v1", model: "responses", apiKey: key, protocol: "responses", authHeader: "bearer" },
    ];
    const rawSecret = `provider said ${key}`;
    const payloads = [
      { choices: [{ message: { content: rawSecret } }] },
      { content: [{ type: "text", text: rawSecret }] },
      { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: rawSecret }] }] },
    ];
    for (const [index, connection] of connections.entries()) {
      const failed = vi.fn().mockResolvedValue(new Response(rawSecret, { status: 401 })) as unknown as typeof fetch;
      await expect(completeApi(connection, [{ role: "user", content: "hello" }], new AbortController().signal, failed)).rejects.toThrow("API Key 无效");
      await expect(completeApi(connection, [{ role: "user", content: "hello" }], new AbortController().signal, requestReply(payloads[index]))).rejects.toThrow("敏感信息");
      expect(vi.mocked(failed)).toHaveBeenCalledTimes(1);
    }
  });

  it("maps aborts to a safe cancellation message without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")) as unknown as typeof fetch;
    const connection: ConnectionInput = { baseUrl: "https://chat.example/v1", model: "chat", apiKey: key };

    await expect(completeApi(connection, [{ role: "user", content: "hello" }], controller.signal, request)).rejects.toThrow("已停止生成");
    expect(vi.mocked(request)).toHaveBeenCalledTimes(1);
  });
});
