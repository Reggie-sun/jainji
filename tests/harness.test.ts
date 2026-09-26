import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, describe, expect, it, vi } from "vitest";
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

function pidExists(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid fixture PID: ${pid}`);
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function processSnapshot(pid: number): Promise<unknown> {
  if (process.platform !== "linux") return { pid, exists: pidExists(pid) };
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    return { pid, state: fields[0], ppid: Number(fields[1]), pgid: Number(fields[2]) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { pid, exists: false };
    throw error;
  }
}

async function waitForFixture(check: () => Promise<boolean>): Promise<boolean> {
  // Real OS scheduling stays separate from the controlled harness timeout clock.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return true;
    await delay(10);
  }
  return false;
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

  it.each(["inherit", "ignore"])("settles ready timed-out process trees with %s pipes", async (stdio) => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-harness-tree-"));
    temporaryRoots.push(root);
    const readyPath = path.join(root, "ready.json");
    const signalsPath = path.join(root, "signals.log");
    const descendantScript = `const fs=require('node:fs');process.on('SIGINT',()=>fs.appendFileSync(${JSON.stringify(signalsPath)},'descendant SIGINT\\n'));process.send('ready');setInterval(()=>{},1000);`;
    // Delay readiness beyond the old 50ms startup assumption, then acknowledge
    // the descendant's installed signal handler over IPC before starting timeout.
    const script = `const fs=require('node:fs');const {spawn}=require('node:child_process');process.on('SIGINT',()=>{fs.appendFileSync(${JSON.stringify(signalsPath)},'root SIGINT\\n');process.exit(0)});setTimeout(()=>{const child=spawn(process.execPath,['-e',${JSON.stringify(descendantScript)}],{stdio:['ignore','${stdio}','${stdio}','ipc']});child.once('message',()=>{console.log(child.pid);fs.writeFileSync(${JSON.stringify(readyPath)},JSON.stringify({root:process.pid,descendant:child.pid}))})},100);setInterval(()=>{},1000);`;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = runProcess("node", ["-e", script], { cwd: process.cwd(), timeoutMs: 50 });
    try {
      const ready = await waitForFixture(async () => {
        try { JSON.parse(await readFile(readyPath, "utf8")); return true; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return false;
          throw error;
        }
      });
      expect(ready, "root and descendant must acknowledge readiness before timeout").toBe(true);
      const pids = JSON.parse(await readFile(readyPath, "utf8")) as { root: number; descendant: number };
      for (const pid of [pids.root, pids.descendant]) expect(pidExists(pid)).toBe(true);
      const before = await Promise.all([pids.root, pids.descendant].map(processSnapshot));
      if (process.platform === "linux") {
        for (const snapshot of before) expect(snapshot).toMatchObject({ pgid: pids.root });
      }
      const started = Date.now();
      await vi.advanceTimersByTimeAsync(50);
      if (process.platform !== "win32") {
        expect(await waitForFixture(async () => {
          try { return (await readFile(signalsPath, "utf8")).includes("descendant SIGINT"); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
            throw error;
          }
        }), "descendant must survive graceful group termination and require SIGKILL").toBe(true);
        expect(await waitForFixture(async () => !pidExists(pids.root)), "root must exit before the force timer despite a surviving descendant").toBe(true);
        expect(pidExists(pids.descendant)).toBe(true);
      }
      // taskkill is asynchronous on Windows; let stop() install escalation first.
      expect(await waitForFixture(async () => vi.getTimerCount() === 2), "force and hard-stop timers must be armed").toBe(true);
      await vi.advanceTimersByTimeAsync(1_000);
      const command = await pending;
      expect(command.timedOut).toBe(true);
      expect(Date.now() - started).toBeLessThan(3_500);
      expect(command.stdout.trim()).toBe(String(pids.descendant));
      const gone = await waitForFixture(async () => !pidExists(pids.root) && !pidExists(pids.descendant));
      const after = await Promise.all([pids.root, pids.descendant].map(processSnapshot));
      // A zombie still has a PID and fails this gate; do not relax to state != Z.
      expect(gone, JSON.stringify({ before, after, command })).toBe(true);
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
      await pending;
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
