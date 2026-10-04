import { constants, copyFile, link, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactVerifier } from "../src/main/artifact";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem, type OutputArtifact } from "../src/main/domain";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { allocateOutputPath, fingerprintFile } from "../src/main/paths";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, link: vi.fn(actual.link), copyFile: vi.fn(actual.copyFile) };
});

afterEach(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(link).mockReset().mockImplementation(actual.link);
  vi.mocked(copyFile).mockReset().mockImplementation(actual.copyFile);
});

function denyLinks(code = "EPERM") {
  vi.mocked(link).mockRejectedValue(Object.assign(new Error(`link: ${code}`), { code }));
}

async function fixture(run: (args: string[], output: string) => Promise<{ code: number; stdout: string; stderr: string }>) {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-output-directory-"));
  const output = path.join(directory, "output");
  const sourcePath = path.join(directory, "source.mp4");
  await writeFile(sourcePath, "original");
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 8, durationMs: 1_000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
  const ffmpeg = {
    ffmpegPath: "/fake/ffmpeg",
    run: (args: string[]) => ({ process: {}, promise: run(args, output), cancel: async () => undefined }),
  } as unknown as FfmpegAdapter;
  const compiler = { compile: async (_template: unknown, _media: unknown, _preset: unknown, options: { textFilePath: (id: string) => string }) => {
    const textPath = options.textFilePath("price");
    return { binary: "/fake/ffmpeg", args: [textPath], textFiles: [{ layerId: "price", path: textPath, content: "19.9元" }], durationSeconds: 1 };
  } } as unknown as TemplateCompiler;
  const verifier = { verify: async (filePath: string, taskId: string): Promise<OutputArtifact> => ({ taskId, path: filePath, sizeBytes: 7, durationMs: 1_000, createdAt: now() }) } as unknown as ArtifactVerifier;
  const queue = new ExportQueue({ jobStore: new JobStore(path.join(directory, "jobs")), ffmpeg, compiler, artifactVerifier: verifier, fontResolver: { resolve: async () => null } });
  const batch = await queue.createBatch({ template: createDefaultTemplate(), mediaIds: [media.id], mediaItems: [media], outputDirectory: output, preset: DEFAULT_PRESET });
  return { directory, output, media, queue, batch };
}

