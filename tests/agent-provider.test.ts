import { describe, expect, it, vi } from "vitest";
import { AgentProvider, ProviderError, materializePlan, validatePlan } from "../src/main/agent-provider";
import { ConnectionInputSchema, GenerateBriefSchema, RULE_TEMPLATES } from "../src/shared/agent";
import { DEFAULT_TEXT_FONT_FAMILY } from "../src/shared/defaults";
import { AUTOMATIC_STICKERS } from "../src/shared/automatic-stickers";
import { PRICE_STYLES } from "../src/shared/price-styles";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";

const connection = { baseUrl: "https://example.test/v1/", model: "vision-test", apiKey: "test-secret-not-real" };
const plan = { summary: "保留主体", captions: [], filter: "warm", intensity: 0.4 };
const autoCatalog = { fonts: ["Noto Serif CJK SC"], stickers: [{ id: "heart", label: "爱心" }, { id: "sparkle", label: "星芒" }] };
const autoPlan = { ...plan, priceStyle: "classic", stickers: [{ corner: "bottom-right", sticker: "heart", width: 0.12, rotationDeg: 0 }] };
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id}` }])) as BuiltinStickerAssets;

describe("agent provider boundary", () => {
  it.each([
    ['{"candidates":[编号]}', "JSON 格式无效"],
    ['```json\n{"candidates":[1]}\n```', "JSON 格式无效"],
    ['{"candidates":[1,1]}', "候选编号不得重复"],
    ['{"candidates":[0]}', "候选编号必须为 1 到 3 的整数"],
    ['{"candidates":[4]}', "候选编号必须为 1 到 3 的整数"],
    ['{"candidates":[1.5]}', "候选编号必须为 1 到 3 的整数"],
    ['{"candidates":["private-value"]}', "候选编号必须为 1 到 3 的整数"],
    ['{"candidates":[3]}', "候选包含不允许自动选用的贴纸"],
    [JSON.stringify({ candidates: Array(13).fill(1) }), "candidates 必须为最多 12 项的数组"],
    ['{"candidates":null}', "candidates 必须为最多 12 项的数组"],
    ['{}', "candidates 必须为最多 12 项的数组"],
    ['null', "必须返回仅含 candidates 的 JSON 对象"],
    ['{"candidates":[],"private-key":"private-value"}', "不得包含 candidates 以外的字段"],
  ])("explains invalid shortlists safely without retrying: %s", async (response, reason) => {
    const complete = vi.fn().mockResolvedValue(response);
    const provider = new AgentProvider(); provider.useChatGPT("test-model", complete);
    const catalog = { fonts: [], stickers: [...autoCatalog.stickers, { id: "unreviewed", label: "未审核" }] };
    const error = await provider.shortlist("clean", "", [], new AbortController().signal, catalog).catch((error: Error) => error);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toContain(reason);
    expect((error as Error).message).not.toMatch(/private-value|private-key/);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("provides a valid empty shortlist example and explicit number constraints", async () => {
    const complete = vi.fn().mockResolvedValue('{"candidates":[]}');
    const provider = new AgentProvider(); provider.useChatGPT("test-model", complete);
    await expect(provider.shortlist("clean", "", [], new AbortController().signal, autoCatalog)).resolves.toEqual([]);
    const system = complete.mock.calls[0][0][0].content as string;
    const example = JSON.parse(system.split("结构示例：")[1].split("。")[0]);
    expect(example).toEqual({ candidates: [] });
    expect(system).toContain("1 到 2 的整数");
    expect(system).toContain("不要 Markdown");
    expect(system).toContain("不得添加其他字段");
  });

  it("requires model-selected price styles only in automatic plans, without fallback", async () => {
    for (const priceStyle of [undefined, "unknown", { color: "red" }]) {
      const complete = vi.fn().mockResolvedValue(JSON.stringify({ ...autoPlan, priceStyle }));
      const provider = new AgentProvider(); provider.useChatGPT("test-model", complete);
      await expect(provider.plan("black-gold", "", [], new AbortController().signal, autoCatalog)).rejects.toThrow("priceStyle 必须选择");
      expect(complete).toHaveBeenCalledTimes(1);
    }
    expect(() => validatePlan({ ...plan, priceStyle: "classic" }, "black-gold")).toThrow();
    expect(() => validatePlan({ ...autoPlan, productPrice: "1元" }, "black-gold", autoCatalog)).toThrow();
  });

  it("rotates price style suggestions and prioritizes less used styles without forcing the model", async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ ...autoPlan, priceStyle: "gold" }));
    const provider = new AgentProvider(); provider.useChatGPT("test-model", complete);
    for (const selection of [
      { outputIndex: 0, totalOutputs: 3, stickerUsage: [], priceStyleUsage: [] },
      { outputIndex: 1, totalOutputs: 3, stickerUsage: [], priceStyleUsage: [] },
      { outputIndex: 0, totalOutputs: 3, stickerUsage: [], priceStyleUsage: [{ id: "classic" as const, count: 2 }] },
    ]) {
      await expect(provider.plan("black-gold", "", [], new AbortController().signal, autoCatalog, selection)).resolves.toMatchObject({ priceStyle: "gold" });
    }
    const systems = complete.mock.calls.map((call) => call[0][0].content as string);
    const catalogs = systems.map((system) => JSON.parse(system.split("价格花字目录（仅外观，不含价格内容）：")[1].split("。priceStyle")[0]));
    expect(catalogs[0][0].id).toBe("classic");
    expect(catalogs[1][0].id).toBe(PRICE_STYLES[2].id);
    expect(catalogs[2][0].id).toBe("comic");
    expect(catalogs.every((catalog) => catalog.length === 8)).toBe(true);
    expect(systems[2]).toContain('"id":"classic","count":2');
    expect(systems[2]).toContain('"priceStyle":"comic"');
  });

  it.each(RULE_TEMPLATES)("uses valid corner and filter examples for $id", async (rule) => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ ...autoPlan, filter: rule.filters[0], intensity: rule.minIntensity }));
    const provider = new AgentProvider();
    provider.useChatGPT("test-model", complete);
    await provider.plan(rule.id, "", [], new AbortController().signal, autoCatalog);
    const system = complete.mock.calls[0][0][0].content as string;
    const example = JSON.parse(system.split("结构为 ")[1].split("。summary")[0]);
    example.stickers[0].sticker = "heart";
    expect(() => validatePlan(example, rule.id, autoCatalog)).not.toThrow();
    expect(system).toContain("summary 必须为 1 到 240 字符");
    expect(system).not.toContain("top-left|top-right");
  });

  it.each([
    ["not json", "JSON 格式无效"],
    [JSON.stringify({ ...autoPlan, summary: "x".repeat(241) }), "summary 必须为 1 到 240 字符"],
    [JSON.stringify({ ...autoPlan, captions: ["secret-content"] }), "captions 必须为空数组"],
    [JSON.stringify({ ...autoPlan, intensity: 1.1 }), "intensity 必须为 0 到 1 的数值"],
    [JSON.stringify({ ...autoPlan, filter: "invalid" }), "filter 必须为允许的滤镜枚举值"],
    [JSON.stringify({ ...autoPlan, stickers: undefined }), "stickers 必须为最多 4 项的数组"],
    [JSON.stringify({ ...autoPlan, stickers: [{ corner: "secret-content", sticker: "heart" }] }), "贴纸角落必须为四角之一"],
    [JSON.stringify({ ...autoPlan, stickers: [{ corner: "top-left", sticker: "secret-content", width: 0.12, rotationDeg: 0 }] }), "贴纸不在本次候选目录中"],
    [JSON.stringify({ ...autoPlan, stickers: [{ corner: "top-left", sticker: "heart", width: 0.12, rotationDeg: 0 }, { corner: "top-left", sticker: "sparkle", width: 0.12, rotationDeg: 0 }] }), "贴纸角落不得重复"],
    [JSON.stringify({ ...autoPlan, "secret-content": "private-value" }), "方案包含未允许的字段"],
  ])("reports a safe actionable reason without retrying: %s", async (response, reason) => {
    const complete = vi.fn().mockResolvedValue(response);
    const provider = new AgentProvider();
    provider.useChatGPT("test-model", complete);
    const error = await provider.plan("black-gold", "", [], new AbortController().signal, autoCatalog).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(reason);
    expect((error as Error).message).not.toMatch(/secret-content|private-value/);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("randomizes eligible candidates between batches while keeping a batch reproducible", async () => {
    const request = vi.fn().mockImplementation(async () => reply('{"candidates":[1,2,3,4]}'));
    const provider = new AgentProvider(request); provider.configure(connection);
    const catalog = { fonts: [], stickers: AUTOMATIC_STICKERS };
    const choices = [];
    for (const catalogSeed of ["batch-a", "batch-b", "batch-a"]) {
      choices.push(await provider.shortlist("clean", "", [], new AbortController().signal, catalog, { outputIndex: 0, totalOutputs: 1, stickerUsage: [], catalogSeed }));
    }
    expect(choices[0]).not.toEqual(choices[1]);
    expect(choices[0]).toEqual(choices[2]);
    expect(choices.flat().every(id => AUTOMATIC_STICKERS.some(entry => entry.id === id))).toBe(true);
  });

  it("materializes model price appearance even when the draft retains a manual style", () => {
    for (const style of PRICE_STYLES) {
      const template = materializePlan({ ...autoPlan, priceStyle: style.id }, "black-gold", { width: 640, height: 480 }, stickerAssets, { mode: "agent", productPrice: "19.9元30贴" }, autoCatalog);
      expect(template.layers.find(layer => layer.type === "text")).toMatchObject({ content: "19.9元30贴", color: style.color, strokeColor: style.strokeColor });
    }
    expect(() => validatePlan({ ...autoPlan, priceStyle: undefined }, "black-gold", autoCatalog)).toThrow();
    expect(materializePlan({ ...autoPlan, priceStyle: "ice" }, "black-gold", { width: 640, height: 480 }, stickerAssets, { mode: "agent", productPrice: "19.90", priceStyle: "comic" }, autoCatalog).layers.find(layer => layer.type === "text")).toMatchObject({ color: PRICE_STYLES.find(style => style.id === "ice")!.color, content: "¥ 19.90" });
  });

  it("spreads randomized price choices across concurrent outputs and deprioritizes used styles", async () => {
    const firstChoices: string[] = [];
    const request = vi.fn().mockImplementation(async (_url, init) => {
      const system = JSON.parse(init.body).messages[0].content as string;
      const styles = JSON.parse(system.match(/价格花字目录（仅外观，不含价格内容）：(\[.*?\])。/)![1]);
      firstChoices.push(styles[0].id);
      expect(system).not.toContain("batch-seed");
      return reply(JSON.stringify({ ...autoPlan, priceStyle: styles[0].id }));
    });
    const provider = new AgentProvider(request); provider.configure(connection);
    for (let outputIndex = 0; outputIndex < PRICE_STYLES.length; outputIndex++) {
      await provider.plan("clean", "", [], new AbortController().signal, autoCatalog, { outputIndex, totalOutputs: PRICE_STYLES.length, stickerUsage: [], catalogSeed: "batch-seed" });
    }
    expect(new Set(firstChoices).size).toBe(PRICE_STYLES.length);
    await provider.plan("clean", "", [], new AbortController().signal, autoCatalog, { outputIndex: 0, totalOutputs: 1, stickerUsage: [], priceStyleUsage: [{ id: "classic", count: 4 }] });
    expect(firstChoices.at(-1)).not.toBe("classic");
  });

  it("spreads concurrent shortlist starting points across the eligible directory", async () => {
    const request = vi.fn().mockImplementation(async () => reply('{"candidates":[1,2,3,4,5,6,7,8,9,10,11,12]}'));
    const provider = new AgentProvider(request); provider.configure(connection);
    const catalog = { fonts: [], stickers: AUTOMATIC_STICKERS.slice(0, 48) };
    const choices = await Promise.all(Array.from({ length: 4 }, (_, outputIndex) => provider.shortlist("clean", "", [], new AbortController().signal, catalog, { outputIndex, totalOutputs: 4, stickerUsage: [] })));
    expect(new Set(choices.flat()).size).toBe(48);
    expect(catalog.stickers).toEqual(AUTOMATIC_STICKERS.slice(0, 48));
  });

  it("uses capability boundaries without preset style or scheduled composition", async () => {
    const request = vi.fn().mockImplementation(async (_url, init) => reply(JSON.parse(init.body).messages[0].content.includes("你是视频贴纸选材师") ? '{"candidates":[1]}' : JSON.stringify(autoPlan)));
    const provider = new AgentProvider(request); provider.configure(connection);
    const selection = { outputIndex: 1, totalOutputs: 4, stickerUsage: [] };
    await provider.shortlist("black-gold", "", [], new AbortController().signal, autoCatalog, selection);
    await provider.plan("black-gold", "", [], new AbortController().signal, autoCatalog, selection);
    for (const call of request.mock.calls) {
      const system = JSON.parse(call[1].body).messages[0].content;
      expect(system).not.toContain('"id":"black-gold"');
      expect(system).not.toContain("本条视觉探索方向");
      expect(system).toContain('"filters":["none","warm","cool","mono","vivid"]');
      expect(system).toContain('"maxStickerWidth":0.2');
    }
  });

  it("lets the agent choose filter and geometry independently of every manual preset", () => {
    const raw = { ...autoPlan, filter: "none", intensity: 0, stickers: [{ corner: "top-right", sticker: "heart", width: 0.17, rotationDeg: -11 }] };
    for (const rule of RULE_TEMPLATES) {
      const template = materializePlan(raw, rule.id, { width: 640, height: 480 }, stickerAssets, { mode: "agent", productPrice: "19.90" }, autoCatalog);
      expect(template.filter).toEqual({ presetId: "none", intensity: 0 });
      expect(template.layers[0]).toMatchObject({ width: 0.17, rotationDeg: -11, y: 0.04 });
      expect(template.layers[0].x).toBeCloseTo(0.79);
      expect(template.name).not.toBe(rule.name);
      expect(template.layers[1]).toMatchObject({ content: "¥ 19.90" });
    }
    expect(() => validatePlan({ ...plan, filter: "none", intensity: 0 }, "black-gold")).toThrow();
  });

  it("rejects missing or unsafe agent geometry instead of supplying a preset", () => {
    for (const geometry of [{}, { width: 0.21, rotationDeg: 0 }, { width: 0, rotationDeg: 0 }, { width: 0.12, rotationDeg: 16 }]) {
      expect(() => validatePlan({ ...autoPlan, stickers: [{ corner: "top-right", sticker: "heart", ...geometry }] }, "black-gold", autoCatalog)).toThrow();
    }
    expect(() => materializePlan({ ...autoPlan, stickers: ["top-left", "top-right", "bottom-left"].map(corner => ({ corner, sticker: "heart", width: 0.2, rotationDeg: 0 })) }, "black-gold", { width: 640, height: 480 }, stickerAssets, { mode: "agent" }, autoCatalog)).toThrow();
  });

  it("cycles small catalogs for larger batches and preserves empty and single-output selection", async () => {
    const request = vi.fn().mockImplementation(async () => reply('{"candidates":[1]}'));
    const provider = new AgentProvider(request); provider.configure(connection);
    const choices = [];
    for (let outputIndex = 0; outputIndex < 5; outputIndex++) {
      choices.push(await provider.shortlist("clean", "", [], new AbortController().signal, autoCatalog, { outputIndex, totalOutputs: 5, stickerUsage: [] }));
    }
    expect(choices).toEqual([["heart"], ["sparkle"], ["heart"], ["sparkle"], ["heart"]]);
    await provider.shortlist("clean", "", [], new AbortController().signal, autoCatalog, { outputIndex: 0, totalOutputs: 1, stickerUsage: [] });
    expect(JSON.parse(request.mock.calls.at(-1)![1].body).messages[0].content).not.toContain("本条视觉探索方向");
    request.mockResolvedValueOnce(reply('{"candidates":[]}'));
    await expect(provider.shortlist("clean", "", [], new AbortController().signal, { fonts: [], stickers: [] }, { outputIndex: 0, totalOutputs: 4, stickerUsage: [] })).resolves.toEqual([]);
  });

  it("rotates eligible candidates despite forbidden entries and maps usage to current numbers", async () => {
    const request = vi.fn().mockImplementation(async () => reply('{"candidates":[1]}'));
    const provider = new AgentProvider(request); provider.configure(connection);
    const catalog = { fonts: [], stickers: [{ id: "unreviewed", label: "未审核" }, ...autoCatalog.stickers] };
    const signal = new AbortController().signal;
    await expect(provider.shortlist("black-gold", "", [], signal, catalog, { outputIndex: 0, totalOutputs: 3, stickerUsage: [], priceStyleUsage: [] })).resolves.toEqual(["heart"]);
    await expect(provider.shortlist("black-gold", "", [], signal, catalog, { outputIndex: 1, totalOutputs: 3, stickerUsage: [], priceStyleUsage: [] })).resolves.toEqual(["sparkle"]);
    await provider.shortlist("black-gold", "", [], signal, catalog, { outputIndex: 2, totalOutputs: 3, stickerUsage: [{ id: "heart", count: 2 }], priceStyleUsage: [] });
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
    expect(() => validatePlan({ ...autoPlan, stickers: [{ corner: "bottom-right", sticker: "local-limited-discount", width: 0.12, rotationDeg: 0 }] }, "black-gold", { fonts: [], stickers: [{ id: "local-limited-discount", label: "限时折扣" }] })).toThrow();
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
      expect(system).toContain('"minIntensity":0');
      expect(system).toContain("新增文字只允许");
    }
  });

  it("varies equal-use catalog ordering and prioritizes less used stickers without excluding choices", async () => {
    const request = vi.fn().mockImplementation(async () => reply(JSON.stringify(autoPlan)));
    const provider = new AgentProvider(request);
    provider.configure(connection);
    for (const context of [
      { outputIndex: 0, totalOutputs: 3, stickerUsage: [], priceStyleUsage: [] },
      { outputIndex: 1, totalOutputs: 3, stickerUsage: [], priceStyleUsage: [] },
      { outputIndex: 0, totalOutputs: 3, stickerUsage: [{ id: "heart", count: 2 }], priceStyleUsage: [] },
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
    expect(() => validatePlan({ ...autoPlan, stickers: [{ corner: "bottom-right", sticker: "unknown", width: 0.12, rotationDeg: 0 }] }, "black-gold", autoCatalog)).toThrow();
    expect(() => validatePlan({ ...autoPlan, stickers: [{ corner: "bottom-right", sticker: "heart", width: 0.12, rotationDeg: 0 }, { corner: "bottom-right", sticker: "sparkle", width: 0.12, rotationDeg: 0 }] }, "black-gold", autoCatalog)).toThrow();
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
      expect(system).toContain("新增文字只允许用户在展示文字栏手动填写、由本地程序生成的居中文字");
      expect(system).toContain("Agent 不得生成、推测、改写价格或其他手动文字");
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
    const request = vi.fn().mockResolvedValueOnce(reply('{"candidates":[1]}')).mockResolvedValueOnce(reply(JSON.stringify({ summary: "选用用户上传", captions: [], priceStyle: "classic", stickers: [{ corner: "top-left", sticker: id, width: 0.12, rotationDeg: 0 }], filter: "cool", intensity: 0.3 })));
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
