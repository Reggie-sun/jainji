import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { HarnessTaskScopeSchema, type HarnessTaskScope } from "./types.js";

export interface ScopedIdentity {
  sourceFiles: Record<string, string>;
  sourceSha256: string;
  ownedFiles: Record<string, string | null>;
  ownedSha256: string;
  documentFiles: Record<string, string>;
  documentSha256: string;
  policySha256: string;
  scopeSha256: string;
}

interface GitTreeEntry {
  path: string;
  objectId: string;
}

const SOURCE_DIRECTORIES = ["src", "tests", "scripts", "resources", ".github/workflows"];
const SOURCE_CONFIG_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  ".gitattributes",
  ".gitignore",
  "Makefile",
];
const POLICY_PATH = ".agent/harness/policy.json";

function sha256(bytes: Buffer | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function canonicalRepoPath(value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function sortedRecord(values: Map<string, string | null>): Record<string, string | null> {
  return Object.fromEntries([...values.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

async function runGit(repoRoot: string, args: string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("git", args, { cwd: repoRoot, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`git ${args[0]} failed: ${Buffer.concat(stderr).toString("utf8").trim() || `exit ${code ?? -1}`}`));
    });
  });
}

async function hashStream(stream: NodeJS.ReadableStream): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

async function hashGitBlob(repoRoot: string, objectId: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", ["cat-file", "blob", objectId], {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const hash = createHash("sha256");
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => hash.update(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(`sha256:${hash.digest("hex")}`);
      else reject(new Error(`git cat-file failed: ${Buffer.concat(stderr).toString("utf8").trim() || `exit ${code ?? -1}`}`));
    });
  });
}

async function treeEntry(repoRoot: string, baseCommit: string, repoPath: string): Promise<GitTreeEntry | undefined> {
  const output = await runGit(repoRoot, ["--literal-pathspecs", "ls-tree", "-z", "--full-tree", baseCommit, "--", repoPath]);
  for (const raw of output.toString("utf8").split("\0")) {
    if (!raw) continue;
    const separator = raw.indexOf("\t");
    if (separator < 0 || raw.slice(separator + 1) !== repoPath) continue;
    const fields = raw.slice(0, separator).split(" ");
    if (fields.length !== 3 || fields[1] !== "blob" || !fields[0].startsWith("100")) throw new Error(`Owned path is not a regular Git file: ${repoPath}`);
    return { path: repoPath, objectId: fields[2] };
  }
  return undefined;
}

async function assertSafePath(root: string, repoPath: string, allowMissing: boolean): Promise<string | undefined> {
  if (!canonicalRepoPath(repoPath)) throw new Error(`Path is not normalized and repository-relative: ${repoPath}`);
  const segments = repoPath.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let details;
    try { details = await lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissing) return undefined;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Required file does not exist: ${repoPath}`);
      throw error;
    }
    if (details.isSymbolicLink()) {
      const resolved = await realpath(current);
      if (!inside(root, resolved)) throw new Error(`Symbolic link escapes repository: ${repoPath}`);
      throw new Error(`Symbolic links are not valid scoped files: ${repoPath}`);
    }
    if (index < segments.length - 1 && !details.isDirectory()) {
      if (allowMissing) return undefined;
      throw new Error(`Parent path is not a directory: ${repoPath}`);
    }
    if (index === segments.length - 1 && !details.isFile()) throw new Error(`Owned path is not a file: ${repoPath}`);
  }
  return current;
}

async function hashDiskPath(root: string, repoPath: string, allowMissing: boolean): Promise<string | undefined> {
  const filePath = await assertSafePath(root, repoPath, allowMissing);
  if (!filePath) return undefined;
  return hashStream(createReadStream(filePath));
}

async function resolveRepoPath(repoRoot: string, inputPath: string): Promise<{ root: string; filePath: string; relative: string }> {
  const root = await realpath(repoRoot);
  const filePath = path.resolve(root, inputPath);
  if (!inside(root, filePath) || filePath === root) throw new Error(`Scope file is outside the repository: ${inputPath}`);
  const relative = path.relative(root, filePath).split(path.sep).join("/");
  if (!canonicalRepoPath(relative)) throw new Error(`Scope file path is not normalized: ${inputPath}`);
  const actualPath = await assertSafePath(root, relative, false);
  if (!actualPath) throw new Error(`Scope file does not exist: ${relative}`);
  return { root, filePath: actualPath, relative };
}

function freezeScope(scope: HarnessTaskScope): HarnessTaskScope {
  for (const change of scope.ownedChanges) Object.freeze(change);
  Object.freeze(scope.ownedChanges);
  return Object.freeze(scope);
}

export async function loadScope(repoRoot: string, filePath: string): Promise<HarnessTaskScope> {
  const resolvedRoot = await realpath(repoRoot);
  const scopeFile = await resolveRepoPath(resolvedRoot, filePath);
  const rawBytes = await readFile(scopeFile.filePath);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes)); }
  catch (error) { throw new Error(`Cannot read task scope JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const scope = HarnessTaskScopeSchema.parse(raw);
  const baseCommitBytes = await runGit(resolvedRoot, ["rev-parse", "--verify", "--end-of-options", `${scope.baseCommit}^{commit}`]);
  if (baseCommitBytes.toString("utf8").trim() !== scope.baseCommit) throw new Error("Scope baseCommit must be a full canonical Git commit hash.");

  for (const change of scope.ownedChanges) {
    const entry = await treeEntry(resolvedRoot, scope.baseCommit, change.path);
    if (change.change === "add") {
      if (entry) throw new Error(`Declared add already exists in base commit: ${change.path}`);
    } else {
      if (!entry) throw new Error(`Declared ${change.change} has no base preimage: ${change.path}`);
      const actualBefore = await hashGitBlob(resolvedRoot, entry.objectId);
      if (actualBefore !== change.beforeSha256) throw new Error(`Declared preimage does not match base commit for ${change.path}.`);
    }

    const actualAfter = await hashDiskPath(resolvedRoot, change.path, change.change === "delete");
    if ((actualAfter ?? null) !== change.afterSha256) throw new Error(`Declared postimage does not match current disk for ${change.path}.`);
  }

  return freezeScope(scope);
}

