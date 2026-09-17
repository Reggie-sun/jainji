import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { HarnessRun } from "./run.js";
import { outcomeForProcess, relativeEvidencePath } from "./run.js";
import type { CodeCheckPolicy, HarnessCheckResult, HarnessPolicy } from "./types.js";

const CountSchema = z.number().int().nonnegative();
const VitestReportSchema = z.object({
  numTotalTests: CountSchema,
  numPassedTests: CountSchema,
  numFailedTests: CountSchema,
  numPendingTests: CountSchema,
  numTodoTests: CountSchema,
  numPendingTestSuites: CountSchema.optional(),
  success: z.boolean(),
  testResults: z.array(z.object({
    name: z.string().min(1),
    status: z.string().min(1),
    assertionResults: z.array(z.object({ status: z.string().min(1) }).passthrough()),
  }).passthrough()),
}).passthrough();

function commandEvidence(check: CodeCheckPolicy, args: string[], reportPath?: string): HarnessCheckResult["evidence"] {
  return {
    logStdout: `logs/${check.id}.stdout.log`,
    logStderr: `logs/${check.id}.stderr.log`,
    ...(reportPath ? { structuredReport: `logs/${path.basename(reportPath)}` } : {}),
    configuredArgs: args,
  };
}

function resolvedTestFiles(repoRoot: string, files: readonly string[]): Set<string> {
  return new Set(files.map((file) => path.resolve(repoRoot, file)));
}

