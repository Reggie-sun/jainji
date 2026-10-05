import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runProcess } from "./run.js";
import type { HarnessCheckResult, HarnessOutcome } from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/;
const AociCapabilitySchema = z.object({
  version: z.literal("aoci-capability-manifest/v1"),
  aoci_version: z.string().min(1),
  current_layout: z.literal("volumes-v1"),
  network_accessed: z.literal(false).optional(),
}).passthrough();

const SourceManifestSchema = z.object({
  version: z.literal("business-source-manifest/v1"),
  files: z.array(z.object({
    path: z.string().min(1),
    sha256: z.string().regex(SHA256),
    size_bytes: z.number().int().nonnegative(),
  }).passthrough()),
  aggregate_sha256: z.string().regex(SHA256),
  network_accessed: z.literal(false).optional(),
}).passthrough();

const ScopeEvaluationSchema = z.object({
  version: z.literal("managed-scope-evaluation/v2"),
  path: z.string().min(1),
  role: z.enum(["index", "observe", "exclude"]),
  safety_status: z.string().min(1),
  reads_content: z.boolean(),
  enters_whole_index: z.boolean(),
  enters_observe_fingerprint: z.boolean(),
  reason: z.string().optional(),
}).passthrough();

const DriftSchema = z.object({
  missing: z.array(z.string()),
  stale: z.array(z.string()),
  unbaselined: z.array(z.string()),
  orphan: z.array(z.string()),
  line_ending_only: z.array(z.string()),
}).passthrough();

const FormalAssetSchema = z.object({
  enabled: z.boolean(), applicable: z.boolean(), domain_state: z.string().min(1),
  asset_state: z.enum(["present", "absent", "invalid"]), path: z.string().min(1),
  sha256: z.string().regex(SHA256).optional(),
}).passthrough();

const GovernanceFactsSchema = z.object({
  version: z.literal("volumes-governance-facts/v1"),
  structure_valid: z.boolean(),
  governance_aligned: z.boolean(),
  composite_identity: z.string().min(1),
  root: FormalAssetSchema.optional(), meta: FormalAssetSchema.optional(),
  code: FormalAssetSchema.optional(), database: FormalAssetSchema.optional(),
  managed_scope: z.object({
    aligned: z.boolean(),
    policy_identity: z.string().min(1),
    active_policy_identity: z.string().min(1),
  }).passthrough(),
  code_drift: DriftSchema,
  recovery_pending: z.boolean(),
  third_party_conflict: z.boolean(),
  pending_transactions: z.number().int().nonnegative(),
  business_source_sha256: z.string().regex(SHA256),
  result: z.string().min(1),
  findings: z.array(z.object({ code: z.string().min(1), target: z.string().optional() }).passthrough()),
  network_accessed: z.literal(false).optional(),
}).passthrough();

const AOCI_ROOT_COMMAND_ARGS = (repoRoot: string) => ["--json", "--repo", repoRoot];
const GOVERNANCE_TIMEOUT_MS = 60_000;
const DRIFT_KEYS = ["missing", "stale", "unbaselined", "orphan", "line_ending_only"] as const;

export type OwnedGovernanceChange = {
  path: string;
  change: "add" | "modify" | "delete";
};

export interface AociCommandResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  interrupted?: boolean;
  outputTruncated?: boolean;
  error?: string;
}

export type AociCommandRunner = (args: readonly string[], cwd: string) => Promise<AociCommandResult>;

export interface OwnedAociOptions {
  commandRunner?: AociCommandRunner;
  timeoutMs?: number;
}

interface DocumentLink {
  from: string;
  destination: string;
}

interface BrokenDocumentLink extends DocumentLink {
  reason: string;
}

