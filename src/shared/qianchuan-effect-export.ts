import type { QianchuanUploadTaskStatus } from "./douyin-upload.js";
import { joinQianchuanEffects } from "./qianchuan-effect.js";
import { QIANCHUAN_QUERY_METRICS } from "./qianchuan-backend.js";
import { reportCsvCell } from "./qianchuan-report-export.js";
import { QianchuanReportSnapshotSchema, type QianchuanReportSnapshot } from "./qianchuan-report.js";

interface LocalReferences {
  projectIds: Set<string>;
  batchIds: Set<string>;
  exportTaskIds: Set<string>;
  uploadTaskIds: Set<string>;
  fileNames: Set<string>;
}

function safeLocalFileName(value: string): string | undefined {
  if (!value || /[\\/:\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

function sortedJson(values: Set<string>): string {
  return JSON.stringify([...values].sort());
}

/** Export only accepted exact-video matches, collapsing local aliases onto each platform statistic. */
export function exportQianchuanAttributedEffectsCsv(
  input: QianchuanReportSnapshot,
  tasks: QianchuanUploadTaskStatus[],
): string {
  const snapshot = QianchuanReportSnapshotSchema.parse(input);
  if (snapshot.kind !== "materials") throw new Error("千川效果导出只接受完整素材快照。");

  const joins = joinQianchuanEffects(
    tasks.filter(task => task !== null && typeof task === "object" && task.accountProduct === snapshot.product),
    { advertiserId: snapshot.advertiserId, adId: snapshot.adId, rows: snapshot.rows },
  );
  const refsByMaterial = new Map<string, LocalReferences>();
  for (const join of joins) {
    if (join.status !== "matched") continue;
    const fileName = safeLocalFileName(join.task.file_name);
    for (const material of join.materials) {
      let refs = refsByMaterial.get(material.materialId);
      if (!refs) {
        refs = { projectIds: new Set(), batchIds: new Set(), exportTaskIds: new Set(), uploadTaskIds: new Set(), fileNames: new Set() };
        refsByMaterial.set(material.materialId, refs);
      }
      refs.projectIds.add(join.task.project_id);
      refs.batchIds.add(join.task.batch_id);
      refs.exportTaskIds.add(join.task.export_task_id);
      refs.uploadTaskIds.add(join.task.upload_task_id);
      if (fileName) refs.fileNames.add(fileName);
    }
  }

  const header = ["snapshot_id", "source", "advertiser_id", "ad_id", "start_time_beijing", "end_time_beijing", "as_of", "captured_at",
    "material_id", "video_id", "metric_key", "raw_value", "platform_display", "unit", "definition",
    "project_ids_json", "batch_ids_json", "export_task_ids_json", "upload_task_ids_json", "file_names_json"];
  const rows: string[][] = [header];
  for (const material of snapshot.rows) {
    const refs = refsByMaterial.get(material.materialId);
    if (!refs) continue;
    for (const metric of QIANCHUAN_QUERY_METRICS) {
      const provenance = snapshot.metricProvenance[metric];
      rows.push([
        snapshot.id, snapshot.source, snapshot.advertiserId, snapshot.adId, snapshot.startTime, snapshot.endTime, snapshot.asOf, snapshot.capturedAt,
        material.materialId, material.videoId ?? "", metric, material.metrics[metric].value, material.metrics[metric].display,
        provenance.unit, provenance.definition, sortedJson(refs.projectIds), sortedJson(refs.batchIds), sortedJson(refs.exportTaskIds),
        sortedJson(refs.uploadTaskIds), sortedJson(refs.fileNames),
      ]);
    }
  }
  return `\uFEFF${rows.map(row => row.map(reportCsvCell).join(",")).join("\r\n")}\r\n`;
}
