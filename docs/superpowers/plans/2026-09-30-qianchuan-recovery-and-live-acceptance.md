# Qianchuan Recovery and Live Acceptance Plan

## Goal

2026-10-01 Current Scope Override：用户明确要求“这个 cdp 上传就管这一批生成的就可以之前的不管”。本轮实施 [Spec Current Production Scope Amendment](../../douyin-auto-upload-spec.md)：按可信制作开始入口隔离运行内上传范围，旧任务不影响本轮调度、不出现在本轮操作列表，不重新处理旧媒体；历史结果及防重传保留。原历史闭批和五店 live acceptance 不属于本轮待完成工作。

## Current Scope Implementation

1. 在原 service 建立运行内范围；开始新制作前有界排空旧操作，预检授权绑定 generation。范围容纳多个账号/pageBatchId 和同授权多个导出 chunk，禁止旧注册、迟到回调或启动扫描取得资格。
2. 原可信 IPC 在单项目、跨模板、手动导出及追加入口切换范围；正常状态仅投影当前成员。显式继续只能作用于当前范围，范围切换不修改旧结果或 fence。
3. 回归测试证明旧 UNKNOWN 不阻塞新字节、本轮 UNKNOWN 仍停止、旧同字节零重传、同轮多授权/多 chunk 均可执行、旧异步通知及失败的排空不会越权。运行 typecheck、相关测试与隔离 packaged smoke，再按 Risk Gate 独立审查。
4. 维护本轮 AOCI 条目、保留另一任务改动并仅提交本轮内容；按可信安装基线构建并验证交付。更新原 Recovery Record，明确工程证据和未进行真实上传。

Self-Review：采用原 store/service/queue 和可信 start seam，不扩展 renderer authority，不修改另一窗口的制作 owner；不以新范围重置历史 fence。本轮可执行验证即可证明范围逻辑，不需要处置任何真实历史批次。

Current Scope Delivery：四项已完成，软件提交 `57928bb`。实际安装 `qianchuan-current-production-20261001-775d5fbc` 与测试候选 asar 一致；原项目内容及全部 718 个上传文件保留，当前作品页不显示历史上传任务。fresh typecheck、183 tests、可信基线 build/Harness、三项 exact packaged smoke 和独立修订复核通过。安装、备份与证据边界见 [Recovery Record](../../qianchuan-pause-recovery-2026-09-29.md) 的 Installed Current Production Checkpoint。下文历史 Milestone 5 不属于当前完成目标，本轮未执行真实千川上传。

把单项目及跨模板批量制作后的自动上传交付为可核查、可恢复的功能：正式成片自动入账，每组最多 9 条，全组 READY 后推进，永久防重传，最终停在千川“确定”前。处理历史批次阻塞，使用户能够明确结束不能继续的本地历史批次，再单独继续其他完整未选批次。

## Status and Authority

2026-09-30 用户明确要求实现本计划，软件实施及相关工程验证已授权。Parent 已将 v3 closure 窄修订写入原 Spec 并完成 Self-Review，继续沿本计划实施；下文最初 docs-only 状态保留为历史。真实处置、新制作和真实继续的单独权限边界仍有效。

Implementation checkpoint：软件提交 `5646878`，Milestone 1–4 已形成诊断、v3 closure、独立审查、隔离 packaged 验证及实际安装证据，详见原 [Recovery Record](../../qianchuan-pause-recovery-2026-09-29.md) 的 Local Batch Closure Implementation / Installed Closure Checkpoint。真实 ledger 为 v3、562 tasks、150 fences、0 closures，原结果和其他上传文件保持。Milestone 5 尚为 BLOCKED，等待精确真实批次处置/继续和缺批次店铺制作授权；工程验证不代表五店 READY 或真实批量验收通过。

本文件响应用户“写一个 plan 来处理”，本轮只编写、核查和提交计划，不执行新的真实删除、结束批次、制作、上传或安装。后续实现采用当前树串行开发，不创建 worktree。

现有账号测试授权覆盖除氨糖膏外的五店；氨糖膏停止真实测试。原 108 条批次的删除授权已经执行，不能扩大为其他批次的处置授权。“允许结束历史批次”的软件能力与“结束哪个真实批次”的用户决定分开；后者必须明确到项目、账号、冻结计划、pageBatchId、完整成员数量及不可恢复的影响。不得仅凭批准本计划推断真实处置或新增制作授权。

