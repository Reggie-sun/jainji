import { execFile, spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);

async function fixture(stopExit = 0, launcherExit?: number) {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-make-restart-"));
  await execute("git", ["init", "--quiet", root]);
  await mkdir(path.join(root, "scripts")); await mkdir(path.join(root, "bin"));
  await copyFile("Makefile", path.join(root, "Makefile"));
  await copyFile("scripts/dev-start.sh", path.join(root, "scripts/dev-start.sh"));
  await writeFile(path.join(root, "scripts/dev-stop.sh"), `#!/bin/sh\necho stop >> events\nexit ${stopExit}\n`, { mode: 0o755 });
  await writeFile(path.join(root, "bin/npm"), `#!/bin/sh\necho $$ >> pids\necho "launch:$JIANJI_DEV_REUSE_PRIMARY:$*" >> events\necho "fixture launcher $$"\n${launcherExit === undefined ? "exec /bin/sleep 600" : `exit ${launcherExit}`}\n`, { mode: 0o755 });
  await writeFile(path.join(root, "bin/sleep"), "#!/bin/sh\n/bin/sleep 0.1\n", { mode: 0o755 });
  const logs: string[] = [];
  const env = { ...process.env, JIANJI_DEV_REUSE_PRIMARY: "", PATH: `${path.join(root, "bin")}:${process.env.PATH}` };
  return { root, async start() {
    try { const output = await execute("make", ["frontend"], { cwd: root, env, timeout: 10000 }); logs.push(output.stdout); return output; }
    catch (error) { logs.push((error as { stdout?: string }).stdout ?? ""); throw error; }
  }, async close() {
    for (const pid of (await readFile(path.join(root, "pids"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean)) {
      try { process.kill(Number(pid), "SIGTERM"); } catch {}
    }
    for (const output of logs) { const log = output.match(/Logs: tail -f (.+)/)?.[1]; if (log) await rm(log, { force: true }); }
    await rm(root, { recursive: true, force: true });
  } };
}

it("repeated make frontend stops the previous owner before launching fresh code with the primary profile", async () => {
  const f = await fixture();
  try {
    const first = await f.start(), second = await f.start();
    expect((await readFile(path.join(f.root, "events"), "utf8")).trim().split("\n")).toEqual(["stop", "launch:1:run dev", "stop", "launch:1:run dev"]);
    const log = (output: string) => output.match(/Logs: tail -f (.+)/)?.[1];
    expect(log(first.stdout)).toBeTruthy(); expect(log(first.stdout)).not.toBe(log(second.stdout));
  } finally { await f.close(); }
});

it("does not start another process when the previous owner could not stop", async () => {
  const f = await fixture(23);
  try {
    await expect(f.start()).rejects.toThrow();
    expect((await readFile(path.join(f.root, "events"), "utf8")).trim()).toBe("stop");
  } finally { await f.close(); }
});

it("reports failure when a new launcher exits instead of claiming that fresh code is running", async () => {
  const f = await fixture(0, 0);
  try { await expect(f.start()).rejects.toThrow(); }
  finally { await f.close(); }
});

it("detaches the launcher session and keeps it alive after the launching terminal hangs up", async () => {
  const f = await fixture();
  try {
    await f.start();
    const pid = Number((await readFile(path.join(f.root, "pids"), "utf8")).trim());
    expect(Number((await execute("ps", ["-o", "sid=", "-p", String(pid)])).stdout.trim())).toBe(pid);
    process.kill(pid, "SIGHUP");
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(() => process.kill(pid, 0)).not.toThrow();
  } finally { await f.close(); }
});

async function stopFixture(otherRepository = false) {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-stop-owner-"));
  const repo = path.join(root, "repo"), peer = path.join(root, "peer"), config = path.join(root, "config");
  await execute("git", ["init", "--quiet", repo]);
  await mkdir(path.join(repo, "scripts")); await mkdir(path.join(peer, "scripts"), { recursive: true });
  if (otherRepository) await execute("git", ["init", "--quiet", peer]);
  else await writeFile(path.join(peer, ".git"), `gitdir: ${path.join(repo, ".git")}\n`);
  await copyFile("scripts/dev-stop.sh", path.join(repo, "scripts/dev-stop.sh"));
  await writeFile(path.join(peer, "package.json"), JSON.stringify({ main: "app.cjs" }));
  await writeFile(path.join(peer, "app.cjs"), `
    const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
    const dir=path.join(process.env.XDG_CONFIG_HOME,'jianji',process.env.FIXTURE_SECONDARY?'instances/1':'');
    fs.mkdirSync(dir,{recursive:true});fs.symlinkSync(os.hostname()+'-'+process.pid,path.join(dir,'SingletonLock'));
    fs.writeFileSync(path.join(${JSON.stringify(root)},process.env.FIXTURE_SECONDARY?'secondary.json':'primary.json'),JSON.stringify({pid:process.pid,parent:process.ppid}));
    process.on('message',message=>{if(message==='quit'){fs.writeFileSync(${JSON.stringify(path.join(root, "graceful"))},'closed');process.exit(0);}});
    setInterval(()=>{},1000);
  `);
  await writeFile(path.join(peer, "scripts/dev.mjs"), `
    import{spawn}from'node:child_process';import path from'node:path';
    const child=spawn(process.execPath,['.'],{cwd:process.cwd(),argv0:path.join(process.cwd(),'node_modules/electron/dist/electron'),env:process.env,stdio:['ignore','ignore','ignore','ipc']});
    process.on('SIGTERM',()=>child.send('quit'));child.on('exit',()=>setTimeout(()=>process.exit(0),200));
    setInterval(()=>{},1000);
  `);
  const children: ChildProcess[] = [], appPids: number[] = [];
  const env = { ...process.env, XDG_CONFIG_HOME: config };
  async function launch(secondary = false, orphan = false) {
    const child = spawn(process.execPath, [secondary || orphan ? "." : "scripts/dev.mjs"], { cwd: peer,
      argv0: secondary || orphan ? path.join(peer, "node_modules/electron/dist/electron") : process.execPath,
      env: { ...env, ...(secondary ? { FIXTURE_SECONDARY: "1" } : {}) }, stdio: "ignore" });
    children.push(child);
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const value = await readFile(path.join(root, secondary ? "secondary.json" : "primary.json"), "utf8").catch(() => "");
      if (value) { const owner = JSON.parse(value) as {pid:number;parent:number}; appPids.push(owner.pid); return owner; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("Owner fixture did not start");
  }
  return { root, launch, stop: () => execute("bash", [path.join(repo, "scripts/dev-stop.sh")], { cwd: repo, env, timeout: 5000 }), async close() {
    for (const pid of appPids) { try { process.kill(pid, "SIGTERM"); } catch {} }
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once("exit", resolve))));
    await rm(root, { recursive: true, force: true });
  } };
}

