import { QIANCHUAN_QUERY_METRICS } from "./qianchuan-backend.js";
import { QianchuanReportSnapshotSchema, type QianchuanReportSnapshot } from "./qianchuan-report.js";

/** RFC 4180 cells; platform text cannot become a spreadsheet formula. */
export function reportCsvCell(value: string): string {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** One material/metric row per snapshot key, independent of local output aliases. */
export function exportQianchuanReportCsv(input: QianchuanReportSnapshot): string {
  const snapshot = QianchuanReportSnapshotSchema.parse(input);
  const header = ["snapshot_id", "source", "advertiser_id", "ad_id", "start_time_beijing", "end_time_beijing", "as_of", "captured_at",
    "material_id", "video_id", "material_name", "metric_key", "raw_value", "platform_display", "raw_unit", "definition"];
  const rows: string[][] = [header];
  const materials = snapshot.kind === "materials" ? snapshot.rows : [{ materialId: "", videoId: "", name: "", metrics: snapshot.metrics }];
  for (const material of materials) for (const metric of QIANCHUAN_QUERY_METRICS) {
    const provenance = snapshot.metricProvenance[metric];
    rows.push([snapshot.id, snapshot.source, snapshot.advertiserId, snapshot.kind === "materials" ? snapshot.adId : "",
      snapshot.startTime, snapshot.endTime, snapshot.asOf, snapshot.capturedAt, material.materialId, material.videoId ?? "", material.name,
      metric, material.metrics[metric].value, material.metrics[metric].display, provenance.unit, provenance.definition]);
  }
  return `\uFEFF${rows.map(row => row.map(reportCsvCell).join(",")).join("\r\n")}\r\n`;
}
