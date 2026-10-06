import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { verifyReceipt } from "../src/harness/completion.js";
import { HarnessRun, sha256 } from "../src/harness/run.js";
import { runCodeChecks } from "../src/harness/code.js";
import { selectChecks } from "../src/harness/routing.js";
import { HarnessPolicySchema, aggregateOutcome, type HarnessTaskScope } from "../src/harness/types.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it.each([1, 2])("rejects incomplete or legacy receipts without changing them (v%s)", async (schemaVersion) => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-completion-")); roots.push(root);
  const receipt = path.join(root, "receipt.json");
  const bytes = JSON.stringify({ schemaVersion, mode: "code", status: schemaVersion === 1 ? "PASS" : "RUNNING", checks: [] });
  await writeFile(receipt, bytes);
  const checks = await verifyReceipt(root, "missing-scope.json", receipt);
  expect(checks.some((check) => check.status !== "PASS")).toBe(true);
  expect(await readFile(receipt, "utf8")).toBe(bytes);
});

it("treats missing receipts as absent evidence, not PASS", async () => {
  const checks = await verifyReceipt(process.cwd(), "missing-scope.json", "missing-receipt.json");
  expect(checks).toEqual(expect.arrayContaining([expect.objectContaining({ status: "NOT_EVALUATED" })]));
});

