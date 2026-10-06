import { expect, it } from "vitest";
import { AgentStartSchema } from "../src/shared/agent";
import { DecorationSchema, displayTextSettings, DEFAULT_DISPLAY_TEXT } from "../src/shared/decorations";
import { materializePlan, type PackagingPlan } from "../src/main/agent-provider";
import type { StickerAssets } from "../src/main/builtin-stickers";
import { prepareAgentTemplate } from "../src/main/agent-template-preparation";
import { assertPriceOnlyTemplate, DEFAULT_PRESET, EditTemplateSchema, type MediaItem } from "../src/main/domain";
import { TemplateCompiler } from "../src/main/compiler";
import { ProjectWorkspaceSchema } from "../src/shared/project-workspace";
import { DEFAULT_EXPORT_SETTINGS } from "../src/shared/export-settings";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";

const ids = [crypto.randomUUID(), crypto.randomUUID()];
const request = { mediaIds: ids, ruleId: "clean", brief: "", outputDirectory: "/tmp/output" };
const plan: PackagingPlan = { summary: "包装", captions: [], filter: "cool", intensity: 0.3 };
const assets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map(id => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: "fixture" }])) as StickerAssets;
const source = (id: string): MediaItem => ({ id, sourcePath: "/tmp/source.mp4", displayName: "source", fingerprint: "fixture", width: 720, height: 1280, durationMs: 2000, sizeBytes: 1, rotation: 0, importedAt: new Date().toISOString(), probeStatus: "ready" });
const off = { enabled: false, x: 0.5, y: 0.13 };
const moved = { enabled: true, x: 0.65, y: 0.6 };

it("requires manual text only when a selected material displays it", () => {
  expect(AgentStartSchema.safeParse({ ...request, decorations: { displayText: off } }).success).toBe(true);
  expect(AgentStartSchema.parse({ ...request, decorations: { productPrice: "一二三四五六七八九十一二三", displayText: off } }).decorations?.productPrice).toBeUndefined();
  expect(AgentStartSchema.safeParse({ ...request, decorations: { displayText: off, displayTextByMedia: { [ids[1]]: moved } } }).success).toBe(false);
  expect(AgentStartSchema.safeParse({ ...request, decorations: { displayTextByMedia: Object.fromEntries(ids.map(id => [id, off])) } }).success).toBe(true);
  expect(AgentStartSchema.safeParse({ ...request, decorations: { displayTextByMedia: { [ids[0]]: off } } }).success).toBe(false);
  expect(AgentStartSchema.safeParse({ ...request, decorations: { displayText: off, displayTextByMedia: { [crypto.randomUUID()]: moved } } }).success).toBe(true);
  expect(AgentStartSchema.safeParse({ ...request, decorations: { productPrice: "手动文字", displayTextByMedia: { [ids[0]]: moved } } }).success).toBe(true);
});

it("preserves per-media settings in Agent mode and rejects invalid coordinates or extra text", () => {
  const options = DecorationSchema.parse({ mode: "agent", displayText: off, displayTextByMedia: { [ids[0]]: moved } });
  expect(displayTextSettings(options, ids[0])).toEqual(moved);
  expect(displayTextSettings(options, ids[1])).toEqual(off);
  expect(displayTextSettings(DecorationSchema.parse({}))).toEqual(DEFAULT_DISPLAY_TEXT);
  for (const invalid of [{ ...moved, x: -0.1 }, { ...moved, y: 1.1 }, { ...moved, x: Infinity }, { ...moved, text: "模型生成" }]) {
    expect(DecorationSchema.safeParse({ displayText: invalid }).success).toBe(false);
  }
});

