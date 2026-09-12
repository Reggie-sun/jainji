import { useEffect, useId, useState } from "react";
import type { ChatGPTStatus, ConnectionStatus } from "../shared/agent";
import type { ConnectionLibrary, SelectModel } from "../shared/connections";

export function ModelPicker({ connection, chatgpt, library, disabled, onSelect }: {
  connection: ConnectionStatus; chatgpt?: ChatGPTStatus; library: ConnectionLibrary; disabled: boolean;
  onSelect(input: SelectModel): Promise<boolean>;
}) {
  const id = useId();
  const [model, setModel] = useState(connection.model);
  const [effort, setEffort] = useState(connection.reasoningEffort ?? "");
  useEffect(() => { setModel(connection.model); setEffort(connection.reasoningEffort ?? ""); }, [connection.model, connection.reasoningEffort, library.selected]);
  const selected = library.selected;
  const isChatGPT = selected === "chatgpt";
  if (!selected || (isChatGPT && chatgpt?.status !== "ready")) return null;
  const candidates = [...new Set(library.profiles.filter((profile) => profile.baseUrl.replace(/\/+$/, "") === connection.baseUrl && profile.protocol === (connection.protocol ?? "chat-completions")).map((profile) => profile.model))];
  const selectedModel = chatgpt?.models?.find((item) => item.model === chatgpt.model);
  const apiEfforts = connection.protocol === "anthropic" ? ["low", "medium", "high", "xhigh", "max"] : ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const labels: Record<string, string> = { none: "不推理", minimal: "最少", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高", ultra: "极高" };
  const effortLabel = (value: string) => labels[value] ? `${labels[value]} · ${value}` : value;
  return <div className="card brief-card model-picker">
    <label htmlFor={id}>创作模型 <span>{isChatGPT ? "ChatGPT" : connection.providerName || "API"}</span></label>
    {isChatGPT ? <><select id={id} value={chatgpt?.model ?? ""} disabled={disabled} onChange={(event) => void onSelect({ connectionId: selected, model: event.target.value })}>
      <option value="" disabled>请选择视觉模型</option>
      {chatgpt?.models?.map((item) => <option key={item.model} value={item.model}>{item.displayName === item.model ? item.model : `${item.displayName} · ${item.model}`}</option>)}
    </select>
      <label className="effort-picker" htmlFor={`${id}-effort`}>推理档位<select id={`${id}-effort`} value={library.chatgptReasoningEffort ?? ""} disabled={disabled || !selectedModel} onChange={(event) => void onSelect({ connectionId: selected, model: selectedModel!.model, reasoningEffort: event.target.value || undefined })}>
        <option value="">默认{selectedModel?.defaultReasoningEffort ? `（${effortLabel(selectedModel.defaultReasoningEffort)}）` : "（服务商决定）"}</option>
        {selectedModel?.supportedReasoningEfforts.map((item) => <option key={item.reasoningEffort} value={item.reasoningEffort} title={item.description}>{effortLabel(item.reasoningEffort)}</option>)}
      </select></label>
    </> : <form onSubmit={(event) => { event.preventDefault(); void onSelect({ connectionId: selected, model: model.trim(), reasoningEffort: effort || undefined }); }}>
      <input id={id} list={`${id}-models`} required maxLength={200} value={model} disabled={disabled} onChange={(event) => { setModel(event.target.value); setEffort(""); }} placeholder="输入支持图片的模型 ID" />
      <datalist id={`${id}-models`}>{candidates.map((candidate) => <option key={candidate} value={candidate} />)}</datalist>
      <label className="effort-picker" htmlFor={`${id}-effort`}>推理档位<select id={`${id}-effort`} value={effort} disabled={disabled} onChange={(event) => setEffort(event.target.value)}>
        <option value="">默认（不指定）</option>
        {[...new Set([...apiEfforts, ...(effort ? [effort] : [])])].map((value) => <option key={value} value={value}>{effortLabel(value)}</option>)}
      </select></label>
      <button type="submit" className="button secondary" disabled={disabled || !model.trim() || (model.trim() === connection.model && effort === (connection.reasoningEffort ?? ""))}>应用模型</button>
    </form>}
    <small>当前模型：{connection.model || "尚未选择"} · 推理档位：{connection.reasoningEffort ? effortLabel(connection.reasoningEffort) : "服务商默认"}。用于提示词生成和视频分析，切换后自动保存。</small>
    {!isChatGPT && <small>输入服务商支持的视觉模型 ID，或从已保存的同服务商模型中选择，然后点击“应用模型”。无需重填 API Key。</small>}
    {!isChatGPT && <small>档位选项是协议提供的通用值，是否支持取决于具体模型与服务商；不支持时选择“默认”。</small>}
    {isChatGPT && chatgpt?.message && <p role="alert">{chatgpt.message}</p>}
  </div>;
}
