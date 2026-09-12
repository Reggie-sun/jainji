import { z } from "zod";

export const RULE_TEMPLATES = [
  { id: "black-gold", name: "黑金精选", label: "质感好物", description: "克制的暖色与精致角标，让产品成为主角。", maxBadges: 2, maxFontSize: 0.032, minIntensity: 0, maxIntensity: 0.4, filters: ["none", "warm"] },
  { id: "clean", name: "清爽日常", label: "生活记录", description: "轻盈排版与自然色彩，保留画面里的真实感。", maxBadges: 2, maxFontSize: 0.03, minIntensity: 0, maxIntensity: 0.3, filters: ["none", "vivid", "cool"] },
  { id: "mono", name: "黑白叙事", label: "情绪片段", description: "一句短文案，给日常片段一点电影感。", maxBadges: 1, maxFontSize: 0.032, minIntensity: 1, maxIntensity: 1, filters: ["mono"] },
] as const;

export type RuleTemplate = typeof RULE_TEMPLATES[number];
export const RuleIdSchema = z.enum(["black-gold", "clean", "mono"]);
export type RuleId = z.infer<typeof RuleIdSchema>;

export const ConnectionInputSchema = z.object({
  baseUrl: z.string().trim().url().max(2048).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  }, "请使用 HTTPS API 地址；本机服务允许 HTTP。"),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().min(1).max(4096).refine((value) => !/[\r\n]/.test(value)),
}).strict();
export type ConnectionInput = z.infer<typeof ConnectionInputSchema>;
export interface ConnectionStatus { configured: boolean; baseUrl: string; model: string; }

export const AgentStartSchema = z.object({
  ruleId: RuleIdSchema,
  mediaIds: z.array(z.string().uuid()).min(1).max(100),
  outputDirectory: z.string().min(1),
  brief: z.string().trim().max(1000),
}).strict();
export type AgentStartInput = z.infer<typeof AgentStartSchema>;

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
