import { useState } from "react";
import { parseQianchuanPlanUrl, qianchuanProductName, QIANCHUAN_PRODUCTS, QianchuanProductNameSchema, type QianchuanAccountSetup, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account";

export function QianchuanAccountSettings({ accounts = [], busy, onSave, onOpenBrowser }: {
  accounts?: QianchuanAccountSummary[]; busy: boolean; onSave(input: QianchuanAccountSetup): Promise<boolean>; onOpenBrowser(input: QianchuanAccountSetup): Promise<boolean>;
}) {
  const [product, setProduct] = useState<QianchuanProduct>();
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const edit = (value: QianchuanProduct) => {
    const account = accounts.find(item => item.product === value);
    setProduct(value); setLink(account?.available ? `https://qianchuan.jinritemai.com/uni-prom?aavid=${account.advertiserId}&adId=${account.adId}` : "");
    setName(qianchuanProductName(value, accounts));
  };
  const parsedName = QianchuanProductNameSchema.safeParse(name);
  const duplicateName = parsedName.success && QIANCHUAN_PRODUCTS.some(value => value !== product && qianchuanProductName(value, accounts) === parsedName.data);
  const nameError = !parsedName.success ? parsedName.error.issues[0].message : duplicateName ? "产品名称不能重复，请使用不同名称区分账号。" : undefined;
  let ids: ReturnType<typeof parseQianchuanPlanUrl> | undefined;
  try { ids = parseQianchuanPlanUrl(link); } catch {}
  const save = async () => {
    if (!product || !ids || !parsedName.success || nameError) return;
    if (await onSave({ product, productName: parsedName.data, planUrl: link })) setProduct(undefined);
  };
  return <div className="qianchuan-account-settings" aria-label="千川账号设置">
    <p>账号设置 <small>点选产品，可更换产品名称或千川计划。</small></p>
    <div className="qianchuan-account-products">{QIANCHUAN_PRODUCTS.map(value => <button className="button secondary compact" type="button" key={value} disabled={busy} aria-pressed={product === value} onClick={() => edit(value)}>
      {qianchuanProductName(value, accounts)}<small>{accounts.find(item => item.product === value)?.available ? "已设置" : "未设置"}</small>
    </button>)}</div>
    {product && <div className="qianchuan-account-editor">
      <h3>{qianchuanProductName(product, accounts)} · 账号设置</h3>
      <label htmlFor="qianchuan-product-name">产品名称</label>
      <input id="qianchuan-product-name" type="text" maxLength={40} value={name} disabled={busy} onChange={event => setName(event.target.value)} />
      {nameError && <p role="alert">{nameError}</p>}
      <small>只改产品名称时，保留当前 Chrome 连接和千川计划。</small>
      <label htmlFor="qianchuan-plan-link">千川计划链接</label>
      <textarea id="qianchuan-plan-link" rows={3} maxLength={16384} value={link} disabled={busy} placeholder="粘贴浏览器地址栏中的千川计划链接" onChange={event => setLink(event.target.value)} />
      {ids ? <p role="status">已识别账户 {ids.advertiserId} · 计划 {ids.adId}</p> : link.trim() ? <p role="alert">请粘贴含账户和计划 ID 的千川计划链接。</p> : <small>打开要上传的千川计划，复制地址栏链接。</small>}
      <small>已绑定的原账号浏览器会自动复用，关闭后也会打开同一账号窗口。首次没有可用账号窗口时，请打开浏览器并登录千川；登录状态会保留。</small>
      <button className="button secondary compact" type="button" disabled={busy || !ids || !!nameError} onClick={() => product && void onOpenBrowser({ product, productName: name.trim(), planUrl: link })}>打开账号浏览器 / 登录</button>
      <div className="douyin-upload-actions"><button className="button primary compact" type="button" disabled={busy || !ids || !!nameError} onClick={() => void save()}>保存账号</button><button className="button secondary compact" type="button" disabled={busy} onClick={() => setProduct(undefined)}>取消</button></div>
      <small>保存后供新制作使用；旧批次保留原计划。整批从未选过文件时，可在上传任务中明确“改传当前计划”；已有文件选择记录不能改传。</small>
    </div>}
  </div>;
}
