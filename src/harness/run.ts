import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { aggregateOutcome, type HarnessCheckResult, type HarnessOutcome } from "./types.js";

export interface WorkspaceIdentity {
  gitHead?: string;
  dirty: boolean;
  trackedDiffSha256: string;
  untrackedSources: Array<{ path: string; sha256: string }>;
  sourceIdentitySha256: string;
}

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  interrupted: boolean;
  outputTruncated: boolean;
  error?: string;
}

interface Receipt {
  schemaVersion: 1;
  runId: string;
  mode: "code" | "media";
  startedAt: string;
  finishedAt?: string;
  status: HarnessOutcome | "RUNNING";
  visualReview: "NOT_EVALUATED";
  environment: { platform: string; arch: string; node: string; cwd: string; tools?: Record<string, string | null> };
  workspaceBefore: WorkspaceIdentity;
  workspaceAfter?: WorkspaceIdentity;
  checks: HarnessCheckResult[];
  inputs?: Record<string, unknown>;
  error?: { category: string; message: string };
}

const SOURCE_PATH = /^(?:src|tests|scripts)\//;

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function executableFor(command: string): string {
  if (command === "node") return process.execPath;
  return command;
}

async function terminateProcessTree(child: ChildProcess, force = false): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", ...(force ? ["/f"] : [])], { shell: false, windowsHide: true });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }
  try { process.kill(-child.pid, force ? "SIGKILL" : "SIGINT"); }
  catch {
    if (child.exitCode === null) child.kill(force ? "SIGKILL" : "SIGINT");
  }
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal; maxOutputBytes?: number },
): Promise<ProcessResult> {
  const started = Date.now();
  const executable = executableFor(command);
  const maxBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;
  return new Promise<ProcessResult>((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let interrupted = false;
    let spawnError: string | undefined;
    let settled = false;
    let stopping = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let hardStopTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let outputTruncated = false;
    const append = (current: Buffer, chunk: Buffer): Buffer => {
      if (current.length >= maxBytes) { outputTruncated = true; return current; }
      if (chunk.length > maxBytes - current.length) outputTruncated = true;
      return Buffer.concat([current, chunk.subarray(0, maxBytes - current.length)]);
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceTimer && !stopping) clearTimeout(forceTimer);
      if (hardStopTimer) clearTimeout(hardStopTimer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        code,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        durationMs: Date.now() - started,
        timedOut,
        interrupted,
        outputTruncated,
        ...(spawnError ? { error: spawnError } : {}),
      });
    };
    const stop = async (reason: "timeout" | "interrupt") => {
      if (reason === "timeout") timedOut = true;
      else interrupted = true;
      if (stopping || settled) return;
      stopping = true;
      await terminateProcessTree(child);
      forceTimer = setTimeout(() => {
        void (async () => {
          await terminateProcessTree(child, true);
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(child.exitCode ?? -1);
        })();
      }, 1_000);
      hardStopTimer = setTimeout(() => {
        void (async () => {
          await terminateProcessTree(child, true);
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(-1);
        })();
      }, 2_500);
    };
    timeoutTimer = setTimeout(() => void stop("timeout"), options.timeoutMs);
    const onAbort = () => void stop("interrupt");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) void stop("interrupt");
    child.once("error", (error) => { spawnError = error.message; finish(-1); });
    child.once("close", (code) => {
      if (!stopping) finish(code ?? -1);
    });
  });
}

async function gitOutput(repoRoot: string, args: string[]): Promise<string> {
  const result = await runProcess("git", args, { cwd: repoRoot, timeoutMs: 30_000, maxOutputBytes: 50 * 1024 * 1024 });
  return result.code === 0 ? result.stdout : "";
}

function statusPath(entry: string): string {
  const value = entry.slice(3);
  const arrow = value.lastIndexOf(" -> ");
  return (arrow >= 0 ? value.slice(arrow + 4) : value).replaceAll("\\", "/");
}

