import { describe, expect, it, vi } from "vitest";
import { AgentProvider, materializePlan, validatePlan } from "../src/main/agent-provider";
import { ConnectionInputSchema } from "../src/shared/agent";
import { TemplateCompiler } from "../src/main/compiler";
import { DEFAULT_PRESET, type MediaItem } from "../src/main/domain";

const connection = { baseUrl: "https://example.test/v1/", model: "vision-test", apiKey: "test-secret-not-real" };
const plan = { summary: "保留主体，添加短标题", captions: [{ text: "好物日常", corner: "top-left", size: 0.026 }], filter: "warm", intensity: 0.2 };
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

describe("agent provider boundary", () => {
  it("keeps twelve Chinese characters on one line for portrait and landscape media", async () => {
    for (const dimensions of [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }]) {
      const input = { ...plan, captions: [{ text: "一二三四五六七八九十一二", corner: "bottom-right", size: 0.03 }], filter: "none" };
      const template = materializePlan(input, "clean", dimensions);
      const compiled = await new TemplateCompiler().compile(template, { ...dimensions, sourcePath: "/tmp/source.mp4", durationMs: 1000 } as MediaItem, DEFAULT_PRESET, { ffmpegPath: "ffmpeg", fontResolver: { resolve: async () => "/tmp/font.ttf" }, textFilePath: () => "/tmp/text.txt" });
      expect(compiled.textFiles[0].content).toBe(input.captions[0].text);
      expect(template.layers[0].type === "text" && template.layers[0].fontSizeRatio * dimensions.height).toBeCloseTo(0.03 * dimensions.width);
    }
  });
  it("keeps the key private and sends visual context to the configured completion endpoint", async () => {
    const request = vi.fn().mockResolvedValue(reply(JSON.stringify(plan)));
    const provider = new AgentProvider(request);
    expect(provider.configure(connection)).toEqual({ configured: true, baseUrl: "https://example.test/v1", model: "vision-test" });
    await provider.plan("black-gold", "日常", ["data:image/jpeg;base64,aGVsbG8="], new AbortController().signal);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(options.redirect).toBe("error");
    expect(options.headers.Authorization).toBe(`Bearer ${connection.apiKey}`);
    expect(JSON.parse(options.body).messages[1].content[1].image_url.url).toContain("data:image/jpeg;base64,");
    expect(JSON.stringify(provider.status())).not.toContain(connection.apiKey);
    provider.clear();
    await expect(provider.test(new AbortController().signal)).rejects.toThrow("请先接入");
  });

  it("does not surface response bodies or automatically retry failed paid requests", async () => {
    const request = vi.fn().mockResolvedValue(new Response(connection.apiKey, { status: 401 }));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    await expect(provider.test(new AbortController().signal)).rejects.toThrow("API Key 无效");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects sensitive responses and invalid plans rather than using a fallback template", async () => {
    const request = vi.fn().mockResolvedValueOnce(reply(connection.apiKey)).mockResolvedValueOnce(reply("not json"));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    await expect(provider.test(new AbortController().signal)).rejects.toThrow("敏感信息");
    await expect(provider.plan("clean", "", [], new AbortController().signal)).rejects.toThrow("格式或规则不合格");
  });

  it("enforces rule limits, disallows executable/file inputs, and reserves distinct corners", () => {
    expect(() => validatePlan({ ...plan, filter: "mono", intensity: 0 }, "mono")).toThrow();
    expect(() => validatePlan({ ...plan, intensity: 0.9 }, "black-gold")).toThrow();
    expect(() => validatePlan(plan, "clean")).toThrow();
    expect(() => validatePlan({ ...plan, captions: [plan.captions[0], plan.captions[0]] }, "black-gold")).toThrow();
    expect(() => validatePlan({ ...plan, command: "ffmpeg" }, "black-gold")).toThrow();
    expect(() => validatePlan({ ...plan, captions: [{ ...plan.captions[0], assetPath: "/tmp/file" }] }, "black-gold")).toThrow();
    const template = materializePlan(plan, "black-gold", { width: 1920, height: 1080 });
    expect(template.layoutPolicy).toBe("corner-safe-v1");
    expect(template.layers[0]).toMatchObject({ type: "text", content: "好物日常", x: 0.04, y: 0.04 });
  });

  it("rejects insecure remote destinations and URL credentials while allowing loopback", () => {
    for (const baseUrl of ["http://example.test/v1", "https://key@example.test/v1", "https://example.test/v1?key=secret", "file:///tmp/a"]) {
      expect(ConnectionInputSchema.safeParse({ ...connection, baseUrl }).success).toBe(false);
    }
    expect(ConnectionInputSchema.safeParse({ ...connection, baseUrl: "http://127.0.0.1:1234/v1" }).success).toBe(true);
  });
});
