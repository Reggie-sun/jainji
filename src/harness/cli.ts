import { readFile } from "node:fs/promises";
import path from "node:path";
import { codeSummary, runCodeChecks } from "./code.js";
import { loadMediaSelection, mediaSummary, validateMediaSelection, type MediaInputOptions } from "./media.js";
import { HarnessRun } from "./run.js";
import { exitCodeFor, HarnessPolicySchema, type HarnessCheckResult } from "./types.js";

function parseMediaArgs(args: string[]): MediaInputOptions {
  let project: string | undefined;
  let queue: string | undefined;
  const batchIds: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!["--project", "--queue", "--batch"].includes(flag) || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid media argument: ${flag ?? "<missing>"}`);
    }
    index += 1;
    if (flag === "--project") {
      if (project) throw new Error("--project may be provided only once.");
      project = value;
    } else if (flag === "--queue") {
      if (queue) throw new Error("--queue may be provided only once.");
      queue = value;
    } else {
      batchIds.push(value);
    }
  }
  if (project && queue) throw new Error("--project and --queue are mutually exclusive.");
  if (queue) {
    if (batchIds.length > 0) throw new Error("--batch cannot be used with --queue.");
    return { kind: "queue", filePath: queue };
  }
  if (!project) throw new Error("media requires --project or --queue.");
  return { kind: "project", filePath: project, batchIds };
}

function loadPolicy(policyBytes: Buffer) {
  let raw: unknown;
  try { raw = JSON.parse(policyBytes.toString("utf8")); }
  catch (error) { throw new Error(`Cannot read harness policy: ${error instanceof Error ? error.message : String(error)}`); }
  return HarnessPolicySchema.parse(raw);
}

function failureCheck(error: unknown): HarnessCheckResult {
  return {
    id: "harness-input",
    required: true,
    status: "NOT_EVALUATED",
    category: "input_or_runtime_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [mode, ...args] = argv;
  if (mode !== "code" && mode !== "media") {
    console.error("Usage: npm run harness -- code | media (--project <project.json> --batch <id>... | --queue <queue-state.json>)");
    return 2;
  }
  if (mode === "code" && args.length > 0) {
    console.error("code does not accept additional arguments.");
    return 2;
  }
  const repoRoot = process.cwd();
  const policyPath = path.join(repoRoot, ".agent", "harness", "policy.json");
  let run: HarnessRun | undefined;
  const abort = new AbortController();
  const onSignal = () => abort.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    run = await HarnessRun.create(repoRoot, mode, policyPath);
    const policy = loadPolicy(run.policyBytes);
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as { devDependencies?: Record<string, string> };
    run.setTools({ typescript: packageJson.devDependencies?.typescript ?? null, vitest: packageJson.devDependencies?.vitest ?? null });
    if (mode === "code") {
      const checks = await runCodeChecks(policy, run, abort.signal);
      const status = await run.finish(checks, codeSummary(checks, run));
      console.log(`${status} ${run.directory}`);
      return exitCodeFor(status);
    }
    const options = parseMediaArgs(args);
    const selection = await loadMediaSelection(options);
    await run.writeInputs(selection.inputsSnapshot);
    const validation = await validateMediaSelection(policy, run, selection, abort.signal);
    const status = await run.finish(validation.checks, mediaSummary(run, validation.checks, validation.tasks), {
      inputs: { snapshot: "inputs.json", inputPath: selection.inputPath, beforeSha256: selection.inputSha256, afterSha256: validation.inputAfterSha256 },
    });
    console.log(`${status} ${run.directory}`);
    return exitCodeFor(status);
  } catch (error) {
    if (!run) {
      console.error(error instanceof Error ? error.message : String(error));
      return 2;
    }
    const check = failureCheck(error);
    try {
      const status = await run.finish([check], `# Harness Error\n\n${check.message}\n\nVisual review: **NOT_EVALUATED**\n`, { error: { category: check.category!, message: check.message } });
      console.error(`${status} ${run.directory}: ${check.message}`);
    } catch (finishError) {
      console.error(`Harness failed and could not save a final receipt at ${run.directory}: ${finishError instanceof Error ? finishError.message : String(finishError)}`);
    }
    return 2;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

process.exitCode = await main();