本计划提出下文 v3 本地批次结束合同，属于目标内的软件修复方案；实施前将其窄修订写入原 Spec 并完成 Parent Self-Review。当前安装包仍执行 v2，历史 Plan/本文不能作为已安装能力或操作权限。

## References and Evidence

- [Upload Spec](../../douyin-auto-upload-spec.md)：正式成片准入、冻结目标、页面归属、九条分组、永久 fence、UNKNOWN 零重传。
- [Recovery Record](../../qianchuan-pause-recovery-2026-09-29.md)：重点 Target Acceptance Correction、Plan Target Repair、Installed Plan Target Repair、Five Store Acceptance and Batch Verification。
- [Plan Target Repair](2026-09-30-qianchuan-plan-target-repair.md)：删除计划阻断及明确整批改传，不扩大改传条件。
- [Batch Deletion Plan](2026-09-30-qianchuan-batch-deletion.md) / [Checkpoint](../../qianchuan-batch-deletion-2026-09-30.md)：原 DISCARDED 合同，保持已交付行为。
- 最近五店证据提交 `5359ed8`；运行包当时为 `qianchuan-shop-permission-20260930-1c886999`，asar SHA `1c8869996578b07f39cbd5ac67a89ccbcc8d0b83ffeda29877ebffec25d555b0`。后续 PID、端口、包身份、映射、计划状态及 ledger 必须重新读取。

## Current Behavior and Root Cause Boundary

最近实测的 562 条任务、150 个 fence 是验收基线，不作为未来硬编码计数。五店的可见账号、URL 双 ID、有效计划详情一致，“添加视频”可用；这只能证明页面准入的一部分，不能证明真实上传成功。

| Store / Stable Slot | Existing Candidate | Blocking Fact | Required Outcome |
| --- | --- | --- | --- |
| 热敷贴 / 热敷贴 | 54 条及 30 条完整未选批次 | 旧 81 条批次含 9 UNKNOWN，原 tab 丢失 | 原页只读或明确结束旧批次后，单独整批继续一个新候选 |
| 一根金 / 滴耳康 | 一条根项目 30 条完整未选批次 | 滴耳康项目旧 20 条批次含 1 UNKNOWN，同 advertiser 跨项目阻断 | 处置必须针对旧项目，不能通过切项目绕过 |
| 肥皂 / 肥皂 | 旧 52 条批次中有 41 条未选 | 同批 10 READY、1 UNKNOWN、41 PENDING | 原页已丢失时不拆出 41 条；结束整批不让这些文件重新入队 |
| 晚安油 / 眼贴 | 没有当前计划的完整未选批次 | 原 108 条已 DISCARDED；旧目标 50 READY 的 modal 丢失且非完整 108 条准入 | 保护已选历史；只有另行获得可用完整批次才能上传验收 |
| 蝴蝶贴 / 蝴蝶贴 | 没有本轮完整成片批次 | 旧 60 条 DISCARDED；现有批量项失败“请先接入模型。” | 核查冻结覆盖方式及制作准入；不自动恢复已删除授权 |

11 条 UNKNOWN 集中在三个账号，最近应用只读核查确认“无法恢复原批次 tab”。原页丢失不能证明平台未接收，也不能从这个结果倒推最初中断原因。已有 journal 中的停止请求、退出时 GPU fatal、删除计划 guard 缺陷分别留在原事件记录，不合并成未经证实的 crash 根因。

真实现有批量 run `a7b71c5e-ea01-4929-9b19-01077b15bb2c` 是热敷贴、一条根各 30 成片完成入账，蝴蝶贴 0 成片；两批 60 个输出及快照字节已核对，上传仍 PENDING。隔离 packaged smoke 的 17 合成输出、12 READY 不替代真实多店/批量验收。

## Contract Surfaces and Ownership