async function fixture(vitest = false) {
  const root = await mkdtemp(path.join(tmpdir(), "harness-completion-bound-")); roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  await mkdir(path.join(root, ".agent/harness"), { recursive: true });
  await mkdir(path.join(root, "docs"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/participating.ts"), "export const value = 1;\n");
  const media = JSON.parse(await readFile(path.join(process.cwd(), ".agent/harness/policy.json"), "utf8")).media;
  const policy = HarnessPolicySchema.parse({ schemaVersion: 2, media,
    codeChecks: vitest ? [{ id: "fixture", kind: "vitest", command: "node", required: true, timeoutMs: 5000,
      testFiles: ["tests/one.test.ts", "tests/two.test.ts"], args: ["-e", `const fs=require('node:fs');const path=require('node:path');const out=process.argv.find(v=>v.startsWith('--outputFile=')).slice(13);fs.writeFileSync(out,JSON.stringify({numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,testResults:[{name:path.resolve('tests/one.test.ts'),status:'passed',assertionResults:[{status:'passed'}]}]}));`] }]
      : [{ id: "fixture", kind: "command", command: "node", args: ["-e", "console.log('checked')"], required: true, timeoutMs: 5000 }],
    controlChecks: [], routes: [{ id: "docs", paths: ["docs/**"], checkIds: ["fixture"],
      ...(vitest ? { testFilesByCheck: { fixture: ["tests/one.test.ts"] } } : {}), documentRefs: ["docs/contract.md"] }],
  });
  const policyPath = path.join(root, ".agent/harness/policy.json");
  await writeFile(policyPath, JSON.stringify(policy));
  git("init"); git("add", ".agent/harness/policy.json", "src/participating.ts");
  git("-c", "user.name=Harness Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "base");
  const bytes = "# Contract\n\nOwned documentation.\n";
  await writeFile(path.join(root, "docs/contract.md"), bytes);
  const scope: HarnessTaskScope = { schemaVersion: "harness-task-scope/v1", sessionId: "fixture", baseCommit: git("rev-parse", "HEAD"),
    ownedChanges: [{ path: "docs/contract.md", change: "add", beforeSha256: null, afterSha256: sha256(bytes) }] };
  const scopePath = path.join(root, ".agent/harness/scope.json");
  await writeFile(scopePath, JSON.stringify(scope));
  const run = await HarnessRun.create(root, "code", policyPath);
  await run.configureScoped(scope, scopePath, selectChecks(policy, scope));
  const checks = await runCodeChecks(policy, run, undefined, selectChecks(policy, scope).checks);
  expect(await run.finish(checks, "fixture evidence")).toBe("PASS");
  const governance = vi.fn(async () => [
    { id: "documents", required: true, status: "PASS" as const, message: "fixture links checked" },
    { id: "owned-aoci", required: true, status: "PASS" as const, message: "fixture official evidence" },
  ]);
  return { root, run, scopePath, governance };
}

it("recomputes a fixed Vitest subset for completion and rejects a widened recorded command", async () => {
  const { run, root, scopePath, governance } = await fixture(true);
  expect(aggregateOutcome(await verifyReceipt(root, scopePath, run.receiptPath, { governance }))).toBe("PASS");
  const receipt = JSON.parse(await readFile(run.receiptPath, "utf8"));
  expect(receipt.checks[0].command.args).toContain("--reporter=default");
  expect(receipt.checks[0].command.args).not.toContain("tests/two.test.ts");
  receipt.checks[0].command.args.push("tests/two.test.ts");
  await writeFile(run.receiptPath, JSON.stringify(receipt));
  expect(aggregateOutcome(await verifyReceipt(root, scopePath, run.receiptPath, { governance }))).toBe("FAIL");
});

it("accepts bound evidence read-only; unrelated docs/index changes and identical-byte commits do not stale code", async () => {
  const { root, run, scopePath, governance } = await fixture();
  const receiptBefore = await readFile(run.receiptPath, "utf8");
  const command = vi.spyOn(run, "command");
  await writeFile(path.join(root, "docs/unrelated.md"), "other session\n");
  await writeFile(path.join(root, "aoci.code.txt"), "shared unrelated index update\n");
  execFileSync("git", ["add", "docs/contract.md"], { cwd: root });
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "same bytes"], { cwd: root, stdio: "pipe" });
  expect(aggregateOutcome(await verifyReceipt(root, scopePath, run.receiptPath, { governance }))).toBe("PASS");
  expect(governance).toHaveBeenCalledOnce();
  expect(command).not.toHaveBeenCalled();
  expect(await readFile(run.receiptPath, "utf8")).toBe(receiptBefore);
});

it.each(["source", "policy", "scope", "report", "missing-check", "optional-check"])("rejects stale or incomplete %s evidence", async (mutation) => {
  const { root, run, scopePath, governance } = await fixture();
  if (mutation === "source") await writeFile(path.join(root, "src/participating.ts"), "changed other session source\n");
  else if (mutation === "policy") await writeFile(path.join(root, ".agent/harness/policy.json"), "{}");
  else if (mutation === "scope") await writeFile(scopePath, "{}");
  else if (mutation === "report") await writeFile(path.join(run.logsDirectory, "fixture.stdout.log"), "forged result\n");
  else {
    const receipt = JSON.parse(await readFile(run.receiptPath, "utf8"));
    if (mutation === "missing-check") receipt.checks = [];
    else receipt.checks[0].required = false;
    await writeFile(run.receiptPath, JSON.stringify(receipt));
  }
  expect(aggregateOutcome(await verifyReceipt(root, scopePath, run.receiptPath, { governance }))).not.toBe("PASS");
  expect(governance).not.toHaveBeenCalled();
});

it("invalidates a run when participating bytes change, while ignoring unrelated documentation", async () => {
  const { root, run } = await fixture();
  await writeFile(path.join(root, "src/participating.ts"), "changed during run\n");
  expect(await run.finish([{ id: "fixture", required: true, status: "PASS", message: "earlier" }], "changed")).toBe("NOT_EVALUATED");
});

it("does not promote a valid control JSON to PASS when its process evidence was truncated", async () => {
  const { root, run } = await fixture();
  const policy = HarnessPolicySchema.parse(JSON.parse(await readFile(path.join(root, ".agent/harness/policy.json"), "utf8")));
  const control = { id: "documents", kind: "command" as const, command: "node" as const,
    args: [], required: true, timeoutMs: 1_000 };
  vi.spyOn(run, "command").mockResolvedValue({ code: 0, stdout: JSON.stringify({ id: "documents", required: true, status: "PASS", message: "partial evidence" }),
    stderr: "", timedOut: false, interrupted: false, outputTruncated: true, durationMs: 1 });
  expect(await runCodeChecks(policy, run, undefined, [control])).toEqual([
    expect.objectContaining({ id: "documents", status: "NOT_EVALUATED", category: "output_truncated" }),
  ]);
});

it("keeps the legacy v1 CLI working and verifies scoped docs through an independent read-only CLI receipt", async () => {
  const { root, scopePath } = await fixture();
  const executable = path.join(root, ".agent/harness/fixture-cli.mjs");
  await build({ entryPoints: [path.resolve("src/harness/cli.ts")], outfile: executable,
    bundle: true, platform: "node", format: "esm", target: "node20", logLevel: "silent" });
  await writeFile(path.join(root, "package.json"), "{}");
  const policyPath = path.join(root, ".agent/harness/policy.json");
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const legacy = { schemaVersion: 1, codeChecks: policy.codeChecks, media: policy.media };
  await writeFile(policyPath, JSON.stringify(legacy));
  const invoke = promisify(execFile);
  const old = await invoke(process.execPath, [executable, "code"], { cwd: root, timeout: 15_000 });
  expect(old.stdout).toMatch(/^PASS /);
  const legacyReceipt = path.join(old.stdout.trim().slice(5), "receipt.json");
  expect(JSON.parse(await readFile(legacyReceipt, "utf8"))).toMatchObject({ schemaVersion: 1, status: "PASS" });

  // This local executable models official facts; it never accesses an account or service.
  const bin = path.join(root, ".agent/harness/bin"); await mkdir(bin);
  const facts = { version: "volumes-governance-facts/v1", structure_valid: true, governance_aligned: false,
    composite_identity: "1".repeat(64), managed_scope: { aligned: true, policy_identity: "2".repeat(64), active_policy_identity: "2".repeat(64) },
    code_drift: { missing: [], stale: ["src/other-session.ts"], unbaselined: [], orphan: [], line_ending_only: [] },
    recovery_pending: false, third_party_conflict: false, pending_transactions: 0,
    business_source_sha256: "3".repeat(64), result: "authoring_required", findings: [] };
  await writeFile(path.join(bin, "aoci"), `#!${process.execPath}\nconst args = process.argv.slice(5);\nlet value;\nif(args[0] === 'capabilities') value={version:'aoci-capability-manifest/v1',aoci_version:'0.1.0-rc14',current_layout:'volumes-v1'};\nelse if(args[0] === 'scope') value={version:'managed-scope-evaluation/v2',path:args[2],role:'observe',safety_status:'safe_inventory_allowed',reads_content:true,enters_whole_index:false,enters_observe_fingerprint:true};\nelse if(args[0] === 'source') value={version:'business-source-manifest/v1',files:[],aggregate_sha256:'${"3".repeat(64)}'};\nelse value={governance:${JSON.stringify(facts)}};\nconsole.log(JSON.stringify(value));\n`, { mode: 0o700 });
  policy.controlChecks = ["documents", "owned-aoci"].map((id) => ({ id, kind: "command", command: "node",
    args: [executable, "control", id], required: true, timeoutMs: 15_000 }));
  policy.routes[0].checkIds = ["documents", "owned-aoci"];
  await writeFile(policyPath, JSON.stringify(policy));
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const code = await invoke(process.execPath, [executable, "code", "--scope", scopePath], { cwd: root, env, timeout: 20_000 });
  expect(code.stdout).toMatch(/^PASS /);
  const receiptPath = path.join(code.stdout.trim().slice(5), "receipt.json");
  const original = await readFile(receiptPath, "utf8");
  const verified = await invoke(process.execPath, [executable, "verify", "--scope", scopePath, "--receipt", receiptPath], { cwd: root, env, timeout: 20_000 });
  expect(verified.stdout).toMatch(/^PASS /);
  const verificationPath = path.join(verified.stdout.trim().slice(5), "receipt.json");
  expect(verificationPath).not.toBe(receiptPath);
  expect(JSON.parse(await readFile(verificationPath, "utf8"))).toMatchObject({ schemaVersion: 2, mode: "verify", status: "PASS", visualReview: "NOT_EVALUATED" });
  expect(await readFile(receiptPath, "utf8")).toBe(original);
  await expect(invoke(process.execPath, [executable, "verify", "--scope", scopePath, "--receipt", legacyReceipt], { cwd: root, env, timeout: 20_000 })).rejects.toMatchObject({ code: 1 });
}, 45_000);
