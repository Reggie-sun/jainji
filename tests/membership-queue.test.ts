import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportQueue } from "../src/main/queue.js";
import { JobStore } from "../src/main/store.js";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem } from "../src/main/domain.js";
import { FfmpegAdapter } from "../src/main/ffmpeg.js";
import { fingerprintFile } from "../src/main/paths.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-member-queue-")); roots.push(root);
  const sourcePath = path.join(root, "source.mp4"); await writeFile(sourcePath, "synthetic");
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 9, durationMs: 1000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
  const authorize = vi.fn(async () => {});
  const run = vi.fn();
  const queue = new ExportQueue({ jobStore: new JobStore(path.join(root, "jobs")), authorize, ffmpeg: { ffmpegPath: "/fake/ffmpeg", run } as unknown as FfmpegAdapter, fontResolver: { resolve: async () => null } });
  const input = { projectId: crypto.randomUUID(), template: createDefaultTemplate(), mediaItems: [media], mediaIds: [media.id], preset: DEFAULT_PRESET, outputDirectory: path.join(root, "output") };
  return { queue, authorize, run, input, media, root };
}
describe("membership at canonical export queue", () => {
  it("denies normal, preview, approved-sample and retry paths before work", async () => {
    const f = await fixture(); f.authorize.mockRejectedValue(new Error("会员已失效"));
    await expect(f.queue.createBatch(f.input)).rejects.toThrow("会员已失效");
    await expect(f.queue.renderPreview({ ...f.input, media: f.media, cacheDirectory: f.root, signal: new AbortController().signal })).rejects.toThrow("会员已失效");
    await expect(f.queue.publishApprovedSample({ ...f.input, media: f.media, samplePath: f.media.sourcePath })).rejects.toThrow("会员已失效");
    await expect(f.queue.retry()).rejects.toThrow("会员已失效");
    expect(f.queue.snapshot().batches).toHaveLength(0); expect(f.run).not.toHaveBeenCalled();
  });
  it("checks again before queued work starts and still allows cancellation", async () => {
    const f = await fixture(); const batch = await f.queue.createBatch(f.input);
    f.authorize.mockRejectedValue(new Error("账号已在别处登录"));
    await f.queue.start(batch.id);
    expect(f.queue.snapshot().batches[0].batch.tasks[0].status).toBe("failed");
    expect(f.run).not.toHaveBeenCalled();
    await expect(f.queue.cancelAll(f.input.projectId)).resolves.toBeUndefined();
  });
});