| Surface | Canonical Files | Planned Responsibility |
| --- | --- | --- |
| 上传持久化与审计 | `src/main/douyin-upload-store.ts` | 已知版本升级、本地批次结束元数据、同步归档、永久 fence 防重传 |
| 上传编排与继续 | `src/main/douyin-upload-service.ts` | 串行控制、排除已结束批次的调度资格、账号阻断及明确整批继续 |
| 共享结果与操作摘要 | `src/shared/douyin-upload.ts` | 保持原 result/outcome，定义批次结束摘要及 strict 请求 |
| 可信桌面入口 | `src/main/index.ts`, `src/main/preload.ts` | sender/project/task 校验、操作接收或拒绝反馈，不授予发布权 |
| 普通及批量展示 | `src/renderer/DouyinUploadPanel.tsx`, `src/renderer/BatchProductionDetails.tsx`, `src/renderer/qianchuan-upload-status.ts` | 活跃任务与历史结束摘要、阻断定位、制作和上传结果分别展示 |
| 浏览器与页面合同 | `src/main/douyin-cdp-uploader.ts`, `src/main/qianchuan-page-contract.ts` | 原 tab/modal 只读核查，删除/缺头部阻断，READY 及零确认 |
| 蝴蝶贴制作准入 | `src/main/batch-production-runtime.ts`, `src/main/batch-production-controller.ts`, `src/main/agent-controller.ts`, `src/main/agent-runner.ts`, `src/shared/agent.ts` | 核查冻结模式；只有真实配置/实现缺陷才修复原 owner |

目前制作及 ResultsPanel、对应测试和 AOCI 文件有另一窗口改动，全部保留。实施前重新检查 live agents、精确 allowed_paths 与当前报告；同文件存在另一 writer 时由用户决定归属或顺序，不能自行接管。CodeGraph 用于验证 store/service/IPC/批量详情调用关系，图中行号和推断关系再由当前源码核对。本计划不分派 writer，不重建队列，不迁移制作生命周期。

## Invariants

1. UNKNOWN 永不重选、重传；不得抹去 failure、READY 证据、selection fence、输入或冻结目标。READY 不是平台接受、确认或发布。
2. 本地批次结束只是撤销该批次未来上传资格，不改变平台文件或广告设置，不证明原上传成功或失败；整批所有未选成员也随之终结，不允许拆批恢复。
3. 结束、删除、改传均不启动 Chrome、不选择文件、不唤醒其他批次；其他批次必须另行明确“安全继续”。
4. 单项目、批量共用原正式完成通知、原 queue、service/store/page-contract；恢复扫描不能签发新上传授权。
5. 正式输入大小/hash、快照、账号/计划/页面归属全部有效且整批完整准入，才可取得文件选择资格；每组 fence 全部持久成功先于文件动作，下组先于选文件必须等上组全 READY。
6. 账号映射变化不改旧冻结目标；明确改传仍只允许完整、全部 NOT_SELECTED、无 fence/alias 的整批。未选文件不得为了规避同账号历史阻断而改传其他计划。
7. 禁止自动确定、发布、编辑计划或投放参数；禁止用临时上传脚本、平台内部 API 或新计划绕过应用 authority。

## Target Contract: Explicit Local Batch Closure

选择在原 ledger 中记录批次结束，保持全部原 task result，而不放宽现有 DISCARDED/READY schema。现有 `discardBatch` 对 READY 的拒绝继续保留；不强行将 READY 改成 UNKNOWN 或 DISCARDED。

- `DouyinUploadStore` 拥有 v3 ledger：沿用 config/intents/tasks/legacy，增加 strict `closedBatches`。每项绑定 `projectId`, `pageBatchId`, `advertiserId`, `adId`, `expectedCount`, 排序后的完整 `taskIds`, 原整批 intents/tasks 的 SHA-256 `archiveSha256`, `closedAt`。上述字段均由 store 重读生成，renderer 不提交列表、hash 或解除阻断声明。
- 已知 v2 升级为 v3 且 `closedBatches=[]`，旧 result、input、authorization、snapshot 和所有 fence 逐项不变；不因升级、启动或原页丢失而自动结束任务。未来/未知版本、坏 primary、不确定同步保持 STORE_UNAVAILABLE，不用备份回退授予上传许可。
- 原 v1 creator 历史仍沿既有隔离迁移路径保留，不转成千川授权；v3 不能重解释 legacy marker。ledger v3 不改 task identity 和 fence 的 v2 协议。
- 结束仅允许完整 intents/tasks 数量等于 expectedCount、成员/目标/项目一致、无活动上传、无 alias、未处置的整批。混合 WAITING_FOR_CONFIRMATION / NEEDS_HUMAN / PENDING 等非运行状态允许，部分准入如晚安油 50/108 拒绝。原已 DISCARDED 批次不重复结束，不恢复其资格。
- 使用原 store 的独占私有审计及 serial/atomic commit 模式，在 `batch-closure-history/<pageBatchId>.json` 完整保存原 intents/tasks，文件和目录 sync 成功、控制 generation 复查后，才向 v3 ledger 加入 closure。该目录只有历史证据，没有任务队列或独立调度规则。ledger 引用的审计缺失/不一致及同步结果不确定均阻断，孤立归档不算已完成结束，不自动重放处置操作。
- closed 成员的 result、outcome、readyEvidence、failure、attempt/retry count、冻结授权及 fence 保持原值；load 跳过这些成员的恢复状态改写，结果只读。任何 saveTask、markSelecting、resume、retarget、discard、reconcile/eligibility 回填均不得重新激活它们。
- `unresolvedAccountTasks` 和所有调度/继续入口仅从未结束的批次计算活动阻断；`duplicate` / `sameTargetBytes` / marker 校验仍遍历全部历史及 fence。结束批次后，同 advertiser+adId+hash 再入账仍零文件动作，不能通过隐藏历史实现重传。
- trusted IPC 新操作 `closeDouyinUploadBatch(projectId, uploadTaskId)` 只接受当前项目成员锚点。服务负责 idle、control/admission 互斥和二次核验。界面先展示整批账号、计划、总数以及 READY/UNKNOWN/未选分布，再要求用户明确确认“结束本批本地上传”；文案说明未选成员也不再上传、视频及全部历史保留、平台结果不变、不能恢复。
- 历史批次摘要可查看原结果，不暴露私有路径或凭据。普通及批量详情区分历史结果统计与当前待执行数量，不再让已结束成员看起来仍可继续；未结束 UNKNOWN 仍显示阻断。

