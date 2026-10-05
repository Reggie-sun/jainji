import { useEffect, useRef, useState } from "react";
import { MAX_AGENT_OUTPUTS, type AppendProductionPrefill } from "../shared/agent";
import { PRODUCT_PRICE_HELP, PRODUCT_PRICE_MAX_LENGTH, RequiredProductPriceSchema } from "../shared/decorations";
import type { PublicExportBatch } from "../main/application";
import { Icon } from "./ui";
import { QianchuanUploadSelectionSchema } from "../shared/douyin-upload";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { DouyinUploadControls, type UploadSelectionDraft } from "./DouyinUploadControls";

export function AppendProductionDialog({ batch, prefill, mediaLabel, initialCount, accounts, onClose }: {
  batch: PublicExportBatch;
  prefill: AppendProductionPrefill;
  mediaLabel: string;
  initialCount?: number;
  accounts?: QianchuanAccountSummary[];
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    element?.showModal();
    return () => { element?.close(); previousFocus?.focus(); };
  }, []);
  const [productPrice, setProductPrice] = useState(prefill.productPrice);
  const [count, setCount] = useState(initialCount ?? 1);
  const [manualDirectory, setManualDirectory] = useState<string>();
  const [useManualDirectory, setUseManualDirectory] = useState(false);
  const [douyinUploadSelection, setDouyinUploadSelection] = useState<UploadSelectionDraft>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const maxCount = Math.max(1, Math.floor(MAX_AGENT_OUTPUTS / prefill.mediaCount));
  const displayTextEnabled = prefill.displayTextEnabled !== false;
  const priceValid = !displayTextEnabled || RequiredProductPriceSchema.safeParse(productPrice).success;
  const countValid = Number.isInteger(count) && count >= 1 && count <= maxCount;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (douyinUploadSelection && !douyinUploadSelection.plan) throw new Error("请选择上传计划后再追加制作。");
      const uploadSelection = douyinUploadSelection ? QianchuanUploadSelectionSchema.parse(douyinUploadSelection) : undefined;
      const parsed = displayTextEnabled ? RequiredProductPriceSchema.safeParse(productPrice) : { success: true as const, data: "" };
      if (!parsed.success) throw new Error(PRODUCT_PRICE_HELP);
      if (!countValid) throw new Error(`请填写 1 到 ${maxCount} 之间的整数条数。`);
      const outputDirectory = useManualDirectory ? manualDirectory : await window.jianji.createAutomaticOutputDirectory(batch.mediaIds);
      if (!outputDirectory) throw new Error("请选择成片保存目录。");
      await window.jianji.appendProduction({ batchId: batch.id, count, productPrice: parsed.data, outputDirectory, ...(uploadSelection ? { douyinUpload: uploadSelection } : {}) });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "追加制作失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return <dialog ref={dialog} className="result-preview-dialog append-production-dialog card" aria-label="追加制作" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <div className="card-header"><h2>追加制作</h2><button type="button" className="icon-button" aria-label="关闭追加制作" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></div>
    <p>源批次：{mediaLabel} · {prefill.mediaCount} 条素材 · 贴纸和滤镜随机搭配，零模型调用。</p>
    {displayTextEnabled ? <><label htmlFor="append-price">展示文字 / 价格 <span>必填 · 手动输入</span></label>
    <textarea id="append-price" rows={2} required aria-invalid={!priceValid} inputMode="text" maxLength={PRODUCT_PRICE_MAX_LENGTH} disabled={busy} value={productPrice} onChange={(event) => setProductPrice(event.target.value)} />
    <small>预填的是源批次保存的手动文字，可修改；按 Enter 换行，最多2行、每行12字。</small>
    {!priceValid && <p role="alert">{PRODUCT_PRICE_HELP}</p>}</> : <p role="note">源批次已关闭展示文字，追加制作沿用该设置。</p>}
    <label htmlFor="append-count">追加条数</label>
    <input id="append-count" type="number" min={1} max={maxCount} step={1} value={count} disabled={busy} onChange={(event) => setCount(event.target.valueAsNumber)} />
    {count > 1 && <p role="note">同一批次追加多条将随机搭配不同贴纸和滤镜，布局保持不变。</p>}
    <DouyinUploadControls idPrefix="append-douyin-upload" value={douyinUploadSelection} onChange={setDouyinUploadSelection} accounts={accounts} disabled={busy} />
    <label htmlFor="append-directory">成片保存到</label>
    <button id="append-directory" type="button" className="directory-picker" disabled={busy} onClick={() => void window.jianji.selectOutputDirectory().then((selected) => { if (selected) { setManualDirectory(selected); setUseManualDirectory(true); } })}><Icon name="folder" /><span>{useManualDirectory && manualDirectory ? manualDirectory : "自动创建 视频/M.D HH:MM"}</span></button>
    {useManualDirectory && <button type="button" className="text-button" disabled={busy} onClick={() => { setUseManualDirectory(false); setManualDirectory(undefined); }}>改为自动创建目录</button>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div><button type="button" className="text-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="button primary" disabled={busy || !priceValid || !countValid} onClick={() => void submit()}>{busy ? "正在追加…" : `追加 ${Number.isFinite(count) ? count : ""} 条并开始渲染`}</button></div>
  </dialog>;
}
