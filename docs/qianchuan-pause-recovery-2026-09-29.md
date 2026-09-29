# Qianchuan Pause Recovery Repair

## Goal And Ownership

本轮修复 [真实验收](qianchuan-blocker-repair-2026-09-29.md#real-account-acceptance) 中暂停后只恢复单条的问题，并为缺行、原页面丢失及禁用按钮提供准确诊断。恢复合同补充见 [Implementation Plan](superpowers/plans/2026-09-29-qianchuan-recovery.md)，既有 [Spec](douyin-auto-upload-spec.md) 与原导出、service、store、page-contract ownership 继续适用。

用户明确选择 A：其他任务的既有 service/store/UI 测试、spec、账号设置、renderer 和 AOCI 正式索引、baseline 不由本窗口接管。本轮仅修改 `src/main/douyin-upload-service.ts`、`src/main/qianchuan-page-contract.ts`，新增两个独立回归测试、本计划与本记录。当前 working tree 串行实施，没有 worktree，也没有提交旁人的制作、覆盖或 ResultsPanel 改动。仓库没有专用 session-record skill，本记录保存本轮 checkpoint；没有修改全局 memory。

后续用户明确要求“按你的 ownership 等那个结束了继续……AOCI 为什么没有维护，改了什么维护什么”。名称任务完成提交 `861c11c`，其 [安装记录](qianchuan-product-name-installed-2026-09-29.md) 明确两个 stale 上传对象归本轮维护。依最新授权，本轮接续这两个 AOCI Entry、对应 baseline 与组合安装；没有接管其他任务的源码或测试。

## Behavior

- 暂停期间正式产物仍持久入账。对尚未选文件条目的“安全继续”恢复其授权 `pageBatchId` 的待传项，按最多九条组成一组，整组 READY 证据保存后才推进。取消项、终止失败和 duplicate 不由批次恢复复活；其他账号、其他批次及重启恢复的旧任务不会被该动作唤醒。
- 对 fenced 条目的“只读核查页面”只检查原页面，不授权新选择。同账号其他批次未解决任务或同批 UNKNOWN fence 仍阻断待传项。已选文件须先核验原页面；原 tab/modal 不可恢复时保留 fence、报告 UNKNOWN，剩余文件保留 NOT_SELECTED。失败的原页面核查也会使旧 READY 证据失效，不能用缓存 READY 假装恢复。
- 原标签页关闭、弹窗丢失或归属改变保留具体 reason/next_action。添加视频 disabled 在点击前拒绝，说明平台业务原因尚未确认，指导人工查看计划状态、操作权限和平台提示；程序不改变广告设置。
- 新文件行未出现使用独立的冻结 `timeouts.fileInput` 观察窗口，默认 30 秒；可见行继续使用原 processing 窗口。缺行始终是 UNKNOWN，绝不推断未提交或重选。stop 和恢复准备期间的竞态由 generation 与原 runner 控制，不引入第二队列。

## Executable Verification

已实际运行 red-green：旧实现出现暂停二十条仅恢复一条、同组前置失败互相阻塞、重启后仅恢复一条；旧页面实现没有 disabled/缺行/弹窗丢失的专门诊断。另有恢复准备期间启动第二 runner、stop 后迟到 eligibility 的失败用例。最终新回归测试覆盖这些行为及 UNKNOWN 零重传、授权隔离、READY 保存边界和原页丢失。

| Verification | Evidence | Result And Limit |
| --- | --- | --- |
| 当前源码受影响测试 | `/tmp/qianchuan-recovery-final-r4-tests.log`，service/store/integration/CDP/page-contract 加两个新文件 | 7 文件、121 tests PASS；mock 成片准入与隔离 Chrome fixture，不是平台上传验收 |
| 当前源码 typecheck/build | `/tmp/qianchuan-recovery-build-r4.log` | `npm run build` 内含 fresh `npm run typecheck`，exit 0；完整 working tree 包含旁人的制作改动，未将该完整 bundle 安装 |
| 精确发布上下文 | `/tmp/qianchuan-recovery-scoped-release-r4-tests.log`、`/tmp/qianchuan-recovery-scoped-release-r4-typecheck.log` | 干净 `fd56869` 加本轮两模块和新测试：119 tests PASS，相关 transitive TypeScript 检查 PASS；不宣称旧基线完整 checkout 重建成功 |
| Project Harness | `/tmp/jianji-recovery-verification-r4-_we2llop/.agent/harness/runs/20260929T123359Z-a36fe109/receipt.json` | 最终封存源码上的七个 required checks 全部 PASS；前后 source identity 相同。主 working tree 两次检查虽然各 check PASS，但 identity 漂移，整体为 NOT_EVALUATED，未冒充 PASS |
| 普通打包 Electron smoke | `/tmp/jianji-qianchuan-smoke-BNyPxf/report.json` | 12 条真实 FFmpeg fixture 导出，上传组 1/9/2，12 个 fence；另有追加制作、严格 IPC 和重启零选择，confirm 0 |
| 批量打包 Electron smoke | `/tmp/jianji-batch-upload-smoke-jUZ2V5/report.json` | 17 条正式 fixture 导出，12 READY，UNKNOWN 阻断后续账号，重启零重选；confirm 0、ad settings 0 |
| 暂停后整批桌面恢复 | `/tmp/jianji-qianchuan-smoke-RGohOB/report.json` | 实际打包 app UI：禁用按钮期间二十条正式 FFmpeg 成片全部入账、零选择；fixture 解除禁用后一次安全继续，按 9/9/2 全部 READY、20 fence，重启零重选，confirm/ad settings 均 0 |

Harness 使用先前冻结的集成上下文加最终 owned 源码，包含来源 manifest，SHA-256 `2d15292a05edf79191b5682e508eab97010b366c3ab535943cc8afad6193fb44`；不是实施 workspace。它使用现有 policy，没有放宽检查。本轮两源码、两新测试与该快照逐字节一致。旧源码快照与结果保留为历史，不冒充最终结果。

新增桌面恢复 driver 复用原 `douyin-upload-smoke.mjs` 的 fixture、正式制作、preload 和应用 owner，未增加上传队列或直接上传脚本。首次 driver 为 UNVERIFIED：仅解除旧 fixture 页按钮，而前置失败后的未选文件恢复会重新打开页面，新 fixture 页仍被测试 HTML 禁用。修正隔离测试响应后，最终候选的整批桌面恢复通过；此修改只影响测试 fixture。

## Review And Risk Gate

stable candidate 的 required review 依据是恢复授权失效可让其他批次被选文件，形成不可盲目撤销的上传结果与永久 fence；测试通过仍有原 runner、恢复与页面归属组合的运行时语义缺口。独立 reviewer 用于检查具体并发与持久状态路径。不是按 diff 行数或 prior incident 自动触发。

三项 trigger 的裁决：没有针对该快照单独点名 Kimi review；越过批次授权进行外部选择属于关键级 authority/durable-state 后果，命中第二项；其余重大后果、实质验证缺口与独立增益也有上述具体路径证据。结果为 `KIMI_REVIEW_REQUIRED`，因已证实连续运行故障而使用明确记录的 native fallback。

原三次 Kimi invocation 不重置：`79443295-64db-4acf-88f8-2318bbb55bc2` 为 OUTCOME_UNKNOWN（366 秒、4 wire requests），`ec6040c1-a253-4dd1-9fe1-108680cce01a` 为 PROTOCOL_ERROR（352 秒、3 requests），`ce573efb-8b0b-483e-8125-ad8034a0260a` 为 OUTCOME_UNKNOWN（480 秒 timeout、4 requests）。已重新核验 canonical receipts，不增加第四次 Kimi 请求。

按 `SUBAGENTS.md` 的 Repeated Kimi Failure Fallback，旧 guard native review 的前两轮仍计入历史。本轮由 read-only `reviewer_xhigh` `/root/qianchuan_recovery_review` 接手第 3/3 轮，八分钟上限，不运行测试或 nested delegation。S1 快照 `/tmp/jianji-qianchuan-recovery-review-20260929-r3/manifest.json` SHA-256 为 `ddddefcfdfab76b4c7bdb3c9d9d4fb21ab013cf4f8a2dc6384469de1e32400c3`，含精确 runtime source/diff、spec/plan 与 fresh verification evidence。它仅审查该轮字节，不作为修复后 S2 的审查证据。

### Parent Adjudication And Limited Extension

第 3/3 轮报告 `QRR-CANCEL-001 / blocking_candidate`：恢复准备期间使用 `store.tasks()` 的旧副本会覆盖随后取消的任务。Parent 已复现两个用例，分别取消尚未遍历的 sibling 和正在等待 PENDING 保存的条目；旧实现均把它们改为 READY 并上传，裁决为 CONFIRMED。另核实原页核查失败也会覆盖期间取消的待传项，新增失败用例并修复。修复逐项读取当前持久状态，复用既有 `cancelledIntents` 撤销机制，在 PENDING 保存前后及原页失败分支保留 CANCELLED；只有该条目随后收到新的显式继续才可恢复。新恢复回归十三项已通过。

原生默认三轮已耗尽。依据上述具体缺陷及 red-green 证据，任务内自主封存一次 full re-review 扩展，最多一轮、八分钟；累计 native 第 4/4 轮，Kimi 仍为历史三次，无额外外部调用。扩展只审核该恢复修复与已有 safety contracts。若仍有未解决 blocker，不继续机械追加。修复后重新运行相关 tests、typecheck/build、Harness 和打包 desktop fixture，完成前仍需本次审查与 Parent 最终裁决。

S2 manifest SHA-256 `5430d6d994847bfdb9936d8568023b57801961d3a57353b5aa4f3c2bd055d47d`，路径 `/tmp/jianji-qianchuan-recovery-review-20260929-r4`，包含最终源码与上表 fresh evidence。同一代理 full re-review 返回 finding set 为空，仅进行只读追踪和证据核对。Parent 根据三项取消失败复现、修复后的 121/119 tests、完整 Harness、实际打包 UI 的二十条恢复及最终 diff，裁决 `QRR-CANCEL-001` 已解决。源码和测试逐字节绑定 S2；不把 empty findings 自动当作 acceptance，也不声明 native 具备 Docker/Kimi route proof。原生 profile 配置为 `reviewer_xhigh`，费用和精确 token 消耗保持未知。本轮工程 required review 的运行阻塞解除；当时仍保留真实平台问题及安装 ownership 阻碍，安装后续见下。

## Package Candidate

候选继承本轮初始运行的 `qianchuan-20260929-fd56869` 发布包。用干净 `fd56869` 编译证明两个旧模块与该 main bundle 对应 section 字节一致，再仅替换本轮 service/page-contract section。归档所有非 main 文件及 unpacked/executable/link 标记逐一对照，只有 `dist-electron/main.cjs` 文件字节改变；新 main 通过语法检查。没有安装其他任务的未提交源码。

证据 `/tmp/qianchuan-recovery-package-proof.json`：旧 `app.asar` SHA-256 `fd04404e0d3d770246984ea0c2721f942aafe42448be2815fe0565d442ff6c5e`；最终候选 `app.asar` 为 `d846704693bd5e25cd1168bd8ec930b788737ad1048d0ef631b3d77311a90468`，main 为 `9acd96aadf4cb2680d11d0dea687cb77e2ae6f7252e18b2d3d7db2824b76db64`。这是可核验的定点修复，完整独立旧基线构建的 `usesModel` 类型依赖未被宣称解决。

独立候选位于 `/home/reggie/Applications/jianji/releases/qianchuan-recovery-candidate-20260929-d8467046`，附 `recovery-evidence` 和精确源码。封存时尚未替换真实运行包：另一任务正在更新 `launch.sh`，本轮依 ownership 规则保留启动器并等待其结束。这个历史候选保留作精确审查及模块来源；最终安装使用下述组合包。

## Combined Installation

名称任务最后安装的是 `product-name-20260929-preserved-7c667d3`，`app.asar` SHA-256 `995a30011d999e561e2bb07501cf0a5baa00baa9b740d4449c7f01ef57bd382e`。本轮核对其旧上传模块与 `fd56869` pristine section 相同，再逐字节插入 S2 审查的 service/page-contract section。反向替换证明 main 其余字节完全相同；2160 个非改动 archive 文件及 unpacked/executable/link 元数据保留，只有 `dist-electron/main.cjs` 改变。现有名称、schema、`usesModel` 和 renderer 均保留。

最终 release 为 `/home/reggie/Applications/jianji/releases/qianchuan-recovery-name-20260929-c5a5dcf9`：`app.asar` SHA-256 `c5a5dcf9e56d2e2924091388fe3c0d17426969d6dcbf481c8abf0029b11c373d`，main SHA-256 `2802cc4d1110e76eae3e24326d56b1e7c931244a9dd98b59e703bda986d9ae78`。来源为恢复提交 `d8491cf` 与名称提交 `7c667d3`，证据 `/tmp/qianchuan-combined-package-proof.json`。

精确本轮源码、AOCI、构建/测试日志、成功和失败的 smoke 记录、归档 proof、source bindings 及 installed identity 保存在 release 的 `recovery-name-evidence`。真实 userData 和完整项目状态只在上述私有备份目录保存。

冻结名称任务的已安装 source context，加 S2 两个源码和两个测试后，独立运行 `npm run build`（含 typecheck）及九个相关文件、159 tests，均 PASS；当前 working tree 另跑 `npm run typecheck` PASS。六个编译模块（两个上传模块、domain、store、两个账号模块）与实际归档 section 完全一致，renderer 也与该构建字节一致，见 `/tmp/qianchuan-combined-source-bindings.json`。不发布完整 dirty working tree。

| Final Packaged Verification | Evidence | Result |
| --- | --- | --- |
| 普通制作及上传 | `/tmp/jianji-qianchuan-smoke-PcJmhx/report.json` | 12 正式成片、九条以内分组、永久 fence、追加选择独立、重启零选择、confirm 0 |
| 跨模板批量 | `/tmp/jianji-batch-upload-smoke-NJgLEH/report.json` | 17 正式成片、12 READY、UNKNOWN 暂停后续账号、重启零重选、confirm/ad settings 0 |
| 暂停二十条后一次 UI 继续 | `/tmp/jianji-qianchuan-smoke-DLaV7n/report.json` | 初始 disabled 且零选择；一次安全继续按 9/9/2 全部 READY、20 fence、重启零重选、confirm/ad settings 0 |
| 名称修改保留 | `/tmp/jianji-account-smoke-EFxNMq/report.json` | 已关闭浏览器可仅改名、目标保留、非法名称与重复浏览器阻断、重启恢复、上传/确认/广告设置均 0 |

首次并行普通 smoke 因未达到预期 checkpoint 为 UNVERIFIED，退出时留下十个 completed、两个 cancelled fixture 任务；同包串行复核通过，具体延迟原因未定位，不宣称已修复该环境问题。首次名称 smoke 遇到浏览器发现拒绝；有界只读诊断发现同期 fixture Chrome profile 权限为 `0775`，不满足既有 guard。隔离 fixture 使用 `umask 077` 并串行执行后通过，没有放宽产品浏览器权限校验。失败日志与成功日志一并保留。

组合没有新增源码语义：S2 模块逐字节一致，名称模块及其他已安装字节不变，上述 fresh 组合验证填补运行连接处的检查。Parent 在此 checkpoint 判定无需另起 implementation review；既有 required review 仍绑定 S2，Kimi 三次失败及 native 4/4 历史不重置。

安装前重新确认 queue 仅 155 completed、100 failed，agentRun 为 null、批量为 finished、uploadActive 为 0，原项目无未保存更改。正常 SIGTERM 退出后备份完整 userData、原项目与启动器至 `/home/reggie/Applications/jianji/.backups/qianchuan-recovery-name-20260929-c5a5dcf9`，原 release 保留。启动器原子切换到组合包。首次启动漏带原本的调试参数，CDP 验证连接失败；确认新窗口仍为未操作的空项目、账本不变后正常退出，再以 loopback 动态调试端口启动，没有强制退出或丢弃草稿。

最终真实 PID `1136141` 的 executable 和 renderer URL 均绑定该 release。通过既有应用 owner 重新打开原“氨糖膏”项目，并刷新 renderer 同步界面草稿；十个素材正常，产品名称编辑可见，“一根金”“晚安油”等现有名称保留，未保存账号变更。真实 ledger SHA-256 `26a26c97b364e7b3cec14b907ad9906785fe7754c7101cbf7c25a13d45590c9d`；全部 306 个上传账本、快照及 fence 文件安装前后逐字节不变，原项目除 `updatedAt` 外内容相同，第十一条仍为 MAY_HAVE_UPLOADED。实际桌面证明见 `/tmp/qianchuan-combined-installed-ui.json`、`/tmp/qianchuan-combined-live-after.json` 及备份目录的 viewport 截图；Parent 已实际查看截图。

## Live Read-only Diagnosis

本轮只读真实原页面、ledger/fence 及冻结成片，没有导航、点击上传、选文件、确认、发布或修改计划。证据 `/tmp/qianchuan-recovery-live-readonly-20260929.json`、`/tmp/qianchuan-eleventh-file-readonly.json`、`/tmp/qianchuan-eleventh-platform-hints.json`。

- 滴耳康原 target `5684B74878204176E7FD3EFE6CCA004D` 的账户和计划分别唯一匹配，原 modal session `f4ddb90a-d1b3-42a2-be04-b7817a9327b8` 仍只有十个 READY 行和“已选择 10/261”，第十一条不存在。确定按钮 enabled 未被点击；这不能证明平台未收到该文件。
- 第十一条冻结文件为 H.264/AAC、720×1280、30 fps、58.746009 秒、26,974,450 bytes，视频码率 3,470,401 bps；SHA-256 `5edc127827da035d6a7aa43076f1e487afa88a6af521d1d6d354412e832a562e` 与 ledger 相同。上述大小、分辨率、时长及码率落在该页面可见竖版要求内，只排除这些明显不匹配，不能证明平台接受或定位真实根因。
- 原 UNKNOWN fence SHA-256 `e9a5ff30869af58431c924105ec58d36143f4862f31ae1a53f4006e87c5fe9f6`、真实 ledger 在只读观察前后不变，后续九条没有重选。
- 氨糖膏的 disabled 证据保留在上轮真实验收记录。本轮仍找到对应账户页面，但未看到目标计划 drawer，不能据此判断业务原因已解除；没有打开计划试错。肥皂、热敷贴等四个历史账号继续保留阻塞。
- 当时 app 的 queue 仅 completed/failed，agentRun 为 null，批量 run 为 finished，uploadActive 为 0；这仅是当时观察，不替代安装前的新检查。

## AOCI And Remaining Limits

原 ownership 冲突期间只读 Verify/Check/Guide，两个源码条目 stale 的历史报告保留。依最新用户授权与原任务完成证据，已对机器签发的完整两项批次更新 `douyin-upload-service.ts` 与 `qianchuan-page-contract.ts` 的完整 Entry；写入 `aoci.code.txt`，同步对应源码和索引在 `.aoci/baseline.json` 的绑定。机器结果 `attempted=2/applied=2/remaining=0`，无其他对象或 Scope 扩张。Verify、Check exit 0 且 `governance_aligned=true`；Guide `complete=true / next_action=none`，报告 `/tmp/qianchuan-recovery-install-aoci-{verify,check,guide}.json`。新测试和本轮文档属于现有 observe 范围，无须新增 Code Entry。

工程回归、桌面 fixture、真实平台和人工成片验收分别记账。本轮没有真实平台新上传；第十一条根因、氨糖膏平台业务阻塞及四个历史账号仍未解决，未知任务不得重传。Windows 按用户要求不验证。真实整批自动恢复没有用未知文件做破坏性试错，也没有宣称全部生产验收通过。

## Paused Status Follow-up 2026-09-30

用户截图显示新成片已完成但上传始终为零。只读应用及 ledger 核查：晚安油项目 `f50740e1-1b3d-4199-b2fd-c64a31d5fdc9` 初始 108 条 PENDING；同 advertiser `1876294500004864` 有八条历史 NEEDS_HUMAN，全部 NOT_SELECTED、无 fence，来自另一项目。Chrome 9225 与千川页面仍可连接，但没有可见上传 modal，不能推断浏览器关闭原因。构造函数据历史异常暂停整个 uploader，而 status 未检查 paused/stopped，错误地投影 ready=true 和正常文案。用户追加制作又取消后，无活动导出，当前项目入账共 158 条 PENDING，分别为原批 108 条和新批 50 条。

本修复只调整 service 的只读状态说明、ready 与拒绝继续文案；复用原 resume 的相同 advertiser/pageBatch/fence 判定，未改变授权、队列、浏览器或持久状态。既有 UI 已消费 message/ready，无须接管 UI 文件。新增独立回归覆盖同账号跨项目、另一账号、停止、错误优先级和 UNKNOWN；status 与拒绝继续不接触浏览器且 ledger/fence 字节不变。独立 [Plan](superpowers/plans/2026-09-29-qianchuan-paused-status.md) 已 Self-Review。仓库没有专用 session-record skill，本既有记录保存本次 checkpoint，不修改全局 memory。

Kimi `deep/max` 只读 mapping invocation `699685ba-8d93-4323-8d47-d4d623e71168`，sealed contract `e080c9f5-7f1d-42d2-a7fb-7beec31d2033`；canonical receipt 为 PARSED，261.58 秒、两次 provider request，身份核验通过。Parent 核对前四项状态/文案/名称建议及第五项只读边界：状态缺陷和说明缺口确认；拒绝边界保持，报告中“未 fence”的文字以实际 guard 为准；名称按 advertiser 匹配当前 summary 再回退冻结名称，避免账号槽位重配置时错用名称。该 mapping 不冒充最终 adversarial review。CodeGraph 关系核对后仍以当前源码为准，其行号索引存在漂移。

stable service SHA-256 `b9f9ffd4791d1f9b60b41bd54346a787e5963ee103609a803225f972f9a5339d` 的最终 Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`：用户未点名对本快照进行 Kimi review；只读说明不写凭据、授权或持久状态，原 resume predicate 完全保留，无关键级破坏路径；主要后果是状态说明错误，相关测试和实际 packaged alert/拒绝操作已覆盖，不存在同时成立的重大后果、实质缺口与新增 reviewer 独立增益。原恢复 review 的历史计数及结论不重置，也不用于审查本次新字节。

| Verification | Evidence | Result And Limit |
| --- | --- | --- |
| 独立 red-green 与相关测试 | `/tmp/jianji-paused-status-red.log`、`/tmp/jianji-paused-status-green.log`、`/tmp/jianji-paused-status-diagnostics.log` | 修正 fixture 身份后旧行为 5 fail/1 pass；修复后 34 个不同用例 PASS |
| Typecheck、Harness、可信构建 | `/tmp/jianji-paused-status-typecheck.log`、`.agent/harness/runs/20260929T155457Z-d7e5fc90/receipt.json`、`/tmp/jianji-paused-status-build.log` | typecheck/build exit 0，Harness 七组 required checks PASS，source identity 前后一致；构建只用可信安装上下文加本 service |
| 暂停提示实际 packaged UI | `/tmp/jianji-paused-status-desktop-7Fxs0I/report.json` | 八条历史异常、108 PENDING fixture；alert 和拒绝继续说明正确，零浏览器请求，ledger 字节不变 |
| 普通 packaged 上传 smoke | `/tmp/jianji-paused-status-upload-smoke-r3.log` | 12 正式 FFmpeg fixture 成片，九条以内分组、严格 IPC、追加独立选择、重启零重选；confirm 0 |
| 批量 packaged 上传 smoke | `/tmp/jianji-batch-upload-smoke-t39acc/report.json` | 17 正式 FFmpeg 成片、12 READY，UNKNOWN 阻断后续账号；confirm/ad settings 0 |
| 正常启动 CDP | `/tmp/jianji-default-cdp-smoke-tf3sM3/report.json` | 正常启动动态 loopback CDP，通过独立 fixture；用户无须手加启动参数 |

首次普通 driver 使用旧 UI 标签，属于 driver 不匹配；改用当前 driver 后首次未达到 checkpoint。首次批量后半段断言尚未 completed，亦未冒充 PASS。随后 `umask 077`、串行执行当前 driver 均通过；初次延迟具体原因未定位，不能宣称环境问题已修复。失败日志均保留。

安装基底为当前 CDP release `cdp-default-20260929-00e98131`。只有 main.cjs 内 service section 改变，反向替换完全还原基底；2160 个其他 archive 文件及 executable/unpacked metadata 相同。新 app.asar SHA-256 `ac894ad6ec491912153fef23a945e04771508331299ffe849e180a2488e2747e`，main SHA-256 `8955347d4ba6df26c6e8231ad4d6cdd3b81974bd18a2cff28f33aabaca499ad2`。没有发布其他任务 dirty source。

用户明确授权串行更新 service 的一个 AOCI 条目及 baseline。机器批次 `87af247ee119052d72e8b83a841e45726972f8d6d5d819e143eeda7e6112a46b` apply 1/remaining 0；只改变该条目和对应绑定，保留其余外来修改。Verify、Check exit 0，Guide complete=true/next_action=none，证据 `/tmp/jianji-paused-status-aoci-{verify,check,final-guide}.json`。测试和文档仍属 observe 范围，不新增管理对象。

用户随后明确授权停止上述八条未选文件的历史任务并继续当前新批次；该操作须走应用 owner，复核原项目、目标及无 fence，其他 UNKNOWN 永不重选。真实操作、最终安装身份与剩余阻碍将在执行后记录，不以 fixture 代替真实上传验收。

### Installed And Real Batch Acceptance

最终 release `/home/reggie/Applications/jianji/releases/qianchuan-paused-status-20260930-ac894ad6` 已替换启动器并正常运行，PID `1914602`、renderer URL 与前述 archive SHA 绑定。动态 CDP 端口由真实 `DevToolsActivePort` 读取，未给用户添加启动参数。安装前 agent/batch 已 finished、queue/upload 活动为零、当前晚安油项目已保存。正常 SIGTERM 退出，旧 release 和启动器保留；备份目录 `/home/reggie/Applications/jianji/.backups/qianchuan-paused-status-20260930-ac894ad6` 保存 userData 和原项目。备份跳过无法复制的运行时 Singleton lock/socket/cookie 链接，其余已复制；464 个上传持久文件另逐字节核验，安装前后完全一致。

按用户的新授权，通过 `loadProject` 打开旧项目 `b024028b-5470-4d1e-b733-9a124656a98d`，逐条再次检查八条 NOT_SELECTED、同 advertiser、无 fence，调用原 `stopDouyinUpload` owner。结果仅这八条转 CANCELLED/NOT_SELECTED；没有续传旧批另外十条 PENDING，也没有重选旧 UNKNOWN。再用应用 owner 恢复晚安油项目，对最新 `pageBatchId=d4fa2af0-d148-4954-935d-c8157684a096` 的五十条调用一次显式继续。

真实最新批次五十条全部 READY/WAITING_FOR_CONFIRMATION，分组为 `9/9/9/9/9/5`，每组完整 READY 后推进；五十个新永久 fence，全部绑定原 target/modal。应用界面显示“已上传 50 / 158 条 · 待上传 108 条 · 处理中 0 条 · 需处理 0 条”。前一批 `3184d1d6-1663-4abc-b062-2a894b405b20` 的 108 条保持 PENDING，未用最新批次继续授权唤醒。所有其他 task records 和全部 intents 与操作前一致；原有 52 个 fence 字节不变。没有点击确定、发布或修改广告设置。真实证据 `/tmp/jianji-paused-status-real-acceptance.json`、`/tmp/jianji-paused-status-platform-readonly.json`、`/tmp/jianji-paused-status-live-upload.png`；Parent 已实际查看桌面截图。本轮证明最新批真实上传恢复，不代表平台已接受发布，也不替代人工观看成片。

安装后再次运行 AOCI Verify、Check、Guide，exit 0、governance aligned、Guide complete/none；证据 `/tmp/jianji-paused-status-aoci-install-{verify,check,guide}.json`。仅 stage service Entry 和对应 baseline，聚合索引摘要按 staged bytes 绑定；working tree 的其他任务正式条目与 baseline 修改保留未提交。原第十一条根因、氨糖膏平台业务阻塞和其他历史未知任务继续保留，Windows 仍未验证。