interface LoadedDocument {
  absolutePath: string;
  relativePath: string;
  bytes: Buffer;
  text: string;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function harnessResult(
  id: string,
  status: HarnessOutcome,
  category: string,
  message: string,
  startedAt: number,
  evidence: Record<string, unknown>,
): HarnessCheckResult {
  return {
    id,
    required: true,
    status,
    category,
    message,
    durationMs: Date.now() - startedAt,
    evidence,
  };
}

function validRepoRelativePath(value: string): boolean {
  if (!value || value.includes("\0") || value.includes("\\") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..") && path.posix.normalize(value) === value;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function markdownPath(value: string): boolean {
  return /\.md$/i.test(value) || /\.markdown$/i.test(value);
}

function stripCodeAndComments(source: string): string {
  const output: string[] = [];
  let fence: { character: string; length: number } | undefined;
  for (const line of source.split(/\r?\n/)) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const closing = fenceMatch?.[1];
      if (closing && closing[0] === fence.character && closing.length >= fence.length) fence = undefined;
      output.push("");
      continue;
    }
    if (fenceMatch) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
      output.push("");
      continue;
    }
    output.push(line);
  }
  return output.join("\n").replace(/<!--[\s\S]*?-->/g, "").replace(/(`+)(.*?)\1/g, "");
}

function referenceKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function unescapeMarkdownDestination(destination: string): string {
  return destination.replace(/\\([\\()[\]<> ])/g, "$1");
}

function parseInlineDestination(text: string, openParen: number): string | undefined {
  let index = openParen + 1;
  while (/\s/.test(text[index] ?? "")) index += 1;
  if (text[index] === "<") {
    const start = ++index;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (!escaped && character === ">") return unescapeMarkdownDestination(text.slice(start, index));
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      index += 1;
    }
    return undefined;
  }

  const start = index;
  let depth = 0;
  let escaped = false;
  while (index < text.length) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      index += 1;
      continue;
    }
    if (character === "(" ) {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      if (depth === 0) break;
      depth -= 1;
      index += 1;
      continue;
    }
    if (/\s/.test(character) && depth === 0) break;
    index += 1;
  }
  const destination = text.slice(start, index).trim();
  return destination ? unescapeMarkdownDestination(destination) : undefined;
}

function extractLinks(source: string, from: string): DocumentLink[] {
  const text = stripCodeAndComments(source);
  const links: DocumentLink[] = [];
  const definitions = new Map<string, string>();
  const withoutDefinitions = text.replace(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+.*)?$/gm, (_line, label: string, angle: string | undefined, bare: string | undefined) => {
    definitions.set(referenceKey(label), unescapeMarkdownDestination(angle ?? bare ?? ""));
    return "";
  });

  const inlinePattern = /!?\[[^\]]*\]\(/g;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlinePattern.exec(withoutDefinitions))) {
    const openParen = inlinePattern.lastIndex - 1;
    const destination = parseInlineDestination(withoutDefinitions, openParen);
    if (destination !== undefined) links.push({ from, destination });
  }

  const referencePattern = /!?\[([^\]]+)\](?:\[([^\]]*)\])?/g;
  let referenceMatch: RegExpExecArray | null;
  while ((referenceMatch = referencePattern.exec(withoutDefinitions))) {
    const key = referenceKey(referenceMatch[2] || referenceMatch[1]);
    const destination = definitions.get(key);
    if (destination !== undefined) links.push({ from, destination });
  }

  const htmlPattern = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlPattern.exec(withoutDefinitions))) {
    links.push({ from, destination: htmlMatch[1] ?? htmlMatch[2] ?? "" });
  }
  return links;
}

function cleanHeadingText(value: string): string {
  return value
    .replace(/!?(\[[^\]]*\])\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[\*_~]/g, "")
    .trim();
}

function headingSlug(value: string): string {
  return cleanHeadingText(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, "").trim().replace(/ /g, "-");
}

function markdownAnchors(source: string): Set<string> {
  const lines = stripCodeAndComments(source).split("\n");
  const anchors = new Set<string>();
  const occurrences = new Map<string, number>();
  const addHeading = (heading: string) => {
    const slug = headingSlug(heading);
    if (!slug) return;
    const occurrence = occurrences.get(slug) ?? 0;
    occurrences.set(slug, occurrence + 1);
    anchors.add(occurrence === 0 ? slug : `${slug}-${occurrence}`);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const atx = /^ {0,3}#{1,6}(?:\s+|$)(.*?)(?:\s+#+\s*)?$/.exec(line);
    if (atx) {
      addHeading(atx[1]);
      continue;
    }
    if (index + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1]) && line.trim()) {
      addHeading(line.trim());
      continue;
    }
  }
  const idPattern = /<(?:a|[a-z][a-z0-9-]*)\b[^>]*\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let idMatch: RegExpExecArray | null;
  const html = stripCodeAndComments(source);
  while ((idMatch = idPattern.exec(html))) anchors.add(idMatch[1] ?? idMatch[2]);
  return anchors;
}

function splitDestination(destination: string): { path: string; anchor?: string; external: boolean } {
  const trimmed = destination.trim();
  if (!trimmed || trimmed.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return { path: "", external: true };
  const fragmentIndex = trimmed.indexOf("#");
  const beforeFragment = fragmentIndex >= 0 ? trimmed.slice(0, fragmentIndex) : trimmed;
  const queryIndex = beforeFragment.indexOf("?");
  const rawPath = queryIndex >= 0 ? beforeFragment.slice(0, queryIndex) : beforeFragment;
  let anchor: string | undefined;
  if (fragmentIndex >= 0) {
    try { anchor = decodeURIComponent(trimmed.slice(fragmentIndex + 1)); }
    catch { anchor = trimmed.slice(fragmentIndex + 1); }
  }
  let decodedPath = rawPath;
  try { decodedPath = decodeURIComponent(rawPath); }
  catch { /* preserve invalid encoding so the target check reports it */ }
  return { path: decodedPath, ...(anchor !== undefined ? { anchor } : {}), external: false };
}

async function loadMarkdownTarget(rootReal: string, absolutePath: string): Promise<LoadedDocument> {
  const targetReal = await realpath(absolutePath);
  if (!inside(rootReal, targetReal)) throw new Error("repository_escape");
  const info = await stat(targetReal);
  if (!info.isFile()) throw new Error("target_not_file");
  const bytes = await readFile(targetReal);
  return {
    absolutePath: targetReal,
    relativePath: path.relative(rootReal, targetReal).split(path.sep).join("/"),
    bytes,
    text: bytes.toString("utf8"),
  };
}

function validateDocumentInput(value: string): boolean {
  return validRepoRelativePath(value) && markdownPath(value);
}

async function checkDocumentSet(
  repoRoot: string,
  ownedMarkdownPaths: readonly string[],
  documentRefs: readonly string[],
): Promise<HarnessCheckResult> {
  const startedAt = Date.now();
  if (ownedMarkdownPaths.length + documentRefs.length === 0) {
    return harnessResult("documents", "NOT_EVALUATED", "no_documents_selected", "No owned Markdown or document references were selected.", startedAt, { checkedDocuments: [], brokenLinks: [] });
  }

  const parsedRefs = documentRefs.map((value) => ({ value, target: splitDestination(value) }));
  const invalidOwned = ownedMarkdownPaths.filter((value) => !validateDocumentInput(value));
  const invalidRefs = parsedRefs.filter(({ target }) => target.external || !target.path || !validateDocumentInput(target.path)).map(({ value }) => value);
  if (invalidOwned.length > 0 || invalidRefs.length > 0) {
    return harnessResult("documents", "FAIL", "invalid_document_scope", "Document scope contains a non-canonical or non-Markdown path.", startedAt, {
      invalidPaths: [...invalidOwned, ...invalidRefs],
      checkedDocuments: [],
      brokenLinks: [],
    });
  }
  const inputs = [...new Set([...ownedMarkdownPaths, ...parsedRefs.map(({ target }) => target.path)])];

  let rootReal: string;
  try { rootReal = await realpath(repoRoot); }
  catch (error) {
    return harnessResult("documents", "NOT_EVALUATED", "document_root_unavailable", `Cannot resolve repository root: ${error instanceof Error ? error.message : String(error)}`, startedAt, { checkedDocuments: [], brokenLinks: [] });
  }

  const brokenLinks: BrokenDocumentLink[] = [];
  const unavailable: Array<{ path: string; reason: string }> = [];
  const documents = new Map<string, LoadedDocument>();
  const documentHashes: Record<string, string> = {};
  const linkCountByDocument: Record<string, number> = {};

  const readDocument = async (repoRelativePath: string, source: string): Promise<LoadedDocument | undefined> => {
    const absolutePath = path.resolve(rootReal, ...repoRelativePath.split("/"));
    if (!inside(rootReal, absolutePath)) {
      brokenLinks.push({ from: source, destination: repoRelativePath, reason: "repository_escape" });
      return undefined;
    }
    const cached = documents.get(absolutePath);
    if (cached) return cached;
    try {
      const loaded = await loadMarkdownTarget(rootReal, absolutePath);
      documents.set(absolutePath, loaded);
      documentHashes[loaded.relativePath] = sha256(loaded.bytes);
      return loaded;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (reason === "ENOENT" || reason === "ENOTDIR" || (error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
        brokenLinks.push({ from: source, destination: repoRelativePath, reason: "target_missing" });
      } else if (reason === "repository_escape") {
        brokenLinks.push({ from: source, destination: repoRelativePath, reason });
      } else {
        unavailable.push({ path: repoRelativePath, reason });
      }
      return undefined;
    }
  };

  for (const documentPath of inputs) await readDocument(documentPath, "documentRefs");

  for (const reference of parsedRefs) {
    const targetDocument = documents.get(path.resolve(rootReal, ...reference.target.path.split("/")));
    if (!targetDocument || !reference.target.anchor) continue;
    if (!markdownAnchors(targetDocument.text).has(reference.target.anchor)) {
      brokenLinks.push({ from: "documentRefs", destination: reference.value, reason: "anchor_missing" });
    }
  }

  for (const document of documents.values()) {
    const links = extractLinks(document.text, document.relativePath);
    linkCountByDocument[document.relativePath] = links.length;
    for (const link of links) {
      const target = splitDestination(link.destination);
      if (target.external) continue;
      const targetAbsolute = target.path ? path.resolve(path.dirname(document.absolutePath), target.path) : document.absolutePath;
      if (!inside(rootReal, targetAbsolute)) {
        brokenLinks.push({ ...link, reason: "repository_escape" });
        continue;
      }
      let targetReal: string;
      try { targetReal = await realpath(targetAbsolute); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") brokenLinks.push({ ...link, reason: "target_missing" });
        else unavailable.push({ path: link.destination, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (!inside(rootReal, targetReal)) {
        brokenLinks.push({ ...link, reason: "repository_escape" });
        continue;
      }
      let targetInfo;
      try { targetInfo = await stat(targetReal); }
      catch (error) {
        unavailable.push({ path: link.destination, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (!targetInfo.isFile() && !targetInfo.isDirectory()) {
        brokenLinks.push({ ...link, reason: "target_not_file" });
        continue;
      }
    if (target.anchor !== undefined) {
        if (!targetInfo.isFile() || !markdownPath(targetReal)) {
          unavailable.push({ path: link.destination, reason: "anchor_target_not_markdown" });
          continue;
        }
        const targetDocument = await readDocument(path.relative(rootReal, targetReal).split(path.sep).join("/"), link.from);
        if (!targetDocument) continue;
        const anchors = markdownAnchors(targetDocument.text);
        if (!anchors.has(target.anchor)) brokenLinks.push({ ...link, reason: "anchor_missing" });
      }
    }
  }

  const checkedDocuments = [...documents.values()].map((document) => document.relativePath).sort();
  const evidence = { checkedDocuments, documentHashes, linkCountByDocument, brokenLinks, unavailable };
  if (brokenLinks.length > 0) {
    return harnessResult("documents", "FAIL", "broken_document_reference", `${brokenLinks.length} relative document reference(s) are missing or invalid.`, startedAt, evidence);
  }
  if (unavailable.length > 0 || checkedDocuments.length === 0) {
    return harnessResult("documents", "NOT_EVALUATED", "document_reference_unavailable", "One or more document references could not be checked reliably.", startedAt, evidence);
  }
  return harnessResult("documents", "PASS", "documents_aligned", `Checked ${checkedDocuments.length} Markdown document(s) and their local links.`, startedAt, evidence);
}

export async function checkDocuments(
  repoRoot: string,
  ownedMarkdownPaths: readonly string[],
  documentRefs: readonly string[],
): Promise<HarnessCheckResult> {
  try { return await checkDocumentSet(repoRoot, ownedMarkdownPaths, documentRefs); }
  catch (error) {
    const startedAt = Date.now();
    return harnessResult("documents", "NOT_EVALUATED", "document_check_error", error instanceof Error ? error.message : String(error), startedAt, { checkedDocuments: [], brokenLinks: [] });
  }
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function changedCommandFailure(result: AociCommandResult): string | undefined {
  if (result.timedOut) return "timeout";
  if (result.interrupted) return "interrupted";
  if (result.outputTruncated) return "output_truncated";
  if (result.error) return "spawn_error";
  return undefined;
}

async function runOfficialAoci(
  repoRoot: string,
  args: readonly string[],
  options: OwnedAociOptions,
): Promise<AociCommandResult> {
  if (options.commandRunner) return options.commandRunner(args, repoRoot);
  return runProcess("aoci", [...args], { cwd: repoRoot, timeoutMs: options.timeoutMs ?? GOVERNANCE_TIMEOUT_MS });
}

function aociArgs(repoRoot: string, command: readonly string[]): string[] {
  return [...AOCI_ROOT_COMMAND_ARGS(repoRoot), ...command];
}

function toolUnavailableResult(startedAt: number, category: string, message: string, evidence: Record<string, unknown>): HarnessCheckResult {
  return harnessResult("owned-aoci", "NOT_EVALUATED", category, message, startedAt, {
    ownedAoci: { status: "NOT_EVALUATED", objects: [] },
    repositoryAoci: { status: "NOT_EVALUATED" },
    ...evidence,
  });
}

function uniquePaths(changes: readonly OwnedGovernanceChange[]): boolean {
  const seen = new Set<string>();
  for (const change of changes) {
    if (!validRepoRelativePath(change.path) || seen.has(change.path)) return false;
    seen.add(change.path);
  }
  return true;
}

function repositoryAociFacts(facts: z.infer<typeof GovernanceFactsSchema>): Record<string, unknown> {
  return {
    status: facts.governance_aligned ? "PASS" : "FAIL",
    governanceAligned: facts.governance_aligned,
    structureValid: facts.structure_valid,
    managedScopeAligned: facts.managed_scope.aligned,
    result: facts.result,
    drift: facts.code_drift,
    pendingTransactions: facts.pending_transactions,
    recoveryPending: facts.recovery_pending,
    thirdPartyConflict: facts.third_party_conflict,
    findings: facts.findings,
  };
}

function governanceSnapshot(facts: z.infer<typeof GovernanceFactsSchema>): string {
  return JSON.stringify({
    structureValid: facts.structure_valid,
    governanceAligned: facts.governance_aligned,
    compositeIdentity: facts.composite_identity,
    formalAssets: { root: facts.root, meta: facts.meta, code: facts.code, database: facts.database },
    managedScope: {
      aligned: facts.managed_scope.aligned,
      policyIdentity: facts.managed_scope.policy_identity,
      activePolicyIdentity: facts.managed_scope.active_policy_identity,
      scopeChangeRequired: facts.managed_scope.scope_change_required,
    },
    codeDrift: facts.code_drift,
    recoveryPending: facts.recovery_pending,
    thirdPartyConflict: facts.third_party_conflict,
    pendingTransactions: facts.pending_transactions,
    businessSourceSha256: facts.business_source_sha256,
    result: facts.result,
    findings: facts.findings,
  });
}

function hasDriftForPath(facts: z.infer<typeof GovernanceFactsSchema>, objectPath: string): string[] {
  return DRIFT_KEYS.filter((key) => facts.code_drift[key].includes(objectPath));
}

export async function checkOwnedAoci(
  repoRoot: string,
  ownedChanges: readonly OwnedGovernanceChange[],
  options: OwnedAociOptions = {},
): Promise<HarnessCheckResult> {
  const startedAt = Date.now();
  if (ownedChanges.length === 0) {
    return toolUnavailableResult(startedAt, "no_owned_changes", "No owned changes were selected for AOCI verification.", { ownedChanges: [] });
  }
  if (!uniquePaths(ownedChanges)) {
    return harnessResult("owned-aoci", "FAIL", "invalid_owned_changes", "Owned AOCI paths must be unique canonical repository-relative paths.", startedAt, {
      ownedAoci: { status: "FAIL", objects: [] },
      repositoryAoci: { status: "NOT_EVALUATED" },
      ownedChanges,
    });
  }

  const commandEvidence: Record<string, { exitCode: number; error?: string }> = {};
  let capabilityEvidence: z.infer<typeof AociCapabilitySchema> | undefined;
  let scopeEvidence: Array<z.infer<typeof ScopeEvaluationSchema>> = [];
  let sourceManifestEvidence: Record<string, unknown> | undefined;
  const governanceEvidence: Record<string, z.infer<typeof GovernanceFactsSchema>> = {};
  const officialEvidence = () => ({
    ...(capabilityEvidence ? { aociVersion: capabilityEvidence.aoci_version, capability: capabilityEvidence } : {}),
    scopeEvaluations: scopeEvidence,
    ...(sourceManifestEvidence ? { sourceManifest: sourceManifestEvidence } : {}),
    governanceCommands: governanceEvidence,
    commandEvidence: { ...commandEvidence },
  });
  const runJson = async (name: string, command: readonly string[], acceptsDriftExit = false): Promise<unknown> => {
    const result = await runOfficialAoci(repoRoot, aociArgs(repoRoot, command), options);
    const processError = changedCommandFailure(result);
    commandEvidence[name] = { exitCode: result.code, ...(processError ? { error: processError } : {}) };
    if (processError) throw new Error(`${name}:${processError}`);
    if (result.code !== 0 && !(acceptsDriftExit && result.code === 1)) throw new Error(`${name}:exit_${result.code}`);
    const parsed = parseJson(result.stdout);
    if (typeof parsed === "object" && parsed !== null && "exit_code" in parsed &&
        typeof parsed.exit_code === "number" && parsed.exit_code !== result.code) {
      throw new Error(`${name}:exit_code_mismatch`);
    }
    return parsed;
  };

  try {
    const capabilityValue = await runJson("capabilities", ["capabilities"]);
    const capability = AociCapabilitySchema.parse(capabilityValue);
    capabilityEvidence = capability;
    for (const change of ownedChanges) {
      const scopeValue = await runJson(`scope:${change.path}`, ["scope", "explain", change.path]);
      const scope = ScopeEvaluationSchema.parse(scopeValue);
      if (scope.path !== change.path) throw new Error(`scope_path_mismatch:${change.path}`);
      const scopeFactsMatchRole = scope.role === "index"
        ? scope.safety_status === "safe_inventory_allowed" && scope.reads_content && scope.enters_whole_index && !scope.enters_observe_fingerprint
        : scope.role === "observe"
          ? scope.reads_content && !scope.enters_whole_index && scope.enters_observe_fingerprint
          : !scope.enters_whole_index && !scope.enters_observe_fingerprint;
      if (!scopeFactsMatchRole) throw new Error(`scope_facts_inconsistent:${change.path}`);
      scopeEvidence.push(scope);
    }

    const manifestValue = await runJson("source-manifest", ["source", "manifest"]);
    const manifest = SourceManifestSchema.parse(manifestValue);
    const manifestPaths = new Map<string, z.infer<typeof SourceManifestSchema>["files"][number]>();
    for (const file of manifest.files) {
      if (!validRepoRelativePath(file.path) || manifestPaths.has(file.path)) throw new Error(`source_manifest_path_invalid_or_duplicate:${file.path}`);
      manifestPaths.set(file.path, file);
    }
    sourceManifestEvidence = {
      version: manifest.version,
      aggregateSha256: manifest.aggregate_sha256,
      ownedFiles: Object.fromEntries(ownedChanges.flatMap(({ path: ownedPath }) => {
        const file = manifestPaths.get(ownedPath);
        return file ? [[ownedPath, { sha256: file.sha256, sizeBytes: file.size_bytes }]] : [];
      })),
    };

    for (const [name, command] of [
      ["verify", ["verify"]],
      ["check", ["check"]],
      ["guide", ["index", "agent", "guide", "--agent", "harness"]],
    ] as const) {
      const raw = await runJson(name, command, true);
      const outer = z.object({ governance: GovernanceFactsSchema }).passthrough().parse(raw);
      governanceEvidence[name] = outer.governance;
    }

    const facts = Object.values(governanceEvidence);
    const snapshot = governanceSnapshot(facts[0]);
    if (facts.some((fact) => governanceSnapshot(fact) !== snapshot)) {
      return toolUnavailableResult(startedAt, "aoci_snapshot_changed", "Verify, Check, and Guide returned different governance facts; no single AOCI snapshot can be proven.", {
        official: officialEvidence(),
      });
    }
    if (facts[0].business_source_sha256 !== manifest.aggregate_sha256) {
      return toolUnavailableResult(startedAt, "aoci_source_manifest_changed", "The official source manifest and governance facts do not bind the same current source snapshot.", {
        official: officialEvidence(),
      });
    }
    if (!facts[0].structure_valid || !facts[0].managed_scope.aligned ||
        facts[0].managed_scope.policy_identity !== facts[0].managed_scope.active_policy_identity) {
      return toolUnavailableResult(startedAt, "aoci_scope_unreliable", "AOCI structure or managed scope is not reliable enough to prove owned objects.", {
        official: officialEvidence(),
        repositoryAoci: repositoryAociFacts(facts[0]),
      });
    }
    if (facts[0].recovery_pending || facts[0].pending_transactions > 0 || facts[0].third_party_conflict) {
      return toolUnavailableResult(startedAt, "aoci_recovery_pending", "AOCI reports a pending recovery, transaction, or third-party conflict.", {
        official: officialEvidence(),
        repositoryAoci: repositoryAociFacts(facts[0]),
      });
    }

    // Formal volumes are not business sources and must never require their own Entry.
    // Their canonical path/hash comes only from the matching official governance facts.
    const formalAssets = new Map<string, { domain: string; asset: z.infer<typeof FormalAssetSchema> }>();
    for (const domain of ["root", "meta", "code", "database"] as const) {
      const asset = facts[0][domain];
      if (!asset) continue;
      if (!validRepoRelativePath(asset.path) || formalAssets.has(asset.path) || manifestPaths.has(asset.path)) throw Error("aoci_formal_asset_identity_invalid");
      formalAssets.set(asset.path, { domain, asset });
    }
    const objects = await Promise.all(ownedChanges.map(async (change, index) => {
      const scope = scopeEvidence[index];
      const driftKinds = hasDriftForPath(facts[0], change.path);
      const formal = formalAssets.get(change.path);
      if (formal) {
        const evidence = { path: change.path, change: change.change, role: scope.role, entryRequired: false, formalAsset: formal.domain };
        if (change.change === "delete" || !formal.asset.enabled || !formal.asset.applicable || formal.asset.asset_state !== "present" || !formal.asset.sha256 || !facts[0].governance_aligned) {
          return { ...evidence, status: "FAIL", reason: "formal_asset_not_present_or_aligned" };
        }
        const assetPath = path.join(repoRoot, change.path);
        let currentSha256: string;
        try {
          // Do not follow an asset symlink outside the bound repository.
          if (await realpath(assetPath) !== assetPath) throw Error("formal_asset_symlink");
          currentSha256 = createHash("sha256").update(await readFile(assetPath)).digest("hex");
        } catch { return { ...evidence, status: "FAIL", reason: "formal_asset_unreadable" }; }
        return currentSha256 === formal.asset.sha256
          ? { ...evidence, status: "PASS", currentSha256, baselineEvidence: "official_verify_check_guide_formal_asset_identity" }
          : { ...evidence, status: "FAIL", currentSha256, reason: "formal_asset_sha256_mismatch" };
      }
      if (scope.role === "observe" || scope.role === "exclude") {
        if (driftKinds.length > 0) {
          return { path: change.path, change: change.change, role: scope.role, status: "NOT_EVALUATED", entryRequired: false, driftKinds, reason: "scope_drift_conflict" };
        }
        return { path: change.path, change: change.change, role: scope.role, status: "PASS", entryRequired: false, scopeVersion: scope.version };
      }

      const current = manifestPaths.get(change.path);
      if ((change.change === "delete" && current) || (change.change !== "delete" && !current)) {
        return {
          path: change.path,
          change: change.change,
          role: scope.role,
          status: "FAIL",
          entryRequired: true,
          ...(current ? { currentSha256: current.sha256 } : {}),
          reason: change.change === "delete" ? "deleted_path_still_in_source_manifest" : "owned_source_missing_from_manifest",
        };
      }
      if (driftKinds.length > 0) {
        return {
          path: change.path,
          change: change.change,
          role: scope.role,
          status: "FAIL",
          entryRequired: true,
          ...(current ? { currentSha256: current.sha256 } : {}),
          driftKinds,
          reason: "owned_path_not_at_exact_baseline",
        };
      }
      return {
        path: change.path,
        change: change.change,
        role: scope.role,
        status: "PASS",
        entryRequired: true,
        ...(current ? { currentSha256: current.sha256 } : {}),
        scopeVersion: scope.version,
        baselineEvidence: "official_verify_check_guide_no_drift_at_bound_source_snapshot",
      };
    }));

    const objectStatuses = objects.map((object) => object.status);
    const status: HarnessOutcome = objectStatuses.includes("FAIL") ? "FAIL" : objectStatuses.includes("NOT_EVALUATED") ? "NOT_EVALUATED" : "PASS";
    const category = status === "PASS" ? "owned_aoci_aligned" : status === "FAIL" ? "owned_aoci_drift" : "owned_aoci_unresolved";
    const message = status === "PASS"
      ? `All ${objects.length} owned AOCI disposition(s) match the official current snapshot.`
      : status === "FAIL"
        ? "One or more owned AOCI objects are missing, stale, unbaselined, orphaned, or differ from the declared source change."
        : "One or more owned AOCI objects could not be classified reliably.";
    return harnessResult("owned-aoci", status, category, message, startedAt, {
      ownedAoci: { status, objects },
      repositoryAoci: repositoryAociFacts(facts[0]),
      official: {
        aociVersion: capability.aoci_version,
        ...officialEvidence(),
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const unsupported = error instanceof z.ZodError || reason.includes("Invalid input") || reason.includes("invalid literal") || reason.includes("unrecognized_keys");
    const unavailable = Object.values(commandEvidence).some((item) => item.error === "spawn_error");
    const category = unavailable ? "aoci_tool_unavailable" : unsupported ? "aoci_schema_unsupported" : "aoci_evidence_unavailable";
    return toolUnavailableResult(startedAt, category, `AOCI evidence is not usable: ${reason}`, { official: officialEvidence() });
  }
}
