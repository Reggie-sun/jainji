import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactVerifier } from "../src/main/artifact";
import { CoverDiagnostics } from "../src/main/cover-diagnostics";
import type { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem, type OutputArtifact } from "../src/main/domain";
import type { FfmpegAdapter } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type Command = {
  args: string[];
  cancel: ReturnType<typeof vi.fn>;
  finish: (code?: number) => void;
};

async function fixture(verifier?: ArtifactVerifier, limits = { analysis: 1, exports: 2, threads: 2 }) {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-preview-diagnostics-"));
  const sourcePath = path.join(directory, "source.mp4");
  await writeFile(sourcePath, "source");
  const media: MediaItem = {
    id: crypto.randomUUID(), sourcePath, fingerprint: await fingerprintFile(sourcePath), displayName: "source.mp4",
    sizeBytes: 6, durationMs: 1_000, width: 10, height: 10, rotation: 0, importedAt: now(), probeStatus: "ready",
  };
  const commands: Command[] = [];
  const ffmpeg = {
    ffmpegPath: "/fake/ffmpeg",
    run: vi.fn((args: string[]) => {
      const result = deferred<{ code: number; stdout: string; stderr: string }>();
      const command: Command = {
        args,
        cancel: vi.fn(async () => result.resolve({ code: 130, stdout: "", stderr: "cancelled" })),
        finish: (code = 0) => result.resolve({ code, stdout: "", stderr: "" }),
      };
      commands.push(command);
      return { process: {}, promise: result.promise, cancel: command.cancel };
    }),
  } as unknown as FfmpegAdapter;
  const artifactVerifier = verifier ?? {
    verify: vi.fn(async (filePath: string, taskId: string): Promise<OutputArtifact> => ({ taskId, path: filePath, sizeBytes: 1, durationMs: 1_000, createdAt: now() })),
  } as unknown as ArtifactVerifier;
  const queue = new ExportQueue({
    jobStore: new JobStore(path.join(directory, "jobs")), ffmpeg,
    compiler: { compile: async () => ({ binary: "/fake", args: [], textFiles: [], durationSeconds: 1 }) } as unknown as TemplateCompiler,
    artifactVerifier, fontResolver: { resolve: async () => null }, executionLimits: limits,
  });
  const input = (diagnostics: CoverDiagnostics, signal = new AbortController().signal) => ({
    template: createDefaultTemplate(), media, preset: DEFAULT_PRESET, cacheDirectory: path.join(directory, "cache"), signal, diagnostics,
  });
  return { commands, directory, input, media, queue };
}

function stages(diagnostics: CoverDiagnostics, stage: string) {
  return diagnostics.state.events.filter((event) => event.stage === stage);
}

