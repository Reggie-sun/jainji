import { egressIdentity } from "../shared/qianchuan-egress.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { intentKey, type DouyinUploadStore } from "./douyin-upload-store.js";

interface Dependencies {
  accounts(): Promise<FrozenQianchuanAccount[]>;
  guard(advertiserId: string): void;
  close(target: FrozenQianchuanAccount, guard: () => void): Promise<void>;
}
const sameAccount = (a: FrozenQianchuanAccount, b: FrozenQianchuanAccount) => a.product === b.product && a.advertiserId === b.advertiserId &&
  a.configDigest === b.configDigest && a.cdpEndpoint === b.cdpEndpoint && egressIdentity(a.egress) === egressIdentity(b.egress);

export function assertAutomationBrowserSafe(store: DouyinUploadStore, advertiserId: string, eligible: ReadonlySet<string>, currentIntents: ReadonlySet<string>, cancelledIntents: ReadonlySet<string>): void {
  const tasks = store.tasks();
  const protectedTask = tasks.some(task => task.authorization.target.advertiserId === advertiserId && !store.isClosed(task.authorization.pageBatchId) && task.result.state !== "DISCARDED" &&
    !(task.result.state === "ACCEPTED" && task.result.upload_outcome === "ACCEPTED" && task.result.acceptedEvidence) &&
    (store.hasMarker(task.result.upload_task_id) || task.result.upload_outcome !== "NOT_SELECTED" || eligible.has(task.result.upload_task_id)));
  const preparing = store.intents().some(intent => intent.authorization.target.advertiserId === advertiserId && !store.isClosed(intent.authorization.pageBatchId) &&
    currentIntents.has(intentKey(intent)) && !cancelledIntents.has(intentKey(intent)) && !tasks.some(task => intentKey(task.input) === intentKey(intent)));
  if (protectedTask || preparing) throw new Error("该 VPS 账号仍有待上传、待确认或结果未知的任务，未关闭或切换浏览器。请核查原页面。");
}

/** Resource coordination only; the original service/store retain task and confirmation authority. */
export class AutomationBrowserAccounts {
  private current?: FrozenQianchuanAccount;
  constructor(private readonly dependencies: Dependencies) {}
  get busy(): boolean { return !!this.current; }
  release(): void { this.current = undefined; }
  async prepare(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (target.egress?.mode !== "remote-browser") return;
    if (this.current) {
      if (!sameAccount(this.current, target)) throw new Error("当前 VPS 账号尚未完成并关闭，不能打开新账号。");
      return;
    }
    this.current = target;
    try {
      const accounts = await this.dependencies.accounts(); signal.throwIfAborted();
      if (!accounts.some(account => sameAccount(account, target))) throw new Error("VPS 账号配置已变化，未切换浏览器。");
      const peers = accounts.filter(account => egressIdentity(account.egress) === egressIdentity(target.egress));
      // Check every peer first: no window is closed if any account still owns a draft.
      for (const peer of peers) this.dependencies.guard(peer.advertiserId);
      for (const peer of peers.filter(account => account.advertiserId !== target.advertiserId)) {
        const guard = () => { signal.throwIfAborted(); this.dependencies.guard(peer.advertiserId); };
        guard(); await this.dependencies.close(peer, guard); guard();
      }
    } catch (error) { this.release(); throw error; }
  }
  async finish(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (target.egress?.mode !== "remote-browser") return;
    if (!this.current || !sameAccount(this.current, target)) throw new Error("VPS 账号资源归属已变化，未关闭浏览器。");
    const guard = () => { signal.throwIfAborted(); this.dependencies.guard(target.advertiserId); };
    guard(); await this.dependencies.close(target, guard); guard(); this.release();
  }
}
