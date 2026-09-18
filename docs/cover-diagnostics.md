# Temporary Cover Diagnostics

## Scope

自动覆盖在当前进程的 `agentRun.items[].coverDiagnostics` 中保留受限诊断。素材与制作版本由同一个 item 的 `mediaId`、`version` 关联；诊断没有自己的持久化 owner。失败、取消、修订耗尽和 placement session 清理后仍可读取；新一轮制作替换旧 run，重启不恢复。切换项目时继续遵守现有 `agentRun` 项目隔离。

这只是观察缝，不改变覆盖矩形、补帧策略、调度、正式入队或主管门禁。检查仍最多 5 次、有效修订最多 2 次；服务错误没有重试或连接切换。

## Collection

通过现有 desktop state / CDP 读取 `agentRun.items[].coverDiagnostics`。采集时仅投影 `agentRun.id`、item 的 `id` / `mediaId` / `version` / `status` 与 `coverDiagnostics`；不要直接落盘整个 desktop state（它还含有素材路径与连接状态）。本功能不自动写诊断文件。

`schemaVersion: 1` 的 `events` 使用 `phase`（item / proposal / preview）、`turn`、`revision` 关联。preview 的 revision 为 0、1、2；proposal 的 turn 是实际 provider 调用序号，补充 inspect 不消耗原有 proposal 校验预算，但调用序号会增长。复用候选记录 `action: reuse`。

## Observations

- `validation`：经过本地校验的 action、outcome 与固定 reason code。禁止收录原始 reason、prompt、模型回复、异常文本。`stage-failed` 只代表该阶段异常，不能用于推断具体服务原因。
- `tracks`：合法化后的整体摘要与逐目标摘要。target ID 也做 SHA-256；轨迹几何按固定字段顺序摘要，列表排序后计算整体摘要。可以比较同目标哪些段发生变化，包括与预期无关的目标；摘要不提供原始坐标还原。
- 有效 revise 同时记录 `previousTracks` 和 `tracks`；下一版 sample 记录实际使用的轨迹身份。失败或非法修订不记作 applied。
- `sample` / `inspect`：请求时间/crop、实际源帧时间、成片帧时间及两侧 crop。sample 中含 requests 的事件表示将要取证，含 evidence 的事件表示已取证；不能把请求点当作已取得画面。
- 下一版 sample 的 `priorInspections` 是本次 preview 已请求过的补充检查点，仅用于追踪。当前产品仍重新抽默认 sample，不自动重放这些 inspect 点；是否实际取到应看该版 evidence。
- `lifecycle` 表示 item 准备流程结束，以及后续提交的成功/失败/取消；最终制作与导出状态仍以原有 item / queue 为准。

## Timing

时间采用同一主进程的 `performance.now()` 毫秒轴，只有同一次进程内的 span 可以互相比对；不是 UTC 时间。执行中的 span 为 `outcome: running`，结束后原位补齐 `finishedMs` / `durationMs`，失败与取消也结束该 span。

| Stage | Boundary |
| --- | --- |
| queue-wait | 原队列资源等待及准入检查；空闲时不增加让出点 |
| full-render | 调用 FFmpeg run 到命令结束并检查退出状态；不包含编译和文件验证 |
| artifact-verify | 原 verifier 验证样片文件及后续取消检查 |
| source-evidence | proposal 源图 inspect（包括其内部扫描/身份检查） |
| paired-evidence | preview 原图/成片配对 inspect（包括其内部扫描/身份检查） |
| proposal-provider / review-provider | 一次原有 provider 调用；不是网络、排队、推理的内部细分 |

文件准备、模板编译、清理等不属于上述 span 的耗时不作推断。两个素材都显示“渲染中”不证明并发；应比较各自 full-render 的起止时间与 queue-wait。记录不改变当前 preview 串行行为。

## Retention And Limits

每个 item 最多 192 个事件、131072 字节的序列化诊断（为未结束 span 保留收尾空间）；超限或不符合诊断 schema 的事件丢弃并增加 `droppedEvents`。单次制作仍受既有最多 250 个 item 限制。`droppedEvents > 0` 时证据不完整，不能将缺失事件解释为对应动作未发生。

不保存图片/图片 URL、完整 prompt、原始回复、凭据、账号、模型提供的 target 原文或本地 source path；不写入 project、源知识、placement 或导出模板。观察回调异常不能改变制作结果。

## Verification And Next Step

测试覆盖同 tick 两 preview 的真实串行准入、排队/执行/验证区分、等待中与执行中取消、验证失败、逐轨迹变化、跨 revision 的 inspect 追踪、失败后 snapshot、session 清理后保留、存储隔离及数量/字节上限。模拟模型回复测试不代表真实模型或画面验收。

下一步是用户授权后用新运行版本执行一次真实复测，并通过上述状态采集诊断；本次实现不自动调用模型、不重新运行两条素材，也不修复覆盖算法。
