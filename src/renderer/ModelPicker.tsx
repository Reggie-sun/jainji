import { useEffect, useId, useState } from "react";
import type { ChatGPTStatus, ConnectionStatus } from "../shared/agent";
import type { ConnectionLibrary, SelectModel } from "../shared/connections";

export function ModelPicker({ connection, chatgpt, library, disabled, onSelect }: {
  connection: ConnectionStatus; chatgpt?: ChatGPTStatus; library: ConnectionLibrary; disabled: boolean;
  onSelect(input: SelectModel): Promise<boolean>;
}) {
  const id = useId();
  const [model, setModel] = useState(connection.model);
  useEffect(() => { setModel(connection.model); }, [connection.model, library.selected]);
  const selected = library.selected;
  const isChatGPT = selected === "chatgpt";
  if (!selected || (isChatGPT && chatgpt?.status !== "ready")) return null;
  const candidates = [...new Set(library.profiles.filter((profile) => profile.baseUrl.replace(/\/+$/, "") === connection.baseUrl && profile.protocol === (connection.protocol ?? "chat-completions")).map((profile) => profile.model))];
  return <div className="card brief-card model-picker">
    <label htmlFor={id}>创作模型 <span>{isChatGPT ? "ChatGPT" : connection.providerName || "API"}</span></label>
    {isChatGPT ? <select id={id} value={chatgpt?.model ?? ""} disabled={disabled} onChange={(event) => void onSelect({ connectionId: selected, model: event.target.value })}>
      <option value="" disabled>请选择视觉模型</option>
      {chatgpt?.models?.map((item) => <option key={item.model} value={item.model}>{item.displayName === item.model ? item.model : `${item.displayName} · ${item.model}`}</option>)}
    </select> : <form onSubmit={(event) => { event.preventDefault(); void onSelect({ connectionId: selected, model: model.trim() }); }}>
      <input id={id} list={`${id}-models`} required maxLength={200} value={model} disabled={disabled} onChange={(event) => setModel(event.target.value)} placeholder="输入支持图片的模型 ID" />
      <datalist id={`${id}-models`}>{candidates.map((candidate) => <option key={candidate} value={candidate} />)}</datalist>
      <button type="submit" className="button secondary" disabled={disabled || !model.trim() || model.trim() === connection.model}>应用模型</button>
    </form>}
    <small>当前模型：{connection.model || "尚未选择"}。用于提示词生成和视频分析，切换后自动保存。</small>
    {!isChatGPT && <small>输入服务商支持的视觉模型 ID，或从已保存的同服务商模型中选择，然后点击“应用模型”。无需重填 API Key。</small>}
    {isChatGPT && chatgpt?.message && <p role="alert">{chatgpt.message}</p>}
  </div>;
}
