# Incremental Automation Upload Plan

## Goal And Authority

用户明确要求修改每日制作上传等待整批完成的行为。Native Codex 在当前工作树实施；此增量仅替代 [原计划](2026-10-10-scheduled-automation.md) 中组合制作上传的整批成功前置条件，保留独立上传来源及清理失败短路。

## Contracts And Owners

- `AutomationRuntime` 继续冻结模板、素材、账号、计划并拥有配方适配。组合任务在启动制作前独占登记本 occurrence 的上传消费 claim；重启或重复执行不得再制作并重传。
- 新的 `automation-production-upload.ts` 只观察原 `BatchProductionController` 同 run/job 的 `completedTaskIds` 和 `ExportQueue` 已完成且具备验证产物的记录。不得扫描目录、历史批次或另建队列、平台确认与持久任务 owner。
- 原队列内存状态可能先于主记录落盘；每次早期上传先等待原 `persistChain` 已排定的写入，再由原上传服务重新核对持久产物。适配器借用原 run/job 的取消 signal，等待落盘、准入和确认期间的取消均停止上传，不另建取消生命周期。
- 有成功成片即按原项目绑定交给唯一 `DouyinUploadService.uploadAutomation`，单次最多 9 条；串行等待原完整 READY、双层确认及 ACCEPTED 回执，同时原生产继续。成片不足 9 条也不等整批。
- 普通素材或模板制作失败不阻止其他成功成片上传，但整项自动化仍报告制作未全部成功。已取消的单项不准入其余成片，其他项沿原制作继续；正在上传或等待落盘的单项取消、整批取消、run/job 身份漂移、产物归属不一致及任何上传错误停止后续上传，只取消并等待同一原制作运行收敛；不清 UNKNOWN、fence 或确认 intent，不重试。
- 独立制作和 `uploadFrom` 保留完整成功要求与一次消费；普通手动制作上传行为不变。当前已运行进程使用原实现，不重启或接管真实运行。

## Scope And Milestones

1. 在 runtime 回归中证明制作仍忙时首次上传、9 条上限和尾批、普通失败成功项可上传、未知及取消不继续、精确身份与一次消费。
2. 复用原服务实现有限衔接，并在原上传 fake-port fixture 核对连续子批次接受及永久屏障。
3. 运行 typecheck、相关测试与 owned Harness，按 Risk Gate 完成受管只读审查、AOCI 维护，检查最终 diff 后 commit、push 并核对远端。

## Verification And Limits

可执行证据必须覆盖生产与上传重叠、无重复及失败关闭；不调用真实平台、模型或用户当前运行任务。工程通过不代表 Windows 实机、平台端到端或人工画面验收。

## Self-Review

只改组合执行的衔接；上传身份、确认能力及永久结果仍由原 owner 独占。成功项的实际上传与整项制作成功分开，不以部分成功伪造 COMPLETED。清理未完整成功仍不启动制作或上传。有限子批次可增加确认次数，首条更早开始且后续成片在上传期间自然积累；不承诺总耗时固定缩短。
