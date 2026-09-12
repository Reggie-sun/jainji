import { useState, type FormEvent } from "react";
import type { ConnectionInput, ConnectionStatus } from "../shared/agent";
import { Heading, Icon } from "./ui";

export function ConnectionPanel({ connection, busy, onSave, onTest, onDisconnect, onContinue }: {
  connection: ConnectionStatus; busy: boolean;
  onSave(input: ConnectionInput): Promise<boolean>;
  onTest(): void; onDisconnect(): void; onContinue(): void;
}) {
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl);
  const [model, setModel] = useState(connection.model);
  const [apiKey, setApiKey] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSave({ baseUrl, model, apiKey })) { setApiKey(""); onContinue(); }
  };
  return <>
    <Heading eyebrow="LET’S GET CONNECTED" title="接入你的创作搭档">连接模型，剩下的灵感和细节，交给 Agent。</Heading>
    <div className="connection-layout">
      <div className="connection-story">
        <span className="small-tag"><Icon name="spark" size={15} /> AI PACKAGING STUDIO</span>
        <h2>给它素材，<br />让好内容<span>自然发生。</span></h2>
        <p>不必逐个调图层，也不必反复写提示词。<br />选择一种风格，每条素材都有自己的表达。</p>
        <div className="creative-scene" aria-hidden="true"><div className="scene-orbit" /><div className="scene-frame rear"><span>YOUR FOOTAGE</span><div className="scene-product" /></div><div className="scene-frame front"><span className="scene-label">日常 · 刚刚好</span><div className="scene-product" /><span className="scene-caption">一点生活的温度</span><small>AGENT EDIT</small></div><div className="scene-spark"><Icon name="spark" size={24} /></div><span className="scene-note">原始素材 → 独立包装</span></div>
        <div className="story-features"><span><Icon name="check" size={16} /> 规则约束</span><span><Icon name="check" size={16} /> 逐条创作</span><span><Icon name="check" size={16} /> 本地出片</span></div>
      </div>
      <form className="connection-form card" onSubmit={(event) => void submit(event)}>
        <div className="form-title"><div className="icon-tile"><Icon name="key" /></div><div><h2>模型连接</h2><p>支持视觉输入的 OpenAI-compatible API</p></div></div>
        {connection.configured && <div className="inline-success"><Icon name="check" size={16} /> 已保存配置 · {connection.model}</div>}
        <label>API 地址<input type="url" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" disabled={busy} spellCheck={false} autoComplete="off" /><small>填写 Base URL，通常以 /v1 结尾。</small></label>
        <label>模型名称<input required value={model} onChange={(event) => setModel(event.target.value)} placeholder="填写服务商提供的视觉模型 ID" disabled={busy} spellCheck={false} autoComplete="off" /><small>需要支持图片输入和 Chat Completions。</small></label>
        <label>API Key<input type="password" required value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={connection.configured ? "输入新的 Key 以更新连接" : "粘贴你的 API Key"} disabled={busy} autoComplete="off" spellCheck={false} /><small>仅用于本次运行，关闭应用后自动清除。</small></label>
        <div className="privacy-note"><Icon name="shield" size={18} /><p>Agent 会将每条视频的 3 张抽帧和补充要求发送到你配置的服务。原始视频留在本地，模型费用由服务商收取。</p></div>
        <button className="button primary wide" disabled={busy || !apiKey.trim() || !model.trim()} type="submit">{busy ? "正在处理…" : connection.configured ? "更新连接并继续" : "保存连接，开始创作"}<Icon name="arrow" size={18} /></button>
        {connection.configured && <div className="connection-actions"><button type="button" className="text-button" disabled={busy} onClick={onTest}>测试连接（一次请求）</button><button type="button" className="text-button" disabled={busy} onClick={onContinue}>使用已保存配置</button><button type="button" className="text-button muted" disabled={busy} onClick={onDisconnect}>断开</button></div>}
      </form>
    </div>
    <div className="platform-note">为本地创作而生 <span>Windows</span><span>Linux</span><span>MP4 / H.264</span></div>
  </>;
}
