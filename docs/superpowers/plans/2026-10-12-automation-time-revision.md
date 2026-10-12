# Automation Time Revision Implementation Plan

## Goal

用户明确要求“改了时间就算新的”。已运行的每日任务改为今天尚未到达的新时间后，按新的安排再次执行；同一安排仍只能每天执行一次。

## Scope And Ownership

- `src/main/automation-scheduler.ts` 独占时间修改、持久化安排身份、每日占用及下次执行时间；替换按 task 全局 `lastRun.day` 阻止当天新安排的旧路径。
- `src/shared/automation.ts` 定义兼容旧记录的可选 `scheduleRevision` / `scheduleUpdatedAt`；运行记录绑定自己的 `scheduleRevision`。
- `tests/automation-scheduler.test.ts` 使用可控时钟和 fake effects 验证新行为及持久化失败边界。
- 原 [Scheduled Automation Plan](2026-10-10-scheduled-automation.md) 导航到本次已授权增量，不复制新的字段合同。

## Contract

真正改变 `request.time` 才递增安排 revision，并记录本次修改时间。相同时间保存、暂停、重新启用不产生 revision。旧 task / run 缺 revision 时解释为 0。原 `lastRun` 保留到下一次实际占用；当天防重只消费与当前 revision 匹配的运行记录。

新时间已经过去时从明天开始；保存动作本身不启动制作，也不补跑修改前的到点事件。每日触发还必须晚于 `createdAt` 和本次 `scheduleUpdatedAt`。重启、重复 tick、时间回拨、失败、跳过与取消后，在相同 revision 内保持原防重规则。修改执行中的任务仍拒绝。安排修改及运行占用都先原子持久化，再发布状态或执行副作用。

新安排复用相同 task ID、冻结 recipe / binding、模板、素材、账号与计划；新运行获得独立 run ID。原上传 claim、UNKNOWN / MAY_HAVE_UPLOADED、清理 ledger 和来源成片幂等 gate 全部保留，改时间不重传旧批次、不清历史未知结果。

## Compatibility And Boundaries

只增添可选字段，旧记录原样可读且不自动产生新安排。新版产生的字段不支持旧版 strict schema 降级读取；不改磁盘 `version`、旧冻结配方或清理迁移 owner。字段未知、负数、非整数或超过安全整数范围时拒绝。没有新队列、任务生命周期、重试入口、连接或依赖。不会修改用户真实定时任务、自动启动真实制作、上传或清理。

## Acceptance Criteria

1. 当天已 COMPLETED / BLOCKED / SKIPPED 的任务改为未来时间后，`nextRunAt` 指向当天新时间；到点产生新的 run ID 并执行一次。
2. 相同时间保存及仅暂停 / 启用不解除已有防重占用。
3. 连续修改 A→B→A 都建立新的安排身份；占用和防重跟随最后一次修改。
4. 改到已经过去的时间不会立即补跑，从下一天到点开始。
5. 新安排等待期间及执行结束后重启，均保留正确的执行资格或已占用状态；时间回拨不重放。
6. 旧记录无需 revision 字段可读，原执行仍被识别为 revision 0；新修改可建立 revision 1。
7. 保存配置或运行占用失败，不执行副作用，保留原 unknown-outcome fail-closed。
8. 上传旧来源成片的独占 claim 与未知结果准入不因安排变更放宽。

## Major Milestones

### Milestone 1: Durable Schedule Identity

先添加回归并确认旧逻辑失败，再实现 optional schema、配置时 revision 递增、revision 匹配的每日占用、`nextRunAt` 及修改后时间边界。focused command：`npx vitest run tests/automation-scheduler.test.ts`。

### Milestone 2: Verification And Delivery

受管 Kimi 只读核对未修改的执行 / 上传 owner 是否仍保留 claim / UNKNOWN gate；Parent 调查和裁决，不替代 verification。执行 typecheck、相关 Harness（包含定时、制作生命周期与上传回归）、AOCI official 维护 / Verify / Check / Guide 和 exact owned-scope completion。稳定候选按 Risk Gate 裁决是否需要独立 final review。只 stage 本任务 paths，commit / push 当前 upstream 并核对远端 HEAD。

## Self-Review

用户请求直接授权改变同日时间编辑的旧语义；本增量不取消同一安排的防重，也不修改真实配置。安排 revision 由现有 scheduler 独占，clock timestamp 仅限制安排生效前的触发，不承担身份去重。回归覆盖可重跑与拒绝重放两侧；未知上传 / 清理的外部结果由原 ledger 保持失败关闭。