## Major Milestones

### Milestone 1: Freeze Baseline and Diagnose Precisely

**Files / Evidence:** 只读运行包、项目状态、ledger、fence、mapping、现有批量详情；更新原 Recovery Record。读取已核对的 source 与 CodeGraph，不从头大范围探索。

重新读取 DevToolsActivePort/PID/executable/asar SHA；确认保存状态、无活动制作/导出/上传。建立逐批完整成员、NOT_SELECTED/READY/UNKNOWN、fence、alias、快照和账号阻断清单，明确当前项目与阻塞任务所属项目。对三个历史批次记录原 target/modal 是否存在；丢失时只报页面丢失及禁止重传，不恢复旧页面或重放文件。

蝴蝶贴按原批量 run 冻结模板核对 decoration mode、coverEnabled、cover mode 和模型预检：本地随机+关闭/手动覆盖无需模型；显式 Agent 覆盖仍要求对应视觉连接。若冻结配置本就要求 Agent，则报告配置准入失败并在下一次已授权制作前提示原因；若本地配置被错误地要求模型，先与原 owner 解决归属，再做最小修复。不得为跑通而静默关闭覆盖或连接真实商业模型。

**Acceptance:** 每个 blocker 有精确批次/owner/证据；已证明程序缺陷、配置准入、店铺权限、丢失页面和证据不足分别记录。已知诊断之外的新根因不得从历史计数猜测。

### Milestone 2: Deliver Safe Batch Closure and Explicit Action Feedback

**Modify:** Spec、上述 store/service/shared/IPC/UI；批量详情投影经原 controller/runtime 更新。**Tests:** 新增 `tests/douyin-upload-closure-store.test.ts`、`tests/douyin-upload-closure-service.test.ts`、`tests/douyin-upload-closure-ui.test.ts`，补充现有 contract/recovery/batch details 测试。

按 Target Contract 做 strict red-green：混合 READY/UNKNOWN 完整批次可明确结束并重启保持；原 READY 证据、未知诊断、fence、快照逐字节保留；部分准入、跨项目、目标不一致、alias、活动/并发 stop/resume/retarget、重复处置、归档/目录 sync 故障均拒绝。升级默认空 closure，启动零浏览器操作；closed task 的所有入口拒绝，闭批不自动继续新批；同目标历史 hash 防重传不变。

另测其他未结束批次的 duplicate_of 引用 closed 原任务：原证据与绑定保持，既有别名不取得新选择权限；结束不得跨批次改写别名或破坏原 validator 的 evidence 一致性。

当前 `index.ts` 的 resume IPC 用 `void resume(...).catch(() => notifyState())`，拒绝可能只更新状态而没有向调用方返回原因。补可执行复现后，让现有 owner 把“接收继续请求或拒绝”的决定交给可信 IPC/UI；接收反馈不等待整批 30 分钟上传，也不代表 READY。后台仍由同一个 service runner 执行，不建立第二个 resume 实现或队列。

