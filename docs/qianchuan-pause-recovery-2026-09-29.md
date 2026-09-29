# Qianchuan Pause Recovery Repair

## Goal And Ownership

本轮修复 [真实验收](qianchuan-blocker-repair-2026-09-29.md#real-account-acceptance) 中暂停后只恢复单条的问题，并为缺行、原页面丢失及禁用按钮提供准确诊断。恢复合同补充见 [Implementation Plan](superpowers/plans/2026-09-29-qianchuan-recovery.md)，既有 [Spec](douyin-auto-upload-spec.md) 与原导出、service、store、page-contract ownership 继续适用。

用户明确选择 A：其他任务的既有 service/store/UI 测试、spec、账号设置、renderer 和 AOCI 正式索引、baseline 不由本窗口接管。本轮仅修改 `src/main/douyin-upload-service.ts`、`src/main/qianchuan-page-contract.ts`，新增两个独立回归测试、本计划与本记录。当前 working tree 串行实施，没有 worktree，也没有提交旁人的制作、覆盖或 ResultsPanel 改动。仓库没有专用 session-record skill，本记录保存本轮 checkpoint；没有修改全局 memory。

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

S2 manifest SHA-256 `5430d6d994847bfdb9936d8568023b57801961d3a57353b5aa4f3c2bd055d47d`，路径 `/tmp/jianji-qianchuan-recovery-review-20260929-r4`，包含最终源码与上表 fresh evidence。同一代理 full re-review 返回 finding set 为空，仅进行只读追踪和证据核对。Parent 根据三项取消失败复现、修复后的 121/119 tests、完整 Harness、实际打包 UI 的二十条恢复及最终 diff，裁决 `QRR-CANCEL-001` 已解决。源码和测试逐字节绑定 S2；不把 empty findings 自动当作 acceptance，也不声明 native 具备 Docker/Kimi route proof。原生 profile 配置为 `reviewer_xhigh`，费用和精确 token 消耗保持未知。本轮工程 required review 的运行阻塞解除，真实平台问题与安装 ownership 阻碍仍保留。

## Package Candidate

候选继承本轮初始运行的 `qianchuan-20260929-fd56869` 发布包。用干净 `fd56869` 编译证明两个旧模块与该 main bundle 对应 section 字节一致，再仅替换本轮 service/page-contract section。归档所有非 main 文件及 unpacked/executable/link 标记逐一对照，只有 `dist-electron/main.cjs` 文件字节改变；新 main 通过语法检查。没有安装其他任务的未提交源码。

证据 `/tmp/qianchuan-recovery-package-proof.json`：旧 `app.asar` SHA-256 `fd04404e0d3d770246984ea0c2721f942aafe42448be2815fe0565d442ff6c5e`；最终候选 `app.asar` 为 `d846704693bd5e25cd1168bd8ec930b788737ad1048d0ef631b3d77311a90468`，main 为 `9acd96aadf4cb2680d11d0dea687cb77e2ae6f7252e18b2d3d7db2824b76db64`。这是可核验的定点修复，完整独立旧基线构建的 `usesModel` 类型依赖未被宣称解决。

独立候选位于 `/home/reggie/Applications/jianji/releases/qianchuan-recovery-candidate-20260929-d8467046`，附 `recovery-evidence` 和精确源码。候选尚未替换真实运行包。最后核对发现另一任务已将 `launch.sh` 切至 `product-name-20260929-7c667d3`，本轮不能切回旧基线并撤掉对方新包。已依同文件 ownership 规则请求用户指定组合安装责任；等待答复期间保留启动器，继续不冲突的验证与提交。旧 release 继续保留，真实运行包尚未验收本轮恢复修复。

## Live Read-only Diagnosis

本轮只读真实原页面、ledger/fence 及冻结成片，没有导航、点击上传、选文件、确认、发布或修改计划。证据 `/tmp/qianchuan-recovery-live-readonly-20260929.json`、`/tmp/qianchuan-eleventh-file-readonly.json`、`/tmp/qianchuan-eleventh-platform-hints.json`。

- 滴耳康原 target `5684B74878204176E7FD3EFE6CCA004D` 的账户和计划分别唯一匹配，原 modal session `f4ddb90a-d1b3-42a2-be04-b7817a9327b8` 仍只有十个 READY 行和“已选择 10/261”，第十一条不存在。确定按钮 enabled 未被点击；这不能证明平台未收到该文件。
- 第十一条冻结文件为 H.264/AAC、720×1280、30 fps、58.746009 秒、26,974,450 bytes，视频码率 3,470,401 bps；SHA-256 `5edc127827da035d6a7aa43076f1e487afa88a6af521d1d6d354412e832a562e` 与 ledger 相同。上述大小、分辨率、时长及码率落在该页面可见竖版要求内，只排除这些明显不匹配，不能证明平台接受或定位真实根因。
- 原 UNKNOWN fence SHA-256 `e9a5ff30869af58431c924105ec58d36143f4862f31ae1a53f4006e87c5fe9f6`、真实 ledger 在只读观察前后不变，后续九条没有重选。
- 氨糖膏的 disabled 证据保留在上轮真实验收记录。本轮仍找到对应账户页面，但未看到目标计划 drawer，不能据此判断业务原因已解除；没有打开计划试错。肥皂、热敷贴等四个历史账号继续保留阻塞。
- 当时 app 的 queue 仅 completed/failed，agentRun 为 null，批量 run 为 finished，uploadActive 为 0；这仅是当时观察，不替代安装前的新检查。

## AOCI And Remaining Limits

按用户 ownership 决定，AOCI 正式索引与 baseline 由原任务维护，本轮没有修改它们。已运行只读 Verify/Check/Guide；结构有效，两个源码条目 stale，`governance_aligned=false`、Guide `authoring_required`。报告为 `/tmp/qianchuan-recovery-aoci-final-{verify,check,guide}.json`。未维护对象为 `src/main/douyin-upload-service.ts` 和 `src/main/qianchuan-page-contract.ts`，须由索引 owner 在源码稳定后更新并重新核验。不得声称 AOCI 已对齐。

工程回归、桌面 fixture、真实平台和人工成片验收分别记账。本轮没有真实平台新上传；第十一条根因、氨糖膏平台业务阻塞及四个历史账号仍未解决，未知任务不得重传。Windows 按用户要求不验证。真实整批自动恢复没有用未知文件做破坏性试错，也没有宣称全部生产验收通过。
