import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";

const stores: SourceStickerKnowledgeStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });
function outcome(id: string, result: "queued" | "failed" | "cancelled" = "queued") {
  return { schemaVersion: 1 as const, id, runId: `run-${id}`, projectId: "project", mediaId: "media", version: 1,
    startedAt: "2026-09-18T00:00:00.000Z", finishedAt: "2026-09-18T00:00:01.000Z", elapsedMs: 1000,
    result, stage: "enqueue" as const, lookup: "hit" as const, sourceKey: "a".repeat(64), revisionId: "revision",
    requests: { executor: 0, recognitionSupervisor: 0, previewSupervisor: 1, creative: 2 }, requestMetric: "provider-invocations" as const, revisions: 0, renders: 1,
    modelVerdict: "passed" as const, quality: "not-evaluated" as const, sourceIssueReported: false };
}
it("keeps cold/warm, failed and cancelled production records independently across restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-knowledge-audit-"));
  const store = await SourceStickerKnowledgeStore.open(root); stores.push(store);
  for (const [id, result] of [["cold", "queued"], ["warm", "queued"], ["failed", "failed"], ["cancelled", "cancelled"]] as const) await store.recordOutcome(outcome(id, result));
  await store.close(); const reopened = await SourceStickerKnowledgeStore.open(root); stores.push(reopened);
  expect((await reopened.listOutcomes("project")).map(row => [row.id, row.result])).toEqual([["cold", "queued"], ["warm", "queued"], ["failed", "failed"], ["cancelled", "cancelled"]]);
  expect(await reopened.listOutcomes("another-project")).toEqual([]);
  await expect(reopened.recordOutcome({ ...outcome("warm"), result: "failed" })).rejects.toThrow();
  await reopened.recordOutcome(outcome("warm"));
  expect(await reopened.listOutcomes()).toHaveLength(4);
});
it("keeps the last committed audit and removes only its uncommitted copy after repeated write failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-knowledge-audit-")); let fail = false;
  const store = await SourceStickerKnowledgeStore.open(root, { fault: point => { if (fail && point === "after_outcome_write") throw new Error("disk failure"); } }); stores.push(store);
  await store.recordOutcome(outcome("saved")); fail = true;
  for (let i = 0; i < 3; i++) await expect(store.recordOutcome(outcome(`failed-${i}`))).rejects.toThrow("disk failure");
  expect((await store.listOutcomes()).map(row => row.id)).toEqual(["saved"]);
  expect((await readdir(store.directory)).filter(name => name.startsWith("outcomes.json.tmp-"))).toEqual([]);
  fail = false; await store.recordOutcome(outcome("later"));
  expect((await store.listOutcomes()).map(row => row.id)).toEqual(["saved", "later"]);
});
it("rejects sensitive/unsupported fields and preserves unknown audit formats", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-knowledge-audit-"));
  const store = await SourceStickerKnowledgeStore.open(root); stores.push(store);
  await expect(store.recordOutcome({ ...outcome("bad"), apiKey: "private" } as never)).rejects.toThrow();
  await store.recordOutcome(outcome("ok"));
  const file = path.join(store.directory, "outcomes.json"); await writeFile(file, '{"schemaVersion":999}');
  await expect(store.recordOutcome(outcome("new"))).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe('{"schemaVersion":999}');
});
it("bounds diagnostic retention without touching source records or accepting truncated data", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-knowledge-audit-"));
  const store = await SourceStickerKnowledgeStore.open(root); stores.push(store);
  // Fill the on-disk retention window with valid deterministic records.
  await writeFile(path.join(store.directory, "outcomes.json"), JSON.stringify({ schemaVersion: 1, records: Array.from({ length: 1000 }, (_, i) => outcome(`old-${i}`)) }));
  await store.recordOutcome(outcome("new"));
  const records = await store.listOutcomes();
  expect(records).toHaveLength(1000); expect(records[0].id).toBe("old-1"); expect(records.at(-1)?.id).toBe("new");
  await writeFile(path.join(store.directory, "outcomes.json"), '{"schemaVersion":1,"records":[');
  await expect(store.listOutcomes()).rejects.toThrow();
  await expect(store.recordOutcome(outcome("later"))).rejects.toThrow();
});
