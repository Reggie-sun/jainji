import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { claimDesktopInstance } from "../src/main/desktop-instance";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

async function fixture(occupied: string[] = []) {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-instances-")); directories.push(root);
  const paths = { userData: root, sessionData: root };
  const held = new Set(occupied.map(slot => slot ? path.join(root, "instances", slot) : root));
  const app = {
    getPath: (name: "userData" | "sessionData") => paths[name],
    setPath: vi.fn((name: "userData" | "sessionData", value: string) => { paths[name] = value; }),
    requestSingleInstanceLock: vi.fn(() => {
      if (held.has(paths.userData)) return false;
      held.add(paths.userData); return true;
    }),
  };
  return { app, root, paths, held };
}

it("keeps the existing primary profile and lock", async () => {
  const f = await fixture();
  expect(claimDesktopInstance(f.app, { multiple: true })).toEqual({ locked: true, primary: true, directory: f.root });
  expect(f.app.setPath).not.toHaveBeenCalled();
});

it("opens separate persistent data and Chromium session directories without changing the primary", async () => {
  const f = await fixture(["", "1"]);
  await writeFile(path.join(f.root, "connections.json"), "primary settings");
  const result = claimDesktopInstance(f.app, { multiple: true });
  expect(result).toEqual({ locked: true, primary: false, directory: path.join(f.root, "instances", "2") });
  expect(f.paths.userData).toBe(result.directory);
  expect(f.paths.sessionData).toBe(result.directory);
  expect(await readFile(path.join(f.root, "connections.json"), "utf8")).toBe("primary settings");
  await expect(readFile(path.join(result.directory, "connections.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("pins hot reload to its original profile even if the primary becomes available", async () => {
  const f = await fixture();
  const directory = path.join(f.root, "instances", "2");
  const result = claimDesktopInstance(f.app, { multiple: true, directory });
  expect(result.directory).toBe(directory);
  expect(result.primary).toBe(false);
  expect(f.held.has(f.root)).toBe(false);
});

it("fails closed if the pinned profile is occupied rather than switching projects", async () => {
  const f = await fixture(["2"]);
  expect(claimDesktopInstance(f.app, { multiple: true, directory: path.join(f.root, "instances", "2") }).locked).toBe(false);
  expect(f.app.requestSingleInstanceLock).toHaveBeenCalledOnce();
});

it("scheduled and packaged launches retain the original single owner", async () => {
  const f = await fixture([""]);
  expect(claimDesktopInstance(f.app, { multiple: false })).toEqual({ locked: false, primary: true, directory: f.root });
  expect(f.app.setPath).not.toHaveBeenCalled();
  expect(f.app.requestSingleInstanceLock).toHaveBeenCalledOnce();
});

it("rejects a foreign pinned directory before taking any lock", async () => {
  const f = await fixture();
  expect(() => claimDesktopInstance(f.app, { multiple: true, directory: path.join(f.root, "..", "another-app") })).toThrow();
  expect(f.app.requestSingleInstanceLock).not.toHaveBeenCalled();
});
