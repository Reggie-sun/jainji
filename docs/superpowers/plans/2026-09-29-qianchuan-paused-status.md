# Qianchuan Paused Status Repair

## Goal And Scope

修复正式成片已经入账、上传服务因旧任务暂停，却仍显示正常待上传说明的缺口。当前真实证据为晚安油 108 条 completed / 108 条 PENDING，同账号有 8 条历史 NEEDS_HUMAN；Chrome 可连接，当前页面没有上传弹窗，关闭原因未知。

## Contract And Ownership

复用 `DouyinUploadService.status` 和现有 `DouyinUploadPanel` 的 message / ready 展示 seam，仅改变状态投影及拒绝继续时的说明。保留原账户、pageBatch、显式继续、每组最多 9 条、全组 READY 后推进、未知结果禁止重传和永久 fence 合同。status 不连接、启动或关闭 Chrome，不修改 ledger，不解除暂停。

Parent 串行修改干净的 `src/main/douyin-upload-service.ts`，新增 `tests/douyin-upload-paused-status.test.ts` 和本 plan；更新既有干净修复记录。原 service 测试、上传 UI、spec 与共享 AOCI 文件继续保留原 ownership。AOCI 维护先取得当前 Guide 的完整候选和精确影响；同文件所有权未解决时封存候选并报告，不能覆盖共享资产。

后续用户明确授权本窗口串行维护 service 的一条 AOCI Entry 及对应 baseline，保留原任务其他字节。2026-09-30 又明确授权：通过应用 owner 停止同 advertiser 的八条 NOT_SELECTED、无 fence 的历史任务，再继续当前新批次；其他历史 UNKNOWN 阻塞不解除。

## Current And Target Behavior

当前 status 无视 paused / stopped，在上传不运行时返回 ready=true 和通用说明。目标是显示暂停及旧任务数量；优先说明当前项目目标账号上的历史阻塞，使用当前产品显示名称，提供原页面核查指引。其他账号受全局暂停时明确提示需要显式继续。已停止但无未知结果时提示安全继续。保持初始化、存储、关闭设置和平台 readiness 的优先级。

同账号的新批次“安全继续”仍拒绝，但错误须指出账号、未解决任务数量和核查路径；不把“浏览器已关闭”当成自动认定事实。没有实时浏览器证据时只说明原页面需要核查。

## Acceptance And Verification

独立回归先复现 ready / message 错误；覆盖跨项目同账号阻塞、其他账号显式继续、停止状态、暂停解除后的恢复投影、错误优先级、UNKNOWN fence 和 ledger 字节不变。运行 typecheck、受影响测试及既有恢复 / 页面诊断 / UI 测试。安装以当前运行包为基底、只替换已核验 service 对应 bundle，并保留回滚；在隔离 Electron 中核对实际 alert 和零浏览器动作，再检查无活动制作 / 上传后通过正常应用关闭和启动验证真实 108 条队列仍保留。

## Milestones And Self-Review

1. 冻结独立只读 Kimi 核查包；Parent 写独立失败回归并实现 service 状态修复。
2. 完成行为验证、构建字节对照、Risk Gate 判定、AOCI 候选及校验；不扩大账号解除授权。
3. 安装可回滚修复并绑定桌面实际运行身份，更新既有修复记录并仅提交 owned paths。

已按 spec §8–10 和真实 ledger 核对：本修复不授权历史账号自动恢复，不改变任务状态，也不能宣称真实平台上传已通过。当前正文的 plan 状态与旧 M1 不作为实现证据。Windows 依用户要求不验证。
