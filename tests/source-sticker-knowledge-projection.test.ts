import { expect, it } from "vitest";
import { projectKnowledgeRisks } from "../src/main/source-sticker-knowledge-projection";
import type { QueueSnapshot } from "../src/main/queue";

const snapshot = { batches: [
  { batch: { templateSnapshot: {}, tasks: [{ id: "legacy" }] } },
  { batch: { templateSnapshot: { sourceStickerKnowledge: { sourceKey: "a", revisionId: "old" } }, tasks: [{ id: "old1" }, { id: "old2" }] } },
  { batch: { templateSnapshot: { sourceStickerKnowledge: { sourceKey: "a", revisionId: "current" } }, tasks: [{ id: "new" }] } },
] } as unknown as QueueSnapshot;
it("projects historical disputed revisions without touching frozen tasks or consulting the current run", async () => {
  const before = structuredClone(snapshot);
  const result = await projectKnowledgeRisks(snapshot, { revisionRisk: async (_key, revision) => revision === "old" ? "disputed" : "none" });
  expect(result).toEqual({ old1: "disputed", old2: "disputed" });
  expect(snapshot).toEqual(before);
});
it("degrades unavailable/corrupt history to an informational unknown without failing queue state", async () => {
  expect(await projectKnowledgeRisks(snapshot)).toEqual({ old1: "unknown", old2: "unknown", new: "unknown" });
  expect(await projectKnowledgeRisks(snapshot, { revisionRisk: async () => { throw new Error("private path"); } })).toEqual({ old1: "unknown", old2: "unknown", new: "unknown" });
});
it("coalesces and reuses an unchanged project projection beyond the per-source cache working set", async () => {
  const many = { batches: Array.from({ length: 129 }, (_, i) => ({ batch: { templateSnapshot: { sourceStickerKnowledge: { sourceKey: `key-${i}`, revisionId: "r" } }, tasks: [{ id: `task-${i}` }] } })) } as unknown as QueueSnapshot;
  let calls = 0;
  const store = { historyGeneration: 0, revisionRisk: async () => { calls++; return "none" as const; } };
  await Promise.all([projectKnowledgeRisks(many, store), projectKnowledgeRisks(many, store)]);
  await projectKnowledgeRisks(structuredClone(many), store);
  expect(calls).toBe(129);
  store.historyGeneration++;
  await projectKnowledgeRisks(many, store);
  expect(calls).toBe(258);
});
