import type { DesktopState } from "../shared/desktop";
import { qianchuanAccountName } from "../shared/qianchuan-account";
import type { QianchuanPage } from "./QianchuanWorkspace";
import { qianchuanUploaded } from "./qianchuan-upload-status";

export function QianchuanOverview({ state, onNavigate }: { state: DesktopState; onNavigate(page: QianchuanPage): void }) {
  const accounts = state.douyinUpload?.accounts ?? [];
  const tasks = state.douyinUpload?.tasks.filter(task => task.project_id === state.project.id && task.state !== "DISCARDED") ?? [];
  const unknown = tasks.filter(task => task.upload_outcome === "MAY_HAVE_UPLOADED").length;
  return <section className="qianchuan-console qc-overview" aria-label="千川本地概览">
    <div className="qc-overview-summary">
      <div><span>本地账户配置</span><strong>{accounts.length}</strong><small>已保存的上传目标</small></div>
      <div><span>已配置计划</span><strong>{accounts.filter(account => account.adId).length}</strong><small>登录与可用性需实时核验</small></div>
      <div><span>本项目上传</span><strong>{tasks.filter(qianchuanUploaded).length}<small> / {tasks.length}</small></strong><small>已上传 / 全部任务</small></div>
      <div><span>上传结果待核查</span><strong>{unknown}</strong><small>结果未知的任务不可重传</small></div>
    </div>
    <section className="qc-card">
      <div className="qc-section-heading"><div><h2>账户与保存计划</h2><p className="qc-help">本地配置概览，不代表平台实时投放状态</p></div><button type="button" className="button secondary" onClick={() => onNavigate("accounts")}>管理账号与计划</button></div>
      {accounts.length ? <div className="qianchuan-query-table"><table><thead><tr><th>账户</th><th>商品 / 本地名称</th><th>保存计划 ID</th><th>配置状态</th></tr></thead><tbody>{accounts.map(account => <tr key={account.product}><td>{qianchuanAccountName(account)}<br /><small>{account.advertiserId}</small></td><td>{account.productName || account.product}</td><td>{account.adId || "未设置"}</td><td>{account.available ? "已配置" : "需检查配置"}</td></tr>)}</tbody></table></div> : <p className="qc-help">还没有账户配置。先添加账号与计划，再安排上传或查询数据。</p>}
    </section>
    <div className="qc-overview-links"><button type="button" onClick={() => onNavigate("reports")}><strong>查询计划与数据 →</strong><span>预算、ROI、素材表现与历史报表</span></button><button type="button" onClick={() => onNavigate("uploads")}><strong>查看上传任务 →</strong><span>{unknown ? `${unknown} 条结果未知，请核查原页面` : state.douyinUpload?.message || "查看本项目的上传进度与记录"}</span></button></div>
  </section>;
}
