import { z } from "zod";
import { DecorationSchema, ProductionDecorationSchema, RequiredProductPriceSchema } from "./decorations.js";
import { ExportFormatSchema } from "./export-format.js";
import { ExportSettingsSchema } from "./export-settings.js";
import type { SourceKnowledgeProgress } from "./source-sticker-knowledge.js";
import type { CoverDiagnosticState } from "./cover-diagnostics.js";

export const RULE_TEMPLATES = [
  { id: "black-gold", name: "黑金精选", label: "质感好物", description: "暖金滤镜配星芒贴纸，适合产品展示与直播切片。", minIntensity: 0.35, maxIntensity: 0.55, filters: ["warm"], filterLabel: "暖金", sticker: "sparkle", stickerLabel: "金色星芒", stickerWidth: 0.08, stickerRotation: 8, stickerCorners: ["bottom-right", "bottom-left", "top-right", "top-left"] },
  { id: "clean", name: "清爽日常", label: "生活记录", description: "清透色彩配轻箭头贴纸，让日常画面保持自然呼吸感。", minIntensity: 0.25, maxIntensity: 0.4, filters: ["cool", "vivid"], filterLabel: "清透", sticker: "arrow", stickerLabel: "青色箭头", stickerWidth: 0.07, stickerRotation: -6, stickerCorners: ["bottom-left", "bottom-right", "top-left", "top-right"] },
  { id: "mono", name: "黑白叙事", label: "情绪片段", description: "完整黑白滤镜配小型闪光贴纸，突出人物与情绪。", minIntensity: 1, maxIntensity: 1, filters: ["mono"], filterLabel: "黑白", sticker: "sparkle", stickerLabel: "白色闪光", stickerWidth: 0.07, stickerRotation: -8, stickerCorners: ["top-right", "bottom-right", "top-left", "bottom-left"] },
  { id: "coral-pop", name: "珊瑚热卖", label: "促销种草", description: "鲜明滤镜配爱心贴纸，活泼但不遮挡商品主体。", minIntensity: 0.45, maxIntensity: 0.68, filters: ["vivid", "warm"], filterLabel: "鲜明", sticker: "heart", stickerLabel: "珊瑚爱心", stickerWidth: 0.08, stickerRotation: 7, stickerCorners: ["bottom-right", "top-right", "bottom-left", "top-left"] },
  { id: "mint-fresh", name: "薄荷上新", label: "清新开箱", description: "冷调滤镜配方向箭头，适合开箱、展示与步骤感画面。", minIntensity: 0.3, maxIntensity: 0.48, filters: ["cool"], filterLabel: "冷调", sticker: "arrow", stickerLabel: "薄荷箭头", stickerWidth: 0.08, stickerRotation: 6, stickerCorners: ["top-right", "bottom-right", "top-left", "bottom-left"] },
  { id: "sunset", name: "落日暖片", label: "温柔生活", description: "柔暖滤镜配小爱心，适合手作、美食与生活记录。", minIntensity: 0.38, maxIntensity: 0.58, filters: ["warm"], filterLabel: "柔暖", sticker: "heart", stickerLabel: "奶油爱心", stickerWidth: 0.07, stickerRotation: -7, stickerCorners: ["bottom-left", "top-left", "bottom-right", "top-right"] },
  { id: "electric", name: "电光焦点", label: "潮流节奏", description: "高饱和滤镜配爆闪贴纸，为运动与快节奏素材提气。", minIntensity: 0.55, maxIntensity: 0.75, filters: ["vivid"], filterLabel: "高饱和", sticker: "burst", stickerLabel: "电光爆闪", stickerWidth: 0.08, stickerRotation: 10, stickerCorners: ["top-left", "bottom-left", "top-right", "bottom-right"] },
  { id: "cream-studio", name: "奶油画报", label: "轻奢陈列", description: "轻暖色彩配小型爆闪，适合美妆、饰品与静物陈列。", minIntensity: 0.28, maxIntensity: 0.45, filters: ["warm", "vivid"], filterLabel: "奶油暖", sticker: "burst", stickerLabel: "香槟爆闪", stickerWidth: 0.07, stickerRotation: -10, stickerCorners: ["bottom-right", "bottom-left", "top-right", "top-left"] },
  { id: "rose-soft", name: "玫瑰柔光", label: "细腻好物", description: "轻暖滤镜与小爱心，适合花艺、美妆和柔和陈列。", minIntensity: 0.2, maxIntensity: 0.35, filters: ["warm"], filterLabel: "轻暖", sticker: "heart", stickerLabel: "柔光爱心", stickerWidth: 0.06, stickerRotation: -4, stickerCorners: ["top-left", "bottom-right", "top-right", "bottom-left"] },
  { id: "ocean-blue", name: "海盐蓝调", label: "清凉展示", description: "清凉蓝调搭配小星芒，适合夏日饮品与清爽产品。", minIntensity: 0.45, maxIntensity: 0.65, filters: ["cool"], filterLabel: "海盐冷调", sticker: "sparkle", stickerLabel: "清凉星芒", stickerWidth: 0.07, stickerRotation: 5, stickerCorners: ["bottom-left", "top-right", "bottom-right", "top-left"] },
  { id: "candy-pop", name: "糖果派对", label: "缤纷开箱", description: "浓郁鲜明色彩搭配爆闪，适合彩色小物与活力开箱。", minIntensity: 0.7, maxIntensity: 0.85, filters: ["vivid"], filterLabel: "糖果鲜彩", sticker: "burst", stickerLabel: "活力爆闪", stickerWidth: 0.08, stickerRotation: -12, stickerCorners: ["top-right", "bottom-left", "top-left", "bottom-right"] },
  { id: "retro-amber", name: "琥珀复古", label: "暖意手作", description: "浓暖滤镜搭配小箭头，适合烘焙、木作与复古物件。", minIntensity: 0.6, maxIntensity: 0.78, filters: ["warm"], filterLabel: "琥珀暖调", sticker: "arrow", stickerLabel: "复古箭头", stickerWidth: 0.07, stickerRotation: 4, stickerCorners: ["bottom-right", "top-left", "bottom-left", "top-right"] },
] as const;

