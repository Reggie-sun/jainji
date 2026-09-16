import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CoverReviewEvidence } from "../src/main/cover-review-evidence";
import { FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("cover review evidence", () => {
  it("accepts an empty manual-evidence set before its directory exists", async () => {
    const store = new CoverReviewEvidence(path.join(tmpdir(), `jianji-missing-evidence-${randomUUID()}`), {} as any);
    await expect(store.verify([])).resolves.toBeUndefined();
  });

  it("retains full-resolution PTS evidence while passing bounded detector images", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-evidence-extract-"));
    const source = path.join(directory, "source.mp4");
    const generated = await runCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12", "-t", "0.8", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]).promise;
    if (generated.code !== 0) throw new Error(generated.stderr);
    const media = { id: randomUUID(), sourcePath: source, displayName: "source.mp4", fingerprint: await fingerprintFile(source), sizeBytes: 1, durationMs: 800, width: 320, height: 180, rotation: 0 as const, probeStatus: "ready" as const, importedAt: new Date().toISOString() };
    const store = new CoverReviewEvidence(path.join(directory, "cover-review", randomUUID()), new FfmpegAdapter("ffmpeg", "ffprobe"));

    const extracted = await store.extract(media, randomUUID(), 0, new AbortController().signal);

    expect(extracted.frameTimesMs.length).toBeGreaterThan(8);
    expect(extracted.evidence.map((item) => item.width)).toEqual(expect.arrayContaining([320]));
    expect(extracted.images.every((image) => image.url.startsWith("data:image/jpeg;base64,"))).toBe(true);
    expect(extracted.evidence.map((item) => item.pts * item.timeBase * 1000)).toEqual(expect.arrayContaining(extracted.images.map((image) => image.timeMs)));
    await expect(store.verify(extracted.evidence)).resolves.toBeUndefined();
  });

  it("normalizes a shifted first decoded PTS while retaining its raw evidence timestamp", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-evidence-shifted-"));
    const source = path.join(directory, "shifted.mp4");
    const generated = await runCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12", "-vf", "setpts=PTS+5/TB", "-frames:v", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]).promise;
    if (generated.code !== 0) throw new Error(generated.stderr);
    const media = { id: randomUUID(), sourcePath: source, displayName: "shifted.mp4", fingerprint: await fingerprintFile(source), sizeBytes: 1, durationMs: 500, width: 160, height: 90, rotation: 0 as const, probeStatus: "ready" as const, importedAt: new Date().toISOString() };
    const extracted = await new CoverReviewEvidence(path.join(directory, "evidence", randomUUID()), new FfmpegAdapter("ffmpeg", "ffprobe")).extract(media, randomUUID(), 0, new AbortController().signal);
    expect(extracted.frameTimesMs[0]).toBe(0);
    expect(extracted.evidence[0].pts).toBeGreaterThan(0);
    expect(extracted.evidence[0].timeOriginSeconds).toBeCloseTo(5, 1);
  });

  it("extracts a 90-degree rotated source in its displayed geometry", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-evidence-rotated-"));
    const base = path.join(directory, "base.mp4"), source = path.join(directory, "rotated.mp4");
    const generated = await runCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12", "-t", "0.8", "-c:v", "libx264", base]).promise;
    if (generated.code !== 0) throw new Error(generated.stderr);
    const rotated = await runCommand("ffmpeg", ["-v", "error", "-i", base, "-c", "copy", "-metadata:s:v:0", "rotate=90", source]).promise;
    if (rotated.code !== 0) throw new Error(rotated.stderr);
    const media = { id: randomUUID(), sourcePath: source, displayName: "rotated.mp4", fingerprint: await fingerprintFile(source), sizeBytes: 1, durationMs: 800, width: 90, height: 160, rotation: 90 as const, probeStatus: "ready" as const, importedAt: new Date().toISOString() };
    const root = path.join(directory, "evidence", randomUUID());
    const extracted = await new CoverReviewEvidence(root, new FfmpegAdapter("ffmpeg", "ffprobe")).extract(media, randomUUID(), 0, new AbortController().signal);
    const evidencePath = path.join(root, extracted.evidence[0].relativePath);
    const probe = await runCommand("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", evidencePath]).promise;
    if (probe.code !== 0) throw new Error(probe.stderr);
    expect(probe.stdout.trim()).toBe("90,160");
    expect(extracted.evidence[0]).toMatchObject({ width: 90, height: 160, rotation: 90 });
  });

  it("cleans only a failed attempt when its second detector conversion fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-evidence-cleanup-"));
    const source = path.join(directory, "source.mp4");
    const generated = await runCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=4", "-t", "0.8", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]).promise;
    if (generated.code !== 0) throw new Error(generated.stderr);
    const media = { id: randomUUID(), sourcePath: source, displayName: "source.mp4", fingerprint: await fingerprintFile(source), sizeBytes: 1, durationMs: 800, width: 160, height: 90, rotation: 0 as const, probeStatus: "ready" as const, importedAt: new Date().toISOString() };
    const root = path.join(directory, "evidence", randomUUID()), draftId = randomUUID(), attempt = path.join(root, draftId, "r-0");
    await (await import("node:fs/promises")).mkdir(attempt, { recursive: true }); await writeFile(path.join(attempt, "keep.png"), "keep");
    const adapter = new FfmpegAdapter("ffmpeg", "ffprobe"), original = adapter.run.bind(adapter); let conversions = 0;
    vi.spyOn(adapter, "run").mockImplementation((args) => {
      if (args.at(-1)?.endsWith(".jpg") && ++conversions === 2) return { process: {} as any, promise: Promise.resolve({ code: 1, stdout: "", stderr: "fixture" }), cancel: async () => undefined };
      return original(args);
    });
    await expect(new CoverReviewEvidence(root, adapter).extract(media, draftId, 0, new AbortController().signal)).rejects.toThrow(/候选帧/);
    expect(await readdir(attempt)).toEqual(["keep.png"]);
  });

  it("accepts retained evidence only below the controlled real path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-evidence-"));
    const draftId = randomUUID(), relativePath = `${draftId}/r-0/frame.png`;
    const filePath = path.join(root, relativePath);
    await (await import("node:fs/promises")).mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "frame");
    const store = new CoverReviewEvidence(root, {} as any);
    const evidence = { id: randomUUID(), relativePath, digest: sha256("frame"), pts: 0, timeBase: 0.001, width: 100, height: 50, rotation: 0 as const, transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 } };

    await expect(store.verify([evidence])).resolves.toBeUndefined();
    await writeFile(filePath, "changed");
    await expect(store.verify([evidence])).rejects.toThrow(/校验/);
  });

  it("rejects an evidence symlink that resolves outside the controlled root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-evidence-root-"));
    const outside = path.join(await mkdtemp(path.join(tmpdir(), "jianji-evidence-outside-")), "frame.png");
    await writeFile(outside, "frame");
    const draftId = randomUUID(), relativePath = `${draftId}/r-0/frame.png`;
    await (await import("node:fs/promises")).mkdir(path.join(root, draftId, "r-0"), { recursive: true });
    await symlink(outside, path.join(root, relativePath));
    const store = new CoverReviewEvidence(root, {} as any);
    await expect(store.verify([{ id: randomUUID(), relativePath, digest: sha256("frame"), pts: 0, timeBase: 0.001, width: 1, height: 1, rotation: 0, transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 } }])).rejects.toThrow(/校验/);
  });

  it("returns contextual crops without retaining crop files and discards only unreferenced evidence", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-evidence-crops-"));
    const source = path.join(directory, "source.mp4");
    const generated = await runCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=4", "-t", "0.8", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]).promise;
    if (generated.code !== 0) throw new Error(generated.stderr);
    const media = { id: randomUUID(), sourcePath: source, displayName: "source.mp4", fingerprint: await fingerprintFile(source), sizeBytes: 1, durationMs: 800, width: 320, height: 180, rotation: 0 as const, probeStatus: "ready" as const, importedAt: new Date().toISOString() };
    const root = path.join(directory, "evidence", randomUUID()), store = new CoverReviewEvidence(root, new FfmpegAdapter("ffmpeg", "ffprobe"));
    const extracted = await store.extract(media, randomUUID(), 0, new AbortController().signal);
    const crops = await store.crops(extracted.evidence, [{ evidenceId: extracted.evidence[0].id, rectangle: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } }], new AbortController().signal);
    expect(crops).toHaveLength(1);
    expect(crops[0]).toMatchObject({ evidenceId: extracted.evidence[0].id, width: 129, height: 73, transform: { scaleX: 129 / 320, scaleY: 73 / 180 } });
    expect(crops[0].transform.offsetX).toBeCloseTo(0.3);
    expect(crops[0].transform.offsetY).toBeCloseTo(0.3);
    expect(crops[0].url).toMatch(/^data:image\/jpeg;base64,/);
    const evidenceDirectory = path.dirname(path.join(root, extracted.evidence[0].relativePath));
    expect((await readdir(evidenceDirectory)).some((name) => name.endsWith(".crop.jpg"))).toBe(false);
    await store.discardUnreferenced(extracted.evidence, [extracted.evidence[0]]);
    await expect(store.verify([extracted.evidence[0]])).resolves.toBeUndefined();
    expect(await readFile(source)).not.toHaveLength(0);
    expect((await readdir(evidenceDirectory)).filter((name) => name.endsWith(".png"))).toHaveLength(1);
  });
});
