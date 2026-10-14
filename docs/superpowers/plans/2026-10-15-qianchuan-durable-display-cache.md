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

更新 `QianchuanPlanSelect`、`QianchuanSubaccountSelect`、`QianchuanCleanupPlanSelect` 及共享请求租约。所有入口 opt-in；显示读取时间和历史状态；同绑定刷新不先清空列表/选择，真实成功响应才清理已失效选择。账号变化仍隔离迟到响应。

验证 `tests/qianchuan-plan-selection-ui.test.ts` 的普通/紧凑/清理入口、历史空目录、刷新失败保留、成功更新、账户变化与 StrictMode，使用 Chrome MCP 检查隔离页面交互。

## Milestone 3: Final Snapshot And Delivery

运行 typecheck、相关测试及 owned Harness；稳定后判断 native Review Risk Gate，必要时只用一个原生 reviewer。按官方 AOCI 完整批次维护所有本轮 indexed 对象，完成 Verify、Check、Guide 和 Harness completion。保留外部 dirty changes，只提交本轮路径/hunks，按明确 SHA 推送并核对远端源码，防止其他会话旧快照撤回缓存。

## Self-Review

所有五项验收分别由持久化/隔离测试、选择器测试和原生产边界测试覆盖；未引入新的队列、账号配置或上传模式 owner。Native Codex 持续执行，不增加用户批准步骤或 worktree。
