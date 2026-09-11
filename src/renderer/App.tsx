import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from "react";
import type { AppState } from "../main/application";
import { recoveryAdvice } from "../main/errors";
import type { Color, EditTemplate, ExportPreset, Layer } from "../main/domain";
import type { MediaView } from "../main/media";
import { DEFAULT_TEXT_FONT_FAMILY } from "../shared/defaults";

type PublicState = AppState & { capabilities: CapabilityStatus };
type CapabilityStatus = {
  ready: boolean; ffmpeg: boolean; ffprobe: boolean; drawtext: boolean; overlay: boolean;
  h264Encoder: boolean; aacEncoder: boolean; fonts: boolean; appDataWritable: boolean;
  ffmpegVersion?: string; message?: string;
};
type Step = "import" | "template" | "export";

const preset: ExportPreset = {
  container: "mp4", videoCodec: "h264", audioCodec: "aac", resolutionMode: "source", frameRateMode: "source", quality: "balanced",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "等待中", validating: "校验中", running: "导出中", verifying: "验证中", cancelling: "取消中",
  completed: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断",
};

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1_000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const candidate of units) { value /= 1024; unit = candidate; if (value < 1024) break; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

function formatTaskElapsed(task: { startedAt?: string; finishedAt?: string }): string {
  if (!task.startedAt) return "—";
  const end = task.finishedAt ? Date.parse(task.finishedAt) : Date.now();
  const start = Date.parse(task.startedAt);
  return Number.isFinite(start) && Number.isFinite(end) ? formatDuration(Math.max(0, end - start)) : "—";
}

function clamp(value: number, min = 0, max = 1): number { return Math.min(max, Math.max(min, value)); }

function previewFilter(filter: EditTemplate["filter"]): string {
  const intensity = filter.intensity;
  switch (filter.presetId) {
    case "warm": return `sepia(${(intensity * 0.28).toFixed(2)}) saturate(${(1 + intensity * 0.18).toFixed(2)})`;
    case "cool": return `hue-rotate(${(-intensity * 18).toFixed(1)}deg) saturate(${(1 + intensity * 0.08).toFixed(2)})`;
    case "mono": return `grayscale(${intensity.toFixed(2)})`;
    case "vivid": return `saturate(${(1 + intensity * 0.38).toFixed(2)}) contrast(${(1 + intensity * 0.1).toFixed(2)})`;
    default: return "none";
  }
}

function cloneTemplate(template: EditTemplate): EditTemplate { return structuredClone(template); }

function colorToHex(color: Color): string { return `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`; }

function localFileUrl(filePath: string): string {
  return `file://${filePath.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function hexToColor(value: string, alpha: number): Color {
  const hex = value.replace("#", "").padEnd(6, "0").slice(0, 6);
  return { r: Number.parseInt(hex.slice(0, 2), 16) || 0, g: Number.parseInt(hex.slice(2, 4), 16) || 0, b: Number.parseInt(hex.slice(4, 6), 16) || 0, a: clamp(alpha) };
}

export default function App() {
  const [state, setState] = useState<PublicState>();
  const [step, setStep] = useState<Step>("import");
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [previewMediaId, setPreviewMediaId] = useState<string>();
  const [selectedLayerId, setSelectedLayerId] = useState<string>();
  const [outputDirectory, setOutputDirectory] = useState("");
  const [notice, setNotice] = useState<{ tone: "info" | "error" | "success"; text: string }>();
  const [busy, setBusy] = useState(false);

  const applyState = useCallback((next: PublicState) => {
    setState(next);
    setPreviewMediaId((current) => current && next.project.mediaItems.some((item) => item.id === current) ? current : next.project.mediaItems[0]?.id);
    setSelectedMediaIds((current) => current.length > 0 ? current.filter((id) => next.project.mediaItems.some((item) => item.id === id)) : next.project.mediaItems.filter((item) => item.probeStatus === "ready").map((item) => item.id));
  }, []);

  useEffect(() => {
    let active = true;
    void window.jianji.getState().then((next) => { if (active) applyState(next); }).catch((error) => setNotice({ tone: "error", text: error instanceof Error ? error.message : "应用初始化失败" }));
    const unsubscribe = window.jianji.onExportSnapshot((next) => { if (active) applyState(next); });
    return () => { active = false; unsubscribe(); };
  }, [applyState]);

  const updateTemplate = useCallback(async (next: EditTemplate) => {
    if (!state) return;
    const optimistic: PublicState = { ...state, project: { ...state.project, template: next } };
    setState(optimistic);
    try { applyState(await window.jianji.updateTemplate(next)); }
    catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "模板参数无效" }); }
  }, [applyState, state]);

  const importPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    setBusy(true);
    try {
      applyState(await window.jianji.addAndProbe(paths));
      setStep("template");
      setNotice({ tone: "success", text: `已加入 ${paths.length} 条素材，正在逐项检查。` });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "素材导入失败" }); }
    finally { setBusy(false); }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const paths = [...event.dataTransfer.files].map((file) => window.jianji.getPathForFile(file)).filter(Boolean);
    void importPaths(paths);
  };

  const addText = () => {
    if (!state) return;
    const next = cloneTemplate(state.project.template);
    const layer: Layer = { id: crypto.randomUUID(), type: "text", content: "新文字", fontFamily: DEFAULT_TEXT_FONT_FAMILY, fontSizeRatio: 0.08, color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidthRatio: 0.006, x: 0.08, y: 0.08, width: 0.8, opacity: 1, zIndex: next.layers.length, visible: true };
    next.layers.push(layer); setSelectedLayerId(layer.id); void updateTemplate(next);
  };

  const addSticker = async () => {
    if (!state) return;
    const asset = await window.jianji.selectStickerAsset();
    if (!asset) return;
    const next = cloneTemplate(state.project.template);
    const layer: Layer = { id: crypto.randomUUID(), type: "sticker", ...asset, x: 0.08, y: 0.08, width: 0.25, rotationDeg: 0, opacity: 1, zIndex: next.layers.length, visible: true };
    next.layers.push(layer); setSelectedLayerId(layer.id); void updateTemplate(next);
  };

  const patchLayer = (layerId: string, patch: Partial<Layer>) => {
    if (!state) return;
    const next = cloneTemplate(state.project.template);
    const index = next.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) return;
    next.layers[index] = { ...next.layers[index], ...patch } as Layer;
    void updateTemplate(next);
  };

  const removeLayer = (layerId: string) => {
    if (!state) return;
    const next = cloneTemplate(state.project.template); next.layers = next.layers.filter((layer) => layer.id !== layerId); void updateTemplate(next);
    if (selectedLayerId === layerId) setSelectedLayerId(undefined);
  };

  const moveLayer = (layerId: string, direction: -1 | 1) => {
    if (!state) return;
    const next = cloneTemplate(state.project.template);
    const layers = [...next.layers].sort((a, b) => a.zIndex - b.zIndex);
    const index = layers.findIndex((layer) => layer.id === layerId); const other = index + direction;
    if (index < 0 || other < 0 || other >= layers.length) return;
    [layers[index], layers[other]] = [layers[other], layers[index]];
    layers.forEach((layer, zIndex) => { layer.zIndex = zIndex; }); next.layers = layers; void updateTemplate(next);
  };

  if (!state) return <div className="loading-screen"><div className="brand-mark">简</div><p>正在准备本地编辑环境…</p></div>;
  const readyMedia = state.project.mediaItems.filter((item) => item.probeStatus === "ready");
  const selectedMedia = state.project.mediaItems.filter((item) => selectedMediaIds.includes(item.id));
  const activeMedia = state.project.mediaItems.find((item) => item.id === previewMediaId) ?? readyMedia[0];
  const tasks = state.queue.batches.flatMap((batch) => batch.batch.tasks.map((task) => ({ task, batch })));
  const allDone = tasks.length > 0 && tasks.every(({ task }) => ["completed", "failed", "cancelled", "interrupted"].includes(task.status));
  const selectedLayer = state.project.template.layers.find((layer) => layer.id === selectedLayerId);

  const chooseOutput = async () => { const directory = await window.jianji.selectOutputDirectory(); if (directory) setOutputDirectory(directory); };
  const createExport = async () => {
    if (!outputDirectory || selectedMediaIds.length === 0) { setNotice({ tone: "error", text: "请先选择有效素材和输出目录。" }); return; }
    setBusy(true);
    try {
      await window.jianji.createExport({ mediaIds: selectedMediaIds, outputDirectory, preset });
      setStep("export"); setNotice({ tone: "success", text: "导出批次已创建，正在串行处理。" });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "无法创建导出批次" }); }
    finally { setBusy(false); }
  };
  const renderProof = async () => {
    if (!activeMedia) return;
    setBusy(true);
    try { await window.jianji.renderProof(activeMedia.id); setStep("export"); setNotice({ tone: "info", text: "验证样片已加入队列；只有通过 ffprobe 校验才会显示为完成。" }); }
    catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "验证样片创建失败" }); }
    finally { setBusy(false); }
  };
  const saveProject = async () => { try { const next = await window.jianji.saveProject(); if (next) applyState(next); setNotice({ tone: "success", text: "项目已安全保存。" }); } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "项目保存失败" }); } };
  const loadProject = async () => { try { const next = await window.jianji.loadProject(); if (next) { applyState(next); setNotice({ tone: "success", text: "项目已打开，外部素材正在重新验证。" }); } } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "项目打开失败" }); } };
  const newProject = async () => { try { applyState(await window.jianji.newProject()); setStep("import"); setSelectedLayerId(undefined); setNotice({ tone: "success", text: "已新建项目。" }); } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "新建项目失败" }); } };
  const saveTemplate = async () => { try { const next = await window.jianji.saveTemplate(); if (next) { applyState(await window.jianji.getState()); setNotice({ tone: "success", text: `模板已保存为 v${next.version}。` }); } } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "模板保存失败" }); } };
  const loadTemplate = async () => { try { const next = await window.jianji.loadTemplate(); if (next) applyState(next); } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "模板加载失败" }); } };
  const selectMedia = async () => { try { applyState(await window.jianji.selectAndProbe()); setStep("template"); } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "素材导入失败" }); } };
  const copyPath = async (path: string) => { try { await navigator.clipboard.writeText(path); setNotice({ tone: "success", text: "输出路径已复制。" }); } catch { setNotice({ tone: "error", text: "无法访问系统剪贴板，请使用定位按钮打开输出目录。" }); } };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">简</div><div><strong>简辑</strong><span>批量视频编辑器</span></div></div>
      <div className="topbar-actions"><button className="ghost-button" onClick={() => void newProject()}>新建项目</button><button className="ghost-button" onClick={() => void loadProject()}>打开项目</button><button className="ghost-button" onClick={() => void saveProject()}>保存项目</button><span className={`capability-pill ${state.capabilities.ready ? "ready" : "blocked"}`}><i />{state.capabilities.ready ? "本地引擎就绪" : "需要检查 FFmpeg"}</span></div>
    </header>
    <main className="workspace">
      <aside className="sidebar">
        <div className="project-summary"><span className="eyebrow">PROJECT</span><h1>{state.project.name}</h1><p>{state.project.mediaItems.length} 条原始素材 · 模板 v{state.project.template.version}</p></div>
        <nav className="step-nav" aria-label="工作流程">
          <StepButton number="01" label="导入素材" detail={`${readyMedia.length}/${state.project.mediaItems.length} 就绪`} active={step === "import"} onClick={() => setStep("import")} />
          <StepButton number="02" label="编辑模板" detail={`${state.project.template.layers.length} 个图层`} active={step === "template"} onClick={() => setStep("template")} />
          <StepButton number="03" label="导出结果" detail={tasks.length ? `${tasks.filter(({ task }) => task.status === "completed").length}/${tasks.length} 完成` : "等待启动"} active={step === "export"} onClick={() => setStep("export")} />
        </nav>
        <div className="sidebar-footer"><span className="offline-dot" />离线运行 · 媒体不上传</div>
      </aside>
      <section className="content">
        {notice && <div className={`notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}><span>{notice.tone === "error" ? "!" : "✓"}</span>{notice.text}<button aria-label="关闭提示" onClick={() => setNotice(undefined)}>×</button></div>}
        {!state.capabilities.ready && <CapabilityBanner status={state.capabilities} />}
        {step === "import" && <ImportStep state={state} busy={busy} selectedIds={selectedMediaIds} onToggle={(id) => setSelectedMediaIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onDrop={onDrop} onSelect={() => void selectMedia()} onRemove={(id) => void window.jianji.removeMedia(id).then(applyState)} onContinue={() => setStep("template")} />}
        {step === "template" && <TemplateStep state={state} activeMedia={activeMedia} selectedLayer={selectedLayer} previewMediaId={previewMediaId} selectedLayerId={selectedLayerId} onPreviewMedia={setPreviewMediaId} onSelectLayer={setSelectedLayerId} onPatchLayer={patchLayer} onAddText={addText} onAddSticker={() => void addSticker()} onRemoveLayer={removeLayer} onMoveLayer={moveLayer} onUpdateFilter={(filter) => void updateTemplate({ ...cloneTemplate(state.project.template), filter })} onProof={() => void renderProof()} onSave={saveTemplate} onLoad={loadTemplate} onNext={() => setStep("export")} />}
        {step === "export" && <ExportStep state={state} tasks={tasks} selectedMedia={selectedMedia} outputDirectory={outputDirectory} busy={busy} allDone={allDone} onOutputDirectory={chooseOutput} onCreate={createExport} onCancel={(id) => void window.jianji.cancelExport(id)} onRetry={() => void window.jianji.retryExport()} onOpen={(id) => void window.jianji.openArtifact(id).catch((error) => setNotice({ tone: "error", text: error instanceof Error ? error.message : "无法播放成片" }))} onReveal={(id) => void window.jianji.revealArtifact(id).catch((error) => setNotice({ tone: "error", text: error instanceof Error ? error.message : "无法打开输出目录" }))} onCopy={copyPath} />}
      </section>
    </main>
  </div>;
}

