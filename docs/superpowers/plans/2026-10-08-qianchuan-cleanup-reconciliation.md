# Qianchuan Cleanup Reconciliation Plan

## Goal And Scope

修复清理遇到历史未知结果后只有“人工核查”提示、没有素材明细和人工处理入口的问题。原删除结果保持 UNKNOWN；用户在界面明确声明已在千川核查并处理后，只结束该次本地待核查记录，不触发平台动作。新的清理须再次由用户发起。

## Owners And Contracts

`qianchuan-plan-materials.ts` 仍是清理 owner，新增 `qianchuan-plan-material-recovery.ts` 管理其待核查记录的严格解析、原字节归档与人工处置凭据。共享请求严格绑定 product、advertiserId、adId、attempt、原字节 SHA256 和明确确认 token。复用 `DouyinUploadService` 的唯一清理互斥、账号编辑锁、generation、取消、trusted IPC；不创建第二调度器。renderer 只展示和请求，不能提供路径、endpoint 或替换历史 ID。

## Invariants And Compatibility

- 未处置 pending 继续阻断；清理按钮不自动核查、结束或重放旧删除。返回结构化待核查 ID、统计窗口和精确身份，计划聚合保留该信息。
- 人工处置先在私有目录独占保留原字节并同步，再保存绑定 digest 的处置凭据，最后移除活动 pending 指针；所有原结果保持未知。归档或凭据缺失、损坏、身份错配、取消及未知写入均失败关闭。孤立归档不能自动解除阻断，只允许用户重新确认相同记录完成处置。
- 历史归档中的全部 ID 继续作为自动删除禁入集合；当前清理再次命中则停止并要求人工处理，不盲目重删。新素材沿原规则，包括最近15个完整自然日规则。
- 处置没有浏览器连接、删除、确认、视频库清空或下一次自动清理；不处理上传 fence。定时清理不能发起人工处置。
- 本轮只实施能力，不处置真实两个 pending。用户当前选择尚未人工处理，不能代替其声明已完成核查。旧文件与历史7日窗口保持原样。

## Major Milestones

1. 记录 owner 与状态回归：结构化 pending、归档/凭据顺序、精确 digest、旧 ID 防重删、错误恢复与取消测试。
2. 原 service / IPC / renderer 接入：单计划人工确认、明细与双 ID、账号变化拒绝、成功后不自动清理；服务与隔离浏览器交互测试。
3. typecheck、受影响测试、owned Harness、稳定候选风险评估与受管 Kimi review；AOCI 官方维护、最终 diff、commit/push 与远端 SHA 核对。

## Verification And Live Evidence

2026-10-08 只读诊断在两个自有临时页复用现有页面核验和分页，删除方法明确禁用。肥皂当前投放中296条、热敷贴249条，各3页；历史48/37条均未在该范围观察到。此证据不覆盖非投放中素材，也不证明历史删除成功，不能自动解锁。所有实际 pending 原字节在交付前再次核对。

## Self-Review

默认授权覆盖任务内恢复能力；真实处置仍需用户在具体界面明确确认。原始证据、未知结果、防重删和账号范围均保留。新模块只分离持久恢复职责；原互斥与平台删除控制继续唯一拥有执行权。本计划不要求用户额外批准代码实现。
