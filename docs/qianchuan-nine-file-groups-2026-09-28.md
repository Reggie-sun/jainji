# Scope And Accepted Delta

用户在当前任务明确授权实现：每次文件选择最多 9 条；该组全部 ready、逐文件结果全部持久保存后才继续；最终停在“确定”前。该要求替代 [Spec 0.2](douyin-auto-upload-spec.md) 和 [Plan](superpowers/plans/2026-09-27-douyin-auto-upload.md) 中旧的单文件选择描述，其余准入、归属、永久 fence 和未知零重传约束继续适用。没有新增上传队列、模型 Agent、持久化格式或确认能力；在 current working tree 串行实施，没有 worktree。

本次没有选择用户真实视频、操作眼贴账号、确认、发布或修改广告设置。此前滴耳康 84 条由独立脚本上传成功的记录见 [Live Upload](qianchuan-live-upload-2026-09-28.md)，不作为本次应用端到端验收。

# Implementation

`DouyinUploadService` 从当前进程已准入的 PENDING 正式产物中，按同一冻结 pageBatchId 取最多 9 个不同目标字节；不等待凑满、不阻塞 FFmpeg。组内重复字节在原有目标/SHA 去重路径处理。同一组全部私有快照校验后，逐件持久 `markSelecting`，全部成功才调用一次数组文件动作。各文件沿用 v2 原有永久 fence、连续 selectedIndex 和同一 tab/modal 归属，不增加组 ledger。

`DouyinCdpUploader` 和 `QianchuanPageSession` 的 open/upload/ready 消费有界数组。生产路径仍使用原生 CDP 文件拖放；每个事件前核对身份、唯一入口与 hit test。prepare 检查整批容量和既有 ready 前缀；处理中允许本组文件行迟到及重排，但既有成功文件必须保持。计数、精确文件名、成功图标及 progress 在一次有限 DOM 快照中读取，避免列表重排造成跨行误读；全体文件、精确数量、可用的确认按钮及无取消/失败信号同时成立才返回整组证据。确认按钮只读、不点击。

服务核验整组证据和快照后逐件保存 `WAITING_FOR_CONFIRMATION`，全部保存成功才继续。任一 fence 写入、delivery、ready、保存、取消或超时失败均停止推进；已有 fence 永久保留，未保存成功的成员按未知处理，已保存 READY 不回退。重启不自动唤醒待传文件；显式核查只在原 tab/modal 读取同组未解决成员，不重传或补开新页面。

# Verification

分组初版的相关 12 个测试文件 177/177 PASS，包含 service 9+9+3、整组 ready/最后一项保存阻断、组内去重、第 1/5/9 项 fence 失败时零文件动作、部分 READY 保存失败、取消/超时、原页面整组只读恢复。该时点浏览器 production-selector fixture 38/38 PASS；保留错账号/错计划、陌生/消失/重命名行、数量与容量异常、未知零重传等拒绝测试。下文 Final Checkpoint 记录后续修正及最新证据。

`npm run build` PASS（含 typecheck）。桌面 smoke 报告 `/tmp/jianji-qianchuan-smoke-8Pont8/report.json` PASS：真实 FFmpeg 生成 12 条正式合成成片，应用自动按 1+9+2 送入本地 production-DOM fixture，逐文件 12 个 fence 和累计 readyCount 一致；另一次显式追加 1 条成功。默认关闭、项目切换/提交清空选择、受限 IPC、保存重开、重启零重选通过，`confirmClicks:0`，广告设置事件 0，`realAccountsUsed:false`。

最初默认 FFmpeg 缺少 renderer 能力，随后使用 `/home/reggie/.config/jianji/tools/ffmpeg/bin/{ffmpeg,ffprobe}`。桌面测试旧的“同一导出 batch 必须有 12 条”断言与当前逐版入队源码不符，已改为核对当前项目的全部正式任务；追加入口明确选第一条成片。上述失败记录保留，未改其他任务持有的制作/UI 源码。

详细日志在 `/tmp/jianji-qianchuan-nine-w58q4x7c/`。首次完整 Harness 的各测试组通过，但运行期间修改了 smoke driver，源码一致性使聚合结果为 NOT_EVALUATED；不能称为 PASS。第二次发现旧的 unsafe-CDP 测试将动态后台 worker 当作新增 tab；现在仅比较 `type === "page"` 的有序身份集合，仍严格核验拒绝 attach 后没有新增实际页面，生产拒绝条件未变。该轮 FAIL 也保留。

审查前 code Harness `20260928T090412Z-d94061b0` PASS：typecheck 和 394 tests（上传组 136），无失败、无跳过，运行前后 sourceIdentity 相同。该 snapshot 的 AOCI Maintain 返回 aligned、无候选及零语义写入；Verify、Check exit 0，Guide complete/none。正式索引由其 owner 对齐，本任务没有写入或 stage `aoci.code.txt`、`.aoci/baseline.json`，不宣称完整系统认知验证。随后可见性修正与其他任务的新代码使这些历史门禁不能代表最新全仓状态。

