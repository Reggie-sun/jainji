import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { RemoteWorker } from "../src/main/qianchuan-remote-worker";
import { RemoteChannel } from "../src/main/qianchuan-remote-transport";
import { QianchuanRemoteRuntime } from "../src/main/qianchuan-remote-runtime";
import { QianchuanBrowserManager } from "../src/main/qianchuan-browser-manager";
import type { RemoteRequest } from "../src/shared/qianchuan-remote";
import type { UploadTaskRecord } from "../src/main/douyin-upload-store";

const roots: string[] = [];
const route = { mode: "remote-browser" as const, group: "one", sshHost: "shop-one", expectedIp: "8.8.8.8", localPort: 19381 };
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(path.join(os.tmpdir(), "jianji-remote-runtime-")); roots.push(value); return value; }

it("can verify an existing login browser without granting authenticated account readiness or launching another browser", async () => {
  const dir = await root(), launch = vi.fn();
  const manager = new QianchuanBrowserManager(dir, { launch, browsers: async () => [{ profile: path.join(dir, "account-browsers", "123"), endpoint: "http://127.0.0.1:19381" }] });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{ type: "page", url: "https://qianchuan.jinritemai.com/login" }])));
  expect(await manager.existingConnection("123")).toBe("http://127.0.0.1:19381");
  await expect(manager.prepareExisting("123")).rejects.toThrow();
  expect(launch).not.toHaveBeenCalled();
});

it("resumes real binary RPC staging across channel replacement and never sends shell-interpreted video bytes", async () => {
  const dir = await root(), workerFile = path.join(dir, "fixture.cjs"), state = path.join(dir, "state");
  const source = `import { RemoteWorker } from './src/main/qianchuan-remote-worker'; import { RemoteFrames } from './src/main/qianchuan-remote-transport'; const w = new RemoteWorker(process.argv[2]), f = new RemoteFrames(); (async()=>{for await(const b of process.stdin)for(const x of f.push(b)){try{process.stdout.write(JSON.stringify({ok:true,value:await w.handle(x.request,x.body)})+'\\n')}catch{process.stdout.write('{"ok":false}\\n')}}})().catch(()=>process.exitCode=1);`;
  await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" }, outfile: workerFile, platform: "node", bundle: true, format: "cjs", external: ["playwright-core"] });
  const launch = () => spawn(process.execPath, [workerFile, state], { stdio: "pipe", env: { ...process.env, NODE_PATH: path.resolve("node_modules") } });
  const bytes = Buffer.from("二进制\n\u0000$(not-a-command)"), file = { advertiserId: "123", fileName: "远端素材.mp4", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  let channel = new RemoteChannel(route, launch);
  try {
    await channel.request("file-status", "123", { file });
    expect(await channel.request("file-append", "123", { file, offset: 0 }, bytes.subarray(0, 5))).toMatchObject({ offset: 5, complete: false });
    channel.close(); channel = new RemoteChannel(route, launch);
    expect(await channel.request("file-status", "123", { file })).toMatchObject({ offset: 5, complete: false });
    const done = await channel.request("file-append", "123", { file, offset: 5 }, bytes.subarray(5)) as { path: string };
    expect(await readFile(done.path)).toEqual(bytes);
    expect(await channel.request("file-status", "123", { file })).toMatchObject({ offset: bytes.length, complete: true });
    channel.close();
    await expect(channel.request("file-status", "123", { file })).rejects.toThrow();
  } finally { channel.close(); }
}, 15000);

it("stages the frozen snapshot, resumes bytes, and rejects already-selected tasks or a different subject", async () => {
  const dir = await root(), worker = new RemoteWorker(path.join(dir, "state")), controller = new AbortController();
  const request = async (action: RemoteRequest["action"], advertiserId: string, extras = {}, body = Buffer.alloc(0)) => worker.handle({ version: 1, route, action, advertiserId, ...extras, bodyBytes: body.length }, body);
  const runtime = new QianchuanRemoteRuntime(() => ({ route, controller, request, close() { controller.abort(); } }));
  vi.spyOn(runtime, "verify").mockResolvedValue({ identity: "fixture", signal: controller.signal });
  const bytes = Buffer.from("frozen remote bytes"), file = path.join(dir, "snapshot.mp4"); await writeFile(file, bytes); await chmod(file, 0o400);
  const task = { snapshotPath: file, authorization: { target: { advertiserId: "123", cdpEndpoint: "http://127.0.0.1:19381", egress: route } }, input: { size_bytes: bytes.length, artifact_sha256: createHash("sha256").update(bytes).digest("hex") }, result: { file_name: "snapshot.mp4", upload_outcome: "NOT_SELECTED" } } as UploadTaskRecord;
  try {
    const remote = await runtime.stage(task, controller.signal); expect(await readFile(remote)).toEqual(bytes);
    expect(await runtime.stage(task, controller.signal)).toBe(remote);
    task.result.upload_outcome = "MAY_HAVE_UPLOADED";
    await expect(runtime.stage(task, controller.signal)).rejects.toThrow();
    await expect(worker.handle({ version: 1, route: { ...route, group: "another" }, action: "file-status", advertiserId: "123", file: { advertiserId: "123", fileName: "snapshot.mp4", size: bytes.length, sha256: task.input.artifact_sha256 }, bodyBytes: 0 }, Buffer.alloc(0))).rejects.toThrow("Subject");
  } finally { runtime.dispose(); }
});
