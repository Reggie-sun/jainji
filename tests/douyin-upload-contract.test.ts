import { describe, expect, it } from "vitest";
import { DouyinUploadConfigSchema, DouyinUploadSelectionSchema, FinalArtifactInputSchema, UploadResultSchema, isLoopbackUrl } from "../src/shared/douyin-upload";
import { QianchuanUploadSelectionSchema, QianchuanUploadConfigSchema, FrozenAccountSchema, QianchuanUploadResultSchema } from "../src/shared/douyin-upload";

describe("Qianchuan v2 request and frozen contracts", () => {
  it("requires an explicit product and refuses legacy captions or arbitrary target fields", () => {
    expect(QianchuanUploadSelectionSchema.parse({ enabled: true, accountProduct: "眼贴" })).toEqual({ enabled: true, accountProduct: "眼贴" });
    for (const input of [{ enabled: true }, { enabled: true, caption: "manual" }, { enabled: true, accountProduct: "unknown" }, { enabled: true, accountProduct: "眼贴", advertiserId: "123" }]) {
      expect(QianchuanUploadSelectionSchema.safeParse(input).success).toBe(false);
    }
  });
  it("defaults disabled and prohibits global browser routes", () => {
    expect(QianchuanUploadConfigSchema.parse({}).enabled).toBe(false);
    for (const input of [{ cdpEndpoint: "http://127.0.0.1:9222" }, { uploadPageUrl: "https://qianchuan.jinritemai.com/uni-prom" }, { accountConfigPath: "relative.json" }]) {
      expect(QianchuanUploadConfigSchema.safeParse(input).success).toBe(false);
    }
  });
  it("requires complete IDs and a bound digest for a frozen account", () => {
    const target = { product: "眼贴", cdpEndpoint: "http://127.0.0.1:9225", advertiserId: "9007199254740993", adId: "123", configDigest: "a".repeat(64) };
    expect(FrozenAccountSchema.parse(target).advertiserId).toBe("9007199254740993");
    expect(FrozenAccountSchema.safeParse({ ...target, adId: "" }).success).toBe(false);
    expect(FrozenAccountSchema.safeParse({ ...target, configDigest: "bad" }).success).toBe(false);
  });
  it("cannot turn a creator success or weak ready assertion into a Qianchuan result", () => {
    expect(QianchuanUploadResultSchema.safeParse({ state: "SUCCEEDED" }).success).toBe(false);
    expect(QianchuanUploadResultSchema.safeParse({ state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY" }).success).toBe(false);
  });
});

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
