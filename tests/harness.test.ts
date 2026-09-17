import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCodeChecks } from "../src/harness/code.js";
import { HarnessRun, runProcess } from "../src/harness/run.js";
import { aggregateOutcome, HarnessPolicySchema, type HarnessPolicy } from "../src/harness/types.js";

const mediaPolicy = {
  checks: [
    { id: "membership", required: true },
    { id: "source-identity", required: true },
    { id: "decode", required: true },
    { id: "output-spec", required: true },
    { id: "duration", required: true },
    { id: "frame-rate", required: true },
    { id: "audio", required: true },
    { id: "template-text", required: true },
    { id: "visual-evidence", required: true },
  ],
  commandTimeoutMs: 1_000,
  durationMinimumToleranceMs: 100,
  durationFramePeriods: 2,
  frameRateToleranceRatio: 0.001,
  audioDurationToleranceMs: 100,
  thumbnailWidth: 320,
} as const;

const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRun(policy: HarnessPolicy): Promise<HarnessRun> {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-harness-runner-"));
  temporaryRoots.push(root);
  const policyDirectory = path.join(root, ".agent", "harness");
  await mkdir(policyDirectory, { recursive: true });
  const policyPath = path.join(policyDirectory, "policy.json");
  await writeFile(policyPath, JSON.stringify(policy));
  return HarnessRun.create(root, "code", policyPath);
}

function vitestPolicy(script: string): HarnessPolicy {
  return HarnessPolicySchema.parse({
    schemaVersion: 1,
    codeChecks: [{
      id: "fixture",
      kind: "vitest",
      required: true,
      command: "node",
      args: ["-e", script],
      testFiles: ["tests/harness.test.ts"],
      timeoutMs: 5_000,
    }],
    media: mediaPolicy,
  });
}

function reportScript(overrides: Record<string, unknown> = {}): string {
  const report = {
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    success: true,
    testResults: [{ name: "TEST_FILE", status: "passed", assertionResults: [{ status: "passed" }] }],
    ...overrides,
  };
  return `const fs=require('node:fs');const path=require('node:path');const a=process.argv.find(v=>v.startsWith('--outputFile='));const r=${JSON.stringify(report)};for(const t of r.testResults){if(t.name==='TEST_FILE')t.name=path.resolve('tests/harness.test.ts')}fs.mkdirSync(path.dirname(a.slice(13)),{recursive:true});fs.writeFileSync(a.slice(13),JSON.stringify(r));`;
}