# Review And Evidence Boundary

上一 production adapter 快照三次 required review 无有效终结回执，仍保留 [Production Adapter Record](qianchuan-production-adapter-2026-09-28.md) 的 `REVIEW_ESCALATION_REQUIRED` 历史。不会自动复跑旧候选第四轮。此次新增数组 delivery、全组永久 fence、整组 ready/持久保存、组取消和多成员只读恢复，形成真实新增 implementation surfaces；只有完成 fresh native verification 后，才依 `SUBAGENTS.md` 为该新增 material scope 分配新的有限审查预算。

应用真实账号正式导出后上传、Windows 权限/目录同步及该候选安装包仍未验收；浏览器 fixture、桌面合成视频及此前独立脚本证据均不能替代这些证据。Repository 无专用 session-record/capture skill，本文件记录授权增量与检查边界，不更新全局 memory。

# Final Checkpoint

新增 scope 的审查第 1 轮绑定 snapshot `c011a700b852e8735bfd5c11d344df7e5d92263026eaf58bf5d2200cea971596`，受管 Kimi deep invocation `88e21513-d83d-4210-9fcc-e85f38f3cb7b`。Containment/qualification 可机械核验；第一请求为 authenticated k3/max，13 项真实 Read 完整；第二请求持续约 324 秒后在 RESPONSE_BODY 发生 CONNECTION_ERROR，虽收到约 1.2 MiB 上游字节，仍为 OUTCOME_UNKNOWN，没有终结 findings。不可当作独立审查通过。前置 inspect 的零请求额度拒绝不计 live round；最终有限预算为 wall 480 秒、idle 240 秒、3 requests、generation 12000、context 600000 bytes、output 8 MiB。没有自动重试此候选或启动旧 scope 第四轮。

Parent 在封存期间以独立合成 DOM 复现：`visibility:collapse` 时 Playwright isVisible 为 false，但初版快照判断为 true。回执结束、解封后添加 hidden/collapse 九文件组回归，先观察 collapse 测试失败，再将可见性条件改为严格 `visibility === "visible"`。最新五个相关测试文件 88/88 PASS，其中 CDP 40、service 23、integration 5、store 17、page contract 3，无跳过。最新桌面 `/tmp/jianji-qianchuan-smoke-SKhebT/report.json` PASS，仍为 12 条正式合成成片按 1+9+2、12 个永久 fence、独立追加成功、重启零重选、确认/广告设置零动作，无真实账号。

最新 source/test/smoke snapshot 为 `04e44794b7217ade88bad2d47985a814cf55b1edbb1184d224cea2d715811250`，hash 清单和旧/新回执在 `.agent/harness/runs/20260928-qianchuan-nine-w58q4x7c/`。该修正尚未重新审查：最新 `npm run build` 和独立 typecheck 均被其他任务新增的 `src/main/source-fact-review-session.ts` 第 49/58/63 行四处 TS18048 阻断，不修改其文件，也不在 native verification 未通过时消耗新审查轮次。

最新 AOCI Guide 为 authoring_required，完整机器批次同时包含本任务的 page contract，以及其他任务的 source-fact-review、batch-production、index、queue 文件。不能截取该批次或自行接管共享正式索引；待对应 owner 稳定后完成治理。当前状态为 `VERIFICATION_BLOCKED / REQUIRED_REVIEW_PENDING`，代码保留为具体候选并按任务路径暂存，未 commit、未发布。完成门禁不能由前一 snapshot 的 Harness/build、浏览器/桌面成功或独立历史上传代替。

# Continuation Verification

用户继续授权后重新核验：其他任务的修复已进入 HEAD `5c4d3844ed0c4df0f999a82eba11e107bab9c554`，上述 TS18048 阻断已解除。本任务 10 项 source/test/smoke hash 仍与 snapshot `04e44794b7217ade88bad2d47985a814cf55b1edbb1184d224cea2d715811250` 相同，没有覆写其他任务文件。

本轮 fresh `npm run typecheck`、88 项相关 tests、`npm run build` 均通过。Code Harness `20260928T122600Z-de300c04` PASS，398/398 tests，无跳过，运行前后 sourceIdentity 相同。AOCI Verify、Check exit 0，Guide 为 complete/aligned、next_action none；本任务没有改写共享索引。

