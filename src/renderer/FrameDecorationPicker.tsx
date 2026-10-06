import { useEffect, useRef, useState } from "react";
import type { DecorationOptions } from "../shared/decorations";
import type { FrameCatalogEntry } from "../shared/frames";
import { Icon } from "./ui";
import "./decoration-frames.css";

export function FrameDecorationPicker({ value, onChange, disabled, mutationDisabled = disabled }: {
  value: DecorationOptions; onChange(value: DecorationOptions): void; disabled: boolean; mutationDisabled?: boolean;
}) {
  const [frames, setFrames] = useState<FrameCatalogEntry[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const mounted = useRef(true);
  const valueRef = useRef(value); valueRef.current = value;
  useEffect(() => {
    mounted.current = true;
    void window.jianji.decorationCatalog().then(catalog => { if (mounted.current) setFrames(catalog.frames ?? []); })
      .catch(() => { if (mounted.current) setError("边框读取失败，请重新打开规则模板。"); });
    return () => { mounted.current = false; };
  }, []);
  const importFrame = async () => {
    if (mutationDisabled || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const id = await window.jianji.importFrame();
      if (!id || !mounted.current) return;
      const catalog = await window.jianji.decorationCatalog();
      if (!mounted.current) return;
      setFrames(catalog.frames ?? []);
      onChange({ ...valueRef.current, frameId: id });
      setMessage("边框已上传并选中，自己的四角贴纸会叠在边框上方。");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "边框上传失败，请检查图片后重试。");
    } finally { if (mounted.current) setBusy(false); }
  };
  const removeFrame = async (id: string) => {
    if (mutationDisabled || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await window.jianji.removeFrame(id);
      if (valueRef.current.frameId === id) onChange({ ...valueRef.current, frameId: undefined });
      if (!mounted.current) return;
      setFrames(current => current?.filter(frame => frame.id !== id));
      setConfirmDelete(undefined);
      setMessage("边框已删除；历史任务保留原文件，仍可按冻结方案重试。");
    } catch { if (mounted.current) setError("边框删除失败，请等待当前制作结束后重试。"); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section className="card frame-decoration-picker" aria-label="整圈边框设置">
    <div className="frame-decoration-heading"><div><h2>整圈边框</h2><p>先框住四周，再在边框上叠加自己的四角贴纸。</p></div>
      <button type="button" className="button secondary" disabled={mutationDisabled || busy} onClick={() => void importFrame()}><Icon name="upload" size={17} />{busy ? "正在更新…" : "上传透明边框 PNG"}</button>
    </div>
    <div className="frame-decoration-grid" role="group" aria-label="选择整圈边框">
      <button type="button" className="frame-decoration-choice" aria-pressed={!value.frameId} disabled={disabled || busy} onClick={() => onChange({ ...value, frameId: undefined })}><span className="frame-decoration-none">无</span><span>不加边框</span></button>
      {frames?.map(frame => <div key={frame.id}><button type="button" className="frame-decoration-choice" aria-pressed={value.frameId === frame.id} disabled={disabled || busy} onClick={() => onChange({ ...value, frameId: frame.id })}><img src={frame.url} alt="" /><span>{frame.label}</span></button>
        {frame.source === "uploaded" && <div className="frame-decoration-delete">{confirmDelete === frame.id ? <><button type="button" disabled={mutationDisabled || busy} onClick={() => void removeFrame(frame.id)}>确认删除</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(undefined)}>取消</button></> : <button type="button" disabled={mutationDisabled || busy} aria-label={`删除 ${frame.label}`} onClick={() => setConfirmDelete(frame.id)}>删除</button>}</div>}
      </div>)}
    </div>
    {!frames && !error && <p role="status">正在读取边框…</p>}
    {value.frameId && frames && !frames.some(frame => frame.id === value.frameId) && <p role="alert">所选边框已不可用，请重新选择。</p>}
    <small>边框全程显示，覆盖画面边缘；视频不裁剪。上传 PNG 的中央半宽、半高区域须完全透明，最大 10 MB、宽高不超过 4096 像素。边框完整适配横屏或竖屏画布，选择不会随制作模式切换。</small>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
