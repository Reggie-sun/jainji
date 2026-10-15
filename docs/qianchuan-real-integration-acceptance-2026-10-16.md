# Qianchuan Real Integration Acceptance

## Status And Scope

2026-10-16（北京时间）继续验收 [Spec](superpowers/specs/2026-10-15-qianchuan-real-integration.md)。候选为 `feat/qianchuan-real-integration` 的 `adc223c3c7b85a645947f5a90518dd79ecf59a68`，沿用 [Implementation Plan](superpowers/plans/2026-10-15-qianchuan-real-integration.md) 与 [Implementation Evidence](qianchuan-real-integration-2026-10-15.md)。**整体为 PARTIAL；真实投放闭环和 M3 未完成。** 本次新增验收记录，不修改产品源码或放宽准入。

用户要求自行读取测试所需信息。本次通过既有应用公开只读 IPC、平台现有页面、保存项目目录及原上传账本获取事实；没有生成新的金额/次数/期限授权。没有制作、上传、确认、删除、创建、调价、启停或切换平台账户/推广模式，没有调用模型或供应商接口。

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

## Acceptance Matrix

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