describe("video validation harness runner", () => {
  it("rejects duplicate checks and invalid tolerances", () => {
    const raw = { schemaVersion: 1, codeChecks: [
      { id: "same", kind: "command", required: true, command: "node", args: [], timeoutMs: 1 },
      { id: "same", kind: "command", required: true, command: "node", args: [], timeoutMs: 1 },
    ], media: { ...mediaPolicy, frameRateToleranceRatio: -1 } };
    expect(HarnessPolicySchema.safeParse(raw).success).toBe(false);
  });

  it("uses fail before not-evaluated and never treats missing evidence as pass", () => {
    expect(aggregateOutcome([{ id: "a", required: true, status: "PASS", message: "ok" }])).toBe("PASS");
    expect(aggregateOutcome([{ id: "a", required: true, status: "NOT_EVALUATED", message: "missing" }])).toBe("NOT_EVALUATED");
    expect(aggregateOutcome([
      { id: "a", required: true, status: "NOT_EVALUATED", message: "missing" },
      { id: "b", required: true, status: "FAIL", message: "bad" },
    ])).toBe("FAIL");
  });

  it("reports command timeout as not evaluated", async () => {
    const command = await runProcess("node", ["-e", "setTimeout(()=>{}, 10000)"], { cwd: process.cwd(), timeoutMs: 50 });
    expect(command.timedOut).toBe(true);
    expect(command.code).not.toBe(0);
  });

  it("settles timed-out process trees whether or not descendants inherit pipes", async () => {
    for (const stdio of ["inherit", "ignore"]) {
      const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','process.on("SIGINT",()=>{});setInterval(()=>{},1000)'],{stdio:'${stdio}'});console.log(child.pid);process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000);`;
      const started = Date.now();
      const command = await runProcess("node", ["-e", script], { cwd: process.cwd(), timeoutMs: 50 });
      expect(command.timedOut).toBe(true);
      expect(Date.now() - started).toBeLessThan(3_500);
      const descendantPid = Number(command.stdout.trim().split(/\s+/)[0]);
      expect(Number.isInteger(descendantPid)).toBe(true);
      let alive = true;
      for (let attempt = 0; attempt < 20 && alive; attempt += 1) {
        try { process.kill(descendantPid, 0); }
        catch { alive = false; }
        if (alive) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(alive).toBe(false);
    }
  });

  it("creates unique immutable run directories and final receipts", async () => {
    const policy = vitestPolicy(reportScript());
    const first = await temporaryRun(policy);
    const second = await HarnessRun.create(first.repoRoot, "code", path.join(first.repoRoot, ".agent", "harness", "policy.json"));
    expect(first.directory).not.toBe(second.directory);
    const status = await first.finish([{ id: "fixture", required: true, status: "PASS", message: "ok" }], "# result");
    expect(status).toBe("PASS");
    expect(JSON.parse(await readFile(first.receiptPath, "utf8"))).toMatchObject({ status: "PASS", visualReview: "NOT_EVALUATED" });
  });

  it("binds execution to the policy bytes copied into the run", async () => {
    const policy = vitestPolicy(reportScript());
    const run = await temporaryRun(policy);
    const policyPath = path.join(run.repoRoot, ".agent", "harness", "policy.json");
    await writeFile(policyPath, "{}");
    expect(JSON.parse(run.policyBytes.toString("utf8"))).toMatchObject({ schemaVersion: 1 });
    expect(await readFile(path.join(run.directory, "policy.json"), "utf8")).toBe(run.policyBytes.toString("utf8"));
  });

  it("requires a readable report, discovered files, nonzero tests, and no skips", async () => {
    const missingPolicy = vitestPolicy("process.exit(0)");
    const missingRun = await temporaryRun(missingPolicy);
    expect((await runCodeChecks(missingPolicy, missingRun))[0]).toMatchObject({ status: "NOT_EVALUATED", category: "report_missing" });

    const zeroPolicy = vitestPolicy(reportScript({ numTotalTests: 0, numPassedTests: 0, testResults: [] }));
    const zeroRun = await temporaryRun(zeroPolicy);
    expect((await runCodeChecks(zeroPolicy, zeroRun))[0]).toMatchObject({ status: "NOT_EVALUATED", category: "test_not_discovered" });

    const skippedPolicy = vitestPolicy(reportScript({
      numPendingTests: 1,
      numPassedTests: 0,
      testResults: [{ name: "TEST_FILE", status: "passed", assertionResults: [{ status: "skipped" }] }],
    }));
    const skippedRun = await temporaryRun(skippedPolicy);
    expect((await runCodeChecks(skippedPolicy, skippedRun))[0]).toMatchObject({ status: "NOT_EVALUATED", category: "test_skipped" });

    const passPolicy = vitestPolicy(reportScript());
    const passRun = await temporaryRun(passPolicy);
    expect((await runCodeChecks(passPolicy, passRun))[0]).toMatchObject({ status: "PASS" });

    const liarPolicy = vitestPolicy(reportScript({
      numPassedTests: 0,
      testResults: [{ name: "TEST_FILE", status: "passed", assertionResults: [] }],
    }));
    const liarRun = await temporaryRun(liarPolicy);
    expect((await runCodeChecks(liarPolicy, liarRun))[0]).toMatchObject({ status: "NOT_EVALUATED", category: "report_inconsistent" });

    for (const fileStatus of ["pending", "skipped", "todo"]) {
      const fileStatusPolicy = vitestPolicy(reportScript({
        testResults: [{ name: "TEST_FILE", status: fileStatus, assertionResults: [{ status: "passed" }] }],
      }));
      const fileStatusRun = await temporaryRun(fileStatusPolicy);
      expect((await runCodeChecks(fileStatusPolicy, fileStatusRun))[0]).toMatchObject({ status: "NOT_EVALUATED", category: "test_skipped" });
    }
  });
});
