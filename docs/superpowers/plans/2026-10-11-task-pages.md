# Task Pages Implementation Plan

## Goal

按当前用户授权完成全部前端分页，让每个页面围绕制作、作品验收、千川管理或自动化任务组织。设计输入为仓库外 `jianji-product-audit-20261011/page-structure.md` 与 `report.md`；其中“只评审”是上一阶段范围，本轮直接实施。

## Scope And Owners

在当前 `feat/qianchuan-vps-egress` working tree 实施，不创建 worktree。Parent 拥有相关 renderer、测试和 Harness 路由；Kimi 只读检查草稿生命周期。保留无关改动，不处理真实账号、额度、上传或清理。

| Owner | Responsibility |
| --- | --- |
| `App.tsx`, `workspace-flow.ts`, `WorkspaceChrome.tsx` | 当前任务页面、制作阶段、项目入口、跨页返回及实际滚动容器 |
| `WorkspacePage.tsx` | 延迟挂载并保留已访问编辑器；隐藏页不参与可见布局或键盘交互 |
| `TemplatePanel.tsx`, `OutputConfirmation.tsx` | 包装、覆盖、输出独立呈现；输出摘要、既有准入阻断及定位 |
| `QianchuanWorkspace.tsx`, `QianchuanSettingsPage.tsx` | 上传任务、账号与计划、素材管理三个子页面 |
| `DouyinUploadPanel.tsx`, `QianchuanAccountSettings.tsx`, `QianchuanVideoLibraryActions.tsx` | 移除原跨任务嵌套，保留原操作和身份校验 |
| `AutomationWorkspace.tsx`, `AutomationPanel.tsx` | 列表与创建/编辑页面；来源草稿冻结副本，原调度 owner 不变 |
| `BatchProductionPanel.tsx`, `DouyinUploadControls.tsx` | 立即制作、单行参数、配置和自动化的上下文入口 |
| `ResultsPanel.tsx` | 进度、播放、异常、重试、追加及相关上传摘要 |
| `workspace-redesign.css`, `tests/workspace-flow.test.ts`, `tests/task-pages.test.ts`, `tests/automation-ui.test.ts`, `.agent/harness/policy.json` | 页面布局与隔离交互回归、检查路由 |

## State And Compatibility Contracts

- 不添加路由库或新的持久化格式。原 `ProjectWorkspaceSchema.step` 的 import/templates/results 恢复解释保留；renderer 制作子页为视图状态。
- 单个项目的素材选择、文字、外观、数量、目录、上传选择沿用 `App`；已访问的覆盖、批量、连接、账号和自动化编辑器切页时保持挂载，以保留局部未保存草稿。项目切换恢复原项目工作区，项目相关编辑器明确绑定 project ID，不串用另一项目草稿。
- 页面切换不保存、不批准、不调用模型、不启动任务。隐藏页暂停媒体播放；运行任务继续由原生产、队列、上传和调度 owner 管理。
- 新步骤进入起点；配置/资源上下文返回恢复来源 scrollTop 与焦点。使用 `.membership-workspace`，不能依赖 `window.scrollTo`。
- 移除 Results→Upload→Accounts→Cleanup 和 Batch/Cleanup→Composer 的旧呈现链。千川操作、冻结 advertiser/plan、清理确认、防重传与 UNKNOWN fail-closed 逻辑保持。
- 自动化来源仅传递制作/清理草稿副本，切页不构成授权；原 composer 的固定范围变更使授权失效。新任务默认暂停，已有任务只通过原 configureAutomation 的时间/启停契约编辑，不新增修改固定执行范围的 API。旧每日视频库清理入口迁入自动化，保留既有兼容 owner。
- 输出页保持共享文字 schema、单项目数量向上取整、手动目录要求、覆盖保存和 assisted 显式批准。账号配置入口返回后可继续选择；缺账号/计划/全局开关给出具体原因，不自动改选或启动。

## Major Milestones

### M1: Separate Management Tasks

拆断作品页的千川链；独立千川三个子页。自动化列表和创建/编辑独立入口；批量与素材管理只保留携带当前草稿的入口。保留旧每日清理兼容页面。验证作品首屏、批量单行控件、来源草稿和未保存自动化编辑往返。

### M2: Separate Production Stages

素材、包装、覆盖、输出确认仅显示当前阶段。包装前置制作方式；仅适用 Agent 模式显示 brief。输出汇总当前设置与阻断原因，链接对应步骤、账号或模型入口。覆盖编辑器和审阅状态不因导航卸载。验证文字、框、数量、目录、上传选择往返及批准失效。

### M3: Context Navigation And Projects

项目管理移入项目入口；贴纸库、模型设置归入资源/工具。完成上下文返回、滚动起点与焦点恢复；运行中导航不取消或改变冻结请求。验证不同项目隔离、未配置上传的就近入口和后台进度可见。

### M4: Verification And Delivery

执行 typecheck、受影响测试、build 与 current policy 的 owned-scope Harness；Chrome MCP 在隔离 bridge 上验证实际主组件交互，围绕 `make frontend` 的 renderer，不操作用户账号。评估 stable candidate Risk Gate，必要时受管 Kimi review；逐项维护本轮 AOCI 并执行官方 Verify/Check/Guide。审查 owned diff，commit/push 当前 upstream 并核对 remote HEAD。

## Acceptance Criteria

1. 制作有四个实际子页，非锚点长页；作品首屏为进度和结果。
2. 千川有上传任务、账号与计划、素材管理三个子页；自动化列表和创建/编辑独立于来源页。
3. 批量保持单行参数与立即制作；项目、模型、贴纸有清楚入口及上下文返回。
4. 跨页草稿、覆盖框、素材、文字、数量、目录、账号选择保留；项目切换隔离；导航不触发副作用。
5. 覆盖编辑的预览/批准失效、必填文字和未配置上传有可执行交互证据；输出阻断可定位修复。
6. 新工程证据对应 final bytes，不用旧截图、mock、tests 或 screenshot 声称真实平台或整片媒体验收。

## Verification

`npm run typecheck`、受影响 Vitest、`npm run build`、`npm run harness -- code --scope <owned-scope.json>` 与只读 completion verify。新增测试登记 policy。Chrome MCP 使用隔离当前 `App`、开发界面的 `.membership-workspace` 滚动容器与原 CSS；测试行为覆盖页面隐藏、返回、草稿、运行中导航及批准失效，不执行真实制作/上传/清理。

## Self-Review

七项 Authorized Target 均分配到 M1–M3。只新增 renderer 页面边界，复用原 schema/queue/approval/config owners；旧自动化编辑仅暴露已存在的时间和启停能力，不扩大后台范围。切页保留编辑器是草稿保留机制，显示内容仍严格按页面切换。平台、媒体、Windows 与人工接受分开报告。
