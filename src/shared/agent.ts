import { z } from "zod";
import { DecorationSchema } from "./decorations.js";
import { ExportFormatSchema } from "./export-format.js";

export const RULE_TEMPLATES = [
  { id: "black-gold", name: "黑金精选", label: "质感好物", description: "暖金滤镜配星芒贴纸，适合产品展示与直播切片。", maxBadges: 2, maxFontSize: 0.032, minIntensity: 0.35, maxIntensity: 0.55, filters: ["warm"], filterLabel: "暖金", sticker: "sparkle", stickerLabel: "金色星芒", previewCaption: "精选 · 有质感", textColor: [247, 220, 160], backgroundColor: [0, 0, 0, 0.64], stickerWidth: 0.12, stickerRotation: 8, stickerCorners: ["bottom-right", "bottom-left", "top-right", "top-left"] },
  { id: "clean", name: "清爽日常", label: "生活记录", description: "清透色彩配轻箭头贴纸，让日常画面保持自然呼吸感。", maxBadges: 2, maxFontSize: 0.03, minIntensity: 0.25, maxIntensity: 0.4, filters: ["cool", "vivid"], filterLabel: "清透", sticker: "arrow", stickerLabel: "青色箭头", previewCaption: "把日常过成喜欢", textColor: [30, 40, 44], backgroundColor: [255, 255, 255, 0.84], stickerWidth: 0.11, stickerRotation: -6, stickerCorners: ["bottom-left", "bottom-right", "top-left", "top-right"] },
  { id: "mono", name: "黑白叙事", label: "情绪片段", description: "完整黑白滤镜配小型闪光贴纸，突出人物与情绪。", maxBadges: 1, maxFontSize: 0.032, minIntensity: 1, maxIntensity: 1, filters: ["mono"], filterLabel: "黑白", sticker: "sparkle", stickerLabel: "白色闪光", previewCaption: "留住这一刻", textColor: [255, 255, 255], backgroundColor: [0, 0, 0, 0.66], stickerWidth: 0.1, stickerRotation: -8, stickerCorners: ["top-right", "bottom-right", "top-left", "bottom-left"] },
  { id: "coral-pop", name: "珊瑚热卖", label: "促销种草", description: "鲜明滤镜配爱心贴纸，活泼但不遮挡商品主体。", maxBadges: 2, maxFontSize: 0.031, minIntensity: 0.45, maxIntensity: 0.68, filters: ["vivid", "warm"], filterLabel: "鲜明", sticker: "heart", stickerLabel: "珊瑚爱心", previewCaption: "今天也要心动", textColor: [255, 255, 255], backgroundColor: [220, 73, 87, 0.82], stickerWidth: 0.12, stickerRotation: 7, stickerCorners: ["bottom-right", "top-right", "bottom-left", "top-left"] },
  { id: "mint-fresh", name: "薄荷上新", label: "清新开箱", description: "冷调滤镜配方向箭头，适合开箱、展示与步骤感画面。", maxBadges: 2, maxFontSize: 0.03, minIntensity: 0.3, maxIntensity: 0.48, filters: ["cool"], filterLabel: "冷调", sticker: "arrow", stickerLabel: "薄荷箭头", previewCaption: "新鲜感正在发生", textColor: [17, 70, 68], backgroundColor: [221, 248, 239, 0.86], stickerWidth: 0.12, stickerRotation: 6, stickerCorners: ["top-right", "bottom-right", "top-left", "bottom-left"] },
  { id: "sunset", name: "落日暖片", label: "温柔生活", description: "柔暖滤镜配小爱心，适合手作、美食与生活记录。", maxBadges: 2, maxFontSize: 0.03, minIntensity: 0.38, maxIntensity: 0.58, filters: ["warm"], filterLabel: "柔暖", sticker: "heart", stickerLabel: "奶油爱心", previewCaption: "慢一点，也很好", textColor: [255, 245, 225], backgroundColor: [102, 55, 43, 0.7], stickerWidth: 0.11, stickerRotation: -7, stickerCorners: ["bottom-left", "top-left", "bottom-right", "top-right"] },
  { id: "electric", name: "电光焦点", label: "潮流节奏", description: "高饱和滤镜配爆闪贴纸，为运动与快节奏素材提气。", maxBadges: 2, maxFontSize: 0.031, minIntensity: 0.55, maxIntensity: 0.75, filters: ["vivid"], filterLabel: "高饱和", sticker: "burst", stickerLabel: "电光爆闪", previewCaption: "现在，就是焦点", textColor: [123, 255, 235], backgroundColor: [18, 24, 54, 0.78], stickerWidth: 0.13, stickerRotation: 10, stickerCorners: ["top-left", "bottom-left", "top-right", "bottom-right"] },
  { id: "cream-studio", name: "奶油画报", label: "轻奢陈列", description: "轻暖色彩配小型爆闪，适合美妆、饰品与静物陈列。", maxBadges: 2, maxFontSize: 0.03, minIntensity: 0.28, maxIntensity: 0.45, filters: ["warm", "vivid"], filterLabel: "奶油暖", sticker: "burst", stickerLabel: "香槟爆闪", previewCaption: "今日灵感陈列", textColor: [74, 55, 45], backgroundColor: [255, 246, 225, 0.86], stickerWidth: 0.1, stickerRotation: -10, stickerCorners: ["bottom-right", "bottom-left", "top-right", "top-left"] },
] as const;

