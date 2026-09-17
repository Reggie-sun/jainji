import type { ChatGPTStatus, ConnectionStatus } from "../shared/agent";
import type { ConnectionLibrary, SelectModel } from "../shared/connections";
import { ModelPicker } from "./ModelPicker";

export function VisionConnectionPanel({ connection, chatgpt, library, disabled, onSelect }: {
  connection?: ConnectionStatus; chatgpt?: ChatGPTStatus; library: ConnectionLibrary; disabled: boolean;
  onSelect(input: SelectModel | null): Promise<boolean>;
}) {
  const selection = library.vision;
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
    <label htmlFor="vision-connection">视觉识别模型 <span>原贴纸识别与补角</span></label>
    <select id="vision-connection" value={selection?.connectionId ?? ""} disabled={disabled || Boolean(library.error)} onChange={(event) => void selectConnection(event.target.value)}>
      <option value="">不配置视觉识别模型</option>
      <option value="chatgpt" disabled={!chatgptReady}>ChatGPT 登录{chatgptReady ? "" : "（尚未就绪）"}</option>
      {library.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
    </select>
    <small>自动覆盖，以及关闭覆盖时的“全部交给 Agent”，都会发送抽帧识别原贴纸。关闭覆盖时仅用于判断哪些角落和时段需要补贴纸，不替换原贴纸；选款和样式仍由创作 Agent 负责。</small>
    {library.error && <p role="alert">{library.error}</p>}
    {selection?.connectionId === "chatgpt" && !chatgptReady && <p role="alert">ChatGPT 视觉识别连接尚未就绪，请先完成登录并刷新状态。</p>}
    {selection && !connection?.configured && <p role="alert">视觉识别模型未就绪，请检查连接状态并重新选择可用模型。</p>}
    {!selection && <p role="status">未配置视觉识别模型时，自动覆盖和关闭覆盖时的 Agent 自动补角无法开始；手动设置且不使用自动覆盖时不受影响。</p>}
    </div>
    {pickerConnection && <ModelPicker connection={pickerConnection} chatgpt={chatgpt ? { ...chatgpt, message: undefined } : undefined} library={pickerLibrary} disabled={disabled || Boolean(library.error)} title="视觉识别模型" description="当前视觉识别模型" onSelect={onSelect} />}
  </>;
}
