# Partially Registered Closure Implementation Plan

## Goal

允许用户结束合法但未登记全体意图的历史批次，解除予浅/安序切换 VPS 的阻断，同时保留旧结果和永久防重传屏障。

## Scope And Contracts

依据 [Upload Contract](../../douyin-auto-upload-spec.md#partially-registered-historical-intent-withdrawal-delta)。唯一变更 owner 为 `DouyinUploadStore`，共享 strict closure schema 增加可选 `registeredIntentCount`。可信 IPC、当前项目锚点、service 控制互斥、选择和确认准入保持。原完整记录兼容；旧 reader 遇新字段失败关闭。其他会话的自动化增量上传改动不属于本计划。

## Acceptance And Verification

回归复现缺少未准入成员的 task 和 intent 时旧实现拒绝。修复后保存实际登记数并重载，所有 task/intent/fence 原样；迟到成员不能登记，计数字段删除/漂移及 orphan task 拒绝。执行 typecheck、closure/store/service/automation 上传相关测试及 owned Harness。真实操作前核对原 328 条记录和 285 个屏障 SHA，使用原 preload 结束七批，再复验同一集合。VPS 切换与九条真实上传的证明分别记录，测试通过不等于平台接受。

## Major Milestones

1. 更新 `src/shared/douyin-upload.ts`、`src/main/douyin-upload-store.ts` 和 `tests/douyin-upload-closure-store.test.ts`；冻结登记数量只用于撤销资格，归档保持原成员，不补齐缺项。alias 先要求原批次已结束，覆盖依赖顺序、未结束引用拒绝与两批证据重载。
2. 在稳定字节上完成原生验证与受管 read-only Kimi 审查，Parent 裁决 findings；完成 AOCI 维护并仅提交本任务文件。
3. 原应用完成七批关闭、两个账号的 B 路线绑定及九条新成片真实上传验证。CPU/页面失败或未知结果停止，不重选、不回退本机出口；临时测试定时任务执行后停用。

## Self-Review

授权来自用户结束旧批次及后续继续指令；负权限操作不推断缺失成员结果。代码、兼容、永久屏障、迟到写入和真实验收分别有检查。未引入第二 ledger、queue、浏览器会话或确认 owner。
