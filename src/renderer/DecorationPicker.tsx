import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DecorationCatalog, DecorationOptions } from "../shared/decorations";
import { LIBRARY_STICKERS, type LibraryAsset } from "../shared/asset-library";
import { CURATED_STICKERS } from "../shared/curated-stickers";
import "./decorations.css";

const PAGE_SIZE = 24;
type PreviewState = "loading" | "error";
type PreviewRequest = { asset: LibraryAsset; epoch: number };

export function DecorationPicker({ value, onChange, disabled }: { value: DecorationOptions; onChange(value: DecorationOptions): void; disabled: boolean }) {
  const [catalog, setCatalog] = useState<DecorationCatalog>();
  const [catalogError, setCatalogError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [previewStates, setPreviewStates] = useState<Record<string, PreviewState>>({});
  const mounted = useRef(true);
  const previewUrlsRef = useRef<Record<string, string>>({});
  const previewPending = useRef(new Set<string>());
  const previewQueue = useRef<{ active: number; entries: PreviewRequest[] }>({ active: 0, entries: [] });
  const previewEpoch = useRef(0);
  const visibleStickers = useRef<LibraryAsset[]>([]);

  useEffect(() => {
    let active = true;
    void window.jianji.decorationCatalog().then((next) => { if (active) setCatalog(next); }).catch(() => { if (active) setCatalogError("贴纸加载失败，请重新打开此页面。"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      previewEpoch.current += 1;
      previewQueue.current.entries.forEach((request) => previewPending.current.delete(request.asset.id));
      previewQueue.current.entries = [];
    };
  }, []);

  const enqueuePreviews = useCallback((assets: LibraryAsset[], epoch: number) => {
    const queue = previewQueue.current;
    const next = assets.filter((asset) => !previewUrlsRef.current[asset.id] && !previewPending.current.has(asset.id));
    if (!next.length) return;
    next.forEach((asset) => previewPending.current.add(asset.id));
    setPreviewStates((states) => ({ ...states, ...Object.fromEntries(next.map((asset) => [asset.id, "loading" as const])) }));
    queue.entries.push(...next.map((asset) => ({ asset, epoch })));
    const pump = () => {
      while (queue.active < 4 && queue.entries.length) {
        const request = queue.entries.shift()!;
        queue.active += 1;
        void window.jianji.libraryAsset(request.asset.id).then(({ url }) => {
          if (!mounted.current || request.epoch !== previewEpoch.current) return;
          previewUrlsRef.current = { ...previewUrlsRef.current, [request.asset.id]: url };
          setPreviewUrls(previewUrlsRef.current);
          setPreviewStates((states) => { const { [request.asset.id]: _discard, ...rest } = states; return rest; });
        }).catch(() => {
          if (mounted.current && request.epoch === previewEpoch.current) setPreviewStates((states) => ({ ...states, [request.asset.id]: "error" }));
        }).finally(() => {
          queue.active -= 1;
          previewPending.current.delete(request.asset.id);
          if (mounted.current && request.epoch !== previewEpoch.current) enqueuePreviews(visibleStickers.current, previewEpoch.current);
          pump();
        });
      }
    };
    pump();
  }, []);

  const filteredStickers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? CURATED_STICKERS.filter((asset) => `${asset.label} ${asset.searchTerms}`.toLocaleLowerCase().includes(query)) : CURATED_STICKERS;
  }, [search]);
  const pageCount = Math.max(1, Math.ceil(filteredStickers.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStickers = useMemo(() => filteredStickers.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), [currentPage, filteredStickers]);
  useEffect(() => {
    previewEpoch.current += 1;
    const obsoleteEntries = previewQueue.current.entries;
    obsoleteEntries.forEach((request) => previewPending.current.delete(request.asset.id));
    previewQueue.current.entries = [];
    if (obsoleteEntries.length) setPreviewStates((states) => {
      const next = { ...states };
      obsoleteEntries.forEach((request) => { delete next[request.asset.id]; });
      return next;
    });
    visibleStickers.current = pageStickers;
    enqueuePreviews(pageStickers, previewEpoch.current);
  }, [enqueuePreviews, pageStickers]);

  const retryPreview = (asset: LibraryAsset) => {
    if (disabled) return;
    previewPending.current.delete(asset.id);
    setPreviewStates((states) => { const { [asset.id]: _discard, ...rest } = states; return rest; });
    enqueuePreviews([asset], previewEpoch.current);
  };

  const selectedStickerLabel = catalog?.stickers.find((asset) => asset.id === value.sticker)?.label
    ?? CURATED_STICKERS.find((asset) => asset.id === value.sticker)?.label
    ?? LIBRARY_STICKERS.find((asset) => asset.id === value.sticker)?.label;

  return <section className="decoration-picker card" aria-label="贴纸">
    <h2>选择贴纸</h2><p>选择后应用到本轮每条视频的对应内容。添加自己的图片，请使用左侧“上传贴纸”栏目。</p>
    {catalogError && <p role="alert">{catalogError}</p>}
    <fieldset disabled={disabled || !catalog}><legend>本地贴纸库</legend><div className="sticker-choices">
      {(["template", "none"] as const).map((id) => <button type="button" key={id} aria-pressed={value.sticker === id} onClick={() => onChange({ ...value, sticker: id })}>{id === "template" ? "跟随模板" : "不加贴纸"}</button>)}
      {catalog?.stickers.map((sticker) => <button type="button" key={sticker.id} aria-pressed={value.sticker === sticker.id} title={sticker.source === "downloaded" ? "本地下载素材，仅供个人练习" : undefined} onClick={() => onChange({ ...value, sticker: sticker.id })}><img src={sticker.url} alt="" /><span>{sticker.label}</span></button>)}
    </div></fieldset>
    <div className="library-heading"><div><strong>电商视频精选贴纸</strong><span>{CURATED_STICKERS.length} 款 · 促销、指引、强调、轻装饰</span></div><label htmlFor="sticker-search">搜索</label><input id="sticker-search" value={search} disabled={disabled} placeholder="如：促销、箭头、蝴蝶" onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></div>
    {selectedStickerLabel && <p className="library-selection">已选择：{selectedStickerLabel}</p>}
    <div className="library-sticker-grid" aria-live="polite">{pageStickers.map((asset) => {
      const previewUrl = previewUrls[asset.id]; const state = previewStates[asset.id];
      return <div className="library-sticker" key={asset.id}><button type="button" className="library-sticker-choice" aria-pressed={value.sticker === asset.id} disabled={disabled || !previewUrl} onClick={() => onChange({ ...value, sticker: asset.id as DecorationOptions["sticker"] })}>{previewUrl ? <img src={previewUrl} alt="" /> : <span className="sticker-placeholder">{state === "error" ? "预览失败" : "下载预览中…"}</span>}<span>{asset.label}</span></button>{state === "error" && <button type="button" className="asset-retry" disabled={disabled} onClick={() => retryPreview(asset)}>重试下载</button>}</div>;
    })}</div>
    {!pageStickers.length && <p className="library-empty">没有匹配的贴纸。</p>}
    <div className="library-pagination" aria-label="贴纸分页"><button type="button" disabled={disabled || currentPage === 0} onClick={() => setPage((current) => current - 1)}>上一页</button><span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={disabled || currentPage >= pageCount - 1} onClick={() => setPage((current) => current + 1)}>下一页</button></div>
    <p className="library-license">本地下载中文贴纸仅供个人练习，授权以原下载页和账户权益为准；在线贴纸来源：<a href="https://github.com/microsoft/fluentui-emoji" target="_blank" rel="noreferrer">Microsoft Fluent Emoji</a>（<a href="https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT License</a>）。</p>
  </section>;
}
