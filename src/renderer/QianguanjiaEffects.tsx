import { useEffect, useMemo, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account.js";
import type { QianchuanUploadTaskStatus } from "../shared/douyin-upload.js";
import { QIANCHUAN_QUERY_METRICS } from "../shared/qianchuan-backend.js";
import { qianguanjiaEffectTargets, type QianguanjiaEffectTarget } from "../shared/qianguanjia-effect-targets.js";
import { joinQianchuanEffects } from "../shared/qianchuan-effect.js";
import { exportQianchuanAttributedEffectsCsv } from "../shared/qianchuan-effect-export.js";
import { QianchuanReportCaptureSchema, QianchuanReportSnapshotSchema, type QianchuanReportSnapshot } from "../shared/qianchuan-report.js";
import type { QianguanjiaAccountDirectory } from "../shared/qianguanjia.js";

const PAGE_SIZE = 20;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DEFAULT_REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const metricLabels: Record<(typeof QIANCHUAN_QUERY_METRICS)[number], string> = {
  stat_cost_for_roi2: "平台消耗",
  total_pay_order_count_for_roi2: "成交订单数",
  total_pay_order_gmv_include_coupon_for_roi2: "含券成交金额",
  total_prepay_and_pay_order_roi2: "平台支付 ROI",
};

type MaterialsSnapshot = Extract<QianchuanReportSnapshot, { kind: "materials" }>;
type EffectTarget = QianguanjiaEffectTarget;
type CaptureWork = { requestId: string; timer?: ReturnType<typeof setTimeout>; cancelled: boolean };

function beijingDate() {
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function expectedWindowEnd(endDate: string, asOf: string) {
  const endOfDay = `${endDate} 23:59:59`;
  const observed = new Date(Date.parse(asOf) + BEIJING_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
  return endOfDay < observed ? endOfDay : observed;
}

function matchesDateRange(snapshot: MaterialsSnapshot, startDate: string, endDate: string) {
  const observedDate = new Date(Date.parse(snapshot.asOf) + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
  return startDate <= endDate && endDate <= observedDate && snapshot.startTime <= snapshot.endTime &&
    snapshot.startTime === `${startDate} 00:00:00` && snapshot.endTime === expectedWindowEnd(endDate, snapshot.asOf);
}

function rangeError(product: string | undefined, advertiserId: string | undefined, adId: string | undefined, startDate: string, endDate: string) {
  if (!product || !advertiserId || !adId) return "请选择一个已核对的历史上传目标。";
  const parsed = QianchuanReportCaptureSchema.safeParse({
    kind: "materials", requestId: DEFAULT_REQUEST_ID, product, expectedAdvertiserId: advertiserId, adId, startDate, endDate,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "查询日期范围无效。";
  if (endDate > beijingDate()) return "结束日期不能晚于北京时间今天。";
  return undefined;
}

function supplierCoverage(target: EffectTarget) {
  if (target.supplierListed === undefined) return "供应商目录覆盖未知";
  return target.supplierListed ? "供应商目录已列出" : "供应商目录未列出；仍可按冻结目标直读千川";
}

function readBlockText(target: EffectTarget) {
  if (target.readBlock === "slot-unavailable") return "当前原账户槽位不可用，不能读取此冻结目标。";
  if (target.readBlock === "slot-changed") return "当前账户槽位与上传时冻结身份不一致，不能用新账户读取旧目标。";
  return "此冻结目标尚未通过原账户槽位核对，不能读取。";
}

function targetFingerprint(target: EffectTarget | undefined) {
  if (!target) return "";
  return JSON.stringify([
    target.key, target.readable, target.readBlock,
    target.tasks.map(task => [task.upload_task_id, task.artifact_sha256, task.project_id, task.batch_id,
      task.acceptedEvidence?.platformVideoId, task.acceptedEvidence?.requestSha256]),
  ]);
}

export function QianguanjiaEffects({ active, tasks, loaded, accounts, directory, externalBusy = false, onBusy }: {
  active: boolean;
  tasks: QianchuanUploadTaskStatus[];
  loaded: boolean;
  accounts: QianchuanAccountSummary[];
  directory?: QianguanjiaAccountDirectory;
  externalBusy?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const projection = useMemo(() => {
    if (!loaded) return { targets: [] as QianguanjiaEffectTarget[], error: "" };
    try { return { targets: qianguanjiaEffectTargets(tasks, accounts, directory), error: "" }; }
    catch { return { targets: [] as QianguanjiaEffectTarget[], error: "本地上传账本无法严格核对，已停止显示效果目标和指标。" }; }
  }, [loaded, tasks, accounts, directory]);
  const targets = projection.targets;
  const [targetKey, setTargetKey] = useState("");
  const [startDate, setStartDate] = useState(beijingDate);
  const [endDate, setEndDate] = useState(beijingDate);
  const [savedSnapshots, setSavedSnapshots] = useState<MaterialsSnapshot[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [historyError, setHistoryError] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [projectFilter, setProjectFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const request = useRef<CaptureWork>();
  const mounted = useRef(false);
  const historyGeneration = useRef(0);
  const onBusyRef = useRef(onBusy);
  onBusyRef.current = onBusy;

  const target = targets.find(item => item.key === targetKey);
  const fingerprint = targetFingerprint(target);
  const targetReadable = Boolean(target?.readable);
  const dateError = rangeError(target?.product, target?.advertiserId, target?.adId, startDate, endDate);
  const selectedSnapshot = savedSnapshots.find(snapshot => snapshot.id === selectedSnapshotId);
  const matchingSnapshots = useMemo(() => savedSnapshots.filter(snapshot => !dateError && target && snapshot.product === target.product &&
    snapshot.advertiserId === target.advertiserId && snapshot.adId === target.adId && matchesDateRange(snapshot, startDate, endDate))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)), [savedSnapshots, target, startDate, endDate, dateError]);
  const validSelectedSnapshot = selectedSnapshot && matchingSnapshots.some(snapshot => snapshot.id === selectedSnapshot.id) ? selectedSnapshot : undefined;
  let joined: ReturnType<typeof joinQianchuanEffects> = [];
  let joinFailed = false;
  if (target && validSelectedSnapshot) {
    try { joined = joinQianchuanEffects(target.attributableTasks, validSelectedSnapshot); } catch { joined = []; joinFailed = true; }
  }
  const joinedByTaskId = new Map(joined.map(entry => [entry.task.upload_task_id, entry]));
  const filteredTasks = target?.tasks.filter(task => (!projectFilter || task.project_id === projectFilter) &&
    (!batchFilter || task.batch_id === batchFilter)) ?? [];
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const shownPage = Math.min(page, totalPages);
  const pageTasks = filteredTasks.slice((shownPage - 1) * PAGE_SIZE, shownPage * PAGE_SIZE);
  const hasMatchedMaterials = joined.some(entry => entry.status === "matched" && entry.materials.length > 0);
  const viewIdentity = JSON.stringify([active, loaded, targetKey, fingerprint, startDate, endDate]);
  const currentViewIdentity = useRef(viewIdentity);
  currentViewIdentity.current = viewIdentity;
  const historyIdentity = JSON.stringify([active, loaded, targetKey, fingerprint, startDate, endDate, historyVersion]);
  const currentHistoryIdentity = useRef(historyIdentity);
  currentHistoryIdentity.current = historyIdentity;
  const canQuery = Boolean(active && targetReadable && !externalBusy && !captureBusy && historyState !== "loading" && !dateError);

  function requestCaptureCancel() {
    const work = request.current;
    if (!work || work.cancelled) return;
    work.cancelled = true;
    if (work.timer) clearTimeout(work.timer);
    void window.jianji.cancelQianchuanIntegration({ requestId: work.requestId }).catch(() => undefined);
    if (mounted.current) setCancelRequested(true);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestCaptureCancel(); };
    // The request is ref-owned and cancellation must survive component teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    requestCaptureCancel();
    setCaptureError(""); setNotice("");
    setSavedSnapshots([]); setSelectedSnapshotId(""); setPage(1);
    return () => { requestCaptureCancel(); };
    // The fingerprint includes the accepted evidence and frozen target identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, loaded, targetKey, startDate, endDate, fingerprint]);

  useEffect(() => {
    const selected = target;
    if (!active || !loaded || !selected) {
      historyGeneration.current++;
      setSavedSnapshots([]); setHistoryState("idle"); setHistoryError("");
      return;
    }
    let current = true;
    const generation = ++historyGeneration.current;
    setSavedSnapshots([]); setSelectedSnapshotId(""); setHistoryState("loading"); setHistoryError("");
    void window.jianji.listQianchuanReports({ product: selected.product, expectedAdvertiserId: selected.advertiserId }).then(values => {
      const parsed = values.map(value => QianchuanReportSnapshotSchema.parse(value));
      if (parsed.some(snapshot => snapshot.product !== selected.product || snapshot.advertiserId !== selected.advertiserId)) throw new Error("scope");
      if (!current || generation !== historyGeneration.current || currentHistoryIdentity.current !== historyIdentity) return;
      setSavedSnapshots(parsed.filter((snapshot): snapshot is MaterialsSnapshot => snapshot.kind === "materials"));
      setHistoryState("ready");
    }).catch(() => {
      if (current && generation === historyGeneration.current && currentHistoryIdentity.current === historyIdentity) {
        setSavedSnapshots([]); setHistoryState("error"); setHistoryError("本地历史快照读取失败或身份、完整性校验未通过；已隐藏全部记录。");
      }
    });
    return () => { current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, loaded, targetKey, startDate, endDate, fingerprint, historyVersion]);

  async function capture() {
    if (!canQuery || !target || request.current) return;
    const requestId = crypto.randomUUID();
    const parsedInput = QianchuanReportCaptureSchema.safeParse({ kind: "materials", requestId, product: target.product,
      expectedAdvertiserId: target.advertiserId, adId: target.adId, startDate, endDate });
    if (!parsedInput.success) { setCaptureError(parsedInput.error.issues[0]?.message ?? "请核对冻结目标和查询日期。"); return; }
    const viewIdentityAtStart = viewIdentity;
    const work: CaptureWork = { requestId, cancelled: false };
    request.current = work;
    setCaptureBusy(true); setCancelRequested(false); setCaptureError(""); setNotice(""); setSelectedSnapshotId("");
    onBusyRef.current?.(true);
    work.timer = setTimeout(() => {
      if (request.current !== work || work.cancelled) return;
      requestCaptureCancel();
      setCaptureError("效果读取超过 180 秒，已请求取消；正在等待原请求清理，不会自动重试。");
    }, 180_000);
    try {
      const captured = await window.jianji.captureQianchuanReport({ ...parsedInput.data, browserAccess: "existing-only" });
      if (!mounted.current || request.current !== work || work.cancelled || currentViewIdentity.current !== viewIdentityAtStart) return;
      const snapshot = QianchuanReportSnapshotSchema.parse(captured);
      if (snapshot.kind !== "materials" || snapshot.product !== target.product || snapshot.advertiserId !== target.advertiserId ||
        snapshot.adId !== target.adId || !matchesDateRange(snapshot, startDate, endDate)) throw new Error("scope");
      joinQianchuanEffects(target.attributableTasks, snapshot);
      setSavedSnapshots(previous => [snapshot, ...previous.filter(item => item.id !== snapshot.id)]);
      setSelectedSnapshotId(snapshot.id);
      setNotice(`完整素材快照已保存（仅此计划、日期及固定筛选）· ${snapshot.total} 条 · ${snapshot.startTime} 至 ${snapshot.endTime}（北京时间）。`);
    } catch {
      if (mounted.current && request.current === work && !work.cancelled && currentViewIdentity.current === viewIdentityAtStart) setCaptureError("效果读取或完整快照校验失败。没有显示不完整指标或自动重试；请核对原账户浏览器已打开并登录、冻结目标及平台响应。");
    } finally {
      if (work.timer) clearTimeout(work.timer);
      if (request.current === work) {
        request.current = undefined;
        if (mounted.current) { setCaptureBusy(false); setCancelRequested(false); }
        onBusyRef.current?.(false);
      }
    }
  }

  function cancelCapture() {
    if (!request.current) return;
    requestCaptureCancel();
    setNotice("已请求取消本次读取；底层请求清理完成前仍占用查询，迟到结果不会显示或读取后续页。");
  }

  function cancelHistoryDisplay() {
    historyGeneration.current++;
    setHistoryState("idle"); setHistoryError("");
    setNotice("已停止显示本次本地历史读取；后台本地读取无法中断，迟到结果将忽略。");
  }

  function reloadHistory() {
    setHistoryVersion(version => version + 1);
  }

  function downloadCsv() {
    if (!target || !validSelectedSnapshot || !hasMatchedMaterials) return;
    try {
      const csv = exportQianchuanAttributedEffectsCsv(validSelectedSnapshot, target.attributableTasks);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = `qianguanjia-effects-${validSelectedSnapshot.id}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setCaptureError("CSV 导出未能核对完整快照和精确接收证据；没有导出部分数据。");
    }
  }

  function changeTarget(value: string) { setTargetKey(value); setPage(1); setProjectFilter(""); setBatchFilter(""); }
  function changeStartDate(value: string) { setStartDate(value); setPage(1); }
  function changeEndDate(value: string) { setEndDate(value); setPage(1); }

  return <section className="qianguanjia-card qianchuan-effect-loop qianchuan-query-result" aria-label="千管家投放效果" data-testid="qianguanjia-effects">
    <div className="qianguanjia-card-title"><h2>投放效果</h2><span>{loaded ? `${targets.length} 个本地冻结目标` : "本地上传账本尚未读取"}</span></div>
    <p className="qianguanjia-data-scope">目标仅来自原上传账本中可核验的 ACCEPTED 回执；平台视频 ID 精确关联，不按文件名或素材名称猜测。查询复用千川原只读采集及快照保存。结果仅为指定计划、日期与平台固定筛选条件下的效果集合，不代表全账户视频上传库。</p>

    {loaded && targets.length > 0 && <p className="qianguanjia-data-scope">有效接收涉及 {new Set(targets.map(item => item.advertiserId)).size} 个实际账户、{targets.length} 个冻结目标。{directory ? `供应商目录列出其中 ${new Set(targets.filter(item => item.supplierListed).map(item => item.advertiserId)).size} 个账户；未列出的目标也保留在下方。` : "尚未读取供应商目录，覆盖范围未知。"}</p>}
    {!loaded && <p role="status">本地上传账本尚未完成读取；此时不推断账户覆盖或投放效果。</p>}
    {projection.error && <p role="alert">{projection.error}</p>}
    {loaded && !projection.error && !targets.length && <div className="qianguanjia-empty"><strong>没有可核验的历史上传目标</strong><p>仅有效 ACCEPTED 回执会形成目标；READY、UNKNOWN、失败或字段不完整的记录不会升级为接收证据。</p></div>}
    {targets.length > 0 && <>
      <div className="qianchuan-query-fields">
        <label>冻结目标<select aria-label="千管家效果目标" value={targetKey} disabled={!active} onChange={event => changeTarget(event.target.value)}>
          <option value="">请选择账户与计划</option>{targets.map(item => <option key={item.key} value={item.key}>{item.label} · 账户 {item.advertiserId} · 计划 {item.adId}</option>)}
        </select></label>
        <label>开始日期<input aria-label="千管家效果开始日期" type="date" value={startDate} disabled={!active} onChange={event => changeStartDate(event.target.value)} /></label>
        <label>结束日期<input aria-label="千管家效果结束日期" type="date" value={endDate} disabled={!active} onChange={event => changeEndDate(event.target.value)} /></label>
      </div>

      {target && <>
        <div className="qianguanjia-data-scope" role="group" aria-label="目标覆盖与本地接收记录">
          <p>{target.label} · 账户 {target.advertiserId} · 计划 {target.adId} · {supplierCoverage(target)}</p>
          <p>有效接收 {target.acceptedCount} 条 · 可归属接收 {target.attributableTasks.length} 条 · 唯一视频 {target.uniqueVideos} 个 · 涉及 {target.projectCount} 个项目{target.latestAcceptedAt ? ` · 最近接收 ${formatDateTime(target.latestAcceptedAt)}` : ""}。</p>
          {target.conflictingVideoIds.length > 0 && <p role="alert">{target.conflictingVideoIds.length} 个平台视频 ID 对应冲突的本地文件 SHA-256，相关回执不参与指标关联：{target.conflictingVideoIds.join("、")}</p>}
          {!targetReadable && <p role="alert">{target.readBlock ? readBlockText(target) : "当前账户槽位与上传时冻结的广告账户身份不一致，不能读取此目标。"}</p>}
          {!target.supplierListed && target.supplierListed !== undefined && target.readable && <p>供应商目录未列出此账户；仍可使用原千川直读入口，并按冻结账户和计划校验。</p>}
        </div>

        <div className="qianchuan-query-actions">
          <button type="button" className="button" disabled={!canQuery} onClick={() => void capture()}>读取并保存此范围的素材效果</button>
          {captureBusy && <button type="button" className="button secondary" onClick={cancelCapture}>取消效果读取</button>}
          <button type="button" className="button secondary" disabled={!active || captureBusy || historyState === "loading"} onClick={reloadHistory}>重新读取已保存快照</button>
        </div>
        {dateError && targetKey && <p role="alert">{dateError}</p>}
        {target && !targetReadable && targetKey && <p className="qianguanjia-data-scope">历史快照仍可按本地冻结身份查看；当前账户槽位不可读取，因此采集按钮保持关闭。</p>}
        {captureBusy && !cancelRequested && <p role="status">正在通过千川原只读入口读取此计划、日期及固定筛选内的完整效果集合；单次上限 180 秒，不自动重试。</p>}
        {captureBusy && cancelRequested && <p role="status">已请求取消，正在等待原千川读取完成清理；查询仍保持占用，迟到结果将忽略。</p>}
        {captureError && <p role="alert">{captureError}</p>}
        {notice && <p role="status">{notice}</p>}

        {historyState === "loading" && <><p role="status">正在读取此账户已保存的本地历史快照…不会发起平台采集。</p><button type="button" className="button secondary" onClick={cancelHistoryDisplay}>停止显示历史读取</button></>}
        {historyState === "error" && <p role="alert">{historyError}</p>}
        {historyState === "ready" && !matchingSnapshots.length && !validSelectedSnapshot && <div className="qianguanjia-empty" role="status">
          <strong>此账户、计划和日期范围没有已保存的完整素材快照</strong><p>缺少历史快照不表示平台指标为零；只有点击上方读取按钮后才会按原千川只读入口采集。</p>
        </div>}
        {matchingSnapshots.length > 0 && <div className="qianchuan-query-fields">
          <label>本地完整素材快照<select aria-label="千管家效果历史快照" value={selectedSnapshotId} onChange={event => setSelectedSnapshotId(event.target.value)}>
            <option value="">请选择同目标、同日期的快照</option>{matchingSnapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{formatDateTime(snapshot.capturedAt)} · {snapshot.total} 条 · {snapshot.startTime} 至 {snapshot.endTime}</option>)}
          </select></label>
        </div>}

        {validSelectedSnapshot && <>
          <p className="qianguanjia-data-scope">快照 {validSelectedSnapshot.id} · 来源千川浏览器 · 账户 {validSelectedSnapshot.advertiserId} · 计划 {validSelectedSnapshot.adId} · {validSelectedSnapshot.startTime} 至 {validSelectedSnapshot.endTime}（北京时间）· 统计截止 {formatDateTime(validSelectedSnapshot.asOf)} · 采集于 {formatDateTime(validSelectedSnapshot.capturedAt)} · 本次固定筛选返回 {validSelectedSnapshot.total} 条素材，不代表全账户上传库。未返回的素材和指标保持未知，不填零；单位和归因窗口沿用原平台值。</p>
          {joinFailed && <p role="alert">快照与接收证据无法精确关联校验；本快照的全部指标已隐藏。</p>}
          <div className="qianchuan-query-actions">
            <button type="button" className="button secondary" disabled={joinFailed || !hasMatchedMaterials} onClick={downloadCsv}>导出精确关联效果 CSV</button>
          </div>
          <p className="qianguanjia-data-scope">CSV 沿用原效果导出；同一平台素材只保留一组指标并汇总本地引用 ID，不重复计入消耗或 ROI。金额单位和归因口径沿用原快照，不推算账户总 ROI。</p>
        </>}

        {target.tasks.length > 0 && <>
          <div className="qianchuan-query-fields">
            <label>项目<select aria-label="效果项目筛选" value={projectFilter} onChange={event => { setProjectFilter(event.target.value); setBatchFilter(""); setPage(1); }}>
              <option value="">全部项目</option>{[...new Set(target.tasks.map(task => task.project_id))].map(id => <option key={id} value={id}>{id}</option>)}
            </select></label>
            <label>批次<select aria-label="效果批次筛选" value={batchFilter} onChange={event => { setBatchFilter(event.target.value); setPage(1); }}>
              <option value="">全部批次</option>{[...new Set(target.tasks.filter(task => !projectFilter || task.project_id === projectFilter).map(task => task.batch_id))].map(id => <option key={id} value={id}>{id}</option>)}
            </select></label>
          </div>
          <p className="qianguanjia-data-scope">项目和批次筛选只改变下方本地记录；CSV 导出此完整快照中全部精确关联素材。</p>
          {!filteredTasks.length && <p role="status">没有匹配此项目或批次的本地接收记录。</p>}
          <div className="qianchuan-query-table"><table><thead><tr><th>本地成片与冻结身份</th><th>接收依据</th><th>平台素材效果</th></tr></thead><tbody>
            {pageTasks.map(task => {
              const effect = joinedByTaskId.get(task.upload_task_id);
              const videoId = task.acceptedEvidence?.platformVideoId;
              const conflicting = Boolean(videoId && target.conflictingVideoIds.includes(videoId));
              return <tr key={task.upload_task_id}>
                <td>{task.file_name}<br /><small>产品槽位 {task.accountProduct} · 账户 {task.advertiserId} · 计划 {task.adId}<br />项目 {task.project_id} · 批次 {task.batch_id}<br />上传任务 {task.upload_task_id}</small></td>
                <td>平台已接受 · 回执视频 {videoId ?? "未提供"}<br /><small>证据时间 {formatDateTime(task.acceptedEvidence!.observedAt)} · 文件 SHA-256 {task.artifact_sha256.slice(0, 12)}…</small>
                  {conflicting && <p role="alert">该视频 ID 存在不同文件哈希，拒绝关联。</p>}
                  {!conflicting && effect?.status === "matched" && <p>按完全相同的平台视频 ID 关联 {effect.materials.length} 条素材。</p>}
                  {!conflicting && effect?.status === "not-observed" && <p>快照中没有此视频 ID；该范围内未观察到素材（仅本计划、日期及固定筛选的效果集合）；不代表全账户上传库缺席，不推断上传失败或指标为零。</p>}
                  {!conflicting && !effect && <p>{validSelectedSnapshot ? "没有可核验的精确关联结果。" : "尚未选择此目标和日期范围的完整快照。"}</p>}
                </td>
                <td>{joinFailed ? "快照关联校验失败" : effect?.status === "matched" ? effect.materials.map(material => <div key={material.materialId}>
                  <strong>素材 {material.materialId}</strong><br /><small>平台视频 {material.videoId ?? "未返回"} · {material.name}</small>
                  <dl className="qianchuan-query-metrics">{QIANCHUAN_QUERY_METRICS.map(metric => <div key={metric}>
                    <dt>{metricLabels[metric]}</dt><dd title={`${metric} / ${material.metrics[metric].value}`}>{material.metrics[metric].display}</dd>
                  </div>)}</dl>
                </div>) : "—"}</td>
              </tr>;
            })}
          </tbody></table></div>
          <div className="qianguanjia-pagination"><span>本地接收记录第 {shownPage} / {totalPages} 页 · 匹配 {filteredTasks.length} / {target.tasks.length} 条</span>
            <button type="button" className="button secondary" disabled={shownPage <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button>
            <button type="button" className="button secondary" disabled={shownPage >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>下一页</button>
          </div>
        </>}
      </>}
      {!targetKey && <div className="qianguanjia-empty"><strong>请选择一个明确的账户与计划</strong><p>页面不会自动选择目标或采集；供应商目录未覆盖的账户仍可由原千川入口按冻结身份读取。</p></div>}
    </>}

    <details><summary>数据来源与核对边界</summary>
      <p>上传记录来自已读取的本地 ACCEPTED 账本；供应商目录覆盖只作对照。素材数据来自原千川只读采集和完整快照；只复用已经打开的账户浏览器，缺失时会停止并提示。</p>
      <p>当前采集固定使用 DataSetKey=site_promotion_product_post_data_video；query_type=all、roi2_material_type_v3=1001、marketing_goal=1、roi2_material_status=1、roi2_material_video_type=11，以及所选计划 ad_id。枚举的业务含义未独立确认，不把该筛选解释为全库、审核通过或投放中。</p>
      <p>本地成片仅按回执平台视频 ID 精确关联；文件名、素材名称和素材 ID 不用于猜测身份。相同视频对应不同 SHA-256 时相关记录不可归属。没有快照、没有匹配行或平台未提供的值均保持未知，不补零、不累计素材 ROI。</p>
    </details>
  </section>;
}
