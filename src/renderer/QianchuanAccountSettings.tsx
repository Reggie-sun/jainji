import { useState } from "react";
import { QianchuanVideoLibraryActions } from "./QianchuanVideoLibraryActions";
import { parseQianchuanPlanUrl, qianchuanProductName, QIANCHUAN_PRODUCTS, QianchuanProductNameSchema, type QianchuanAccountSetup, type QianchuanAccountSummary, type QianchuanProduct, type QianchuanBrowserControl } from "../shared/qianchuan-account";

export function QianchuanAccountSettings({ accounts = [], busy, onSave, onOpenBrowser, onControlBrowser, initialProduct, expectedAdvertiserId }: {
  accounts?: QianchuanAccountSummary[]; busy: boolean; onSave(input: QianchuanAccountSetup): Promise<boolean>; onOpenBrowser(input: QianchuanAccountSetup): Promise<boolean>;
  onControlBrowser(input: QianchuanBrowserControl): Promise<boolean>;
  initialProduct?: QianchuanProduct; expectedAdvertiserId?: string;
}) {
  const initialAccount = accounts.find(item => item.product === initialProduct && item.available);
  const [product, setProduct] = useState<QianchuanProduct | undefined>(initialProduct);
  const [link, setLink] = useState(initialAccount ? `https://qianchuan.jinritemai.com/uni-prom?aavid=${initialAccount.advertiserId}&adId=${initialAccount.adId}` : "");
  const [name, setName] = useState(initialProduct ? qianchuanProductName(initialProduct, accounts) : "");
  const [browserAction, setBrowserAction] = useState<QianchuanBrowserControl["action"]>();
  const [browserMessage, setBrowserMessage] = useState("");
  const savedAccount = accounts.find(item => item.product === product && item.available);
  const edit = (value: QianchuanProduct) => {
    const account = accounts.find(item => item.product === value);
    setProduct(value); setLink(account?.available ? `https://qianchuan.jinritemai.com/uni-prom?aavid=${account.advertiserId}&adId=${account.adId}` : "");
    setName(qianchuanProductName(value, accounts));
    setBrowserAction(undefined); setBrowserMessage("");
  };
  const parsedName = QianchuanProductNameSchema.safeParse(name);
  const duplicateName = parsedName.success && QIANCHUAN_PRODUCTS.some(value => value !== product && qianchuanProductName(value, accounts) === parsedName.data);
  const nameError = !parsedName.success ? parsedName.error.issues[0].message : duplicateName ? "产品名称不能重复，请使用不同名称区分账号。" : undefined;
  let ids: ReturnType<typeof parseQianchuanPlanUrl> | undefined;
  try { ids = parseQianchuanPlanUrl(link); } catch {}
  const recoveryAccount = product === initialProduct ? expectedAdvertiserId : undefined;
  const accountError = recoveryAccount && ids && ids.advertiserId !== recoveryAccount ? `请使用原账户 ${recoveryAccount} 的新计划链接。` : undefined;
  const save = async () => {
    if (!product || !ids || !parsedName.success || nameError || accountError) return;
    if (await onSave({ product, productName: parsedName.data, planUrl: link })) setProduct(undefined);
  };
  return <div className="qianchuan-account-settings" aria-label="千川账号设置">
    <p>账号设置 <small>点选产品，可更换产品名称或千川计划。</small></p>
    <div className="qianchuan-account-products">{QIANCHUAN_PRODUCTS.map(value => <button className="button secondary compact" type="button" key={value} disabled={busy} aria-pressed={product === value} onClick={() => edit(value)}>
      {qianchuanProductName(value, accounts)}<small>{accounts.find(item => item.product === value)?.available ? "已设置" : "未设置"}</small>
    </button>)}</div>
    <QianchuanVideoLibraryActions accounts={accounts} busy={busy} />
    {product && <div className="qianchuan-account-editor">
      <h3>{qianchuanProductName(product, accounts)} · 账号设置</h3>
      {recoveryAccount && <p>账户 {recoveryAccount} 保持不变；填写新产品名称，粘贴新千川计划链接。保存新计划不会自动重传旧任务。</p>}
      <label htmlFor="qianchuan-product-name">产品名称</label>
      <input id="qianchuan-product-name" type="text" maxLength={40} value={name} disabled={busy} onChange={event => setName(event.target.value)} />
      {nameError && <p role="alert">{nameError}</p>}
      <small>只改产品名称时，保留当前 Chrome 连接和千川计划。</small>
      <label htmlFor="qianchuan-plan-link">千川计划链接</label>
      <textarea id="qianchuan-plan-link" rows={3} maxLength={16384} value={link} disabled={busy} placeholder="粘贴浏览器地址栏中的千川计划链接" onChange={event => setLink(event.target.value)} />
      {ids ? <p role="status">已识别账户 {ids.advertiserId} · 计划 {ids.adId}</p> : link.trim() ? <p role="alert">请粘贴含账户和计划 ID 的千川计划链接。</p> : <small>打开要上传的千川计划，复制地址栏链接。</small>}
      {accountError && <p role="alert">{accountError}</p>}
      <small>新制作会自动打开或连接已绑定的账号浏览器。可在这里打开、关闭或重启同一窗口；登录状态会保留。</small>
      <button className="button secondary compact" type="button" disabled={busy || !ids || !!nameError || !!accountError} onClick={() => product && void onOpenBrowser({ product, productName: name.trim(), planUrl: link })}>打开账号浏览器 / 登录</button>
      <div className="douyin-upload-actions">
        <button className="button secondary compact" type="button" disabled={busy || !savedAccount} onClick={() => { setBrowserMessage(""); setBrowserAction("restart"); }}>重启并连接</button>
        <button className="button secondary compact" type="button" disabled={busy || !savedAccount} onClick={() => { setBrowserMessage(""); setBrowserAction("close"); }}>关闭账号浏览器</button>
      </div>
      {browserAction && savedAccount && <div role="group" aria-label="确认账号浏览器操作">
        <p>将{browserAction === "restart" ? "关闭并重新打开" : "关闭"}{qianchuanProductName(savedAccount.product, accounts)}（账户 {savedAccount.advertiserId}）的全部浏览器窗口，未保存的网页内容可能丢失。登录目录会保留。</p>
        <small>有制作、上传、待确认或结果未知的任务时，软件会保护窗口并停止操作。</small>
        <button className="button secondary compact" type="button" disabled={busy} onClick={() => void onControlBrowser({ product: savedAccount.product, expectedAdvertiserId: savedAccount.advertiserId, action: browserAction }).then(done => { if (done) { setBrowserMessage(browserAction === "restart" ? "账号浏览器已重启并连接；下一次制作使用新连接。" : "账号浏览器已关闭，登录状态保留。"); setBrowserAction(undefined); } })}>确认{browserAction === "restart" ? "重启并连接" : "关闭浏览器"}</button>
        <button className="button secondary compact" type="button" disabled={busy} onClick={() => setBrowserAction(undefined)}>取消浏览器操作</button>
      </div>}
      {browserMessage && <p role="status">{browserMessage}</p>}
      <div className="douyin-upload-actions"><button className="button primary compact" type="button" disabled={busy || !ids || !!nameError || !!accountError} onClick={() => void save()}>{recoveryAccount ? "保存新产品和计划" : "保存账号"}</button><button className="button secondary compact" type="button" disabled={busy} onClick={() => setProduct(undefined)}>取消</button></div>
      <small>保存后供新制作使用；旧批次保留原计划。整批从未选过文件时，可在上传任务中明确“改传当前计划”；已有文件选择记录不能改传。</small>
    </div>}
  </div>;
}
