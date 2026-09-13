import { useEffect, useRef, useState } from "react";
import type { DecorationCatalog } from "../shared/decorations";
import { Heading, Icon } from "./ui";
import "./decorations.css";
import "./sticker-library.css";

export function StickerLibraryPanel({ disabled }: { disabled: boolean }) {
  const [stickers, setStickers] = useState<DecorationCatalog["stickers"]>();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  const catalogVersion = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const version = ++catalogVersion.current;
    void window.jianji.decorationCatalog().then((catalog) => {
      if (mounted.current && version === catalogVersion.current) setStickers(catalog.stickers.filter((sticker) => sticker.source === "uploaded"));
    }).catch(() => { if (mounted.current && version === catalogVersion.current) setError("贴纸加载失败，请重新打开此栏目。"); });
    return () => { mounted.current = false; };
  }, []);

  const importSticker = async () => {
    if (disabled || importing) return;
    setImporting(true); setError(""); setMessage("");
    try {
      const id = await window.jianji.importSticker();
      if (!id || !mounted.current) return;
      catalogVersion.current += 1;
      const catalog = await window.jianji.decorationCatalog();
      if (!mounted.current) return;
      setStickers(catalog.stickers.filter((sticker) => sticker.source === "uploaded"));
      setMessage("贴纸已加入素材库，Agent 可以看图选用；也可到规则模板中手动选择。");
    } catch {
      if (mounted.current) setError("上传失败，请选择有效的 PNG/JPG 图片（10 MB 以内、宽高不超过 4096 像素），并检查磁盘空间后重试。");
    } finally { if (mounted.current) setImporting(false); }
  };

  return <>
    <Heading eyebrow="STICKER LIBRARY" title="上传贴纸">把自己的贴纸放进素材库，供 Agent 看图搭配，也可以手动选用。</Heading>
    <section className="card sticker-upload-panel" aria-label="上传贴纸图片">
      <button type="button" className="button primary" disabled={disabled || importing} onClick={() => void importSticker()}><Icon name="upload" size={18} />{importing ? "正在上传…" : "选择图片上传"}</button>
      <p>PNG · JPG / JPEG · 最大 10 MB · 宽高不超过 4096 像素</p>
      <small>贴纸保存在本机，重启后仍可使用。制作和生成提示词时，自动模式会发送上传库中的图片，手动模式只发送所选上传贴纸。上传图案与自带文字由你负责。</small>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
    <section className="card sticker-upload-panel" aria-label="我的上传贴纸">
      <div className="card-header"><h2>我的贴纸 <span>{stickers?.length ?? 0}</span></h2></div>
      {!stickers ? <p>{error ? "暂时无法显示贴纸。" : "正在读取贴纸…"}</p> : stickers.length === 0 ? <p>还没有上传贴纸，点击上方“选择图片上传”开始添加。</p> : <div className="uploaded-sticker-grid">{stickers.map((sticker) => <div className="library-sticker-choice" key={sticker.id}><img src={sticker.url} alt={sticker.label} /><span>{sticker.label}</span></div>)}</div>}
    </section>
  </>;
}
