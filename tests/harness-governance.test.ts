import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkDocuments, checkOwnedAoci, type AociCommandResult, type OwnedGovernanceChange } from "../src/harness/governance.js";

const temporaryRoots: string[] = [];
const hash = (digit: string) => digit.repeat(64);

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-harness-governance-"));
  temporaryRoots.push(root);
  return root;
}

interface FixtureOptions {
  roles?: Record<string, "index" | "observe" | "exclude">;
  sourcePaths?: string[];
  drift?: Partial<Record<"missing" | "stale" | "unbaselined" | "orphan" | "line_ending_only", string[]>>;
  unrelatedDrift?: string[];
  recoveryPending?: boolean;
  thirdPartyConflict?: boolean;
  pendingTransactions?: number;
  governanceAligned?: boolean;
  mutateCommand?: (command: string[], result: AociCommandResult) => AociCommandResult;
}

function aociFixture(options: FixtureOptions = {}) {
  const calls: string[][] = [];
  const sourcePaths = options.sourcePaths ?? ["src/harness/governance.ts"];
  const repositoryDrift = options.unrelatedDrift ?? [];
  const drift = {
    missing: options.drift?.missing ?? [],
    stale: options.drift?.stale ?? repositoryDrift,
    unbaselined: options.drift?.unbaselined ?? [],
    orphan: options.drift?.orphan ?? [],
    line_ending_only: options.drift?.line_ending_only ?? [],
  };
  const baseGovernance = {
    version: "volumes-governance-facts/v1",
    layout: "volumes-v1",
    structure_valid: true,
    governance_aligned: options.governanceAligned ?? Object.values(drift).every((items) => items.length === 0),
    composite_identity: hash("1"),
    managed_scope: { aligned: true, scope_change_required: false, policy_identity: hash("2"), active_policy_identity: hash("2") },
    code_drift: drift,
    pending_transactions: options.pendingTransactions ?? 0,
    recovery_pending: options.recoveryPending ?? false,
    third_party_conflict: options.thirdPartyConflict ?? false,
    business_source_sha256: hash("3"),
    result: "complete",
    findings: [],
  };
  const runner = async (args: readonly string[]): Promise<AociCommandResult> => {
    const command = [...args.slice(3)];
    calls.push(command);
    let json: unknown;
    if (command[0] === "capabilities") {
      json = { version: "aoci-capability-manifest/v1", aoci_version: "0.1.0-rc14", current_layout: "volumes-v1" };
    } else if (command[0] === "source" && command[1] === "manifest") {
      json = {
        version: "business-source-manifest/v1",
        files: sourcePaths.map((filePath) => ({ path: filePath, sha256: hash("a"), size_bytes: 8 })),
        aggregate_sha256: hash("3"),
      };
    } else if (command[0] === "scope" && command[1] === "explain") {
      const filePath = command[2] ?? "";
      const role = options.roles?.[filePath] ?? "index";
      json = {
        version: "managed-scope-evaluation/v2",
        path: filePath,
        role,
        safety_status: role === "exclude" ? "sensitive" : "safe_inventory_allowed",
        reads_content: role !== "exclude",
        enters_whole_index: role === "index",
        enters_observe_fingerprint: role === "observe",
        reason: "fixture scope rule",
      };
    } else if (["verify", "check"].includes(command[0] ?? "") || command[0] === "index") {
      json = { governance: baseGovernance, ok: baseGovernance.governance_aligned, exit_code: baseGovernance.governance_aligned ? 0 : 1 };
    } else {
      throw new Error(`Unexpected AOCI command: ${command.join(" ")}`);
    }
    const output = JSON.stringify(json);
    const code = ["verify", "check", "index"].includes(command[0] ?? "") && !baseGovernance.governance_aligned ? 1 : 0;
    return options.mutateCommand?.(command, { code, stdout: output, stderr: "" }) ?? {
      code,
      stdout: output,
      stderr: "",
    };
  };
  return { runner, calls };
}

