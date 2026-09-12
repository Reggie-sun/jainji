import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DecorationCatalog, DecorationOptions } from "../shared/decorations";
import { FONT_CHOICES, FONT_LABELS } from "../shared/decorations";
import { LIBRARY_FONTS, LIBRARY_STICKERS, type LibraryAsset } from "../shared/asset-library";
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
  const [fontLoading, setFontLoading] = useState("");
  const [fontError, setFontError] = useState("");
  const [failedFont, setFailedFont] = useState<LibraryAsset>();
  const mounted = useRef(true);
  const disabledRef = useRef(disabled);
  const valueRef = useRef(value);
  const previewUrlsRef = useRef<Record<string, string>>({});
  const previewPending = useRef(new Set<string>());
  const previewQueue = useRef<{ active: number; entries: PreviewRequest[] }>({ active: 0, entries: [] });
  const previewEpoch = useRef(0);
  const visibleStickers = useRef<LibraryAsset[]>([]);
  const fontRequest = useRef(0);
  const loadedFonts = useRef(new Set<string>());
  disabledRef.current = disabled;
  valueRef.current = value;
  const remoteFonts = useMemo(() => LIBRARY_FONTS.map((asset) => ({ asset, family: asset.family ?? asset.label })), []);
  const remoteFontByFamily = useMemo(() => new Map(remoteFonts.map(({ asset, family }) => [family, asset])), [remoteFonts]);

  useEffect(() => {
    let active = true;
    void window.jianji.decorationCatalog().then((next) => { if (active) setCatalog(next); }).catch(() => { if (active) setCatalogError("贴纸与字体加载失败，请重新打开此页面。"); });
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

  useEffect(() => {
    const asset = remoteFontByFamily.get(value.fontFamily);
    if (!asset || loadedFonts.current.has(asset.id)) return;
    const family = asset.family ?? asset.label;
    if ([...document.fonts].some((face) => face.family.replaceAll('"', "") === family && face.status === "loaded")) {
      loadedFonts.current.add(asset.id);
      return;
    }
    let active = true;
    void window.jianji.libraryAsset(asset.id).then(async ({ url }) => {
      if (!active) return;
      const face = new FontFace(family, `url("${url}")`);
      await face.load();
      if (!active) return;
      document.fonts.add(face);
      loadedFonts.current.add(asset.id);
    }).catch(() => {
      if (active) { setFontError(`“${asset.label}”预览字体加载失败。`); setFailedFont(asset); }
    });
    return () => { active = false; };
  }, [remoteFontByFamily, value.fontFamily]);

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

  const loadFont = (asset: LibraryAsset) => {
    if (disabled) return;
    const request = ++fontRequest.current;
    const family = asset.family ?? asset.label;
    setFontLoading(asset.id); setFontError(""); setFailedFont(undefined);
    void (async () => {
      try {
        if (!loadedFonts.current.has(asset.id)) {
          const { url } = await window.jianji.libraryAsset(asset.id);
          const face = new FontFace(family, `url("${url}")`);
          await face.load(); document.fonts.add(face); loadedFonts.current.add(asset.id);
        }
        if (mounted.current && request === fontRequest.current && !disabledRef.current) onChange({ ...valueRef.current, fontFamily: family as DecorationOptions["fontFamily"] });
      } catch {
        if (mounted.current && request === fontRequest.current) { setFontError(`“${asset.label}”下载或加载失败，当前字体未改变。`); setFailedFont(asset); }
      } finally {
        if (mounted.current && request === fontRequest.current) setFontLoading("");
      }
    })();
  };
  const selectFont = (family: string) => {
    const asset = remoteFontByFamily.get(family);
    if (asset) { loadFont(asset); return; }
    fontRequest.current += 1;
    setFontLoading(""); setFontError(""); setFailedFont(undefined);
    onChange({ ...value, fontFamily: family as DecorationOptions["fontFamily"] });
  };
  const selectedStickerLabel = catalog?.stickers.find((asset) => asset.id === value.sticker)?.label
    ?? CURATED_STICKERS.find((asset) => asset.id === value.sticker)?.label
    ?? LIBRARY_STICKERS.find((asset) => asset.id === value.sticker)?.label;

  return <section className="decoration-picker card" aria-label="贴纸与字体">
    <h2>贴纸与字体</h2><p>选择后应用到本轮每条视频；贴纸自动避开文字，保持在角落。</p>
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
    <label htmlFor="caption-font">文字字体（含 {LIBRARY_FONTS.length} 款中文在线字体）</label><select id="caption-font" value={value.fontFamily} disabled={disabled || !catalog || Boolean(fontLoading)} onChange={(event) => selectFont(event.target.value)}>
      {!catalog?.fonts.includes(value.fontFamily) && !remoteFontByFamily.has(value.fontFamily) && <option value={value.fontFamily} disabled>{value.fontFamily}（未就绪）</option>}
      {catalog?.fonts.map((font) => <option key={font} value={font}>{FONT_LABELS[font as typeof FONT_CHOICES[number]] ?? font}</option>)}
      {remoteFonts.map(({ asset, family }) => <option key={asset.id} value={family}>{asset.label}（在线字体）</option>)}
    </select>
    {fontLoading && <p className="font-status" role="status">正在下载并加载字体…</p>}
    {fontError && <p className="font-status" role="alert">{fontError} {failedFont && <button type="button" disabled={disabled} onClick={() => loadFont(failedFont)}>重试</button>}</p>}
    <div className="font-example" style={{ fontFamily: `"${value.fontFamily}", "Microsoft YaHei", sans-serif` }}>今日好物推荐 · 19.9元</div>
    <small>本机字体直接可用；在线字体需先下载，示例展示实际加载后的字形，成片字号与颜色随模板调整。</small>
    <p className="library-license">本地下载中文贴纸仅供个人练习，授权以原下载页和账户权益为准；在线贴纸来源：<a href="https://github.com/microsoft/fluentui-emoji" target="_blank" rel="noreferrer">Microsoft Fluent Emoji</a>（<a href="https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT License</a>）；字体来源：<a href="https://fonts.google.com/" target="_blank" rel="noreferrer">Google Fonts</a>（<a href="https://openfontlicense.org/" target="_blank" rel="noreferrer">SIL Open Font License 1.1</a>）。</p>
  </section>;
}
