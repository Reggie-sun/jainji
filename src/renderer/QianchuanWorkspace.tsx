import type { DesktopState } from "../shared/desktop";
import type { QianchuanLibraryClear } from "../shared/qianchuan-video-library";
import { DouyinUploadPanel } from "./DouyinUploadPanel";
import { Heading } from "./ui";
import { BatchUploadDetails, type BatchUploadContext } from "./BatchUploadDetails";
import { WorkspacePage } from "./WorkspacePage";
import { QianchuanBackendPanel } from "./QianchuanBackendPanel";
export type QianchuanPage = "uploads" | "accounts" | "materials" | "reports";

export function QianchuanWorkspace({ state, page, onPage, onState, onAutomation, batchUpload, onBatchUpload, active }: {
  state: DesktopState; page: QianchuanPage; onPage(page: QianchuanPage): void; onState(state: DesktopState): void;
  onAutomation(cleanup: QianchuanLibraryClear): void;
  batchUpload?: BatchUploadContext; onBatchUpload(context?: BatchUploadContext): void; active: boolean;
}) {
  return <section className={page === "materials" ? "qianchuan-materials-page" : undefined}>
    <Heading title="千川">上传、账号配置与素材管理分别处理；历史任务保留原账号和计划。</Heading>
    <nav className="task-page-tabs" aria-label="千川页面">
      {([ ["uploads", "上传任务"], ["accounts", "账号与计划"], ["materials", "素材管理"], ["reports", "计划与数据"] ] as const).map(([id, label]) => <button key={id} type="button" aria-current={page === id ? "page" : undefined} onClick={() => onPage(id)}>{label}</button>)}
    </nav>
    {page === "uploads" && <div className="batch-upload-choices" role="group" aria-label="上传任务范围">
      <button type="button" className="button secondary compact" aria-pressed={!batchUpload} onClick={() => onBatchUpload()}>查看当前项目上传任务</button>
      {state.batchProduction?.jobs.filter(job => job.accountProduct).map(job => <button type="button" className="button secondary compact" key={job.id} aria-pressed={batchUpload?.jobId === job.id} onClick={() => onBatchUpload({ runId: state.batchProduction!.id, jobId: job.id, name: job.name })}>{job.name} · 本批上传</button>)}
    </div>}
    {batchUpload && <WorkspacePage active={page === "uploads"} label="本批上传任务"><BatchUploadDetails key={`${batchUpload.runId}:${batchUpload.jobId}`} request={batchUpload} active={active && page === "uploads"} /></WorkspacePage>}
    <DouyinUploadPanel key={state.project.id} projectId={state.project.id} status={state.douyinUpload} page={page} showProjectUploads={!batchUpload} onPage={onPage} onState={onState} onAutomation={onAutomation} />
    <WorkspacePage active={page === "reports"} label="计划与数据"><QianchuanBackendPanel accounts={state.douyinUpload?.accounts ?? []} active={active && page === "reports"} /></WorkspacePage>
  </section>;
}
