# Qianchuan CDP Auto Reconnect

## Scope

用户要求将 Chrome 连接失败的自动重试写入程序。本轮只修改源码，遵守“先不要更新软件”：没有安装、重启应用、操作真实 Chrome、上传文件或点击确定。

## Behavior

`DouyinUploadService.execute` 在文件选择前，对可重试 `CDP_UNAVAILABLE` 和连接阶段 `TIMEOUT` 最多连接三次，额外两次分别等待 1 秒、2 秒。先安全停止旧 browser port，再重新核对冻结账号、计划和 CDP 地址，创建新 port。等待可取消；旧 port 无法安全停止时锁住原全局停止保护。

只有组内全部文件为 `NOT_SELECTED` 且不存在 selection fence 才允许自动重连。账号、页面合同错误、后续 open/upload/ready 错误及带屏障的只读恢复不进入重连。成功连接后沿原文件选择流程执行一次；结果未知禁止重传。耗尽连接次数后沿原失败分类暂停该账号，其余已授权的当前账号可以继续。不会启动 Chrome、登录或自动恢复历史暂停任务。

`attempt_count` 保留每次 execute 的计数语义；`retry_count` 仅在真正准备额外连接时增加，取消等待不增加。连接超时耗尽保留原 TIMEOUT 分类，不承诺所有连接失败均可人工重试。

## Evidence

新增 11 个行为用例：新 port、组只选择一次、三次耗尽、其他账号继续、等待取消、连接超时、账号/页面拒绝、冻结计划变更、停止失败、后续阶段错误及 UNKNOWN 恢复。首次新增正向用例在实现前出现三个预期失败，见 `.agent/harness/runs/20261001-cdp-reconnect/red.log`。

最终源码 SHA-256：`bac230db4d6dafe4666defe81e4b752298a52e496fed2e2cd10ea1642b71c813`。测试 SHA-256：`37ba9e16a42a2536ab0b0d0b06d3503994ba3ac6fcb42b3a18b30004198491c7`。

Native Harness `20261001T094852Z-629c7a29` 的上传及批量制作组为 24 文件、349 PASS、0 FAIL、0 SKIP；包括本服务 57 个用例。聚合结果为 FAIL：另一个任务的 `source-mask-auto-qualification.ts:242–243` 存在 `candidateFrame` 可能 undefined 的类型错误，同时其源码在检查期间变更。两次 `npm run build` 也被该任务的模块创建或类型错误阻塞。不能将此前 typecheck PASS 当作当前全库 PASS。

受管 Kimi read-only mapping invocation 为 `f0f9c033-2592-409e-8005-31de0a0c55b9`，receipt 为 PARSED，两次请求为 IDENTITY_VERIFIED；父线程核对并选择重连边界、计数及停止规则。该调查不是最终独立 review，也不构成平台验收。

## Governance And Remaining Work

本轮 service 的 AOCI entry 与源码 baseline 已维护，源码哈希匹配。维护按完整机器批次同时包含另一任务新建的 `source-mask-auto-extraction.ts`，没有改动其源码。随后新出现的另一任务 `source-mask-auto-qualification.ts` 尚缺 entry/baseline；Verify、Check 非对齐，Guide 为 authoring_required。没有截断维护批次、扩张索引或反复维护仍在变化的其他源码。

压缩后的 AOCI Overview 传输被宿主截断，已停止该链；未重试认知或声称完整系统认知验证通过。

最终 implementation Review Risk Gate 尚未执行：适用 project-native verification 被并行任务阻塞，不能提前消耗最终 reviewer 预算。源码修改保留在当前工作区，未提交。下一稳定检查点需要重新运行 typecheck/Harness，检查 Review Risk Gate，完成 Verify/Check/Guide，并只提交本轮源码、测试、记录及本轮 AOCI 条目；其他任务改动保留。

真实 Chrome 重连和已安装软件行为未验收。现有运行包及其暂停任务状态不会因本轮源码修改而改变。

## Final Source Checkpoint

2026-10-01 用户结束制作后授权继续。前述检查失败是历史状态；本次 Native Harness `20261001T125354Z-8eeeb8d8` 已通过 typecheck 及 24 文件 350 个上传/批量用例，另有 10 个开发生命周期用例通过，`npm run build` 成功。

开发启动器的自动 rebuild 改发独立 restart 请求，主进程等待批量、单项目制作、审阅、导出和上传空闲后正常退出；主动退出仍执行原保存和停止流程。上传 busy 包括排队中的成片准入，防止最后一个成片已完成而上传记录仍在写入时提前重启。新用例先观察到 busy=false 的预期失败，修复后通过。记录源码和测试摘要见 `.agent/harness/runs/20261001-dev-restart/snapshot.json`。

真实应用批次 `b896237f-38f0-441a-8658-6f32ee57a2df` 从界面启动蝴蝶贴、热敷贴、一条根各 3 条，本地随机、原手动覆盖、原手填文字、不上传。运行中两次真实 esbuild rebuild 后原 CDP 连接仍活跃、批次继续，最终 9/9 completed、0 failed，随后正常退出并重启。持久批次和界面核对一致；证据为同目录 before/during/progress/after JSON、after.png 及运行日志。此项证明开发重启保护，不冒充真实上传验收。

Implementation Review Risk Gate：绑定上述 snapshot，用户未要求本候选 Kimi review；连接重试仅覆盖未选且无 fence 的连接阶段，11 个重连回归覆盖耗尽、取消、目标变化、UNKNOWN 与停止失败；新增退出等待不改变持久格式、上传授权或文件选择。没有关键级不可恢复后果路径或验证后仍存在的重大语义缺口，判定 `KIMI_REVIEW_NOT_REQUIRED`。开发退出根因的受管 mapping invocation `66ae17d8-93fa-40ce-a501-c2e3344095db` 已核实 receipt，父线程验证了实际 shutdown 调用链及本次真实批次。

本次 AOCI 完整维护 3 个 managed 源码对象；scripts、tests、记录按 observe scope 保留。Verify、Check、Guide 完成，Guide `complete=true`、`stage=aligned`、`next_action=none`。其他任务源代码和索引改动保留，只提交本轮条目。

开发版已重新启动并加载修订；没有替换安装包。继续真实上传核查时发现普通 Chrome 已运行并登录，但当前自动发现忽略没有端口参数的 Chrome 内置远程调试，HTTP metadata 返回 404，直接 browser WebSocket 可连接；固定端口还可能属于不同账号。该问题另行修复和验收，不能把连接重试测试视为已解决浏览器发现。
