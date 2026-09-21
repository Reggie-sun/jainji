import { useState } from "react";
import type { ConnectionStatus, ChatGPTStatus } from "../shared/agent";
import type { ConnectionLibrary, SaveConnection } from "../shared/connections";
import { SavedConnectionsPanel } from "./SavedConnectionsPanel";
import { Heading, Icon } from "./ui";

export function ConnectionPanel({ connection, chatgpt, library, busy, onSave, onSelect, onRemove, onTest, onDisconnect, onContinue, onLogin, onRefreshLogin, onCancelLogin, onImport }: {
  connection: ConnectionStatus; busy: boolean; chatgpt?: ChatGPTStatus; library: ConnectionLibrary;
  onSave(input: SaveConnection): Promise<boolean>;
  onSelect(id: string): Promise<boolean>; onRemove(id: string): Promise<boolean>;
  onTest(): void; onDisconnect(): void; onContinue(): void; onLogin(): void; onRefreshLogin(): void; onCancelLogin(): void;
  onImport(id: string, appType: "claude" | "codex"): Promise<boolean>;
}) {
  const [mode, setMode] = useState(connection.source === "chatgpt" || library.selected === "chatgpt" ? "chatgpt" : "api");
  const loginPending = chatgpt?.status === "logging-in" || chatgpt?.status === "starting";
  const locked = busy || loginPending;
  return <>
    <Heading title="连接模型">登录 ChatGPT 账号，或添加 API 连接。模型与推理档位之后可在左侧「模型」中随时调整。</Heading>
    <div className="connection-layout">
      <div className="connection-form card">
        <div className="form-title"><div className="icon-tile"><Icon name="key" /></div><div><h2>模型连接</h2><p>登录账号，或复用已有的 API 配置</p></div></div>
        <div className="connection-tabs" role="tablist" aria-label="连接方式">
          {[["chatgpt", "ChatGPT 登录"], ["api", "API 连接管理"]].map(([id, label]) => <button key={id} role="tab" aria-selected={mode === id} disabled={locked} className={mode === id ? "active" : ""} onClick={() => setMode(id)}>{label}</button>)}
        </div>
        {connection.configured && <div className="inline-success"><Icon name="check" size={16} /> 已保存配置 · {connection.model}</div>}
        {mode === "chatgpt" && <div className="auth-choice">
          <h3>使用你的 ChatGPT 账号</h3><p>在系统浏览器登录，完成授权后回到简辑。使用账号的 Codex 权益和额度。</p>
          {chatgpt?.status === "ready" && <div className="inline-success">{chatgpt.email || "已登录"} · {chatgpt.plan} · {chatgpt.model}</div>}
          {chatgpt?.message && <p role="alert">{chatgpt.message}</p>}
          <button className="text-button" disabled={busy} onClick={onRefreshLogin}>已完成授权？刷新登录状态</button>
          {loginPending ? <><p role="status">请在浏览器中完成登录，简辑会自动接收结果。</p><button className="button secondary wide" disabled={busy} onClick={onCancelLogin}>取消登录</button></> : <button className="button primary wide" disabled={busy} onClick={connection.source === "chatgpt" ? onContinue : onLogin}>{connection.source === "chatgpt" ? "开始创作" : chatgpt?.status === "ready" ? "使用此 ChatGPT 账号" : "使用 ChatGPT 登录"}<Icon name="arrow" size={18} /></button>}
          <small>登录状态由官方 Codex 运行时保存在简辑本机目录，可通过“断开”退出当前账号。</small>
        </div>}
        {mode === "api" && <SavedConnectionsPanel library={library} locked={locked} onSave={onSave} onSelect={onSelect} onRemove={onRemove} onImport={onImport} />}
        <div className="privacy-note"><Icon name="shield" size={18} /><p>创作抽帧和补充要求发送给创作模型；自动覆盖开启时，识别抽帧发送给独立配置的视觉模型。原始视频留在本地。</p></div>
        {connection.configured && <div className="connection-actions"><button type="button" className="text-button" disabled={locked} onClick={onTest}>测试连接（一次请求）</button><button type="button" className="text-button" disabled={busy} onClick={onContinue}>使用已保存配置</button><button type="button" className="text-button muted" disabled={locked} onClick={onDisconnect}>断开</button></div>}
      </div>
    </div>
  </>;
}
