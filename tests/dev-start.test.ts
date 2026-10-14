import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);

it("repeated make frontend launches independent sessions and prints separate logs without calling dev-stop", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-make-multiple-"));
  try {
    await mkdir(path.join(root, "scripts")); await mkdir(path.join(root, "bin"));
    await copyFile("Makefile", path.join(root, "Makefile"));
    await copyFile("scripts/dev-start.sh", path.join(root, "scripts/dev-start.sh"));
    await writeFile(path.join(root, "scripts/dev-stop.sh"), "#!/bin/sh\necho forbidden-stop >> stopped\nexit 1\n", { mode: 0o755 });
    await writeFile(path.join(root, "bin/npm"), "#!/bin/sh\necho \"$*\" >> launches\necho \"fixture launcher $$\"\n", { mode: 0o755 });
    await writeFile(path.join(root, "bin/sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const env = { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH}` };
    const first = await execute("make", ["frontend"], { cwd: root, env });
    const second = await execute("make", ["frontend"], { cwd: root, env });
    await expect(readFile(path.join(root, "stopped"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readFile(path.join(root, "launches"), "utf8")).trim().split("\n")).toEqual(["run dev", "run dev"]);
    const log = (output: string) => output.match(/Logs: tail -f (.+)/)?.[1];
    expect(log(first.stdout)).toBeTruthy(); expect(log(first.stdout)).not.toBe(log(second.stdout));
    for (const output of [first.stdout, second.stdout]) await rm(log(output)!, { force: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
