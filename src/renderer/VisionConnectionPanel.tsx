import type { ChatGPTStatus, ConnectionStatus } from "../shared/agent";
import type { ConnectionLibrary, SelectModel } from "../shared/connections";

const EFFORT_LABELS: Record<string, string> = { none: "不推理", minimal: "最少", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高", ultra: "极高" };
const effortLabel = (value: string) => EFFORT_LABELS[value] ? `${EFFORT_LABELS[value]} · ${value}` : value;
const apiEfforts = (protocol?: string) => protocol === "anthropic" ? ["low", "medium", "high", "xhigh", "max"] : ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

export function VisionConnectionPanel({ connection, chatgpt, library, disabled, onSelect, role = "vision" }: {
  connection?: ConnectionStatus; chatgpt?: ChatGPTStatus; library: ConnectionLibrary; disabled: boolean;
  role?: "vision" | "reviewer";
  onSelect(input: SelectModel | null): Promise<boolean>;
}) {
  const selection = library[role];
  const label = role === "vision" ? "视觉识别模型" : "复核模型";
  const fieldId = `${role}-connection`;
  const chatgptReady = chatgpt?.status === "ready" && Boolean(chatgpt.models?.length);
  const selectedProfile = selection?.connectionId === "chatgpt" ? undefined : library.profiles.find((profile) => profile.id === selection?.connectionId);
  const chatgptModel = selection?.connectionId === "chatgpt" ? chatgpt?.models?.find((item) => item.model === selection.model) : undefined;
  const effortValue = selection?.reasoningEffort ?? "";
  const selectConnection = async (id: string) => {
    if (!id) return onSelect(null);
    if (id === "chatgpt") {
      if (!chatgptReady) return false;
      const initial = chatgpt?.models?.find((item) => item.model === chatgpt.model) ?? chatgpt?.models?.[0];
      if (!initial) return false;
      return onSelect({ connectionId: "chatgpt", model: initial.model });
    }
    const profile = library.profiles.find((item) => item.id === id);
    return profile ? onSelect({ connectionId: profile.id, model: profile.model }) : false;
  };

  return <div className="card brief-card model-picker">
    <label htmlFor={fieldId}>{label} <span>{role === "vision" ? "执行 Agent · 原贴纸识别" : "主管 Agent · 修正与样片检查"}</span></label>
    <select id={fieldId} value={selection?.connectionId ?? ""} disabled={disabled || Boolean(library.error)} onChange={(event) => void selectConnection(event.target.value)}>
      <option value="">不配置{label}</option>
      <option value="chatgpt" disabled={!chatgptReady}>ChatGPT 登录{chatgptReady ? "" : "（尚未就绪）"}</option>
      {library.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
    </select>
    {selection?.connectionId === "chatgpt" && chatgptReady && <select id={`${fieldId}-model`} value={selection.model} disabled={disabled} onChange={(event) => void onSelect({ connectionId: "chatgpt", model: event.target.value, reasoningEffort: selection.reasoningEffort })}>
      {chatgpt?.models?.map((item) => <option key={item.model} value={item.model}>{item.displayName === item.model ? item.model : `${item.displayName} · ${item.model}`}</option>)}
    </select>}
    {selectedProfile && <label className="effort-picker" htmlFor={`${fieldId}-effort`}>推理档位<select id={`${fieldId}-effort`} value={effortValue} disabled={disabled || Boolean(library.error)} onChange={(event) => selection && void onSelect({ connectionId: selection.connectionId, model: selection.model, reasoningEffort: event.target.value || undefined })}>
      <option value="">默认（不指定）</option>
      {[...new Set([...apiEfforts(selectedProfile.protocol), ...(effortValue ? [effortValue] : [])])].map((value) => <option key={value} value={value}>{effortLabel(value)}</option>)}
    </select></label>}
    {selection?.connectionId === "chatgpt" && chatgptModel && <label className="effort-picker" htmlFor={`${fieldId}-effort`}>推理档位<select id={`${fieldId}-effort`} value={effortValue} disabled={disabled} onChange={(event) => void onSelect({ connectionId: "chatgpt", model: chatgptModel.model, reasoningEffort: event.target.value || undefined })}>
      <option value="">默认{chatgptModel.defaultReasoningEffort ? `（${effortLabel(chatgptModel.defaultReasoningEffort)}）` : "（服务商决定）"}</option>
      {chatgptModel.supportedReasoningEfforts.map((item) => <option key={item.reasoningEffort} value={item.reasoningEffort} title={item.description}>{effortLabel(item.reasoningEffort)}</option>)}
    </select></label>}
    <small>{role === "vision" ? "执行 Agent 提出原贴纸位置，主管看原图、补帧或放大后修正，再检查真实渲染样片。关闭覆盖时保留原贴纸，只补空缺角落和时段。" : "可选择 API 或 ChatGPT 登录；三个角色可共用同一连接和模型。主管使用独立上下文，每个识别窗口最多检查3轮；样片最多检查5轮、修正2次，仍未通过就停止，不自动切换模型。"}</small>
    {!selection && <p role="status">未配置{label}时，自动覆盖和关闭覆盖时的 Agent 自动补角无法开始；手动设置且不使用自动覆盖时不受影响。</p>}
    {library.error && <p role="alert">{library.error}</p>}
    {selection?.connectionId === "chatgpt" && !chatgptReady && <p role="alert">ChatGPT {label}连接尚未就绪，请先完成登录并刷新状态。</p>}
    {selection && !connection?.configured && <p role="alert">{label}未就绪，请检查连接状态并重新选择可用模型。</p>}
  </div>;
}
