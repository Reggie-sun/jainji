import { mkdtemp, mkdir, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  find: vi.fn(), verify: vi.fn(), metadata: vi.fn(), register: vi.fn(), install: vi.fn(),
}));

vi.mock("../src/main/qianchuan-extension-process", () => ({
  findExtensionProcess: calls.find,
  verifyExtensionProcess: calls.verify,
  readExtensionBrowserMetadata: calls.metadata,
}));
vi.mock("../src/main/qianchuan-extension-install", () => ({
  registerQianchuanExtensionProfile: calls.register,
  installQianchuanExtensionHost: calls.install,
}));

import { RemoteExtensionHost } from "../src/main/qianchuan-extension-remote-worker";
import { RemoteWorker } from "../src/main/qianchuan-remote-worker";

describe("remote browser metadata RPC", () => {
  let root: string;
  let profile: string;
  const identity = { pid: 45, profile: "", profileDirectory: "Default" };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "jianji-remote-browser-profile-"));
    profile = path.join(root, "browsers", "account-browsers", "123");
    await mkdir(path.join(profile, "Default"), { recursive: true, mode: 0o700 });
    await chmod(profile, 0o700);
    identity.profile = profile;
    calls.find.mockReset().mockResolvedValue(identity);
    calls.verify.mockReset().mockResolvedValue("12345");
    calls.metadata.mockReset().mockResolvedValue({ port: 43123, browserPath: "/devtools/browser/abc-123" });
    calls.register.mockReset().mockResolvedValue(undefined);
    calls.install.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("returns only the verified profile and live browser metadata without native-host registration", async () => {
    const result = await new RemoteExtensionHost(root, root).browserProfile("123");
    expect(result).toEqual({
      profile, profileDirectory: "Default", processId: 45, startedAt: "12345",
      browser: { port: 43123, browserPath: "/devtools/browser/abc-123" },
    });
    expect(calls.find).toHaveBeenCalledWith(profile, "Default");
    expect(calls.verify).toHaveBeenCalledTimes(2);
    expect(calls.metadata).toHaveBeenCalledWith(identity);
    expect(calls.register).not.toHaveBeenCalled();
    expect(calls.install).not.toHaveBeenCalled();
  });

  it("routes browser-profile through the remote worker without extension setup", async () => {
    const route = { mode: "remote-browser" as const, group: "fixture", sshHost: "fixture-host", expectedIp: "8.8.8.8", localPort: 19381 };
    const result = await new RemoteWorker(root, root).handle({ version: 1, route, action: "browser-profile", advertiserId: "123", bodyBytes: 0 }, Buffer.alloc(0));
    expect(result).toEqual({
      profile, profileDirectory: "Default", processId: 45, startedAt: "12345",
      browser: { port: 43123, browserPath: "/devtools/browser/abc-123" },
    });
    expect(calls.register).not.toHaveBeenCalled();
    expect(calls.install).not.toHaveBeenCalled();
  });

  it("rejects process replacement during the metadata read and missing browser identity", async () => {
    calls.verify.mockReset().mockResolvedValueOnce("12345").mockResolvedValueOnce("12346");
    await expect(new RemoteExtensionHost(root, root).browserProfile("123")).rejects.toThrow();
    expect(calls.register).not.toHaveBeenCalled();

    calls.verify.mockReset().mockResolvedValue("12345");
    calls.metadata.mockResolvedValue({ port: 43123 });
    await expect(new RemoteExtensionHost(root, root).browserProfile("123")).rejects.toThrow();
  });

  it("preserves the existing extension-profile registration path", async () => {
    await expect(new RemoteExtensionHost(root, root).profile("123")).resolves.toEqual({
      profile, profileDirectory: "Default", browser: { port: 43123, browserPath: "/devtools/browser/abc-123" },
    });
    expect(calls.register).toHaveBeenCalledWith(root, profile);
    expect(calls.install).not.toHaveBeenCalled();
  });
});
