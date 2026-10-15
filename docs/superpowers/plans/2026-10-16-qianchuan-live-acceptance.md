# Qianchuan Live Acceptance Continuation

## Goal And Authority

继续 [Real Integration Spec](../specs/2026-10-15-qianchuan-real-integration.md) 的计划身份核对与 A02–A04 真实验收。用户明确授权继续两项工作；此前 [Acceptance](../../qianchuan-real-integration-acceptance-2026-10-16.md) 的未完成项不能因新增授权直接标通过。使用既有 worktree 与分支，起点 `c112270e4eaeb245aa1d92c5400b04db40e6de22`。

## Contracts And Boundaries

- 保存默认计划、当前网页账户、用户本次选择和历史冻结目标分别展示。目录读取不自动保存；只有明确选择并保存才调用原 `saveQianchuanAccount` / `QianchuanAccountSettings.savePlan`，不调用历史 retarget 或关闭旧批次。
- 真实表单与动作来自正常平台和可追溯观察。只操作本次自有页面，不导航、刷新、关闭或提交原用户页；REA 保持被动。登录、验证码、权限、身份或配方不明时关闭本次自有页并保留阻断证据。
- 投放执行沿 `QianchuanDelivery` / store 的原审计、额度预留、一次发送和独立回读；不能将静态线索标为真实写入资格。任何受控首次资格验证也必须先冻结精确动作、对象和有限授权，再持久意图，不能伪造 `live-write-verified` 绕过原准入。
- 先读取当前值、范围和最小可行验收对象，形成具体执行单。授权必须有对象、目标值、币种/预算类型、目标上限、累计增加额、次数和有效期；当前商业配置不是这些新目标的默认授权。只在缺少具体商业边界时请求这一份执行单的确认，不重复询问是否允许调查或实施。
- 不恢复旧上传权限、不重新发送 READY/UNKNOWN，不复制登录资料，不以第二套上传/生产生命周期完成测试。需要真实写操作前，须在唯一运行 owner 中落实共享资源准入，不能由旁路脚本直接点击提交。

## Major Milestones

### M1: Explicit Saved-plan Selection

**Files:** `src/renderer/QianchuanAccountSettings.tsx`、必要的聚焦组件、`tests/qianchuan-plan-selection-ui.test.ts`；复用原 `QianchuanPlanSelect`。

账号编辑时显示保存的账户/计划；显式展开当前网页目录选择器。非空明确选择只更新草稿链接，保存仍走原回调及主进程校验。切换编辑账号或取消时丢弃选择器状态；迟到结果不能改另一账号草稿。目录中的计划不冒充浏览器当前打开计划，名称不代替精确 ID。

**Verification:** 原计划选择 UI 回归及新增差异身份、无自动保存、显式保存与切换隔离回归；typecheck；实际 Chrome 交互；对应 owned Harness。

### M2: Observed Forms And Bounded Execution Sheet

**Files:** 本计划及本轮证据报告；实际平台 envelopes 和图片仅放本机私有目录。

核对已保存和当前页面计划的商品、模式、预算类型、ROI 与状态；自有页只读查看编辑和创建表单。记录完整必填值、范围、创建暂停语义、唯一提交点、失败和独立回读接缝。当前自有页账户就绪超时须先补现场诊断，不能弱化身份条件。

**Acceptance:** 每个动作有可执行的实际页面配方或具体技术阻断；有一份对象和所有商业边界清楚的执行单。未提交时平台写入计数为零。

### M3: Original-owner Qualification And Live Proof

在 M2 实际证据与具体执行授权齐备后，按所需最小 delta 接入原主进程 executor/资源保护和 UI；新增接口及文件集合依据实际配方补入本计划后实施，不设计任意请求入口。先跑工程边界，再进行每动作至多一次的受控提交和独立回读；未知即停止相关写入。新上传要求本轮已验证成片并沿原队列与确认 owner。

**Verification:** 真实前值、授权、意图、一次提交、精确平台对象及回读分别留证；代码变更运行 typecheck/受影响测试、必要 Chrome 集成及完整 owned Harness/completion。稳定语义快照按原生 Review Risk Gate 判定；沿用原审查历史，不重置轮次，不以 reviewer 代替平台验收。

## Ownership And Self-review

Parent 拥有平台操作、配方和授权裁决、共享契约、最终验证。Native mapper 仅源代码只读定位；M1 可按精确不相交路径委派 bounded worker，不能委派真实写入。Parent 不同时写 worker 的文件。

本计划覆盖用户两项继续请求。M1 可独立完成；M2 不需要新的调查许可；M3 必须消费已完成的配方与有界执行单，不把本轮概括授权解释为无限投放。真实运行 owner、身份和未知屏障不因验收需要而降低。

## Approved Execution And First Qualification Delta

用户于 2026-10-15T16:45:04Z 前明确选择执行单 A；保守使用收到答复前的已知时刻 16:44:46Z 为起点，绝对期限 2026-10-15T17:44:46Z。账户 `1876131703522649`、按摩油商品 `3847118098272485669`、计划 `1878488818847384`；保存默认计划并沿原 owner 新制作上传一条。ROI 1.95→1.96、CNY 日预算 5000→4999、暂停与重新启用各至多一次，预算上限 5000.00、累计增加 0.00。所有前值重新核验；期限不因实现或测试延迟顺延，UNKNOWN 不重试、不自动回滚。当前商品新建计划仍阻断。