function StepButton({ number, label, detail, active, onClick }: { number: string; label: string; detail: string; active: boolean; onClick: () => void }) {
  return <button className={`step-button ${active ? "active" : ""}`} onClick={onClick}><span className="step-number">{number}</span><span><strong>{label}</strong><small>{detail}</small></span>{active && <span className="step-arrow">→</span>}</button>;
}

function CapabilityBanner({ status }: { status: CapabilityStatus }) {
  const checks = [[status.ffmpeg, "ffmpeg"], [status.ffprobe, "ffprobe"], [status.h264Encoder, "H.264"], [status.aacEncoder, "AAC"], [status.fonts, "系统字体"]];
  return <div className="capability-banner"><div className="banner-icon">!</div><div><strong>导出能力未完全就绪</strong><p>{status.message ?? "请安装可用的 system FFmpeg 后重新启动。"}</p><div className="capability-checks">{checks.map(([ok, label]) => <span key={label as string} className={ok ? "ok" : "bad"}>{ok ? "✓" : "×"} {label}</span>)}</div></div></div>;
}

function ImportStep({ state, busy, selectedIds, onToggle, onDrop, onSelect, onRemove, onContinue }: { state: PublicState; busy: boolean; selectedIds: string[]; onToggle: (id: string) => void; onDrop: (event: DragEvent<HTMLDivElement>) => void; onSelect: () => void; onRemove: (id: string) => void; onContinue: () => void }) {
  return <div className="step-panel"><SectionHeading kicker="01 / SOURCE MATERIALS" title="导入一批原始素材" subtitle="一次选择或拖入多个视频。简辑只读取元数据，绝不修改原始文件。" />
    <div className="import-grid"><div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}><div className="drop-icon">↓</div><h2>拖入视频文件</h2><p>支持 MP4 · MOV · MKV · WebM</p><button className="primary-button" disabled={busy} onClick={onSelect}>{busy ? "正在检查…" : "选择本地素材"}<span>⌘</span></button><small>可一次选择多个文件，逐项检查不会互相阻塞</small></div>
      <div className="media-list-card"><div className="card-heading"><div><span className="eyebrow">MEDIA BATCH</span><h3>素材批次 <em>{selectedIds.length}/{state.project.mediaItems.length}</em></h3></div><span className="ready-count">{state.project.mediaItems.filter((item) => item.probeStatus === "ready").length} READY</span></div>{state.project.mediaItems.length === 0 ? <div className="empty-list">导入后，素材会在这里逐项显示探测结果。</div> : <div className="media-list">{state.project.mediaItems.map((item) => <MediaRow key={item.id} item={item} selected={selectedIds.includes(item.id)} onToggle={onToggle} onRemove={onRemove} />)}</div>}</div></div>
    <div className="step-footer"><div className="safety-note"><span>◉</span><span><strong>原始素材安全边界</strong><small>原文件只读 · 不复制 · 不覆盖</small></span></div><button className="primary-button" disabled={state.project.mediaItems.filter((item) => item.probeStatus === "ready").length === 0} onClick={onContinue}>继续编辑模板 <span>→</span></button></div>
  </div>;
}