export type RuleTemplate = typeof RULE_TEMPLATES[number];
export const RuleIdSchema = z.enum(RULE_TEMPLATES.map((rule) => rule.id) as [RuleTemplate["id"], ...RuleTemplate["id"][]]);
export type RuleId = z.infer<typeof RuleIdSchema>;
export type StickerId = RuleTemplate["sticker"];

export const ReasoningEffortSchema = z.string().trim().min(1).max(64);
export const ConnectionInputSchema = z.object({
  baseUrl: z.string().trim().url().max(2048).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  }, "请使用 HTTPS API 地址；本机服务允许 HTTP。"),
  model: z.string().trim().min(1).max(200),
  reasoningEffort: ReasoningEffortSchema.optional(),
  apiKey: z.string().trim().min(1).max(4096).refine((value) => !/[\r\n]/.test(value)),
  protocol: z.enum(["chat-completions", "responses", "anthropic"]).optional(),
  authHeader: z.enum(["bearer", "x-api-key"]).optional(),
}).strict();
export type ConnectionInput = z.infer<typeof ConnectionInputSchema>;
export interface ConnectionStatus { configured: boolean; baseUrl: string; model: string; reasoningEffort?: string; source?: "api" | "chatgpt"; providerName?: string; protocol?: string; }
export interface ChatGPTModel { model: string; displayName: string; supportedReasoningEfforts: { reasoningEffort: string; description: string }[]; defaultReasoningEffort?: string; }
export interface ChatGPTStatus { status: "signed-out" | "starting" | "logging-in" | "ready" | "error"; email?: string; plan?: string; model?: string; reasoningEffort?: string; models?: ChatGPTModel[]; message?: string; }

export const MAX_AGENT_OUTPUTS = 250;
export const ProductionMultiplierSchema = z.number().int().min(1).max(MAX_AGENT_OUTPUTS);
export const AppendProductionSchema = z.object({
  batchId: z.string().uuid(),
  count: z.number().int().min(1).max(MAX_AGENT_OUTPUTS),
  productPrice: RequiredProductPriceSchema,
  outputDirectory: z.string().min(1),
}).strict();
export type AppendProductionInput = z.infer<typeof AppendProductionSchema>;

export function calculateProductionQuantity(sourceCount: number, requestedCount: number): { multiplier: number; total: number } | undefined {
  if (!Number.isInteger(sourceCount) || sourceCount < 1 || !Number.isInteger(requestedCount) || requestedCount < 1) return undefined;
  const multiplier = Math.ceil(requestedCount / sourceCount);
  return { multiplier, total: sourceCount * multiplier };
}

const createAgentStartSchema = (decorations: z.ZodType<z.infer<typeof DecorationSchema>, z.ZodTypeDef, unknown>) => z.object({
  sourceStickerRefresh: z.object({ projectId: z.string().uuid(), mediaIds: z.array(z.string().uuid()).min(1).max(MAX_AGENT_OUTPUTS) }).strict().optional(),
  multiplier: ProductionMultiplierSchema.optional(),
  exportFormat: ExportFormatSchema.optional(),
  exportSettings: ExportSettingsSchema.optional(),
  decorations: decorations.optional(),
  ruleId: RuleIdSchema,
  mediaIds: z.array(z.string().uuid()).min(1).max(MAX_AGENT_OUTPUTS),
  outputDirectory: z.string().min(1),
  brief: z.string().trim().max(1000),
}).strict().refine(input => !input.sourceStickerRefresh || (new Set(input.sourceStickerRefresh.mediaIds).size === input.sourceStickerRefresh.mediaIds.length && input.sourceStickerRefresh.mediaIds.every(id => input.mediaIds.includes(id))), {
  path: ["sourceStickerRefresh"], message: "重新检查的素材必须属于本次制作，且不能重复。",
}).refine((input) => RequiredProductPriceSchema.safeParse(input.decorations?.productPrice).success, {
  path: ["decorations", "productPrice"], message: "请手动填写产品价格，Agent 不能代填或改写。",
});
export const AgentStartSchema = createAgentStartSchema(ProductionDecorationSchema);
export const FrozenAgentStartSchema = createAgentStartSchema(DecorationSchema);
export type AgentStartInput = z.infer<typeof AgentStartSchema>;

export const GenerateBriefSchema = z.object({
  ruleId: RuleIdSchema,
  decorations: ProductionDecorationSchema.optional(),
  brief: z.string().trim().max(1000).default(""),
}).strict();
export type GenerateBriefInput = z.infer<typeof GenerateBriefSchema>;

export interface AgentItem {
  id: string;
  version: number;
  mediaId: string;
  name: string;
  status: "waiting" | "analyzing" | "prepared" | "exporting" | "failed" | "cancelled";
  summary?: string;
  error?: string;
  taskId?: string;
  previewUrl?: string;
  sourceKnowledge?: SourceKnowledgeProgress;
  coverDiagnostics?: CoverDiagnosticState;
}
export interface AgentRun {
  id: string;
  projectId: string;
  ruleId: RuleId;
  status: "running" | "finished" | "cancelled";
  items: AgentItem[];
}

export function getRule(id: RuleId): RuleTemplate { return RULE_TEMPLATES.find((rule) => rule.id === id)!; }
