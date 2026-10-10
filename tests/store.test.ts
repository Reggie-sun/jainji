import { chmod, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultProject, PROJECT_SCHEMA_VERSION, ProjectSchema } from "../src/main/domain";
import { atomicWriteJson, readValidatedJson } from "../src/main/store";

describe("atomic JSON store", () => {
  it("keeps a previous valid backup and recovers corrupt primary", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-store-"));
    const filePath = path.join(directory, "project.json");
    const first = createDefaultProject("first");
    const second = createDefaultProject("second");
    await atomicWriteJson(filePath, first);
    await atomicWriteJson(filePath, second);
    expect(JSON.parse(await readFile(`${filePath}.bak`, "utf8")).name).toBe("first");
    await writeFile(filePath, "{broken", "utf8");
    const result = await readValidatedJson(filePath, (value) => ProjectSchema.parse(value), { maxVersion: PROJECT_SCHEMA_VERSION });
    expect(result.source).toBe("backup");
    expect(result.value.name).toBe("first");
    expect((await readdir(directory)).some((name) => name.startsWith("project.json.corrupt-"))).toBe(true);
    expect((await readValidatedJson(filePath, (value) => ProjectSchema.parse(value), { maxVersion: PROJECT_SCHEMA_VERSION })).source).toBe("primary");
  });

  it("serializes concurrent writes to one state file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-store-concurrent-"));
    const filePath = path.join(directory, "project.json");
    const first = createDefaultProject("first");
    const second = createDefaultProject("second");
    await Promise.all([atomicWriteJson(filePath, first), atomicWriteJson(filePath, second)]);
    const result = await readValidatedJson(filePath, (value) => ProjectSchema.parse(value), { maxVersion: PROJECT_SCHEMA_VERSION });
    expect(["first", "second"]).toContain(result.value.name);
    expect(result.source).toBe("primary");
  });

  it("recovers a missing primary from its valid backup", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-store-missing-"));
    const filePath = path.join(directory, "project.json");
    await atomicWriteJson(filePath, createDefaultProject("backup"));
    await atomicWriteJson(filePath, createDefaultProject("primary"));
    await unlink(filePath);
    const result = await readValidatedJson(filePath, value => ProjectSchema.parse(value), { maxVersion: PROJECT_SCHEMA_VERSION });
    expect(result.source).toBe("backup");
    expect(result.value.name).toBe("backup");
  });

  it.skipIf(process.platform === "win32")("preserves the latest valid primary when a read permission error prevents inspecting it", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-store-read-failure-"));
    const filePath = path.join(directory, "project.json");
    await atomicWriteJson(filePath, createDefaultProject("older backup"));
    await atomicWriteJson(filePath, createDefaultProject("latest primary"));
    const primary = await readFile(filePath, "utf8"), backup = await readFile(`${filePath}.bak`, "utf8");
    await chmod(filePath, 0o000);
    try {
      await expect(readValidatedJson(filePath, value => ProjectSchema.parse(value), { maxVersion: PROJECT_SCHEMA_VERSION }))
        .rejects.toMatchObject({ code: "unavailable" });
    } finally { await chmod(filePath, 0o600); }
    expect(await readFile(filePath, "utf8")).toBe(primary);
    expect(await readFile(`${filePath}.bak`, "utf8")).toBe(backup);
    expect((await readdir(directory)).some(name => name.includes(".corrupt-"))).toBe(false);
  });
});
