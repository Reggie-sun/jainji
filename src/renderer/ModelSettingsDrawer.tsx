import { useEffect } from "react";
import type { DesktopState } from "../shared/desktop";
import type { SelectModel } from "../shared/connections";
import { ModelPicker } from "./ModelPicker";
import { VisionConnectionPanel } from "./VisionConnectionPanel";
import { Icon } from "./ui";

export function ModelSettingsDrawer({ open, state, disabled, onClose, onManageConnections, onTest, onSelectModel, onSelectVision, onSelectReviewer }: {
  open: boolean;
  state: DesktopState;
  disabled: boolean;
  onClose(): void;
  onManageConnections(): void;
  onTest(): void;
  onSelectModel(input: SelectModel): Promise<boolean>;
  onSelectVision(input: SelectModel | null): Promise<boolean>;
  onSelectReviewer(input: SelectModel | null): Promise<boolean>;
}) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, open]);
  if (!open) return null;
  const library = state.connections ?? { profiles: [], selected: null };
  return <div className="model-drawer-layer">
    <button className="model-drawer-backdrop" type="button" aria-label="关闭模型与 API" onClick={onClose} />
    <aside className="model-drawer" role="dialog" aria-modal="true" aria-label="模型与 API">
      <header><div><span>SETTINGS</span><h2>模型与 API</h2><p>三个角色可使用不同连接，也可以共用同一连接。</p></div><button className="icon-button" type="button" aria-label="关闭模型与 API" onClick={onClose}><Icon name="close" /></button></header>
      <div className="model-connection-summary">
        <div><span className={state.connection.configured ? "connection-state ready" : "connection-state"}><i />{state.connection.configured ? "连接正常" : "尚未连接"}</span><strong>{state.connection.source === "chatgpt" ? "ChatGPT 登录" : state.connection.providerName || "API 连接"}</strong></div>
        <div><button className="button secondary compact" type="button" disabled={disabled || !state.connection.configured} onClick={onTest}>测试连接</button><button className="button secondary compact" type="button" disabled={disabled} onClick={onManageConnections}>管理连接</button></div>
      </div>
      <div className="model-drawer-scroll">
        <ModelPicker connection={state.connection} chatgpt={state.chatgpt} library={library} disabled={disabled} onSelect={onSelectModel} />
        <VisionConnectionPanel connection={state.visionConnection} chatgpt={state.chatgpt} library={library} disabled={disabled} onSelect={onSelectVision} />
        <VisionConnectionPanel role="reviewer" connection={state.reviewerConnection} chatgpt={state.chatgpt} library={library} disabled={disabled} onSelect={onSelectReviewer} />
      </div>
      <footer><Icon name="shield" size={17} /><p>API Key 只保存在本机；运行中的任务不会切换连接。</p></footer>
    </aside>
  </div>;
}
