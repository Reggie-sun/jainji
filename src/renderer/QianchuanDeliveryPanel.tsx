import { useEffect, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import type { QianchuanDeliveryDraft, QianchuanDeliveryResult } from "../shared/qianchuan-delivery";
import type { QianchuanDeliveryPrepared, QianchuanDeliveryPrepare } from "../shared/qianchuan-integration";

type Action = "set-budget" | "set-roi";
type FormState = { action: Action | ""; targetValue: string; maxTargetBudget: string; totalBudgetIncrease: string; expiresAt: string };
const emptyForm: FormState = { action: "", targetValue: "", maxTargetBudget: "", totalBudgetIncrease: "", expiresAt: "" };
const moneyPattern = /^(?:0|[1-9][0-9]{0,12})\.[0-9]{2}$/;
const roiPattern = /^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,6})?$/;
const platformIdPattern = /^[1-9][0-9]{0,19}$/;

function minorUnits(value: string): bigint {
  const [whole, fraction] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction!);
}

function targetFromDraft(draft: QianchuanDeliveryDraft): string {
  if (draft.action === "set-budget") return draft.target.budget;
  if (draft.action === "set-roi") return draft.target.roi;
  return "";
}

function outcomeText(result: QianchuanDeliveryResult): string {
  if (result.state === "UNKNOWN") return "结果未知；只能核查，不可重发。";
  if (result.state === "CONFIRMED") return "本次调整已完成独立回读确认。";
  if (result.state === "NOT_SENT") return "本次没有提交到平台；本验证不会自动重试。";
  return "平台未确认本次调整；本验证不会自动重试。";
}

