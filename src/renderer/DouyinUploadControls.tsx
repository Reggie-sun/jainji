import type { DouyinUploadSelection } from "../shared/douyin-upload";

export function DouyinUploadControls({ value, onChange, disabled = false, idPrefix = "douyin-upload" }: {
  value?: DouyinUploadSelection;
  onChange(value?: DouyinUploadSelection): void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const enabled = value?.enabled === true;
  const captionId = `${idPrefix}-caption`;
  return <section className="card brief-card" aria-labelledby={`${idPrefix}-title`}>
    <div className="card-header"><h2 id={`${idPrefix}-title`}>抖音上传</h2><span>本次可选</span></div>
    <label>
      <input type="checkbox" checked={enabled} disabled={disabled} onChange={(event) => onChange(event.target.checked
        ? { enabled: true, ...(value?.caption === undefined ? {} : { caption: value.caption }) }
        : undefined)} />
      本次制作的成片会传到抖音并提交发布
    </label>
    <small>默认关闭。发布文案由你手动填写，与展示文字 / 价格分开，也不会发送给制作模型。</small>
    {enabled && <>
      <label htmlFor={captionId}>抖音发布文案 <span>手动输入</span></label>
      <textarea id={captionId} rows={3} maxLength={4096} disabled={disabled} value={value.caption ?? ""} onChange={(event) => onChange({ enabled: true, ...(event.target.value.length ? { caption: event.target.value } : {}) })} />
      <small>只用于本次发布，最多 4096 字；不修改展示文字 / 价格。</small>
    </>}
  </section>;
}
