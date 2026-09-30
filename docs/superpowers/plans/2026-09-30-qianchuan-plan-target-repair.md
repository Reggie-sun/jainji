# Qianchuan Plan Target Repair

## Goal And Scope

修复已删除计划仍被使用的问题，并在原上传 owner 中提供明确的整批“改传当前计划”。用户已授权串行接续必要 UI/store/API 和相应 AOCI；其他任务修改保持。原 spec 的冻结目标规则仅在下述显式操作中修订，不因账号设置变化而自动转移。

## Contract And Self-Review

- 页面 owner `QianchuanPageSession.guard` 在匹配目标计划的详情头部核查“已删除”；选文件前拒绝，已有 fence 继续未知且只能只读核查。素材列表或其他计划的删除文字不得误判。
- `DouyinUploadService` 使用当前账号 reader 检查映射；旧未选文件目标与当前映射不同则拒绝“安全继续”，提示显式改传。已有 fence 使用旧冻结目标只读检查。
- 新 trusted IPC 只接收当前 project/task 和用户看到的目标 `expectedAdId`，主进程重新取得同产品、同 advertiser 的当前映射并校验。不得自动选择其他 tab 或猜当前投放计划。
- `DouyinUploadStore` 单 writer 原子更新完整 pageBatch：intent 和 task 数量均等于 expectedCount，全部 NOT_SELECTED、无 fence、无 alias、无取消/终态/活动状态；拒绝不完整准入、跨账号、无效或相同目标。文件身份、快照、配置保持；创建新 pageBatchId 和目标派生 taskId/inputDigest，清除旧失败，结果 PENDING。
- 保存原批次完整 intents/tasks 和新授权的不可覆盖私有审计文件、文件及目录同步，之后才原子提交 ledger；存储结果不确定则 fail closed。审计记录只保存历史，不构成第二队列或恢复许可。重启仍零自动上传。
- service 在无 runner/active/preparingContinuation 时串行执行，阻断自动调度，等待 admission；迁移本身零浏览器操作、零文件选择。提交后仍需显式“安全继续”，其他未知任务阻塞不被解除。
- 50 条已选文件旧计划记录与 fence 保留；108 条未选文件只有在整批验证通过时可以迁移。当前计划 ID 必须来自实际页面/保存设置，不写死生产 ID。

Self-Review：上述授权只修改从未产生文件副作用的整批冻结目标，不能证明旧已选文件未被平台接收。审计失败、映射变化、停止/取消交错均不得授予文件选择权限；无需修改 ExportQueue 或制作生命周期。

## Milestones And Owners

1. 页面删除 guard：修改 `src/main/qianchuan-page-contract.ts`，新增独立 `tests/qianchuan-plan-target.test.ts`；生产 selector fixture 增加真实详情头部的最小形状。证明 deleted 拒绝、无关删除文字不误判、准备后删除也拒绝，缺失头部不猜可用。
2. 原子账本迁移：修改 `src/main/douyin-upload-store.ts`，新增 `tests/douyin-upload-retarget-store.test.ts`。验证整批迁移/重启、原历史保留、partial/fence/alias/cancelled/cross-account 拒绝及存储故障阻断。
3. service/API/UI：修改 `src/main/douyin-upload-service.ts`、`index.ts`、`preload.ts`、`src/renderer/DouyinUploadPanel.tsx` 及必要设置提示，新增独立 service/UI 回归。证明显式迁移不启动浏览器，旧 continue 不用旧计划，选择权限仍由九条分组/全组 READY 控制。
4. 验证和交付：运行 `npm run typecheck`、受影响测试、Code Harness、trusted build、普通/批量 Electron fixture 和迁移 UI 交互。稳定后判断 current Risk Gate、维护对应 AOCI，具体路径提交。安装保留回滚，活动制作未结束时不得重启。真实平台证据与隔离 fixture 分开记录。

## Compatibility And Remaining Limits

保留 strict v2 ledger schema，旧程序只能看到已完整提交的新授权，审计不会被当作 active task。未知文件及丢失弹窗不能改传；不自动确认、发布、修改计划或广告设置。Windows 按用户要求不验证。记录使用现有修复记录；没有项目专用 session-capture skill。
