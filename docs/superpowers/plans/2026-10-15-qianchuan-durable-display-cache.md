# Qianchuan Durable Display Cache Implementation Plan

**Goal:** 已读取目录长期可用，过期或连接失败时不清空用户选择。

**Scope:** 普通、批量及清理选择器；本机、本机 · VPS 出口、VPS 浏览器；已有目录/计划 schema 和展示 API。

**Spec:** [Durable Display Cache](../specs/2026-10-15-qianchuan-durable-display-cache.md)。已在本任务授权内完成 Self-Review。

**Invariants:** 历史记录只用于展示/草稿；原生产、上传、切换及删除实时校验和冻结目标不变。

**Compatibility:** 旧请求及响应形状不变；新显示元数据不进入 production plan/account schema。私有 JSON 默认 64 KiB 准入保持，仅缓存调用有界 4 MiB 读取。

## Milestone 1: Durable Display Owner

创建 `src/main/qianchuan-catalog-cache.ts` 管理私有、原子、严格绑定的记录，创建 `src/main/qianchuan-display-catalogs.ts` 管理读缓存/显式刷新/失败保留。在既有共享 schema 增加 opt-in 字段和显示状态，服务只增加薄接线，真实 reader 保持原路径。

验证 `tests/qianchuan-plan-selection.test.ts` 中超过五分钟、service 重建、三种上传路由、跨锚点/子账户、两种计划来源、损坏/符号链接、刷新失败和取消；验证命中不调用 Chrome reader，缓存不代替实时 preflight/清理。

## Milestone 2: Retained Selector Drafts

更新 `QianchuanPlanSelect`、`QianchuanSubaccountSelect`、`QianchuanCleanupPlanSelect` 及共享请求租约。所有入口 opt-in；按后续用户要求，读取时间与历史状态仅供内部处理，选择器不显示缓存提示，紧凑行不重复显示账户身份；同绑定刷新不先清空列表/选择，真实成功响应才清理已失效选择。账号变化仍隔离迟到响应。

验证 `tests/qianchuan-plan-selection-ui.test.ts` 的普通/紧凑/清理入口、历史空目录、刷新失败保留、成功更新、账户变化与 StrictMode，使用 Chrome MCP 检查隔离页面交互。

## Milestone 3: Final Snapshot And Delivery

运行 typecheck、相关测试及 owned Harness；稳定后判断 native Review Risk Gate，必要时只用一个原生 reviewer。按官方 AOCI 完整批次维护所有本轮 indexed 对象，完成 Verify、Check、Guide 和 Harness completion。保留外部 dirty changes，只提交本轮路径/hunks，按明确 SHA 推送并核对远端源码，防止其他会话旧快照撤回缓存。

## Deleted Plan Reconciliation Delta

`QianchuanDisplayCatalogs` 接收原实时 reader 的成功完整列表，按冻结配置摘要、保存锚点和当前子账户隔离更新既有缓存。`DouyinUploadService` 仅为两种 reader 增加缓存接线；生产仍实时读取，失败不写、缓存写失败不改变实时结果。移除“只有显式刷新更新”的限制；不新增后台平台轮询或第二套缓存 owner。

同绑定的实时观察在写入前登记；展示刷新最终落盘前核对观察身份及列表内容，较早刷新不得覆盖较新的完整列表，避免已删计划被迟到响应恢复。

选择器在下一次读取成功保存的缓存后也过滤不存在的草稿计划；失败回退仍保留选择，清理的明确空选择不扩大为全选。由 `tests/qianchuan-plan-selection.test.ts` 覆盖已删计划准入拒绝后缓存更新、全空、两种来源隔离、重启、取消/配置漂移及失败保留；现有 UI 回归及隔离 Chrome 页面验证下一次缓存读取清理选择。此增量由 Parent 串行实现，避免紧密相连的读取、持久化和草稿语义跨 writer 拆分。

## Self-Review

所有五项验收分别由持久化/隔离测试、选择器测试和原生产边界测试覆盖；未引入新的队列、账号配置或上传模式 owner。Native Codex 持续执行，不增加用户批准步骤或 worktree。