describe("harness document governance", () => {
  it("checks relative file links, anchors, and document references without fetching external URLs", async () => {
    const root = await temporaryRoot();
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs/owned.md"), [
      "# Owned",
      "",
      "See [the target](./target.md#new-target), [self](#owned), and [web](https://example.com/remote#anything).",
      "See the [reference target][target].",
      "[target]: <./target.md#new-target>",
      "",
      "```md",
      "[not a real link](./missing.md)",
      "```",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "docs/target.md"), "# New Target\n");

    const result = await checkDocuments(root, ["docs/owned.md"], ["docs/target.md#new-target"]);

    expect(result).toMatchObject({ id: "documents", required: true, status: "PASS" });
    expect(result.evidence).toMatchObject({ checkedDocuments: ["docs/owned.md", "docs/target.md"] });
  });

  it("preserves each space in heading anchors after removing punctuation", async () => {
    const root = await temporaryRoot();
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs/guide.md"), "## R02 — Task Scope Is A Declaration, Not Attribution Proof\n");

    const result = await checkDocuments(root, [], [
      "docs/guide.md#r02--task-scope-is-a-declaration-not-attribution-proof",
    ]);

    expect(result).toMatchObject({ status: "PASS" });
  });

  it("validates anchors supplied by document references", async () => {
    const root = await temporaryRoot();
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs/guide.md"), "# Existing Section\n");

    const result = await checkDocuments(root, [], ["docs/guide.md#missing-section"]);

    expect(result).toMatchObject({ status: "FAIL", category: "broken_document_reference" });
    expect(result.evidence?.brokenLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "documentRefs", destination: "docs/guide.md#missing-section", reason: "anchor_missing" }),
    ]));
  });

  it("fails on missing relative targets, missing anchors, and repository escapes", async () => {
    const root = await temporaryRoot();
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs/owned.md"), [
      "# Owned",
      "[missing file](./missing.md)",
      "[missing anchor](./owned.md#nowhere)",
      "[outside](../../../outside.md)",
      "",
    ].join("\n"));

    const result = await checkDocuments(root, ["docs/owned.md"], []);

    expect(result).toMatchObject({ id: "documents", status: "FAIL", category: "broken_document_reference" });
    expect(result.evidence).toMatchObject({ brokenLinks: expect.arrayContaining([
      expect.objectContaining({ destination: "./missing.md", reason: "target_missing" }),
      expect.objectContaining({ destination: "./owned.md#nowhere", reason: "anchor_missing" }),
      expect.objectContaining({ destination: "../../../outside.md", reason: "repository_escape" }),
    ]) });
  });

  it("does not pass when no document evidence is selected", async () => {
    const result = await checkDocuments(await temporaryRoot(), [], []);
    expect(result).toMatchObject({ status: "NOT_EVALUATED", category: "no_documents_selected" });
  });
});