开发桌面 `/tmp/jianji-qianchuan-smoke-d3dVZU/report.json` 和 Linux 包内 `/tmp/jianji-qianchuan-smoke-P7SrLn/report.json` 均 PASS：各自真实 FFmpeg 生成 12 条正式合成成片，应用按 1+9+2 选择，12 个永久 fence 及累计 readyCount 一致，独立追加、受限 IPC、默认关闭、选择清空及重启零重选通过。包内使用未修改 `app.asar` 的生产 adapter，仅独立测试 profile 将生产 origin 截获到本地 fixture；`realAccountsUsed:false`，`confirmClicks:0`，广告设置事件 0。

`npm run package:linux` exit 0，生成 AppImage、deb；包中包含当前 working tree 的其他任务修改，不是只包含本任务的发行包。AppImage SHA-256 `458b9f930a3ac5bc577d1c67084b2962354d352593a3c092129cc31224b81240`，deb SHA-256 `f5b93ba208c17678f0ea08af9233714a4a42f98cdba8796665c050cef6d4e9af`。本轮日志位于 `/tmp/jianji-qianchuan-continuation-20260928/`，快照、报告副本及包 hash 位于 `.agent/harness/runs/20260928-qianchuan-nine-continuation/`。

新增 material scope 第 2 轮为受管 Kimi deep invocation `a3812fe5-62b8-4e95-a902-cf43e746dbf7`，seal `cd1d6c38017ed908ee5ce9f5d5355b944836dd01ec4ee4b17ef18455c94838c1`。保留完整 owner/source/tests/spec/plan，移除重复的大型测试 diff，改为 2 个请求：一次实际批量 Read 后 FINAL_REPORT。Finite budgets 为 wall 480 秒、idle 240 秒、generation 12000、context 600000 bytes、output 8 MiB。20 项 actual Read 全部完整、未截断、hash 与当前字节一致；首个 authenticated k3/max request 50.54 秒、1463 output tokens。第二个 FINAL_REPORT request 312.47 秒后 RESPONSE_BODY CONNECTION_ERROR，收到 1036170 bytes；仍为 OUTCOME_UNKNOWN，没有 terminal findings。不是 wall/idle/output cap failure，也未采纳部分报告。

调查上述重复传输失败后，第 3 轮仅将 generation 上限降低到 8192，完整审查范围、deep/max、其他有限预算及拒绝边界不变。Invocation `001c8759-5bf4-4015-9689-35e58b1b2507`，seal `8dd1d1c9c88faecae79c25b6b777496eae3dacd4bc02db1be8d5197bc30950c3`。首请求 authenticated k3/max，44.17 秒、1290 output tokens；FINAL_REPORT 请求 314.15 秒后为 `UPSTREAM_GENERATION_LIMIT`，收到 1034279 bytes。正式 receipt 的 observed_reads 为 0，没有 terminal canonical report；不能将诊断流的 Read 调用或部分生成内容当成有效审查。不是完整 findings 或审查通过。

# Delivery Gate

新增 scope 三个 live rounds 均无有效终结报告，当前为 `REVIEW_ESCALATION_REQUIRED`。旧 adapter 的三轮历史没有重试，本轮也不自动发起第 4 轮。按 `/home/reggie/.codex/SUBAGENTS.md` 的升级规则，Parent 直接核查 `runPending/execute/resume`、`prepare/upload/observe/restore` 与 `markSelecting/saveTask`：上限 9、逐文件永久 fence 先于数组 delivery、整组证据与逐件持久保存先于下一组、原页面只读恢复及未知零重传仍由原 owner 执行。对应 fresh fault-injection/CDP/桌面/包内证据在上文。Parent 核查不替代缺失的 required review，也不能宣称真实应用上传已验收。

代码及任务记录保留为本任务 14 个精确路径的暂存候选，未 commit、未发布、未安装覆盖运行中的用户应用。真实账号正式导出后自动上传与 Windows 实机仍未执行；后续额外 review 需 current user 明确授权，不能凭“继续”或改 snapshot 名称重置预算。Repository 无专用 session-record skill；本记录保存本次实质验证及 genuine blocker，不写全局 memory。

回执后核验 artifact hashes 和本任务 source/test/smoke hashes；候选仍未漂移。其他任务在等待期间新增 source-fact qualification 文件并继续修改其脚本/计划，均未接管或 stage。最终 `npm run typecheck` 再次 exit 0，暂存 diff 无空白错误、文档本地引用有效。上述 Harness、桌面及包证据保持其明确运行快照，不宣称等待期间新增代码已被该包验收。

# Authorized Candidate Commit

用户随后明确要求“commit然后维护aoci”，授权将上述候选作为 checkpoint 提交，再执行 AOCI 维护。该授权只改变提交决定和维护顺序；`REVIEW_ESCALATION_REQUIRED`、真实账号应用端到端与 Windows 未验收状态继续保留，不将 commit 当作 required review 通过，也不新增 review、真实上传、确认、发布或广告设置操作。只提交本任务 14 个精确路径；其他 working-tree 改动及用户项目删除保留。
