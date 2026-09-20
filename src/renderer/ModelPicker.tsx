import { useId } from "react";
import type { ChatGPTStatus, ConnectionStatus } from "../shared/agent";
import type { ConnectionLibrary, SelectModel } from "../shared/connections";

const EFFORT_LABELS: Record<string, string> = { none: "不推理", minimal: "最少", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高", ultra: "极高" };
const effortLabel = (value: string) => EFFORT_LABELS[value] ? `${EFFORT_LABELS[value]} · ${value}` : value;
const apiEfforts = (protocol?: string) => protocol === "anthropic" ? ["low", "medium", "high", "xhigh", "max"] : ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

export function ModelPicker({ connection, chatgpt, library, disabled, onSelect, title = "创作模型", description = "当前模型" }: {
  connection: ConnectionStatus; chatgpt?: ChatGPTStatus; library: ConnectionLibrary; disabled: boolean;
  onSelect(input: SelectModel): Promise<boolean>;
  title?: string; description?: string;
}) {
  const id = useId();
  const selected = library.selected;
  const isChatGPT = selected === "chatgpt";
  if (!selected || (isChatGPT && chatgpt?.status !== "ready")) return null;
  const selectedProfile = isChatGPT ? undefined : library.profiles.find((profile) => profile.id === selected);
  const selectedModel = chatgpt?.models?.find((item) => item.model === connection.model);
  return <div className="card brief-card model-picker">
    <label htmlFor={id}>{title} <span>{isChatGPT ? "ChatGPT" : connection.providerName || "API"}</span></label>
    {isChatGPT ? <><select id={id} value={connection.model} disabled={disabled} onChange={(event) => void onSelect({ connectionId: selected, model: event.target.value })}>
      <option value="" disabled>请选择视觉模型</option>
      {chatgpt?.models?.map((item) => <option key={item.model} value={item.model}>{item.displayName === item.model ? item.model : `${item.displayName} · ${item.model}`}</option>)}
    </select>
      <label className="effort-picker" htmlFor={`${id}-effort`}>推理档位<select id={`${id}-effort`} value={library.chatgptReasoningEffort ?? ""} disabled={disabled || !selectedModel} onChange={(event) => void onSelect({ connectionId: selected, model: selectedModel!.model, reasoningEffort: event.target.value || undefined })}>
        <option value="">默认{selectedModel?.defaultReasoningEffort ? `（${effortLabel(selectedModel.defaultReasoningEffort)}）` : "（服务商决定）"}</option>
        {selectedModel?.supportedReasoningEfforts.map((item) => <option key={item.reasoningEffort} value={item.reasoningEffort} title={item.description}>{effortLabel(item.reasoningEffort)}</option>)}
      </select></label>
    </> : <>
      <select id={id} value={selectedProfile ? selected : ""} disabled={disabled} onChange={(event) => {
        const profile = library.profiles.find((item) => item.id === event.target.value);
        if (profile) void onSelect({ connectionId: profile.id, model: profile.model });
      }}>
        {!selectedProfile && <option value="" disabled>请选择模型</option>}
        {library.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
      </select>
      <label className="effort-picker" htmlFor={`${id}-effort`}>推理档位<select id={`${id}-effort`} value={connection.reasoningEffort ?? ""} disabled={disabled || !selectedProfile} onChange={(event) => {
        if (selectedProfile) void onSelect({ connectionId: selectedProfile.id, model: selectedProfile.model, reasoningEffort: event.target.value || undefined });
      }}>
        <option value="">默认（不指定）</option>
        {[...new Set([...apiEfforts(selectedProfile?.protocol), ...(connection.reasoningEffort ? [connection.reasoningEffort] : [])])].map((value) => <option key={value} value={value}>{effortLabel(value)}</option>)}
      </select></label>
    </>}
    <small>{description}：{connection.model || "尚未选择"} · 推理档位：{connection.reasoningEffort ? effortLabel(connection.reasoningEffort) : "服务商默认"}。切换后自动保存。</small>
    {!isChatGPT && <small>从已保存的连接中选择模型；需要更多模型或自定义模型 ID 时，请在“管理连接”中添加或编辑。</small>}
    {!isChatGPT && <small>档位选项是协议提供的通用值，是否支持取决于具体模型与服务商；不支持时选择“默认”。</small>}
    {isChatGPT && chatgpt?.message && <p role="alert">{chatgpt.message}</p>}
  </div>;
}