**Acceptance:** packaged 桌面能展示准确范围、取消确认、跨项目拒绝、混合批次结束、历史保留、重启无恢复及随后另批明确继续；任何真实批次处置仍等待其单独授权。

### Milestone 3: Prevent Misleading Recovery and Batch Results

**Modify only when reproduction requires:** 页面 owner、上传/批量详情 UI 及有归属的制作 owner。**Tests:** `tests/qianchuan-upload-diagnostics.test.ts`, `tests/qianchuan-plan-target.test.ts`, `tests/douyin-upload-paused-status.test.ts`, `tests/batch-production.test.ts`, `tests/batch-production-details.test.ts`, `tests/local-random-cover.test.ts`。

保留已安装的 deleted/缺头部 guard 和严格店铺权限提示识别。详情加载中的 disabled 不归因权限，旧/隐藏/远处提示不作为当前拒绝证据；只在明确的平台权限原文成立时显示店铺问题，其他定位、浏览器、配置和存储错误保留自身类别。氨糖膏只用已留存页面事实及隔离 fixture 验证，不重新访问该店。

批量 run finished 只表示调度结束；每个商品分别展示制作/导出/上传及失败原因。已有实际两项 30/30、一项 0/30 的记录必须保持这一含义，不静默重试失败项、不继承上传选择、不改旧模板。明确指出阻塞来自哪个旧项目/批次，保留未选新批次，不只显示笼统“需人工核查”。

**Acceptance:** 在实际桌面中可区分已成片待上传、历史 UNKNOWN 阻断、历史已结束、制作准入失败、店铺权限拒绝；批量失败不被标为全批成功。

### Milestone 4: Verify, Review and Install a Reversible Candidate

**Commands:**

```bash
npm run typecheck
npx vitest run tests/douyin-*.test.ts tests/qianchuan-*.test.ts tests/batch-production.test.ts tests/batch-production-details.test.ts
npm run build
npm run harness -- code
xvfb-run -a node scripts/douyin-upload-smoke.mjs --packaged
xvfb-run -a node scripts/batch-qianchuan-upload-smoke.mjs --packaged
```

smoke 显式设置 JIANJI_SMOKE_ELECTRON 为 exact candidate，FFmpeg/FFprobe 用已实测支持 fps_mode/drawtext/overlay 的引擎；fixtures 使用隔离 userData 和本地 origin 拦截。新 closure 用独立桌面 fixture 验证，不能用磁盘改写冒充可信 IPC；补模拟文件选择后进程中断、原页消失、存储未知三条恢复场景，均零未知重传。暂停前至少一组 READY、暂停后整批继续须通过同一 modal 核验或准确阻断；再证明两账号及 export-only 项。

候选稳定且 project-native verification 通过后，按当前 SUBAGENTS Risk Gate 判断并记录。v3/closure 的错误目标或非法关闭可能掩盖账号 UNKNOWN 并造成不可逆外部副作用，是重点风险；按具体 consequence/gap/value 决定 required review，不用本计划调查或历史 PARSED 代替实施审查。必要 review 绑定新字节、Spec/Plan 和 fresh 证据；semantic fix 后按合同重新验证和 re-review，不重置旧轮次。

只维护本轮受管理对象及基线，完整机器批次出现他人所有权对象则报告并解决，不改他人的 AOCI 行。运行 Verify/Check/Guide，scoped commit，冻结构建源及包 SHA。安装前再次确认无活动操作、项目已保存；备份 launcher、项目、完整账本及全部 fence，逐文件核对，保留旧包。活动制作/上传不得重启。

**Compatibility / Rollback:** v3 的 ledger 版本独立于原 task identity/fence v2，task ID、冻结 digest 和已有 fence 不变。旧 v2 程序不能读取 v3，不宣称仅恢复旧 launcher 就能回滚；保留一个能读取 v3 的回滚候选。已经结束批次或发生新选择后，不恢复安装前旧 ledger，不丢弃新 fence，不重新授予旧批次资格；优先回滚代码并保留当前数据、继续 fail closed。只有尚未有新处置/入账/选择且数据与备份逐项匹配时才可完整恢复数据。

**Acceptance:** 已安装字节与测试候选一致，升级/closure/restart/rollback边界有执行证据；安装后只读核对旧任务、全部 fence、快照和氨糖膏不变。

### Milestone 5: Close Real Acceptance in Dependency Order

