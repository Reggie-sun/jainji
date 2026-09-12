import { useEffect, useState, type FormEvent } from "react";
import type { ConnectionInput, ConnectionStatus, ChatGPTStatus } from "../shared/agent";
import type { CCSwitchProvider } from "../main/cc-switch";
import { Heading, Icon } from "./ui";

export function ConnectionPanel({ connection, chatgpt, busy, onSave, onTest, onDisconnect, onContinue, onLogin, onCancelLogin, onUseCCSwitch }: {
  connection: ConnectionStatus; busy: boolean;
  chatgpt?: ChatGPTStatus;
  onSave(input: ConnectionInput): Promise<boolean>;
  onTest(): void; onDisconnect(): void; onContinue(): void;
  onLogin(): void; onCancelLogin(): void;
  onUseCCSwitch(id: string, appType: "claude" | "codex"): Promise<boolean>;
}) {
  const [mode, setMode] = useState(connection.source === "cc-switch" ? "cc-switch" : connection.configured && connection.source !== "chatgpt" ? "manual" : "chatgpt");
  const [providers, setProviders] = useState<CCSwitchProvider[]>([]);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const loginPending = chatgpt?.status === "logging-in" || chatgpt?.status === "starting";
  const locked = busy || loginPending;
  useEffect(() => {
    if (mode !== "cc-switch") return;
    let active = true;
    setReading(true); setReadError("");
    void window.jianji.listCCSwitch().then((items) => { if (active) setProviders(items); }).catch(() => {
      if (active) { setProviders([]); setReadError("无法读取当前配置。请确认用户目录下存在 .cc-switch；若 CC Switch 正在写入，请关闭后刷新。"); }
    }).finally(() => { if (active) setReading(false); });
    return () => { active = false; };
  }, [mode, refresh]);
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
      <div className="connection-form card">
        <div className="form-title"><div className="icon-tile"><Icon name="key" /></div><div><h2>模型连接</h2><p>登录账号，或复用已有的 API 配置</p></div></div>
        <div className="connection-tabs" role="tablist" aria-label="连接方式">
          {[["chatgpt", "ChatGPT 登录"], ["cc-switch", "CC Switch"], ["manual", "手动 API"]].map(([id, label]) => <button key={id} role="tab" aria-selected={mode === id} disabled={locked} className={mode === id ? "active" : ""} onClick={() => setMode(id)}>{label}</button>)}
        </div>
        {connection.configured && <div className="inline-success"><Icon name="check" size={16} /> 已保存配置 · {connection.model}</div>}
        {mode === "chatgpt" && <div className="auth-choice">
          <h3>使用你的 ChatGPT 账号</h3><p>在系统浏览器登录，完成授权后回到简辑。使用账号的 Codex 权益和额度。</p>
          {chatgpt?.status === "ready" && <div className="inline-success">{chatgpt.email || "已登录"} · {chatgpt.plan} · {chatgpt.model}</div>}
          {chatgpt?.message && <p role="alert">{chatgpt.message}</p>}
          {loginPending ? <><p role="status">请在浏览器中完成登录，简辑会自动接收结果。</p><button className="button secondary wide" disabled={busy} onClick={onCancelLogin}>取消登录</button></> : <button className="button primary wide" disabled={busy} onClick={connection.source === "chatgpt" ? onContinue : onLogin}>{connection.source === "chatgpt" ? "开始创作" : chatgpt?.status === "ready" ? "使用此 ChatGPT 账号" : "使用 ChatGPT 登录"}<Icon name="arrow" size={18} /></button>}
          <small>登录状态由官方 Codex 运行时保存在简辑本机目录，可通过“断开”退出当前账号。</small>
        </div>}
        {mode === "cc-switch" && <div className="auth-choice">
          <h3>复用 CC Switch 当前配置</h3><p>读取当前用户 .cc-switch 中选中的服务商，自动带入模型、地址和认证。</p>
          {reading && <p role="status">正在读取…</p>}{readError && <p role="alert">{readError}</p>}
          {!reading && !readError && providers.length === 0 && <p>没有找到当前选中的 API 配置。</p>}
          {providers.map((provider) => <div className="provider-choice" key={provider.appType + provider.id}><strong>{provider.name}<small>{provider.appType} · {provider.model || "账号配置"}</small></strong>{provider.available ? <><small>{provider.baseUrl}</small><button className="button secondary wide" disabled={locked || reading} onClick={() => void onUseCCSwitch(provider.id, provider.appType).then((ok) => { if (ok) onContinue(); })}>使用此配置</button></> : <small>{provider.reason}</small>}</div>)}
          <button className="text-button" disabled={locked || reading} onClick={() => setRefresh((value) => value + 1)}>刷新当前配置</button>
          <small>连接后使用本次读取的配置；在 CC Switch 切换后，请刷新并重新选择。密钥不会显示或写回 CC Switch。</small>
        </div>}
        {mode === "manual" && <form className="manual-connection" onSubmit={(event) => void submit(event)}>
        <label>API 地址<input type="url" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" disabled={busy} spellCheck={false} autoComplete="off" /><small>填写 Base URL，通常以 /v1 结尾。</small></label>
        <label>模型名称<input required value={model} onChange={(event) => setModel(event.target.value)} placeholder="填写服务商提供的视觉模型 ID" disabled={busy} spellCheck={false} autoComplete="off" /><small>需要支持图片输入和 Chat Completions。</small></label>
        <label>API Key<input type="password" required value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={connection.configured ? "输入新的 Key 以更新连接" : "粘贴你的 API Key"} disabled={busy} autoComplete="off" spellCheck={false} /><small>仅用于本次运行，关闭应用后自动清除。</small></label>
        <div className="privacy-note"><Icon name="shield" size={18} /><p>Agent 会将每条视频的 3 张抽帧和补充要求发送到你配置的服务。原始视频留在本地，模型费用由服务商收取。</p></div>
        <button className="button primary wide" disabled={busy || !apiKey.trim() || !model.trim()} type="submit">{busy ? "正在处理…" : connection.configured ? "更新连接并继续" : "保存连接，开始创作"}<Icon name="arrow" size={18} /></button>
        </form>}
        {mode !== "manual" && <div className="privacy-note"><Icon name="shield" size={18} /><p>每条视频的 3 张抽帧和补充要求会发送给所选模型。原始视频留在本地。</p></div>}
        {connection.configured && <div className="connection-actions"><button type="button" className="text-button" disabled={busy} onClick={onTest}>测试连接（一次请求）</button><button type="button" className="text-button" disabled={busy} onClick={onContinue}>使用已保存配置</button><button type="button" className="text-button muted" disabled={busy} onClick={onDisconnect}>断开</button></div>}
      </div>
    </div>
    <div className="platform-note">为本地创作而生 <span>Windows</span><span>Linux</span><span>MP4 / H.264</span></div>
  </>;
}
