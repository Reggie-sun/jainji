import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { evaluateVitest, vitestCommandArgs } from "./code.js";
import { selectChecks } from "./routing.js";
import { captureScopedIdentity, loadScope } from "./scope.js";
import { sha256, type ProcessResult, type Receipt } from "./run.js";
import { aggregateOutcome, HarnessPolicySchema, type HarnessCheckResult } from "./types.js";

function rejected(message: string, status: "FAIL" | "NOT_EVALUATED" = "FAIL"): HarnessCheckResult[] {
  return [{ id: "completion-evidence", required: true, status, category: "receipt_invalid", message }];
}

async function artifactPath(directory: string, relative: string): Promise<string> {
  if (!relative || relative.includes("\\") || path.isAbsolute(relative) || relative.split("/").some((part) => ["", ".", ".."].includes(part))) {
    throw new Error("Invalid artifact path.");
  }
  const full = path.join(directory, relative);
  const [info, actual, root] = await Promise.all([lstat(full), realpath(full), realpath(directory)]);
  if (!info.isFile() || info.isSymbolicLink() || !actual.startsWith(`${root}${path.sep}`)) throw new Error("Artifact escapes its run.");
  return full;
}

/** Rechecks recorded evidence and current facts; never executes recorded commands. */
export async function verifyReceipt(repoRoot: string, scopePath: string, receiptPath: string,
  options: { governance?: (scope: Awaited<ReturnType<typeof loadScope>>, refs: string[]) => Promise<HarnessCheckResult[]> } = {},
): Promise<HarnessCheckResult[]> {
  let receipt: Receipt;
  try { receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Receipt; }
  catch (error) { return rejected(`Cannot read receipt: ${String(error)}`, "NOT_EVALUATED"); }
  if (receipt.schemaVersion !== 2 || receipt.mode !== "code" || !receipt.finishedAt || receipt.status !== "PASS" ||
    receipt.visualReview !== "NOT_EVALUATED" || !receipt.scoped || !receipt.artifacts || !Array.isArray(receipt.checks)) {
    return rejected("Completion requires a finished PASS scoped code v2 receipt.");
  }
  try {
    const scope = await loadScope(repoRoot, scopePath);
    const policyBytes = await readFile(path.join(repoRoot, ".agent/harness/policy.json"));
    const policy = HarnessPolicySchema.parse(JSON.parse(policyBytes.toString("utf8")));
    const selection = selectChecks(policy, scope);
    const binding = receipt.scoped;
    if (sha256(await readFile(scopePath)) !== binding.scopeFileSha256 || JSON.stringify(scope) !== JSON.stringify(binding.scope) ||
      JSON.stringify(selection.checks.map((check) => check.id)) !== JSON.stringify(binding.selectedCheckIds) ||
      JSON.stringify(selection.documentRefs) !== JSON.stringify(binding.documentRefs) ||
      JSON.stringify(selection.routeIds) !== JSON.stringify(binding.routeIds)) return rejected("Scope or selected policy routes changed.");
    const includeSources = selection.checks.some((check) => !["documents", "owned-aoci"].includes(check.id));
    if (includeSources !== binding.includeSources) return rejected("Source dependency scope is invalid.");
    const current = await captureScopedIdentity(repoRoot, scope, selection.documentRefs, includeSources);
    if (!binding.identityAfter || JSON.stringify(current) !== JSON.stringify(binding.identityBefore) ||
      JSON.stringify(current) !== JSON.stringify(binding.identityAfter)) return rejected("Participating source, policy, contract or owned bytes changed.");
    const directory = path.dirname(path.resolve(receiptPath));
    for (const required of ["policy.json", "scope.json", "summary.md"]) {
      if (!receipt.artifacts[required]) return rejected(`Missing bound artifact: ${required}`);
    }
    for (const [relative, hash] of Object.entries(receipt.artifacts)) {
      if (!/^sha256:[a-f0-9]{64}$/.test(hash) || sha256(await readFile(await artifactPath(directory, relative))) !== hash) {
        return rejected(`Artifact changed: ${relative}`);
      }
    }
    if (receipt.artifacts["policy.json"] !== sha256(policyBytes) ||
      JSON.stringify(JSON.parse(await readFile(await artifactPath(directory, "scope.json"), "utf8"))) !== JSON.stringify(scope)) {
      return rejected("Frozen policy or scope does not match current inputs.");
    }
    const ids = receipt.checks.map((check) => check.id);
    if (new Set(ids).size !== ids.length || aggregateOutcome(receipt.checks) !== "PASS") return rejected("Duplicate or nonpassing checks.");
    for (const selected of selection.checks) {
      const result = receipt.checks.find((check) => check.id === selected.id);
      if (!result || !result.required || result.status !== "PASS") return rejected(`Missing required PASS check: ${selected.id}`);
      if (["documents", "owned-aoci"].includes(selected.id)) continue;
      const expectedReport = `logs/${selected.id}.report.json`;
      const args = selected.kind === "vitest"
        ? vitestCommandArgs(selected, path.join(directory, expectedReport))
        : [...selected.args];
      if (result.command?.executable !== selected.command || JSON.stringify(result.command.args) !== JSON.stringify(args)) {
        return rejected(`Command identity changed: ${selected.id}`);
      }
      for (const relative of [`logs/${selected.id}.stdout.log`, `logs/${selected.id}.stderr.log`, ...(selected.kind === "vitest" ? [expectedReport] : [])]) {
        if (!receipt.artifacts[relative]) return rejected(`Missing report binding: ${relative}`);
      }
      const recorded = result.evidence?.process as Partial<ProcessResult> | undefined;
      if (!recorded || recorded.code !== 0 || recorded.timedOut !== false || recorded.interrupted !== false || recorded.outputTruncated !== false || recorded.error) {
        return rejected(`Process evidence cannot prove success: ${selected.id}`);
      }
      if (selected.kind === "vitest") {
        const processResult = { ...recorded, stdout: "", stderr: "", durationMs: result.durationMs ?? 0 } as ProcessResult;
        const evaluation = await evaluateVitest(selected, await artifactPath(directory, expectedReport), processResult, repoRoot);
        if (evaluation.status !== "PASS") return rejected(`Report cannot prove success: ${selected.id}: ${evaluation.message}`);
      }
    }
    const governance = options.governance ?? (async (ownedScope, refs) => {
      const { checkDocuments, checkOwnedAoci } = await import("./governance.js");
      return [await checkDocuments(repoRoot, ownedScope.ownedChanges.filter((change) => change.change !== "delete" && change.path.endsWith(".md")).map((change) => change.path), refs),
        await checkOwnedAoci(repoRoot, ownedScope.ownedChanges)];
    });
    const controls = await governance(scope, selection.documentRefs);
    if (!controls.some((check) => check.id === "documents" && check.required) || !controls.some((check) => check.id === "owned-aoci" && check.required)) {
      return rejected("Current governance checks are missing.");
    }
    return [...receipt.checks.filter((check) => !["documents", "owned-aoci"].includes(check.id)), ...controls,
      { id: "completion-evidence", required: true, status: "PASS", message: "Finished evidence matches the current scoped bytes; commands were not rerun." }];
  } catch (error) { return rejected(`Evidence unavailable: ${String(error)}`, "NOT_EVALUATED"); }
}
