import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectChecks } from "../src/harness/routing.js";
import {
  HarnessPolicySchema,
  MEDIA_CHECK_IDS,
  aggregateOutcome,
  type HarnessPolicy,
  type HarnessCheckResult,
  type HarnessTaskScope,
} from "../src/harness/types.js";

type HarnessPolicyV2 = Extract<HarnessPolicy, { schemaVersion: 2 }>;

const media = {
  checks: MEDIA_CHECK_IDS.map((id) => ({ id, required: true })),
  commandTimeoutMs: 1_000,
  durationMinimumToleranceMs: 100,
  durationFramePeriods: 2,
  frameRateToleranceRatio: 0.001,
  audioDurationToleranceMs: 100,
  thumbnailWidth: 320,
};

function policy(overrides: Partial<{
  codeChecks: unknown[];
  controlChecks: unknown[];
  routes: unknown[];
}> = {}): HarnessPolicyV2 {
  return HarnessPolicySchema.parse({
    schemaVersion: 2,
    codeChecks: overrides.codeChecks ?? [
      { id: "typecheck", kind: "command", required: true, command: "node", args: ["scripts/typecheck.mjs"], timeoutMs: 10_000 },
      { id: "harness-tests", kind: "vitest", required: true, command: "node", args: ["node_modules/vitest/vitest.mjs", "run"], testFiles: ["tests/harness-scope.test.ts", "tests/harness-routing.test.ts"], timeoutMs: 20_000 },
    ],
    controlChecks: overrides.controlChecks ?? [
      { id: "policy-check", kind: "command", required: true, command: "node", args: ["scripts/policy-check.mjs"], timeoutMs: 5_000 },
    ],
    media,
    routes: overrides.routes ?? [
      { id: "source", paths: ["src/**"], checkIds: ["typecheck", "harness-tests"], documentRefs: ["docs/agent-contract-index.md#ownership"] },
      { id: "harness", paths: ["src/harness/**", "tests/harness-*.test.ts"], checkIds: ["harness-tests", "policy-check"], documentRefs: ["docs/video-validation-harness-spec.md#scope"] },
      { id: "test-suite", paths: ["tests/**/*.test.ts"], checkIds: ["harness-tests"], documentRefs: [] },
    ],
  }) as HarnessPolicyV2;
}

function scope(paths: string[]): HarnessTaskScope {
  return {
    schemaVersion: "harness-task-scope/v1",
    sessionId: "routing-fixture",
    baseCommit: "0123456789abcdef0123456789abcdef01234567",
    ownedChanges: paths.map((item) => ({ path: item, change: "modify", beforeSha256: `sha256:${"a".repeat(64)}`, afterSha256: `sha256:${"b".repeat(64)}` })),
  };
}

