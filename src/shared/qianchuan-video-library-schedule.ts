import { z } from "zod";
import { QianchuanLibraryAccountSchema, type QianchuanLibraryResult } from "./qianchuan-video-library.js";

export const QianchuanLibraryScheduleSettingsSchema = z.object({
  confirmation: z.literal("DELETE_ALL_VIDEOS"),
  enabled: z.boolean(),
  includePlanMaterials: z.boolean().optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "请选择有效的每日清空时间。"),
  accounts: z.array(QianchuanLibraryAccountSchema).max(6),
}).strict().refine(value => (!value.enabled || value.accounts.length > 0) &&
  (!value.includePlanMaterials || value.accounts.every(account => account.expectedAdId)) &&
  new Set(value.accounts.map(account => account.product)).size === value.accounts.length &&
  new Set(value.accounts.map(account => account.expectedAdvertiserId)).size === value.accounts.length,
"启用定时清空需要选择唯一、已配置的账号。");
export type QianchuanLibraryScheduleSettings = z.infer<typeof QianchuanLibraryScheduleSettingsSchema>;
export interface QianchuanLibraryScheduleRun {
  day: string;
  startedAt: string;
  finishedAt?: string;
  state: "RUNNING" | "COMPLETED" | "BLOCKED" | "SKIPPED";
  message: string;
  results: QianchuanLibraryResult[];
}
export interface QianchuanLibraryScheduleStatus {
  settings: QianchuanLibraryScheduleSettings;
  timeZone: string;
  nextRunAt?: string;
  lastRun?: QianchuanLibraryScheduleRun;
  error?: string;
  automaticLaunch?: QianchuanAutomaticLaunchStatus;
}
export interface QianchuanAutomaticLaunchStatus { supported: boolean; enabled: boolean; message: string }