it("freezes each material's display switch and position for compilation and retry", async () => {
  const options = DecorationSchema.parse({ mode: "manual", sticker: "none", productPrice: "手动文字", displayTextByMedia: { [ids[0]]: moved, [ids[1]]: off } });
  const prepare = (id: string) => prepareAgentTemplate({ plan, ruleId: "clean", source: source(id), stickerAssets: assets, decorations: options, runId: crypto.randomUUID(), version: 1 });
  const first = EditTemplateSchema.parse(JSON.parse(JSON.stringify(prepare(ids[0]))));
  const second = prepare(ids[1]);
  expect(first.displayText).toEqual(moved);
  expect(first.layers.find(layer => layer.type === "text")).toMatchObject({ content: "手动文字", x: 0.65, y: 0.6, textAnchor: "center-top" });
  expect(second.layers.filter(layer => layer.type === "text")).toEqual([]);
  expect(second.productPrice).toBeUndefined();
  expect(second.displayText?.enabled).toBe(false);
  const compiler = new TemplateCompiler();
  const compile = (template: typeof first) => compiler.compile(template, source(ids[0]), DEFAULT_PRESET, { ffmpegPath: "ffmpeg", fontResolver: { resolve: async () => "/tmp/font.ttf" }, textFilePath: id => `/tmp/${id}.txt` });
  const result = await compile(first);
  expect(result.args.join(" ")).toContain("x=w*0.65000-text_w/2");
  expect(result.args.join(" ")).toContain("y=h*0.60000");
  expect((await compile(second)).textFiles).toEqual([]);
  expect(() => assertPriceOnlyTemplate({ ...first, layers: first.layers.map(layer => ({ ...layer, x: 0.4 })) })).toThrow();
  expect(() => assertPriceOnlyTemplate({ ...second, layers: first.layers })).toThrow();
  options.displayTextByMedia![ids[0]].y = 0.2;
  expect(first.displayText?.y).toBe(0.6);
});

it("keeps historical templates at their frozen coordinates and rejects legacy layout tampering", () => {
  const template = materializePlan(plan, "clean", { width: 720, height: 1280 }, assets, { productPrice: "原价", sticker: "none" });
  expect(template.displayText).toBeUndefined();
  expect(template.layers[0]).toMatchObject({ x: 0.1, y: 0.13, width: 0.8 });
  expect(() => assertPriceOnlyTemplate(template)).not.toThrow();
  expect(() => assertPriceOnlyTemplate({ ...template, layers: template.layers.map(layer => ({ ...layer, y: 0.5 })) })).toThrow();
});

it("persists position and switches without duplicating batch text in the workspace", () => {
  const workspace = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: ids, ruleId: "clean", brief: "", decorations: { productPrice: "共用文字", displayText: off, displayTextByMedia: { [ids[0]]: moved } }, exportFormat: "mp4", exportSettings: DEFAULT_EXPORT_SETTINGS });
  expect(workspace.decorations).not.toHaveProperty("productPrice");
  expect(ProjectWorkspaceSchema.parse(JSON.parse(JSON.stringify(workspace))).decorations.displayTextByMedia?.[ids[0]]).toEqual(moved);
});

it("reopens the saved project with independent display settings and the shared manual text", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-display-text-"));
  try {
    const file = path.join(directory, "project.json");
    const createService = () => new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
    const service = createService();
    service.setProductPriceDraft("共用手动文字");
    const workspace = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: ids, ruleId: "clean", brief: "", decorations: { frame: { mode: "random" }, framesByMedia: { [ids[0]]: { mode: "manual", frameId: "frame-stars" }, [ids[1]]: { mode: "none" } }, displayText: off, displayTextByMedia: { [ids[0]]: moved, [ids[1]]: off } }, exportFormat: "mp4", exportSettings: DEFAULT_EXPORT_SETTINGS });
    await service.saveProject(file, "文字设置", workspace);
    const reopened = createService();
    await reopened.loadProject(file);
    expect(reopened.currentProject.workspaceDraft?.decorations).toEqual(workspace.decorations);
    expect(reopened.activeTemplate.productPriceDraft).toBe("共用手动文字");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
