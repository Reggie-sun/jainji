import { z } from "zod";

export const HarnessOutcomeSchema = z.enum(["PASS", "FAIL", "NOT_EVALUATED"]);
export type HarnessOutcome = z.infer<typeof HarnessOutcomeSchema>;

const CommandCheckSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  kind: z.literal("command"),
  required: z.boolean(),
  command: z.literal("node"),
  args: z.array(z.string()),
  timeoutMs: z.number().int().positive().max(30 * 60_000),
}).strict();

const VitestCheckSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  kind: z.literal("vitest"),
  required: z.boolean(),
  command: z.literal("node"),
  args: z.array(z.string()),
  testFiles: z.array(z.string().refine((value) => /^tests\/.+\.test\.ts$/.test(value) && isCanonicalRelativePath(value, false), "test file must be a normalized tests-relative path")).min(1),
  timeoutMs: z.number().int().positive().max(30 * 60_000),
}).strict();

export const CodeCheckSchema = z.discriminatedUnion("kind", [CommandCheckSchema, VitestCheckSchema]);
export type CodeCheckPolicy = z.infer<typeof CodeCheckSchema>;
export type ControlCheckPolicy = z.infer<typeof CommandCheckSchema>;

export const MEDIA_CHECK_IDS = [
  "membership", "source-identity", "decode", "output-spec", "duration",
  "frame-rate", "audio", "template-text", "visual-evidence",
] as const;

const MediaCheckSchema = z.object({
  id: z.enum(MEDIA_CHECK_IDS),
  required: z.boolean(),
}).strict();

function isCanonicalRelativePath(value: string, allowGlob: boolean): boolean {
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return false;
  if (!allowGlob && value.includes("*")) return false;
  return segments.every((segment) => {
    if (!allowGlob) return true;
    return !segment.includes("**") || segment === "**";
  });
}

const RoutePathSchema = z.string().min(1).refine((value) => isCanonicalRelativePath(value, true), "route path must be a normalized repository-relative path pattern");
const DocumentReferenceSchema = z.string().min(1).refine((value) => {
  const separator = value.indexOf("#");
  const filePath = separator < 0 ? value : value.slice(0, separator);
  const anchor = separator < 0 ? undefined : value.slice(separator + 1);
  return isCanonicalRelativePath(filePath, false) && (anchor === undefined || (anchor.length > 0 && !anchor.includes("#") && !anchor.includes("\0")));
}, "document reference must be a normalized repository-relative file path with an optional anchor");

const ScopeHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const OwnedChangeSchema = z.object({
  path: z.string().min(1).refine((value) => isCanonicalRelativePath(value, false), "owned path must be normalized and repository-relative"),
  change: z.enum(["add", "modify", "delete"]),
  beforeSha256: ScopeHashSchema.nullable(),
  afterSha256: ScopeHashSchema.nullable(),
}).strict().superRefine((change, context) => {
  const compatible = change.change === "add"
    ? change.beforeSha256 === null && change.afterSha256 !== null
    : change.change === "delete"
      ? change.beforeSha256 !== null && change.afterSha256 === null
      : change.beforeSha256 !== null && change.afterSha256 !== null;
  if (!compatible) context.addIssue({ code: "custom", path: ["change"], message: "change type does not match its before and after SHA-256 values" });
});

export const HarnessTaskScopeSchema = z.object({
  schemaVersion: z.literal("harness-task-scope/v1"),
  sessionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  baseCommit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  ownedChanges: z.array(OwnedChangeSchema).min(1),
}).strict().superRefine((scope, context) => {
  const paths = new Set<string>();
  for (const [index, change] of scope.ownedChanges.entries()) {
    if (paths.has(change.path)) context.addIssue({ code: "custom", path: ["ownedChanges", index, "path"], message: `duplicate owned path: ${change.path}` });
    paths.add(change.path);
  }
});
export type HarnessTaskScope = z.infer<typeof HarnessTaskScopeSchema>;

const RouteSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  tier: z.enum(["baseline", "domain", "fallback"]).optional(),
  paths: z.array(RoutePathSchema).min(1),
  checkIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)).min(1),
  testFilesByCheck: z.record(z.array(z.string()).min(1)).optional(),
  documentRefs: z.array(DocumentReferenceSchema),
}).strict();
export type HarnessPolicyRoute = z.infer<typeof RouteSchema>;

const HarnessPolicyV1BaseSchema = z.object({
  schemaVersion: z.literal(1),
  codeChecks: z.array(CodeCheckSchema).min(1),
  media: z.object({
    checks: z.array(MediaCheckSchema).min(1),
    commandTimeoutMs: z.number().int().positive().max(30 * 60_000),
    durationMinimumToleranceMs: z.number().finite().nonnegative(),
    durationFramePeriods: z.number().finite().nonnegative(),
    frameRateToleranceRatio: z.number().finite().nonnegative().max(0.1),
    audioDurationToleranceMs: z.number().finite().nonnegative(),
    thumbnailWidth: z.number().int().positive().max(1920),
  }).strict(),
}).strict();

const HarnessPolicyV2BaseSchema = z.object({
  schemaVersion: z.literal(2),
  codeChecks: z.array(CodeCheckSchema).min(1),
  defaultCheckIds: z.array(z.string()).min(1).optional(),
  controlChecks: z.array(CommandCheckSchema),
  media: HarnessPolicyV1BaseSchema.shape.media,
  routes: z.array(RouteSchema).min(1),
}).strict();

