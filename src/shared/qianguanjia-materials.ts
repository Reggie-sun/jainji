import { QianchuanUploadResultSchema, type QianchuanUploadTaskStatus } from "./douyin-upload.js";
import type { QianguanjiaMaterialPage } from "./qianguanjia-analysis.js";

/** Read-only projection. Names and vendor MD5 signatures never establish a local artifact identity. */
export function qianguanjiaMaterialLinks(page: QianguanjiaMaterialPage, tasks: QianchuanUploadTaskStatus[]) {
  const valid = tasks.flatMap(task => {
    const { rowReady: _rowReady, ...record } = task;
    const parsed = QianchuanUploadResultSchema.safeParse(record);
    return parsed.success ? [parsed.data] : [];
  });
  return page.rows.map(row => {
    if (row.advertiserId !== page.advertiserId) throw new Error("素材目录账户不一致。");
    const linked = valid.filter(task => task.advertiserId === row.advertiserId && task.state === "ACCEPTED" &&
      task.upload_outcome === "ACCEPTED" && task.acceptedEvidence?.platformVideoId === row.videoId);
    return { row, uploads: linked, samePlatformVideo: page.rows.filter(item => item.videoId === row.videoId).length,
      conflictingLocalContent: new Set(linked.map(task => task.artifact_sha256)).size > 1 };
  });
}
export function qianguanjiaLocalMaterials(tasks: QianchuanUploadTaskStatus[]) {
  const seen = new Map<string, QianchuanUploadTaskStatus>();
  for (const task of tasks) {
    const previous = seen.get(task.upload_task_id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(task)) throw new Error("上传记录包含冲突身份。");
    seen.set(task.upload_task_id, task);
  }
  const rows = [...seen.values()];
  const validIds = new Set(rows.filter(task => {
    const { rowReady: _rowReady, ...record } = task;
    return QianchuanUploadResultSchema.safeParse(record).success;
  }).map(task => task.upload_task_id));
  const copies = new Map<string, number>();
  for (const task of rows) if (validIds.has(task.upload_task_id)) copies.set(task.artifact_sha256, (copies.get(task.artifact_sha256) ?? 0) + 1);
  return rows.map(task => {
    const valid = validIds.has(task.upload_task_id);
    return { task, valid, accepted: valid && task.state === "ACCEPTED" && task.upload_outcome === "ACCEPTED" && !!task.acceptedEvidence,
      contentCopies: valid ? (copies.get(task.artifact_sha256) ?? 1) - 1 : 0 };
  });
}
