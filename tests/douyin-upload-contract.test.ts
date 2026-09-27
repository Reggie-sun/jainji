import { describe, expect, it } from "vitest";
import { DouyinUploadConfigSchema, DouyinUploadSelectionSchema, FinalArtifactInputSchema, UploadResultSchema, isLoopbackUrl } from "../src/shared/douyin-upload";

describe("Douyin upload contracts", () => {
  it("defaults disabled, preserves manual caption and rejects renderer browser commands", () => {
    expect(DouyinUploadConfigSchema.parse({}).enabled).toBe(false);
    expect(DouyinUploadSelectionSchema.parse({ enabled: true, caption: "  用户文案\n" }).caption).toBe("  用户文案\n");
    expect(DouyinUploadSelectionSchema.safeParse({ enabled: true, video_path: "/tmp/video.mp4" }).success).toBe(false);
    expect(DouyinUploadConfigSchema.safeParse({ selector: "button" }).success).toBe(false);
  });
  it.each(["http://localhost:9222", "http://192.168.1.2:9222", "https://127.0.0.1:9222", "http://user:pass@127.0.0.1:9222", "http://127.0.0.1:9222/?token=x"])("rejects unsafe CDP %s", cdpEndpoint => {
    expect(DouyinUploadConfigSchema.safeParse({ cdpEndpoint }).success).toBe(false);
  });
  it("validates discovery websocket independently and finite per-stage deadlines", () => {
    expect(isLoopbackUrl("ws://127.0.0.1:9222/devtools/browser/a", true)).toBe(true);
    expect(isLoopbackUrl("ws://remote.test/devtools/browser/a", true)).toBe(false);
    for (const value of [0, Infinity, -1, NaN]) expect(DouyinUploadConfigSchema.safeParse({ timeouts: { action: value } }).success).toBe(false);
    expect(DouyinUploadConfigSchema.safeParse({ uploadPageUrl: "https://evil.test/upload" }).success).toBe(false);
    expect(DouyinUploadConfigSchema.safeParse({ uploadPageUrl: "https://creator.douyin.com/unverified" }).success).toBe(false);
  });
  it("rejects internal artifact fields from incomplete requests", () => {
    expect(FinalArtifactInputSchema.safeParse({ project_id: crypto.randomUUID(), batch_id: crypto.randomUUID(), export_task_id: crypto.randomUUID(), video_path: "relative.mp4", artifact_sha256: "a".repeat(64), size_bytes: 1 }).success).toBe(false);
    expect(UploadResultSchema.safeParse({ state: "SUCCEEDED" }).success).toBe(false);
  });
});
