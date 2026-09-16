import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultProject, ProjectSchema } from "../src/main/domain";
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
    const result = await readValidatedJson(filePath, (value) => ProjectSchema.parse(value), { maxVersion: 2 });
    expect(result.source).toBe("backup");
    expect(result.value.name).toBe("first");
    expect((await readdir(directory)).some((name) => name.startsWith("project.json.corrupt-"))).toBe(true);
    expect((await readValidatedJson(filePath, (value) => ProjectSchema.parse(value), { maxVersion: 2 })).source).toBe("primary");
  });

  it("serializes concurrent writes to one state file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-store-concurrent-"));
    const filePath = path.join(directory, "project.json");
    const first = createDefaultProject("first");
    const second = createDefaultProject("second");
    await Promise.all([atomicWriteJson(filePath, first), atomicWriteJson(filePath, second)]);
    const result = await readValidatedJson(filePath, (value) => ProjectSchema.parse(value), { maxVersion: 2 });
    expect(["first", "second"]).toContain(result.value.name);
    expect(result.source).toBe("primary");
  });
});
