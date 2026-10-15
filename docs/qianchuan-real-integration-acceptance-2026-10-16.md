# Qianchuan Real Integration Acceptance

## Status And Scope

2026-10-16（北京时间）继续验收 [Spec](superpowers/specs/2026-10-15-qianchuan-real-integration.md)。第一次只读验收的候选为 `feat/qianchuan-real-integration` 的 `adc223c3c7b85a645947f5a90518dd79ecf59a68`，沿用 [Implementation Plan](superpowers/plans/2026-10-15-qianchuan-real-integration.md) 与 [Implementation Evidence](qianchuan-real-integration-2026-10-15.md)。下文至 Authorized Continuation 前保留第一次只读验收快照；续验新增产品实现、显式保存映射与一条真实上传见后续章节。**整体为 PARTIAL；真实投放闭环和 M3 未完成。**

最终工程候选位于 `feat/qianchuan-real-integration-acceptance`，最新工程证据见 [Final Engineering Checkpoint](#final-engineering-checkpoint)。它通过工程检查与第五轮原生复审；创建、预算/ROI 及启停的真实验收仍按 [Current Acceptance Matrix](#current-acceptance-matrix) 保留缺项。

用户随后明确要求 merge；与当前主线的合并候选及独立验证见 [Main Merge Checkpoint](#main-merge-checkpoint)。主线合并不改变本报告的真实平台 PARTIAL 状态。

第一次只读验收中，用户要求自行读取测试所需信息，经既有应用公开只读 IPC、平台现有页面、保存项目目录及原上传账本获取事实；当时没有新的金额/次数/期限授权，也未制作、上传、确认、删除、创建、调价、启停或切换平台账户/推广模式，没有调用模型或供应商接口。后续明确授权及真实操作不追溯改变该快照。

## Runtime And Evidence Boundaries

- 原目录正在运行的 Electron 没有 `captureQianchuanReport`，不能冒充本分支运行。本次真实平台请求经该进程的原 `queryQianchuanBackend` owner 和既有 guard 执行；返回 DTO 再交给本分支 capture/store/export。两处磁盘的 backend adapter SHA-256 均为 `300695c8ef1b79cfb0759e7cad09319925d716dd0366f8b61f1b706f5bb4e189`；这不证明运行进程载入了本分支的新协调器。
- 分阶段读取复用已观察的第一页，后续页冻结相同账户、计划、日期与 asOf；不是一次经本分支共享租约完成的真实 UI 采集。平台响应、候选归一化/持久化和完整端到端验收分开记录。
- 本分支另以 `npm run dev` 启动真实独立 Electron，实际使用 `instances/1`；未复制账号配置、登录资料或原上传账本。Chrome DevTools MCP 1.11.0 仅对该窗口完成导航及本地停止交互，未以模拟 IPC 代替 main。
- 首次启动因执行环境没有 DISPLAY 失败；从原 Electron 获取桌面变量的尝试也未取得 DISPLAY。随后核验当前 Xorg `:1`、Xauthority 和 `xdpyinfo`，只给本次开发进程设置桌面环境后启动成功。失败日志保留，未修改宿主显示设置或其他程序。

## Real Reads And Persistence

固定统计日为 `2026-10-15 00:00:00` 至 `2026-10-15 23:59:59`（北京时间），未使用跨日后的“今天”替代原窗口。ID 全程按字符串保留。

| 保存槽 | 广告主 | 计划 | 真实读取结果 |
| --- | --- | --- | --- |
| 氨糖膏 | `1876036793517065` | `1876052012647452` | 商品 `3842135719464271937`；预算原值 `500000000`，ROI 目标 `1.94`；完整素材 258 条，offset 0/100/200 |
| 滴耳康（显示名一根金） | `1876131703522649` | `1877582409449488` | 商品 `3845278342538461470`；预算原值 `100000000`，ROI 目标 `2.18`；完整素材 132 条，offset 0/100 |

390 条素材均有精确视频 ID、无重复素材 ID，严格 schema、冻结窗口和总数校验通过。实际 `QianchuanReportStore` 写入本机私有验收目录后，两个账户重读内容完全一致，交叉账户过滤均返回 0 条；另一个 Node 进程重启读取同样一致。目录/文件权限为 0700/0600。CSV 共 1,560 行指标，以标准 CSV parser 逐项核对账户、计划、素材、视频、原值与显示值一致；不平均 ROI、不推断未知单位。

原账本稳定只读快照中，这两个账户/计划共 2,405 条结果。严格结果 schema 后，氨糖膏 12 条历史 ACCEPTED 全部匹配 12 条真实素材，归因 CSV 为 48 行指标；其余 1,864 条不被接纳为归因证据。滴耳康对应计划的 529 条均未 ACCEPTED，归因 CSV 无数据行。未将 READY、待人工处理或历史授权升级为接受结果。

另核验其中一份历史成片：原 export task `aea3467f-4dbf-475b-bdfe-bb141a16b6a3`，文件 SHA-256 `3d790f1980eb521339c78adac63166645cd43a4c1caa85619c6ce8101e82a2ca` 与原冻结输入一致；原 `ArtifactVerifier` 使用应用 FFmpeg/FFprobe 核验可读视频，60,732,242 bytes、129,149 ms，检查前后文件未漂移。该接收记录来自 2026-10-11，不是本轮新制作/上传，未进行人工观看。

## Platform Reconciliation And Identity Findings

REA 6.4.0 本次重新执行被动发现及观察，未导航、点击、求值、读取 Cookie 或导出认证头。滴耳康发现证据为 `ev_f2043689480734c68913998f368e8fadb87e3426b81c7da309af24f010905c65`；概览及素材页观察分别为 `ev_a140e9f970b68430f586b5ab3fb4629b17fd7c40fe664604c0d96f94421c7120`、`ev_596ccc12fb038285a2fbce5cacd14bc15b6413da7b71a47db15978a3ee8e5111`。观察为 `policy_filtered` / `attach_limited`，无截断；没有附着前网络正文或完整写配方。

同一滴耳康账户当前页面显示计划 `1878488818847384`，**不是保存的计划 `1877582409449488`**。页面上该计划投放中、控成本、每日预算 5,000 元、净成交 ROI 目标 1.95，关联商品为按摩油 `3847118098272485669`。原查询 owner 对该已观察计划的独立只读回读确认相同计划、商品、ROI 和预算原值 `500000000`。预算换算仅在该对象有页面旁证，不扩为所有预算类型的资格。

同账户、同统计日的汇总回读显示消耗 20.21、订单 1、含券成交 19.90、支付 ROI 0.98，与 REA 页面最新显示相符。页面也保留了部分较早 DOM 数值，不能将整个 DOM 当成同一时刻的原子快照。净成交目标与支付效果 ROI 分开。该页面计划的素材固定读取返回完整 71 条，其中当前可见的 10 个素材 ID 均精确匹配；归一化、持久重读及 284 行 CSV 指标通过。由此共观察到三个计划的 461 条素材；素材过滤范围不代表完整计划或所有推广模式的总量。

氨糖膏绑定 profile 的一次只读元数据观察显示另一个当前子账户；随后 REA 发现时端点已不可达。本次未重连、切换、重启或重试该浏览器，也不把 profile 名、保存锚点和当前子账户混为一体。

原应用公开目录另读到 19 个保存项目，包括“氨糖膏”“老氨糖膏”“一条根”“按摩油”等；保存的模板账户绑定与平台具体商品/计划是不同证据。没有凭名称把“滴耳康”模板自动配到“一条根”或“按摩油”计划，也未加载项目覆盖用户当前工作区。

## Initial Read-only Acceptance Matrix

| Spec | 当前结论 | 证据与缺项 |
| --- | --- | --- |
| A01 | PARTIAL | 无供应商/API 的两个账户、三个计划及素材真实读取；一个账户汇总和可见素材核对。可投商品资格目录及全部模式未验收 |
| A02 | NOT_EVALUATED | 历史接受 → 视频 ID → 素材 → 原成片字节已核对；没有本轮新生产上传回执，历史证据不补此项 |
| A03 | BLOCKED | 未取得创建/绑定完整写配方及逐对象真实受控提交证据；生产未注册写 adapter |
| A04 | NOT_EVALUATED | 当前值可读；没有新的目标值、有限写授权、一次提交和独立回读，不改当前投放 |
| A05 | PASS（隔离） | 原最终候选提交后取消/迟到回包/重启 UNKNOWN、防重发证据，经本次 completion 重验；无真实故障花费注入 |
| A06 | PASS（隔离） | 原最终候选精确金额、过期/漂移/并发额度和零提交回归；无真实预算消耗 |
| A07 | PARTIAL | 两个广告主读取和持久过滤隔离；无两个 shopId，也无真实跨账户成片/写操作验收 |
| A08 | PARTIAL | 同日账户汇总页面对账、461 条素材及 12 条历史精确关联；缺本轮新视频、完整计划层级指标与口径准入 |
| A09 | PASS（工程） | 最终候选取消/隐藏/换号/迟到历史 fixture 与浏览器证据仍匹配；非真实写权限 |
| A10 | PASS（工程） | 原 23 项 required Harness 均通过，本次只读 completion 重验 PASS；无源码变化，不重复整套回归 |
| A11 | PARTIAL | 实际独立 Electron 的新 IPC 和 Chrome MCP 操作通过；未配置账号时采集/历史禁用，店铺未知与本地停止提示正确。新协调器的真实账号端到端 UI、平台写入及 Windows 仍未评估 |

## Verification And Remaining Gates

原完整 Harness 为 `20261015T151142Z-63ab3661/receipt.json`（23 项 required PASS，新增接入 89/89），本次重验为 `20261015T160659Z-e5fed554/receipt.json`，exit 0。一次将 `--help` 传给不支持该参数的 Harness verify 被拒为 NOT_EVALUATED，随后按当前 CLI 合同执行上述完整 verify，不计前者通过。当前官方 AOCI Verify / Check 均 exit 0、治理 aligned；未改受管理源码，无新增维护。Overview 严格 Challenge 7/10，不声明完整认知可靠。

还需完成实际平台写配方、账户/模式资格、正常授权入口与有界真实执行；读取当前商业配置不能签发新执行权。新上传继续服从原队列、READY/UNKNOWN 与防重传 owner，不能为测试清除旧屏障。两家真实店铺、Windows 持久化资格及人工媒体验收仍独立缺失。

本轮证据保存在本机私有目录 `/tmp/jianji-real-integration-20261015/`；`acceptance-evidence-manifest.json` 绑定 40 份原始只读 DTO、严格快照、CSV、REA envelopes、原账本摘要、成片核验及实际 Electron 记录的 SHA-256，manifest 自身 SHA-256 为 `8a0afb865c3b0ccc43dda845fcf17fa23ee97581e799fe57b447cba9d34b4e08`。原始业务数据、脚本、图片及 CSV 不提交 Git；临时目录不是产品报表数据库。测试结束后，本次独立 Electron 和开发 launcher 已经原正常退出流程结束，未关闭原应用、原 Chrome 或平台任务页。

## Session Capture Decision

本轮有实质真实只读与运行证据，以本报告记录；仓库未声明专用 session capture Skill。不写 Codex memory，不新增 bug-memory，不将只读/隔离证据声明为完整 Spec 验收。未改变产品语义，沿用既有最终审查，不追加 implementation reviewer。

## Authorized Continuation

用户随后授权继续计划差异处理及真实写入验收，执行边界见 [Continuation Plan](superpowers/plans/2026-10-16-qianchuan-live-acceptance.md)。上文为第一次验收快照；下列为本次新增证据，整体仍为 PARTIAL。

账号设置新增显式目录选择：分别展示已保存目标与链接草稿，展开后复用原 `QianchuanPlanSelect`。同账户明确选择只改链接，保存沿原 owner；取消还原原链接并保留其他编辑，保存绑定变化清除旧选择，保存中锁定控件。用户明确选择执行单 A 后，经正常主进程 `saveQianchuanAccount` 将账户 `1876131703522649` 的默认计划保存为 `1878488818847384`，回读一致，产品名“一根金”与出口设置保留。没有调用历史 retarget 或结束旧批次；新设置不迁移旧任务。

### Observed Platform Forms

表单调查阶段只操作账户 `1876131703522649` 的自有 target `1AFA592B28F19A1D37464C580F84489E`，原四个用户 target 保留。当时保存计划为 `1877582409449488`；实际核对的按摩油计划为 `1878488818847384`，商品 `3847118098272485669`，控成本投放、投放中、CNY 日预算 5000、净成交 ROI 目标 1.95。固定读取返回预算原值 `500000000`、`budgetMode=0`、`modifyTime=1791711779`；单位转换限定已观察的商品控成本每日预算模式。后续保存变更见上段，不把调查快照冒充当前映射。

| Surface | 实际观察 | 准入结论 |
| --- | --- | --- |
| 整页编辑 | 包含商品、预算、ROI、素材、三条既有标题、优惠券和 AIGC；退出出现未保存信息确认 | 不能把整页保存直接当成单项调价；未保存 |
| 独立预算弹窗 | 当前 5000；明确提示范围 300～999,999,999.99 元，独立取消/确定 | 已定位参数与提交点，未点确定；缺真实提交/响应及独立回读验证 |
| 独立 ROI 弹窗 | 当前 1.95；建议不超过 4.7，约整体支付 ROI 5.34 | 建议值不是强制允许范围；未点确定，缺写响应验证 |
| 创建页 | 默认放量、只有“发布计划”，未证明暂停创建；商品目录明确提示按摩油在该抖音号下已有控成本计划，并指向上述实际计划 | 当前商品创建 BLOCKED；未换其他商品、抖音号或模式，也未发布 |
| 暂停/启用 | 只核对到投放中状态 | 独立操作与响应配方仍未验证 |

REA 被动观察证据分别为编辑 `ev_bd1c22d3d56be58cd4a84908c1092d5a80b53003faa539cba2e7042aff66b3cd`、创建 `ev_e93502ceb16571746590279e8938b0e97aca1c5c84ed15a2a5fd666a35befc80`、商品限制 `ev_1d149c1637eb1111274b76ee9506cfab678e6737dcc5b53c04b40870c9e6bfd7`、预算弹窗 `ev_92985571bd969ce1ce8a3f353820abae399818695e7cc7236a43ad195c7f5307`、末次计划读取 `ev_d80da085112ef82b3ef46eac9cfc379766a34339b5b8102e7fc4dde289260eb3`。均为 policy_filtered / attach_limited，非完整写网络证据。ROI 弹窗有 Chrome MCP / 定向 Playwright 观察；REA 补采时自有页已到时退出，返回 target_unavailable，此项不计 REA 成功。

取证脚本最初漏用后台页轮询设置；按原查询 owner 的 `polling:250` 修正后身份核验成功，未弱化产品 guard。独立调价入口需实际 hover 后点击图标；早先文字/图标直接点击未打开表单，不计成功。自有页达到 15 分钟上限后由原 page owner 清理，脚本 exit 1 的 timeout 保留；随后 `/json/list` 证明自有 target 缺席、原四个 target 全部仍在。Agent 未触发保存、发布、调价确定或启停提交。

证据位于私有 `/tmp/jianji-real-integration-20261016-live/`。`platform-evidence-manifest.json` 绑定 83 个文件，SHA-256 `232d35a476cbc8a98cd5d7fd4f5dcd683ce5ce7cdadfa80fb65ad413ac6f587a`；浏览器资料、凭据及原始业务响应不提交 Git。Mapper 曾误调用原 checkout 的 CodeGraph index，更新了原 `.codex/codegraph-index.json` 缓存；没有改原业务文件，旧缓存前像未知，未重置或删除该共享缓存。

### Approved Execution Sheet

用户明确选择 A：账户、商品及计划为上述按摩油目标，保存默认计划、新制作上传一条，ROI 1.95→1.96、CNY 日预算 5000→4999、暂停及启用各至多一次；预算上限 5000.00、累计增加 0.00。保守截止时间为 `2026-10-15T17:44:46Z`（北京时间 01:44:46），不因验证延迟顺延。创建受商品冲突与初始暂停语义缺证据阻断，不提交、不更换商品或模式；未知结果不重试或自动回滚。

### New Original-owner Upload — A02

正常主进程于 `17:02:35Z` 启动唯一一条授权制作：run `0236417d-47be-4a7e-8ec7-10162bce89c7`、job `e79c91da-86fd-4a9b-af4e-677e3ce9bf0c`，使用已保存按摩油项目、本地随机及原人工图案覆盖、原手填文字，不调用模型、不新增文案。原队列 task `1d6f0cc8-e494-4127-8ee0-f61735535238`、attempt 1，于 `17:03:20Z` 验证并发布；文件 82,208,038 字节、174,200 ms，SHA-256 `c7837cad7f07df8e0a39c251d87b1165b3b009d1f93fe6e4a48593159deeb763`。这证明文件与原导出链，不代替整片人工观看。

原上传 task `72f938840c234ac3340091d4483917808a0c2e5e864c19487218d1c4c6fc10e8` 于 `17:04:14.347Z` 获得 `ACCEPTED`，精确绑定账户 `1876131703522649`、计划 `1878488818847384`、文件名及唯一视频 `v03c8eg10000db8gf3vog65l0gtdteh0`。请求摘要 `cbef92a1ca54b068a6d1cce4bdf3fbc54dc06e62b8e47e4c53b3ac0b7861dc8e`，响应摘要 `621cd24be3c3c9c25c6a426c9c3c8753609c4afaed188af8b1cd5b833fa0fab1`。观察器先看到 READY 后因原开发实例正常重启断连；只读重连读取原账本确认结果，没有重建任务、补传或补点确认。

随后经正常主进程原固定读取接口，以同一冻结时窗读全该计划 122 条素材，于 `17:10:34.076Z` 唯一匹配新视频到素材 `7696941373912219699`。因此 A02 本案例满足“新成片→原上传回执→同视频计划回读”。匹配时平台四项指标原样返回零及 `0.00`；不推断后续收益、审核或归因延迟已结束。证据为私有 `approved-single-start.json`、`approved-single-after-restart.json`、`approved-artifact-identity.json`、`approved-new-video-match.json`。

### First Qualification Implementation And Remaining Admission

首次验证已接入同一个 `QianchuanDelivery` / store 的 reserve、submit、readback、settle 链。main 在原账户租约内生成五分钟预检，绑定 sender、配置摘要、精确草稿与配方证据；明确确认签发一次许可，普通授权仍要求 live-write-verified。预算与 ROI 仅使用自有页独立弹窗，不保存包含标题、素材、优惠券及 AIGC 的整页。持久审计记录 qualification provenance，UNKNOWN/PENDING 阻断该广告主后续写入，重启不恢复许可；成功也不自动推广能力。

产品 adapter 的前一版本已在真实自有页完成 5000.00→4999.00 的只读预算预检并清理，未点击确定。原后台页 native hover 因动画帧暂停未稳定的失败保留；修复仅聚焦本次自有页，不弱化账户/文档校验。父级另发现计划 ID 文本前缀匹配缺口，新增错误长 ID 的 RED 反例后改为完整数字匹配。期限修复后的 recipe 为 v2；前一版本的成功预检不代替当前 recipe 的正常 main 验收。

### Deadline Repair And Normal Runtime

原生 `reviewer_xhigh` 第三轮在 immutable `review-live/manifest.json`（SHA-256 `b48052a022ea098b2d732e8c464507f2d1c86401d8183c201c1ae05570c23650`）复现 QLIVE-001：进入 adapter 时有效，但查询或按钮等待可能令实际点击晚于授权期限。Parent 确认，保持真实财务提交为零。修复把冻结期限传至 adapter，绑定原文档原 DOM 元素，并在捕获 click 事件时检查期限、连接状态及冻结目标值；点击等待受剩余授权时间限制。最后读取跨期、按钮等待跨期、事件时钟跨期及输入漂移反例均先 RED 后 GREEN。此修复尚须绑定新快照的完整 Harness 及同一 reviewer 复审，原第三轮不证明新代码已审。

正常主目录运行切换前确认无活动导出/上传或自动化；只读逐项比对 14,834 份 primary job JSON（106,900,859 字节），原 schema 与候选 schema 均能读取，无不兼容项。原应用正常退出后，以 worktree 的 `make frontend` 复用原主目录，未另建真实数据 owner。原主目录随后提交 `6c8935708e71024eec432d7d8e2b15d1c32a88b5` 的本机会话兼容修复；候选旧 storage 不接受该会话格式，用户正常登录仍不能恢复。续验直接移植该提交的 storage、对应回归及合同说明；不解密或复制凭据，本机签名核验和云端配置绑定保留。当前四文件聚焦验证 60/60、typecheck exit 0；`17:44:19.106Z` 正常主进程返回 `allowed / offline-admin`，不是旁路授予权限。

原授权于 `17:44:46Z` 到期，未顺延，真实预算/ROI/启停提交仍为零。随后当前 main 的只读预算预检等待“请输入预算金额”弹窗超时，尚未点击确定；不能将旧版私有预检或 fixture 通过写成当前 main 成功。登录已恢复与表单是否准入分别记录。

`18:00:11.538285Z` 对原 `qianchuan-delivery/state.json` 做文件身份稳定的只读核对，version 1、records 0，SHA-256 `7aae0c9795ac2243505a4b797593feadc7e2ae8e20dc5ace2d7f9f3f0bf3186f`；本轮预算/ROI 的 confirm-intent 与 result 文件均不存在。此旁证只证明本应用账本与本轮调用记录，不证明平台没有其他操作者的写入。

正常 main 的有界只读诊断确认原生 click 到达正确编辑图标；另一次等待记录到表格重建、图标隐藏及 `ovui-sticky-bar` 拦截，输入框始终没有出现。单独悬停、居中滚动及复用原目录稳定读取的候选均未消除真实故障，已全部撤回；页面 source/test SHA 恢复为期限修复候选的 `5751ba42ec9e126e6b390045e0da09ec28b767965cb8b5db0fc66e1519f0b5ec` / `4a1f49c0a8caf10cef3ec84c53e605921102cc79b7e2cd201a97852e19e90ab0`。临时 hover 反例只证明 fixture 时序，sticky-bar fixture 在旧代码也能通过，均未作为真实修复或回归证据保留进源码。只读检查该图标点击 handler 的禁用值为空，不能据此声称平台拒绝了账户权限；真实表单打开缺口仍未解决。没有增加强制点击、直接网络提交或业务重试。

`17:55:59.960Z` 核实主目录另一个 launcher PID `1847771` 已接管正常实例，cwd `/home/reggie/vscode_folder/jianji`、HEAD `6a5555e1bddd201f10af25d58f6b75fe783a5807`，页面 `http://127.0.0.1:46837/`。该实例会员 allowed，但 prepare/confirm API 均不存在；原 worktree launcher 已正常退出。Agent 未启动或终止这个新 owner，不把它当成候选，也未再次抢占主目录；后续 ROI 预检因旧实例端点已关闭而没有到达平台。真实续验还受运行实例与已过期执行单两项边界阻断。

浏览器元数据在 `17:30:38.105Z` 显示：原四个 target 中 `32A01F368779F1AFE9445C5685273024` 仍在，另外三个已缺席，新上传的 ACCEPTED target 仍在。Agent 没有对这些用户/上传页调用关闭或导航；缺席原因未能归属。不以较早“四页仍在”的快照声称当前全部保留，也不为恢复快照自行开关页面。

独立 Chrome DevTools MCP 使用本地 mock 验证保存目标与执行目标分开、显式 prepare/confirm 各一次、精确金额期限及 UNKNOWN 禁重发；桌面与 800px 窄窗无横向溢出。375px 小于现有 760px 产品最小宽度，未扩大本轮 UI 范围。此证据不是平台写入。最终 Harness、原生风险审查及真实预算/ROI 提交结果另行记录；截至本段证据时，预算/ROI 真实提交仍为零，暂停/启用配方未准入，A03/A04 未通过。

### Current Acceptance Matrix

| Item | Result | Evidence And Remaining Work |
| --- | --- | --- |
| 保存计划差异 | PASS（本案例） | 用户显式选择后沿原 save owner 保存并回读 `1878488818847384`；历史目标不迁移 |
| A02 新制作上传 | PASS（本案例） | 一条新验证成片、原 ACCEPTED 回执、同视频精确素材回读；不代表人工观看或后续投放效果 |
| A03 创建/绑定 | BLOCKED | 按摩油已有控成本计划，且发布页初始暂停语义未核实；未替换对象 |
| A04 预算/ROI/启停 | NOT_EVALUATED | 真实提交为零；上次正常 main 预算表单预检失败、recipe v3 未真实写验、启停 recipe 未准入，原执行单过期 |
| 正常 main 续验 | NOT_EVALUATED（主线合并后） | 历史核验中候选曾恢复 allowed，后续实例没有候选 API；本轮只验证合并树，未重启或重新核验运行实例 |
| A01/A07/A08/A11 | PARTIAL | 保留第一次快照缺项；新增单视频链不补可投商品目录、第二店铺、全部模式或 Windows |

续验保留旧账本和未知屏障；不以工程验证、正常登录、被动 REA 或单条上传替代完整 Spec 验收。本报告继续承担主动 session record；不写 Codex memory 或新增独立状态 owner。

### Round Four Findings And Candidate Isolation

S4 的完整 Harness `20261015T175344Z-b41ae724` 为 20/20 PASS，completion `20261015T180545Z-93734a8c` 为 PASS；对应 immutable manifest SHA-256 `4d9cc7cbbb296c024d32e4c96e17f88f39ec9b1732213510cad7f97b3be803cd`。第四轮原生 `reviewer_xhigh` 仍发现 QLIVE-001：main 绝对期限不能直接与远端 browser 的墙钟比较。Parent 用 Chromium fixture 复现时钟落后 60 秒时迟到点击一次、时钟超前 60 秒时误拒有效点击，确认阻断。QLIVE-002 为明确未点击的期限拒绝被记为 UNKNOWN，隔离反例亦确认。

最终候选用浏览器单调时钟样本、收到样本后的 main 剩余时间及 10ms 保守余量形成事件期限；绑定最初 Document，且原生调用超时后保留 guard 到自有页面销毁。明确尚未派发原生点击的到期返回 NOT_SENT，保留首次许可消费；已派发或不能证明未发送的结果仍 UNKNOWN。另两个 Chromium 反例分别复现了末读后换文档仍能点击、调用超时清除 guard 后迟到点击一次；同文档可见账户或 URL 在按钮等待期间变化的两个反例也复现旧代码仍提交，均先 RED 后 GREEN。事件中同步核对固定 origin/path/aavid 和唯一可见账户。当前相关五文件 77/77、typecheck 通过，尚不把此结果声明为第五轮复审或真实调价成功。

S4 复审期间原 `aa7c` 目录出现其他会话的账户设置、浏览器出口恢复、相应测试/文档及正式 AOCI 改动。只读发现依赖 SHA 变化后，原 S4 回执仅证明当时冻结候选，不再证明该目录当前状态。所有原目录工作保留；本轮从 immutable S4 只迁移 26 个 owned 文件及本报告到独立 `qianchuan-acceptance-final/jianji` worktree，分支 `feat/qianchuan-real-integration-acceptance`，迁移时 38 个 S4 上下文 hash 全部相同，再进行本轮安全修复。原目录后来发生的改动未被复制、覆盖、stage 或提交。新 worktree 仅运行隔离验证，不重启真实应用或重用过期执行单。

### Final Engineering Checkpoint

最终 S5 以 `c112270e4eaeb245aa1d92c5400b04db40e6de22` 为基线，绑定 26 个工程 owned paths 和 38 个源码/合同上下文；私有 `review-live-round5/manifest.json` SHA-256 为 `63d8eb49fcee303abb3203c74af8ce033b30f395aca35b2c1dad21013c8df2f3`。完整检查及 completion 后逐项核对，38 个 hash 均未漂移。本报告单独属于文档 scope，不在该工程冻结快照内。

| Evidence | Result | Identity |
| --- | --- | --- |
| 完整 scoped code Harness | 20/20 PASS | `20261015T182049Z-b41f36fd`；receipt SHA-256 `3d59ad0c3e73a6cb3f9fc8a278f6f847747aa72fbe387fe82a38a68cb5a05fb5` |
| 当前字节 completion | PASS | `20261015T183300Z-3e9b0601`；receipt SHA-256 `2ec7caf1636e8758587823448522d10816ff736679832b824f0217d7d4437fc3` |
| 相关回归 | 千川接入 129/129、原上传 967/967、会员 99/99 | 包含独立 Chromium 表单 fixture；没有真实财务写入 |
| typecheck、文档与 owned AOCI | PASS | 同一 20 项回执；官方 Verify / Check / Guide 对本轮对象对齐 |
| 第五轮完整原生复审 | finding set 为空 | `/root/live_delivery_review`、`reviewer_xhigh`、read-only；绑定上述 S5 和两份回执 |

原生 profile `/home/reggie/.codex/agents/reviewer-xhigh.toml` 的 SHA-256 为 `bde2005d4e5a0f3b308a821744f9c2f9b6d84a4eb8506c17f7086cd41c366905`，配置为 `gpt-6.1-sol / xhigh`；不冒充外部 Provider、隔离容器或费用证据。可观察结果为 reviewer 核对全部文件及回执 hash，并报告完成 8 组内存期限、时钟偏移、重复点击和账户/URL/输入/Document 漂移检查。历史五轮及原先追加的有限预算全部保留，未因隔离新 worktree 重置。

Parent 根据已复现的 Chromium RED/GREEN、当前源码及完整回执裁决：QLIVE-001 在 S5 已修复，事件期限保守映射至浏览器单调时钟，并绑定最初 Document、输入、唯一可见账户和固定 URL；原生输入派发后，guard 保留到自有文档销毁。QLIVE-002 在 S5 已修复，受信任 adapter 明确证明尚未调用原生点击的到期结果沿原 store 结算 NOT_SENT，原单次许可仍已消费；已派发或不能证明未发送的结果继续 UNKNOWN。当前工程没有未裁决阻断；reviewer 的空 finding set 本身不构成产品或真实平台验收。

私有 `final-acceptance-evidence-manifest.json` 明确列出 40 份续验证据，SHA-256 `09652791981a854b3c241e8901777c519d3d5b58cdaa0ff34226b94e342a7d53`，包括原上传链、零财务提交核对、失败诊断、运行 owner 变化、RED/GREEN、AOCI、S4/S5 及最终 Harness/completion。未递归收集浏览器资料或凭据，原始业务响应不提交 Git。

真实验收停止于可核验边界：保存映射与 A02 新上传本案例通过；当前商品创建仍 BLOCKED，正常 main 独立表单预检缺口尚未关闭，暂停/启用 recipe 未准入；授权已于 `2026-10-15T17:44:46Z` 到期，预算/ROI/启停提交均为零。该阶段核验到的主目录运行 owner 不属于当时候选，未被接管；后续主线合并未重新核验运行实例。后续须在正常候选 runtime 先解决并通过表单预检，再取得有效有界执行单；不能沿用本次过期授权或重传已接受的视频。

### Main Merge Checkpoint

用户明确要求 merge。本轮以 `main / b98a9501e8343b728700c07703d3d84184fc7425` 为主线前像，合入验收分支 `d78ac19d572b22435d65cf3772bdcfccfd10a81e` 及其两个祖先提交，保留主线已有的宽边框、历史续传、子账户清理及固定出口恢复实现。

五个冲突文件均按两边实际代码裁决：Harness 两组新增检查和路由并存；`resume` 保留主线的 `historicalPageBatchId` 参数、历史准备保护，以及分支的账户租约互斥；UI 测试同时保留新增目录选择场景和主线的子账户参数化用例。自动合并产生的重复会员说明仅删除分支的重复副本，主线原说明保留。AOCI 从已登记的主线前像，经官方删除旧 renderer 路径条目及完整 20+6 批次更新，登记 26 个合入对象；现有非目标 Entry 和 Baseline 对象逐项比较无变化。官方 Verify / Check / Guide 对齐。

共享主目录后来出现另一会话的 7 个未提交启动文件。本轮最初 scope 误含这些路径，已停止该运行并修正为 53 个工程 owned paths，不将它计为通过。修正后的共享目录运行 `20261015T190748Z-1c6524fd` 虽然 23 个检查项均 PASS，但期间 `scripts/dev-start.sh`、`tests/dev-start.test.ts` 改变，整轮 workspace-identity 为 NOT_EVALUATED；这份回执不满足 completion。所有这些改动均保留、未 stage、未复制或提交。

最终复用 `/home/reggie/.codex/worktrees/qianchuan-acceptance-final/jianji`，建立本地 `verify/qianchuan-main-merge-20261016` 分支，以同一主线前像重建 53 个工程路径及本报告。验收分支原提交和远端保持。报告本节更新前，两处暂存区完整 Git tree 均为 `d742b63c024db42ba9a5470d1a1fab02b04797b0`，证明独立验证对象正是待合入树，未混入其他会话的启动改动。

| Evidence | Result | Identity |
| --- | --- | --- |
| 独立合并候选 scoped Harness | 23/23 PASS，前后源码身份一致 | `20261015T193612Z-505ffa07`；receipt SHA-256 `842de4868fe37ed1e4a39dfd205827317a10e9f7e986233d16143e0df8ac984b` |
| 合并候选 completion | PASS | `20261015T200249Z-9f5fcd4a`；receipt SHA-256 `b4ad99c7ee5ee30836e664fe73709f747ffdbaa47f97d97c9d189ef38da83b44` |
| 千川接入、上传、扩展回归 | 129/129、1026/1026、1010/1010 | 扩展回归 107 个文件；不引用包含其他会话测试改动的共享目录计数 |
| typecheck、桌面 smoke、构建、文档、owned AOCI | PASS | 同一 23 项回执；本报告最终字节另做 docs-only 验证 |

Parent 在上述项目验证通过后重新判断合并的 Review Risk Gate：`NATIVE_REVIEW_NOT_REQUIRED`。金融执行器、原 Document/期限/账户/URL/输入 guard、审计 store、资格协调器及共享契约仍为 S5 已审字节；冲突仅合并原有拒绝条件，未增加新发送链、凭据处理或恢复权限。已核对的上游增量留在原 owner，没有发现新增的关键失败路径或仍需独立审查的实质合并语义缺口。原五轮消费保留，不把 S5 审查声称为对整个新树的第六轮审查；不同的九个上下文路径在私有 identity audit 中明确列出。

私有 `/tmp/jianji-qianchuan-merge-20261016/merge-evidence-manifest.json` 绑定 20 份明确白名单证据，SHA-256 `13f4af778cb851dc9c535dd5b2187c6f3cdd09aaf4510bb6cdc2fecb90526eb0`，包含两份未通过的共享目录回执、漂移核对、完整树一致性、正式 AOCI 批次、最终独立 Harness/completion 和 Parent 风险裁决。原始日志及本机运行元数据不提交 Git。

本节仅证明合并工程快照。本轮未重启或接管正常应用，未调用真实平台制作、上传、调价、创建或启停；此前 A02 的一次 ACCEPTED 上传不重传，过期执行单不恢复，真实平台验收继续 PARTIAL。

### Publication Boundary

`2026-10-15T20:05:35Z` 提交前只读核对发现：主目录另一会话又修改了 `src/main/douyin-upload-service.ts`、`aoci.code.txt` 和 `.aoci/baseline.json` 的工作树字节；本轮已验证的暂存区源码仍逐项匹配，未混入这些新增修改。按用户提供的 `AGENTS.md` 同文件并发规则，已暂停提交，等待用户确定“先提交已验证暂存区并保留未暂存改动”或“先等待另一会话交接”的顺序。该检查点尚未 commit/push；主目录 HEAD 仍为 `b98a9501e8343b728700c07703d3d84184fc7425`，MERGE_HEAD 为 `d78ac19d572b22435d65cf3772bdcfccfd10a81e`，没有覆盖、stage 或清理其他会话的工作。实际待决证据另存私有 `publication-ownership-boundary.json` 和 `publication-checkpoint.json`。

用户随后明确选择 A：先提交已验证的暂存区合并，完整保留其他会话的未暂存改动。本轮重新核对两处暂存区的 53 个工程路径，字节与通过验证的 owned scope 全部一致；仅将本报告最终版本补入主目录暂存区，不重新 stage 同文件并发路径。该授权解决 Git 提交顺序，不恢复已到期的真实平台执行单；最终 merge commit、推送及远端 SHA 核对结果另记私有 publication checkpoint。