现有普通 executor 在首次写验前要求 live-write-verified，不能通过伪造资格完成首验。任务内补充一次性 main-only 首次资格许可，仍走原 execute/reserve/submit/readback/settle，不增加发送链。许可只适用于已观察独立表单的单项动作，绑定原生 main 的 sender、配置摘要、精确草稿与配方证据/摘要，maxActions=1；不因 renderer 自报资格升级，跨重启不恢复。审计在原账本记录 qualification provenance，正常未准入动作继续零提交。首次成功仅形成对应账户/动作/配方证据，不能推广到创建或其他账户。

**Files And Ownership:** bounded worker 独占 `src/main/qianchuan-delivery.ts`、`src/main/qianchuan-delivery-store.ts`、`tests/qianchuan-delivery.test.ts`、`tests/qianchuan-delivery-store.test.ts`；Parent 拥有固定页面 adapter、新接缝及 schema/IPC/preload/既有面板与其必要测试、原资源 owner 的最小冻结目标交接、policy 与本计划。M1 worker 此时仅写私有 UI QA fixture，不再写业务源码。必须先完成工程验证与原生风险审查，再在唯一正常 main runtime 执行；不得另起共享真实 userData 的第二 owner 或用私有脚本直接提交。

## Deadline Review Repair

正常主目录还已采用 main 的 `6c8935708e71024eec432d7d8e2b15d1c32a88b5` 本机会话绑定修复；旧 worktree 的 storage 拒绝此新格式，用户登录后仍无法恢复。为保持同一主目录的正常身份，直接复用该提交的 `src/main/membership-storage.ts` 修复、`tests/membership-storage.test.ts` 回归及合同说明，不复制或解密凭据，不改变本机签名核验与云端配置绑定。恢复兼容性是本轮运行前提，纳入最终 owned scope、AOCI 和同一次原生复核。

首轮完整 Harness 19/19 与 completion 通过后，原生 `reviewer_xhigh` 第三轮在快照中复现 QLIVE-001：executor 检查期限后，adapter 的读取或原生点击等待可能使实际点击晚于绝对期限。Parent 确认阻断，真实调价保持零提交。修复将冻结 `expiresAt` 传至实际提交 adapter，在原 DOM 元素的捕获事件上检查期限与冻结输入，且原生点击等待不能超过剩余授权时间；替换文档/元素、到期或目标值漂移均不放行。没有切换为强制点击或直接提交网络请求。

新增回归分别跨越最后读取、按钮可操作性等待和浏览器事件时钟；同一等待边界也覆盖目标值变化。旧代码的三项期限反例及目标漂移反例先 RED，修复后重验。首次审查历史两轮、此次第三轮及其消费保留；基于已复现的单一提交边界缺口，任务内追加最多两轮原生审查预算，使用同一 reviewer 做完整接口及边界复核，不重置历史。新快照必须重新通过 applicable Harness/completion，仍有阻断则停止写入，不机械续轮。

## Round Four Repair And Isolated Verification

第四轮仍由同一 `reviewer_xhigh` 审查，保留前三轮消费。QLIVE-001 的远端时钟偏移反例确认：browser 比 main 慢 60 秒时，已派发但延后处理的点击可能越过绝对期限；快 60 秒时也会错误拒绝有效点击。最终以原文档的 `performance.now()` 取样，收到样本后才计算 main 剩余时间，并扣除 10ms 分辨率余量，将期限保守映射到同一浏览器单调时钟。版本改为独立表单 recipe v3；没有延长用户授权。

同时确认 QLIVE-002：明确在任何原生点击前到期可由受信任 adapter 返回固定 `not-sent / AUTHORIZATION_EXPIRED`，沿原 store 结算 NOT_SENT；同一首次许可仍已消费。原生输入已经派发或无法证明未发送时继续 UNKNOWN，不以事件被拦截直接推断可重试。捕获 guard 在调用超时后保留至自有文档销毁，以覆盖迟到输入；实际提交元素和原输入还须属于最初冻结的 Document，不能在读取后跨导航重解析。

时钟偏移、有效但浏览器时钟超前、末读后换文档、调用超时后迟到原生事件、同文档账户或 URL 在按钮等待期间漂移，以及 NOT_SENT 仍不恢复原许可分别有先 RED 后 GREEN 的隔离反例。事件 guard 还须同步核对唯一可见账户及固定 origin/path/aavid，不能只检查 Document 相同。五个相关文件 77/77、typecheck 通过后，仍须最终完整 Harness/completion 及第五轮完整复审；第五轮是已记录追加预算的最后一轮，不重置历史，不以工程证据代替真实平台写验。

原 `aa7c` worktree 在 S4 验证之后被另一会话修改账户底层及正式 AOCI；不覆盖或提交这些改动。用户当前任务已明确要求 worktree，故将冻结 S4 的 26 个 owned 文件及本报告迁移至 `/home/reggie/.codex/worktrees/qianchuan-acceptance-final/jianji`、分支 `feat/qianchuan-real-integration-acceptance`，仍以 `c112270e4eaeb245aa1d92c5400b04db40e6de22` 为基线。迁移后 38 个 S4 源码/合同上下文字节逐项相同，再在新 worktree 修复本节边界并重新验证；原目录全部工作保留。本次不启动真实应用或接管当前主目录实例，真实执行单依然于 `17:44:46Z` 过期。