it("stops the primary owner from another worktree and leaves independent windows running", async () => {
  const f = await stopFixture();
  try {
    const primary = await f.launch(), secondary = await f.launch(true);
    await f.stop();
    expect(await readFile(path.join(f.root, "graceful"), "utf8")).toBe("closed");
    expect(() => process.kill(primary.pid, 0)).toThrow();
    expect(() => process.kill(primary.parent, 0)).toThrow();
    expect(() => process.kill(secondary.pid, 0)).not.toThrow();
  } finally { await f.close(); }
});

it("refuses to signal a primary window belonging to another repository", async () => {
  const f = await stopFixture(true);
  try {
    const primary = await f.launch();
    await expect(f.stop()).rejects.toThrow(/this repository/);
    expect(() => process.kill(primary.pid, 0)).not.toThrow();
  } finally { await f.close(); }
});

it("refuses an orphaned primary instead of bypassing the launcher shutdown path", async () => {
  const f = await stopFixture();
  try {
    const primary = await f.launch(false, true);
    await expect(f.stop()).rejects.toThrow(/launcher is unavailable/);
    expect(() => process.kill(primary.pid, 0)).not.toThrow();
  } finally { await f.close(); }
});

it("does not signal independent windows when there is no primary owner", async () => {
  const f = await stopFixture();
  try {
    const secondary = await f.launch(true);
    await f.stop();
    expect(() => process.kill(secondary.pid, 0)).not.toThrow();
  } finally { await f.close(); }
});
