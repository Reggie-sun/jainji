import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanExtensionRemote } from "../src/main/qianchuan-extension-remote";
import { QianchuanRemoteRuntime } from "../src/main/qianchuan-remote-runtime";
import { qianchuanSelectedAccountTargets } from "../src/main/qianchuan-selected-account-targets";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
import type { UploadTaskRecord } from "../src/main/douyin-upload-store";
import type { QianchuanEgress } from "../src/shared/qianchuan-egress";
import type { RemoteRequest } from "../src/shared/qianchuan-remote";

const roots: string[] = [];
const route: QianchuanEgress = { mode: "remote-browser", group: "future-shop", sshHost: "future-shop-vps", expectedIp: "8.8.8.8", localPort: 19381 };
it("releases only the owned extension tunnel on explicit recovery without automatic reconnect", async () => {
  const children: ChildProcess[] = [];
  const launch = vi.fn(() => {
    const child = new EventEmitter() as ChildProcess;
    child.unref = vi.fn(() => child);
    Object.assign(child, { exitCode: null, signalCode: null });
    child.kill = vi.fn(() => { Object.assign(child, { exitCode: 0 }); child.emit("exit", 0); return true; });
    children.push(child); return child;
  });
  const bridge = { remoteRoute: vi.fn(async () => ({ port: 41234, token: "x".repeat(40) })) };
  const runtime = { extensionRequest: vi.fn(async (_route: QianchuanEgress, _id: string, action: string) => action === "extension-setup" ? { port: 41235 } : { profile: "/owned/profile", profileDirectory: "Default" }) };
  const remote = new QianchuanExtensionRemote(bridge as never, runtime as never, launch);
  try {
    await remote.prepare(route, "1001", new AbortController().signal);
    Object.assign(children[0], { exitCode: 1 }); children[0].emit("exit", 1);
    await expect(remote.prepare(route, "1001", new AbortController().signal)).rejects.toThrow();
    expect(launch).toHaveBeenCalledOnce();
    await remote.reset(route); expect(launch).toHaveBeenCalledOnce();
    await remote.prepare(route, "1001", new AbortController().signal); expect(launch).toHaveBeenCalledTimes(2);
    await remote.reset(route); expect(children[1].kill).toHaveBeenCalledWith("SIGTERM");
  } finally { remote.dispose(); }
});
afterEach(async () => {
  vi.restoreAllMocks();
  qianchuanSelectedAccountTargets.clear();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it("binds each VPS profile to its own saved anchor, uses one loopback SSH reverse forward, and works without DevTools metadata", async () => {
  const token = "future-native-capability-".padEnd(40, "x");
  let verifyProfile: ((identity: { pid: number; profile: string; profileDirectory: string }) => Promise<string>) | undefined;
  const bridge = {
    remoteRoute: vi.fn(async (_key: string, verify: typeof verifyProfile) => {
      verifyProfile = verify;
      return { port: 41_234, token };
    }),
  };
  const anchorA = "9400000000000000001", anchorB = "9400000000000000002";
  const profileA = "/future/chrome/anchor-a", profileB = "/future/chrome/anchor-b";
  const extensionRequest = vi.fn(async (_route: QianchuanEgress, advertiserId: string, action: string, extras: Record<string, unknown> = {}) => {
    if (action === "extension-setup") return { port: 41_235 };
    if (action === "extension-profile") return { profile: advertiserId === anchorA ? profileA : profileB, profileDirectory: "Default" };
    if (action === "extension-verify") return { startedAt: String((extras.extensionProcess as { pid: number }).pid) };
    throw new Error(`unexpected action: ${action}`);
  });
  const attachMetadata = vi.fn(async () => { throw new Error("DevTools metadata should be optional for extension subaccounts"); });
  const runtime = { extensionRequest, attachMetadata };
  const child = new EventEmitter() as ChildProcess;
  child.unref = vi.fn(() => child);
  child.kill = vi.fn(() => true);
  const launch = vi.fn((_args: string[]) => child);
  const remote = new QianchuanExtensionRemote(bridge as never, runtime as never, launch);
  const signal = new AbortController().signal;
  try {
    const first = await remote.prepare(route, anchorA, signal, "http://127.0.0.1:51001");
    const second = await remote.prepare(route, anchorB, signal, "http://127.0.0.1:51002");
    expect(first).toMatchObject({ profile: profileA, endpoint: "http://127.0.0.1:51001" });
    expect(second).toMatchObject({ profile: profileB, endpoint: "http://127.0.0.1:51002" });
    expect(attachMetadata).not.toHaveBeenCalled();
    expect(bridge.remoteRoute).toHaveBeenCalledOnce();
    expect(extensionRequest.mock.calls.filter(([, , action]) => action === "extension-setup")).toHaveLength(1);
    expect(extensionRequest.mock.calls.filter(([, , action]) => action === "extension-profile").map(([, id]) => id)).toEqual([anchorA, anchorB]);

    const identityA = { pid: 22_101, profile: profileA, profileDirectory: "Default" };
    const identityB = { pid: 22_102, profile: profileB, profileDirectory: "Default" };
    await expect(verifyProfile!(identityA)).resolves.toBe(String(identityA.pid));
    await expect(verifyProfile!(identityB)).resolves.toBe(String(identityB.pid));
    await expect(verifyProfile!(identityA)).resolves.toBe(String(identityA.pid));
    const verifications = extensionRequest.mock.calls.filter(([, , action]) => action === "extension-verify");
    expect(verifications.map(([, id, , extras]) => [id, extras?.extensionProcess])).toEqual([
      [anchorA, identityA], [anchorB, identityB], [anchorA, identityA],
    ]);
    await expect(verifyProfile!({ pid: 22_103, profile: "/future/chrome/unbound", profileDirectory: "Default" })).rejects.toThrow();

    expect(launch).toHaveBeenCalledOnce();
    const args = launch.mock.calls[0]![0];
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ForwardAgent=no");
    expect(args).toContain("ForwardX11=no");
    expect(args).toContain("ControlMaster=no");
    expect(args).toContain("ExitOnForwardFailure=yes");
    expect(args).toContain("-R");
    expect(args[args.indexOf("-R") + 1]).toBe("127.0.0.1:41235:127.0.0.1:41234");
    expect(args).not.toContain("-L");
    expect(args).not.toContain("ClearAllForwardings=yes");
    expect(args.join(" ")).not.toContain(token);
    expect(args.join(" ")).not.toMatch(/password|credential|secret/i);
  } finally { remote.dispose(); }
});

it("stages a remote file-status check against the saved browser anchor while keeping the frozen child advertiser on the file record", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qianchuan-extension-stage-")); roots.push(root);
  const bytes = Buffer.from("frozen fixture bytes"), snapshotPath = path.join(root, "snapshot.mp4");
  await writeFile(snapshotPath, bytes); await chmod(snapshotPath, 0o400);
  const digest = "a".repeat(64), childAdvertiserId = "9500000000000000001", anchorAdvertiserId = "9500000000000000002";
  const target: FrozenQianchuanAccount = {
    product: "氨糖膏", advertiserId: childAdvertiserId, adId: "9500000000000000011", configDigest: "b".repeat(64),
    cdpEndpoint: "http://127.0.0.1:52001", egress: route,
  };
  const savedAnchor: FrozenQianchuanAccount = { ...target, advertiserId: anchorAdvertiserId, adId: "9500000000000000012" };
  const authorization = { target, pageBatchId: randomUUID(), expectedCount: 1 };
  qianchuanSelectedAccountTargets.remember(authorization, savedAnchor);
  const request = vi.fn(async (action: RemoteRequest["action"], advertiserId: string, extras: Partial<Pick<RemoteRequest, "file">> = {}) => {
    if (action !== "file-status" || !extras.file) throw new Error("unexpected remote staging action");
    return { offset: bytes.length, complete: true, path: `/remote/${advertiserId}/${extras.file.sha256}/${extras.file.fileName}` };
  });
  const controller = new AbortController();
  const runtime = new QianchuanRemoteRuntime(() => ({ route, controller, request: request as never, close: vi.fn() }));
  const verify = vi.spyOn(runtime, "verify").mockResolvedValue({ identity: "fixture-route", signal: controller.signal });
  const task = {
    snapshotPath,
    authorization,
    input: { artifact_sha256: digest, size_bytes: bytes.length },
    result: { file_name: "snapshot.mp4", upload_outcome: "NOT_SELECTED" },
  } as unknown as UploadTaskRecord;
  try {
    await expect(runtime.stage(task, new AbortController().signal)).resolves.toBe(`/remote/${childAdvertiserId}/${digest}/snapshot.mp4`);
    expect(verify).toHaveBeenCalledWith(target.cdpEndpoint, route, anchorAdvertiserId);
    expect(request).toHaveBeenCalledOnce();
    const [action, fileAdvertiser, extras] = request.mock.calls[0]!;
    expect([action, fileAdvertiser]).toEqual(["file-status", childAdvertiserId]);
    expect(extras?.file).toMatchObject({ advertiserId: childAdvertiserId, sha256: digest });
    expect(qianchuanSelectedAccountTargets.browserAnchor(authorization)).toEqual(savedAnchor);
  } finally { runtime.dispose(); }
});
