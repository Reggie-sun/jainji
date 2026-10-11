import type { DesktopState } from "../shared/desktop";
import type { QianchuanLibraryClear } from "../shared/qianchuan-video-library";
import { DouyinUploadPanel } from "./DouyinUploadPanel";
import { Heading } from "./ui";
export type QianchuanPage = "uploads" | "accounts" | "materials";

export function QianchuanWorkspace({ state, page, onPage, onState, onAutomation }: {
  state: DesktopState; page: QianchuanPage; onPage(page: QianchuanPage): void; onState(state: DesktopState): void;
  onAutomation(cleanup: QianchuanLibraryClear): void;
}) {
  return <>
    <Heading title="千川">上传、账号配置与素材管理分别处理；历史任务保留原账号和计划。</Heading>
    <nav className="task-page-tabs" aria-label="千川页面">
      {([ ["uploads", "上传任务"], ["accounts", "账号与计划"], ["materials", "素材管理"] ] as const).map(([id, label]) => <button key={id} type="button" aria-current={page === id ? "page" : undefined} onClick={() => onPage(id)}>{label}</button>)}
    </nav>
    <DouyinUploadPanel key={state.project.id} projectId={state.project.id} status={state.douyinUpload} page={page} onPage={onPage} onState={onState} onAutomation={onAutomation} />
  </>;
}