function MediaRow({ item, selected, onToggle, onRemove }: { item: MediaView; selected: boolean; onToggle: (id: string) => void; onRemove: (id: string) => void }) {
  const ready = item.probeStatus === "ready";
  return <div className="media-row"><input className="media-check" type="checkbox" checked={selected} disabled={!ready} aria-label={`选择 ${item.displayName}`} onChange={() => onToggle(item.id)} /><div className={`media-status ${ready ? "success" : "failure"}`}>{ready ? "✓" : "!"}</div><div className="media-meta"><strong title={item.displayName}>{item.displayName}</strong><span>{ready ? `${item.width} × ${item.height} · ${formatDuration(item.durationMs)} · ${formatBytes(item.sizeBytes)}` : item.errorMessage ?? "无法读取该文件"}</span></div><span className={`status-label ${ready ? "success-text" : "failure-text"}`}>{ready ? "就绪" : "需处理"}</span><button className="icon-button" aria-label={`移除 ${item.displayName}`} onClick={() => onRemove(item.id)}>×</button></div>;
}

function TemplateStep({ state, activeMedia, selectedLayer, previewMediaId, selectedLayerId, onPreviewMedia, onSelectLayer, onPatchLayer, onAddText, onAddSticker, onRemoveLayer, onMoveLayer, onUpdateFilter, onProof, onSave, onLoad, onNext }: { state: PublicState; activeMedia?: MediaView; selectedLayer?: Layer; previewMediaId?: string; selectedLayerId?: string; onPreviewMedia: (id: string) => void; onSelectLayer: (id: string) => void; onPatchLayer: (id: string, patch: Partial<Layer>) => void; onAddText: () => void; onAddSticker: () => void; onRemoveLayer: (id: string) => void; onMoveLayer: (id: string, direction: -1 | 1) => void; onUpdateFilter: (filter: EditTemplate["filter"]) => void; onProof: () => void; onSave: () => void; onLoad: () => void; onNext: () => void }) {
  return <div className="step-panel"><SectionHeading kicker="02 / EDIT TEMPLATE" title="一次编辑，整批复用" subtitle="拖动预览中的图层，或用右侧数值精确调整。坐标始终基于自动旋转后的画面。" />
    <div className="editor-layout"><div className="editor-main"><div className="preview-toolbar"><label>代表性素材<select value={previewMediaId ?? ""} onChange={(event) => onPreviewMedia(event.target.value)}>{state.project.mediaItems.filter((item) => item.probeStatus === "ready").map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label><div className="toolbar-actions"><button className="ghost-button" onClick={onLoad}>加载模板</button><button className="ghost-button" onClick={onSave}>保存模板</button><span className="approx-badge">◌ 近似预览</span></div></div><Preview activeMedia={activeMedia} template={state.project.template} selectedLayerId={selectedLayerId} onSelectLayer={onSelectLayer} onMoveLayer={(id, patch) => onPatchLayer(id, patch)} /></div>
      <aside className="inspector"><div className="inspector-section"><div className="inspector-title"><span>图层</span><span className="layer-count">{state.project.template.layers.length}/100</span></div><div className="layer-actions"><button onClick={onAddText}>＋文字</button><button onClick={onAddSticker}>＋贴纸</button></div><div className="layer-list">{[...state.project.template.layers].sort((a, b) => b.zIndex - a.zIndex).map((layer) => <LayerRow key={layer.id} layer={layer} selected={layer.id === selectedLayerId} onSelect={() => onSelectLayer(layer.id)} onToggle={() => onPatchLayer(layer.id, { visible: !layer.visible })} onDelete={() => onRemoveLayer(layer.id)} />)}</div>{state.project.template.layers.length === 0 && <div className="empty-inspector">添加文字或贴纸开始编辑。</div>}</div>{selectedLayer && <LayerInspector layer={selectedLayer} onPatch={(patch) => onPatchLayer(selectedLayer.id, patch)} onMove={(direction) => onMoveLayer(selectedLayer.id, direction)} onDelete={() => onRemoveLayer(selectedLayer.id)} />}
        <div className="inspector-section filter-section"><div className="inspector-title"><span>全局滤镜</span><span className="filter-tag">FULL FRAME</span></div><label className="field-label">预设<select value={state.project.template.filter.presetId} onChange={(event) => onUpdateFilter({ ...state.project.template.filter, presetId: event.target.value as EditTemplate["filter"]["presetId"] })}><option value="none">无滤镜</option><option value="warm">暖色</option><option value="cool">冷色</option><option value="mono">黑白</option><option value="vivid">鲜艳</option></select></label><label className="field-label">强度 <output>{Math.round(state.project.template.filter.intensity * 100)}%</output><input type="range" min="0" max="1" step="0.01" value={state.project.template.filter.intensity} onChange={(event) => onUpdateFilter({ ...state.project.template.filter, intensity: Number(event.target.value) })} /></label></div></aside></div>
    {!state.templateReadiness.ready && <div className="template-warning" role="alert">模板暂不可导出：{state.templateReadiness.missing.join("、")}。请恢复资源或移除对应图层。</div>}<div className="step-footer template-footer"><div className="safety-note"><span className="preview-symbol">◌</span><span><strong>预览是近似结果</strong><small>导出前生成验证样片，确认最终 FFmpeg 渲染</small></span></div><div className="footer-actions"><button className="secondary-button" disabled={!activeMedia} onClick={onProof}>生成验证样片</button><button className="primary-button" disabled={!state.templateReadiness.ready || state.project.mediaItems.filter((item) => item.probeStatus === "ready").length === 0} onClick={onNext}>去导出 <span>→</span></button></div></div>
  </div>;
}

function Preview({ activeMedia, template, selectedLayerId, onSelectLayer, onMoveLayer }: { activeMedia?: MediaView; template: EditTemplate; selectedLayerId?: string; onSelectLayer: (id: string) => void; onMoveLayer: (id: string, patch: Partial<Layer>) => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; x: number; y: number }>();
  const onPointerDown = (event: PointerEvent<HTMLDivElement>, layer: Layer) => {
    event.stopPropagation(); onSelectLayer(layer.id); stageRef.current?.setPointerCapture(event.pointerId); dragRef.current = { id: layer.id, x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; const rect = stageRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    const layer = template.layers.find((item) => item.id === drag.id); if (!layer) return;
    onMoveLayer(layer.id, { x: clamp(layer.x + (event.clientX - drag.x) / rect.width, 0, 1 - layer.width), y: clamp(layer.y + (event.clientY - drag.y) / rect.height, 0, 1) });
    dragRef.current = { id: drag.id, x: event.clientX, y: event.clientY };
  };
  const mediaStyle: CSSProperties = { aspectRatio: activeMedia ? `${activeMedia.width} / ${activeMedia.height}` : "16 / 9" };
  return <div ref={stageRef} className="preview-stage" style={mediaStyle} onPointerMove={onPointerMove} onPointerUp={() => { dragRef.current = undefined; }} onPointerCancel={() => { dragRef.current = undefined; }}><div className="preview-grid" />{activeMedia ? <video src={activeMedia.previewUrl} style={{ filter: previewFilter(template.filter) }} muted loop autoPlay playsInline /> : <div className="preview-empty">选择一条有效素材查看预览</div>}{template.layers.filter((layer) => layer.visible).sort((a, b) => a.zIndex - b.zIndex).map((layer) => <PreviewLayer key={layer.id} layer={layer} selected={layer.id === selectedLayerId} onPointerDown={onPointerDown} />)}<div className="preview-corner-label">PREVIEW / APPROXIMATE</div></div>;
}

function PreviewLayer({ layer, selected, onPointerDown }: { layer: Layer; selected: boolean; onPointerDown: (event: PointerEvent<HTMLDivElement>, layer: Layer) => void }) {
  const style: CSSProperties = { left: `${layer.x * 100}%`, top: `${layer.y * 100}%`, width: `${layer.width * 100}%`, opacity: layer.opacity, transform: `rotate(${layer.type === "sticker" ? layer.rotationDeg : 0}deg)`, fontFamily: layer.type === "text" ? layer.fontFamily : undefined, fontSize: layer.type === "text" ? `${Math.max(12, layer.fontSizeRatio * 640)}px` : undefined, color: layer.type === "text" ? colorToHex(layer.color) : undefined, WebkitTextStroke: layer.type === "text" ? `${layer.strokeWidthRatio * 640}px ${colorToHex(layer.strokeColor)}` : undefined };
  return <div className={`preview-layer ${layer.type} ${selected ? "selected" : ""}`} style={style} onPointerDown={(event) => onPointerDown(event, layer)}>{layer.type === "text" ? layer.content : <img src={localFileUrl(layer.assetPath)} alt="贴纸图层" draggable={false} />}</div>;
}

function LayerRow({ layer, selected, onSelect, onToggle, onDelete }: { layer: Layer; selected: boolean; onSelect: () => void; onToggle: () => void; onDelete: () => void }) { return <div className={`layer-row ${selected ? "selected" : ""} ${!layer.visible ? "hidden-layer" : ""}`}><button className="layer-main" onClick={onSelect}><span className="layer-type">{layer.type === "text" ? "T" : "◇"}</span><span>{layer.type === "text" ? layer.content : "贴纸"}</span></button><button className="layer-visibility" aria-label={layer.visible ? "隐藏图层" : "显示图层"} onClick={onToggle}>{layer.visible ? "◉" : "○"}</button><button className="layer-delete" aria-label="删除图层" onClick={onDelete}>×</button></div>; }

function LayerInspector({ layer, onPatch, onMove, onDelete }: { layer: Layer; onPatch: (patch: Partial<Layer>) => void; onMove: (direction: -1 | 1) => void; onDelete: () => void }) {
  return <div className="inspector-section properties"><div className="inspector-title"><span>{layer.type === "text" ? "文字属性" : "贴纸属性"}</span><div className="property-actions"><button aria-label="图层上移" onClick={() => onMove(1)}>↑</button><button aria-label="图层下移" onClick={() => onMove(-1)}>↓</button><button aria-label="删除图层" onClick={onDelete}>×</button></div></div>{layer.type === "text" ? <><label className="field-label">内容<textarea maxLength={500} value={layer.content} onChange={(event) => onPatch({ content: event.target.value })} /></label><label className="field-label">字体<input value={layer.fontFamily} onChange={(event) => onPatch({ fontFamily: event.target.value })} /></label><div className="field-pair"><label className="field-label">颜色<input type="color" value={colorToHex(layer.color)} onChange={(event) => onPatch({ color: hexToColor(event.target.value, layer.color.a) })} /></label><label className="field-label">字号比例<input type="number" min="0.001" max="0.5" step="0.005" value={layer.fontSizeRatio} onChange={(event) => onPatch({ fontSizeRatio: clamp(Number(event.target.value), 0.001, 0.5) })} /></label></div><div className="field-pair"><label className="field-label">描边颜色<input type="color" value={colorToHex(layer.strokeColor)} onChange={(event) => onPatch({ strokeColor: hexToColor(event.target.value, layer.strokeColor.a) })} /></label><label className="field-label">描边比例<input type="number" min="0" max="0.05" step="0.001" value={layer.strokeWidthRatio} onChange={(event) => onPatch({ strokeWidthRatio: clamp(Number(event.target.value), 0, 0.05) })} /></label></div></> : <label className="field-label sticker-path">资源<input value={layer.assetPath} readOnly title={layer.assetPath} /></label>}<div className="field-grid"><NumberField label="X" value={layer.x} onChange={(value) => onPatch({ x: clamp(value, 0, 1 - layer.width) })} /><NumberField label="Y" value={layer.y} onChange={(value) => onPatch({ y: clamp(value) })} /><NumberField label="宽度" value={layer.width} onChange={(value) => onPatch({ width: clamp(value, 0.01, 1 - layer.x) })} />{layer.type === "sticker" && <NumberField label="旋转°" value={layer.rotationDeg} onChange={(value) => onPatch({ rotationDeg: Math.max(-360, Math.min(360, value)) })} />}</div><label className="field-label">透明度 <output>{Math.round(layer.opacity * 100)}%</output><input type="range" min="0" max="1" step="0.01" value={layer.opacity} onChange={(event) => onPatch({ opacity: Number(event.target.value) })} /></label></div>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="field-label"><span>{label}</span><input type="number" min={label === "旋转°" ? -360 : 0} max={label === "旋转°" ? 360 : 1} step="0.01" value={Number(value.toFixed(3))} onChange={(event) => onChange(Number(event.target.value))} /></label>; }

function ExportStep({ state, tasks, selectedMedia, outputDirectory, busy, allDone, onOutputDirectory, onCreate, onCancel, onRetry, onOpen, onReveal, onCopy }: { state: PublicState; tasks: Array<{ task: any; batch: any }>; selectedMedia: MediaView[]; outputDirectory: string; busy: boolean; allDone: boolean; onOutputDirectory: () => void; onCreate: () => void; onCancel: (id: string) => void; onRetry: () => void; onOpen: (id: string) => void; onReveal: (id: string) => void; onCopy: (path: string) => void }) {
  const completed = tasks.filter(({ task }) => task.status === "completed").length;
  const failed = tasks.filter(({ task }) => ["failed", "interrupted"].includes(task.status)).length;
  const overall = tasks.length ? tasks.reduce((sum, { task }) => sum + task.progress, 0) / tasks.length : 0;
  return <div className="step-panel"><SectionHeading kicker="03 / EXPORT & DELIVER" title="检查并导出结果" subtitle="模板会在启动时冻结。每条原始素材对应一个独立 MP4，失败项不会阻塞其他任务。" />
    <div className="export-summary"><div className="summary-card"><span className="eyebrow">SELECTED</span><strong>{selectedMedia.length}<small> 条素材</small></strong><span>预计至少 {formatBytes(selectedMedia.reduce((sum, item) => sum + item.sizeBytes, 0))}</span></div><div className="summary-card"><span className="eyebrow">TEMPLATE</span><strong>{state.project.template.layers.length}<small> 个图层</small></strong><span>{state.project.template.filter.presetId === "none" ? "无全局滤镜" : `滤镜 · ${state.project.template.filter.presetId}`}</span></div><div className="summary-card"><span className="eyebrow">PROGRESS</span><strong>{Math.round(overall * 100)}<small>%</small></strong><span>{completed}/{tasks.length || "—"} 条成片</span></div></div>
    <div className="export-controls"><div><span className="eyebrow">OUTPUT DIRECTORY</span><div className="directory-control"><span>{outputDirectory || "尚未选择输出目录"}</span><button className="secondary-button" onClick={onOutputDirectory}>选择目录</button></div><small className="control-hint">输出将使用 <code>原文件名_edited.mp4</code>；同名时自动递增，不会覆盖已有文件。</small></div><button className="primary-button export-button" disabled={busy || !state.templateReadiness.ready || selectedMedia.length === 0 || !outputDirectory} onClick={onCreate}>{busy ? "准备中…" : "启动批量导出"}<span>↗</span></button></div>
    {tasks.length > 0 && <div className="results-card"><div className="card-heading"><div><span className="eyebrow">EXPORT QUEUE</span><h3>导出结果 <em>{completed}/{tasks.length}</em></h3></div><div className="result-actions">{failed > 0 && <button className="secondary-button" onClick={onRetry}>仅重试失败 / 中断</button>}<span className={`queue-state ${allDone ? "done" : "active"}`}>{allDone ? "队列已停止" : "正在处理"}</span></div></div><div className="progress-track"><span style={{ width: `${overall * 100}%` }} /></div><div className="results-list">{tasks.map(({ task, batch }) => <ResultRow key={task.id} task={task} media={state.project.mediaItems.find((item) => item.id === task.mediaId)} onCancel={onCancel} onOpen={onOpen} onReveal={onReveal} onCopy={onCopy} />)}</div></div>}
    {tasks.length === 0 && <div className="export-empty"><div className="empty-orbit">↗</div><strong>还没有导出批次</strong><p>选择输出目录后启动批量导出。建议先在模板步骤生成验证样片。</p></div>}
  </div>;
}

function ResultRow({ task, media, onCancel, onOpen, onReveal, onCopy }: { task: any; media?: MediaView; onCancel: (id: string) => void; onOpen: (id: string) => void; onReveal: (id: string) => void; onCopy: (path: string) => void }) {
  const terminal = ["completed", "failed", "cancelled", "interrupted"].includes(task.status);
  const recovery = task.errorCode ? ` · ${recoveryAdvice(task.errorCode)}` : "";
  return <div className="result-row"><div className={`result-icon ${task.status}`}>{task.status === "completed" ? "✓" : task.status === "failed" || task.status === "interrupted" ? "!" : task.status === "running" ? "↗" : "·"}</div><div className="result-main"><strong>{media?.displayName ?? "未知素材"}</strong><span>{STATUS_LABEL[task.status] ?? task.status} · 尝试 {Math.max(1, task.attempt)} · 耗时 {formatTaskElapsed(task)} · {task.errorMessage ?? (task.outputPath ? task.outputPath.split("/").pop() : "等待处理")}{recovery}</span>{task.outputPath && <code className="result-path" title={task.outputPath}>输出：{task.outputPath}</code>}{!terminal && <div className="mini-progress"><span style={{ width: `${task.progress * 100}%` }} /></div>}</div><span className="result-percent">{Math.round(task.progress * 100)}%</span>{task.status === "completed" ? <div className="result-buttons"><button onClick={() => onOpen(task.id)}>播放</button><button onClick={() => onReveal(task.id)}>定位</button>{task.outputPath && <button onClick={() => onCopy(task.outputPath)}>复制路径</button>}</div> : ["queued", "validating", "running", "verifying"].includes(task.status) ? <button className="text-button" onClick={() => onCancel(task.id)}>取消</button> : <span className={`result-code ${task.status}`}>{task.errorCode ?? "需重试"}</span>}</div>;
}

function SectionHeading({ kicker, title, subtitle }: { kicker: string; title: string; subtitle: string }) { return <div className="section-heading"><span className="eyebrow">{kicker}</span><h2>{title}</h2><p>{subtitle}</p></div>; }