function canonicalDocumentPath(reference: string): string {
  const separator = reference.indexOf("#");
  const repoPath = separator < 0 ? reference : reference.slice(0, separator);
  const anchor = separator < 0 ? undefined : reference.slice(separator + 1);
  if (!canonicalRepoPath(repoPath) || (anchor !== undefined && (!anchor || anchor.includes("#") || anchor.includes("\0")))) {
    throw new Error(`Invalid document reference: ${reference}`);
  }
  return repoPath;
}

async function collectTree(root: string, directory: string, paths: Set<string>): Promise<void> {
  const directoryPath = path.join(root, directory);
  let entries;
  try {
    const details = await lstat(directoryPath);
    if (details.isSymbolicLink()) {
      const resolved = await realpath(directoryPath);
      if (!inside(root, resolved)) throw new Error(`Symbolic link escapes repository: ${directory}`);
      throw new Error(`Source snapshot directory is a symbolic link: ${directory}`);
    }
    if (!details.isDirectory()) throw new Error(`Source snapshot path is not a directory: ${directory}`);
    entries = await readdir(directoryPath, { withFileTypes: true });
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === "__pycache__") continue;
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collectTree(root, relative, paths);
    else if (entry.isFile() || entry.isSymbolicLink()) paths.add(relative);
  }
}

async function collectSourcePaths(root: string): Promise<string[]> {
  const paths = new Set<string>();
  for (const directory of SOURCE_DIRECTORIES) await collectTree(root, directory, paths);
  for (const repoPath of [...SOURCE_CONFIG_FILES, POLICY_PATH]) {
    const filePath = await assertSafePath(root, repoPath, true);
    if (filePath) paths.add(repoPath);
  }
  return [...paths].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

async function hashPathMap(root: string, paths: readonly string[]): Promise<Record<string, string>> {
  const values = new Map<string, string | null>();
  for (const repoPath of paths) {
    const value = await hashDiskPath(root, repoPath, false);
    if (value === undefined) throw new Error(`Required file disappeared while capturing identity: ${repoPath}`);
    values.set(repoPath, value);
  }
  return sortedRecord(values) as Record<string, string>;
}

async function hashMap(values: Map<string, string | null>): Promise<string> {
  const files = sortedRecord(values);
  return sha256(JSON.stringify(files));
}

export async function captureScopedIdentity(
  repoRoot: string,
  scope: HarnessTaskScope,
  documentRefs: readonly string[],
  includeSources: boolean,
): Promise<ScopedIdentity> {
  const root = await realpath(repoRoot);
  const parsedScope = HarnessTaskScopeSchema.parse(scope);
  const owned = new Map<string, string | null>();
  for (const change of parsedScope.ownedChanges) {
    const actual = await hashDiskPath(root, change.path, change.change === "delete");
    if ((actual ?? null) !== change.afterSha256) throw new Error(`Owned postimage changed after scope validation: ${change.path}`);
    owned.set(change.path, actual ?? null);
  }

  const documents = new Map<string, string | null>();
  for (const reference of documentRefs) {
    const repoPath = canonicalDocumentPath(reference);
    if (!documents.has(repoPath)) {
      const hash = await hashDiskPath(root, repoPath, false);
      if (hash === undefined) throw new Error(`Referenced document does not exist: ${repoPath}`);
      documents.set(repoPath, hash);
    }
  }

  const policyHash = await hashDiskPath(root, POLICY_PATH, false);
  if (policyHash === undefined) throw new Error(`Harness policy does not exist: ${POLICY_PATH}`);

  const sourceFiles = includeSources ? await hashPathMap(root, await collectSourcePaths(root)) : {};
  const sourceSha256 = sha256(JSON.stringify(sourceFiles));
  const ownedFiles = sortedRecord(owned);
  const documentFiles = sortedRecord(documents) as Record<string, string>;
  return {
    sourceFiles,
    sourceSha256,
    ownedFiles,
    ownedSha256: await hashMap(owned),
    documentFiles,
    documentSha256: await hashMap(documents),
    policySha256: policyHash,
    scopeSha256: sha256(canonicalJson(parsedScope)),
  };
}
