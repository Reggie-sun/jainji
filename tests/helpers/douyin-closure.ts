import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DouyinUploadStore, frozenInputDigest, uploadTaskId } from "../../src/main/douyin-upload-store";
import { QianchuanUploadConfigSchema, uploadFailure, type UploadAuthorization } from "../../src/shared/douyin-upload";

export async function closureFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-closure-")), store = new DouyinUploadStore(root);
  await store.load(); const config = QianchuanUploadConfigSchema.parse({ enabled: true }); await store.setConfig(config);
  const project_id = randomUUID();
  async function batch(count = 3, projectId = project_id) {
    const batch_id = randomUUID();
    const authorization: UploadAuthorization = { target: { product: "热敷贴", cdpEndpoint: "http://127.0.0.1:1", advertiserId: "123", adId: "456", configDigest: "a".repeat(64) }, pageBatchId: randomUUID(), expectedCount: count };
    for (let index = 0; index < count; index++) {
      const input = { project_id: projectId, batch_id, export_task_id: randomUUID(), video_path: `/tmp/${batch_id}-${index}.mp4`, artifact_sha256: createHash("sha256").update(`${batch_id}-${index}`).digest("hex"), size_bytes: 10 };
      await store.saveIntents([{ project_id: projectId, batch_id, export_task_id: input.export_task_id, authorization, config, selection: { enabled: true, accountProduct: "热敷贴" } }]);
      await store.saveTask({ input, inputDigest: frozenInputDigest(input, authorization), authorization, config, snapshotPath: input.video_path, result: { project_id: projectId, batch_id, export_task_id: input.export_task_id, artifact_sha256: input.artifact_sha256, upload_task_id: uploadTaskId(input, authorization.target), file_name: path.basename(input.video_path), advertiserId: "123", adId: "456", accountProduct: "热敷贴", state: "PENDING", upload_outcome: "NOT_SELECTED", retryable: false, retry_count: 0, attempt_count: index < 2 ? 1 : 0, timestamp: new Date().toISOString() } });
    }
    return store.tasks().filter(task => task.authorization.pageBatchId === authorization.pageBatchId);
  }
  const tasks = await batch(), ownership = { targetId: "lost-original", pageBatchId: tasks[0]!.authorization.pageBatchId, modalSessionId: randomUUID() };
  for (let index = 0; index < 2; index++) await store.markSelecting(tasks[index]!.result.upload_task_id, ownership, index + 1);
  const ready = store.task(tasks[0]!.result.upload_task_id)!;
  ready.result = { ...ready.result, state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY", readyEvidence: { advertiserId: "123", adId: "456", fileName: ready.result.file_name, selectedCount: 2, observedAt: new Date().toISOString(), pageOwnership: ownership } };
  await store.saveTask(ready);
  const unknown = store.task(tasks[1]!.result.upload_task_id)!;
  unknown.result.state = "NEEDS_HUMAN"; unknown.result.failure = uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "原tab丢失的精确诊断", "只读核查", true).failure;
  await store.saveTask(unknown);
  return { root, store, project_id, batch, tasks: store.tasks(), id: ready.result.upload_task_id, unknownId: unknown.result.upload_task_id };
}
