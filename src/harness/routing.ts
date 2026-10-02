import {
  HarnessPolicySchema,
  HarnessTaskScopeSchema,
  type CodeCheckPolicy,
  type HarnessPolicy,
  type HarnessPolicyRoute,
  type HarnessTaskScope,
} from "./types.js";

export interface SelectedChecks {
  checks: CodeCheckPolicy[];
  documentRefs: string[];
  routeIds: string[];
}

function segmentMatches(pattern: string, value: string): boolean {
  const expression = pattern.split("*").map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")).join("[^/]*");
  return new RegExp(`^${expression}$`).test(value);
}

function matchesPath(pattern: string, target: string): boolean {
  const patternSegments = pattern.split("/");
  const targetSegments = target.split("/");
  const matchFrom = (patternIndex: number, targetIndex: number): boolean => {
    if (patternIndex === patternSegments.length) return targetIndex === targetSegments.length;
    const segment = patternSegments[patternIndex];
    if (segment === "**") {
      if (patternIndex === patternSegments.length - 1) return true;
      for (let next = targetIndex; next <= targetSegments.length; next += 1) {
        if (matchFrom(patternIndex + 1, next)) return true;
      }
      return false;
    }
    if (targetIndex >= targetSegments.length || !segmentMatches(segment, targetSegments[targetIndex])) return false;
    return matchFrom(patternIndex + 1, targetIndex + 1);
  };
  return matchFrom(0, 0);
}

function matchingRoutes(routes: readonly HarnessPolicyRoute[], repoPath: string): HarnessPolicyRoute[] {
  return routes.filter((route) => route.paths.some((pattern) => matchesPath(pattern, repoPath)));
}

export function selectChecks(policy: HarnessPolicy, scope: HarnessTaskScope): SelectedChecks {
  const parsedPolicy = HarnessPolicySchema.parse(policy);
  const parsedScope = HarnessTaskScopeSchema.parse(scope);
  if (parsedPolicy.schemaVersion !== 2) throw new Error("Scoped check routing requires harness policy schemaVersion 2.");

  const selectedRouteIds = new Set<string>();
  const selectedCheckIds = new Set<string>();
  const selectedDocumentRefs = new Set<string>();

  for (const change of parsedScope.ownedChanges) {
    const matches = matchingRoutes(parsedPolicy.routes, change.path);
    if (matches.length === 0) throw new Error(`Unmapped owned path: ${change.path}`);
    for (const route of matches) {
      selectedRouteIds.add(route.id);
      for (const checkId of route.checkIds) selectedCheckIds.add(checkId);
      for (const documentRef of route.documentRefs) selectedDocumentRefs.add(documentRef);
    }
  }

  const checks = [
    ...parsedPolicy.codeChecks,
    ...parsedPolicy.controlChecks,
  ].filter((check) => selectedCheckIds.has(check.id));
  if (checks.length === 0) throw new Error("Selected route set is empty; no executable checks cover this scope.");
  const optionalChecks = checks.filter((check) => !check.required).map((check) => check.id);
  if (optionalChecks.length > 0) throw new Error(`Selected checks must be required: ${optionalChecks.join(", ")}`);

  for (const change of parsedScope.ownedChanges) {
    if (!/^tests\/.+\.test\.ts$/.test(change.path)) continue;
    const selectedVitest = checks.filter((check): check is Extract<CodeCheckPolicy, { kind: "vitest" }> => check.kind === "vitest");
    if (selectedVitest.length === 0) throw new Error(`Changed test has no selected Vitest check: ${change.path}`);
    if (change.change !== "delete" && !selectedVitest.some((check) => check.testFiles.includes(change.path))) {
      throw new Error(`Changed test is not included in a selected Vitest check: ${change.path}`);
    }
  }

  return {
    checks,
    routeIds: parsedPolicy.routes.filter((route) => selectedRouteIds.has(route.id)).map((route) => route.id),
    documentRefs: [...selectedDocumentRefs].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
  };
}
