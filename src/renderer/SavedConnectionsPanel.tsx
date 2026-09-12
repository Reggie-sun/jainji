import { useState, type FormEvent } from "react";
import type { ConnectionLibrary, SavedConnection, SaveConnection } from "../shared/connections";
import type { CCSwitchProvider } from "../main/cc-switch";

export function SavedConnectionsPanel({ library, locked, onSave, onSelect, onRemove, onImport }: {
  library: ConnectionLibrary; locked: boolean;
  onSave(input: SaveConnection): Promise<boolean>;
  onSelect(id: string): Promise<boolean>;
  onRemove(id: string): Promise<boolean>;
  onImport(id: string, appType: "claude" | "codex"): Promise<boolean>;
}) {
  const [editing, setEditing] = useState<SavedConnection | "new">();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [protocol, setProtocol] = useState<SavedConnection["protocol"]>("chat-completions");
  const [authHeader, setAuthHeader] = useState<SavedConnection["authHeader"]>("bearer");
  const [providers, setProviders] = useState<CCSwitchProvider[]>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string>();
  const edit = (profile: SavedConnection | "new") => {
    setEditing(profile); setKey("");
    setName(profile === "new" ? "" : profile.name);
    setBaseUrl(profile === "new" ? "https://api.openai.com/v1" : profile.baseUrl);
    setModel(profile === "new" ? "" : profile.model);
    setProtocol(profile === "new" ? "chat-completions" : profile.protocol);
    setAuthHeader(profile === "new" ? "bearer" : profile.authHeader);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSave({ ...(editing && editing !== "new" ? { id: editing.id } : {}), name, baseUrl, model, protocol, authHeader, ...(key.trim() ? { apiKey: key } : {}) })) { setEditing(undefined); setKey(""); }
  };
  const readImport = async () => {
    setReading(true); setError("");
    try { setProviders(await window.jianji.listCCSwitch()); }
    catch { setError("无法读取 .cc-switch 当前配置，请检查目录；若正在写入，请关闭 CC Switch 后重试。"); }
    finally { setReading(false); }
  };
  return <div className="auth-choice">
    <h3>我的 API 连接</h3><p>在简辑内保存和切换服务商，重启后自动恢复上次使用的连接。</p>
    {library.error && <p role="alert">{library.error}</p>}
    {library.profiles.length === 0 && <p>还没有保存的连接，添加一个即可开始。</p>}
    {library.profiles.map((profile) => <div className="provider-choice" key={profile.id}>
      <strong>{profile.name}{library.selected === profile.id && <small>当前使用</small>}</strong>
      <small>{profile.model} · {profile.protocol}<br />{profile.baseUrl}</small>
      <div className="connection-actions">
        <button className="text-button" disabled={locked} onClick={() => void onSelect(profile.id)}>使用此连接</button>
        <button className="text-button" disabled={locked} onClick={() => edit(profile)}>编辑</button>
        <button className="text-button muted" disabled={locked} onClick={() => setDeleting(profile.id)}>删除</button>
      </div>
      {deleting === profile.id && <div role="alert"><p>删除“{profile.name}”？{library.selected === profile.id ? "当前连接也会断开。" : ""}</p><button className="text-button" disabled={locked} onClick={() => void onRemove(profile.id).then((ok) => { if (ok) { setDeleting(undefined); if (editing !== "new" && editing?.id === profile.id) { setEditing(undefined); setKey(""); } } })}>确认删除</button><button className="text-button" disabled={locked} onClick={() => setDeleting(undefined)}>取消</button></div>}
    </div>)}
    <button className="button secondary wide" disabled={locked || Boolean(library.error)} onClick={() => edit("new")}>添加 API 连接</button>
    {editing && <form className="manual-connection" onSubmit={(event) => void save(event)}>
      <h3>{editing === "new" ? "添加连接" : "编辑连接"}</h3>
      <label>连接名称<input required value={name} maxLength={80} disabled={locked} onChange={(e) => setName(e.target.value)} placeholder="例如：我的 MiniMax" /></label>
      <label>API 地址<input type="url" required value={baseUrl} disabled={locked} onChange={(e) => setBaseUrl(e.target.value)} autoComplete="off" /></label>
      <label>模型名称<input required value={model} disabled={locked} onChange={(e) => setModel(e.target.value)} placeholder="支持图片的模型 ID" /></label>
      <label>API 协议<select value={protocol} disabled={locked} onChange={(e) => { const value = e.target.value as SavedConnection["protocol"]; setProtocol(value); setAuthHeader(value === "anthropic" ? "x-api-key" : "bearer"); }}><option value="chat-completions">OpenAI Chat Completions</option><option value="responses">OpenAI Responses</option><option value="anthropic">Anthropic Messages</option></select></label>
      {protocol === "anthropic" && <label>认证方式<select value={authHeader} disabled={locked} onChange={(e) => setAuthHeader(e.target.value as SavedConnection["authHeader"])}><option value="x-api-key">x-api-key</option><option value="bearer">Bearer Token</option></select></label>}
      <label>API Key<input type="password" required={editing === "new"} value={key} disabled={locked} autoComplete="off" onChange={(e) => setKey(e.target.value)} placeholder={editing === "new" ? "填写 API Key" : "留空保留已有 Key"} /></label>
      <small>配置和 Key 保存在本机用户目录；Key 以明文文件保存，不进入项目或导出文件。请保护本机账号与备份。</small>
      <button className="button primary wide" disabled={locked} type="submit">保存连接</button><button className="text-button" type="button" disabled={locked} onClick={() => { setEditing(undefined); setKey(""); }}>取消编辑</button>
    </form>}
    <details><summary>导入已有 CC Switch 配置</summary><p>只需导入一次，此后在简辑内独立管理，无需运行 CC Switch。</p>
      <button className="text-button" disabled={locked || reading || Boolean(library.error)} onClick={() => void readImport()}>{reading ? "正在读取…" : "读取可导入配置"}</button>
      {error && <p role="alert">{error}</p>}{providers?.length === 0 && <p>没有找到可导入的当前配置。</p>}
      {providers?.map((provider) => <div className="provider-choice" key={provider.appType + provider.id}><strong>{provider.name}</strong><small>{provider.model} · {provider.baseUrl}</small>{provider.available ? <button className="text-button" disabled={locked} onClick={() => void onImport(provider.id, provider.appType)}>导入到简辑</button> : <small>{provider.reason}</small>}</div>)}
    </details>
  </div>;
}
