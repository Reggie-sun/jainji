import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactVerifier } from "../src/main/artifact";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem, type OutputArtifact } from "../src/main/domain";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";

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
