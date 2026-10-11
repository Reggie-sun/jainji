# Batch Works And Upload Pages Implementation Plan

## Goal And Scope

补齐 [Task Pages Plan](2026-10-11-task-pages.md) 的批量作品边界：本批制作进度、成片和异常优先；逐条上传状态、冻结目标、历史及安全恢复移到千川上传任务页。核查用户报告的自动上传未触发；仅修复有源码或隔离运行证据支持的故障。

在当前 working tree 实施。保留另一会话的 main、测试及 AOCI 改动；任何实际同文件写入冲突须先由用户决定 ownership。仅使用隔离 bridge，不连接用户账号、上传成片或执行清理。

## Owners And Contracts

| Owner | Responsibility |
| --- | --- |
| `BatchProductionDetails.tsx` | 作品优先展示；仅提供本批上传摘要及上下文跳转 |
| `useBatchProductionDetails.ts` | 复用原 `batchProductionDetails({runId, jobId})` 只读轮询，隔离迟到响应 |
| `BatchUploadDetails.tsx` | 原批量上传明细、历史、恢复错误及 `resumeBatchUpload`；保留冻结 run/job/task 输入 |
| `BatchProductionPanel.tsx` | 作品入口及隐藏保留详情；立即制作上传参数沿原 owner |
| `App.tsx`, `QianchuanWorkspace.tsx`, `DouyinUploadPanel.tsx` | 选择本批上传视图；来源返回、滚动、焦点、账号配置往返及项目隔离 |
| `tests/batch-production-details.test.ts`, `tests/task-pages.test.ts`, `tests/helpers/task-pages-fixture.ts` | 作品与上传展示反例、真实 App 隔离交互及新制作上传参数证据 |

不新增 main API、持久化格式、队列、授权或上传生命周期。`capturedStatus` 与 `requestResume` 仍由原 service/controller 决定资格；renderer 不以当前项目替代批量冻结身份。UNKNOWN 只读核查、重复记录和历史不恢复；未选成员受原阻塞约束。旧操作停止失败不清锁、不重传、不假称分页故障已修复。普通自动上传停在 Chrome 确定前。

## Milestones

### M1: Separate Captured Upload Details

拆出上传视图与原恢复回调，作品列表保持导出错误、播放及源知识进度。作品仅保留紧凑上传摘要及本批专用跳转；异常上传原因仍可就近识别。

### M2: Preserve Navigation Context

父导航只持有 `{runId, jobId, name}` 视图引用，数据仍取原详情 API。切页不调用恢复、开始、保存或取消。千川可返回当前项目上传；账号及素材子页隐藏保留本批视图。返回作品恢复原滚动和焦点；新 run 或项目切换清视图引用，保留原账本。

### M3: Verify Automatic Upload Handoff And Delivery

隔离 App 明确启用全局上传、选择账号和计划后启动制作，核对 `startBatchProduction` 原参数携上传选择，运行中导航不重复启动或恢复。原 queue 成片回调与 upload service 集成测试证明自动派发；它不证明真实 Chrome/平台上传。若复现后端故障，记录最小修复及归属后运行相关回归。

运行 `npm run typecheck`、受影响测试、`npm run build`、current policy owned-scope Harness 和 completion verify。Chrome MCP 核对宽/窄桌面布局、首屏作品、跨页身份和草稿、阻断显示及零导航副作用。stable candidate 评估 Review Risk Gate；本轮 AOCI 官方完整批次、Verify/Check/Guide；最终 owned diff、commit/push 与 remote SHA 核验。

## Acceptance Criteria

1. 批量作品首屏有进度、可播放成片或具体制作异常，无逐条上传列表或恢复按钮。
2. 千川本批明细沿 run/job 获取冻结身份，安全恢复传原 task ID；历史和未知状态不扩大资格。
3. 页面往返保留批量参数、选定详情、滚动/焦点；配置往返和项目切换不混用详情。
4. 上传已启用的新制作携明确账号和计划；导航不承担自动上传触发职责。阻断给出原服务真实原因。
5. 验证对应最终字节；真实平台、真实媒体和 Windows 未在本轮验收。

## Self-Review

覆盖用户 A 选项与最新自动上传反馈；旧上传列表从作品移除，原冻结恢复入口只在千川呈现。轮询共享只负责观察，App 引用只负责导航；生产权限仍由 main owners 独占。具体自动上传故障须以当前证据裁决，不能清除 stopFailed 或未知屏障换取表面启动。
