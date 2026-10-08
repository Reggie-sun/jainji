# Qianchuan Pending Material Isolation

## Goal And Accepted Delta

用户指出历史58条未知结果不应阻止整个计划。本修订取代旧恢复计划中的“存在pending即禁止连接/整计划停止”：旧未知ID隔离保护，其他ID仍可按本次显式选择的规则清理。不得删除、改写、结束或重试历史未知记录。数据损坏、身份不可核对、历史不完整仍停止；本次新未知结果立即停止。

## Owners And Contracts

- 原recovery owner兼容旧固定pending文件，并读取同账号计划的带attempt新pending文件；新批次独占文件，绝不覆盖旧文件。所有有效pending及人工归档ID都进入保护集合。人工处置仍要求exact attempt/digest，且只结束该记录。
- 原CDP page接受本次冻结的排除集合。零展示和审核两种规则都仅勾选未保护候选；有排除集合时审核模式支持100条分页和空候选页，响应全行、DOM、offset、选择ID及精确删除数量必须一致。保留15完整自然日、72小时及投放中条件。
- 原plan owner继续持久化确认前意图；分页去重、删除后回第一页、取消和预算不变。历史保护不阻止审核后零展示或其他选定计划；引入PARTIAL结果表示本次可处理候选完成但存在保护ID。UI独立显示该状态，保留可核查的旧记录。
- 新未知仍BLOCKED并停止后续操作。账号存在PARTIAL时不自动进入全视频库清空，避免扩大保护例外；消息说明库阶段未执行。定时结果接受PARTIAL但不自动重试。

## Scope And Verification

修改原recovery、plan、page、account-plan聚合、共享结果、定时持久化及结果UI，不增加第二队列或直接平台删除API。兼容单个pending UI入口；多个pending时显示数量及一条精确记录，处置后再次运行可显示下一条，所有ID始终受保护。

先用旧58类记录与新候选同页测试复现全计划被阻断，再验证旧字节不变、仅新ID删除、重启、多记录、损坏及错身份拒绝、分页跳过整页保护ID、两种规则部分勾选、第二次未知不覆盖旧文件、PARTIAL跨规则/计划传播以及库阶段停止。执行typecheck、相关浏览器测试、owned Harness、Chrome MCP假桥接UI，稳定候选受管Kimi审查，AOCI维护，提交并推送main。开发不删除真实素材。

## Self-Review

授权变化限于未知结果的隔离粒度，从整计划缩到明确ID；不会把找不到ID解释成已删，也不取消原始证据保护。无法完整建立保护集合仍禁止执行。本次新未知与可跳过的历史未知区别明确，状态不假称全量完成。
