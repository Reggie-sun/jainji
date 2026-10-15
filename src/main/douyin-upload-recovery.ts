import { egressIdentity } from "../shared/qianchuan-egress.js";
import { DouyinUploadStore, intentKey, sameTargetBytes, type UploadTaskRecord } from "./douyin-upload-store.js";
import type { FrozenQianchuanAccount, QianchuanAccountConfigReader } from "./qianchuan-account-config.js";
import { QianchuanAccountSettings } from "./qianchuan-account-settings.js";

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Admission only: no writes, scheduling, browser creation or file selection. */
export function historicalUploadBatch(store: DouyinUploadStore, id: string, expectedPageBatchId: string): UploadTaskRecord[] {
  const task = store.task(id);
  if (!task || task.authorization.pageBatchId !== expectedPageBatchId || store.isClosed(expectedPageBatchId)) throw new Error("历史上传批次不匹配或已结束，不能恢复。");
  const tasks = store.tasks(), batch = tasks.filter(other => other.authorization.pageBatchId === expectedPageBatchId);
  const intents = store.intents().filter(intent => intent.authorization.pageBatchId === expectedPageBatchId);
  if (batch.length !== task.authorization.expectedCount || intents.length !== batch.length ||
    new Set(batch.map(other => intentKey(other.input))).size !== batch.length ||
    batch.some(other => other.input.project_id !== task.input.project_id || !equal(other.authorization, task.authorization) || !equal(other.config, task.config) ||
      other.result.upload_outcome !== "NOT_SELECTED" || store.hasMarker(other.result.upload_task_id) || other.result.duplicate_of ||
      !["PENDING", "FAILED_RETRYABLE", "NEEDS_HUMAN"].includes(other.result.state) ||
      !intents.some(intent => intentKey(intent) === intentKey(other.input) && equal(intent.authorization, other.authorization) && equal(intent.config, other.config)) ||
      tasks.some(older => older.result.upload_task_id !== other.result.upload_task_id && sameTargetBytes(other, older) &&
        (store.hasMarker(older.result.upload_task_id) || store.isClosed(older.authorization.pageBatchId))))) {
    throw new Error("仅完整且全部未选文件的历史批次可恢复；已选、未知、取消或已结束记录不能重传。");
  }
  return batch;
}

/** Rebuild a lost process-local anchor only after proving the original browser and account. */
export async function historicalBrowserAnchor(store: DouyinUploadStore, task: UploadTaskRecord, accounts: QianchuanAccountConfigReader, signal: AbortSignal): Promise<FrozenQianchuanAccount | undefined> {
  const old = task.authorization.target;
  const configured = await accounts.freeze(old.product, old.configDigest);
  signal.throwIfAborted();
  const selection = store.intents().find(intent => intent.authorization.pageBatchId === task.authorization.pageBatchId)?.selection;
  if (selection?.plan?.accountSource !== "current-browser") return undefined;
  if (!(accounts instanceof QianchuanAccountSettings)) throw new Error("原网页账户绑定不可用，历史批次未恢复。");
  const sameConnection = (current: FrozenQianchuanAccount) => current.product === old.product && current.configDigest === old.configDigest &&
    egressIdentity(current.egress) === egressIdentity(old.egress);
  // The saved startup port is a hint; only the discovered original browser can prove its frozen endpoint.
  if (configured.product !== old.product || configured.configDigest !== old.configDigest || egressIdentity(configured.egress) !== egressIdentity(old.egress)) throw new Error("原账号配置或固定出口已变化，历史批次未恢复。");
  const current = await accounts.prepareCurrentCatalog(old.product, signal);
  signal.throwIfAborted();
  if (!sameConnection(current.configured) || current.target.advertiserId !== old.advertiserId ||
    selection.plan.advertiserId !== old.advertiserId || selection.plan.adId !== old.adId) throw new Error("当前浏览器与原批次账号或计划不一致，历史批次未恢复。");
  await accounts.assertCurrentUploadTarget({ ...old, cdpEndpoint: current.configured.cdpEndpoint }, signal);
  signal.throwIfAborted();
  return current.configured;
}