export async function captureWorkspaceIdentity(repoRoot: string): Promise<WorkspaceIdentity> {
  const [head, statusText, diff] = await Promise.all([
    gitOutput(repoRoot, ["rev-parse", "HEAD"]),
    gitOutput(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    gitOutput(repoRoot, ["diff", "--binary", "HEAD", "--", "."]),
  ]);
  const entries = statusText.split("\0").filter(Boolean);
  const untrackedSources: Array<{ path: string; sha256: string }> = [];
  for (const entry of entries) {
    if (!entry.startsWith("?? ")) continue;
    const relative = statusPath(entry);
    if (!SOURCE_PATH.test(relative) && !["package.json", "tsconfig.json", ".agent/harness/policy.json"].includes(relative)) continue;
    try {
      const info = await stat(path.join(repoRoot, relative));
      if (info.isFile()) untrackedSources.push({ path: relative, sha256: sha256(await readFile(path.join(repoRoot, relative))) });
    } catch { /* the source changed while identity was captured */ }
  }
  untrackedSources.sort((left, right) => left.path.localeCompare(right.path));
  const trackedDiffSha256 = sha256(diff);
  const gitHead = head.trim() || undefined;
  return {
    ...(gitHead ? { gitHead } : {}),
    dirty: entries.length > 0,
    trackedDiffSha256,
    untrackedSources,
    sourceIdentitySha256: sha256(JSON.stringify({ gitHead, trackedDiffSha256, untrackedSources })),
  };
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

function safeLogId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

export class HarnessRun {
  readonly receiptPath: string;
  readonly logsDirectory: string;
  readonly framesDirectory: string;
  private receipt: Receipt;

  private constructor(readonly repoRoot: string, readonly directory: string, receipt: Receipt, readonly policyBytes: Buffer) {
    this.receipt = receipt;
    this.receiptPath = path.join(directory, "receipt.json");
    this.logsDirectory = path.join(directory, "logs");
    this.framesDirectory = path.join(directory, "frames");
  }

  static async create(repoRoot: string, mode: "code" | "media", policyPath: string): Promise<HarnessRun> {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const runId = `${stamp}-${randomUUID().slice(0, 8)}`;
    const runsRoot = path.join(repoRoot, ".agent", "harness", "runs");
    const directory = path.join(runsRoot, runId);
    await mkdir(runsRoot, { recursive: true, mode: 0o700 });
    await chmod(runsRoot, 0o700);
    await mkdir(directory, { mode: 0o700 });
    await mkdir(path.join(directory, "logs"), { mode: 0o700 });
    if (mode === "media") await mkdir(path.join(directory, "frames"), { mode: 0o700 });
    const policyBytes = await readFile(policyPath);
    await writeFile(path.join(directory, "policy.json"), policyBytes, { mode: 0o600 });
    const workspaceBefore = await captureWorkspaceIdentity(repoRoot);
    const receipt: Receipt = {
      schemaVersion: 1,
      runId,
      mode,
      startedAt: new Date().toISOString(),
      status: "RUNNING",
      visualReview: "NOT_EVALUATED",
      environment: { platform: process.platform, arch: process.arch, node: process.version, cwd: repoRoot },
      workspaceBefore,
      checks: [],
    };
    const run = new HarnessRun(repoRoot, directory, receipt, policyBytes);
    await atomicJson(run.receiptPath, receipt);
    return run;
  }

  async writeInputs(value: Record<string, unknown>): Promise<void> {
    await atomicJson(path.join(this.directory, "inputs.json"), value);
    this.receipt.inputs = { snapshot: "inputs.json" };
  }

  setTools(tools: Record<string, string | null>): void {
    this.receipt.environment.tools = { ...this.receipt.environment.tools, ...tools };
  }

  async command(id: string, command: string, args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<ProcessResult> {
    const result = await runProcess(command, args, { cwd: this.repoRoot, timeoutMs, signal });
    const prefix = path.join(this.logsDirectory, safeLogId(id));
    await Promise.all([
      writeFile(`${prefix}.stdout.log`, result.stdout, { encoding: "utf8", mode: 0o600 }),
      writeFile(`${prefix}.stderr.log`, result.stderr, { encoding: "utf8", mode: 0o600 }),
    ]);
    return result;
  }

  async finish(
    checks: HarnessCheckResult[],
    summary: string,
    options: { error?: { category: string; message: string }; inputs?: Record<string, unknown> } = {},
  ): Promise<HarnessOutcome> {
    const workspaceAfter = await captureWorkspaceIdentity(this.repoRoot);
    if (workspaceAfter.sourceIdentitySha256 !== this.receipt.workspaceBefore.sourceIdentitySha256) {
      checks.push({
        id: "workspace-identity",
        required: true,
        status: "NOT_EVALUATED",
        category: "source_changed",
        message: "Source identity changed while the harness was running; start a new run.",
        evidence: { before: this.receipt.workspaceBefore.sourceIdentitySha256, after: workspaceAfter.sourceIdentitySha256 },
      });
    }
    const status = aggregateOutcome(checks);
    this.receipt = {
      ...this.receipt,
      finishedAt: new Date().toISOString(),
      status,
      workspaceAfter,
      checks,
      ...(options.inputs ? { inputs: options.inputs } : {}),
      ...(options.error ? { error: options.error } : {}),
    };
    await writeFile(path.join(this.directory, "summary.md"), summary.endsWith("\n") ? summary : `${summary}\n`, { encoding: "utf8", mode: 0o600 });
    await atomicJson(this.receiptPath, this.receipt);
    return status;
  }
}

export function outcomeForProcess(result: ProcessResult): Pick<HarnessCheckResult, "status" | "category" | "message"> {
  if (result.interrupted) return { status: "NOT_EVALUATED", category: "interrupted", message: "Command was interrupted." };
  if (result.timedOut) return { status: "NOT_EVALUATED", category: "timeout", message: "Command timed out." };
  if (result.error) return { status: "NOT_EVALUATED", category: "tool_unavailable", message: result.error };
  if (result.code !== 0) return { status: "FAIL", category: "command_failed", message: `Command exited with code ${result.code}.` };
  return { status: "PASS", message: "Command completed successfully." };
}

export function relativeEvidencePath(run: HarnessRun, filePath: string): string {
  return path.relative(run.directory, filePath).replaceAll(path.sep, "/");
}
