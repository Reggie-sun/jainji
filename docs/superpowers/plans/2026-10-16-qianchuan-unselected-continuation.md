# Qianchuan Unselected Continuation Plan

## Goal

用户明确已在千川手动提交原批次前 8 条后，仅接续其余从未选择文件的正式成片。现场原批次预计 200 条、实际登记并导出 194 条，其中 8 条 READY 有永久 fence、186 条 NOT_SELECTED；重启后旧批次不再属于本次制作。

## Scope And Owners

- `douyin-upload-store.ts` 继续独占原 intent/task、冻结授权、审计归档和原子提交；扩展既有未选批次迁移能力，仅迁移明确未选成员。
- `douyin-upload-service.ts` 继续独占控制串行化、原账号/计划核验、私有快照校验与原 runner。新入口只复用这些 owner，不另建队列。
- shared schema、原 IPC/preload 和 `DouyinUploadPanel` 提供明确的人工提交声明及恢复入口。
- 当前已有 service/test 清理改动保留；本任务只提交新增恢复 hunks。当前树串行开发，不创建 worktree。

## Contract

产品语义由 [Manual Submission Continuation Amendment](../../douyin-auto-upload-spec.md#manual-submission-continuation-amendment-2026-10-16) 独占；以下记录本任务的实施边界与验收约束。

请求绑定当前 project、原 pageBatchId、一个待传 task 及完整的已选 task ID 集合，并明确声明这些素材已在千川手动提交。只允许停止/空闲后的显式操作，不自动恢复。

原批次所有已选成员必须为有 fence 的 READY；UNKNOWN、别名、已关闭批次、运行成员、未落成 task 的 intent、缺/额外声明或冻结授权分歧均拒绝。未选成员仅允许 PENDING、FAILED_RETRYABLE、NEEDS_HUMAN，以及已限定的未选准备 TIMEOUT 旧终止记录；取消及其他终止失败拒绝。

只将未选成员重新授权为同 target/config 的独立 pageBatchId，expectedCount 为其精确数量；project/export 身份、upload_task_id、字节 SHA、snapshotPath、配置和排序不变。迁移前归档完整原 batch preimage 和声明，随后通过原 store 原子提交。原已选 task、intent、fence 原字节保持；不伪造 ACCEPTED、不关闭原批次、不改原目标、不清除历史。

先验证所有剩余快照与冻结配置，并对现场原 `current-browser` 重建原连接及网页账户绑定；目标或绑定不明确时零迁移、零文件选择，process-local anchor 仍由原 owner 核验。持久迁移成功后仅由原 runner 执行剩余成员，文件动作继续受原页面契约和确认回执约束。重复旧请求不得再次迁移或再次选择文件。迁移后重启且仍全部未选的子批次沿既有完整未选历史恢复规则显式恢复。

归档已同步而 ledger 未提交时，显式恢复仅可复用与当前完整 preimage、提交声明及冻结目标匹配、且目的批次仍为空的原提案；不覆盖、不重新编号或重新解释未知归档。Service 使用 store 返回的实际持久授权签发当前运行范围。历史恢复复用已核验的原浏览器连接，不进入新制作的账号关闭/切换流程，保留全局 READY/UNKNOWN 浏览器保护。

## Acceptance And Verification

1. Store regression：8+186 的小型同构 fixture 验证只移动未选成员、原已选记录/fence 不变、相同目标/字节/配置、原子失败与重启、重复请求及非法声明/UNKNOWN/取消/目标变化拒绝。
2. Service regression：手动提交后重启、旧预计数大于实际数、原账户绑定、文件变更和控制竞态；原 8 条零重选、剩余各一次；不得用声明伪造平台接收。
3. Schema/UI：明确展示原账号/计划及跳过/接续数量，人工声明后调用唯一恢复入口；Chrome integrated smoke 验证真实点击与参数。
4. typecheck、受影响测试、owned Harness、必要 AOCI 与 Risk Gate，稳定候选完成后 commit/push 并核对远端 HEAD。
5. 真实恢复仍需当前运行代码与平台证据。用户的手动提交声明不等于自动生成平台 ACCEPTED 回执；原有 8 条记录继续保留。
6. 原 remote-browser 模式同构恢复及归档同步后进程退出：只接续剩余成员、仅新子批次确认、不准备/关闭原浏览器；归档 preimage、声明、目标或目的批次不匹配时零 ledger 修改、零选择。

## Self Review

原恢复规则只允许完整且全部未选批次，不能覆盖此次合法的部分手动提交现场。该增量只授予已证明 NOT_SELECTED 成员新的明确执行范围，原已选记录仍受永久保护，符合本任务修复目标。任务内恢复规则与预算变更按当前用户默认授权实施；不扩大广告设置、模型调用或媒体生产范围。

## Live Admission Follow-up

真实请求已持久迁移剩余成员，但随后常规 `currentTarget` 将保留已选记录的唯一账户页面排除，导致准入拒绝；子批次仍全部未选文件。只读实测证明原页可正确识别冻结账户、排除该页则无账户源。

修复仅允许已经原历史恢复流程核验的批次在当前目标的只读身份复核中读取保护页，普通目录、新制作及全部文件动作和浏览器控制仍保留原保护。新增部分续传、迁移后重启和迁移后账户变化回归，验证原记录与 fence 不变、只传剩余成员、目录及新准入仍排除原页、身份变化不授文件动作。产品语义仍归上方 Amendment 独占。
