import { setTimeout as delay } from "node:timers/promises";
import type { BatchProductionController } from "./batch-production-controller.js";
import type { ExportQueue } from "./queue.js";
import { MAX_UPLOAD_GROUP_SIZE } from "./douyin-upload-service.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import type { QianchuanUploadSelection, UploadIdentity } from "../shared/douyin-upload.js";

export interface AutomationUploadGroup {
  selection: QianchuanUploadSelection;
  target: FrozenQianchuanAccount;
  exports: UploadIdentity[];
}
export interface AutomationProductionUploadBinding {
  recentProjectId: string;
  projectId: string;
  requestedCount: number;
  selection: QianchuanUploadSelection;
  target: FrozenQianchuanAccount;
}

/** Observe verified original queue outputs; the original uploader owns all admission and confirmation. */
export async function uploadProducingExports(input: {
  runId: string;
  bindings: AutomationProductionUploadBinding[];
  controller: Pick<BatchProductionController, "snapshot" | "busy" | "executionSignal">;
  queue: Pick<ExportQueue, "snapshot" | "waitForPersistence">;
  upload(groups: AutomationUploadGroup[], signal: AbortSignal): Promise<void>;
  finishAccount?(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<void>;
}, signal: AbortSignal): Promise<UploadIdentity[]> {
  const uploaded = new Map<string, UploadIdentity>(), jobs = new Map<string, string>();
  let currentAccount: FrozenQianchuanAccount | undefined;
  while (true) {
    signal.throwIfAborted();
    const busy = input.controller.busy, run = input.controller.snapshot();
    if (run?.id !== input.runId || !["running", "finished"].includes(run.status) || run.jobs.length !== input.bindings.length) {
      throw new Error("制作运行已取消、中断或发生变化，后续上传已停止。");
    }
    const owners = new Map<string, AutomationProductionUploadBinding>();
    for (const binding of input.bindings) {
      const matches = run.jobs.filter(job => job.recentProjectId === binding.recentProjectId);
      const job = matches[0];
      if (matches.length !== 1 || job.requestedCount !== binding.requestedCount || job.projectId && job.projectId !== binding.projectId ||
        jobs.has(binding.recentProjectId) && jobs.get(binding.recentProjectId) !== job.id || job.status === "interrupted") {
        throw new Error("本轮制作任务归属不一致，后续上传已停止。");
      }
      jobs.set(binding.recentProjectId, job.id);
      if (new Set(job.taskIds).size !== job.taskIds.length || new Set(job.completedTaskIds).size !== (job.completedTaskIds ?? []).length) {
        throw new Error("本轮成片记录重复，后续上传已停止。");
      }
      // Per-job cancellation does not authorize uploading its remaining files.
      if (job.status === "cancelled") continue;
      for (const id of job.completedTaskIds ?? []) {
        if (job.projectId !== binding.projectId || !job.taskIds.includes(id) || owners.has(id)) throw new Error("本轮成片归属不一致，后续上传已停止。");
        owners.set(id, binding);
      }
    }
    const available = new Map<string, UploadIdentity>();
    for (const { batch } of input.queue.snapshot().batches) for (const task of batch.tasks) {
      const owner = owners.get(task.id); if (!owner) continue;
      if (available.has(task.id) || batch.projectId !== owner.projectId || task.batchId !== batch.id || task.status !== "completed" || task.outputArtifact?.taskId !== task.id) {
        throw new Error("本轮已验证成片记录或归属不一致，后续上传已停止。");
      }
      available.set(task.id, { project_id: owner.projectId, batch_id: batch.id, export_task_id: task.id });
    }
    if (available.size !== owners.size) throw new Error("无法确认本轮已验证成片记录，后续上传已停止。");
    for (const [id, previous] of uploaded) {
      const current = available.get(id);
      if (current && (current.project_id !== previous.project_id || current.batch_id !== previous.batch_id)) throw new Error("已上传成片归属发生变化，后续上传已停止。");
    }
    const hasExports = (value: AutomationProductionUploadBinding) => [...available.values()].some(item => item.project_id === value.projectId && !uploaded.has(item.export_task_id));
    if (currentAccount) {
      const owned = input.bindings.filter(binding => binding.target.advertiserId === currentAccount!.advertiserId);
      const finished = owned.every(binding => ["completed", "failed", "cancelled"].includes(run.jobs.find(job => job.id === jobs.get(binding.recentProjectId))!.status));
      if (finished && !owned.some(hasExports)) {
        await input.finishAccount!(currentAccount, signal); currentAccount = undefined;
      }
    }
    const binding = input.bindings.find(value => (!currentAccount || value.target.advertiserId === currentAccount.advertiserId) && hasExports(value));
    if (binding) {
      if (binding.target.egress?.mode === "remote-browser") {
        if (!input.finishAccount) throw new Error("VPS 自动化缺少账号完成关闭通道，未上传。");
        currentAccount ??= binding.target;
      }
      const exports = [...available.values()].filter(value => value.project_id === binding.projectId && !uploaded.has(value.export_task_id)).slice(0, MAX_UPLOAD_GROUP_SIZE);
      const uploadSignal = AbortSignal.any([signal, input.controller.executionSignal(input.runId, jobs.get(binding.recentProjectId)!)]);
      uploadSignal.throwIfAborted();
      await input.queue.waitForPersistence(uploadSignal);
      uploadSignal.throwIfAborted();
      await input.upload([{ selection: binding.selection, target: binding.target, exports }], uploadSignal);
      // Any error leaves the durable occurrence claim consumed; this loop never retries.
      for (const identity of exports) uploaded.set(identity.export_task_id, identity);
      continue;
    }
    if (!busy) {
      if (currentAccount) throw new Error("VPS 账号制作尚未完整结束，后续上传已停止。");
      return [...uploaded.values()];
    }
    await delay(250, undefined, { signal });
  }
}
