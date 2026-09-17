import type { QueueSnapshot } from "./queue.js";
import type { SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";

type HistoryReader = Pick<SourceStickerKnowledgeStore, "revisionRisk"> & Partial<Pick<SourceStickerKnowledgeStore, "historyGeneration">>;
type Risks = Record<string, "disputed" | "unknown">;
// Only one current reference set per owner, including concurrent readers. It is
// disposable UI metadata, not fact state. An older pending read cannot overwrite
// a later generation's entry; no cache mutation occurs after awaiting its result.
const projections = new WeakMap<HistoryReader, { key: string; result: Promise<Risks> }>();
export async function projectKnowledgeRisks(snapshot: QueueSnapshot, store?: HistoryReader): Promise<Risks> {
  if (!store || store.historyGeneration === undefined) return readRisks(snapshot, store);
  const key = JSON.stringify([store.historyGeneration, snapshot.batches.map(({ batch }) => [batch.templateSnapshot.sourceStickerKnowledge, batch.tasks.map(task => task.id)])]);
  let cached = projections.get(store);
  if (cached?.key !== key) {
    cached = { key, result: readRisks(snapshot, store) };
    projections.set(store, cached);
  }
  return { ...await cached.result };
}
async function readRisks(snapshot: QueueSnapshot, store?: HistoryReader): Promise<Risks> {
  const result: Record<string, "disputed" | "unknown"> = {};
  const checked = new Map<string, "none" | "disputed" | "unknown">();
  for (const { batch } of snapshot.batches) {
    const reference = batch.templateSnapshot.sourceStickerKnowledge;
    if (!reference) continue;
    const key = `${reference.sourceKey}:${reference.revisionId}`;
    let risk = checked.get(key);
    if (!risk) {
      risk = await store?.revisionRisk(reference.sourceKey, reference.revisionId).catch(() => "unknown" as const) ?? "unknown";
      checked.set(key, risk);
    }
    if (risk !== "none") for (const task of batch.tasks) result[task.id] = risk;
  }
  return result;
}
