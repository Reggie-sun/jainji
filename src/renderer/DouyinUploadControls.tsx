import { qianchuanProductName, QIANCHUAN_PRODUCTS, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account";
import type { QianchuanPlanOption } from "../shared/qianchuan-plan-selection";
import { QianchuanPlanSelect } from "./QianchuanPlanSelect";

export interface UploadSelectionDraft { enabled: true; accountProduct?: QianchuanProduct; plan?: QianchuanPlanOption; }
export function DouyinUploadControls({ value, onChange, accounts = [], disabled = false, idPrefix = "douyin-upload", compact = false }: {
  value?: UploadSelectionDraft; onChange(value?: UploadSelectionDraft): void;
  accounts?: QianchuanAccountSummary[]; disabled?: boolean; idPrefix?: string; compact?: boolean;
}) {
  const options = QIANCHUAN_PRODUCTS.map(product => { const account = accounts.find(item => item.product === product); return <option key={product} value={product} disabled={!account?.available}>{qianchuanProductName(product, accounts)}{account?.available ? "" : "（缺少可用配置）"}</option>; });
  const planSelect = value?.accountProduct && <QianchuanPlanSelect account={accounts.find(account => account.product === value.accountProduct)} value={value.plan} disabled={disabled} idPrefix={idPrefix}
    onChange={plan => onChange({ enabled: true, accountProduct: value.accountProduct, ...(plan ? { plan } : {}) })} />;
  if (compact) return <><label htmlFor={`${idPrefix}-product`}>千川上传
    <select id={`${idPrefix}-product`} aria-label="千川上传" value={value?.accountProduct ?? ""} disabled={disabled} title="本项成片自动上传；最多 9 条一组，停在确定前"
      onChange={event => onChange(event.target.value ? { enabled: true, accountProduct: event.target.value as QianchuanProduct } : undefined)}>
      <option value="">不上传</option>{options}
    </select>
  </label>{planSelect}</>;
  return <section className="card brief-card" aria-labelledby={`${idPrefix}-title`}>
    <div className="card-header"><h2 id={`${idPrefix}-title`}>千川上传</h2><span>本次可选</span></div>
    <label><input type="checkbox" checked={value?.enabled === true} disabled={disabled} onChange={event => onChange(event.target.checked ? { enabled: true } : undefined)} />本次成片导出完成后自动上传，停在确定前</label>
    <small>默认关闭；每次制作和追加选择一个产品账号，无需逐条选择视频。每组最多 9 条，全部上传成功后继续下一组；已上传记录会保存。</small>
    {value && <>
      <label htmlFor={`${idPrefix}-product`}>本次产品账号</label>
      <select id={`${idPrefix}-product`} value={value.accountProduct ?? ""} disabled={disabled} onChange={event => onChange({ enabled: true, ...(event.target.value ? { accountProduct: event.target.value as QianchuanProduct } : {}) })}>
        <option value="">请选择一个产品账号</option>
        {options}
      </select>
      {!value.accountProduct && <p role="alert">请选择产品账号后再开始制作。</p>}
      {planSelect}
      {!accounts.some(account => account.available) && <small>请先在作品页的账号设置中粘贴千川计划链接。</small>}
    </>}
  </section>;
}