function validateMediaChecks(policy: { media: z.infer<typeof HarnessPolicyV1BaseSchema.shape.media> }, context: z.RefinementCtx): void {
  const mediaIds = new Set<string>();
  for (const [index, check] of policy.media.checks.entries()) {
    if (mediaIds.has(check.id)) context.addIssue({ code: "custom", path: ["media", "checks", index, "id"], message: "duplicate media check id" });
    mediaIds.add(check.id);
  }
  for (const id of MEDIA_CHECK_IDS) {
    if (!mediaIds.has(id)) context.addIssue({ code: "custom", path: ["media", "checks"], message: `missing media check: ${id}` });
  }
}

function validateCodeChecks(checks: readonly CodeCheckPolicy[], context: z.RefinementCtx, path: (string | number)[]): Set<string> {
  const codeIds = new Set<string>();
  const testFiles = new Set<string>();
  for (const [index, check] of checks.entries()) {
    if (codeIds.has(check.id)) context.addIssue({ code: "custom", path: [...path, index, "id"], message: "duplicate code check id" });
    codeIds.add(check.id);
    if (check.kind === "vitest") {
      for (const file of check.testFiles) {
        if (testFiles.has(file)) context.addIssue({ code: "custom", path: [...path, index, "testFiles"], message: `duplicate test file: ${file}` });
        testFiles.add(file);
      }
    }
  }
  return codeIds;
}

export const HarnessPolicyV1Schema = HarnessPolicyV1BaseSchema.superRefine((policy, context) => {
  validateCodeChecks(policy.codeChecks, context, ["codeChecks"]);
  validateMediaChecks(policy, context);
});

export const HarnessPolicyV2Schema = HarnessPolicyV2BaseSchema.superRefine((policy, context) => {
  const codeIds = validateCodeChecks(policy.codeChecks, context, ["codeChecks"]);
  if (policy.defaultCheckIds) {
    if (new Set(policy.defaultCheckIds).size !== policy.defaultCheckIds.length) {
      context.addIssue({ code: "custom", path: ["defaultCheckIds"], message: "duplicate default check id" });
    }
    for (const id of policy.defaultCheckIds) {
      if (!policy.codeChecks.some((check) => check.id === id && check.required)) {
        context.addIssue({ code: "custom", path: ["defaultCheckIds"], message: `default must reference a required code check: ${id}` });
      }
    }
  }
  const controlIds = new Set<string>();
  for (const [index, check] of policy.controlChecks.entries()) {
    if (codeIds.has(check.id) || controlIds.has(check.id)) {
      context.addIssue({ code: "custom", path: ["controlChecks", index, "id"], message: "duplicate code or control check id" });
    }
    controlIds.add(check.id);
  }
  validateMediaChecks(policy, context);

  const routeIds = new Set<string>();
  const knownCheckIds = new Set([...codeIds, ...controlIds]);
  for (const [index, route] of policy.routes.entries()) {
    if (routeIds.has(route.id)) context.addIssue({ code: "custom", path: ["routes", index, "id"], message: "duplicate route id" });
    routeIds.add(route.id);
    if (new Set(route.paths).size !== route.paths.length) context.addIssue({ code: "custom", path: ["routes", index, "paths"], message: "duplicate route path pattern" });
    if (new Set(route.documentRefs).size !== route.documentRefs.length) context.addIssue({ code: "custom", path: ["routes", index, "documentRefs"], message: "duplicate document reference" });
    for (const [checkIndex, checkId] of route.checkIds.entries()) {
      if (!knownCheckIds.has(checkId)) context.addIssue({ code: "custom", path: ["routes", index, "checkIds", checkIndex], message: `unknown route check id: ${checkId}` });
    }
    for (const [checkId, files] of Object.entries(route.testFilesByCheck ?? {})) {
      const check = policy.codeChecks.find((candidate) => candidate.id === checkId);
      if (!route.checkIds.includes(checkId) || check?.kind !== "vitest" ||
        new Set(files).size !== files.length || files.some((file) => !check.testFiles.includes(file))) {
        context.addIssue({ code: "custom", path: ["routes", index, "testFilesByCheck", checkId], message: "subset must contain unique registered files of a Vitest check selected by this route" });
      }
    }
  }
});

export const HarnessPolicySchema = z.union([HarnessPolicyV1Schema, HarnessPolicyV2Schema]);
export type HarnessPolicy = z.infer<typeof HarnessPolicySchema>;

export interface HarnessCheckResult {
  id: string;
  required: boolean;
  status: HarnessOutcome;
  category?: string;
  message: string;
  durationMs?: number;
  command?: { executable: string; args: string[] };
  evidence?: Record<string, unknown>;
}

export function aggregateOutcome(checks: readonly HarnessCheckResult[]): HarnessOutcome {
  if (!Array.isArray(checks)) return "NOT_EVALUATED";
  // A known required failure remains decisive even if another receipt entry is
  // malformed. Unknown or missing statuses can never turn into a pass.
  if (checks.some((check) => check && typeof check === "object" && check.required === true && check.status === "FAIL")) return "FAIL";
  if (checks.some((check) => !check || typeof check !== "object" || typeof check.required !== "boolean" || !HarnessOutcomeSchema.safeParse(check.status).success)) return "NOT_EVALUATED";
  const required = checks.filter((check) => check.required);
  if (required.length === 0) return "NOT_EVALUATED";
  if (required.some((check) => check.status === "NOT_EVALUATED")) return "NOT_EVALUATED";
  return "PASS";
}

export function exitCodeFor(outcome: HarnessOutcome): 0 | 1 | 2 {
  return outcome === "PASS" ? 0 : outcome === "FAIL" ? 1 : 2;
}
