import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from "../shared/export-settings";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { DesktopState } from "../shared/desktop";
import { calculateProductionQuantity, MAX_AGENT_OUTPUTS, type RuleId } from "../shared/agent";
import { ConnectionPanel } from "./ConnectionPanel";
import { MaterialNameSchema } from "../shared/material-names";
import { MaterialCollection } from "./MaterialCollection";
import { TemplatePanel } from "./TemplatePanel";
import { CornerDecorationPicker } from "./CornerDecorationPicker";
import { StickerLibraryPanel } from "./StickerLibraryPanel";
import { CoverReviewPanel } from "./CoverReviewPanel";
import { CoverStickerPanel } from "./CoverStickerPanel";
import { DecorationAppearanceSchema, DecorationSchema, ProductPriceSchema, type DecorationOptions, type Corner } from "../shared/decorations";
import type { CoverSticker } from "../shared/cover-sticker";
import { DEFAULT_EXPORT_FORMAT, type ExportFormat } from "../shared/export-format";
import { ProjectWorkspaceSchema } from "../shared/project-workspace";
import { ResultsPanel } from "./ResultsPanel";
import { SourceStickerKnowledgeControls } from "./SourceStickerKnowledgeControls";
import { sourceStickerRefreshEligible, sourceStickerRefreshInput, sourceStickerRefreshModeKey, useSourceStickerRefresh } from "./source-sticker-refresh";
import { BugFeedbackDialog } from "./BugFeedbackDialog";
import { Heading, Icon, duration, sizeLabel } from "./ui";
import { ModelSettingsDrawer } from "./ModelSettingsDrawer";
import { WorkspaceHeader, WorkspaceRail, WorkspaceSubnav } from "./WorkspaceChrome";
import { resolveWorkflowTarget, templateSectionForWorkflow, workflowForTemplateSection, type Step, type TemplateSectionId, type WorkflowId } from "./workspace-flow";

