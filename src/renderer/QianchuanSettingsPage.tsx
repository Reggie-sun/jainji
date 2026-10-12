import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { DesktopState } from "../shared/desktop";
import type { DouyinUploadStatus, QianchuanUploadResult } from "../shared/douyin-upload";
import { QianchuanAccountSettings } from "./QianchuanAccountSettings";
import { qianchuanAccountName } from "../shared/qianchuan-account";
import { scrollWorkspace } from "./WorkspacePage";

export function QianchuanSettingsPage({ config, status, configKey: key, busy, planEdit, onConfig, onPerform, onFeedback }: {
  config: DouyinUploadStatus["config"]; status?: DouyinUploadStatus; configKey: string; busy: boolean;
  planEdit?: { task: QianchuanUploadResult; sequence: number };
  onConfig: Dispatch<SetStateAction<DouyinUploadStatus["config"]>>;
  onPerform(action: () => Promise<DesktopState>): Promise<boolean>;
  onFeedback(text: string): void;
}) {
  useEffect(() => { if (planEdit) scrollWorkspace({ selector: "#qianchuan-product-name" }); }, [planEdit?.sequence]);
  return <section className="card brief-card douyin-upload-panel" aria-label="千川账号与计划">
    <div className="card-header"><h2>账号与计划</h2><span>保存后供新制作使用</span></div>
    <div>
      <div className="qianchuan-upload-preferences"><div>
      <label><input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => onConfig(current => ({ ...current, enabled: event.target.checked }))} />启用千川上传</label>
      <small>制作时仍需选择“本次自动上传”的账号与计划；导出后每组最多 9 条自动上传。</small>
      </div><div className="douyin-upload-actions">
        <button className="button primary compact" type="button" disabled={busy} onClick={() => void onPerform(() => window.jianji.saveDouyinUploadConfig(config))}>保存上传设置</button>
        {JSON.stringify(config) !== key && <small role="status">有未保存的修改</small>}
      </div></div>
      <div><QianchuanAccountSettings key={planEdit?.sequence ?? 0} initialProduct={planEdit?.task.accountProduct} expectedAdvertiserId={planEdit?.task.advertiserId} accounts={status?.accounts} busy={busy} onSave={async input => {
        const done = await onPerform(() => window.jianji.saveQianchuanAccount(input));
        if (done && planEdit) onFeedback("新产品和计划已保存，新制作使用新计划；旧批次保留原目标。若这些成片适用于新产品，整批从未选文件时可点击“本批改传当前计划”，再“安全继续”。");
        return done;
      }} onOpenBrowser={input => onPerform(() => window.jianji.openQianchuanAccountBrowser(input))} onControlBrowser={input => onPerform(() => window.jianji.controlQianchuanAccountBrowser(input))} /></div>
      <details className="douyin-upload-advanced"><summary>高级设置</summary>
        <p>通常无需调整，遇到上传问题时再使用。</p>
        <div className="douyin-upload-actions">
          <button className="button secondary compact" type="button" disabled={busy} onClick={() => void onPerform(() => window.jianji.selectQianchuanAccountConfig())}>导入已有账号配置</button>
          <button className="button secondary compact" type="button" disabled={busy || !status?.configSelected} onClick={() => void onPerform(() => window.jianji.refreshQianchuanAccounts())}>刷新账号摘要</button>
        </div>
        {status?.accounts.map(account => <p key={account.product}>{qianchuanAccountName(account)} · {account.available ? `账户 ${account.advertiserId} / 计划 ${account.adId}` : "缺少可用配置"}</p>)}
        <fieldset disabled={busy}><legend>操作时限（毫秒）</legend>{(Object.keys(config.timeouts) as (keyof typeof config.timeouts)[]).map(field => <label key={field}>{({ connect: "连接", navigation: "页面加载", fileInput: "文件选择", processing: "平台处理", action: "页面操作", confirmation: "只读核查" })[field]}<input type="number" min={1} value={config.timeouts[field]} onChange={event => onConfig(current => ({ ...current, timeouts: { ...current.timeouts, [field]: event.target.valueAsNumber } }))} /></label>)}</fieldset>
        <label><input type="checkbox" checked={config.captureFailureDiagnostics} disabled={busy} onChange={event => onConfig(current => ({ ...current, captureFailureDiagnostics: event.target.checked }))} />保存有限本机诊断</label>
      </details>
    </div>
  </section>;
}
