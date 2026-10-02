import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { captureScopedIdentity, loadScope } from "../src/harness/scope.js";
import type { HarnessTaskScope } from "../src/harness/types.js";

const roots: string[] = [];
const sha256 = (value: string | Buffer): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createRepo(): Promise<{ root: string; baseCommit: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-harness-scope-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "harness@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Harness Test"], { cwd: root });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "existing file.md"), "old documentation\n");
  await writeFile(path.join(root, "src", "main.ts"), "export const before = true;\n").catch(async () => {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.ts"), "export const before = true;\n");
  });
  execFileSync("git", ["add", "--all"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: root });
  const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  return { root, baseCommit };
}

async function writeScope(root: string, scope: HarnessTaskScope, raw?: string): Promise<string> {
  const filePath = path.join(root, ".agent", "harness", "runs", "scope.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, raw ?? `${JSON.stringify(scope, null, 2)}\n`);
  return filePath;
}

function makeScope(baseCommit: string, ownedChanges: HarnessTaskScope["ownedChanges"]): HarnessTaskScope {
  return {
    schemaVersion: "harness-task-scope/v1",
    sessionId: "scope-fixture",
    baseCommit,
    ownedChanges,
  };
}

async function fullChangeFixture(): Promise<{ root: string; scope: HarnessTaskScope; scopePath: string }> {
  const { root, baseCommit } = await createRepo();
  const oldPath = "docs/existing file.md";
  const addPath = "src/new 日本語 file.ts";
  const modifyPath = "src/main.ts";
  const beforeModify = await readFile(path.join(root, modifyPath));
  const afterModify = "export const after = true;\n";
  const addBytes = "export const added = true;\n";
  await writeFile(path.join(root, modifyPath), afterModify);
  await writeFile(path.join(root, addPath), addBytes);
  await rm(path.join(root, oldPath));
  const scope = makeScope(baseCommit, [
    { path: addPath, change: "add", beforeSha256: null, afterSha256: sha256(addBytes) },
    { path: modifyPath, change: "modify", beforeSha256: sha256(beforeModify), afterSha256: sha256(afterModify) },
    { path: oldPath, change: "delete", beforeSha256: sha256("old documentation\n"), afterSha256: null },
  ]);
  const scopePath = await writeScope(root, scope);
  return { root, scope, scopePath };
}

describe("harness task scope", () => {
  it("verifies exact Git preimages and current disk postimages for add, modify, and delete", async () => {
    const { root, scope, scopePath } = await fullChangeFixture();
    await expect(loadScope(root, scopePath)).resolves.toEqual(scope);
    await expect(loadScope(root, path.relative(root, scopePath))).resolves.toEqual(scope);

    await writeFile(path.join(root, "src/main.ts"), "tampered after scope creation\n");
    await expect(loadScope(root, scopePath)).rejects.toThrow(/postimage/i);
  });

  it("rejects false Git preimages, incompatible change hashes, duplicate paths, and bare SHA values", async () => {
    const { root, baseCommit } = await createRepo();
    const scopePath = path.join(root, ".agent", "harness", "runs", "bad-scope.json");
    const writeRaw = async (scope: unknown) => {
      await mkdir(path.dirname(scopePath), { recursive: true });
      await writeFile(scopePath, JSON.stringify(scope));
    };
    const validChange: HarnessTaskScope["ownedChanges"][number] = { path: "docs/existing file.md", change: "modify", beforeSha256: sha256("wrong"), afterSha256: sha256("new") };
    await writeRaw(makeScope(baseCommit, [validChange]));
    await expect(loadScope(root, scopePath)).rejects.toThrow(/preimage/i);

    await writeRaw(makeScope(baseCommit, [{ path: "docs/existing file.md", change: "add", beforeSha256: null, afterSha256: sha256("new") }]));
    await expect(loadScope(root, scopePath)).rejects.toThrow(/add already exists/i);

    await writeRaw(makeScope(baseCommit, [
      { path: "docs/existing file.md", change: "delete", beforeSha256: sha256("old documentation\n"), afterSha256: null },
      { path: "docs/existing file.md", change: "delete", beforeSha256: sha256("old documentation\n"), afterSha256: null },
    ]));
    await expect(loadScope(root, scopePath)).rejects.toThrow(/duplicate/i);

    await writeRaw({ ...makeScope(baseCommit, []), ownedChanges: [{ ...validChange, beforeSha256: sha256("old documentation\n"), before: "a" }] });
    await expect(loadScope(root, scopePath)).rejects.toThrow();
    await writeRaw(makeScope(baseCommit, [{ ...validChange, beforeSha256: createHash("sha256").update("old documentation\n").digest("hex") }]));
    await expect(loadScope(root, scopePath)).rejects.toThrow();
  });

  it.each(["../outside.txt", "/absolute/path", "src/../secret", "src\\main.ts", "src//main.ts"])("rejects non-canonical or escaping scope path %s", async (unsafePath) => {
    const { root, baseCommit } = await createRepo();
    const scope = makeScope(baseCommit, [{ path: unsafePath, change: "add", beforeSha256: null, afterSha256: sha256("x") }]);
    await expect(loadScope(root, await writeScope(root, scope))).rejects.toThrow();
  });

  it("rejects postimage symlinks that escape the repository", async () => {
    const { root, baseCommit } = await createRepo();
    const outside = path.join(tmpdir(), `jianji-harness-outside-${Date.now()}`);
    await writeFile(outside, "private\n");
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await symlink(outside, path.join(root, "src", "escape.ts"));
      const scope = makeScope(baseCommit, [{ path: "src/escape.ts", change: "add", beforeSha256: null, afterSha256: sha256(outside) }]);
      await expect(loadScope(root, await writeScope(root, scope))).rejects.toThrow(/symlink|symbolic link|escape/i);
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("represents a rename as the exact union of a Git delete preimage and an add postimage", async () => {
    const { root, baseCommit } = await createRepo();
    const previous = "docs/existing file.md";
    const next = "docs/renamed 日本語 file.md";
    const movedBytes = "old documentation\n";
    await rm(path.join(root, previous));
    await writeFile(path.join(root, next), movedBytes);
    const scope = makeScope(baseCommit, [
      { path: previous, change: "delete", beforeSha256: sha256(movedBytes), afterSha256: null },
      { path: next, change: "add", beforeSha256: null, afterSha256: sha256(movedBytes) },
    ]);
    const loaded = await loadScope(root, await writeScope(root, scope));
    expect(loaded.ownedChanges.map((change) => [change.path, change.change])).toEqual([
      [previous, "delete"],
      [next, "add"],
    ]);
  });

  it("captures deterministic source, owned, policy, scope, and referenced document identities", async () => {
    const { root, scope, scopePath } = await fullChangeFixture();
    await mkdir(path.join(root, "docs/contracts"), { recursive: true });
    await mkdir(path.join(root, ".agent/harness"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await mkdir(path.join(root, "resources/fonts"), { recursive: true });
    await writeFile(path.join(root, "docs/contracts/owned.md"), "the contract\n");
    await writeFile(path.join(root, "docs/unrelated.md"), "unrelated\n");
    await writeFile(path.join(root, "tests/scoped.test.ts"), "it('runs', () => {});\n");
    await writeFile(path.join(root, "scripts/check.mjs"), "process.exit(0);\n");
    await writeFile(path.join(root, "resources/fonts/LICENSE.txt"), "font resource\n");
    await writeFile(path.join(root, "package.json"), "{\"name\":\"fixture\"}\n");
    await writeFile(path.join(root, "package-lock.json"), "{\"lockfileVersion\":3}\n");
    await writeFile(path.join(root, ".agent/harness/policy.json"), "{\"schemaVersion\":2}\n");
    const loaded = await loadScope(root, scopePath);
    const first = await captureScopedIdentity(root, loaded, ["docs/contracts/owned.md#rule", "docs/contracts/owned.md#other"], true);
    const second = await captureScopedIdentity(root, loaded, ["docs/contracts/owned.md#rule", "docs/contracts/owned.md#other"], true);
    const direct = await captureScopedIdentity(root, scope, ["docs/contracts/owned.md#rule", "docs/contracts/owned.md#other"], true);
    expect(first).toEqual(second);
    expect(first.scopeSha256).toBe(direct.scopeSha256);
    expect(first.sourceFiles).toMatchObject({
      "src/main.ts": sha256("export const after = true;\n"),
      "tests/scoped.test.ts": sha256("it('runs', () => {});\n"),
      "scripts/check.mjs": sha256("process.exit(0);\n"),
      "package-lock.json": expect.any(String),
      ".agent/harness/policy.json": sha256("{\"schemaVersion\":2}\n"),
      "resources/fonts/LICENSE.txt": sha256("font resource\n"),
    });
    expect(first.ownedFiles).toMatchObject({
      "src/new 日本語 file.ts": sha256("export const added = true;\n"),
      "src/main.ts": sha256("export const after = true;\n"),
      "docs/existing file.md": null,
    });
    expect(first.documentFiles).toEqual({ "docs/contracts/owned.md": sha256("the contract\n") });
    expect(first.policySha256).toBe(sha256("{\"schemaVersion\":2}\n"));
    expect(first.scopeSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.sourceFiles).not.toHaveProperty("docs/unrelated.md");
    expect(first.sourceFiles).not.toHaveProperty("aoci.code.txt");
    expect(first.sourceSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.ownedSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.documentSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("keeps unrelated documentation out of source identity and allows a docs-only capture", async () => {
    const { root, scope, scopePath } = await fullChangeFixture();
    await mkdir(path.join(root, ".agent/harness"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, ".agent/harness/policy.json"), "policy\n");
    await writeFile(path.join(root, "docs/referenced.md"), "ref\n");
    const loaded = await loadScope(root, scopePath);
    const before = await captureScopedIdentity(root, loaded, ["docs/referenced.md"], true);
    await writeFile(path.join(root, "docs/unrelated.md"), "unrelated change\n");
    const after = await captureScopedIdentity(root, loaded, ["docs/referenced.md"], true);
    expect(after.sourceSha256).toBe(before.sourceSha256);
    expect(after.documentSha256).toBe(before.documentSha256);

    const docsOnly = await captureScopedIdentity(root, loaded, ["docs/referenced.md"], false);
    expect(docsOnly.sourceFiles).toEqual({});
    expect(docsOnly.sourceSha256).toBe(sha256("{}"));
    expect(docsOnly.policySha256).toBe(before.policySha256);
    expect(docsOnly.ownedSha256).toBe(before.ownedSha256);
    expect(scope.ownedChanges).toHaveLength(3);
  });

  it("ignores generated Python cache directories while still binding Python source bytes", async () => {
    const { root, scopePath } = await fullChangeFixture();
    await mkdir(path.join(root, ".agent/harness"), { recursive: true });
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, ".agent/harness/policy.json"), "policy\n");
    await writeFile(path.join(root, "scripts/check.py"), "print('before')\n");
    const loaded = await loadScope(root, scopePath);
    const before = await captureScopedIdentity(root, loaded, [], true);
    await mkdir(path.join(root, "scripts/__pycache__"), { recursive: true });
    await mkdir(path.join(root, "tests/__pycache__"), { recursive: true });
    await writeFile(path.join(root, "scripts/__pycache__/check.cpython-312.pyc"), "generated cache\n");
    await writeFile(path.join(root, "tests/__pycache__/check.cpython-312.pyc"), "test cache\n");
    const cached = await captureScopedIdentity(root, loaded, [], true);
    expect(cached.sourceSha256).toBe(before.sourceSha256);
    expect(cached.sourceFiles).toHaveProperty("scripts/check.py", sha256("print('before')\n"));
    await writeFile(path.join(root, "scripts/__pycache__/check.cpython-312.pyc"), "changed cache\n");
    expect((await captureScopedIdentity(root, loaded, [], true)).sourceSha256).toBe(before.sourceSha256);
    await writeFile(path.join(root, "scripts/check.py"), "print('after')\n");
    expect((await captureScopedIdentity(root, loaded, [], true)).sourceSha256).not.toBe(before.sourceSha256);
  });

  it("detects participant source changes while preserving an independent owned-document map", async () => {
    const { root, scopePath } = await fullChangeFixture();
    await mkdir(path.join(root, ".agent/harness"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, ".agent/harness/policy.json"), "policy\n");
    await writeFile(path.join(root, "docs/referenced.md"), "ref\n");
    const loaded = await loadScope(root, scopePath);
    const before = await captureScopedIdentity(root, loaded, ["docs/referenced.md"], true);
    await writeFile(path.join(root, "src/shared.ts"), "export const participantChanged = true;\n");
    const after = await captureScopedIdentity(root, loaded, ["docs/referenced.md"], true);
    expect(after.sourceSha256).not.toBe(before.sourceSha256);
    expect(after.ownedSha256).toBe(before.ownedSha256);
    expect(after.documentSha256).toBe(before.documentSha256);
  });

  it("fails closed on source symlinks so a linked dependency cannot drift outside the identity", async () => {
    const { root, scopePath } = await fullChangeFixture();
    await mkdir(path.join(root, ".agent/harness"), { recursive: true });
    await writeFile(path.join(root, ".agent/harness/policy.json"), "policy\n");
    const target = path.join(root, "src/linked-target.ts");
    await writeFile(target, "linked source\n");
    await symlink("linked-target.ts", path.join(root, "src/linked.ts"));
    const loaded = await loadScope(root, scopePath);
    await expect(captureScopedIdentity(root, loaded, [], true)).rejects.toThrow(/symbolic link/i);
    await writeFile(target, "changed link target\n");
    await expect(captureScopedIdentity(root, loaded, [], true)).rejects.toThrow(/symbolic link/i);
  });
});
