import { describe, expect, it } from "vitest";
import { RemoteRequestSchema } from "../src/shared/qianchuan-remote";
import { sshRemoteArguments, RemoteFrames } from "../src/main/qianchuan-remote-transport";

const route = { mode: "remote-browser" as const, group: "one", sshHost: "shop-one", expectedIp: "8.8.8.8", localPort: 19381 };
describe("remote browser transport", () => {
  it("pins authentication, disables inherited forwarding and never accepts command text from config", () => {
    const args = sshRemoteArguments(route);
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ClearAllForwardings=yes");
    expect(args).toContain("ForwardAgent=no");
    expect(args.at(-1)).toBe('exec node "$HOME/.local/share/jianji-remote/worker.cjs"');
    expect(() => sshRemoteArguments({ ...route, sshHost: "a;touch /tmp/x" })).toThrow();
  });
  it("decodes fragmented headers and binary chunks without treating payload newlines as commands", () => {
    const frames = new RemoteFrames();
    const request = { version: 1, route, action: "file-append", advertiserId: "123", file: { advertiserId: "123", sha256: "a".repeat(64), size: 5, fileName: "视频.mp4" }, offset: 0, bodyBytes: 5 };
    const buffer = Buffer.concat([Buffer.from(JSON.stringify(request) + "\n"), Buffer.from([0, 10, 255, 13, 1])]);
    expect(frames.push(buffer.subarray(0, 15))).toEqual([]);
    const result = frames.push(buffer.subarray(15));
    expect(result).toHaveLength(1); expect(result[0].body).toEqual(Buffer.from([0, 10, 255, 13, 1]));
  });
  it("rejects unbounded frames, cross-account files and request bodies on browser operations", () => {
    expect(() => new RemoteFrames().push(Buffer.alloc(16385, 65))).toThrow();
    const request = { version: 1, route, action: "open", advertiserId: "123", bodyBytes: 1 };
    expect(RemoteRequestSchema.safeParse(request).success).toBe(false);
    expect(RemoteRequestSchema.safeParse({ ...request, action: "file-status", bodyBytes: 0, file: { advertiserId: "456", sha256: "a".repeat(64), size: 1, fileName: "a.mp4" } }).success).toBe(false);
  });
  it("accepts display labels only on the zero-body desktop synchronization action", () => {
    const request = { version: 1, route, action: "desktop-sync", advertiserId: "123", bodyBytes: 0, displayName: "予浅好物" };
    expect(RemoteRequestSchema.safeParse(request).success).toBe(true);
    for (const value of [{ ...request, bodyBytes: 1 }, { ...request, displayName: "\nExec=bad" }, { ...request, displayName: undefined }, { ...request, action: "probe" }]) {
      expect(RemoteRequestSchema.safeParse(value).success).toBe(false);
    }
  });
});
