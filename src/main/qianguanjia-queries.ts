import { randomUUID } from "node:crypto";
import { QianchuanUploadResultSchema } from "../shared/douyin-upload.js";
import { QianguanjiaCancelSchema, QianguanjiaQuerySchema, type QianguanjiaResult } from "../shared/qianguanjia.js";
import { connectQianguanjiaTarget, discoverQianguanjiaTargets, type QianguanjiaBrowserTarget } from "./qianguanjia-browser.js";

const failure = "千管家读取未完成，请重新发现页面并检查正常登录与试用权限。";
type LocalReader = () => import("../shared/douyin-upload.js").QianchuanUploadTaskStatus[];
type Connection = Awaited<ReturnType<typeof connectQianguanjiaTarget>>;
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error("cancelled"));
    signal.addEventListener("abort", aborted, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
    if (signal.aborted) aborted();
  });
}
async function closeQuietly(connection: Connection): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([connection.close().catch(() => undefined), new Promise<void>(resolve => { timer = setTimeout(resolve, 2500); })]); }
  finally { clearTimeout(timer); }
}
/** Transient UI observations only; no account mapping, credentials or jobs are persisted. */
export class QianguanjiaQueries {
  private readonly targets = new Map<string, { senderId: number; target: QianguanjiaBrowserTarget }>();
  private connection?: { senderId: number; sessionId: string; value: Connection };
  private active?: { senderId: number; requestId: string; controller: AbortController; done: Promise<unknown> };
  private localReader?: LocalReader;
  setLocalMaterialReader(reader:LocalReader):void { this.localReader=reader; }
  constructor(private readonly dependencies = { discover: discoverQianguanjiaTargets, connect: connectQianguanjiaTarget }) {}

  async run(input: unknown, senderId: number): Promise<QianguanjiaResult> {
    const parsed = QianguanjiaQuerySchema.safeParse(input);
    if (!parsed.success) throw new Error("千管家查询参数无效。");
    if (this.active) throw new Error("千管家正在读取，请先取消或等待结束。");
    const query = parsed.data, controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
    const aborted = () => { if (this.connection?.senderId === senderId) void closeQuietly(this.connection.value); };
    signal.addEventListener("abort", aborted, { once: true });
    const work = (async (): Promise<QianguanjiaResult> => {
      try {
        if (query.kind === "local-materials") {
          if (!this.localReader) throw new Error();
          const records = this.localReader();
          if (records.length > 10000) throw new Error();
          const tasks = records.map(record => {
            const { rowReady: _rowReady, ...result } = record;
            return QianchuanUploadResultSchema.parse(result);
          });
          if (new Set(tasks.map(task => task.upload_task_id)).size !== tasks.length) throw new Error();
          signal.throwIfAborted();
          return {kind:"local-materials",requestId:query.requestId,observedAt:new Date().toISOString(),tasks};
        }
        if (query.kind === "discover") {
          if (this.connection && this.connection.senderId !== senderId) throw new Error();
          await this.clear(senderId);
          if (this.targets.size > 96) throw new Error();
          const directory = await abortable(this.dependencies.discover(signal), signal);
          signal.throwIfAborted();
          const sessions = directory.targets.map((target, index) => {
            const sessionId = randomUUID(); this.targets.set(sessionId, { senderId, target });
            return { sessionId, label: `${target.label} · 页面 ${index + 1}` };
          });
          return { requestId: query.requestId, kind: "discover", sessions, unavailableBrowsers: directory.unavailableBrowsers };
        }
        const binding = this.targets.get(query.sessionId);
        if (!binding || binding.senderId !== senderId) throw new Error();
        if (this.connection && (this.connection.senderId !== senderId || this.connection.sessionId !== query.sessionId)) {
          if (this.connection.senderId !== senderId) throw new Error();
          await closeQuietly(this.connection.value); this.connection = undefined;
        }
        if (!this.connection) {
          const connectionSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
          const connecting = this.dependencies.connect(binding.target, connectionSignal).then(async value => {
            if (connectionSignal.aborted) { await closeQuietly(value); throw new Error("cancelled"); }
            return value;
          });
          const value = await abortable(connecting, connectionSignal);
          this.connection = { senderId, sessionId: query.sessionId, value };
        }
        const adapter = this.connection.value.adapter;
        const reading = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
        if (query.kind === "report" || query.kind === "materials" || query.kind === "plan-report") {
          const {requestId:_requestId,sessionId:_sessionId,...input}=query;
          const data=await abortable(adapter.analysis(input,reading),reading);
          signal.throwIfAborted();
          if (query.kind === "plan-report") return {kind:"plan-report",sessionId:query.sessionId,requestId:query.requestId,data:data as import("../shared/qianguanjia-analysis.js").QianguanjiaPlanReportPage};
          return query.kind === "report" ? {kind:"report",sessionId:query.sessionId,requestId:query.requestId,data:data as import("../shared/qianguanjia-analysis.js").QianguanjiaReportPage} :
            {kind:"materials",sessionId:query.sessionId,requestId:query.requestId,data:data as import("../shared/qianguanjia-analysis.js").QianguanjiaMaterialPage};
        }
        const data = query.kind === "accounts" ? await abortable(adapter.listAdvertisers(reading), reading) :
          await abortable(query.date === undefined ? adapter.todayHomeSummary(reading) : adapter.homeSummary(query.date, reading), reading);
        signal.throwIfAborted();
        return query.kind === "accounts" ? { kind: "accounts", sessionId: query.sessionId, requestId: query.requestId, data: data as Awaited<ReturnType<typeof adapter.listAdvertisers>> } :
          { kind: "home", sessionId: query.sessionId, requestId: query.requestId, data: data as Awaited<ReturnType<typeof adapter.todayHomeSummary>> };
      } catch {
        if (query.kind !== "local-materials") await this.clear(senderId);
        throw new Error(signal.aborted ? "千管家读取已取消，请重新发现页面。" : failure);
      }
    })();
    this.active = { senderId, requestId: query.requestId, controller, done: work };
    try { return await work; } finally { signal.removeEventListener("abort", aborted); if (this.active?.controller === controller) this.active = undefined; }
  }

  cancel(input: unknown, senderId: number): void {
    const parsed = QianguanjiaCancelSchema.safeParse(input);
    if (!parsed.success) throw new Error("千管家取消参数无效。");
    if (this.active?.senderId === senderId && this.active.requestId === parsed.data.requestId) this.active.controller.abort();
  }
  private async clear(senderId: number): Promise<void> {
    for (const [id, binding] of this.targets) if (binding.senderId === senderId) this.targets.delete(id);
    if (this.connection?.senderId === senderId) { const old = this.connection; this.connection = undefined; await closeQuietly(old.value); }
  }
  async disconnect(senderId: number): Promise<void> {
    if (this.active?.senderId === senderId) { this.active.controller.abort(); await this.active.done.catch(() => undefined); }
    await this.clear(senderId);
  }
  async stop(): Promise<void> {
    if (this.active) { this.active.controller.abort(); await this.active.done.catch(() => undefined); }
    if (this.connection) await this.clear(this.connection.senderId);
    this.targets.clear();
  }
}
