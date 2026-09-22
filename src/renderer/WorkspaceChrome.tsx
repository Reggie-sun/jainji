import { Icon } from "./ui";
import { WORKFLOW_STEPS, activeWorkflowId, type Step, type TemplateSectionId, type WorkflowId } from "./workspace-flow";

export function WorkspaceRail({ step, modelsOpen, connectionConfigured, engineReady, engineLabel, onWorkflow, onStickerLibrary, onResults, onModels, onFeedback }: {
  step: Step;
  modelsOpen: boolean;
  connectionConfigured: boolean;
  engineReady: boolean;
  engineLabel: string;
  onWorkflow(id: WorkflowId): void;
  onStickerLibrary(): void;
  onResults(): void;
  onModels(): void;
  onFeedback(): void;
}) {
  return <aside className="workspace-rail">
    <button className="workspace-brand" type="button" aria-label="返回制作" onClick={() => onWorkflow("materials")}>
      <span className="brand-symbol"><Icon name="spark" size={23} /></span>
      <strong>简辑</strong>
    </button>
    <nav aria-label="工作区">
      <button className={step === "import" || step === "templates" ? "active" : ""} type="button" onClick={() => onWorkflow("materials")}><Icon name="play" /><span>制作</span></button>
      <button className={step === "stickers" ? "active" : ""} type="button" onClick={onStickerLibrary}><Icon name="upload" /><span>贴纸库</span></button>
      <button className={step === "results" ? "active" : ""} type="button" onClick={onResults}><Icon name="film" /><span>作品</span></button>
    </nav>
    <div className="rail-utilities">
      <button type="button" onClick={onFeedback}><Icon name="edit" /><span>反馈</span></button>
      <button className={modelsOpen || step === "connection" ? "active" : ""} type="button" onClick={onModels}><Icon name="settings" /><span>模型</span><i className={connectionConfigured ? "status-dot connected" : "status-dot"} /></button>
      <div className={engineReady ? "rail-engine" : "rail-engine unavailable"} title={engineLabel}><i /><span>{engineReady ? "本地就绪" : "引擎待配置"}</span></div>
    </div>
  </aside>;
}

export function WorkspaceHeader({ step, section, projectName, projectDirty, engineReady, engineLabel, engineWarning, disabled, saveDisabled, onWorkflow, onNewProject, onOpenProject, onSaveProject, onProjectManager }: {
  step: Step;
  section: WorkflowId;
  projectName: string;
  projectDirty: boolean;
  engineReady: boolean;
  engineLabel: string;
  // Three-state hint from the startup encoder probe — `fallback` (HW compiled in
  // but probe failed, e.g. vLLM holding the GPU) and `only` (no HW encoder at
  // all). `undefined` means the engine is on real hardware and needs no hint.
  engineWarning?: { kind: "fallback" | "only"; message: string };
  disabled: boolean;
  saveDisabled: boolean;
  onWorkflow(id: WorkflowId): void;
  onNewProject(): void;
  onOpenProject(): void;
  onSaveProject(): void;
  onProjectManager(): void;
}) {
  const active = activeWorkflowId(step, section);
  const activeIndex = WORKFLOW_STEPS.findIndex(({ id }) => id === active);
  return <header className="workspace-header">
    <div className="workspace-header-row">
      <details className="project-switcher">
        <summary><span><small>当前项目</small><strong>{projectName || "未命名项目"}</strong></span><span className={projectDirty ? "project-state dirty" : "project-state"}>{projectDirty ? "未保存" : "已保存"}</span><span aria-hidden="true">⌄</span></summary>
        <div className="project-menu">
          <button type="button" disabled={saveDisabled} onClick={onSaveProject}><Icon name="download" size={17} />保存项目</button>
          <button type="button" disabled={disabled} onClick={onOpenProject}><Icon name="folder" size={17} />打开项目文件</button>
          <button type="button" disabled={disabled} onClick={onProjectManager}><Icon name="edit" size={17} />重命名 / 删除</button>
          <button type="button" disabled={disabled} onClick={onNewProject}><span className="project-menu-plus">＋</span>新建项目</button>
        </div>
      </details>
      <span className={engineReady ? "engine-status" : "engine-status unavailable"}><i />{engineLabel}</span>
      {engineWarning && <span className={`engine-warning ${engineWarning.kind}`} title={engineWarning.message} aria-label={engineWarning.message}><i />{engineWarning.kind === "fallback" ? "GPU 被占用" : "无硬件编码器"}</span>}
      <div className="header-project-actions">
        <button className="button secondary compact" type="button" disabled={disabled} onClick={onOpenProject}><Icon name="folder" size={16} />打开</button>
        <button className="button primary compact" type="button" disabled={saveDisabled} onClick={onSaveProject}><Icon name="download" size={16} />保存项目</button>
      </div>
    </div>
    {step !== "connection" && step !== "stickers" && <nav className="workflow-steps" aria-label="制作流程">
      {WORKFLOW_STEPS.map((item, index) => <button type="button" key={item.id} className={item.id === active ? "active" : index < activeIndex ? "complete" : ""} aria-current={item.id === active ? "step" : undefined} onClick={() => onWorkflow(item.id)}>
        <span className="workflow-number">{index < activeIndex ? <Icon name="check" size={14} /> : index + 1}</span>
        <span>{item.label}</span>
      </button>)}
    </nav>}
  </header>;
}

const TEMPLATE_SECTIONS = [
  { id: "timing", label: "显示时段", icon: "play", selector: "#display-time-settings" },
  { id: "corners", label: "四角贴纸", icon: "spark", selector: "#corner-decoration-editor" },
] as const;

export function WorkspaceSubnav({ active, onNavigate }: {
  active: TemplateSectionId;
  onNavigate(id: TemplateSectionId, selector: string): void;
}) {
  return <nav className="workspace-subnav" aria-label="包装设置">
    {TEMPLATE_SECTIONS.map((item) => <button key={item.id} type="button" className={active === item.id ? "active" : ""} aria-current={active === item.id ? "location" : undefined} onClick={() => onNavigate(item.id, item.selector)}><Icon name={item.icon} size={16} />{item.label}</button>)}
  </nav>;
}