1. 重新核实五店账号和有效计划；选已有热敷贴 30 条完整批次作为第一个恢复候选，已有 54 条保留。只有旧账号原页只读核验消解阻断，或用户明确授权并经新应用结束旧 81 条批次后，才对候选点击一次“安全继续”。闭批本身零文件动作。
2. 观察实际应用与实际平台同一批次按最多 `9/9/9/3` 推进；保存每组绑定的精确文件列表、hash、fence、target/modal、READY 时间及下一组首次选择时间，后者必须晚于上组最后 READY。暂停后只通过整批继续入口恢复剩余组，不用逐条继续或另建页面伪装恢复。若任一组 UNKNOWN，整批停住并保留证据。
3. 一根金先在滴耳康旧项目处置旧 20 条阻塞批次，再在一条根项目对已有 30 条整批继续，证明同账号跨项目规则准确、不同账号不共享 READY。同样停止在确定前。
4. 肥皂旧 52 条整批结束会同时终结 41 条未选成员，不能把它们拆出或复制为新上传授权；该店现无独立完整未选候选，需用户另行允许使用符合现有准入的批次或有限新增制作。权限及详情核查通过不算该店上传验收。
5. 晚安油和蝴蝶贴同样需要可用完整未选批次；优先只读寻找已有授权且确实准入的批次，若没有，记录缺口并请求有限制作范围，而不从历史视频目录重新签发任意上传授权。蝴蝶贴的制作配置先经 Milestone 1/3 验证。现有“不新增真实制作”的限制未改变前，不做此项依赖动作。
6. 真实跨模板批量入口只有另行允许制作后才运行：固定每个商品明确账号、条数/手填文字/冻结配置，包含两账号各超过 9 条及一个 export-only 项；无覆盖候选/权限时不启动。与单项目一样证明正式通知入账、整组 READY 后推进、取消/暂停恢复及零确定；用旧 run 详情或 standalone 浏览器上传替代整批入口不得通过。

每个账号的验收清单分别记为 READY verified / BLOCKED / NOT RUN，旁列本地 fixture、桌面操作、真实上传、平台确认/发布、人工成片观看。只能在所有适用真实验收条目满足时交付总体通过；平台确认/发布始终不执行，Windows 不验证。

## Completion Criteria and Natural Stops

- 已安装包、当前 mapping、平台计划、明确授权批次、应用操作、文件列表及永久记录一致；真实单项目与批量各有完整九条分组、全组 READY 推进、停止在确定前证据。
- closed 历史和 UNKNOWN 保留原结果、READY 证据、输入、冻结授权、快照及所有 fence；同目标同 hash 未重传，氨糖膏及无关账号/制作改动保持。
- 蝴蝶贴模式问题以冻结配置及实际代码证据判定，不能为测试而改变产品意图。闭批/继续拒绝能明确反馈；工程 PASS 与真实 READY/人工观看分开。
- ownership 冲突、真实批次处置尚未授权、没有可用候选且禁止新增制作、实际权限/容量/页面/存储问题及 required review 未通过都是明确停点；不通过清 fence、换计划、改结果或重试 UNKNOWN 规避。
- scoped code/doc commits、fresh verification、适用 Risk Gate、AOCI 及可回滚安装证明完整；事实和阻塞续写原 Recovery Record，不生成交接 prompt。

## Self-Review

覆盖五店及批量、用户停止氨糖膏、无新增制作、当前树 ownership、已选/未知历史、9 条分组、全组 READY、可信 IPC、存储及版本回滚。最关键的补充是 READY 混合批次不能使用现有删除按钮；批次结束另有显式元数据，原结果不改写。已结束历史仍参与同目标 hash/fence 防重传，关闭不是重新上传许可。没有可用候选的三店及真实批量制作必须保持 BLOCKED，计划不自动扩大用户授权。

独立有界代码 mapping 使用 `external-subagent` 的 sealed deep/max 路由，invocation `dbcaef76-78d9-4372-9b41-e59ae12d65dc`，canonical receipt PARSED、2 请求 IDENTITY_VERIFIED、exit 0，无重试。Parent 核实并采纳 READY 白名单/schema、load 恢复与 permanent dedup 的证据；拒绝其“仅放宽 discard 白名单且无需 schema 变化”的建议，因为现有 readyEvidence 仍强制 WAITING_FOR_CONFIRMATION。本文采用 batch closure 元数据避免改原结果。该调用只调查四个源码/测试文件，不是 Plan reviewer、v3 实现验收或真实平台证明；Self-Review 与设计裁决由 Parent 完成。
