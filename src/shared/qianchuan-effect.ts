import { QianchuanUploadResultSchema, type QianchuanUploadTaskStatus } from "./douyin-upload.js";
import type { QianchuanQueryMetrics } from "./qianchuan-backend.js";

export interface QianchuanEffectMaterial {
  materialId: string;
  videoId?: string;
  name: string;
  metrics: QianchuanQueryMetrics;
}

export type QianchuanEffectStatus = "matched" | "not-observed" | "not-accepted" | "invalid-evidence";

export interface QianchuanEffectJoin {
  task: QianchuanUploadTaskStatus;
  status: QianchuanEffectStatus;
  materials: QianchuanEffectMaterial[];
}

export interface QianchuanEffectSnapshot {
  advertiserId: string;
  adId: string;
  rows: QianchuanEffectMaterial[];
}

const accountId = /^[1-9][0-9]{0,19}$/;
const videoId = /^[a-zA-Z0-9_-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validSnapshot(value: QianchuanEffectSnapshot): boolean {
  if (!accountId.test(value.advertiserId) || !accountId.test(value.adId) || !Array.isArray(value.rows)) return false;
  const materialIds = new Set<string>();
  for (const row of value.rows as unknown[]) {
    if (!isRecord(row) || typeof row.materialId !== "string" || !accountId.test(row.materialId) ||
      row.videoId !== undefined && (typeof row.videoId !== "string" || !videoId.test(row.videoId)) ||
      materialIds.has(row.materialId)) return false;
    materialIds.add(row.materialId);
  }
  return true;
}

function validateTask(task: QianchuanUploadTaskStatus) {
  if (!isRecord(task)) return undefined;
  try {
    const { rowReady: _rowReady, ...persistedResult } = task;
    return QianchuanUploadResultSchema.safeParse(persistedResult);
  } catch {
    return undefined;
  }
}

/** Joins only accepted uploads to rows with the exact same platform video ID. */
export function joinQianchuanEffects(
  tasks: QianchuanUploadTaskStatus[],
  snapshot: QianchuanEffectSnapshot,
): QianchuanEffectJoin[] {
  const selected = tasks.filter(task => isRecord(task) &&
    task.advertiserId === snapshot.advertiserId && task.adId === snapshot.adId);
  if (!validSnapshot(snapshot)) throw new Error("千川素材快照无效，已拒绝本次效果查询。");
  const rowsByVideoId = new Map<string, QianchuanEffectMaterial[]>();
  for (const row of snapshot.rows) {
    if (!row.videoId) continue;
    const rows = rowsByVideoId.get(row.videoId) ?? [];
    rows.push(row);
    rowsByVideoId.set(row.videoId, rows);
  }

  return selected.map(task => {
    const parsed = validateTask(task);
    if (!parsed?.success) return { task, status: "invalid-evidence", materials: [] };
    const result = parsed.data;
    if (result.state !== "ACCEPTED" || result.upload_outcome !== "ACCEPTED" || !result.acceptedEvidence) {
      return { task, status: "not-accepted", materials: [] };
    }
    const materials = rowsByVideoId.get(result.acceptedEvidence.platformVideoId) ?? [];
    return materials.length
      ? { task, status: "matched", materials }
      : { task, status: "not-observed", materials: [] };
  });
}
