import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { DesktopState } from "../shared/desktop";
import type { RuleId } from "../shared/agent";
import { ConnectionPanel } from "./ConnectionPanel";
import { ModelPicker } from "./ModelPicker";
import { TemplatePanel } from "./TemplatePanel";
import { CornerDecorationPicker } from "./CornerDecorationPicker";
import { DecorationSchema, type DecorationOptions, type Corner } from "../shared/decorations";
import { DEFAULT_EXPORT_FORMAT, type ExportFormat } from "../shared/export-format";
import { ResultsPanel } from "./ResultsPanel";
import { Heading, Icon, duration, sizeLabel } from "./ui";

type Step = "connection" | "import" | "templates" | "results";
const steps: { id: Step; icon: string; label: string; detail: string }[] = [
  { id: "import", icon: "folder", label: "素材工作台", detail: "01" },
  { id: "templates", icon: "grid", label: "规则模板", detail: "02" },
  { id: "results", icon: "film", label: "我的作品", detail: "03" },
];

export default function App() {
  const [state, setState] = useState<DesktopState>();
  const [step, setStep] = useState<Step>("connection");
  const [notice, setNotice] = useState<{ error: boolean; text: string }>();
  const [initError, setInitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [rule, setRule] = useState<RuleId>("black-gold");
  const [decorations, setDecorations] = useState<DecorationOptions>(() => DecorationSchema.parse({}));
  const [selectedCorner, setSelectedCorner] = useState<Corner>();
  const [multiplier, setMultiplier] = useState(1);
  const [brief, setBrief] = useState("");
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [outputDirectory, setOutputDirectory] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>(DEFAULT_EXPORT_FORMAT);
  const [dragOver, setDragOver] = useState(false);
  const [previewId, setPreviewId] = useState<string>();
  const [retryingIds, setRetryingIds] = useState<string[]>([]);
  const retrying = useRef(new Set<string>());
  const initialized = useRef(false);
  const knownMedia = useRef(new Set<string>());
  const projectId = useRef("");
  const operation = useRef(false);

  const apply = useCallback((next: DesktopState) => {
    const ready = next.project.mediaItems.filter((item) => item.probeStatus === "ready");
    if (projectId.current !== next.project.id) {
      projectId.current = next.project.id;
      knownMedia.current.clear();
      setOutputDirectory("");
      setPreviewId(undefined);
    }
    const additions = ready.filter((item) => !knownMedia.current.has(item.id)).map((item) => item.id);
    knownMedia.current = new Set(next.project.mediaItems.map((item) => item.id));
    setSelected((current) => [...new Set([...current.filter((id) => ready.some((item) => item.id === id)), ...additions])]);
    setState(next);
    if (!initialized.current) {
      initialized.current = true;
      setStep(next.connection.configured ? "import" : "connection");
    }
  }, []);

  useEffect(() => {
    if (!window.jianji) {
      setInitError("请在简辑桌面应用中打开。本页面需要桌面环境来连接模型和处理本地视频。");
      return;
    }
    let active = true;
    void window.jianji.getState().then((next) => { if (active) apply(next); }).catch(() => {
      if (active) setInitError("桌面环境初始化失败，请关闭应用后重新启动。");
    });
    const unsubscribe = window.jianji.onExportSnapshot((next) => { if (active) apply(next); });
    return () => { active = false; unsubscribe(); };
  }, [apply]);

  const run = async (action: () => Promise<void>, success?: string): Promise<boolean> => {
    if (operation.current) return false;
    operation.current = true; setBusy(true); setNotice(undefined);
    try {
      await action();
      if (success) setNotice({ error: false, text: success });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "操作未完成，请重试。";
      setNotice({ error: true, text: message });
      return false;
    } finally { operation.current = false; setBusy(false); }
  };

  if (!state) return <div className="loading-screen"><div className="brand-symbol"><Icon name="spark" size={28} /></div><h1>简辑 <span>JIANJI</span></h1><p role={initError ? "alert" : "status"}>{initError || "正在准备你的创作空间…"}</p>{initError && <small>在项目目录运行 npm run dev，或使用已安装的桌面应用。</small>}</div>;

  const agentRunning = state.agentRun?.status === "running";
  const exportTasks = state.queue.batches.flatMap(({ batch }) => batch.tasks);
  const exporting = exportTasks.some((task) => !["completed", "failed", "cancelled", "interrupted"].includes(task.status));
  const locked = busy || agentRunning;
  const selectedMedia = state.project.mediaItems.filter((item) => selected.includes(item.id));
  const ready = state.project.mediaItems.filter((item) => item.probeStatus === "ready");
  const preview = ready.find((item) => item.id === previewId) ?? ready[0];
  const canCreate = state.connection.configured && state.capabilities.ready;

  const importMedia = () => void run(async () => { apply(await window.jianji.selectAndProbe()); });
  const dropMedia = (event: DragEvent) => {
    event.preventDefault(); setDragOver(false);
    if (locked || !state.connection.configured) return;
    const paths = [...event.dataTransfer.files].map((file) => window.jianji.getPathForFile(file)).filter(Boolean);
    if (paths.length) void run(async () => { apply(await window.jianji.addAndProbe(paths)); });
  };
  const changeProject = (load: boolean) => void run(async () => {
    const next = await (load ? window.jianji.loadProject() : window.jianji.newProject());
    if (next) { apply(next); setStep(next.connection.configured ? "import" : "connection"); }
  });
  const start = () => void run(async () => {
    apply(await window.jianji.startAgent({ mediaIds: selected, ruleId: rule, brief, outputDirectory, decorations, exportFormat, multiplier }));
    setStep("results");
  });
  const generateBrief = () => void run(async () => {
    setGeneratingBrief(true);
    try { setBrief(await window.jianji.generateBrief({ ruleId: rule, decorations, brief })); }
    finally { setGeneratingBrief(false); }
  });
  const retryExport = (id: string) => {
    if (retrying.current.has(id)) return;
    retrying.current.add(id); setRetryingIds([...retrying.current]);
    void window.jianji.retryExport([id]).then(apply).catch((error: unknown) => {
      setNotice({ error: true, text: error instanceof Error ? error.message : "导出重试失败，请检查素材和输出目录。" });
    }).finally(() => {
      retrying.current.delete(id); setRetryingIds([...retrying.current]);
    });
  };
  const navigate = (next: Step) => {
    if (!state.connection.configured && next !== "results") setStep("connection");
    else setStep(next);
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); navigate("import"); }}><div className="brand-symbol"><Icon name="spark" size={24} /></div><div><strong>简辑<span>JIANJI</span></strong><small>让创作，简单一点</small></div></a>
      <button className="new-project" disabled={locked || exporting} onClick={() => changeProject(false)}><span>＋</span> 新建创作<Icon name="arrow" size={16} /></button>
      <span className="nav-label">WORKSPACE</span>
      <nav aria-label="创作流程">{steps.map((item) => <button className={step === item.id ? "active" : ""} onClick={() => navigate(item.id)} key={item.id}><Icon name={item.icon} size={19} /><span>{item.label}</span><small>{item.detail}</small></button>)}</nav>
      <div className="sidebar-note"><span className="small-tag"><Icon name="spark" size={14} /> AGENT AT WORK</span><h3>你来定方向，<br />细节交给 Agent。</h3><p>素材 + 规则模板<br />每条视频，独立表达。</p><div className="note-lines"><i /><i /><i /></div></div>
      <div className="sidebar-bottom"><button className={step === "connection" ? "connection-link active" : "connection-link"} onClick={() => setStep("connection")}><Icon name="settings" size={18} /><span>模型与 API</span><i className={state.connection.configured ? "status-dot connected" : "status-dot"} /></button><div className="sidebar-platform">LOCAL DESKTOP <span>WIN / LINUX</span></div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumb">创作空间 <span>/</span> <strong>{step === "connection" ? "模型连接" : steps.find((item) => item.id === step)?.label}</strong></div><div className="topbar-actions"><span className={state.capabilities.ready ? "engine-status" : "engine-status unavailable"}><i />{state.capabilities.ready ? "本地引擎就绪" : "引擎待配置"}</span><button className="icon-button" aria-label="打开项目" disabled={locked || exporting} onClick={() => changeProject(true)}><Icon name="folder" size={18} /></button><button className="button secondary compact" disabled={locked} onClick={() => void run(async () => { const next = await window.jianji.saveProject(); if (next) { apply(next); setNotice({ error: false, text: "项目已保存。" }); } })}><Icon name="download" size={15} />保存项目</button></div></header>
      <main className="content">
        {(step === "templates" || step === "connection") && <ModelPicker connection={state.connection} chatgpt={state.chatgpt} library={state.connections ?? { profiles: [], selected: null }} disabled={locked || exporting} onSelect={(input) => run(async () => { apply(await window.jianji.selectModel(input)); }, "创作模型已切换并保存。")} />}
        {notice && <div className={notice.error ? "notice error" : "notice success"} role={notice.error ? "alert" : "status"}><Icon name={notice.error ? "close" : "check"} size={17} /><span>{notice.text}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(undefined)}><Icon name="close" size={16} /></button></div>}
        {!state.capabilities.ready && step !== "connection" && <div className="capability-banner" role="status"><Icon name="settings" /><div><strong>本地导出引擎需要配置</strong><p>{state.capabilities.message} Windows：安装 FFmpeg 并加入 PATH；Linux：安装 FFmpeg、fontconfig 与 Noto CJK 字体。配置完成后重启应用。</p></div></div>}
        {agentRunning && <div className="activity-banner" role="status"><span className="activity-orb"><Icon name="spark" size={17} /></span><div><strong>Agent 正在逐条创作</strong><span>当前任务使用已冻结的素材与规则。</span></div><button className="text-button" disabled={busy} onClick={() => void run(async () => { apply(await window.jianji.cancelAgent()); })}>停止本轮任务</button></div>}
        {step === "connection" && <ConnectionPanel connection={state.connection} chatgpt={state.chatgpt} library={state.connections ?? { profiles: [], selected: null }} busy={locked} onLogin={() => void run(async () => { apply(await window.jianji.loginChatGPT()); })} onRefreshLogin={() => void run(async () => { apply(await window.jianji.refreshChatGPT()); })} onCancelLogin={() => void run(async () => { apply(await window.jianji.cancelChatGPTLogin()); })} onImport={(id, appType) => run(async () => { apply(await window.jianji.importCCSwitch(id, appType)); }, "已导入简辑，可从列表选择使用。")} onSelect={(id) => run(async () => { apply(await window.jianji.selectConnection(id)); setStep("import"); })} onRemove={(id) => run(async () => { apply(await window.jianji.removeConnection(id)); })} onSave={(input) => run(async () => { apply(await window.jianji.saveConnection(input)); })} onTest={() => void run(async () => { await window.jianji.testAgent(); }, "文本连接测试通过。图片能力会在处理素材时验证。")} onDisconnect={() => void run(async () => { apply(await window.jianji.disconnectAgent()); })} onContinue={() => setStep("import")} />}
        {step === "import" && <>
          <Heading eyebrow="01 / A LITTLE MATERIAL, A LOT OF POSSIBILITY" title="好作品，从你的素材开始">放入视频，选个风格。把反复的调整，交给你的创作搭档。</Heading>
          <div className="import-layout"><div className="import-main">
            <div className={"drop-zone" + (dragOver ? " drag-over" : "")} onDragOver={(event) => { event.preventDefault(); if (!locked) setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={dropMedia}>
              <div className="upload-symbol"><Icon name="upload" size={29} /></div><h2>把视频拖到这里</h2><p>或者从电脑中选择，一次导入多条素材</p><button className="button primary" disabled={locked || !state.connection.configured} onClick={importMedia}><Icon name="folder" size={17} />{busy ? "正在读取…" : "选择本地素材"}</button><small>MP4 · MOV · MKV · WebM <span>原始文件不会被修改</span></small>
            </div>
            <div className="card media-list"><div className="card-header"><h2>素材清单 <span>{state.project.mediaItems.length}</span></h2><button className="text-button" disabled={locked || !ready.length} onClick={() => setSelected(selected.length === ready.length ? [] : ready.map((item) => item.id))}>{selected.length === ready.length && ready.length ? "取消全选" : "选择全部"}</button></div>
              {state.project.mediaItems.length === 0 ? <div className="empty-material"><Icon name="film" size={26} /><p>你的素材即将在这里就位</p><small>导入后自动检查格式、时长与画面尺寸</small></div> : state.project.mediaItems.map((item) => <div className={"media-row" + (preview?.id === item.id ? " previewing" : "")} key={item.id}><input type="checkbox" aria-label={"选择 " + item.displayName} checked={selected.includes(item.id)} disabled={locked || item.probeStatus !== "ready"} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><button className="media-thumb" aria-label={"预览 " + item.displayName} disabled={item.probeStatus !== "ready"} onClick={() => setPreviewId(item.id)}><Icon name="film" /></button><div className="media-info"><strong>{item.displayName}</strong><small>{item.probeStatus === "ready" ? item.width + " × " + item.height + " · " + duration(item.durationMs) + " · " + sizeLabel(item.sizeBytes) : item.errorMessage || "素材不可读取"}</small></div><span className={item.probeStatus === "ready" ? "status-tag completed" : "status-tag failed"}>{item.probeStatus === "ready" ? "就绪" : "需处理"}</span><button className="icon-button" aria-label={"移除 " + item.displayName} disabled={locked} onClick={() => void run(async () => { apply(await window.jianji.removeMedia(item.id)); })}><Icon name="close" size={16} /></button></div>)}
            </div>
          </div><aside className="preview-card card"><div className="card-header"><h2>素材预览</h2><span>ORIGINAL</span></div><div className="source-preview">{preview ? <video key={preview.id} src={preview.previewUrl} controls preload="metadata" /> : <div className="preview-empty"><div className="preview-frame"><Icon name="play" size={27} /></div><p>等一份好素材</p></div>}</div><div className="preview-caption"><strong>{preview?.displayName || "从一个片段开始"}</strong><p>{preview ? "原始素材 · 点击播放查看内容" : "生活片段、产品展示、灵感记录，都能拥有自己的表达。"}</p></div><div className="preview-tip"><Icon name="shield" size={18} /><p>视频保留在本地。开始创作时，仅发送 3 张抽帧供 Agent 分析。</p></div></aside></div>
          <div className="step-footer"><div><strong>{selectedMedia.length ? "已选择 " + selectedMedia.length + " 条素材" : "准备好你的第一份素材"}</strong><small>每条素材独立包装，不合并，不裁剪。</small></div><button className="button primary" disabled={locked || !selectedMedia.length} onClick={() => setStep("templates")}>下一步，选择模板<Icon name="arrow" size={18} /></button></div>
        </>}
        {step === "templates" && <TemplatePanel multiplier={multiplier} onMultiplier={setMultiplier} onProductPrice={(productPrice) => setDecorations((current) => ({ ...current, productPrice }))} onGenerateBrief={generateBrief} generatingBrief={generatingBrief} exportFormat={exportFormat} onExportFormat={setExportFormat} selectedCorner={selectedCorner} onCornerSelect={setSelectedCorner} decorationOptions={decorations} decorations={<CornerDecorationPicker selected={selectedCorner} onSelect={setSelectedCorner} value={decorations} onChange={setDecorations} disabled={locked || exporting} />} selected={rule} onSelect={setRule} brief={brief} onBrief={setBrief} outputDirectory={outputDirectory} onOutput={() => void run(async () => { const directory = await window.jianji.selectOutputDirectory(); if (directory) setOutputDirectory(directory); })} onStart={start} count={selected.length} disabled={locked || exporting || !canCreate} />}
        {step === "results" && <ResultsPanel state={state} busy={busy} retryingIds={retryingIds} onCancel={(id) => void run(async () => { apply(await window.jianji.cancelExport(id)); })} onRetry={retryExport} onOpen={(id) => void run(async () => { await window.jianji.openArtifact(id); })} onReveal={(id) => void run(async () => { await window.jianji.revealArtifact(id); })} onNew={() => navigate("import")} />}
      </main>
      <footer className="app-footer"><span>简辑 · 让每一份素材，都有好表达。</span><span><i /> 本地渲染，原片保留</span></footer>
    </div>
  </div>;
}
