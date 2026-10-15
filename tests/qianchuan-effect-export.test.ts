import { expect, it } from "vitest";
import { exportQianchuanAttributedEffectsCsv } from "../src/shared/qianchuan-effect-export";
import { QIANCHUAN_QUERY_METRICS, type QianchuanQueryMetrics } from "../src/shared/qianchuan-backend";
import { QIANCHUAN_REPORT_METRIC_PROVENANCE, type QianchuanReportSnapshot } from "../src/shared/qianchuan-report";
import type { QianchuanUploadTaskStatus } from "../src/shared/douyin-upload";

type MaterialsSnapshot = Extract<QianchuanReportSnapshot, { kind: "materials" }>;

const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const hash = (value: number) => value.toString(16).padStart(64, "0");

function metricValues(display = "平台显示"): QianchuanQueryMetrics {
  return Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(metric => [metric, { value: "123.45", display }])) as QianchuanQueryMetrics;
}

function snapshot(rows: MaterialsSnapshot["rows"]): MaterialsSnapshot {
  return {
    version: 1, id: uuid(90), source: "qianchuan-browser", product: "眼贴", advertiserId: "1879999999999999999",
    adId: "1878754135410692", kind: "materials", startTime: "2026-10-15 00:00:00", endTime: "2026-10-15 09:00:00",
    asOf: "2026-10-15T01:00:00Z", capturedAt: "2026-10-15T01:00:05Z", complete: true,
    metricProvenance: QIANCHUAN_REPORT_METRIC_PROVENANCE, total: rows.length, rows,
  };
}

function material(materialId: string, videoId?: string, display = "平台显示"): MaterialsSnapshot["rows"][number] {
  return { materialId, ...(videoId ? { videoId } : {}), name: "platform material", metrics: metricValues(display) };
}

interface TaskOptions {
  id: number;
  videoId?: string;
  advertiserId?: string;
  adId?: string;
  projectId?: string;
  batchId?: string;
  exportId?: string;
  fileName?: string;
  accepted?: boolean;
}

function task(options: TaskOptions): QianchuanUploadTaskStatus {
  const advertiserId = options.advertiserId ?? "1879999999999999999";
  const adId = options.adId ?? "1878754135410692";
  const fileName = options.fileName ?? `source-${options.id}.mp4`;
  const pageOwnership = { targetId: `target_${options.id}`, pageBatchId: uuid(200 + options.id), modalSessionId: uuid(300 + options.id) };
  const identity = {
    project_id: options.projectId ?? uuid(10 + options.id),
    batch_id: options.batchId ?? uuid(30 + options.id),
    export_task_id: options.exportId ?? uuid(50 + options.id),
  };
  return {
    ...identity, upload_task_id: hash(100 + options.id), artifact_sha256: hash(400 + options.id), file_name: fileName,
    accountProduct: "眼贴", advertiserId, adId,
    state: options.accepted === false ? "NEEDS_HUMAN" : "ACCEPTED",
    upload_outcome: options.accepted === false ? "MAY_HAVE_UPLOADED" : "ACCEPTED",
    retryable: false, retry_count: 0, attempt_count: 1, timestamp: "2026-10-15T01:00:00Z",
    ...(options.accepted === false ? {} : { acceptedEvidence: {
      advertiserId, adId, fileName, selectedCount: 1, observedAt: "2026-10-15T01:00:00Z", pageOwnership,
      platformVideoId: options.videoId ?? "video_1", attempt: 1, requestSha256: hash(500 + options.id), responseSha256: hash(600 + options.id),
    } }),
  };
}

function dataRows(csv: string): string[] {
  return csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean).slice(1);
}

