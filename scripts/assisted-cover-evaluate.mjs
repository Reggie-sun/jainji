import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("Usage: node scripts/assisted-cover-evaluate.mjs <frozen-manifest.json> [output-directory]");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest.cases) || !manifest.cases.length) throw new Error("Manifest requires a non-empty cases array.");
const outputDirectory = process.argv[3] ?? path.join("/home/reggie/jianji-validation", `assisted-cover-evaluate-${Date.now()}`);
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const digest = async (filePath) => createHash("sha256").update(await readFile(filePath)).digest("hex");
const cases = [], sourceHashes = new Map(), sourceGroups = new Map();
for (const item of manifest.cases) {
  if (!item?.id || !item.sourcePath || !item.sourceSha256 || typeof item.sourceGroup !== "string" || !item.sourceGroup || !["development", "holdout"].includes(item.split)) throw new Error("Each case needs id, sourcePath, sourceSha256, sourceGroup, and split development|holdout.");
  const source = await stat(item.sourcePath);
  const actual = await digest(item.sourcePath); if (actual !== item.sourceSha256) throw new Error(`Frozen source hash mismatch: ${item.id}`);
  if (sourceHashes.has(actual) && sourceHashes.get(actual) !== item.split) throw new Error(`Source hash split leakage: ${item.id}`); sourceHashes.set(actual, item.split);
  if (sourceGroups.has(item.sourceGroup) && sourceGroups.get(item.sourceGroup) !== item.split) throw new Error(`Source group split leakage: ${item.id}`); sourceGroups.set(item.sourceGroup, item.split);
  if ((item.startMs === undefined) !== (item.endMs === undefined) || (item.startMs !== undefined && (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || item.startMs < 0 || item.endMs <= item.startMs || (item.sourceDurationMs !== undefined && item.endMs > item.sourceDurationMs)))) throw new Error(`Invalid segment bounds: ${item.id}`);
  cases.push({ id: item.id, split: item.split, sourceGroup: item.sourceGroup, startMs: item.startMs, endMs: item.endMs, source: { bytes: source.size, sha256: actual }, machineEvidence: item.machineEvidence ?? { status: "not_provided" }, humanDecisions: item.humanDecisions ?? { status: "not_provided" }, baseline: item.baseline, review: item.review });
}
if (new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error("Case ids must be unique.");
if (!cases.some((item) => item.split === "development") || !cases.some((item) => item.split === "holdout")) throw new Error("Promotion evaluation requires both development and holdout cases.");
const completeHumanRecord = (record) => Number.isFinite(record?.humanOperationMs) && record.humanOperationMs >= 0
  && Number.isFinite(record?.waitMs) && record.waitMs >= 0
  && typeof record?.finalQualityAccepted === "boolean" && typeof record?.knownSevereHidden === "boolean"
  && Number.isInteger(record?.requestsUsed) && record.requestsUsed >= 0
  && Number.isInteger(record?.maxRequests) && record.maxRequests >= 0;
const paired = cases.filter((item) => completeHumanRecord(item.baseline) && completeHumanRecord(item.review));
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2; };
const report = {
  generatedAt: new Date().toISOString(), inputManifest: { path: path.resolve(manifestPath), sha256: await digest(manifestPath) },
  cases,
  pairedMetrics: paired.length === cases.length ? { pairedCases: paired.length, medianBaselineHumanMs: median(paired.map((item) => item.baseline.humanOperationMs)), medianReviewHumanMs: median(paired.map((item) => item.review.humanOperationMs)), baselineAccepted: paired.every((item) => item.baseline.finalQualityAccepted), reviewAccepted: paired.every((item) => item.review.finalQualityAccepted), hiddenSevere: paired.some((item) => item.baseline.knownSevereHidden || item.review.knownSevereHidden), budgetRespected: paired.every((item) => item.baseline.requestsUsed <= item.baseline.maxRequests && item.review.requestsUsed <= item.review.maxRequests), gate: paired.every((item) => item.baseline.requestsUsed <= item.baseline.maxRequests && item.review.requestsUsed <= item.review.maxRequests && item.baseline.finalQualityAccepted && item.review.finalQualityAccepted && !item.baseline.knownSevereHidden && !item.review.knownSevereHidden) && median(paired.map((item) => item.review.humanOperationMs)) < median(paired.map((item) => item.baseline.humanOperationMs)) ? "eligible_for_review" : "do_not_promote" } : { status: "insufficient evidence", reason: "every frozen case needs paired without-review and with-review human records including timing, wait, request, budget, quality, and severe-hidden records; no quality or benefit claim is made" },
  privacy: "This script reads only the frozen local manifest and source hashes. It sends no ground truth, media, or evidence to a provider.",
};
const reportPath = path.join(outputDirectory, "assisted-cover-evaluation.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ result: "RECORDED", reportPath, paired: paired.length }, null, 2));
