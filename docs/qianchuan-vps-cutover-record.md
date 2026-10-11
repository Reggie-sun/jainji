# Qianchuan VPS Cutover Record

## Scope And Authorization

2026-10-12，用户授权等待原 290 条制作任务自然结束，结束旧批次的本地上传资格，再将予浅、安序切到 B 方案，并允许新增九条真实素材及自动确认。原任务最终为 `BLOCKED`，成功导出 257 条；本次没有将这些旧成片重新上传。

本记录只追溯此次实现与运行证据，不建立新的权限、队列或恢复规则。合同仍由 [Upload Contract](douyin-auto-upload-spec.md#partially-registered-historical-intent-withdrawal-delta) 和 [Implementation Plan](superpowers/plans/2026-10-12-partially-registered-closure.md) 约束。仓库没有专用 session-record/capture skill，采用本记录保存 substantial implementation 与 live proof checkpoint；不写全局 memory。

## Local Historical Closure

通过简辑原 `closeDouyinUploadBatch` IPC 结束七个授权旧批次，未直接修改账本，未点击旧批次的平台确认或删除素材。部分登记的历史批次现在可归档实际 tasks/intents，并撤销整个原批次的剩余上传资格；alias 仍要求其原批次先结束。

| Evidence | Result |
| --- | --- |
| 本地已结束批次 | 52 → 59 |
| 原任务记录 | 328 条内容不变，保留原 outcome |
| 原永久选择屏障 | 285 个字节不变 |
| 原 closure | 52 条内容不变 |
| 新归档 | 七份归档 SHA 与 closure、实际登记数量一致 |

九条真实测试之后再次核对以上事实。结束本地资格不证明平台已确认，也不解除防重传屏障。另有不在本次授权目标内的历史 `DISCARDED` 记录，保持原样。

## Browser And Scheduler Cutover

予浅、安序的配置均为 `remote-browser`：Chrome 与平台上传在同一台南京 Ubuntu VPS 上运行，本机简辑负责制作、暂存传输与调度。两个账号属于本次绑定的同一主体，共用该 VPS 出口；不能解释为两账号各有不同 IP。保存与打开经原账号 API，实际出口通过浏览器探测核对；其他四个账号配置不变。

按授权正常关闭、重新打开两套 VPS Chrome，保留各自资料目录；未强杀进程或移除 Chrome 锁。重新读取计划目录，予浅耗时 24.655 秒、安序 12.341 秒，均核对原绑定计划。实际进入「千川 → 账号与计划 → 管理账号设置」，确认固定出口已启用且选择 B，随后取消编辑。

原三个定时任务重新冻结当前账号绑定：新任务沿用原请求、时间及启用状态，旧任务停用且历史保留，没有补执行已过期时段。

| Name | Time | Upload | New task ID |
| --- | --- | --- | --- |
| 日常清理 | 00:30 | 否 | `af819e98-b4e5-445b-bd06-854023409021` |
| test制作 | 04:02 | 是 | `3d364354-8099-481d-8206-0ce74127706a` |
| test2 | 16:30 | 否 | `532b7b18-f384-4696-a035-978f38f5e56e` |

首次只读重绑预检发现项目历史已同步，未产生账号或调度变更。逐一核对六个项目的素材、模板和制作设置不变；仅原 owner 排除的导出历史、最近制作、审阅历史及更新时间不同。留存证据后刷新一次 CAS，再通过原 API 完成重绑。其他会话的三个测试任务与历史未改写。

## Real Platform Upload Proof

临时任务 `3003e815-40bb-40b0-a0e2-74558d0cff78`，scheduler run `5a7f4abd-c053-4509-b268-128ea030dca2`，production run `efe0014d-7e1b-4d48-915b-c42a14526b27`。沿原制作、持久导出、远端暂存、上传与定时确认路径执行，没有重试旧任务或另建队列。

| Measurement | Result |
| --- | --- |
| 时间（Asia/Hong_Kong） | 2026-10-12 07:49:00.999 → 07:53:46.244 |
| 制作至平台确认总时长 | 285.245 秒，约 4 分 45 秒 |
| 新制作 / 导出失败 | 9 / 0 |
| 平台接收回执 | 9 条 `ACCEPTED`，九个唯一平台视频 ID |
| 实际文件总量 | 140,811,652 bytes，约 140.8 MB |
| 实际增量分组 | 1 条 + 8 条，不能声称九条同时上传 |
| 测试任务最终状态 | `COMPLETED`，随后停用 |

逐项核对文件 SHA/大小、账号与计划、文件名、attempt、页面 ownership、选择屏障、组数量及请求/响应摘要；不存在 duplicate alias。两组请求摘要不同，成功响应正文相同所产生的相同摘要不代表重放。接收证据证明平台接收及此次自动确认，不证明审核通过、实际广告投放或整片视觉质量。

07:58:04 的最终只读检查确认账号映射仍一致、调度空闲、旧三个任务停用、新三个任务启用、临时九条任务停用。

## Engineering Evidence

修复提交 `e23c9e5127070d19f072c1651303be9a9c490f0c` 已推送到 `origin/feat/qianchuan-vps-egress` 并核对远端 SHA。此前同分支的独立提交 `346c492` 修复压缩确认回执，本次真实路径使用当前运行版本。

原生 Harness run `20261011T223601Z-9c62032b` 的 16 项 required checks 全部 `PASS`，包含 typecheck、受影响上传/生命周期测试、媒体 fixture、凭据边界、文档和 owned AOCI。只读 completion verify `20261011T234208Z-54e7673f` 为 `PASS`，核对相同最终源码字节；文档记录新增后另行执行其适用的 documents / owned-aoci 检查。

受管 Kimi deep 只读 review invocation `fe259224-7c1d-452e-bd10-ff0e11e0fdd8` 绑定冻结快照，route、完整读取及 artifact SHA 已核对；Parent 调查并裁决 findings，没有未解决 blocker。reviewer verdict、工程检查与真实平台接收分别记录，不相互替代。

既有归档边界仍失败关闭：若归档写入后出现 veto 或未知保存结果，保留原归档并停止；后续字节冲突不能自动覆盖或盲重试。本次七个目标未发生该情形。既有拒绝提示的 alias 措辞不够准确属于非阻断限制，实际准入仍核原批已结束。

## Resource Observations And Limits

实例为 2 核、4 GB。以下为五秒 CPU 样本及同期系统内存观察，不是持续性能基准：

| 时间（Asia/Hong_Kong） | CPU busy | MemAvailable | Swap used |
| --- | --- | --- | --- |
| 测试中 07:50:13 | 28.1% | 1121.8 MiB | 755.3 MiB |
| 测试后 07:54:48 | 55.2% | 563.3 MiB | 1794.5 MiB |

测试成功后内存和 swap 压力仍在，不能宣称网页慢已永久解决或长期自动化已验收。此次文件平均约 15.6 MB，尚未验证九个 50 MB 文件并发、5 GB 批次、双账号同时上传或 Windows 实机。总时长包含制作与确认，不能折算为 VPS → 千川的纯上传速率；200 Mbps 是套餐峰值，不能代替持续实测。

## Private Evidence

本机证据目录：`/home/reggie/.cache/jianji-vps-automation-verify-20261012`。关键旁证为 `old-closure-verification.json`、`cutover-proof.json`、`plans-after-cutover.json`、`automation-rebind-proof.json`、`automation-rebind-cas-refresh.json`、`real-nine-proof.json`、`resource-during-test.json`、`resource-after-test.json`、`final-live-state.json` 及 UI 截图。`cutover-proof.json` 的平台验收字段仅对应上传前阶段；后来九条接收以独立 `real-nine-proof.json` 为准。

这些私有文件不加入 Git；登录凭据、cookie、原始账号配置、素材路径及原始平台标识不复制到公开记录。以上运行身份与指标用于追溯这次验证，不授予未来操作权限。
