import { useState } from "react";
import { parseQianchuanPlanUrl, QIANCHUAN_PRODUCTS, type QianchuanAccountSetup, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account";

export function QianchuanAccountSettings({ accounts = [], busy, onSave }: {
  accounts?: QianchuanAccountSummary[]; busy: boolean; onSave(input: QianchuanAccountSetup): Promise<boolean>;
}) {
  const [product, setProduct] = useState<QianchuanProduct>();
  const [link, setLink] = useState(""), [port, setPort] = useState("");
  const edit = (value: QianchuanProduct) => {
    const account = accounts.find(item => item.product === value);
    setProduct(value); setLink(account?.available ? `https://qianchuan.jinritemai.com/uni-prom?aavid=${account.advertiserId}&adId=${account.adId}` : "");
    setPort(account?.browserPort ? String(account.browserPort) : "");
  };
  let ids: ReturnType<typeof parseQianchuanPlanUrl> | undefined;
  try { ids = parseQianchuanPlanUrl(link); } catch {}
  const account = accounts.find(item => item.product === product);
  const browserPort = port ? Number(port) : undefined;
  const validPort = browserPort === undefined ? Boolean(account?.browserPort) : Number.isInteger(browserPort) && browserPort >= 1 && browserPort <= 65535;
  const save = async () => {
    if (!product || !ids || !validPort) return;
    if (await onSave({ product, planUrl: link, ...(browserPort === undefined ? {} : { browserPort }) })) setProduct(undefined);
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
      {account?.browserPort ? <details><summary>浏览器连接</summary><label htmlFor="qianchuan-browser-port">已登录 Chrome 的端口</label><input id="qianchuan-browser-port" type="number" min={1} max={65535} value={port} disabled={busy} onChange={event => setPort(event.target.value)} /></details> : <>
        <label htmlFor="qianchuan-browser-port">已登录 Chrome 的端口</label><input id="qianchuan-browser-port" type="number" min={1} max={65535} value={port} disabled={busy} placeholder="填写该账号浏览器的调试端口" onChange={event => setPort(event.target.value)} />
        <small>首次绑定需要浏览器端口；计划链接不包含浏览器登录信息。</small>
      </>}
      <div className="douyin-upload-actions"><button className="button primary compact" type="button" disabled={busy || !ids || !validPort} onClick={() => void save()}>保存账号</button><button className="button secondary compact" type="button" disabled={busy} onClick={() => setProduct(undefined)}>取消</button></div>
      <small>保存到简辑本机设置；已开始的批次继续使用原计划。</small>
    </div>}
  </div>;
}