async function evaluateVitest(
  check: Extract<CodeCheckPolicy, { kind: "vitest" }>,
  reportPath: string,
  processResult: Awaited<ReturnType<HarnessRun["command"]>>,
  repoRoot: string,
): Promise<Pick<HarnessCheckResult, "status" | "category" | "message" | "evidence">> {
  const processOutcome = outcomeForProcess(processResult);
  if (processResult.timedOut || processResult.interrupted || processResult.error) return processOutcome;
  let report: z.infer<typeof VitestReportSchema>;
  try {
    report = VitestReportSchema.parse(JSON.parse(await readFile(reportPath, "utf8")));
  } catch (error) {
    return {
      status: "NOT_EVALUATED",
      category: error instanceof z.ZodError ? "report_invalid" : "report_missing",
      message: `Vitest did not produce a readable JSON report: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const counts = {
    total: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests + report.numTodoTests,
  };
  const expected = resolvedTestFiles(repoRoot, check.testFiles);
  const discoveredList = report.testResults.map((result) => path.resolve(result.name));
  const discovered = new Set(discoveredList);
  const missing = [...expected].filter((file) => !discovered.has(file)).map((file) => path.relative(repoRoot, file));
  const unexpected = [...discovered].filter((file) => !expected.has(file)).map((file) => path.relative(repoRoot, file));
  const duplicateFiles = discoveredList.filter((file, index) => discoveredList.indexOf(file) !== index).map((file) => path.relative(repoRoot, file));
  const assertions = report.testResults.flatMap((result) => result.assertionResults);
  const assertionCounts = assertions.reduce<Record<string, number>>((result, assertion) => {
    result[assertion.status] = (result[assertion.status] ?? 0) + 1;
    return result;
  }, {});
  const evidence = {
    counts,
    assertionCounts,
    expectedFiles: check.testFiles,
    discoveredFiles: [...discovered].map((file) => path.relative(repoRoot, file)),
    missingFiles: missing,
    unexpectedFiles: unexpected,
    duplicateFiles,
  };
  const hasReportedFailure = processResult.code !== 0 || report.success === false || counts.failed > 0 ||
    Boolean(assertionCounts.failed) || report.testResults.some((result) => result.status === "failed");
  if (hasReportedFailure) {
    return { status: "FAIL", category: "test_failed", message: `Vitest failed (${counts.failed} failed tests).`, evidence };
  }
  if (counts.total === 0 || missing.length > 0) {
    return { status: "NOT_EVALUATED", category: "test_not_discovered", message: "One or more required test files were not executed.", evidence };
  }
  const knownAssertionStatuses = new Set(["passed", "failed", "pending", "skipped", "todo"]);
  const resultStatusesValid = report.testResults.every((result) => ["passed", "failed", "pending", "skipped", "todo"].includes(result.status));
  const nonPassingFiles = report.testResults.filter((result) => result.status !== "passed");
  if (nonPassingFiles.length > 0 && resultStatusesValid) {
    return {
      status: "NOT_EVALUATED",
      category: "test_skipped",
      message: `Required test files include ${nonPassingFiles.length} pending, skipped, or todo results.`,
      evidence,
    };
  }
  const reportConsistent = counts.total === counts.passed + counts.failed + counts.skipped &&
    assertions.length === counts.total &&
    (assertionCounts.passed ?? 0) === counts.passed &&
    (assertionCounts.failed ?? 0) === counts.failed &&
    (assertionCounts.pending ?? 0) + (assertionCounts.skipped ?? 0) + (assertionCounts.todo ?? 0) === counts.skipped &&
    assertions.every((assertion) => knownAssertionStatuses.has(assertion.status)) &&
    report.testResults.every((result) => result.assertionResults.length > 0 && result.status === "passed") && resultStatusesValid &&
    missing.length === 0 && unexpected.length === 0 && duplicateFiles.length === 0;
  if (!reportConsistent) {
    return { status: "NOT_EVALUATED", category: "report_inconsistent", message: "Vitest JSON report counts, files, or assertion statuses are inconsistent.", evidence };
  }
  if (counts.skipped > 0 || (report.numPendingTestSuites ?? 0) > 0) {
    return { status: "NOT_EVALUATED", category: "test_skipped", message: `Required tests include ${counts.skipped} skipped or todo tests.`, evidence };
  }
  return { status: "PASS", message: `${counts.passed} tests passed with no skipped tests.`, evidence };
}

export async function runCodeChecks(policy: HarnessPolicy, run: HarnessRun, signal?: AbortSignal): Promise<HarnessCheckResult[]> {
  const results: HarnessCheckResult[] = [];
  for (const check of policy.codeChecks) {
    const reportPath = check.kind === "vitest" ? path.join(run.logsDirectory, `${check.id}.report.json`) : undefined;
    const args = check.kind === "vitest"
      ? [...check.args, ...check.testFiles, "--reporter=json", `--outputFile=${reportPath}`, "--pool=threads"]
      : [...check.args];
    const processResult = await run.command(check.id, check.command, args, check.timeoutMs, signal);
    const outcome: Pick<HarnessCheckResult, "status" | "category" | "message" | "evidence"> = check.kind === "vitest" && reportPath
      ? await evaluateVitest(check, reportPath, processResult, run.repoRoot)
      : outcomeForProcess(processResult);
    results.push({
      id: check.id,
      required: check.required,
      ...outcome,
      durationMs: processResult.durationMs,
      command: { executable: check.command, args },
      evidence: { ...commandEvidence(check, args, reportPath), ...outcome.evidence },
    });
    if (signal?.aborted) break;
  }
  return results;
}

export function codeSummary(checks: readonly HarnessCheckResult[], run: HarnessRun): string {
  const rows = checks.map((check) => `| ${check.id} | ${check.status} | ${check.message.replaceAll("|", "\\|")} |`).join("\n");
  return `# Code Regression Validation\n\n` +
    `Run: \`${path.basename(run.directory)}\`\n\n` +
    `本结果只覆盖 policy 中固定的核心回归，不代表商业模型、Windows 实机或最终成片视觉验收。\n\n` +
    `| Check | Status | Evidence boundary |\n| --- | --- | --- |\n${rows}\n\n` +
    `Visual review: **NOT_EVALUATED**\n\n` +
    `详细 stdout、stderr 与 Vitest JSON 位于 [logs](${relativeEvidencePath(run, run.logsDirectory)}/)。`;
}