it("keeps separate platform materials for one video and merges local aliases per material", () => {
  const report = snapshot([
    material("1875000000000000001", "video_1"),
    material("1875000000000000002", "video_1"),
  ]);
  const aliases = [task({ id: 2, videoId: "video_1" }), task({ id: 1, videoId: "video_1" }), task({ id: 1, videoId: "video_1" })];
  const csv = exportQianchuanAttributedEffectsCsv(report, aliases);
  const lines = dataRows(csv);

  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(lines).toHaveLength(8);
  expect(lines.filter(line => line.includes('"1875000000000000001"'))).toHaveLength(4);
  expect(lines.filter(line => line.includes('"1875000000000000002"'))).toHaveLength(4);
  expect(lines.every(line => line.includes('"[""'))).toBe(true);
  expect(lines.every(line => line.includes(uuid(11)) && line.includes(uuid(12)))).toBe(true);
  expect(csv).toContain(`"[""${uuid(11)}"",""${uuid(12)}""]"`);
  expect(csv).toContain(`"[""${hash(101)}"",""${hash(102)}""]"`);
  expect(lines.every(line => line.includes("123.45") && line.includes('"unknown"') && line.includes('"platform-reported"'))).toBe(true);
  expect(csv).toContain('"qianchuan-browser"');
  expect(csv).toContain('"1879999999999999999"');
  expect(csv).toContain('"1878754135410692"');
});

it("exports only accepted exact-video matches for the report account and ad", () => {
  const report = snapshot([
    material("1875000000000000001", "video_1"),
    material("1875000000000000002"),
    material("1875000000000000003", "video_3"),
  ]);
  const tasks = [
    task({ id: 1, videoId: "video_1" }),
    task({ id: 2, videoId: "video_1", advertiserId: "1879999999999999998" }),
    task({ id: 3, videoId: "video_1", adId: "1878754135410693" }),
    task({ id: 4, videoId: "video_3", accepted: false }),
    task({ id: 5, videoId: "not_observed" }),
  ];
  const csv = exportQianchuanAttributedEffectsCsv(report, tasks);
  const lines = dataRows(csv);

  expect(lines).toHaveLength(4);
  expect(lines.every(line => line.includes('"1875000000000000001"'))).toBe(true);
  expect(lines.join("\n")).not.toContain("1875000000000000002");
  expect(lines.join("\n")).not.toContain("1875000000000000003");
  expect(lines.join("\n")).not.toContain(hash(102));
  expect(lines.join("\n")).not.toContain(hash(103));
  expect(lines.join("\n")).not.toContain(hash(104));
  expect(lines.join("\n")).not.toContain(hash(105));
});

it("uses only the supplied batch-filtered task aliases and does not export unmatched tasks", () => {
  const report = snapshot([material("1875000000000000001", "video_1")]);
  const selectedBatch = uuid(31);
  const selected = task({ id: 1, videoId: "video_1", batchId: selectedBatch });
  const otherBatch = task({ id: 2, videoId: "video_elsewhere", batchId: uuid(32) });
  const csv = exportQianchuanAttributedEffectsCsv(report, [selected]);
  const lines = dataRows(csv);

  expect(lines).toHaveLength(4);
  expect(lines.every(line => line.includes(selectedBatch))).toBe(true);
  expect(csv).not.toContain(uuid(32));
  expect(csv).not.toContain(otherBatch.upload_task_id);
});

it("strictly rejects non-material or credential-bearing snapshots and neutralizes formula cells", () => {
  const formulaSnapshot = snapshot([material("1875000000000000001", "video_1", "=1+1")]);
  const csv = exportQianchuanAttributedEffectsCsv(formulaSnapshot, [
    task({ id: 1, videoId: "video_1", fileName: "=local-name.mp4" }),
    task({ id: 2, videoId: "video_1", fileName: "/home/reggie/movie.mp4" }),
  ]);
  expect(csv).toContain("'=1+1");
  expect(csv).toContain('"[""=local-name.mp4""]"');
  expect(csv).not.toContain("/home/");
  expect(csv).not.toContain("cookie");
  expect(csv).not.toContain("token");
  expect(() => exportQianchuanAttributedEffectsCsv({ ...formulaSnapshot, kind: "report" } as any, [])).toThrow();
  expect(() => exportQianchuanAttributedEffectsCsv({ ...formulaSnapshot, cookie: "secret" } as any, [])).toThrow();
  expect(() => exportQianchuanAttributedEffectsCsv(formulaSnapshot, [{ ...task({ id: 2, videoId: "video_1" }), cookie: "secret" } as any])).not.toThrow();
  expect(exportQianchuanAttributedEffectsCsv(formulaSnapshot, [{ ...task({ id: 2, videoId: "video_1" }), cookie: "secret" } as any])).not.toContain("secret");
});
