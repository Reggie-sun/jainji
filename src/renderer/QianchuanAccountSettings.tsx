import { useEffect, useState } from "react";
import { QianchuanEgressSettings } from "./QianchuanEgressSettings";
import { QianchuanAccountUploadBatches } from "./QianchuanAccountUploadBatches";
import type { DouyinUploadStatus, QianchuanUploadBatchSummary } from "../shared/douyin-upload";
import { egressIdentity, QianchuanEgressSchema, validateEgressGroups, type QianchuanEgress } from "../shared/qianchuan-egress";
import { scrollWorkspace } from "./WorkspacePage";
import { parseQianchuanPlanUrl, qianchuanAccountName, qianchuanProductName, QIANCHUAN_PRODUCTS, QianchuanProductNameSchema, type QianchuanAccountSetup, type QianchuanAccountSummary, type QianchuanProduct, type QianchuanBrowserControl } from "../shared/qianchuan-account";

export function QianchuanAccountSettings({ accounts = [], busy, onSave, onOpenBrowser, onControlBrowser, initialProduct, expectedAdvertiserId, batches, onCloseBatch }: {
  accounts?: QianchuanAccountSummary[]; busy: boolean; onSave(input: QianchuanAccountSetup): Promise<boolean>; onOpenBrowser(input: QianchuanAccountSetup): Promise<boolean>;
  onControlBrowser(input: QianchuanBrowserControl): Promise<boolean>;
  initialProduct?: QianchuanProduct; expectedAdvertiserId?: string;
  batches?: DouyinUploadStatus["accountBatches"]; onCloseBatch?(batch: QianchuanUploadBatchSummary): Promise<boolean>;
}) {
  const initialAccount = accounts.find(item => item.product === initialProduct && item.available);
  const [product, setProduct] = useState<QianchuanProduct | undefined>(initialProduct);
  const [link, setLink] = useState(initialAccount ? `https://qianchuan.jinritemai.com/uni-prom?aavid=${initialAccount.advertiserId}&adId=${initialAccount.adId}` : "");
  const [name, setName] = useState(initialProduct ? qianchuanProductName(initialProduct, accounts) : "");
  const [egress, setEgress] = useState<QianchuanEgress | null>(initialAccount?.egress ?? null);
  const [browserAction, setBrowserAction] = useState<"close" | "restart">();
  const [browserMessage, setBrowserMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const savedAccount = accounts.find(item => item.product === product && item.available);
  useEffect(() => { if (product && !initialProduct) scrollWorkspace({ selector: "#qianchuan-account-editor" }); }, [product]);
  const edit = (value: QianchuanProduct) => {
    if (value === product) return;
    const account = accounts.find(item => item.product === value);
    setProduct(value); setLink(account?.available ? `https://qianchuan.jinritemai.com/uni-prom?aavid=${account.advertiserId}&adId=${account.adId}` : "");
    setName(qianchuanProductName(value, accounts));
    setEgress(account?.egress ?? null);
    setActionError("");
    setBrowserAction(undefined); setBrowserMessage("");
  };
  const parsedName = QianchuanProductNameSchema.safeParse(name);
  const duplicateName = parsedName.success && QIANCHUAN_PRODUCTS.some(value => value !== product && qianchuanProductName(value, accounts) === parsedName.data);
  const nameError = !parsedName.success ? parsedName.error.issues[0].message : duplicateName ? "产品名称不能重复，请使用不同名称区分账号。" : undefined;
  let ids: ReturnType<typeof parseQianchuanPlanUrl> | undefined;
  try { ids = parseQianchuanPlanUrl(link); } catch {}
  const recoveryAccount = product === initialProduct ? expectedAdvertiserId : undefined;
  const accountError = recoveryAccount && ids && ids.advertiserId !== recoveryAccount ? `请使用原账户 ${recoveryAccount} 的新计划链接。` : undefined;
  const parsedEgress = egress ? QianchuanEgressSchema.safeParse(egress) : undefined;
  const groupMembers = savedAccount?.egress ? accounts.filter(account => account.egress?.group === savedAccount.egress!.group) : [];
  const canChangeGroup = !!(parsedEgress?.success && savedAccount?.egress && ids?.advertiserId === savedAccount.advertiserId &&
    groupMembers.length > 1 && groupMembers.every(account => account.advertiserId) && parsedEgress.data.mode !== savedAccount.egress.mode &&
    egressIdentity({ ...parsedEgress.data, mode: savedAccount.egress.mode }) === egressIdentity(savedAccount.egress));
  const groupChange = canChangeGroup && savedAccount?.egress
    ? { expected: { ...savedAccount.egress }, advertiserIds: groupMembers.map(account => account.advertiserId) } : undefined;
  const groupIssues: string[] = [];
  if (parsedEgress?.success) validateEgressGroups([...accounts.filter(account => account.product !== product).map(account =>
    groupChange && account.egress?.group === groupChange.expected.group ? { ...account, egress: parsedEgress.data } : account),
    { egress: parsedEgress.data }], { path: [], addIssue: issue => { if (issue.message) groupIssues.push(issue.message); } });
  const egressError = parsedEgress && !parsedEgress.success ? parsedEgress.error.issues[0].message : groupIssues[0];
  const savedLink = savedAccount ? `https://qianchuan.jinritemai.com/uni-prom?aavid=${savedAccount.advertiserId}&adId=${savedAccount.adId}` : "";
  const dirty = !!product && (name !== qianchuanProductName(product, accounts) || link !== savedLink || JSON.stringify(egress) !== JSON.stringify(savedAccount?.egress ?? null));
  const save = async () => {
    if (!product || !ids || !parsedName.success || nameError || accountError || egressError) return;
    setActionError(""); setBrowserMessage(""); setSaving(true);
    try {
      if (await onSave({ product, productName: parsedName.data, planUrl: link, egress, ...(groupChange ? { egressGroupChange: groupChange } : {}) })) {
        setBrowserMessage("账号设置已保存，新制作将使用所选上传方式。"); setProduct(undefined);
      } else setActionError("账号设置未保存，请稍后重试。");
    } catch (error) { setActionError(error instanceof Error ? error.message : "账号设置未保存，请稍后重试。"); }
    finally { setSaving(false); }
  };
  const performBrowser = async (action: () => Promise<boolean>, message: string) => {
    setActionError(""); setBrowserMessage("");
    try {
      if (await action()) { setBrowserMessage(message); setBrowserAction(undefined); }
      else setActionError("账号浏览器操作未完成，请稍后重试。");
    } catch (error) { setActionError(error instanceof Error ? error.message : "账号浏览器操作未完成，请稍后重试。"); }
  };
  const changeEgress = (value: QianchuanEgress | null) => {
    setEgress(value); setActionError("");
  };
  return <div className="qianchuan-account-settings" aria-label="千川账号设置">
    <p>点选账号设置上传方式，也可更换产品名称或千川计划。</p>
    <div className="qianchuan-account-products">{QIANCHUAN_PRODUCTS.map(value => {
      const account = accounts.find(item => item.product === value);
      return <button className="button secondary compact" type="button" key={value} disabled={busy} aria-expanded={product === value} onClick={() => edit(value)}>
        <strong>{account ? qianchuanAccountName(account) : value}</strong>{account?.advertiserId && <small>账户 {account.advertiserId}</small>}<small>{account?.available ? `已设置 · 计划 ${account.adId}` : "未设置"}</small>
        {account?.available && <><span className="qianchuan-upload-method">{!account.egress ? "本机上传" : account.egress.mode === "remote-browser" ? "VPS 上传" : "本机上传 · VPS 出口"}</span>{account.egress?.mode === "remote-browser" && <small>需本机简辑运行</small>}</>}
        <span className="qianchuan-account-edit-link">{account?.available ? "设置上传方式 →" : "配置账号 →"}</span>
      </button>;
    })}</div>
    {product && <div className="qianchuan-account-editor" id="qianchuan-account-editor" tabIndex={-1}>
      <h3>{savedAccount ? qianchuanAccountName(savedAccount) : product} · 账号设置</h3>
      {dirty && <small role="status">账号有未保存的修改</small>}
      {recoveryAccount && <p>账户 {recoveryAccount} 保持不变；填写新产品名称，粘贴新千川计划链接。保存新计划不会自动重传旧任务。</p>}
      <QianchuanEgressSettings key={product} value={egress} onChange={changeEgress} accounts={accounts} busy={busy || saving} groupError={groupIssues[0]} />
      {(canChangeGroup || groupChange) && <div role="group" aria-label="主体上传方式整组切换">
        <p>同主体的 {groupMembers.length} 个账号将同步切换：{groupMembers.map(account => qianchuanAccountName(account)).join("、")}。</p>
        <small>保存时自动检查任务并关闭空闲浏览器，出口 IP 保持不变。有未结束的上传任务时会提示原因。</small>
      </div>}
      <label htmlFor="qianchuan-product-name">产品名称</label>
      <input id="qianchuan-product-name" type="text" maxLength={40} value={name} disabled={busy} onChange={event => setName(event.target.value)} />
      {nameError && <p role="alert">{nameError}</p>}
      <small>产品名称用于模板匹配；账号显示名称跟随 Chrome 资料名。只改产品名称时，保留当前 Chrome 连接和千川计划。</small>
      <label htmlFor="qianchuan-plan-link">千川计划链接</label>
      <textarea id="qianchuan-plan-link" rows={3} maxLength={16384} value={link} disabled={busy} placeholder="粘贴浏览器地址栏中的千川计划链接" onChange={event => setLink(event.target.value)} />
      {ids ? <p role="status">已识别账户 {ids.advertiserId} · 计划 {ids.adId}</p> : link.trim() ? <p role="alert">请粘贴含账户和计划 ID 的千川计划链接。</p> : <small>打开要上传的千川计划，复制地址栏链接。</small>}
      {accountError && <p role="alert">{accountError}</p>}
      <small>新制作会自动连接已保存的上传方式。首次登录可在保存后打开账号浏览器。</small>
      <button className="button secondary compact" type="button" disabled={busy || !ids || !!nameError || !!accountError || !!egressError || dirty} onClick={() => product && void performBrowser(() => onOpenBrowser({ product, productName: name.trim(), planUrl: link, egress }), "账号浏览器已打开，首次使用请完成登录。")}>打开账号浏览器 / 登录</button>
      <details><summary>浏览器维护</summary>
      <div className="douyin-upload-actions">
        {savedAccount?.egress && <button className="button secondary compact" type="button" disabled={busy} onClick={() => void performBrowser(() => onControlBrowser({ product: savedAccount.product, expectedAdvertiserId: savedAccount.advertiserId, action: "reconnect-egress" }), "固定出口已连接并通过 IP 校验；未继续或重传任何上传任务。")}>重连固定出口</button>}
        <button className="button secondary compact" type="button" disabled={busy || !savedAccount} onClick={() => { setBrowserMessage(""); setBrowserAction("restart"); }}>重启并连接</button>
        <button className="button secondary compact" type="button" disabled={busy || !savedAccount} onClick={() => { setBrowserMessage(""); setBrowserAction("close"); }}>关闭账号浏览器</button>
      </div>
      {browserAction && savedAccount && <div role="group" aria-label="确认账号浏览器操作">
        <p>将{browserAction === "restart" ? "关闭并重新打开" : "关闭"}{qianchuanAccountName(savedAccount)}（账户 {savedAccount.advertiserId}）的全部浏览器窗口，未保存的网页内容可能丢失。登录目录会保留。</p>
        <small>有制作、上传、待确认或结果未知的任务时，软件会保护窗口并停止操作。</small>
        <button className="button secondary compact" type="button" disabled={busy} onClick={() => void performBrowser(() => onControlBrowser({ product: savedAccount.product, expectedAdvertiserId: savedAccount.advertiserId, action: browserAction }), browserAction === "restart" ? "账号浏览器已重启并连接；下一次制作使用新连接。" : "账号浏览器已关闭，登录状态保留。")}>确认{browserAction === "restart" ? "重启并连接" : "关闭浏览器"}</button>
        <button className="button secondary compact" type="button" disabled={busy} onClick={() => setBrowserAction(undefined)}>取消浏览器操作</button>
      </div>}
      </details>
      {actionError && <p role="alert">{actionError}</p>}
      {onCloseBatch && <QianchuanAccountUploadBatches accounts={accounts} busy={busy || saving} expanded={!!actionError} onClose={async batch => {
        const done = await onCloseBatch(batch);
        if (done) { setActionError(""); setBrowserMessage("本批本地上传已结束。处理完剩余批次后，可再次保存上传方式。"); }
        return done;
      }}
        batches={batches?.filter(batch => batch.relatedAccountProducts?.includes(product) || batch.accountProduct === product || batch.advertiserId === savedAccount?.advertiserId || canChangeGroup && groupMembers.some(account => batch.relatedAccountProducts?.includes(account.product) || account.product === batch.accountProduct || account.advertiserId === batch.advertiserId))} />}
      {browserMessage && <p role="status">{browserMessage}</p>}
      <div className="douyin-upload-actions"><button className="button primary compact" type="button" disabled={busy || saving || !ids || !!nameError || !!accountError || !!egressError} onClick={() => void save()}>{saving ? "正在保存并应用…" : recoveryAccount ? "保存新产品和计划" : "保存账号"}</button><button className="button secondary compact" type="button" disabled={busy || saving} onClick={() => setProduct(undefined)}>取消</button></div>
      <small>更换上传方式时，保存会自动关闭相关账号的空闲浏览器；登录状态保留，网页未保存的内容可能丢失。</small>
      <small>保存后供新制作使用；旧批次保留原计划。整批从未选过文件时，可在上传任务中明确“改传当前计划”；已有文件选择记录不能改传。</small>
    </div>}
    {!product && browserMessage && <p role="status">{browserMessage}</p>}
  </div>;
}
