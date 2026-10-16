import { QIANCHUAN_QUERY_METRICS, type QianchuanQueryMetric, type QianchuanQueryMetrics } from "./qianchuan-backend.js";
import type { QianchuanReportSnapshot } from "./qianchuan-report.js";

type MetricDeltas = Record<QianchuanQueryMetric, string | null>;

export type QianguanjiaSnapshotComparison =
  | { kind: "report"; metricDeltas: MetricDeltas }
  | { kind: "materials"; matchedRows: { materialId: string; videoId?: string; name: string; metricDeltas: MetricDeltas }[]; unmatchedLeft: number; unmatchedRight: number };

interface DecimalParts { coefficient: bigint; scale: number }

function decimalParts(value: string): DecimalParts | undefined {
  if (value.length > 127) return undefined;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) return undefined;
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return undefined;
  const fraction = match[3] ?? "";
  const digits = `${match[2]}${fraction}`;
  const magnitude = BigInt(digits);
  return { coefficient: match[1] === "-" ? -magnitude : magnitude, scale: fraction.length - exponent };
}

/** Exact left-minus-right arithmetic for platform decimal text, including scientific notation. */
export function subtractDecimalExact(left: string, right: string): string | null {
  const a = decimalParts(left), b = decimalParts(right);
  if (!a || !b) return null;
  const scale = Math.max(0, a.scale, b.scale);
  const value = a.coefficient * 10n ** BigInt(scale - a.scale) - b.coefficient * 10n ** BigInt(scale - b.scale);
  if (value === 0n) return "0";
  const negative = value < 0n;
  let digits = (negative ? -value : value).toString();
  if (scale) {
    digits = digits.padStart(scale + 1, "0");
    const split = digits.length - scale;
    digits = `${digits.slice(0, split)}.${digits.slice(split)}`.replace(/0+$/, "").replace(/\.$/, "");
  }
  return `${negative ? "-" : ""}${digits}`;
}

export function haveComparableSnapshotScope(left: QianchuanReportSnapshot, right: QianchuanReportSnapshot): boolean {
  if (left.product !== right.product || left.advertiserId !== right.advertiserId || left.kind !== right.kind) return false;
  return left.kind !== "materials" || right.kind === "materials" && left.adId === right.adId;
}

function metricDeltas(left: QianchuanQueryMetrics, right: QianchuanQueryMetrics): MetricDeltas {
  return Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, subtractDecimalExact(left[key].value, right[key].value)])) as MetricDeltas;
}

export function compareQianchuanSnapshots(left: QianchuanReportSnapshot, right: QianchuanReportSnapshot): QianguanjiaSnapshotComparison | null {
  if (!haveComparableSnapshotScope(left, right)) return null;
  if (left.kind === "report" && right.kind === "report") return { kind: "report", metricDeltas: metricDeltas(left.metrics, right.metrics) };
  if (left.kind !== "materials" || right.kind !== "materials") return null;
  const rightById = new Map(right.rows.map(row => [row.materialId, row]));
  const matchedRows = left.rows.flatMap(row => {
    const match = rightById.get(row.materialId);
    return match ? [{ materialId: row.materialId, videoId: row.videoId, name: row.name, metricDeltas: metricDeltas(row.metrics, match.metrics) }] : [];
  });
  return { kind: "materials", matchedRows, unmatchedLeft: left.rows.length - matchedRows.length, unmatchedRight: right.rows.length - matchedRows.length };
}
