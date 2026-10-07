# Upload Recovery Implementation Plan

## Goal

修复千川上传准备阶段过早消耗发送权限和批量任务无法恢复的问题；连接及文件发送前的可恢复故障有界自动重试，已可能发送的文件只读核查，保留全部历史记录。

## Evidence And Scope

蝴蝶贴原动态 CDP endpoint 可连接；原 tab、modalSessionId 与 fence 相同，但没有文件行。旧失败只有 PAGE_CONTRACT_CHANGED，不能证明具体失败分支或平台未收到文件。禁止将这次历史 UNKNOWN 改写为 NOT_SELECTED。

当前 `selectGroup` 在打开原生 chooser 及验证 input 前调用 `markSelecting`，因此尚未调用 setFiles 的准备错误也永久阻塞任务。将 chooser 准备移到 fence 前，发送仍必须在持久 fence 之后。批量详情增加由 run/job/捕获 export task 归属校验的恢复操作，复用同一 service。

## Invariants

- 不重传 READY、fenced、UNKNOWN 文件；不删除或结束真实批次，不点击平台确定。
- source/snapshot/hash、账号、计划、tab/modal 身份、取消及停止校验保持原 owner。
- 旧账本及冻结授权不迁移，不因空列表推导未上传。
- 重试只针对发送前确定未选文件的 transient browser failure；有限次数、停止可取消，失败保留可操作错误。
- 本次不引入绕过未知任务阻塞的第二条上传生命周期。

## Owners And Milestones

1. `qianchuan-page-contract.ts` / `douyin-cdp-uploader.ts`：chooser 预检与单次发送分离，验证前不写 fence；错误按阶段展示。真实 Chrome 只选文件前探测；fixture 覆盖准备失败与发送不确定。
2. `douyin-upload-service.ts`：准备阶段有限恢复，发送后不进入重传分支；复用原 connect/stop/cancellation owner。覆盖断连、准备失败、取消、fence 后失败。
3. `batch-production-controller.ts` / runtime / shared / preload / index / `BatchProductionDetails.tsx`：严格限定当前批次任务的安全继续和只读核查入口，保持单项目隔离；测试跨 job/run/project 拒绝和 UI 反馈。
4. 运行 typecheck、相关测试、真实 UI、上传 fixture、Harness/completion、AOCI；按风险门判断独立 review。仅提交本任务文件并 push、核对远端 HEAD。

## Acceptance

发送前准备失败不消耗文件发送权限；可恢复连接故障最终只发送一次；发送后断连或缺行零重传；批量用户能执行原页核查或对未选任务安全继续。当前蝴蝶贴历史未知无法靠本修复自动消除，必须准确保留并报告。

## Self-Review

用户已授权上传修复和有限自动重连。此计划不将旧 UNKNOWN 重新解释，也不增加账号/计划权限；项目合同中“选前无自动 retry”需按上述 bounded transient preparation 窄修订，非网络、身份和控件结构拒绝不自动重试。验收区分软件回归、隔离上传和真实平台结果。