describe("cover preview queue diagnostics", () => {
  it("runs previews concurrently in the render lane and records each one's spans", async () => {
    const f = await fixture();
    const firstDiagnostics = new CoverDiagnostics().scope("preview");
    const secondDiagnostics = new CoverDiagnostics().scope("preview");
    const first = f.queue.renderPreview(f.input(firstDiagnostics));
    const second = f.queue.renderPreview(f.input(secondDiagnostics));
    await vi.waitFor(() => expect(f.commands).toHaveLength(2));
    expect(stages(firstDiagnostics, "full-render")[0]).toMatchObject({ outcome: "running" });
    expect(stages(secondDiagnostics, "full-render")[0]).toMatchObject({ outcome: "running" });
    expect(stages(secondDiagnostics, "queue-wait")[0]).toMatchObject({ outcome: "ok", durationMs: expect.any(Number) });

    f.commands[0].finish();
    f.commands[1].finish();
    await first;
    await second;

    for (const diagnostics of [firstDiagnostics, secondDiagnostics]) {
      expect(stages(diagnostics, "queue-wait")[0]).toMatchObject({ phase: "preview", outcome: "ok", durationMs: expect.any(Number) });
      expect(stages(diagnostics, "full-render")[0]).toMatchObject({ phase: "preview", outcome: "ok", durationMs: expect.any(Number) });
      expect(stages(diagnostics, "artifact-verify")[0]).toMatchObject({ phase: "preview", outcome: "ok", durationMs: expect.any(Number) });
    }
    expect(f.queue.snapshot().batches).toEqual([]);
  });

  it("starts a waiting preview before queued export tasks when a render slot frees", async () => {
    const f = await fixture(undefined, { analysis: 1, exports: 1, threads: 2 });
    f.queue.setMediaLookup(() => f.media);
    const batch = await f.queue.createBatch({
      template: createDefaultTemplate(), mediaIds: [f.media.id, f.media.id], mediaItems: [f.media, f.media],
      outputDirectory: path.join(f.directory, "output"), preset: DEFAULT_PRESET,
    });
    const finished = f.queue.start(batch.id);
    await vi.waitFor(() => expect(f.commands).toHaveLength(1));
    const firstTaskOutput = f.commands[0].args[f.commands[0].args.length - 1];

    const previewDiagnostics = new CoverDiagnostics().scope("preview");
    const preview = f.queue.renderPreview(f.input(previewDiagnostics));
    await vi.waitFor(() => expect(stages(previewDiagnostics, "queue-wait")[0]?.outcome).toBe("running"));
    expect(f.commands).toHaveLength(1);

    f.commands[0].finish();
    await vi.waitFor(() => expect(f.commands).toHaveLength(2));
    // The preview jumps ahead of the still-queued second export task.
    expect(f.commands[1].args[f.commands[1].args.length - 1]).toContain("cache");
    expect(firstTaskOutput).not.toContain("cache");
    expect(stages(previewDiagnostics, "queue-wait")[0]).toMatchObject({ outcome: "ok", durationMs: expect.any(Number) });

    f.commands[1].finish();
    await preview;
    await vi.waitFor(() => expect(f.commands).toHaveLength(3));
    expect(f.commands[2].args[f.commands[2].args.length - 1]).not.toContain("cache");
    f.commands[2].finish();
    await finished;
  });

  it("records cancellation while a preview waits for a render slot", async () => {
    const f = await fixture();
    const first = f.queue.renderPreview(f.input(new CoverDiagnostics().scope("preview")));
    const second = f.queue.renderPreview(f.input(new CoverDiagnostics().scope("preview")));
    await vi.waitFor(() => expect(f.commands).toHaveLength(2));
    const waitingDiagnostics = new CoverDiagnostics().scope("preview");
    const cancellation = new AbortController();
    const waiting = f.queue.renderPreview(f.input(waitingDiagnostics, cancellation.signal));
    await vi.waitFor(() => expect(stages(waitingDiagnostics, "queue-wait")[0]?.outcome).toBe("running"));
    cancellation.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(stages(waitingDiagnostics, "queue-wait")[0]).toMatchObject({ outcome: "cancelled", reason: "cancelled" });
    f.commands[0].finish();
    f.commands[1].finish();
    await first;
    await second;
    expect(f.commands).toHaveLength(2);
  });

  it("keeps bounded cancelled and verification-failed preview observations out of queue state", async () => {
    const failingVerifier = { verify: vi.fn(async () => { throw new Error("sensitive verifier details"); }) } as unknown as ArtifactVerifier;
    const f = await fixture(failingVerifier);
    const cancelledDiagnostics = new CoverDiagnostics().scope("preview");
    const cancellation = new AbortController();
    const cancelled = f.queue.renderPreview(f.input(cancelledDiagnostics, cancellation.signal));
    await vi.waitFor(() => expect(f.commands).toHaveLength(1));
    cancellation.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(stages(cancelledDiagnostics, "full-render")[0]).toMatchObject({ outcome: "cancelled" });

    const failedDiagnostics = new CoverDiagnostics().scope("preview");
    const failed = f.queue.renderPreview(f.input(failedDiagnostics));
    await vi.waitFor(() => expect(f.commands).toHaveLength(2));
    f.commands[1].finish();
    await expect(failed).rejects.toThrow("sensitive verifier details");
    expect(stages(failedDiagnostics, "artifact-verify")[0]).toMatchObject({ outcome: "failed" });
    expect(failedDiagnostics.state.events.some((event) => JSON.stringify(event).includes("sensitive verifier details"))).toBe(false);
    expect(f.queue.snapshot().batches).toEqual([]);
  });
});