describe("harness policy routing", () => {
  it("requires the complete production suite and H3/H4/extended gates for Hybrid activation", () => {
    const policy = HarnessPolicySchema.parse(JSON.parse(readFileSync(new URL("../.agent/harness/policy.json", import.meta.url), "utf8")));
    if (policy.schemaVersion !== 2) throw Error("Expected policy v2");
    const selected = selectChecks(policy, scope(["src/main/hybrid-cover-production.ts", "tests/hybrid-cover-session.test.ts"]));
    expect(selected.checks.map(c => c.id)).toEqual(expect.arrayContaining(policy.defaultCheckIds ?? []));
    expect(selected.checks.map(c => c.id)).toEqual(expect.arrayContaining(["hybrid-activation", "hybrid-corner-h3", "extended-regressions", "documents", "owned-aoci"]));
    expect(selected.checks.every(c => c.required)).toBe(true);
  });
  it("keeps H4 QA development focused while preserving required H3 and extended integration checks", () => {
    const repositoryPolicy = HarnessPolicySchema.parse(JSON.parse(
      readFileSync(new URL("../.agent/harness/policy.json", import.meta.url), "utf8"),
    ));
    if (repositoryPolicy.schemaVersion !== 2) throw new Error("Expected policy v2");
    const selected = selectChecks(repositoryPolicy, scope(["src/main/shape-cover-vision-router.ts", "tests/shape-cover-hybrid-preview.test.ts"]));
    expect(selected.checks.map(c => c.id)).toEqual(expect.arrayContaining(["typecheck", "hybrid-vision", "hybrid-corner-h4", "hybrid-corner-h3-focused", "owned-aoci"]));
    expect(selected.checks.map(c => c.id)).not.toEqual(expect.arrayContaining(["extended-regressions"]));
    expect(selected.checks.map(c => c.id)).not.toContain("hybrid-corner-h3");
    expect(selected.checks.every(c => c.required)).toBe(true);
    expect(repositoryPolicy.codeChecks.find(c => c.id === "extended-regressions")?.required).toBe(true);
    expect(repositoryPolicy.codeChecks.find(c => c.id === "hybrid-corner-h3")).toMatchObject({ required: true,
      testFiles: expect.arrayContaining(["tests/shape-cover-hybrid-h3.integration.test.ts"]) });
    const h3 = selectChecks(repositoryPolicy, scope(["src/main/shape-cover-hybrid-h3.ts"]));
    expect(h3.checks.map(c => c.id)).toContain("hybrid-corner-h3");
  });
  it("does not treat a result set with no required checks as passing", () => {
    expect(aggregateOutcome([])).toBe("NOT_EVALUATED");
    expect(aggregateOutcome([{ id: "optional", required: false, status: "PASS", message: "optional only" }])).toBe("NOT_EVALUATED");
  });

  it("fails closed on missing or unknown runtime statuses while preserving known required failures", () => {
    const unknownStatus = [{ id: "required", required: true, status: "SKIPPED", message: "unknown" }] as unknown as HarnessCheckResult[];
    const missingStatus = [{ id: "required", required: true, message: "missing" }] as unknown as HarnessCheckResult[];
    expect(aggregateOutcome(unknownStatus)).toBe("NOT_EVALUATED");
    expect(aggregateOutcome(missingStatus)).toBe("NOT_EVALUATED");

    const failureWithMalformedSibling = [
      { id: "failed", required: true, status: "FAIL", message: "failure" },
      { id: "unknown", required: true, status: "SKIPPED", message: "unknown" },
    ] as unknown as HarnessCheckResult[];
    expect(aggregateOutcome(failureWithMalformedSibling)).toBe("FAIL");
  });

  it("keeps v1 policies readable while validating v2 control checks and routes", () => {
    const v1 = HarnessPolicySchema.parse({
      schemaVersion: 1,
      codeChecks: [{ id: "old-check", kind: "command", required: true, command: "node", args: ["-e", "process.exit(0)"], timeoutMs: 1_000 }],
      media,
    });
    expect(v1.schemaVersion).toBe(1);
    expect(policy().schemaVersion).toBe(2);
  });

  it("keeps core default checks explicit without running every registered domain experiment", () => {
    const candidate = { ...policy(), defaultCheckIds: ["typecheck"] };
    expect(HarnessPolicySchema.safeParse(candidate).success).toBe(true);
    for (const defaults of [[], ["missing"], ["typecheck", "typecheck"], ["policy-check"]]) {
      expect(HarnessPolicySchema.safeParse({ ...candidate, defaultCheckIds: defaults }).success).toBe(false);
    }
  });

  it("selects the union of matching checks once and deduplicates refs and route IDs", () => {
    const selected = selectChecks(policy(), scope(["src/harness/types.ts", "tests/harness-scope.test.ts"]));
    expect(selected.checks.map((check) => check.id)).toEqual(["typecheck", "harness-tests", "policy-check"]);
    expect(selected.documentRefs).toEqual([
      "docs/agent-contract-index.md#ownership",
      "docs/video-validation-harness-spec.md#scope",
    ]);
    expect(selected.routeIds).toEqual(["source", "harness", "test-suite"]);
  });

  it("deduplicates repeated check references inside a route", () => {
    const withDuplicateReference = policy({ routes: [
      { id: "source", paths: ["src/**"], checkIds: ["typecheck", "harness-tests", "typecheck"], documentRefs: [] },
    ] });
    const selected = selectChecks(withDuplicateReference, scope(["src/harness/types.ts"]));
    expect(selected.checks.map((check) => check.id)).toEqual(["typecheck", "harness-tests"]);
  });

  it("routes new, deleted, and renamed test paths and requires each changed test to execute", () => {
    const routes = [
      { id: "changed-tests", paths: ["tests/**"], checkIds: ["tests"], documentRefs: [] },
    ];
    const withTests = policy({
      codeChecks: [{ id: "tests", kind: "vitest", required: true, command: "node", args: ["vitest"], testFiles: ["tests/new test.test.ts", "tests/old-日本語.test.ts"], timeoutMs: 1_000 }],
      controlChecks: [],
      routes,
    });
    const selected = selectChecks(withTests, scope(["tests/new test.test.ts", "tests/old-日本語.test.ts"]));
    expect(selected.checks.map((check) => check.id)).toEqual(["tests"]);

    const missingSelf = policy({
      codeChecks: [{ id: "tests", kind: "vitest", required: true, command: "node", args: ["vitest"], testFiles: ["tests/another.test.ts"], timeoutMs: 1_000 }],
      controlChecks: [],
      routes,
    });
    expect(() => selectChecks(missingSelf, scope(["tests/new test.test.ts"]))).toThrow(/changed test.*executed|test.*selected/i);
  });

  it("rejects unmapped changes instead of returning a partial check set", () => {
    expect(() => selectChecks(policy(), scope(["unknown/new.ts"]))).toThrow(/unmapped/i);
    expect(() => selectChecks(policy(), scope(["docs/unreferenced.md"]))).toThrow(/unmapped/i);
  });

  it("rejects selected optional checks and a structurally empty selection", () => {
    const optionalPolicy = policy({
      codeChecks: [{ id: "optional", kind: "command", required: false, command: "node", args: [], timeoutMs: 1_000 }],
      controlChecks: [],
      routes: [{ id: "source", paths: ["src/**"], checkIds: ["optional"], documentRefs: [] }],
    });
    expect(() => selectChecks(optionalPolicy, scope(["src/file.ts"]))).toThrow(/required/i);

    const emptySelection = {
      ...policy(),
      routes: [{ id: "source", paths: ["src/**"], checkIds: [], documentRefs: [] }],
    } as unknown as HarnessPolicy;
    expect(() => selectChecks(emptySelection, scope(["src/file.ts"]))).toThrow(/empty|check/i);
  });

  it("validates unique IDs, route references, canonical paths, and document refs", () => {
    const valid = policy();
    const unknownCheck = { ...valid, routes: [{ id: "x", paths: ["src/**"], checkIds: ["missing"], documentRefs: [] }] };
    expect(HarnessPolicySchema.safeParse(unknownCheck).success).toBe(false);

    const duplicateRoute = { ...valid, routes: [...valid.routes, valid.routes[0]] };
    expect(HarnessPolicySchema.safeParse(duplicateRoute).success).toBe(false);

    for (const invalidPath of ["../outside", "/src/main.ts", "src/../secret", "src\\main.ts", "src//main.ts"]) {
      const invalid = { ...valid, routes: [{ id: "x", paths: [invalidPath], checkIds: ["typecheck"], documentRefs: [] }] };
      expect(HarnessPolicySchema.safeParse(invalid).success, invalidPath).toBe(false);
    }
    const invalidReference = { ...valid, routes: [{ id: "x", paths: ["src/**"], checkIds: ["typecheck"], documentRefs: ["../outside.md"] }] };
    expect(HarnessPolicySchema.safeParse(invalidReference).success).toBe(false);
  });

  it("routes documentation-only changes through policy controls", () => {
    const repositoryPolicy = HarnessPolicySchema.parse(JSON.parse(
      readFileSync(new URL("../.agent/harness/policy.json", import.meta.url), "utf8"),
    ));
    expect(repositoryPolicy.schemaVersion).toBe(2);
    if (repositoryPolicy.schemaVersion !== 2) throw new Error("Expected policy v2");

    for (const file of ["docs/agent-contract-index.md", "docs/shape-matched-cover-hybrid-activation-record.md"]) {
      const selected = selectChecks(repositoryPolicy, scope([file]));
      expect(selected.routeIds).toEqual(["docs-and-rules"]);
      expect(selected.checks.map((check) => check.id)).toEqual(["documents", "owned-aoci"]);
    }
  });

  it("routes representative local-random, shape, and credential tests to their own checks", () => {
    const repositoryPolicy = HarnessPolicySchema.parse(JSON.parse(
      readFileSync(new URL("../.agent/harness/policy.json", import.meta.url), "utf8"),
    ));
    if (repositoryPolicy.schemaVersion !== 2) throw new Error("Expected policy v2");

    const cases = [
      ["tests/local-random-cover.test.ts", "local-random"],
      ["tests/source-mask-admission.test.ts", "shape-boundaries"],
      ["tests/connection-store.test.ts", "credential-boundaries"],
    ] as const;
    for (const [file, expectedCheck] of cases) {
      const selected = selectChecks(repositoryPolicy, scope([file]));
      expect(selected.checks.map((check) => check.id), file).toContain(expectedCheck);
      expect(selected.checks.some((check) => check.kind === "vitest" && check.testFiles.includes(file)), file).toBe(true);
    }
  });

  it("maps every exact test file in the repository policy to a check that executes itself", () => {
    const repositoryPolicy = HarnessPolicySchema.parse(JSON.parse(
      readFileSync(new URL("../.agent/harness/policy.json", import.meta.url), "utf8"),
    ));
    if (repositoryPolicy.schemaVersion !== 2) throw new Error("Expected policy v2");

    const testFiles = repositoryPolicy.codeChecks
      .filter((check): check is Extract<typeof check, { kind: "vitest" }> => check.kind === "vitest")
      .flatMap((check) => check.testFiles);
    for (const file of testFiles) {
      const selected = selectChecks(repositoryPolicy, scope([file]));
      expect(selected.checks.some((check) => check.kind === "vitest" && check.testFiles.includes(file)), file).toBe(true);
    }
  });
});
