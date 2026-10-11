# Unified Scheduled Cleanup

## Goal And Authority

用户明确要求把原视频库清空与同时间计划素材清理合成一个任务。Native Codex 负责实现；本增量允许定时请求复用已有 `DELETE_ALL_VIDEOS` / `DELETE_VIDEOS_AND_PLAN_MATERIALS`，取代旧 plan-only 限制，不扩大已保存的账号、计划或清理规则。当前分支原地工作；共享索引等另一项修改提交后维护。

## Owners And Scope

`AutomationScheduler` 是唯一生产定时触发 owner；`AutomationRuntime` 仍只适配原 `DouyinUploadService.clearVideoLibraries`。新增 `automation-cleanup-migration.ts` 只负责一次本地迁移，不执行浏览器删除。`QianchuanVideoLibrarySchedule` 保留旧历史、迁移凭据与原系统启动能力，产品启动不再启动其旧定时器，旧保存 IPC 关闭。不改变 unknown/pending 删除保护、会员准入、原制作上传生命周期。

## Migration Contract

- 同时间、同启用状态、同 product/advertiserId 集合的唯一纯计划清理与旧视频库清理合并；旧计划清理 opt-in 的计划必须属于新任务已存范围。存在多个匹配候选即阻断，不能猜测。未匹配的旧任务迁移为独立标准自动化任务，保持其原范围、时间及启用状态。
- 合并继承计划清理原名称、时间、完整计划快照和规则；旧审核清理 opt-in 与零展示取已授权规则的并集。各账号先计划清理，只有该账号清理成功才清空视频库；任何 PARTIAL/BLOCKED 继续由原 owner 阻断。
- 先准备新私有冻结 recipe，再原子保存旧设置 disabled 及迁移任务/原任务快照，再原子替换调度任务，最后标记迁移完成。中断后只恢复可精确核对的本地任务安装；source CAS、task identity、文件保存或 recipe 检查不确定时阻断自动执行。迁移不调用清理、制作、上传，也不重写任何历史删除 intent。
- 旧记录完整保留；新任务的 lastRun 保留两个来源中最大的已领取日期，防同日补跑。完成标记不恢复用户后来删除的任务，不覆盖其启停/时间更改。
- 原 systemd 启动绑定迁移后的任务；启停、改时、删除更新原系统启动 owner。时间、接收日期、30 分钟启动恢复窗口及原每日 claim 均继续校验，系统启动不授予删除权限。

## Milestones And Verification

1. 共享清理准入、迁移模块、scheduler 原子安装、旧 owner 退役与启动接线。测试匹配/歧义、规则并集、CAS、中断恢复、不重建已删除任务、历史防重、迟到 system launch。直接覆盖原 runtime 的组合清理调用与失败短路。
2. 任务详情准确显示组合范围，旧卡片替换成合并前只读历史；来源页面可显式保存已确认的组合范围。Chrome 验证单任务、规则、暂停/改时、历史与零平台副作用；实际 make frontend 主进程需重新启动后才载入新逻辑，保留用户未保存草稿。
3. typecheck、owned-scope Harness、Kimi 只读风险审查、最终 diff、AOCI 官方维护与 Verify/Check/Guide，然后仅提交本任务文件并 push/核对远端 SHA。fixture 不证明实际平台删除，Windows 环境未验证则明确报告。

## Self-Review

单个组合请求复用已有计划到视频库的执行顺序，不建立第二队列。迁移凭据只保存已授权快照，停旧任务先于安装新任务，恢复不触发平台动作。只显示历史而不重新启用旧任务；同日领取日期、历史 unknown 和会员门均保留。风险审查绑定最终源码与 Harness，索引 ownership 和实际重启是独立执行边界。
