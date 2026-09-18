import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";
import { openSourceStickerKnowledge } from "../src/main/source-sticker-knowledge-startup";

it("reports a bounded reason when explicit recovery cannot pass the format gate", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-source-knowledge-startup-"));
  try {
    const original = await SourceStickerKnowledgeStore.open(directory); await original.close();
    const format = path.join(original.directory, "format.json");
    await writeFile(format, '{"schemaVersion":999}');
    await mkdir(path.join(original.directory, "owner.lock"));
    const report = vi.fn(async () => {});

    await expect(openSourceStickerKnowledge(directory, { confirmRecovery: async () => true, reportRecoveryFailure: report })).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith("future_schema");
    expect(await readFile(format, "utf8")).toBe('{"schemaVersion":999}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("leaves an abandoned store untouched when recovery is declined", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-source-knowledge-startup-"));
  try {
    const original = await SourceStickerKnowledgeStore.open(directory); await original.close();
    await mkdir(path.join(original.directory, "owner.lock"));
    const report = vi.fn(async () => {});

    await expect(openSourceStickerKnowledge(directory, { confirmRecovery: async () => false, reportRecoveryFailure: report })).resolves.toBeUndefined();
    expect(report).not.toHaveBeenCalled();
    await expect(SourceStickerKnowledgeStore.open(directory)).rejects.toMatchObject({ code: "locked" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