describe("export output directory lifecycle", () => {
  it.each(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"])("publishes verified bytes without hard links (%s)", async (code) => {
    denyLinks(code);
    const { output, media, queue, batch } = await fixture(async (args) => {
      await writeFile(args.at(-1)!, "encoded");
      return { code: 0, stdout: "", stderr: "" };
    });
    await queue.start(batch.id);
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status, task.errorMessage).toBe("completed");
    expect(await readFile(task.outputPath!, "utf8")).toBe("encoded");
    expect(copyFile).toHaveBeenCalledWith(expect.any(String), task.outputPath, constants.COPYFILE_EXCL);
    expect(await readdir(output)).toEqual([path.basename(task.outputPath!)]);
    expect(await fingerprintFile(media.sourcePath)).toBe(media.fingerprint);
  });

  it.each([false, true])("preserves a file appearing after allocation (copy fallback: %s)", async (fallback) => {
    if (fallback) denyLinks();
    let occupied: string;
    const { output, queue, batch } = await fixture(async (args) => {
      await writeFile(occupied, "existing output");
      await writeFile(args.at(-1)!, "encoded");
      return { code: 0, stdout: "", stderr: "" };
    });
    occupied = batch.tasks[0].outputPath!;
    await queue.start(batch.id);
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status, task.errorMessage).toBe("completed");
    expect(task.outputPath).not.toBe(occupied);
    expect(await readFile(occupied, "utf8")).toBe("existing output");
    expect(await readFile(task.outputPath!, "utf8")).toBe("encoded");
    expect(await readdir(output)).toHaveLength(2);
    if (!fallback) expect(vi.mocked(copyFile).mock.calls.some(call => call[2] === constants.COPYFILE_EXCL)).toBe(false);
  });

  it("publishes concurrent approved samples to distinct files without re-rendering", async () => {
    denyLinks();
    const { directory, output, media, queue } = await fixture(async () => { throw new Error("must not render"); });
    const samples = [path.join(directory, "sample-a.mp4"), path.join(directory, "sample-b.mp4")];
    await Promise.all(samples.map((sample, index) => writeFile(sample, `approved-${index}`)));
    const published = await Promise.all(samples.map(samplePath => queue.publishApprovedSample({
      template: createDefaultTemplate(), media, preset: DEFAULT_PRESET, samplePath, outputDirectory: output,
    })));
    expect(new Set(published.map(item => item.outputPath)).size).toBe(2);
    for (const [index, item] of published.entries()) {
      expect(await fingerprintFile(item.outputPath)).toBe(await fingerprintFile(samples[index]));
    }
    expect(queue.snapshot().batches.slice(1).every(state => state.batch.tasks[0].status === "completed")).toBe(true);
    expect(await fingerprintFile(media.sourcePath)).toBe(media.fingerprint);
  });

  it("preserves dangling symlinks and advances past every occupied name", async () => {
    denyLinks();
    const { directory, output, media, queue, batch } = await fixture(async (args) => {
      await writeFile(args.at(-1)!, "encoded");
      return { code: 0, stdout: "", stderr: "" };
    });
    const occupied = [batch.tasks[0].outputPath!, path.join(output, "source_edited_1.mp4")];
    const absent = path.join(directory, "absent.mp4");
    for (const destination of occupied) await symlink(absent, destination);
    expect(await allocateOutputPath(output, media.sourcePath, "_edited")).toBe(path.join(output, "source_edited_2.mp4"));
    await queue.start(batch.id);
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status, task.errorMessage).toBe("completed");
    expect(task.outputPath).toBe(path.join(output, "source_edited_2.mp4"));
    for (const destination of occupied) expect(await readlink(destination)).toBe(absent);
  });

  it("does not bypass a link permission error", async () => {
    denyLinks("EACCES");
    const { queue, batch } = await fixture(async (args) => {
      await writeFile(args.at(-1)!, "encoded");
      return { code: 0, stdout: "", stderr: "" };
    });
    await queue.start(batch.id);
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status).toBe("failed");
    expect(task.outputArtifact).toBeUndefined();
    expect(vi.mocked(copyFile).mock.calls.some(call => call[2] === constants.COPYFILE_EXCL)).toBe(false);
  });

  it("keeps a failed exclusive copy out of completed exports", async () => {
    denyLinks();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(copyFile).mockImplementation(async (source, destination, mode) => {
      if (mode === constants.COPYFILE_EXCL) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      await actual.copyFile(source, destination, mode);
    });
    const { output, queue, batch } = await fixture(async (args) => {
      await writeFile(args.at(-1)!, "encoded");
      return { code: 0, stdout: "", stderr: "" };
    });
    await queue.start(batch.id);
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status).toBe("failed");
    expect(task.outputArtifact).toBeUndefined();
    expect(await readdir(output)).toEqual([]);
  });

  it("recreates a directory removed after enqueue before writing text and rendering", async () => {
    let calls = 0;
    const { output, media, queue, batch } = await fixture(async (args) => {
      calls += 1;
      expect(await readFile(args[0], "utf8")).toBe("19.9元");
      await writeFile(args.at(-1)!, "encoded");
      return { code: 0, stdout: "", stderr: "" };
    });
    await rm(output, { recursive: true });
    await queue.start(batch.id);
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status, task.errorMessage).toBe("completed");
    expect(calls).toBe(1);
    expect(await readFile(task.outputPath!, "utf8")).toBe("encoded");
    expect(await readdir(output)).toEqual([path.basename(task.outputPath!)]);
    expect(await fingerprintFile(media.sourcePath)).toBe(media.fingerprint);
  });

  it("retries an export whose directory disappeared during encoding using its frozen template", async () => {
    let calls = 0;
    const { output, queue, batch } = await fixture(async (args, outputDirectory) => {
      calls += 1;
      expect(await readFile(args[0], "utf8")).toBe("19.9元");
      await writeFile(args.at(-1)!, "encoded");
      if (calls === 1) {
        await rm(outputDirectory, { recursive: true });
        return { code: 1, stdout: "", stderr: "Unable to re-open output file for shifting data: No such file or directory" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    await queue.start(batch.id);
    let task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status).toBe("failed");
    expect(task.outputArtifact).toBeUndefined();
    await queue.retry([task.id]);
    const state = queue.snapshot().batches[0];
    task = state.batch.tasks[0];
    expect(task.status, task.errorMessage).toBe("completed");
    expect(calls).toBe(2);
    expect(task.attempt).toBe(2);
    expect(task.attempts).toHaveLength(1);
    expect(task.attempts[0].status).toBe("failed");
    expect(state.batch.templateSnapshot).toEqual(batch.templateSnapshot);
    expect(await readdir(output)).toEqual([path.basename(task.outputPath!)]);
  });

  it("fails before invoking FFmpeg when the output directory has been replaced by a file", async () => {
    let calls = 0;
    const { output, queue, batch } = await fixture(async () => {
      calls += 1;
      return { code: 0, stdout: "", stderr: "" };
    });
    await rm(output, { recursive: true });
    await writeFile(output, "keep this file");
    await queue.start(batch.id);
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status).toBe("failed");
    expect(task.startedAt).toBeUndefined();
    expect(calls).toBe(0);
    expect(await readFile(output, "utf8")).toBe("keep this file");
  });
});
