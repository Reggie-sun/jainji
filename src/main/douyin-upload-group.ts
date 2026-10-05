import type { QueueState } from "./domain.js";
import { intentKey, type DouyinUploadStore, type UploadTaskRecord } from "./douyin-upload-store.js";

/** A completed export still needs formal artifact admission before a short tail can flush. */
export async function uploadBatchSettled(store: DouyinUploadStore, first: UploadTaskRecord, cancelled: ReadonlySet<string>, loadBatch: (id: string) => Promise<QueueState>, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const intents = store.intents().filter(intent => intent.authorization.pageBatchId === first.authorization.pageBatchId);
  if (intents.length !== first.authorization.expectedCount) return false;
  const admitted = new Set(store.tasks().filter(task => task.authorization.pageBatchId === first.authorization.pageBatchId).map(task => intentKey(task.input)));
  const missing = intents.filter(intent => !admitted.has(intentKey(intent)) && !cancelled.has(intentKey(intent)));
  const states = new Map<string, QueueState>();
  for (const intent of missing) {
    signal.throwIfAborted();
    let state = states.get(intent.batch_id);
    if (!state) {
      try { state = await loadBatch(intent.batch_id); } catch { signal.throwIfAborted(); return false; }
      signal.throwIfAborted(); states.set(intent.batch_id, state);
    }
    const task = state.batch.tasks.find(task => task.id === intent.export_task_id);
    if (state.batch.id !== intent.batch_id || state.batch.projectId !== intent.project_id || !task || !["failed", "cancelled", "interrupted"].includes(task.status)) return false;
  }
  return true;
}
