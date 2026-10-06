import { useEffect, useRef, useState } from "react";
import type { DecorationOptions } from "../shared/decorations";
import { frameSettings, type FrameSettings, type FrameCatalogEntry } from "../shared/frames";
import { MediaSelector } from "./MediaSelector";
import { Icon } from "./ui";
import "./decoration-frames.css";

export function FrameDecorationPicker({ value, onChange, disabled, mutationDisabled = disabled, media = [], onSave }: {
  value: DecorationOptions; onChange(value: DecorationOptions): void; disabled: boolean; mutationDisabled?: boolean;
  media?: readonly { id: string; displayName: string }[]; onSave?(): void;
}) {
  const [frames, setFrames] = useState<FrameCatalogEntry[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [selectedId, setSelectedId] = useState("");
  const mediaId = media.some(item => item.id === selectedId) ? selectedId : "";
  const settings = frameSettings(value, mediaId);
  const mounted = useRef(true);
  const valueRef = useRef(value); valueRef.current = value;
  const choose = (frame: FrameSettings) => {
    const current = valueRef.current;
    onChange({ ...current, frameId: undefined, frame: mediaId ? frameSettings(current) : frame,
      framesByMedia: mediaId ? { ...current.framesByMedia, [mediaId]: frame } : current.framesByMedia });
  };
  const inherit = () => {
    const framesByMedia = { ...valueRef.current.framesByMedia }; delete framesByMedia[mediaId];
    onChange({ ...valueRef.current, framesByMedia });
  };
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
      setMessage("边框已加入随机池，也可点击图片手动指定给整批或某条素材。");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "边框上传失败，请检查图片后重试。");
    } finally { if (mounted.current) setBusy(false); }
  };
  const removeFrame = async (id: string) => {
    if (mutationDisabled || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await window.jianji.removeFrame(id);
      const current = valueRef.current, frame = frameSettings(current);
      onChange({ ...current, frameId: undefined, frame: frame.mode === "manual" && frame.frameId === id ? { mode: "none" } : frame,
        framesByMedia: Object.fromEntries(Object.entries(current.framesByMedia ?? {}).map(([mediaId, setting]) => [mediaId, setting.mode === "manual" && setting.frameId === id ? { mode: "none" as const } : setting])) });
      if (!mounted.current) return;
      setFrames(current => current?.filter(frame => frame.id !== id));
      setConfirmDelete(undefined);
      setMessage("边框已删除；历史任务保留原文件，仍可按冻结方案重试。");
    } catch { if (mounted.current) setError("边框删除失败，请等待当前制作结束后重试。"); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section className="card frame-decoration-picker" aria-label="整圈边框设置">
    <div className="frame-decoration-heading"><div><h2>整圈边框</h2><p>默认自动安排是否加边框；指定必须使用后，每条都加，款式仍随机。四角贴纸可叠在边框上。</p></div>
      <button type="button" className="button secondary" disabled={mutationDisabled || busy} onClick={() => void importFrame()}><Icon name="upload" size={17} />{busy ? "正在更新…" : "上传透明边框 PNG"}</button>
    </div>
    <label htmlFor="frame-media">对应素材</label>
    <MediaSelector id="frame-media" label="边框素材" media={[{ id: "", displayName: "整批设置（默认）" }, ...media]} value={mediaId} disabled={disabled || busy} onChange={setSelectedId} />
    {mediaId && <><p>{value.framesByMedia?.[mediaId] ? "此素材使用独立边框设置。" : "此素材沿用整批边框设置。"}</p><button type="button" className="button secondary compact" disabled={disabled || busy || !value.framesByMedia?.[mediaId]} onClick={inherit}>此素材沿用整批设置</button></>}
    <button type="button" className="button secondary compact" disabled={disabled || busy || !onSave} onClick={onSave}>保存边框设置到当前项目</button>
    <div className="frame-decoration-grid" role="group" aria-label="选择整圈边框">
      <button type="button" className="frame-decoration-choice" aria-pressed={settings.mode === "auto"} disabled={disabled || busy} onClick={() => choose({ mode: "auto" })}><span className="frame-decoration-none">自动</span><span>自动安排（默认）</span></button>
      <button type="button" className="frame-decoration-choice" aria-pressed={settings.mode === "random"} disabled={disabled || busy} onClick={() => choose({ mode: "random" })}><span className="frame-decoration-none">↻</span><span>必须使用（随机款式）</span></button>
      <button type="button" className="frame-decoration-choice" aria-pressed={settings.mode === "none"} disabled={disabled || busy} onClick={() => choose({ mode: "none" })}><span className="frame-decoration-none">无</span><span>不加边框</span></button>
      {frames?.map(frame => <div key={frame.id}><button type="button" className="frame-decoration-choice" aria-pressed={settings.mode === "manual" && settings.frameId === frame.id} disabled={disabled || busy} onClick={() => choose({ mode: "manual", frameId: frame.id })}><img src={frame.url} alt="" /><span>{frame.label}</span></button>
        {frame.source === "uploaded" && <div className="frame-decoration-delete">{confirmDelete === frame.id ? <><button type="button" disabled={mutationDisabled || busy} onClick={() => void removeFrame(frame.id)}>确认删除</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(undefined)}>取消</button></> : <button type="button" disabled={mutationDisabled || busy} aria-label={`删除 ${frame.label}`} onClick={() => setConfirmDelete(frame.id)}>删除</button>}</div>}
      </div>)}
    </div>
    {!frames && !error && <p role="status">正在读取边框…</p>}
    {settings.mode === "manual" && frames && !frames.some(frame => frame.id === settings.frameId) && <p role="alert">所选边框已不可用，请重新选择。</p>}
    <small>自动安排可使用边框或不加边框；必须使用时，每个新版本都从内置及上传边框中随机选款。可按素材独立设置，也可点击图片固定款式。自动及随机预览仅为示意，重试保持已冻结的决定和款式。边框全程显示并覆盖画面边缘，视频不裁剪。上传 PNG 中央半宽、半高须完全透明，最大 10 MB、宽高不超过 4096 像素。</small>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
