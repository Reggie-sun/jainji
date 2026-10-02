# Qianchuan In-App Browser Controls Implementation Plan

## Goal And Scope

账号窗口的打开、关闭、必要重启在软件内完成，保留原登录目录与待确认上传。Native Codex 串行实现，不创建 worktree；受管 Kimi 只读调查和适用风险审查。合同见 [In-App Browser Controls Amendment](../../douyin-auto-upload-spec.md)。

## Ownership And Invariants

- `qianchuan-browser-manager.ts` 维护唯一原/专用 profile 生命周期；`qianchuan-browser-process.ts` 负责正常退出及有限等待，`qianchuan-browser-discovery.ts` 提供当前用户主进程身份。
- `qianchuan-account-settings.ts` 从已保存账号槽取得 advertiser，删除失效的运行内连接缓存，不改变保存映射或历史目标。
- `douyin-upload-service.ts` 独占制作/上传互斥和全账号未结束上传保护；新 IPC 只接受严格产品槽、预期 advertiser ID（用于防止账号映射漂移）及 close/restart action。
- 前端账号设置明确告知全部账号窗口会关闭；失败留在界面。打开仍可连接原窗口；无 CDP 时引导软件内重启。
- 不强杀、不清登录目录、不确认或发布、不重试 UNKNOWN、不自动结束本地批次；应用启动及恢复零浏览器操作。

## Milestones

### 1. Lifecycle And Regression Evidence

为同目录正常关闭/重启、无 CDP 原进程、身份变化、重复窗口、关闭超时、请求互斥、真实隔离 Chrome 和目录数据保留提供可执行回归。先绑定 pidfd 再核查身份和正常退出，缺 Python 3.9+ / pidfd 能力拒绝，不能回退数值 PID 信号。仅安全退出后重开，当前端口验证可达；不新增上传队列。

### 2. Canonical Guard And Software Entry

通过共享严格 schema、账号设置、原 upload service、可信 IPC/preload 接通前端关闭与重启。全账号非关闭 fence/READY/UNKNOWN 以及运行操作阻断；退出前由实际进程 endpoint 重核同进程中其他 advertiser 的历史任务，缺 endpoint 无法排除其他草稿时保守阻断。支持 Chrome 更新后的 deleted executable 身份，不推断进程已经退出。制作启动、手动导出和追加的保护保持到异步入队与意图登记完成，上传继续不能抢入生命周期操作。未保存的表单目标不拥有关闭其他账号权限。

### 3. Verification And Completion

运行 `npm run typecheck`、相关 browser/account/upload tests；Chrome MCP 实际验证账号设置入口、明确操作和保护提示，真实隔离浏览器验证退出、同 profile 重启及登录目录保留。不得关闭真实待确认账号用于测试。稳定后判断 Implementation Review Risk Gate、维护本轮 AOCI、审阅并只提交本轮文件，记录真实证据与剩余限制。

## Parent Self-Review

公开 API 不传进程或路径，身份由原私有绑定和 discovery 决定。浏览器保护使用全账号记录而非本轮过滤，避免旧模态被新一轮覆盖。正常退出与上传互斥需同时约束入口和异步恢复检查；未知关闭结果不能续启动。无需调整制作、模型或渲染逻辑。
