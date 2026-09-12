import { describe, expect, it, vi } from "vitest";
import { AgentProvider, materializePlan, validatePlan } from "../src/main/agent-provider";
import { ConnectionInputSchema, GenerateBriefSchema, RULE_TEMPLATES } from "../src/shared/agent";
import { TemplateCompiler } from "../src/main/compiler";
import { DEFAULT_PRESET, type MediaItem } from "../src/main/domain";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";

const connection = { baseUrl: "https://example.test/v1/", model: "vision-test", apiKey: "test-secret-not-real" };
const plan = { summary: "保留主体，添加短标题", captions: [{ text: "好物日常", corner: "top-left", size: 0.026 }], filter: "warm", intensity: 0.4 };
const autoCatalog = { fonts: ["Noto Serif CJK SC", "Noto Sans CJK SC"], stickers: [{ id: "heart", label: "爱心" }, { id: "sparkle", label: "星芒" }] };
const autoPlan = { ...plan, captions: [{ ...plan.captions[0], fontFamily: "Noto Serif CJK SC" }], stickers: [{ corner: "bottom-right", sticker: "heart" }] };
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id}` }])) as BuiltinStickerAssets;

describe("agent provider boundary", () => {
  it("keeps twelve Chinese characters on one line for portrait and landscape media", async () => {
    for (const dimensions of [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }]) {
      const input = { ...plan, captions: [{ text: "一二三四五六七八九十一二", corner: "bottom-right", size: 0.03 }], filter: "cool", intensity: 0.3 };
      const template = materializePlan(input, "clean", dimensions, stickerAssets);
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

  it("generates a text-only brief from manual choices using safe catalogue labels", async () => {
    const request = vi.fn().mockResolvedValue(reply("  用暖金滤镜突出手作质感，保留左上标题和右下贴纸的呼吸空间。  "));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    await expect(provider.generateBrief({ ruleId: "black-gold", brief: "参考：木质香薰", decorations: { sticker: "heart", fontFamily: "Noto Serif CJK SC", corners: {
      "top-left": { type: "text", text: "手作日常", fontFamily: "Noto Serif CJK SC" },
      "bottom-right": { type: "sticker", sticker: "local-limited-discount" },
    } } }, new AbortController().signal)).resolves.toBe("用暖金滤镜突出手作质感，保留左上标题和右下贴纸的呼吸空间。");
    const messages = JSON.parse(request.mock.calls[0][1].body).messages;
    expect(messages[1].content).toBeTypeOf("string");
    expect(messages[0].content).not.toContain("手作日常");
    expect(messages[1].content).toContain("限时折扣");
    expect(messages[1].content).toContain("手作日常");
    expect(messages[1].content).toContain("Noto Serif CJK SC");
    expect(JSON.stringify(messages)).not.toContain("data:image");
  });

  it("allows a free stylistic direction when choices are absent or agent-managed", async () => {
    const request = vi.fn().mockResolvedValue(reply("自然清透的生活记录方向。"));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    await provider.generateBrief({ ruleId: "clean", decorations: { mode: "agent", sticker: "local-limited-discount", fontFamily: "Not A Font", corners: { "top-left": { type: "text", text: "坏数据", fontFamily: "Not A Font" } } } }, new AbortController().signal);
    const user = JSON.parse(request.mock.calls[0][1].body).messages[1].content;
    expect(user).toContain("自由发挥");
    expect(user).not.toContain("限时折扣");
  });

  it("omits unused global decorations when every corner is explicitly empty", async () => {
    const request = vi.fn().mockResolvedValue(reply("保留干净画面，不添加角落装饰。"));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    await provider.generateBrief({ ruleId: "clean", decorations: { sticker: "local-limited-discount", fontFamily: "Noto Serif CJK SC", corners: {
      "top-left": { type: "none" }, "top-right": { type: "none" }, "bottom-left": { type: "none" }, "bottom-right": { type: "none" },
    } } }, new AbortController().signal);
    const user = JSON.parse(request.mock.calls[0][1].body).messages[1].content;
    expect(user).not.toContain("限时折扣");
    expect(user).not.toContain("Noto Serif CJK SC");
    for (const corner of ["左上角", "右上角", "左下角", "右下角"]) expect(user).toContain(`${corner}留空`);
  });

  it("rejects invalid brief responses without a fallback", async () => {
    for (const response of ["", "\u0000", "x".repeat(1001)]) {
      const provider = new AgentProvider(vi.fn().mockResolvedValue(reply(response)));
      provider.configure(connection);
      await expect(provider.generateBrief({ ruleId: "clean" }, new AbortController().signal)).rejects.toThrow();
    }
    expect(() => GenerateBriefSchema.parse({ ruleId: "clean", brief: "x".repeat(1001) })).toThrow();
  });

  it("enforces rule limits, disallows executable/file inputs, and reserves distinct corners", () => {
    expect(() => validatePlan({ ...plan, filter: "mono", intensity: 0 }, "mono")).toThrow();
    expect(() => validatePlan({ ...plan, intensity: 0.9 }, "black-gold")).toThrow();
    expect(() => validatePlan(plan, "clean")).toThrow();
    expect(() => validatePlan({ ...plan, captions: [plan.captions[0], plan.captions[0]] }, "black-gold")).toThrow();
    expect(() => validatePlan({ ...plan, command: "ffmpeg" }, "black-gold")).toThrow();
    expect(() => validatePlan({ ...plan, captions: [{ ...plan.captions[0], assetPath: "/tmp/file" }] }, "black-gold")).toThrow();
    const template = materializePlan(plan, "black-gold", { width: 1920, height: 1080 }, stickerAssets);
    expect(template.layoutPolicy).toBe("corner-safe-v1");
    expect(template.layers[0]).toMatchObject({ type: "text", content: "好物日常", x: 0.04, y: 0.04 });
    expect(template.layers[1]).toMatchObject({ type: "sticker", assetPath: "/tmp/sparkle.png", width: 0.12, x: 0.84, y: 0.8 });
  });

  it("fails closed for agent-selected decorations and materializes only its occupied corners", () => {
    expect(validatePlan(autoPlan, "black-gold", autoCatalog)).toMatchObject(autoPlan);
    expect(() => validatePlan({ ...autoPlan, captions: [{ ...autoPlan.captions[0], fontFamily: "unknown" }] }, "black-gold", autoCatalog)).toThrow();
    expect(() => validatePlan({ ...autoPlan, stickers: [{ corner: "bottom-right", sticker: "unknown" }] }, "black-gold", autoCatalog)).toThrow();
    expect(() => validatePlan({ ...autoPlan, stickers: [{ corner: "top-left", sticker: "heart" }] }, "black-gold", autoCatalog)).toThrow();
    expect(() => validatePlan({ ...autoPlan, captions: [{ text: "缺少字体", corner: "top-left", size: 0.026 }] }, "black-gold", autoCatalog)).toThrow();
    expect(() => validatePlan({ ...autoPlan, stickers: undefined }, "black-gold", autoCatalog)).toThrow();
    const template = materializePlan(autoPlan, "black-gold", { width: 720, height: 1280 }, stickerAssets, { mode: "agent", sticker: "none", fontFamily: "SimHei", corners: { "top-left": { type: "text", text: "手动", fontFamily: "SimHei" } } }, autoCatalog);
    expect(template.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", content: "好物日常", fontFamily: "Noto Serif CJK SC", x: 0.04, y: 0.04 }),
      expect.objectContaining({ type: "sticker", assetPath: "/tmp/heart.png", x: 0.84, y: 0.8 }),
    ]));
    expect(template.layers).toHaveLength(2);
  });

  it("permits an intentionally empty agent decoration plan", () => {
    const template = materializePlan({ ...autoPlan, captions: [], stickers: [] }, "black-gold", { width: 720, height: 1280 }, stickerAssets, { mode: "agent" }, autoCatalog);
    expect(template.layers).toEqual([]);
  });

  it("materializes every visible rule as a distinct filtered template with one governed sticker", () => {
    expect(RULE_TEMPLATES).toHaveLength(8);
    const signatures = RULE_TEMPLATES.map((rule) => {
      const template = materializePlan({ ...plan, filter: rule.filters[0], intensity: rule.minIntensity }, rule.id, { width: 1080, height: 1920 }, stickerAssets);
      const sticker = template.layers.find((layer) => layer.type === "sticker");
      expect(sticker).toMatchObject({ type: "sticker", width: rule.stickerWidth, rotationDeg: rule.stickerRotation });
      expect(template.filter).toEqual({ presetId: rule.filters[0], intensity: rule.minIntensity });
      expect(sticker && sticker.width * sticker.width).toBeLessThan(0.08);
      return `${template.filter.presetId}:${rule.sticker}:${rule.textColor.join("-")}:${rule.backgroundColor.join("-")}:${rule.stickerWidth}:${rule.stickerRotation}`;
    });
    expect(new Set(signatures).size).toBe(RULE_TEMPLATES.length);
  });

  it("rejects insecure remote destinations and URL credentials while allowing loopback", () => {
    for (const baseUrl of ["http://example.test/v1", "https://key@example.test/v1", "https://example.test/v1?key=secret", "file:///tmp/a"]) {
      expect(ConnectionInputSchema.safeParse({ ...connection, baseUrl }).success).toBe(false);
    }
    expect(ConnectionInputSchema.safeParse({ ...connection, baseUrl: "http://127.0.0.1:1234/v1" }).success).toBe(true);
  });
});
