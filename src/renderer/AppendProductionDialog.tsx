import { useState } from "react";
import { MAX_AGENT_OUTPUTS } from "../shared/agent";
import { PRODUCT_PRICE_HELP, PRODUCT_PRICE_MAX_LENGTH, RequiredProductPriceSchema } from "../shared/decorations";
import type { PublicExportBatch } from "../main/application";
import { Icon } from "./ui";

export function AppendProductionDialog({ batch, prefill, mediaLabel, initialCount, onClose }: {
  batch: PublicExportBatch;
  prefill: { productPrice: string; mediaCount: number };
  mediaLabel: string;
  initialCount?: number;
  onClose(): void;
}) {
  const [productPrice, setProductPrice] = useState(prefill.productPrice);
  const [count, setCount] = useState(initialCount ?? 1);
  const [manualDirectory, setManualDirectory] = useState<string>();
  const [useManualDirectory, setUseManualDirectory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const maxCount = Math.max(1, Math.floor(MAX_AGENT_OUTPUTS / prefill.mediaCount));
  const priceValid = RequiredProductPriceSchema.safeParse(productPrice).success;
  const countValid = Number.isInteger(count) && count >= 1 && count <= maxCount;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const parsed = RequiredProductPriceSchema.safeParse(productPrice);
      if (!parsed.success) throw new Error(PRODUCT_PRICE_HELP);
      if (!countValid) throw new Error(`请填写 1 到 ${maxCount} 之间的整数条数。`);
      const outputDirectory = useManualDirectory ? manualDirectory : await window.jianji.createAutomaticOutputDirectory(batch.mediaIds);
      if (!outputDirectory) throw new Error("请选择成片保存目录。");
      await window.jianji.appendProduction({ batchId: batch.id, count, productPrice: parsed.data, outputDirectory });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "追加制作失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return <div className="result-preview-backdrop" role="presentation" onClick={busy ? undefined : onClose}><section className="result-preview-dialog card" role="dialog" aria-modal="true" aria-label="追加制作" onClick={(event) => event.stopPropagation()}>
    <div className="card-header"><h2>追加制作</h2><button type="button" className="icon-button" aria-label="关闭追加制作" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></div>
    <p>源批次：{mediaLabel} · {prefill.mediaCount} 条素材 · 复用已冻结的包装方案，不重新调用模型。</p>
    <label htmlFor="append-price">展示文字 / 价格 <span>必填 · 手动输入</span></label>
    <textarea id="append-price" rows={2} required aria-invalid={!priceValid} inputMode="text" maxLength={PRODUCT_PRICE_MAX_LENGTH} disabled={busy} value={productPrice} onChange={(event) => setProductPrice(event.target.value)} />
    <small>预填的是源批次保存的手动文字，可修改；按 Enter 换行，最多2行、每行12字。</small>
    {!priceValid && <p role="alert">{PRODUCT_PRICE_HELP}</p>}
    <label htmlFor="append-count">追加条数</label>
    <input id="append-count" type="number" min={1} max={maxCount} step={1} value={count} disabled={busy} onChange={(event) => setCount(event.target.valueAsNumber)} />
    {count > 1 && <p role="note">同一批次追加多条将生成内容相同的视频，仅文件名不同；需要不同画面请从多个批次各追加 1 条。</p>}
    <label htmlFor="append-directory">成片保存到</label>
    <button id="append-directory" type="button" className="directory-picker" disabled={busy} onClick={() => void window.jianji.selectOutputDirectory().then((selected) => { if (selected) { setManualDirectory(selected); setUseManualDirectory(true); } })}><Icon name="folder" /><span>{useManualDirectory && manualDirectory ? manualDirectory : "自动创建 视频/M.D HH:MM"}</span></button>
    {useManualDirectory && <button type="button" className="text-button" disabled={busy} onClick={() => { setUseManualDirectory(false); setManualDirectory(undefined); }}>改为自动创建目录</button>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div><button type="button" className="text-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="button primary" disabled={busy || !priceValid || !countValid} onClick={() => void submit()}>{busy ? "正在追加…" : `追加 ${Number.isFinite(count) ? count : ""} 条并开始渲染`}</button></div>
  </section></div>;
}
