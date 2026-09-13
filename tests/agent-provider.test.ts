import { describe, expect, it, vi } from "vitest";
import { AgentProvider, materializePlan, validatePlan } from "../src/main/agent-provider";
import { ConnectionInputSchema, GenerateBriefSchema, RULE_TEMPLATES } from "../src/shared/agent";
import { DEFAULT_TEXT_FONT_FAMILY } from "../src/shared/defaults";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";

const connection = { baseUrl: "https://example.test/v1/", model: "vision-test", apiKey: "test-secret-not-real" };
const plan = { summary: "保留主体", captions: [], filter: "warm", intensity: 0.4 };
const autoCatalog = { fonts: ["Noto Serif CJK SC"], stickers: [{ id: "heart", label: "爱心" }, { id: "sparkle", label: "星芒" }] };
const autoPlan = { ...plan, stickers: [{ corner: "bottom-right", sticker: "heart" }] };
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id}` }])) as BuiltinStickerAssets;

describe("agent provider boundary", () => {
  it("rotates eligible candidates despite forbidden entries and maps usage to current numbers", async () => {
    const request = vi.fn().mockImplementation(async () => reply('{"candidates":[1]}'));
    const provider = new AgentProvider(request); provider.configure(connection);
    const catalog = { fonts: [], stickers: [{ id: "unreviewed", label: "未审核" }, ...autoCatalog.stickers] };
    const signal = new AbortController().signal;
    await expect(provider.shortlist("black-gold", "", [], signal, catalog, { outputIndex: 0, totalOutputs: 3, stickerUsage: [] })).resolves.toEqual(["heart"]);
    await expect(provider.shortlist("black-gold", "", [], signal, catalog, { outputIndex: 1, totalOutputs: 3, stickerUsage: [] })).resolves.toEqual(["sparkle"]);
    await provider.shortlist("black-gold", "", [], signal, catalog, { outputIndex: 2, totalOutputs: 3, stickerUsage: [{ id: "heart", count: 2 }] });
    expect(JSON.parse(request.mock.calls[2][1].body).messages[0].content).toContain('"number":2,"count":2');
  });
  it("shortlists numbered candidates from the full directory and rejects forbidden or duplicate choices", async () => {
    const catalog = { fonts: [], stickers: [...autoCatalog.stickers, { id: "local-limited-discount", label: "限时折扣" }] };
    const request = vi.fn().mockResolvedValueOnce(reply('{"candidates":[1]}')).mockResolvedValueOnce(reply('{"candidates":[3]}')).mockResolvedValueOnce(reply('{"candidates":[1,1]}'));
    const provider = new AgentProvider(request); provider.configure(connection);
    const signal = new AbortController().signal;
    await expect(provider.shortlist("black-gold", "", [], signal, catalog)).resolves.toEqual(["heart"]);
    const messages = JSON.parse(request.mock.calls[0][1].body).messages;
    expect(JSON.stringify(messages)).toContain("限时折扣");
    expect(JSON.stringify(messages)).toContain("禁止");
    await expect(provider.shortlist("black-gold", "", [], signal, catalog)).rejects.toThrow("候选");
    await expect(provider.shortlist("black-gold", "", [], signal, catalog)).rejects.toThrow("候选");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("sends numbered candidate JPEGs separately from video frames and rejects textual stickers locally", async () => {
    const request = vi.fn().mockResolvedValue(reply(JSON.stringify(autoPlan)));
    const provider = new AgentProvider(request); provider.configure(connection);
    const preview = "data:image/jpeg;base64,cHJldmlldw==";
    await provider.plan("black-gold", "", ["data:image/jpeg;base64,ZnJhbWU="], new AbortController().signal, { ...autoCatalog, previews: [{ id: "heart", url: preview }] });
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body.messages[1].content).toContainEqual({ type: "image_url", image_url: { url: preview, detail: "low" } });
    expect(JSON.stringify(body)).toContain("贴纸候选 1");
    expect(() => validatePlan({ ...autoPlan, stickers: [{ corner: "bottom-right", sticker: "local-limited-discount" }] }, "black-gold", { fonts: [], stickers: [{ id: "local-limited-discount", label: "限时折扣" }] })).toThrow();
  });
  it("removes template sticker bias from automatic briefs and plans", async () => {
    const request = vi.fn().mockResolvedValueOnce(reply("按画面留白选择贴纸")).mockResolvedValueOnce(reply(JSON.stringify(autoPlan)));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    await provider.generateBrief({ ruleId: "black-gold", decorations: { mode: "agent" } }, new AbortController().signal);
    await provider.plan("black-gold", "", [], new AbortController().signal, autoCatalog);
    for (const call of request.mock.calls) {
      const system = JSON.parse(call[1].body).messages[0].content;
      expect(system).not.toContain('"sticker":"sparkle"');
      expect(system).not.toContain("暖金滤镜配星芒贴纸");
      expect(system).toContain('"minIntensity":0.35');
      expect(system).toContain("新增文字只允许");
    }
  });

  it("varies equal-use catalog ordering and prioritizes less used stickers without excluding choices", async () => {
    const request = vi.fn().mockImplementation(async () => reply(JSON.stringify(autoPlan)));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    for (const context of [
      { outputIndex: 0, totalOutputs: 3, stickerUsage: [] },
      { outputIndex: 1, totalOutputs: 3, stickerUsage: [] },
      { outputIndex: 0, totalOutputs: 3, stickerUsage: [{ id: "heart", count: 2 }] },
    ]) await provider.plan("black-gold", "", [], new AbortController().signal, autoCatalog, context);
    const systems = request.mock.calls.map((call) => JSON.parse(call[1].body).messages[0].content as string);
    expect(systems[0].indexOf('"id":"heart"')).toBeLessThan(systems[0].indexOf('"id":"sparkle"'));
    for (const system of systems.slice(1)) expect(system.indexOf('"id":"sparkle"')).toBeLessThan(system.indexOf('"id":"heart"'));
    expect(systems[2]).toContain('"count":2');
    expect(autoCatalog.stickers.map(({ id }) => id)).toEqual(["heart", "sparkle"]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("rejects every model-supplied caption in manual and agent plans", async () => {
    for (const [catalog, raw] of [[undefined, plan], [autoCatalog, autoPlan]] as const) {
      expect(() => validatePlan({ ...raw, captions: [{ text: "细节之美" }] }, "black-gold", catalog)).toThrow();
      const provider = new AgentProvider(vi.fn().mockResolvedValue(reply(JSON.stringify({ ...raw, captions: [{ text: "木质香薰" }] }))));
      provider.configure(connection);
      await expect(provider.plan("black-gold", "日常", [], new AbortController().signal, catalog)).rejects.toThrow("格式或规则不合格");
    }
  });

  it("requires an explicit empty captions array and agent stickers", () => {
    expect(validatePlan(plan, "black-gold")).toMatchObject(plan);
    expect(() => validatePlan({ ...plan, captions: undefined }, "black-gold")).toThrow();
    expect(validatePlan(autoPlan, "black-gold", autoCatalog)).toMatchObject(autoPlan);
    expect(() => validatePlan({ ...autoPlan, stickers: undefined }, "black-gold", autoCatalog)).toThrow();
    expect(() => validatePlan({ ...autoPlan, stickers: [{ corner: "bottom-right", sticker: "unknown" }] }, "black-gold", autoCatalog)).toThrow();
    expect(() => validatePlan({ ...autoPlan, stickers: [{ corner: "bottom-right", sticker: "heart" }, { corner: "bottom-right", sticker: "sparkle" }] }, "black-gold", autoCatalog)).toThrow();
  });

  it("materializes only the local center price using the default font", () => {
    for (const [raw, options, catalog] of [
      [plan, { mode: "manual", productPrice: "19.90" }, undefined],
      [autoPlan, { mode: "agent", productPrice: "19.90" }, autoCatalog],
    ] as const) {
      const template = materializePlan(raw, "black-gold", { width: 1080, height: 1920 }, stickerAssets, options, catalog);
      const textLayers = template.layers.filter((layer) => layer.type === "text");
      expect(textLayers).toEqual([expect.objectContaining({ content: "¥ 19.90", fontFamily: DEFAULT_TEXT_FONT_FAMILY, textAlign: "center", x: 0.1, y: 0.13, width: 0.8 })]);
      expect(template.productPrice).toBe("19.90");
    }
  });

  it("allows planning without a price but produces no text layer", () => {
    const template = materializePlan(plan, "black-gold", { width: 720, height: 1280 }, stickerAssets);
    expect(template.productPrice).toBeUndefined();
    expect(template.layers.every((layer) => layer.type === "sticker")).toBe(true);
  });

  it("forbids decorative text in model instructions", async () => {
    const request = vi.fn().mockResolvedValueOnce(reply("保留画面")).mockResolvedValueOnce(reply(JSON.stringify(plan)));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    await provider.generateBrief({ ruleId: "black-gold", brief: "请写产品名" }, new AbortController().signal);
    await provider.plan("black-gold", "请写产品名", [], new AbortController().signal);
    for (const call of request.mock.calls) {
      const system = JSON.parse(call[1].body).messages[0].content;
      expect(system).toContain("新增文字只允许用户手动填写、由本地程序生成的居中价格");
      expect(system).toContain("Agent 不得生成、推测、改写价格");
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

  it("does not surface response bodies or retry failed paid requests", async () => {
    const request = vi.fn().mockResolvedValue(new Response(connection.apiKey, { status: 401 }));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    await expect(provider.test(new AbortController().signal)).rejects.toThrow("API Key 无效");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects sensitive responses and invalid plans without fallback", async () => {
    const request = vi.fn().mockResolvedValueOnce(reply(connection.apiKey)).mockResolvedValueOnce(reply("not json"));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    await expect(provider.test(new AbortController().signal)).rejects.toThrow("敏感信息");
    await expect(provider.plan("clean", "", [], new AbortController().signal)).rejects.toThrow("格式或规则不合格");
  });

  it("uses only sticker choices in manual brief context", async () => {
    const request = vi.fn().mockResolvedValue(reply("保留右下贴纸空间。"));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    await provider.generateBrief({ ruleId: "black-gold", decorations: { sticker: "heart", corners: { "bottom-right": { type: "sticker", sticker: "local-limited-discount" } } } }, new AbortController().signal);
    const messages = JSON.parse(request.mock.calls[0][1].body).messages;
    expect(messages[1].content).toContain("爱心");
    expect(messages[1].content).toContain("限时折扣");
    expect(JSON.stringify(messages)).not.toContain("fontFamily");
  });

  it("sends actual uploaded sticker images for manual planning and brief generation", async () => {
    const request = vi.fn().mockResolvedValueOnce(reply(JSON.stringify({ summary: "搭配上传贴纸", captions: [], filter: "cool", intensity: 0.3 }))).mockResolvedValueOnce(reply("保留用户贴纸，使用清爽滤镜。"));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    const previews = [{ id: `uploaded-${"a".repeat(64)}`, url: "data:image/jpeg;base64,c3RpY2tlcg==" }];
    await provider.plan("clean", "", ["data:image/jpeg;base64,dmlkZW8="], new AbortController().signal, undefined, undefined, previews);
    await provider.generateBrief({ ruleId: "clean", decorations: { sticker: previews[0].id } }, new AbortController().signal, previews);
    for (const call of request.mock.calls) {
      const messages = JSON.parse(call[1].body).messages;
      expect(messages[1].content).toContainEqual({ type: "image_url", image_url: { url: previews[0].url, detail: "low" } });
      expect(JSON.stringify(messages)).toContain("用户手动选择的上传贴纸");
      expect(JSON.stringify(messages)).toContain("不能自行替换");
      expect(JSON.stringify(messages)).not.toContain("assetPath");
    }
  });

  it("lets automatic selection see and choose locally cataloged uploads, including user-supplied text", async () => {
    const id = `uploaded-${"b".repeat(64)}`;
    const preview = { id, url: "data:image/jpeg;base64,dXBsb2Fk" };
    const catalog = { fonts: [], stickers: [{ id, label: "用户上传的文字贴纸" }], previews: [preview] };
    const request = vi.fn().mockResolvedValueOnce(reply('{"candidates":[1]}')).mockResolvedValueOnce(reply(JSON.stringify({ summary: "选用用户上传", captions: [], stickers: [{ corner: "top-left", sticker: id }], filter: "cool", intensity: 0.3 })));
    const provider = new AgentProvider(request); provider.configure(connection);
    expect(await provider.shortlist("clean", "", [], new AbortController().signal, catalog)).toEqual([id]);
    await provider.plan("clean", "", [], new AbortController().signal, catalog);
    for (const call of request.mock.calls) {
      const messages = JSON.parse(call[1].body).messages;
      expect(messages[1].content).toContainEqual({ type: "image_url", image_url: { url: preview.url, detail: "low" } });
      expect(messages[0].content).toContain("明确例外");
    }
  });

  it("rejects invalid brief responses and insecure connection URLs", async () => {
    for (const response of ["", "\u0000", "x".repeat(1001)]) {
      const provider = new AgentProvider(vi.fn().mockResolvedValue(reply(response)));
      provider.configure(connection);
      await expect(provider.generateBrief({ ruleId: "clean" }, new AbortController().signal)).rejects.toThrow();
    }
    expect(() => GenerateBriefSchema.parse({ ruleId: "clean", brief: "x".repeat(1001) })).toThrow();
    for (const baseUrl of ["http://example.test/v1", "https://key@example.test/v1", "https://example.test/v1?key=secret", "file:///tmp/a"]) {
      expect(ConnectionInputSchema.safeParse({ ...connection, baseUrl }).success).toBe(false);
    }
    expect(ConnectionInputSchema.safeParse({ ...connection, baseUrl: "http://127.0.0.1:1234/v1" }).success).toBe(true);
  });

  it("keeps rule templates distinct without text style fields", () => {
    expect(RULE_TEMPLATES).toHaveLength(12);
    const signatures = RULE_TEMPLATES.map((rule) => `${rule.id}:${rule.sticker}:${rule.stickerWidth}:${rule.stickerRotation}`);
    expect(new Set(signatures).size).toBe(RULE_TEMPLATES.length);
    expect(RULE_TEMPLATES.every((rule) => !("previewCaption" in rule) && !("maxFontSize" in rule) && !("maxBadges" in rule) && !("textColor" in rule) && !("backgroundColor" in rule))).toBe(true);
  });
});
