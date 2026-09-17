import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createAutomaticOutputDirectory } from "../src/main/automatic-output-directory";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-auto-output-"));
  directories.push(directory);
  return directory;
}

it("creates a timestamped video directory beside the material directory", async () => {
  const root = await temporaryRoot();
  const source = path.join(root, "肥皂", "素材", "分组", "素材一.mp4");
  const created = await createAutomaticOutputDirectory([source], new Date(2026, 8, 18, 9, 7));

  expect(created).toBe(path.join(root, "肥皂", "视频", "9.18 09:07"));
  expect((await stat(created)).isDirectory()).toBe(true);
});

it("reserves a new directory when the same minute already exists", async () => {
  const root = await temporaryRoot();
  const existing = path.join(root, "马油膏布", "视频", "9.18 20:02");
  await mkdir(existing, { recursive: true });

  const created = await createAutomaticOutputDirectory(
    [path.join(root, "马油膏布", "素材", "素材一.mp4")],
    new Date(2026, 8, 18, 20, 2),
  );

  expect(created).toBe(`${existing} (2)`);
  expect((await stat(existing)).isDirectory()).toBe(true);
  expect((await stat(created)).isDirectory()).toBe(true);
});

it("reuses only an existing automatic directory for the same product", async () => {
  const root = await temporaryRoot();
  const source = path.join(root, "蝴蝶贴", "素材", "素材一.mp4");
  const existing = path.join(root, "蝴蝶贴", "视频", "9.17 20:03");
  await mkdir(existing, { recursive: true });

  await expect(createAutomaticOutputDirectory([source], new Date(), existing)).resolves.toBe(existing);
  await expect(createAutomaticOutputDirectory([source], new Date(), path.join(root, "马油膏布", "视频", "9.17 20:03"))).rejects.toThrow("不匹配");
});

it("rejects sources that do not identify one product root", async () => {
  const root = await temporaryRoot();
  await expect(createAutomaticOutputDirectory([
    path.join(root, "肥皂", "素材", "a.mp4"),
    path.join(root, "蝴蝶贴", "素材", "b.mp4"),
  ])).rejects.toThrow("不同产品目录");
  await expect(createAutomaticOutputDirectory([
    path.join(root, "肥皂", "原片", "a.mp4"),
  ])).rejects.toThrow("产品/素材");
});
