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
    <label htmlFor={fieldId}>{label} <span>{role === "vision" ? "原贴纸识别与补角" : "独立复核与争议复查"}</span></label>
    <select id={fieldId} value={selection?.connectionId ?? ""} disabled={disabled || Boolean(library.error)} onChange={(event) => void selectConnection(event.target.value)}>
      <option value="">不配置{label}</option>
      <option value="chatgpt" disabled={!chatgptReady}>ChatGPT 登录{chatgptReady ? "" : "（尚未就绪）"}</option>
      {library.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
    </select>
    <small>{role === "vision" ? "自动覆盖，以及关闭覆盖时的“全部交给 Agent”，均由识别与复核 Agent 独立查看原始帧；分歧时双方最多复查一次，仍不一致就停止。关闭覆盖时只补空缺角落和时段。" : "可选择 API 或 ChatGPT 登录；三个 Agent 可以共用同一连接、同一模型，只需保存一次 API Key。每个角色的模型选择分别保存，复核使用独立上下文；争议复查不自动切换模型。"}</small>
    {library.error && <p role="alert">{library.error}</p>}
    {selection?.connectionId === "chatgpt" && !chatgptReady && <p role="alert">ChatGPT {label}连接尚未就绪，请先完成登录并刷新状态。</p>}
    {selection && !connection?.configured && <p role="alert">{label}未就绪，请检查连接状态并重新选择可用模型。</p>}
    {!selection && <p role="status">未配置{label}时，自动覆盖和关闭覆盖时的 Agent 自动补角无法开始；手动设置且不使用自动覆盖时不受影响。</p>}
    </div>
    {pickerConnection && <ModelPicker connection={pickerConnection} chatgpt={chatgpt ? { ...chatgpt, message: undefined } : undefined} library={pickerLibrary} disabled={disabled || Boolean(library.error)} title={label} description={`当前${label}`} onSelect={onSelect} />}
  </>;
}
