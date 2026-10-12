# VPS Account Serial Execution Record

## Goal And Behavior

2026-10-12 用户要求 VPS 自动化一次打开一个账号，完成后关闭，再打开下一个。本轮在原统一自动化执行路径实现 B（`remote-browser`）账号串行；本机制作和导出并发、每小批最多 9 条、账号 profile / 登录资料 / 固定出口和冻结计划保持原规则。

账号首次使用前核验同出口账号的保护状态，再通过原浏览器 owner 正常关闭其他空闲窗口。同一账号跨制作小批次复用 Chrome，所有关联制作 job 终态且成功成片均已上传后正常关闭，再处理下一账号。自动化清理也逐账号执行，仅完整 `CLEARED` 后关闭；关闭发生在账号设置 edit 锁释放之后。

每个 B 上传小批次取得原 Store 的持久 `ACCEPTED` 及完整同批接收证据后，只关闭原 targetId 绑定的自有上传页并断开其 CDP，避免已完成页面累积。普通上传仍保留 `READY` 页面。账号持有期间阻止手动浏览器操作及计划预读旁路。

`READY`、`UNKNOWN`、可能已选文件、未准入意图、配置漂移、取消、页关闭或 Chrome 正常退出失败均停止切换，保留原页面、结果及永久防重传屏障；不强杀、不自动重试、不结束历史批次、不另建队列或 profile。本机直连与 A 路线不自动关闭 Chrome。

## Owners And Scope

- 浏览器资源协调：[qianchuan-automation-browsers.ts](../src/main/qianchuan-automation-browsers.ts)。任务、确认、账本仍由原 owners 持有。
- 上传和清理接线：[douyin-upload-service.ts](../src/main/douyin-upload-service.ts)、[douyin-cdp-uploader.ts](../src/main/douyin-cdp-uploader.ts)、[qianchuan-account-settings.ts](../src/main/qianchuan-account-settings.ts)。
- 原制作增量观察：[automation-production-upload.ts](../src/main/automation-production-upload.ts)、[automation-runtime.ts](../src/main/automation-runtime.ts) 和 [index.ts](../src/main/index.ts)。
- 范围及自审：[Implementation Plan](superpowers/plans/2026-10-12-vps-account-serial.md)。没有修改 UI、共享配置 schema、定时触发账本或手动关闭保护。

## Verification

最终候选 base 为 `be3c95137e01a8af35b40301e7f3011e8be18fe8`；12 个 owned 源码、测试和计划的完整 SHA 已冻结到本地 Harness scope `20261012-vps-account-serial/scope-final.json`。服务 SHA 为 `de4f2a438f949fe2674cbc44d0cf2620fbec19d5af5295136ad07db77abd7c83`，CDP adapter SHA 为 `64907d0b3ce06d086ef47d5426abfe0ae1eef69d63b8cc732542fbc3924b10b7`。

- `npm run typecheck`：通过。
- 四个定向测试文件：50 个测试通过，覆盖五账号同时打开数上限 1、跨小批持有、完成关闭顺序、保护草稿、关闭失败、原取消及永久屏障；真实隔离 Chrome 验证完整接收后自有页关闭、其他页保留、错误 ownership / guard 拒绝关闭。
- 完整 Harness `20261012T094933Z-0516ecb0`：17/17 必需检查 `PASS`，包括定时自动化、原生命周期、千川上传、远端 worker 构建、凭据边界和本轮 AOCI。`verify` 回执 `20261012T100143Z-6e08b245` 为 `PASS`。
- 已接收页面回收先出现行为失败的 RED，再通过上述 GREEN。早期候选曾发生已有浏览器 fixture 的 5 秒确认超时；隔离复测通过，最终全量回归重新运行通过，未将旧候选的部分结果作本轮验收。

运行目录及机器日志是本地证据，不入 Git。工程测试不证明平台审核或投放结果。

## Live VPS Observation

在本机制作和自动化空闲时，通过运行中的简辑 `DesktopApi` 正常关闭安序的原 VPS Chrome，再复用予浅的原窗口。没有新增平台上传、删除或确认。原上传账本 SHA 在操作前后均为 `a208523db6231860757e1765158243e3d4a83f02e25c7d4b022e6a7aa49ded7f`。

| SSH 观察 | 关闭前 | 关闭后 |
| --- | --- | --- |
| 受管理 Chrome 主进程数 | 2 | 1 |
| `MemAvailable` | 232.1 MiB | 1629.3 MiB |
| 已使用 swap | 5690.9 MiB | 3211.2 MiB |

这是已有两个账号的实际资源观察，不能外推为五个真实账号完整上传负载或固定吞吐承诺。五账号顺序由受控测试覆盖；Windows 实机和五账号真实平台负载未评估。当前 VPS 仍保留予浅原窗口及已接收批次。

## Delegation And Review Decision

使用受管 Kimi `deep` 做只读跨模块映射，invocation `8a236464-bd87-498f-b2f1-62a065a4a840`，qualification `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`。canonical receipt 记录 Docker containment、`k3[1m]` profile、实际 wire `k3`、6 次 authenticated identity observations、`IDENTITY_VERIFIED`、退出 0、完整未截断输出；Parent 核查了具体锁和生命周期证据。映射的 `PARSED` 不是实现验收或最终审阅。

按 `/home/reggie/.codex/SUBAGENTS.md`，在上述最终 source snapshot 的 project-native verification 完成后判断一次：`KIMI_REVIEW_NOT_REQUIRED`。

1. 用户没有对本候选明确要求 Kimi review。
2. 未发现新增重大凭据泄露、跨项目权限失效或关键级持久状态损坏路径。新增 effect 限于原 owner 的正常账号关闭与持久接收后精确自有页关闭；原 Store 的接收能力、UNKNOWN 屏障及所有持久写入契约保持。
3. 草稿误关及资源切换失败会影响自动化，已通过真实 Store / Settings 集成、取消和配置漂移测试、隔离 Chrome 的目标页核验及真实 VPS 正常关闭覆盖。五账号真实负载仍有性能验证限制，但没有发现适合靠 adversarial code review 关闭的剩余重大语义缺口；未因一般并发或文件数量增加重复 reviewer。

Parent 完成最终 diff 和要求核查；未声称 Kimi 已审阅最终实现。

## AOCI And Delivery

本轮 7 个 indexed 主进程对象已通过官方完整 machine batch、CAS 和后续精确 scale / 页面回收更新维护；测试、计划和本记录按 `observe` 处理。最终官方 Verify / Check / Guide 证明当前工作树治理对齐，composite identity `fdf3e122333e2364500fd80f32e5d4abb2d6c4cc503df4c9d151f014fcc66d4a`。

正式 AOCI 资产原先已有其他会话改动，本轮只提交自己生成的 source Entry 和对应 7 个 source baseline bindings；共享全文件 fingerprint / timestamp 与其他会话的索引变更保留在工作树，不将它们混入本轮归属。官方治理事实绑定实际正式 Volume 字节，本轮各 source baseline 与最终 source SHA 一致。

仓库没有专用 session-record/capture Skill；本记录保存实现、真实资源证据、范围限制和风险门决定。交付按仓库规则提交本轮 owned 文件、推送当前 upstream 并核远端 HEAD，保留其他会话 UI 和文档改动。
