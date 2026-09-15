import { describe, expect, it, vi } from "vitest";
import { AgentProvider, AUTOMATIC_COVER_COMPLETION_OPTIONS } from "../src/main/agent-provider";
import { completeApi, type ModelMessage } from "../src/main/api-transport";
import type { ConnectionInput } from "../src/shared/agent";
import { DEFAULT_QWEN_CONNECTION } from "../src/shared/connections";

const connection: ConnectionInput = { baseUrl: "https://example.test/v1", model: "vision", apiKey: "synthetic-key-not-real" };
const messages: ModelMessage[] = [{ role: "user", content: "return JSON" }];
const longResult = "x".repeat(20_000);
const detectionResponse = JSON.stringify({ status: "ok", frames: [{ timeMs: 0, targets: [] }] });

function responseFor(protocol: "chat-completions" | "responses" | "anthropic", content: string): Response {
  if (protocol === "anthropic") return new Response(JSON.stringify({ content: [{ type: "text", text: content }] }));
  if (protocol === "responses") return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: content }] }] }));
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
}

describe("automatic cover output budget", () => {
  it("requests complete JSON and the explicit cover budget from the team Qwen server", async () => {
    const request = vi.fn().mockResolvedValue(responseFor("chat-completions", detectionResponse));
    const provider = new AgentProvider(request, 0);
    provider.configure({ baseUrl: DEFAULT_QWEN_CONNECTION.baseUrl, model: DEFAULT_QWEN_CONNECTION.model, apiKey: connection.apiKey });
    await expect(provider.detectCovers([{ timeMs: 0, url: "data:image/jpeg;base64,aGVsbG8=" }], undefined, new AbortController().signal)).resolves.toEqual([{ timeMs: 0, targets: [] }]);
    expect(JSON.parse(String(request.mock.calls[0][1].body))).toMatchObject({ max_tokens: 32768, response_format: { type: "json_object" } });
    expect(request).toHaveBeenCalledOnce();
  });
  it.each(["chat-completions", "responses", "anthropic"] as const)("accepts a complete eight-frame sixteen-target result through %s", async (protocol) => {
    const frames = Array.from({ length: 8 }, (_, index) => ({ timeMs: index * 250, targets: Array.from({ length: 16 }, (_, target) => ({
      id: `target-${target}`, rectangle: { x: (target % 4) * 0.2, y: Math.floor(target / 4) * 0.2, width: 0.1, height: 0.1 },
    })) }));
    const content = JSON.stringify({ status: "ok", frames }, null, 2);
    expect(content.length).toBeGreaterThan(16_000);
    const request = vi.fn().mockResolvedValue(responseFor(protocol, content)) as unknown as typeof fetch;
    const provider = new AgentProvider(request, 0);
    provider.configure({ ...connection, protocol });
    await expect(provider.detectCovers(frames.map(({ timeMs }) => ({ timeMs, url: "data:image/jpeg;base64,aGVsbG8=" })), undefined, new AbortController().signal)).resolves.toEqual(frames);
    expect(request).toHaveBeenCalledOnce();
  });
  it.each(["responses", "anthropic"] as const)("raises the supported %s token budget", async (protocol) => {
    const request = vi.fn().mockResolvedValue(responseFor(protocol, longResult)) as unknown as typeof fetch;
    await expect(completeApi({ ...connection, protocol }, messages, new AbortController().signal, request, AUTOMATIC_COVER_COMPLETION_OPTIONS)).resolves.toBe(longResult);
    const call = vi.mocked(request).mock.calls[0]!;
    const body = JSON.parse(String((call[1] as RequestInit).body));
    if (protocol === "anthropic") expect(body.max_tokens).toBe(32_768);
    else expect(body.max_output_tokens).toBe(32_768);
  });

  it("forwards the cover token budget through Chat Completions", async () => {
    const request = vi.fn().mockResolvedValue(responseFor("chat-completions", longResult)) as unknown as typeof fetch;
    await expect(completeApi(connection, messages, new AbortController().signal, request, AUTOMATIC_COVER_COMPLETION_OPTIONS)).resolves.toBe(longResult);
    const call = vi.mocked(request).mock.calls[0]!;
    expect(JSON.parse(String((call[1] as RequestInit).body)).max_tokens).toBe(32_768);
  });

  it("keeps the ordinary completion budget unchanged", async () => {
    const request = vi.fn().mockResolvedValue(responseFor("chat-completions", longResult)) as unknown as typeof fetch;
    await expect(completeApi(connection, messages, new AbortController().signal, request)).rejects.toThrow("内容为空或过长");
    const call = vi.mocked(request).mock.calls[0]!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).not.toHaveProperty("max_tokens");
  });

  it("forwards the larger budget only to selected ChatGPT cover detection", async () => {
    const complete = vi.fn().mockResolvedValue(detectionResponse);
    const provider = new AgentProvider();
    provider.useChatGPT("vision", complete);
    await provider.detectCovers([{ timeMs: 0, url: "data:image/jpeg;base64,aGVsbG8=" }], undefined, new AbortController().signal);
    expect(complete).toHaveBeenCalledWith(expect.any(Array), expect.any(AbortSignal), AUTOMATIC_COVER_COMPLETION_OPTIONS);
  });
});
