import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as store from "../src/main/store";
import { RecentProjects } from "../src/main/recent-projects";
import { createDefaultProject } from "../src/main/domain";

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-recents-"));
  directories.push(directory);
  const registry = path.join(directory, "recent-projects.json");
  const first = path.join(directory, "first.json");
  const second = path.join(directory, "second.jianji-project.json");
  await writeFile(first, JSON.stringify({ ...createDefaultProject("第一组"), schemaVersion: 1 }));
  await writeFile(second, JSON.stringify(createDefaultProject("第二组")));
  return { directory, registry, first, second };
}

it("discovers legacy project files without modifying them and remembers the list across restart", async () => {
  const { directory, registry, first } = await fixture();
  const bytes = await readFile(first);
  await writeFile(path.join(directory, "unrelated.json"), '{"other":true}');
  await writeFile(path.join(directory, "broken.json"), "{");
  const recent = new RecentProjects(registry);
  await recent.initialize([directory]);
  expect(recent.list().map((entry) => entry.name).sort()).toEqual(["第一组", "第二组"]);
  expect(JSON.stringify(recent.list())).not.toContain(directory);
  expect(await readFile(first)).toEqual(bytes);
  expect(await readFile(path.join(directory, "broken.json"), "utf8")).toBe("{");
  const reopened = new RecentProjects(registry);
  await reopened.initialize();
  expect(reopened.list()).toEqual(recent.list());
});

it("deduplicates saved paths, updates names, and preserves concurrent registrations", async () => {
  const { registry, first, second } = await fixture();
  const recent = new RecentProjects(registry);
  await recent.initialize();
  await Promise.all([recent.remember(first, createDefaultProject("同名")), recent.remember(second, createDefaultProject("同名"))]);
  expect(recent.list()).toHaveLength(2);
  const id = recent.list().find((entry) => entry.fileName === "first.json")!.id;
  await recent.remember(first, createDefaultProject("改名后的素材"));
  expect(recent.list()[0]).toMatchObject({ id, name: "改名后的素材" });
  expect(recent.list()).toHaveLength(2);
  expect(recent.resolve(id)).toBe(first);
  await expect(recent.idForPath(first)).resolves.toBe(id);
  expect(() => recent.resolve(crypto.randomUUID())).toThrow("找不到");
});

it("keeps startup available when the index is corrupt and preserves the quarantined evidence", async () => {
  const { registry, first } = await fixture();
  await writeFile(registry, "{broken");
  const recent = new RecentProjects(registry);
  await expect(recent.initialize()).resolves.toBeUndefined();
  expect(recent.warning).toContain("无法读取");
  const quarantined = (await readdir(path.dirname(registry))).find((name) => name.startsWith("recent-projects.json.corrupt-"));
  expect(quarantined).toBeDefined();
  expect(await readFile(path.join(path.dirname(registry), quarantined!), "utf8")).toBe("{broken");
  await recent.remember(first, createDefaultProject("重新打开"));
  expect(recent.warning).toBeUndefined();
  expect(recent.list()[0].name).toBe("重新打开");
});

it("reports index write failure separately, retaining the last list and successful project file", async () => {
  const { registry, first, second } = await fixture();
  const recent = new RecentProjects(registry);
  await recent.initialize();
  await recent.remember(first, createDefaultProject("第一组"));
  const saved = await readFile(second);
  vi.spyOn(store, "atomicWriteJson").mockRejectedValueOnce(new Error("ENOSPC"));
  await expect(recent.remember(second, createDefaultProject("第二组"))).resolves.toBeUndefined();
  expect(recent.warning).toContain("无法更新");
  expect(recent.list()).toHaveLength(1);
  expect(await readFile(second)).toEqual(saved);
  await recent.remember(second, createDefaultProject("第二组"));
  expect(recent.warning).toBeUndefined();
  expect(recent.list()).toHaveLength(2);
});

it("forgets a deleted collection and keeps it hidden when the auxiliary index write fails", async () => {
  const { registry, first, second } = await fixture();
  const recent = new RecentProjects(registry);
  await recent.initialize();
  await recent.remember(first, createDefaultProject("第一组"));
  await recent.remember(second, createDefaultProject("第二组"));
  const firstId = recent.list().find((entry) => entry.fileName === "first.json")!.id;
  await recent.forget(firstId);
  expect(recent.list().map((entry) => entry.fileName)).toEqual(["second.jianji-project.json"]);
  const reopened = new RecentProjects(registry);
  await reopened.initialize();
  expect(reopened.list()).toEqual(recent.list());

  const secondId = recent.list()[0].id;
  vi.spyOn(store, "atomicWriteJson").mockRejectedValueOnce(new Error("ENOSPC"));
  await expect(recent.forget(secondId)).resolves.toBeUndefined();
  expect(recent.list()).toEqual([]);
  expect(recent.warning).toContain("无法更新");
});