export function QianchuanDeliveryPanel({ account, active, adId }: {
  account?: QianchuanAccountSummary; active: boolean; adId: string;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [prepared, setPrepared] = useState<QianchuanDeliveryPrepared>();
  const [outcome, setOutcome] = useState<QianchuanDeliveryResult>();
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState<"prepare" | "confirm">();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const current = useRef<{ requestId: string; cancelSent: boolean; cancelPromise?: Promise<void> }>();
  const submittedRef = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const scopeKey = `${account?.product ?? ""}:${account?.advertiserId ?? ""}:${account?.adId ?? ""}:${account?.available ?? false}:${adId}`;
  const scopeRef = useRef(scopeKey); scopeRef.current = scopeKey;
  const activeRef = useRef(active); activeRef.current = active;

  function cancelCurrent(): Promise<void> | undefined {
    const request = current.current;
    if (!request) return undefined;
    if (!request.cancelSent) {
      request.cancelSent = true;
      request.cancelPromise = window.jianji.cancelQianchuanIntegration({ requestId: request.requestId }).catch(() => undefined);
    }
    return request.cancelPromise;
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; cancelCurrent(); };
  }, []);

  useEffect(() => {
    generation.current++;
    setForm(emptyForm); setPrepared(undefined); setOutcome(undefined); submittedRef.current = false; setSubmitted(false); setError(""); setNotice("");
    cancelCurrent();
    return () => { generation.current++; cancelCurrent(); };
  }, [scopeKey, active]);

  function invalidateDraft() {
    generation.current++;
    setPrepared(undefined); setOutcome(undefined); setError(""); setNotice("");
    cancelCurrent();
    if (current.current) setNotice("输入已变化，正在等待已取消的本地请求结束；迟到结果会丢弃。");
  }

  function change<K extends keyof FormState>(key: K, value: FormState[K]) {
    if (submittedRef.current) return;
    invalidateDraft();
    setForm(old => ({ ...old, [key]: value }));
  }

  const now = Date.now();
  const expiryMs = form.expiresAt ? new Date(form.expiresAt).getTime() : NaN;
  const budgetValid = moneyPattern.test(form.maxTargetBudget);
  const increaseValid = moneyPattern.test(form.totalBudgetIncrease);
  const targetValid = form.action === "set-budget" ? moneyPattern.test(form.targetValue) : form.action === "set-roi" ? roiPattern.test(form.targetValue) : false;
  const identityValid = !!account?.available && platformIdPattern.test(account.advertiserId) && platformIdPattern.test(adId);
  const expiresAtValid = Number.isFinite(expiryMs) && expiryMs > now;
  const canPrepare = active && identityValid && targetValid && budgetValid && increaseValid && expiresAtValid && !busy && !submitted;

  let boundsError = "";
  if (prepared && moneyPattern.test(form.maxTargetBudget) && moneyPattern.test(form.totalBudgetIncrease)) {
    const userExpiry = new Date(form.expiresAt).getTime(), preparedExpiry = Date.parse(prepared.expiresAt);
    if (!Number.isFinite(userExpiry) || userExpiry <= Date.now()) boundsError = "授权截止时间必须晚于当前时间。";
    else if (userExpiry > preparedExpiry) boundsError = "授权截止时间不能超过本次预检有效期。";
    else if (prepared.draft.action === "set-budget") {
      const target = minorUnits(prepared.draft.target.budget), ceiling = minorUnits(form.maxTargetBudget);
      const previous = minorUnits(prepared.draft.beforeValues.budget), increase = target > previous ? target - previous : 0n;
      if (ceiling < target) boundsError = "CNY 每日预算上限不能低于本次预算目标。";
      else if (minorUnits(form.totalBudgetIncrease) < increase) boundsError = "本次累计可增加额不能低于本次预算上调额。";
    }
  }
  const canConfirm = !!prepared && !boundsError && active && !busy && !submitted && canPrepare;

  function matchesRequest(result: QianchuanDeliveryPrepared, request: QianchuanDeliveryPrepare): boolean {
    const draft = result.draft;
    if (draft.action === "set-budget") return request.action === "set-budget" && draft.accountSlot === request.product && draft.advertiserId === request.expectedAdvertiserId &&
      draft.adId === request.adId && targetFromDraft(draft) === request.targetValue;
    if (draft.action === "set-roi") return request.action === "set-roi" && draft.accountSlot === request.product && draft.advertiserId === request.expectedAdvertiserId &&
      draft.adId === request.adId && targetFromDraft(draft) === request.targetValue;
    return false;
  }

  async function prepare() {
    if (!canPrepare || !account || current.current || submittedRef.current) return;
    const request: QianchuanDeliveryPrepare = {
      requestId: crypto.randomUUID(), product: account.product, expectedAdvertiserId: account.advertiserId, adId,
      action: form.action as Action, targetValue: form.targetValue,
    };
    const requestGeneration = ++generation.current, requestScope = scopeKey;
    current.current = { requestId: request.requestId, cancelSent: false }; setBusy("prepare"); setPrepared(undefined); setOutcome(undefined); setError(""); setNotice("");
    try {
      const result = await window.jianji.prepareQianchuanDelivery(request);
      if (current.current?.requestId !== request.requestId || requestGeneration !== generation.current || scopeRef.current !== requestScope || !activeRef.current) return;
      if (!matchesRequest(result, request)) throw new Error("scope mismatch");
      setPrepared(result);
    } catch {
      if (current.current?.requestId === request.requestId && requestGeneration === generation.current && scopeRef.current === requestScope && activeRef.current) {
        setError("未能完成本次计划预检；没有自动重试，写操作未提交。");
      }
    } finally {
      if (current.current?.requestId === request.requestId) await current.current.cancelPromise;
      if (current.current?.requestId === request.requestId) {
        current.current = undefined;
        if (mounted.current) setBusy(undefined);
      }
    }
  }

  async function confirm() {
    if (!canConfirm || !prepared || !account || current.current || submittedRef.current) return;
    const requestId = crypto.randomUUID(), requestGeneration = ++generation.current, requestScope = scopeKey;
    const request = {
      requestId, preflightId: prepared.preflightId, maxTargetBudget: form.maxTargetBudget,
      totalBudgetIncrease: form.totalBudgetIncrease, maxActions: 1 as const, expiresAt: new Date(form.expiresAt).toISOString(),
    };
    current.current = { requestId, cancelSent: false }; submittedRef.current = true; setBusy("confirm"); setSubmitted(true); setError(""); setNotice("");
    try {
      const result = await window.jianji.confirmQianchuanDelivery(request);
      if (current.current?.requestId !== requestId || requestGeneration !== generation.current || scopeRef.current !== requestScope || !activeRef.current) return;
      setOutcome(result);
    } catch {
      if (current.current?.requestId === requestId && requestGeneration === generation.current && scopeRef.current === requestScope && activeRef.current) {
        setError("执行结果未能核实；不可重发，请核查本地投放审计和平台现状。");
      }
    } finally {
      if (current.current?.requestId === requestId) await current.current.cancelPromise;
      if (current.current?.requestId === requestId) {
        current.current = undefined;
        if (mounted.current) setBusy(undefined);
      }
    }
  }

  function cancelPreparation() {
    if (submitted || busy !== "prepare" || !current.current) return;
    invalidateDraft();
    setNotice("已请求取消本地预检，正在等待请求结束；迟到结果会丢弃。");
  }

  const capabilityText = prepared?.capabilityStatus === "live-read-verified"
    ? "首次资格：仅真实读取核验；本次为一次性实验写入，尚未证明真实写入及回读。"
    : prepared?.capabilityStatus === "live-write-verified" ? "该账户和推广模式已有真实写入及回读核验；本次仍受一次性范围授权约束。" : "";

  return <section className="qianchuan-backend-panel qianchuan-delivery-panel" aria-label="单次计划调整验证">
    <div className="qc-section-heading"><h4>调整预算与 ROI</h4><span className="qc-badge">最多执行 1 次</span></div>
    <p className="qc-help">账户 {account?.advertiserId ?? "未配置"} · 保存默认计划 {account?.adId ?? "未配置"}</p>
    <p className="qc-target-note">本次目标计划 {adId || "未选择"}。请核对目标；本次调整不会更换保存的默认计划。</p>
    <div className="qianchuan-query-fields">
      <label>操作<select aria-label="操作" value={form.action} disabled={submitted} onChange={event => change("action", event.target.value as Action | "")}>
        <option value="">请选择动作</option><option value="set-budget">修改预算</option><option value="set-roi">修改 ROI 目标</option>
      </select></label>
      <label>目标值<input aria-label="目标值" type="text" inputMode="decimal" value={form.targetValue} disabled={submitted} onChange={event => change("targetValue", event.target.value)} placeholder={form.action === "set-roi" ? "ROI 数值" : "CNY 金额"} /></label>
      <label>CNY 每日预算上限<input aria-label="CNY 每日预算上限" type="text" inputMode="decimal" value={form.maxTargetBudget} disabled={submitted} onChange={event => change("maxTargetBudget", event.target.value)} placeholder="例如 200.00" /></label>
      <label>本次累计可增加额（CNY）<input aria-label="本次累计可增加额（CNY）" type="text" inputMode="decimal" value={form.totalBudgetIncrease} disabled={submitted} onChange={event => change("totalBudgetIncrease", event.target.value)} placeholder="例如 40.00" /></label>
      <label>授权截止时间（本地时间）<input aria-label="授权截止时间（本地时间）" type="datetime-local" value={form.expiresAt} disabled={submitted} onChange={event => change("expiresAt", event.target.value)} /></label>
    </div>
    <p className="qc-help">人民币 CNY · 每日预算。请明确填写金额与授权期限。</p>
    {!identityValid && <p role="alert">当前账户或目标计划 ID 无效，无法准备验证。</p>}
    {prepared && <div className="qianchuan-query-result" aria-label="准备结果">
      <p className="qc-preflight-note">{capabilityText}</p>
      <p>预检账户 {prepared.draft.advertiserId} · 产品 {prepared.draft.accountSlot} · 计划 {"adId" in prepared.draft ? prepared.draft.adId : "未知"}</p>
      <p>商品 ID：{prepared.productIds.join("、")}</p>
      <div className="qc-change-preview"><div><span>修改前</span><strong>{Object.entries(prepared.draft.beforeValues).filter(([key]) => key === "budget" || key === "roi").map(([key, value]) => `${value}${key === "budget" ? " 元 / 天" : " ROI"}`).join(" · ")}</strong></div><span aria-hidden="true">→</span><div><span>调整为</span><strong>{Object.entries(prepared.draft.target).filter(([key]) => key === "budget" || key === "roi").map(([key, value]) => `${value}${key === "budget" ? " 元 / 天" : " ROI"}`).join(" · ")}</strong></div></div>
      <p className="qc-help">请在 {new Date(prepared.expiresAt).toLocaleString("zh-CN")} 前完成确认。</p>
      <details className="qc-details"><summary>预检证据</summary><p>配方证据 {prepared.recipeEvidenceId}</p></details>
    </div>}
    {boundsError && <p role="alert">{boundsError}</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {outcome && <p role={outcome.state === "CONFIRMED" ? "status" : "alert"}>{outcomeText(outcome)}{outcome.operationId && ` 操作 ID ${outcome.operationId}`}</p>}
    {busy === "prepare" && <p role="status">正在等待本地预检结果…</p>}
    {busy === "confirm" && <p role="status">已提交本次单次验证，正在等待平台执行与回读结果；不可重发。</p>}
    <div className="qianchuan-query-actions">
      <button type="button" className="button secondary" disabled={!canPrepare} onClick={() => void prepare()}>读取当前值并检查</button>
      <button type="button" className="button primary" disabled={!canConfirm} onClick={() => void confirm()}>确认并执行一次</button>
      {busy === "prepare" && <button type="button" className="button secondary" disabled={submitted} onClick={cancelPreparation}>取消本地预检</button>}
    </div>
  </section>;
}
