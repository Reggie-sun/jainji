# VPS Two-Account Live Rotation Record

## Result And Scope

2026-10-12 用户明确要求“真实跑一轮”。通过运行中简辑的原 `DesktopApi` 创建两账号固定配方，再由原每日调度器、制作队列、远端暂存和千川自动确认路径实际执行。予浅、安序各制作并新增上传 1 条，两条均取得持久 `ACCEPTED` 和平台视频 ID；账号轮转完成，最终 VPS 上没有受管理账号 Chrome。

这是两个真实账号各 1 条的最小完整轮转验证，不是五账号压力测试或 9 条并发吞吐测试。`ACCEPTED` 表示千川接收素材回执，不代表审核通过或投放成功。

本轮没有修改业务源码、创建第二队列、直接写上传账本、重传历史视频、删除平台素材或强杀 Chrome。此前交付的 [账号串行实现](qianchuan-vps-account-serial-record.md) 和 [Implementation Plan](superpowers/plans/2026-10-12-vps-account-serial.md) 是本轮运行依据；本记录只保存真实验证事实。

## Execution Identity

- 实现提交：`56e00ca18044b1881d66fda52958e8c3b3b40571`。本轮后并发 UI 会话提交 `498142d6824c27a76f73a4b11ac37d87cb2e7810`；六个相关主进程源码与封存快照仍逐字节一致。
- VPS：南京 Ubuntu，2 核 / 4 GiB，B `remote-browser`，主体组 `阳霞`，SSH alias `jianji-vps-01`，固定出口 `175.27.166.60`。
- 任务：`b0f70b9f-bf44-4d4d-a061-4fff2220a845`，名称 `VPS 双账号真实轮转验证 2026-10-12`，时间 `18:21`，修订 0。
- 调度运行：`454e7c57-5ed1-45df-ac9b-c4dedc060a21`；制作运行：`1c0f3e2e-9b9e-4d27-b1b4-3eae99e36bd8`。
- 本机时钟：`2026-10-12T10:21:00.097Z` 启动，`10:25:26.745Z` 完成，266.648 秒（约 4 分 27 秒）。
- 配方使用已保存模板、用户原手填文字、`real-artwork` 覆盖及 `mode=random`；各 `requestedCount=actualCount=completedCount=1`，失败数 0；冻结 recipe 不含 `modelBinding`。

任务 `COMPLETED` 后通过同一 `configureAutomation` API 持久停用。后续原 `getAutomation` 再次读取证明 `enabled=false`、`running=false`、原 `lastRun` 不变；不会翌日重复触发此测试任务。其他任务未调整。

## Platform Receipts

| 账号 | 广告主 / 计划 | 导出任务 | 文件字节数 | 平台视频 ID | 接收时间（本机 UTC） |
| --- | --- | --- | --- | --- | --- |
| 予浅 | `1876024170199244` / `1876036593854788` | `2a9117d1-68f3-4be8-a652-26b0722fcc81` | 19,483,887 | `v03c8eg10000db6ba7fog65g7jnn9g9g` | `10:23:32.819Z` |
| 安序 | `1876294500004864` / `1878300169182218` | `43e4be05-75b0-47b6-b3d0-e3d0d1a47419` | 14,611,473 | `v02c8eg10000db6bb4vog65o5ba6fjp0` | `10:25:21.850Z` |

予浅成片 SHA-256：`774449f391835219f8d60dac82422c0f0adbf148677b248b46d7403e199c884d`；安序：`7cdc94798d8862cbac90ba0a81d439b9d7528555c75ca342c085fb11bd0aa9a3`。

Parent 直接读取原持久 Store 和原 `batchProductionDetails`，并重新计算两份成片与私有只读快照 SHA：文件字节数、摘要、导出身份及冻结账号/计划一致，快照权限均为 `0400`。两条都不是 `duplicate_of`，`attempt_count=1`、`retry_count=0`。

每条 `acceptedEvidence` 的完整文件名、账号、计划、`selectedCount=1`、`attempt=1`、`platformVideoId` 和请求/响应摘要存在。其 `targetId/pageBatchId/modalSessionId` 与原永久 selection fence、自动确认 intent 内 READY 证据一致；READY 观察早于 intent，intent 早于接收。持续只读观察见 `WAITING_FOR_CONFIRMATION/READY → NEEDS_HUMAN/MAY_HAVE_UPLOADED → ACCEPTED`，确认中的未知屏障由原 owner 正常闭合，没有手工恢复 READY 或再次确认。

本次 one-shot upload claim 的 SHA 为 `db0b32a6d617064383b2a557c8a56a4a0250cf1fb2a0248a27d962413281908f`，保留原 `streaming:true` 格式；它阻止重新消费同一来源，不独立证明上传成功，实际成功由最终运行与上述持久接收证据证明。

## Browser Rotation And Resource Evidence

SSH 只读观察以 `pidfd` 固定 Chrome 主进程实例，退出事件轮询约 50 ms，资源及受管理进程列表约每秒一次。按 canonical account profile 过滤主进程，排除 Chrome renderer/GPU 子进程。共 407 次资源采样，受管理账号 Chrome 主进程数最大为 1，最后为 0。