describe("harness owned AOCI governance", () => {
  it.each([false, true])("binds a formal code volume to official bytes without requiring a self Entry (corrupt=%s)", async corrupt => {
    const root = await temporaryRoot(), bytes = "#AOCI-CODE-VOLUME: 1\n";
    await writeFile(path.join(root, "aoci.code.txt"), corrupt ? "changed" : bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { runner } = aociFixture({ sourcePaths: [], mutateCommand(command, result) {
      if (!["verify", "check", "index"].includes(command[0])) return result;
      const raw = JSON.parse(result.stdout);
      raw.governance.code = { enabled: true, path: "aoci.code.txt", asset_state: "present", sha256 };
      return { ...result, stdout: JSON.stringify(raw) };
    } });
    const result = await checkOwnedAoci(root, [{ path: "aoci.code.txt", change: "modify" }], { commandRunner: runner });
    expect(result.status).toBe(corrupt ? "FAIL" : "PASS");
    expect(result.evidence?.ownedAoci).toMatchObject({ objects: [{ path: "aoci.code.txt", entryRequired: false, artifactRequired: true }] });
  });
  it("rejects conflicting volume hashes across the three official commands", async () => {
    const root = await temporaryRoot();
    await writeFile(path.join(root, "aoci.code.txt"), "index");
    const { runner } = aociFixture({ sourcePaths: [], mutateCommand(command, result) {
      if (!["verify", "check", "index"].includes(command[0])) return result;
      const raw = JSON.parse(result.stdout);
      raw.governance.code = { enabled: true, path: "aoci.code.txt", asset_state: "present", sha256: hash(command[0] === "check" ? "b" : "a") };
      return { ...result, stdout: JSON.stringify(raw) };
    } });
    expect(await checkOwnedAoci(root, [{ path: "aoci.code.txt", change: "modify" }], { commandRunner: runner })).toMatchObject({ status: "NOT_EVALUATED", category: "aoci_snapshot_changed" });
  });
  it.each(["missing", "delete", "unbound"])("rejects a %s formal Volume", async mode => {
    const root = await temporaryRoot(), bytes = "index";
    if (mode !== "missing") await writeFile(path.join(root, "aoci.code.txt"), bytes);
    const { runner } = aociFixture({ sourcePaths: [], mutateCommand(command, result) {
      if (!["verify", "check", "index"].includes(command[0])) return result;
      const raw = JSON.parse(result.stdout);
      raw.governance.code = { enabled: true, path: "aoci.code.txt", asset_state: "present",
        ...(mode === "unbound" ? {} : { sha256: createHash("sha256").update(bytes).digest("hex") }) };
      return { ...result, stdout: JSON.stringify(raw) };
    } });
    expect(await checkOwnedAoci(root, [{ path: "aoci.code.txt", change: mode === "delete" ? "delete" : "modify" }], { commandRunner: runner })).toMatchObject({ status: "FAIL" });
  });
  it("passes owned aligned files while reporting drift in other repository entries separately", async () => {
    const { runner, calls } = aociFixture({ unrelatedDrift: ["src/other-session.ts"] });
    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/harness/governance.ts", change: "add" }], { commandRunner: runner });

    expect(result).toMatchObject({ id: "owned-aoci", required: true, status: "PASS" });
    expect(result.evidence?.ownedAoci).toMatchObject({ status: "PASS", objects: [
      { path: "src/harness/governance.ts", change: "add", status: "PASS", currentSha256: hash("a") },
    ] });
    expect(result.evidence?.repositoryAoci).toMatchObject({ status: "FAIL", drift: { stale: ["src/other-session.ts"] } });
    expect(result.evidence?.official).toMatchObject({
      capability: { version: "aoci-capability-manifest/v1", aoci_version: "0.1.0-rc14" },
      sourceManifest: {
        version: "business-source-manifest/v1",
        aggregateSha256: hash("3"),
        ownedFiles: { "src/harness/governance.ts": { sha256: hash("a"), sizeBytes: 8 } },
      },
      governanceCommands: {
        verify: { version: "volumes-governance-facts/v1", business_source_sha256: hash("3") },
        check: { version: "volumes-governance-facts/v1", business_source_sha256: hash("3") },
        guide: { version: "volumes-governance-facts/v1", business_source_sha256: hash("3") },
      },
    });
    expect(calls.some((command) => command.join(" ") === "index agent guide --agent harness")).toBe(true);
  });

  it.each([
    ["stale", { stale: ["src/harness/governance.ts"] }, ["src/harness/governance.ts"]],
    ["missing", { missing: ["src/harness/governance.ts"] }, ["src/harness/governance.ts"]],
    ["unbaselined", { unbaselined: ["src/harness/governance.ts"] }, ["src/harness/governance.ts"]],
    ["line ending only", { line_ending_only: ["src/harness/governance.ts"] }, ["src/harness/governance.ts"]],
  ])("fails an owned %s object", async (_label, drift, sourcePaths) => {
    const { runner } = aociFixture({ drift, sourcePaths });
    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/harness/governance.ts", change: "modify" }], { commandRunner: runner });
    expect(result).toMatchObject({ status: "FAIL", category: "owned_aoci_drift" });
  });

  it("requires an added path to exist in the source manifest and have an Entry baseline", async () => {
    const { runner } = aociFixture({ sourcePaths: [], drift: { unbaselined: ["src/new.ts"] } });
    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/new.ts", change: "add" }], { commandRunner: runner });
    expect(result).toMatchObject({ status: "FAIL", category: "owned_aoci_drift" });
  });

  it("requires deleted paths to be absent from sources and non-orphaned in the official index", async () => {
    const fixture = aociFixture({ sourcePaths: [], drift: { orphan: ["src/removed.ts"] } });
    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/removed.ts", change: "delete" }], { commandRunner: fixture.runner });
    expect(result).toMatchObject({ status: "FAIL", category: "owned_aoci_drift" });
  });

  it.each(["observe", "exclude"] as const)("treats an owned %s path as an explicit no-Entry disposition", async (role) => {
    const { runner } = aociFixture({ roles: { "docs/review.md": role }, sourcePaths: [] });
    const result = await checkOwnedAoci("/fixture/repo", [{ path: "docs/review.md", change: "modify" }], { commandRunner: runner });
    expect(result).toMatchObject({ status: "PASS", category: "owned_aoci_aligned" });
    expect(result.evidence?.ownedAoci).toMatchObject({ objects: [{ path: "docs/review.md", role, entryRequired: false }] });
  });

  it("does not claim alignment when AOCI is unavailable", async () => {
    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/file.ts", change: "modify" }], {
      commandRunner: async () => ({ code: -1, stdout: "", stderr: "spawn aoci ENOENT", error: "spawn aoci ENOENT" }),
    });
    expect(result).toMatchObject({ status: "NOT_EVALUATED", category: "aoci_tool_unavailable" });
  });

  it("blocks owned proof during recovery or pending transactions", async () => {
    const { runner } = aociFixture({ recoveryPending: true, pendingTransactions: 1 });
    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/file.ts", change: "modify" }], { commandRunner: runner });
    expect(result).toMatchObject({ status: "NOT_EVALUATED", category: "aoci_recovery_pending" });
  });

  it("blocks owned proof during a third-party conflict", async () => {
    const { runner } = aociFixture({ thirdPartyConflict: true });
    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/file.ts", change: "modify" }], { commandRunner: runner });
    expect(result).toMatchObject({ status: "NOT_EVALUATED", category: "aoci_recovery_pending" });
  });

  it("requires the source manifest aggregate to match every official governance snapshot", async () => {
    const { runner } = aociFixture();
    const mismatched = async (args: readonly string[]): Promise<AociCommandResult> => {
      const result = await runner(args);
      if (args.slice(3).join(" ") !== "source manifest") return result;
      const parsed = JSON.parse(result.stdout) as { aggregate_sha256: string };
      parsed.aggregate_sha256 = hash("8");
      return { ...result, stdout: JSON.stringify(parsed) };
    };
    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/file.ts", change: "modify" }], { commandRunner: mismatched });
    expect(result).toMatchObject({ status: "NOT_EVALUATED", category: "aoci_source_manifest_changed" });
  });

  it("rejects inconsistent shared index facts instead of combining different snapshots", async () => {
    const { runner } = aociFixture({});
    const inconsistent = async (args: readonly string[]): Promise<AociCommandResult> => {
      const result = await runner(args);
      if (args.slice(3).join(" ") !== "check") return result;
      const parsed = JSON.parse(result.stdout) as { governance: { composite_identity: string } };
      parsed.governance.composite_identity = hash("9");
      return { ...result, stdout: JSON.stringify(parsed) };
    };
    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/file.ts", change: "modify" }], { commandRunner: inconsistent });
    expect(result).toMatchObject({ status: "NOT_EVALUATED", category: "aoci_snapshot_changed" });
  });

  it("ignores excluded audit inventory counts while binding official scope and source identities", async () => {
    let auditCount = 10;
    const { runner } = aociFixture({ unrelatedDrift: ["src/other-session.ts"], mutateCommand: (command, result) => {
      if (!["verify", "check", "index"].includes(command[0])) return result;
      const parsed = JSON.parse(result.stdout);
      parsed.governance.managed_scope.exclude_count = auditCount++;
      parsed.governance.managed_scope.observe_count = auditCount;
      return { ...result, stdout: JSON.stringify(parsed) };
    } });
    expect(await checkOwnedAoci("/fixture/repo", [{ path: "src/harness/governance.ts", change: "modify" }], { commandRunner: runner }))
      .toMatchObject({ status: "PASS", evidence: { repositoryAoci: { status: "FAIL" } } });
  });

  it("rejects unknown official schema versions", async () => {
    const { runner } = aociFixture();
    const incompatible = async (args: readonly string[]): Promise<AociCommandResult> => {
      const result = await runner(args);
      if (args.slice(3).join(" ") !== "capabilities") return result;
      return { ...result, stdout: JSON.stringify({ version: "aoci-capability-manifest/v2", aoci_version: "new" }) };
    };
    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/file.ts", change: "modify" }], { commandRunner: incompatible });
    expect(result).toMatchObject({ status: "NOT_EVALUATED", category: "aoci_schema_unsupported" });
  });

  it("rejects incomplete official governance facts instead of inferring omitted drift fields", async () => {
    const { runner } = aociFixture();
    const incomplete = async (args: readonly string[]): Promise<AociCommandResult> => {
      const result = await runner(args);
      if (args.slice(3).join(" ") !== "check") return result;
      const parsed = JSON.parse(result.stdout) as { governance: { code_drift: Record<string, unknown> } };
      delete parsed.governance.code_drift.stale;
      return { ...result, stdout: JSON.stringify(parsed) };
    };

    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/file.ts", change: "modify" }], { commandRunner: incomplete });

    expect(result).toMatchObject({ status: "NOT_EVALUATED", category: "aoci_schema_unsupported" });
    expect(result.evidence?.official).toMatchObject({ governanceCommands: { verify: { version: "volumes-governance-facts/v1" } } });
  });

  it("rejects truncated structured command output and records that failure", async () => {
    const { runner } = aociFixture();
    const truncated = async (args: readonly string[]): Promise<AociCommandResult> => {
      const result = await runner(args);
      if (args.slice(3).join(" ") !== "index agent guide --agent harness") return result;
      return { ...result, outputTruncated: true };
    };

    const result = await checkOwnedAoci("/fixture/repo", [{ path: "src/file.ts", change: "modify" }], { commandRunner: truncated });

    expect(result).toMatchObject({ status: "NOT_EVALUATED", category: "aoci_evidence_unavailable" });
    expect(result.evidence?.official).toMatchObject({
      governanceCommands: {
        verify: { version: "volumes-governance-facts/v1" },
        check: { version: "volumes-governance-facts/v1" },
      },
      commandEvidence: { guide: { error: "output_truncated" } },
    });
  });
});