export default function App() {
  const [state, setState] = useState<DesktopState>();
  const [collectionName, setCollectionName] = useState("");
  const [step, setStep] = useState<Step>("connection");
  const [workflowSection, setWorkflowSection] = useState<WorkflowId>("materials");
  const [templateSection, setTemplateSection] = useState<TemplateSectionId>("template");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string }>();
  const [initError, setInitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [rule, setRule] = useState<RuleId>("black-gold");
  const [decorations, setDecorations] = useState<DecorationOptions>(() => DecorationSchema.parse({ mode: "agent" }));
  const [selectedCorner, setSelectedCorner] = useState<Corner>();
  const [stickerRevision, setStickerRevision] = useState(0);
  const [coverStickerDirty, setCoverStickerDirty] = useState(false);
  const [requestedCount, setRequestedCount] = useState<number>();
  const [brief, setBrief] = useState("");
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [outputDirectory, setOutputDirectory] = useState("");
  const [outputDirectoryMode, setOutputDirectoryMode] = useState<"automatic" | "manual">("automatic");
  const [automaticOutputFor, setAutomaticOutputFor] = useState("");
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  const [exportFormat, setExportFormat] = useState<ExportFormat>(DEFAULT_EXPORT_FORMAT);
  const [dragOver, setDragOver] = useState(false);
  const [previewId, setPreviewId] = useState<string>();
  const [retryingIds, setRetryingIds] = useState<string[]>([]);
  const retrying = useRef(new Set<string>());
  const initialized = useRef(false);
  const knownMedia = useRef(new Set<string>());
  const projectId = useRef("");
  const operation = useRef(false);
  const sourceRefresh = useSourceStickerRefresh({
    projectId: state?.project.id ?? "",
    selectedReadyIds: state?.project.mediaItems.filter((item) => item.probeStatus === "ready" && selected.includes(item.id)).map((item) => item.id) ?? [],
    eligible: sourceStickerRefreshEligible(decorations.mode, state?.project.coverSticker),
    modeKey: sourceStickerRefreshModeKey(decorations.mode, state?.project.coverSticker),
  });

  const apply = useCallback((next: DesktopState, restoreProductPrice = false) => {
    const ready = next.project.mediaItems.filter((item) => item.probeStatus === "ready");
    const projectChanged = projectId.current !== next.project.id;
    const workspace = next.project.workspaceDraft;
    if (projectChanged) {
      projectId.current = next.project.id;
      setCollectionName(next.project.name);
      knownMedia.current.clear();
      setRule(workspace?.ruleId ?? "black-gold");
      setBrief(workspace?.brief ?? "");
      setRequestedCount(workspace?.requestedCount);
      setExportSettings(workspace?.exportSettings ?? DEFAULT_EXPORT_SETTINGS);
      setExportFormat(workspace?.exportFormat ?? DEFAULT_EXPORT_FORMAT);
      const manualOutput = workspace?.outputDirectoryMode === "manual" && !!workspace.outputDirectory;
      setOutputDirectoryMode(manualOutput ? "manual" : "automatic");
      setOutputDirectory(manualOutput ? workspace.outputDirectory! : "");
      setAutomaticOutputFor("");
      setSelectedCorner(undefined);
      setPreviewId(undefined);
      setCoverStickerDirty(false);
      setWorkflowSection(workspace?.step === "results" ? "results" : workspace?.step === "templates" ? "packaging" : "materials");
      setTemplateSection("template");
    }
    if (projectChanged || restoreProductPrice) {
      let productPrice = next.project.template.productPriceDraft ?? "";
      if (next.project.template.productPriceDraft === undefined) {
        const legacyKey = `jianji.productPrice.${next.project.id}`;
        try {
          const legacy = window.localStorage.getItem(legacyKey);
          const parsed = legacy === null ? undefined : ProductPriceSchema.safeParse(legacy);
          if (parsed?.success) {
            productPrice = parsed.data;
            void window.jianji.setProductPriceDraft(next.project.id, parsed.data).then((saved) => {
              if (saved.activeRecentProjectId) window.localStorage.removeItem(legacyKey);
              if (projectId.current === next.project.id) setState(saved);
            }).catch(() => {
              if (projectId.current === next.project.id) setNotice({ error: true, text: "旧版展示文字未能迁入当前项目，请重试。" });
            });
          }
        } catch {
          setNotice({ error: true, text: "旧版展示文字未能读取；当前项目仍可重新填写。" });
        }
      }
      const appearance = projectChanged ? workspace?.decorations ?? DecorationAppearanceSchema.parse({ mode: "agent" }) : undefined;
      setDecorations((current) => DecorationSchema.parse({ ...(appearance ?? current), productPrice }));
    }
    const additions = ready.filter((item) => !knownMedia.current.has(item.id)).map((item) => item.id);
    knownMedia.current = new Set(next.project.mediaItems.map((item) => item.id));
    if (projectChanged) {
      const restored = workspace?.selectedMediaIds ?? ready.map((item) => item.id);
      setSelected(restored.filter((id) => ready.some((item) => item.id === id)));
    } else {
      setSelected((current) => [...new Set([...current.filter((id) => ready.some((item) => item.id === id)), ...additions])]);
    }
    setState(next);
    if (!initialized.current) {
      initialized.current = true;
      setStep(next.connection.configured ? workspace?.step ?? "import" : "connection");
    } else if (projectChanged) setStep(next.connection.configured ? workspace?.step ?? "import" : "connection");
  }, []);

  useEffect(() => {
    if (!window.jianji) {
      setInitError("请在简辑桌面应用中打开。本页面需要桌面环境来连接模型和处理本地视频。");
      return;
    }
    let active = true;
    void window.jianji.getState().then((next) => { if (active) apply(next, true); }).catch(() => {
      if (active) setInitError("桌面环境初始化失败，请关闭应用后重新启动。");
    });
    const unsubscribe = window.jianji.onExportSnapshot((next) => { if (active) apply(next); });
    return () => { active = false; unsubscribe(); };
  }, [apply]);

  const automaticSelectionKey = [...selected].sort().join(":");
  useEffect(() => {
    if (outputDirectoryMode === "automatic" && automaticOutputFor && automaticOutputFor !== automaticSelectionKey) {
      setOutputDirectory("");
      setAutomaticOutputFor("");
    }
  }, [automaticOutputFor, automaticSelectionKey, outputDirectoryMode]);

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
  const encoderLabel = state.capabilities.videoEncoder ? {
    libx264: "CPU 编码", h264_nvenc: "NVIDIA GPU", h264_amf: "AMD GPU", h264_qsv: "Intel GPU",
  }[state.capabilities.videoEncoder] : "本地编码";
  const engineLabel = state.capabilities.ready ? `${encoderLabel} · ${state.capabilities.executionLimits?.exports ?? 1} 路` : "引擎待配置";

  const importMedia = () => void run(async () => { apply(await window.jianji.selectAndProbe()); });
  const dropMedia = (event: DragEvent) => {
    event.preventDefault(); setDragOver(false);
    if (locked || !state.connection.configured) return;
    const paths = [...event.dataTransfer.files].map((file) => window.jianji.getPathForFile(file)).filter(Boolean);
    if (paths.length) void run(async () => { apply(await window.jianji.addAndProbe(paths)); });
  };
  const changeProject = async (load: boolean, recentId?: string): Promise<boolean> => {
    let changed = false;
    await run(async () => {
      const next = await (load ? window.jianji.loadProject(recentId) : window.jianji.newProject());
      if (next) { apply(next, true); setCollectionName(next.project.name); changed = true; }
    });
    return changed;
  };
  const renameCollection = (name: string) => {
    setCollectionName(name);
    const parsed = MaterialNameSchema.safeParse(name);
    if (!parsed.success) return;
    const currentId = state.project.id;
    void window.jianji.renameProject(parsed.data).then(() => {
      setState((current) => current?.project.id === currentId ? { ...current, project: { ...current.project, name: parsed.data, hasUnsavedChanges: true } } : current);
    }).catch(() => setNotice({ error: true, text: "项目名称未能更新，请重试。" }));
  };
  const saveCollection = () => void run(async () => {
    const name = MaterialNameSchema.parse(collectionName);
    const resumeStep = step === "templates" || step === "results" ? step : step === "import" ? "import" : state.project.workspaceDraft?.step ?? (selected.length ? "templates" : "import");
    const workspace = ProjectWorkspaceSchema.parse({
      step: resumeStep,
      selectedMediaIds: selected,
      ruleId: rule,
      brief,
      decorations: DecorationAppearanceSchema.parse(decorations),
      ...(Number.isInteger(requestedCount) ? { requestedCount } : {}),
      exportFormat,
      exportSettings,
      outputDirectoryMode,
      ...(outputDirectoryMode === "manual" && outputDirectory ? { outputDirectory } : {}),
    });
    const next = await window.jianji.saveProject(name, workspace);
    if (next) { apply(next); setCollectionName(next.project.name); setNotice({ error: false, text: "项目已保存，下次可从已保存项目列表继续。" }); }
  });
  const renameSavedCollection = async (recentId: string, name: string): Promise<boolean> => run(async () => {
    const next = await window.jianji.renameSavedProject(recentId, name);
    apply(next);
    setCollectionName(next.project.name);
  }, "项目已重命名。");
  const removeSavedCollection = async (recentId: string): Promise<boolean> => {
    let removed = false;
    const completed = await run(async () => {
      const next = await window.jianji.removeSavedProject(recentId);
      if (!next) return;
      removed = true;
      apply(next);
    });
    if (completed && removed) setNotice({ error: false, text: "项目已移到系统回收站，原视频未删除。" });
    return completed && removed;
  };
  const rememberProductPrice = (productPrice: string) => {
    setDecorations((current) => ({ ...current, productPrice }));
    const parsed = ProductPriceSchema.safeParse(productPrice);
    if (!parsed.success) return;
    const currentId = state.project.id;
    setState((current) => current?.project.id === currentId ? { ...current, project: { ...current.project, hasUnsavedChanges: true, template: { ...current.project.template, productPriceDraft: parsed.data } } } : current);
    void window.jianji.setProductPriceDraft(currentId, parsed.data).then((next) => {
      if (projectId.current === currentId) setState(next);
    }).catch(() => {
      if (projectId.current === currentId) setNotice({ error: true, text: "展示文字未能写入当前项目，请重试。" });
    });
  };
  const resolveOutputDirectory = async (existingDirectory?: string): Promise<string> => {
    if (outputDirectoryMode === "manual") {
      if (!outputDirectory) throw new Error("请选择成片保存目录。");
      return outputDirectory;
    }
    if (outputDirectory && automaticOutputFor === automaticSelectionKey) return outputDirectory;
    const directory = await window.jianji.createAutomaticOutputDirectory(selected, existingDirectory);
    setOutputDirectory(directory);
    setAutomaticOutputFor(automaticSelectionKey);
    return directory;
  };
  const start = () => void (async () => {
    const accepted = await run(async () => {
    if (coverStickerDirty) throw new Error("请先保存覆盖设置后再开始制作。");
    const quantity = calculateProductionQuantity(selected.length, requestedCount ?? selected.length);
    if (!quantity || quantity.total > MAX_AGENT_OUTPUTS) throw new Error(`请填写有效的制作条数，向上取整后不能超过 ${MAX_AGENT_OUTPUTS} 条。`);
    setWorkflowSection("results");
    setStep("results");
    window.scrollTo({ top: 0, behavior: "smooth" });
    const sourceStickerRefresh = sourceStickerRefreshInput(sourceRefresh.refresh);
    const resolvedOutputDirectory = await resolveOutputDirectory();
    apply(await window.jianji.startAgent({ mediaIds: selected, ruleId: rule, brief, outputDirectory: resolvedOutputDirectory, decorations, exportFormat, exportSettings, multiplier: quantity.multiplier, ...(sourceStickerRefresh ? { sourceStickerRefresh } : {}) }));
    });
    if (accepted) sourceRefresh.consume();
  })();
  const generateBrief = () => void run(async () => {
    setGeneratingBrief(true);
    try { setBrief(await window.jianji.generateBrief({ ruleId: rule, decorations, brief })); }
    finally { setGeneratingBrief(false); }
  });
  const saveCoverSticker = async (coverSticker: CoverSticker) => {
    const saved = await run(async () => { apply(await window.jianji.setCoverSticker(coverSticker)); });
    if (!saved) throw new Error("覆盖设置未保存，请查看提示后重试。");
  };
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
    if (next === "import" && step === "results" && outputDirectoryMode === "automatic") {
      setOutputDirectory("");
      setAutomaticOutputFor("");
    }
    if (!state.connection.configured && next !== "results" && next !== "stickers") setStep("connection");
    else setStep(next);
  };

  const scrollAfterRender = (selector: string) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  };
  const navigateWorkflow = (id: WorkflowId) => {
    const target = resolveWorkflowTarget(id);
    setWorkflowSection(target.section);
    if (target.step === "templates") setTemplateSection(templateSectionForWorkflow(id));
    navigate(target.step);
    if (target.selector) scrollAfterRender(target.selector);
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openProjectManager = () => {
    setWorkflowSection("materials");
    navigate("import");
    scrollAfterRender(".material-collection");
  };
  const openModelSettings = () => {
    if (state.connection.configured) setModelsOpen(true);
    else setStep("connection");
  };

  return <div className="app-shell">
    <WorkspaceRail step={step} modelsOpen={modelsOpen} connectionConfigured={state.connection.configured} engineReady={state.capabilities.ready} engineLabel={engineLabel} onWorkflow={navigateWorkflow} onStickerLibrary={() => navigate("stickers")} onResults={() => navigateWorkflow("results")} onModels={openModelSettings} onFeedback={() => setFeedbackOpen(true)} />
    {/* 上传贴纸归入模板素材反馈分类，沿用现有中继接口。 */}
    <BugFeedbackDialog open={feedbackOpen} page={step === "stickers" ? "templates" : step} onClose={() => setFeedbackOpen(false)} />
    <div className="main-area">
      <WorkspaceHeader step={step} section={workflowSection} projectName={collectionName} projectDirty={state.project.hasUnsavedChanges || collectionName.trim() !== state.project.name} engineReady={state.capabilities.ready} engineLabel={engineLabel} disabled={locked || exporting} saveDisabled={locked || !MaterialNameSchema.safeParse(collectionName).success} onWorkflow={navigateWorkflow} onNewProject={() => void changeProject(false)} onOpenProject={() => void changeProject(true)} onSaveProject={saveCollection} onProjectManager={openProjectManager} />
      <main className="content">
        {state.recentProjectsWarning && <div className="notice error" role="status">{state.recentProjectsWarning}</div>}
        {state.project.migrationBackupPath && <div className="notice" role="status">项目已升级；降级副本保存在：{state.project.migrationBackupPath}</div>}
        {notice && <div className={notice.error ? "notice error" : "notice success"} role={notice.error ? "alert" : "status"}><Icon name={notice.error ? "close" : "check"} size={17} /><span>{notice.text}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(undefined)}><Icon name="close" size={16} /></button></div>}
        {!state.capabilities.ready && step !== "connection" && step !== "stickers" && <div className="capability-banner" role="status"><Icon name="settings" /><div><strong>本地导出引擎需要配置</strong><p>{state.capabilities.message} Windows 安装版：请重新安装完整的简辑安装包；Linux：安装 FFmpeg、fontconfig 与 Noto CJK 字体。配置完成后重启应用。</p></div></div>}
        {agentRunning && <div className="activity-banner" role="status"><span className="activity-orb"><Icon name="spark" size={17} /></span><div><strong>Agent 正在逐条创作</strong><span>当前任务使用已冻结的素材与规则。</span></div><button className="text-button" disabled={busy} onClick={() => void run(async () => { apply(await window.jianji.cancelAgent()); })}>停止本轮任务</button></div>}
        {step === "stickers" && <StickerLibraryPanel disabled={locked || exporting} revision={stickerRevision} onRemoved={(id) => {
          setStickerRevision((current) => current + 1);
          setDecorations((current) => ({
            ...current,
            sticker: current.sticker === id ? "none" : current.sticker,
            corners: current.corners && Object.fromEntries(Object.entries(current.corners).map(([corner, selection]) => [corner, selection?.type === "sticker" && selection.sticker === id ? { type: "none" as const } : selection])),
          }));
        }} />}
        {step === "connection" && <ConnectionPanel connection={state.connection} chatgpt={state.chatgpt} library={state.connections ?? { profiles: [], selected: null }} busy={locked} onLogin={() => void run(async () => { apply(await window.jianji.loginChatGPT()); })} onRefreshLogin={() => void run(async () => { apply(await window.jianji.refreshChatGPT()); })} onCancelLogin={() => void run(async () => { apply(await window.jianji.cancelChatGPTLogin()); })} onImport={(id, appType) => run(async () => { apply(await window.jianji.importCCSwitch(id, appType)); }, "已导入简辑，可从列表选择使用。")} onSelect={(id) => run(async () => { apply(await window.jianji.selectConnection(id)); setWorkflowSection("materials"); setStep("import"); })} onRemove={(id) => run(async () => { apply(await window.jianji.removeConnection(id)); })} onSave={(input) => run(async () => { apply(await window.jianji.saveConnection(input)); })} onTest={() => void run(async () => { await window.jianji.testAgent(); }, "文本连接测试通过。图片能力会在处理素材时验证。")} onDisconnect={() => void run(async () => { apply(await window.jianji.disconnectAgent()); })} onContinue={() => { setWorkflowSection("materials"); setStep("import"); }} />}
        {step === "import" && <>
          <Heading eyebrow="01 / A LITTLE MATERIAL, A LOT OF POSSIBILITY" title="好作品，从你的素材开始">放入视频，填写价格。贴纸与滤镜可以交给 Agent 自主安排。</Heading>
          <MaterialCollection name={collectionName} dirty={state.project.hasUnsavedChanges || collectionName.trim() !== state.project.name} disabled={locked} openingDisabled={locked || exporting} onName={renameCollection} onBrowse={() => void changeProject(true)} onOpen={(id) => void changeProject(true, id)} onSave={saveCollection} onRename={renameSavedCollection} onDelete={removeSavedCollection} recentProjects={state.recentProjects ?? []} activeRecentId={state.activeRecentProjectId} />
          <div className="import-layout"><div className="import-main">
            <div className={"drop-zone" + (dragOver ? " drag-over" : "")} onDragOver={(event) => { event.preventDefault(); if (!locked) setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={dropMedia}>
              <div className="upload-symbol"><Icon name="upload" size={29} /></div><h2>把视频拖到这里</h2><p>或者从电脑中选择，一次导入多条素材</p><button className="button primary" disabled={locked || !state.connection.configured} onClick={importMedia}><Icon name="folder" size={17} />{busy ? "正在读取…" : "选择本地素材"}</button><small>MP4 · MOV · MKV · WebM <span>原始文件不会被修改</span></small>
            </div>
            <div className="card media-list"><div className="card-header"><h2>素材清单 <span>{state.project.mediaItems.length}</span></h2><button className="text-button" disabled={locked || !ready.length} onClick={() => setSelected(selected.length === ready.length ? [] : ready.map((item) => item.id))}>{selected.length === ready.length && ready.length ? "取消全选" : "选择全部"}</button></div>
              {state.project.mediaItems.length === 0 ? <div className="empty-material"><Icon name="film" size={26} /><p>你的素材即将在这里就位</p><small>导入后自动检查格式、时长与画面尺寸</small></div> : state.project.mediaItems.map((item) => <div className={"media-row" + (preview?.id === item.id ? " previewing" : "")} key={item.id}><input type="checkbox" aria-label={"选择 " + item.displayName} checked={selected.includes(item.id)} disabled={locked || item.probeStatus !== "ready"} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><button className="media-thumb" aria-label={"预览 " + item.displayName} disabled={item.probeStatus !== "ready"} onClick={() => setPreviewId(item.id)}><Icon name="film" /></button><div className="media-info"><strong>{item.displayName}</strong><small>{item.probeStatus === "ready" ? item.width + " × " + item.height + " · " + duration(item.durationMs) + " · " + sizeLabel(item.sizeBytes) : item.errorMessage || "素材不可读取"}</small></div><span className={item.probeStatus === "ready" ? "status-tag completed" : "status-tag failed"}>{item.probeStatus === "ready" ? "就绪" : "需处理"}</span><button className="icon-button" aria-label={"移除 " + item.displayName} disabled={locked} onClick={() => void run(async () => { apply(await window.jianji.removeMedia(item.id)); })}><Icon name="close" size={16} /></button></div>)}
            </div>
          </div><aside className="preview-card card"><div className="card-header"><h2>素材预览</h2><span>ORIGINAL</span></div><div className="source-preview">{preview ? <video key={preview.id} src={preview.previewUrl} controls preload="metadata" /> : <div className="preview-empty"><div className="preview-frame"><Icon name="play" size={27} /></div><p>等一份好素材</p></div>}</div><div className="preview-caption"><strong>{preview?.displayName || "从一个片段开始"}</strong><p>{preview ? "原始素材 · 点击播放查看内容" : "生活片段、产品展示、灵感记录，都能拥有自己的表达。"}</p></div><div className="preview-tip"><Icon name="shield" size={18} /><p>视频保留在本地。发送抽帧供 Agent 分析；自动覆盖开启时，还会逐段发送追踪抽帧。</p></div></aside></div>
          <div className="step-footer"><div><strong>{selectedMedia.length ? "已选择 " + selectedMedia.length + " 条素材" : "准备好你的第一份素材"}</strong><small>每条素材独立包装，不合并，不裁剪。</small></div><button className="button primary" disabled={locked || !selectedMedia.length} onClick={() => navigateWorkflow("packaging")}>下一步，设置制作规则<Icon name="arrow" size={18} /></button></div>
        </>}
        {step === "templates" && <WorkspaceSubnav active={templateSection} onNavigate={(section, selector) => { setTemplateSection(section); setWorkflowSection(workflowForTemplateSection(section)); scrollAfterRender(selector); }} />}
        {step === "templates" && <div className="template-workspace-start"><SourceStickerKnowledgeControls projectId={state.project.id} selectedReadyIds={selectedMedia.filter((item) => item.probeStatus === "ready").map((item) => item.id)} eligible={sourceStickerRefreshEligible(decorations.mode, state.project.coverSticker)} disabled={locked || exporting} refresh={sourceRefresh.refresh} onRequest={sourceRefresh.request} /></div>}
        {step === "templates" && <TemplatePanel onDisplayMode={(displayMode) => setDecorations((current) => ({ ...current, displayMode }))} onPriceStyle={(priceStyle) => setDecorations((current) => ({ ...current, priceStyle }))} requestedCount={requestedCount} onRequestedCount={setRequestedCount} onProductPrice={rememberProductPrice} onGenerateBrief={generateBrief} generatingBrief={generatingBrief} exportSettings={exportSettings} onExportSettings={setExportSettings} exportFormat={exportFormat} onExportFormat={setExportFormat} selectedCorner={selectedCorner} onCornerSelect={setSelectedCorner} decorationOptions={decorations} decorations={<CornerDecorationPicker selected={selectedCorner} onSelect={setSelectedCorner} value={decorations} onChange={setDecorations} disabled={locked || exporting} />} coverPanel={<div id="cover-sticker-settings"><CoverStickerPanel projectId={state.project.id} value={state.project.coverSticker} selectedMedia={selectedMedia} revision={stickerRevision} disabled={locked || exporting} onSave={saveCoverSticker} onDirtyChange={setCoverStickerDirty} /></div>} coverDirty={coverStickerDirty} selected={rule} onSelect={setRule} brief={brief} onBrief={setBrief} outputDirectory={outputDirectory} automaticOutput={outputDirectoryMode === "automatic"} onAutomaticOutput={() => { setOutputDirectoryMode("automatic"); setOutputDirectory(""); setAutomaticOutputFor(""); }} onOutput={() => void run(async () => { const directory = await window.jianji.selectOutputDirectory(); if (directory) { setOutputDirectoryMode("manual"); setOutputDirectory(directory); setAutomaticOutputFor(""); } })} onStart={start} count={selected.length} disabled={locked || exporting || !canCreate} />}
        {step === "templates" && state.project.coverSticker?.enabled && state.project.coverSticker.trackingMode === "assisted" && <CoverReviewPanel agentRun={state.agentRun} library={state.connections ?? { profiles: [], selected: null }} chatgpt={state.chatgpt} drafts={state.project.reviewDrafts ?? []} mediaItems={state.project.mediaItems} input={{ mediaIds: selected, ruleId: rule, brief, outputDirectory, decorations, exportFormat, exportSettings, multiplier: calculateProductionQuantity(selected.length, requestedCount ?? selected.length)?.multiplier ?? 1 }} onResolveOutputDirectory={resolveOutputDirectory} onState={apply} />}
        {step === "results" && <ResultsPanel state={state} busy={busy} retryingIds={retryingIds} onCancel={(id) => void run(async () => { apply(await window.jianji.cancelExport(id)); })} onRetry={retryExport} onOpen={(id) => void run(async () => { await window.jianji.openArtifact(id); })} onReveal={(id) => void run(async () => { await window.jianji.revealArtifact(id); })} onNew={() => navigateWorkflow("materials")} />}
      </main>
      <footer className="app-footer"><span>简辑 · 让每一份素材，都有好表达。</span><span><i /> 本地渲染，原片保留</span></footer>
    </div>
    <ModelSettingsDrawer open={modelsOpen} state={state} disabled={locked || exporting} onClose={() => setModelsOpen(false)} onManageConnections={() => { setModelsOpen(false); setStep("connection"); }} onTest={() => void run(async () => { await window.jianji.testAgent(); }, "文本连接测试通过。图片能力会在处理素材时验证。")} onSelectModel={(input) => run(async () => { apply(await window.jianji.selectModel(input)); }, "创作模型已切换并保存。")} onSelectVision={(input) => run(async () => { apply(await window.jianji.selectVisionConnection(input)); }, "视觉识别模型设置已保存。")} onSelectReviewer={(input) => run(async () => { apply(await window.jianji.selectReviewerConnection(input)); }, "复核模型设置已保存。")} />
  </div>;
}