| VPS 时钟 UTC | 事件 |
| --- | --- |
| `10:24:02.743916` | 予浅原 Chrome PID `1895298` 的 pidfd 报告退出 |
| `10:24:03.950000` | 安序 Chrome PID `2286435` 的内核启动时间（`btime + startTicks/HZ`） |
| `10:24:05.518109` | 观察器发现安序主进程并持有 pidfd |
| `10:25:52.359481` | 安序 pidfd 报告退出 |

同一 VPS 时钟中，予浅退出被观察到后约 1.206 秒，安序才启动；内核 `btime` 的整秒精度仍小于该间隔。没有把每秒采样单独作为“无瞬时重叠”的证明。VPS 时钟与本机时钟不同，收尾测得 VPS 约快 26.9 秒，不能将表中 VPS 事件与上一表本机回执原始时间直接排序。

| 资源 | 观察开始（已有予浅窗口） | 两账号完成后 |
| --- | --- | --- |
| `MemAvailable` | 543.8 MiB | 2750.5 MiB（约 2.69 GiB） |
| 已用 swap | 2801.1 MiB | 574.6 MiB |

予浅原窗口期间 `MemAvailable` 最低 330.1 MiB；安序新窗口期间最低 1015.4 MiB。结果证明轮转后资源释放，没有证明平台页面从此不会占高 CPU，或任意单账号负载都能在 4 GiB 内稳定运行。

运行成功返回包含原正常关闭路径完成；Parent 核查 [remote worker](../src/main/qianchuan-remote-worker.ts)、[browser manager](../src/main/qianchuan-browser-manager.ts) 与 [browser process](../src/main/qianchuan-browser-process.ts)：仅固定实例发送一次 `SIGTERM`，等待原进程消失，失败不强杀或继续下一账号。观察器独立证明实际退出，但没有捕获子进程 wait exit code 或每次自有上传页关闭前后的 target 列表；不声明本轮独立观测了每个标签页关闭细节。

最后额外 SSH 只读核查：受管理 Chrome 数为 0，禁代理 HTTPS 访问原出口探测服务返回 `175.27.166.60`。两个冻结目标的 egress 配置完全相同；真实上传走原 worker 的 Chrome 出口校验和租约门。额外直接探测是收尾旁证，不冒充持续抓取全部平台请求的网络审计。

## History Preservation And Evidence Storage

执行前后原账本比对：原 6654 条上传任务逐项不变；本轮仅新增 2 条任务和 2 条 intent；59 个历史批次结束记录、全局上传配置及 legacy 字段不变。最终账本仍与收尾快照相同，永久 selection fences 和两份确认 intent 保留。原素材和输出文件未删除。

私有证据目录：`/home/reggie/.cache/jianji-vps-two-real-20261012`（目录权限 `0700`）。保存冻结请求、单次创建/启用意图、任务终态、前后账本、原批量详情、三路只读观察、收尾 IP/进程检查及 `verified-live.json`。Parent 的只读取证脚本检查上述身份、文件字节、接收绑定、历史不变、顺序与停用，实际退出 0、结果 `PASS`。脚本不提交生产任务、不改状态，不属于第二产品控制面；机器日志、凭据和本机私有数据不进入 Git。

## Independent Oracle And Parent Decision

受管 Kimi 做只读跨模块 QA 取证建议，invocation `cd24722a-02f3-4b98-96ee-39293e1e505a`，seal `8d21961a8b9d64422acfa570a464b24b2cc016a559194d91dbfb5f26f2ecedee`，qualification `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`。canonical receipt 与运行返回完全一致：`deep/k3[1m]` route，实际 wire `k3/max`，4 次 authenticated identity observations，Docker containment，10 份完整未截断实际 Read，进程退出 0、报告 `PARSED`；原 report SHA `6504c42d6d733b6f6d49e2520c83b3453e4f59336a3d541a93334dfe112b59f8`。

Parent 没有将 `PARSED` 作为验收。对 oracle 的缺口逐项处理：实际 Chrome 关闭由原 owner 源码和 pidfd 退出旁证补足；采样漏瞬时重叠由退出事件及下一账号内核启动时间补足；同出口、一次性 claim、持久接收、文件摘要、原记录保留及停用均直接核验。oracle 建议“终态 claim 补 exports”不是当前 streaming owner 的合同，未据此改写 claim。子进程退出码、每标签页完整 trace、平台审核状态和五账号真实负载保持未评估。

本轮仅新增运行记录，没有业务实现候选变更，`KIMI_REVIEW_NOT_REQUIRED`：用户没有要求 implementation review，记录不引入权限/凭据/持久状态 effect，也无需要 adversarial code review 关闭的新增重大语义缺口。既有实现 review 决定仍在前述实现记录中，本 oracle 不被改称实现最终 reviewer。

## Repository Verification And Delivery

本轮记录按 AOCI `observe` 处理，不创作源码 Entry 或扩大索引；通过 owned Harness scope 执行文档检查及官方 AOCI Verify / Check / Guide。本轮未改业务源码，之前的类型检查、50 项定向测试与 17 项必需 Harness 检查保留各自快照边界，真实平台证据由本轮提供。

仓库没有专用 session-record/capture Skill，本记录保存这次授权真实运行。仅提交本记录、推送当前 upstream 并核远端 HEAD，保留并发 UI 提交和其他会话未跟踪文件。
