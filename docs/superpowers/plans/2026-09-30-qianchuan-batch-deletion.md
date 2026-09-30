# Qianchuan Batch Deletion Plan

## Goal And Scope

按用户「删了就好」「都可以删除」清理截图中的整批 60 条旧上传任务。保持原视频和未知结果防重传证据；清理只改变上传 ledger 与界面，不启动 Chrome 或其他待传批次。

## Contracts And Self-Review

`docs/douyin-auto-upload-spec.md` §8 为本轮合同。整批已完整准入、无 READY 且未运行时才允许删除。唯一 store owner 保存私有不可覆盖审计并同步，然后原子将整批 task 标为 `DISCARDED`；input、authorization、outcome、failure 和 fence 保留。该状态不可恢复、改传或选文件，load 不将其重新归类为 NEEDS_HUMAN。同目标 hash 去重不变。service 串行化控制动作，与 runner/continue/retarget/stop 互斥；trusted IPC 校验当前项目，UI 明确说明整批删除及不可恢复。从界面与待处理计数移除，不自动运行其他任务。

Self-review：用户授权是删除全部旧任务，因此不拆批或恢复剩余 58 条。保留 terminal ledger tombstone 比删 fence 更安全，原任务准入回调与重启恢复不会重建旧权限。删除是本地不可逆状态变更，无需当前账号配置或文件仍存在。

## Acceptance And Verification

1 fenced unknown、1 unselected NEEDS_HUMAN、58 PENDING 删除后均为 DISCARDED，原 identity/outcome/diagnostic/fence 不变，重启零恢复。部分准入、READY、运行状态、同步失败和并发操作均拒绝；同目标 hash 仍不可选文件。执行 focused red-green tests、typecheck、上传 integration/Harness、构建及隔离 Electron/UI 交互；真实账本操作前先核查 app 活动、备份并关闭旧版写入者。

## Milestones

1. 新状态及 store 原子删除、不可恢复与同步失败测试。
2. service 控制互斥、可信 IPC、界面删除入口及可执行交互证据。
3. fresh verification、Risk Gate、AOCI、scoped commit；隔离构建后备份实际账本，通过 canonical store 删除唯一授权的 60 条，安装并重新验证应用投影。