export type RuleTemplate = typeof RULE_TEMPLATES[number];
export const RuleIdSchema = z.enum(["black-gold", "clean", "mono", "coral-pop", "mint-fresh", "sunset", "electric", "cream-studio"]);
export type RuleId = z.infer<typeof RuleIdSchema>;
export type StickerId = RuleTemplate["sticker"];

export const ConnectionInputSchema = z.object({
  baseUrl: z.string().trim().url().max(2048).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  }, "请使用 HTTPS API 地址；本机服务允许 HTTP。"),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().min(1).max(4096).refine((value) => !/[\r\n]/.test(value)),
  protocol: z.enum(["chat-completions", "responses", "anthropic"]).optional(),
  authHeader: z.enum(["bearer", "x-api-key"]).optional(),
}).strict();
export type ConnectionInput = z.infer<typeof ConnectionInputSchema>;
export interface ConnectionStatus { configured: boolean; baseUrl: string; model: string; source?: "api" | "chatgpt"; providerName?: string; protocol?: string; }
export interface ChatGPTModel { model: string; displayName: string; }
export interface ChatGPTStatus { status: "signed-out" | "starting" | "logging-in" | "ready" | "error"; email?: string; plan?: string; model?: string; models?: ChatGPTModel[]; message?: string; }

export const AgentStartSchema = z.object({
  exportFormat: ExportFormatSchema.optional(),
  decorations: DecorationSchema.optional(),
  ruleId: RuleIdSchema,
  mediaIds: z.array(z.string().uuid()).min(1).max(100),
  outputDirectory: z.string().min(1),
  brief: z.string().trim().max(1000),
}).strict();
export type AgentStartInput = z.infer<typeof AgentStartSchema>;

export const GenerateBriefSchema = z.object({
  ruleId: RuleIdSchema,
  decorations: DecorationSchema.optional(),
  brief: z.string().trim().max(1000).default(""),
}).strict();
export type GenerateBriefInput = z.infer<typeof GenerateBriefSchema>;

export interface AgentItem {
  mediaId: string;
  name: string;
  status: "waiting" | "analyzing" | "exporting" | "failed" | "cancelled";
  summary?: string;
  error?: string;
  taskId?: string;
}
export interface AgentRun {
  id: string;
  projectId: string;
  ruleId: RuleId;
  status: "running" | "finished" | "cancelled";
  items: AgentItem[];
}

export function getRule(id: RuleId): RuleTemplate { return RULE_TEMPLATES.find((rule) => rule.id === id)!; }
