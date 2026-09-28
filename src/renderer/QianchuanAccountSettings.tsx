import { useState } from "react";
import { parseQianchuanPlanUrl, QIANCHUAN_PRODUCTS, type QianchuanAccountSetup, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account";

export function QianchuanAccountSettings({ accounts = [], busy, onSave }: {
  accounts?: QianchuanAccountSummary[]; busy: boolean; onSave(input: QianchuanAccountSetup): Promise<boolean>;
}) {
  const [product, setProduct] = useState<QianchuanProduct>();
  const [link, setLink] = useState("");
  const edit = (value: QianchuanProduct) => {
    const account = accounts.find(item => item.product === value);
    setProduct(value); setLink(account?.available ? `https://qianchuan.jinritemai.com/uni-prom?aavid=${account.advertiserId}&adId=${account.adId}` : "");
  };
  let ids: ReturnType<typeof parseQianchuanPlanUrl> | undefined;
  try { ids = parseQianchuanPlanUrl(link); } catch {}
  const save = async () => {
    if (!product || !ids) return;
    if (await onSave({ product, planUrl: link })) setProduct(undefined);
  };
  return <div className="qianchuan-account-settings" aria-label="千川账号设置">
    <p>账号设置 <small>点选产品，粘贴千川计划链接即可更换计划。</small></p>
    <div className="qianchuan-account-products">{QIANCHUAN_PRODUCTS.map(value => <button className="button secondary compact" type="button" key={value} disabled={busy} aria-pressed={product === value} onClick={() => edit(value)}>
      {value}<small>{accounts.find(item => item.product === value)?.available ? "已设置" : "未设置"}</small>
    </button>)}</div>
    {product && <div className="qianchuan-account-editor">
      <h3>{product} · 账号设置</h3>
      <label htmlFor="qianchuan-plan-link">千川计划链接</label>
      <textarea id="qianchuan-plan-link" rows={3} maxLength={16384} value={link} disabled={busy} placeholder="粘贴浏览器地址栏中的千川计划链接" onChange={event => setLink(event.target.value)} />
      {ids ? <p role="status">已识别账户 {ids.advertiserId} · 计划 {ids.adId}</p> : link.trim() ? <p role="alert">请粘贴含账户和计划 ID 的千川计划链接。</p> : <small>打开要上传的千川计划，复制地址栏链接。</small>}
      <small>浏览器连接由简辑自动识别。首次设置时，请在已登录 Chrome 中打开对应的千川计划。</small>
      <div className="douyin-upload-actions"><button className="button primary compact" type="button" disabled={busy || !ids} onClick={() => void save()}>保存账号</button><button className="button secondary compact" type="button" disabled={busy} onClick={() => setProduct(undefined)}>取消</button></div>
      <small>保存到简辑本机设置；已开始的批次继续使用原计划。</small>
    </div>}
  </div>;
}
