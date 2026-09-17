import type { ChatGPTStatus, ConnectionStatus } from "../shared/agent";
import type { ConnectionLibrary, SelectModel } from "../shared/connections";
import { ModelPicker } from "./ModelPicker";

export function VisionConnectionPanel({ connection, chatgpt, library, disabled, onSelect, role = "vision" }: {
  connection?: ConnectionStatus; chatgpt?: ChatGPTStatus; library: ConnectionLibrary; disabled: boolean;
  role?: "vision" | "reviewer";
  onSelect(input: SelectModel | null): Promise<boolean>;
}) {
  const selection = library[role];
  const label = role === "vision" ? "视觉识别模型" : "复核模型";
  const fieldId = `${role}-connection`;
  const selectedProfile = selection?.connectionId === "chatgpt" ? undefined : library.profiles.find((profile) => profile.id === selection?.connectionId);
  const chatgptReady = chatgpt?.status === "ready" && Boolean(chatgpt.models?.length);
  const pickerConnection = connection?.configured ? connection : selection ? {
    configured: true,
    baseUrl: selectedProfile?.baseUrl ?? "",
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
    source: selection.connectionId === "chatgpt" ? "chatgpt" as const : "api" as const,
    providerName: selectedProfile?.name,
    protocol: selectedProfile?.protocol,
  } : undefined;
  const pickerLibrary: ConnectionLibrary = {
    ...library,
    selected: selection?.connectionId ?? null,
    chatgptModel: selection?.connectionId === "chatgpt" ? selection.model : library.chatgptModel,
    chatgptReasoningEffort: selection?.connectionId === "chatgpt" ? selection.reasoningEffort : library.chatgptReasoningEffort,
  };
  const selectConnection = async (id: string) => {
    if (!id) return onSelect(null);
    if (id === "chatgpt") {
      if (!chatgptReady) return false;
      const initial = chatgpt?.models?.find((item) => item.model === chatgpt.model) ?? chatgpt?.models?.[0];
      if (!initial) return false;
      return onSelect({ connectionId: "chatgpt", model: initial.model });
    }
    const profile = library.profiles.find((item) => item.id === id);
    return profile ? onSelect({ connectionId: profile.id, model: profile.model, reasoningEffort: profile.reasoningEffort }) : false;
  };

  return <>
    <div className="card brief-card model-picker">
    <label htmlFor={fieldId}>{label} <span>{role === "vision" ? "执行 Agent · 原贴纸识别" : "主管 Agent · 修正与样片检查"}</span></label>
    <select id={fieldId} value={selection?.connectionId ?? ""} disabled={disabled || Boolean(library.error)} onChange={(event) => void selectConnection(event.target.value)}>
      <option value="">不配置{label}</option>
      <option value="chatgpt" disabled={!chatgptReady}>ChatGPT 登录{chatgptReady ? "" : "（尚未就绪）"}</option>
      {library.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
    </select>
    <small>{role === "vision" ? "执行 Agent 提出原贴纸位置，主管看原图、补帧或放大后修正，再检查真实渲染样片。关闭覆盖时保留原贴纸，只补空缺角落和时段。" : "可选择 API 或 ChatGPT 登录；三个角色可共用同一连接和模型。主管使用独立上下文，每个识别窗口最多检查3轮；样片最多检查5轮、修正2次，仍未通过就停止，不自动切换模型。"}</small>
    {library.error && <p role="alert">{library.error}</p>}
    {selection?.connectionId === "chatgpt" && !chatgptReady && <p role="alert">ChatGPT {label}连接尚未就绪，请先完成登录并刷新状态。</p>}
    {selection && !connection?.configured && <p role="alert">{label}未就绪，请检查连接状态并重新选择可用模型。</p>}
    {!selection && <p role="status">未配置{label}时，自动覆盖和关闭覆盖时的 Agent 自动补角无法开始；手动设置且不使用自动覆盖时不受影响。</p>}
    </div>
    {pickerConnection && <ModelPicker connection={pickerConnection} chatgpt={chatgpt ? { ...chatgpt, message: undefined } : undefined} library={pickerLibrary} disabled={disabled || Boolean(library.error)} title={label} description={`当前${label}`} onSelect={onSelect} />}
  </>;
}
