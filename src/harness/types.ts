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
  testFiles: z.array(z.string().regex(/^tests\/[a-zA-Z0-9._/-]+\.test\.ts$/)).min(1),
  timeoutMs: z.number().int().positive().max(30 * 60_000),
}).strict();

export const CodeCheckSchema = z.discriminatedUnion("kind", [CommandCheckSchema, VitestCheckSchema]);
export type CodeCheckPolicy = z.infer<typeof CodeCheckSchema>;

export const MEDIA_CHECK_IDS = [
  "membership", "source-identity", "decode", "output-spec", "duration",
  "frame-rate", "audio", "template-text", "visual-evidence",
] as const;

const MediaCheckSchema = z.object({
  id: z.enum(MEDIA_CHECK_IDS),
  required: z.boolean(),
}).strict();

export const HarnessPolicySchema = z.object({
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
}).strict().superRefine((policy, context) => {
  const codeIds = new Set<string>();
  const testFiles = new Set<string>();
  for (const [index, check] of policy.codeChecks.entries()) {
    if (codeIds.has(check.id)) context.addIssue({ code: "custom", path: ["codeChecks", index, "id"], message: "duplicate code check id" });
    codeIds.add(check.id);
    if (check.kind === "vitest") {
      for (const file of check.testFiles) {
        if (testFiles.has(file)) context.addIssue({ code: "custom", path: ["codeChecks", index, "testFiles"], message: `duplicate test file: ${file}` });
        testFiles.add(file);
      }
    }
  }
  const mediaIds = new Set<string>();
  for (const [index, check] of policy.media.checks.entries()) {
    if (mediaIds.has(check.id)) context.addIssue({ code: "custom", path: ["media", "checks", index, "id"], message: "duplicate media check id" });
    mediaIds.add(check.id);
  }
  for (const id of MEDIA_CHECK_IDS) {
    if (!mediaIds.has(id)) context.addIssue({ code: "custom", path: ["media", "checks"], message: `missing media check: ${id}` });
  }
});
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
  const required = checks.filter((check) => check.required);
  if (required.some((check) => check.status === "FAIL")) return "FAIL";
  if (required.some((check) => check.status === "NOT_EVALUATED")) return "NOT_EVALUATED";
  return "PASS";
}

export function exitCodeFor(outcome: HarnessOutcome): 0 | 1 | 2 {
  return outcome === "PASS" ? 0 : outcome === "FAIL" ? 1 : 2;
}
