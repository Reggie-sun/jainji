---
title: Shape-Matched Cover M4-B2 Frozen Pixels And Queue Preview
status: frozen-geometry-preview-implemented-production-admission-blocked
date: 2026-09-27
spec: shape-matched-cover-spec.md
plan: shape-matched-cover-plan.md
---

# Scope And Ownership

用户在 `5b95024` 的 [M4-B1](shape-matched-cover-m4b1.md) 检查点后授权继续。本轮从 clean checkout 使用原工作树，执行现有 plan 的 [M4-B2 slice](shape-matched-cover-plan.md#active-slice--m4-b2)：共同候选 → 实际 RGBA/有限轮廓 → 无损冻结 PNG → 原 compiler/queue preview。没有接 AgentRunner/Controller、UI 或生产选款，没有调用产品 Agent、付费模型或 Kimi review。

| Concern | Owner |
| --- | --- |
| 显式冻结策略与有界绑定 | [shape-cover.ts](../src/shared/shape-cover.ts) |
| 重新检查整轮、生成/验证/发布图层字节 | [shape-cover-freeze.ts](../src/main/shape-cover-freeze.ts) |
| 源修订复核、PNG 快照读取、正式输出阻断 | [shape-cover-render.ts](../src/main/shape-cover-render.ts) |
| 原模板 schema / 渲染 / 队列消费 | [domain.ts](../src/main/domain.ts)、[compiler.ts](../src/main/compiler.ts)、[queue.ts](../src/main/queue.ts) |

M3 像素算法、阈值和源知识 store 保留单一 owner；`readAdmittedShapeCoverTarget` 只是将 M4-B1 已有准入 seam 暴露给冻结和预览复核。真实 alpha 与 RGBA 共用媒体栅格路径，M4-B1 alpha-only 计算不会因此额外分配全画布 RGBA。

# Freeze And Consumption Contract

`freezeShapeCoverCandidate` 接收完整 M4-B1 request 和 selected candidate ID，重新计算完整矩阵，不接受调用者传入的旧 PASS 或伪造 verdict。只有共同集合中的一款能冻结。实际原资产字节和 alpha 必须匹配该矩阵；按 M3 已通过的半径生成不透明白色小幅轮廓，原图案按实际 alpha 合成其上，轮廓外保留真实透明/半透明像素。不是白底矩形、crop 或 bbox fallback。

每个 target/output 单元独立生成最终输出尺寸的 RGBA，编码无损 PNG，再真实解码，要求逐字节与原 RGBA 相等，且投影后的每个 oldMaskFinal 像素都被 alpha=255 覆盖。绑定包含 source identity/revision/facts/mask、candidate ID/原指纹、output settings/scale-pad/placement/range、像素合同/alpha 版本/半径，以及 PNG/RGBA/final-alpha/binding 摘要。绑定摘要检测元数据漂移，不冒充签名、内容安全批准或输出时序收据。

全部计算有效后，在本次独占 UUID 子目录以临时文件 + sync + 不替换已有文件的 hard link 发布 PNG；同一操作内相同内容可复用。发布前后重新核对全部源绑定和所选资产。变化或取消返回 `UNSAFE`，只清理本次实际创建的目录，保留其他 owner 文件；没有覆盖源视频、已有输出或其他操作目录。文件系统不支持所需发布操作时失败，不回退到替换文件。

冻结层使用全输出画布 PNG 和显式 `shape-matched-frozen-rgba-v1` 标记。schema 拒绝重新摆放、隐藏、改普通轨迹时段、白底开关、改贴纸 ID/图层指纹，以及将近似 placement/历史 sampled knowledge 混成源 mask 事实。compiler 核对源、设置、绑定摘要、PNG 摘要和尺寸，读取独立 Buffer 快照，交给原 queue 的任务 `binaryFiles`；FFmpeg 使用任务副本，不再打开可变原资产。该分支直接 `overlay=0:0`，不再 scale/crop/pad、重新舍入或联合价格渐隐。原候选文件删除后，已冻结图层仍可预览；冻结 PNG 损坏则明确失败。

原 `renderPreview` 须显式提供同一个 canonical `sourceKnowledgeStore`，在渲染前后复核 source head、mask 和 facts。缺 store、revision 变化、争议或证据失效均不返回有效样片；渲染中变化会删除该样片。现有 app 创建 queue 的路径尚未接该 dependency，因此不会意外启用新策略。非 shape 模板不需要新增依赖。

任务字节文件与原文字/graph 文件一起写入和清理；先等待全部写入结果再处理失败，避免尚未完成的写入跨过清理。成功、渲染失败、写入失败和取消的副本清理均有测试。正式导出代码沿同一 compiler/resource 路径准备消费这些字节，但本轮未运行成功的 shape 正式导出：`createBatch`（包括批准重放）、`publishApprovedSample` 和恢复重试的 `execute` 都在新策略上返回 `UNSAFE`。不存在可由调用者填写的 content-safety PASS 字段。

# Output Clock Regression Evidence

真实 128×128、24fps、3 秒 fixture 经 canonical source-mask admission，目标 required range 为 `[517,2034)`。原先只在输出参数使用 `-r 30`，overlay 仍按源 24fps 时钟先启停：720p/30fps 第 61 帧、PTS 约 2033.333ms 本应覆盖，却使用已停止覆盖的画面。最终输出 ROI 测试得到 red=173（要求覆盖区 red>180），单项测试 exit 1。这里的颜色断言是合成 fixture 的可执行检查，不能替代通用像素/内容安全判据。

新策略在 overlay **之前**用 `fps=30` 建立输出帧时钟；同一 source/placement/range fixture 单项转为 PASS。随后在 source 输出的 72 帧和 padded 720p/30fps 的 90 帧上，逐帧读取真实 PTS 与 RGB ROI，核对半开区间内全部保守 mask 区域被覆盖、区间外恢复原黑色贴纸。另一 fixture 验证 2px 非零半径、半透明边缘、PNG round-trip、透明画布外部和 `[0,2000)` 启停。历史渲染分支未改，不宣称其任意端点的帧率转换问题已被修复。

临时 RED/GREEN 日志为 `/tmp/jianji-m4b2-pts-{red,green}.log`；持久可重放机制在 [shape-cover-candidates.test.ts](../tests/shape-cover-candidates.test.ts)。测试中 contact sheet/人工 receipt 为合成准入 fixture，只验证机制；没有重造用户真实素材的人工 PASS。

# Fresh Verification

已读取并执行 `superpowers:verification-before-completion`。候选是上述 HEAD 加本轮限定 diff，核心快照如下；最终验证后没有语义代码变更。

| File | SHA-256 |
| --- | --- |
| `src/shared/shape-cover.ts` | `8e9c6ca92189a84dc76ee11d96566e0ac5151caf5cc410e91da29f1de71a7796` |
| `src/main/shape-cover-freeze.ts` | `83de760eaba0d2d1a207d564f6e47bd2c86c47d4487833238a99a314816713d4` |
| `src/main/shape-cover-render.ts` | `82d03b7ae19670e7bf15f499a8198a324fd4853215e635ec172988e698b7efc7` |
| `src/main/shape-cover-alpha.ts` | `b9f67869131d561ad3165482d56130feabceb643b6e008789a529a11c4db3bc8` |
| `src/main/shape-cover-candidates.ts` | `fc7afd40b1e72d1d643d3a0dfb8d224914c2d00060ea05d52ae718970719145c` |
| `src/main/domain.ts` | `d10178200bc3d75ca0dab7d3c9599430aec10b440a2e1c9d8a3946f9538d55e7` |
| `src/main/compiler.ts` | `59822a64be093ba5086da9df0bd842b2b8d7f89e3bcfc56e0680593c4b32492b` |
| `src/main/queue.ts` | `9d902b5ef6274fff610ab91c1ec60f7816ef287d3576428152056d11bf91a895` |
| `tests/shape-cover-candidates.test.ts` | `4784f1088c65cca49981edd4c6a31d9dc58c4ad189c3891100a7630ca57bca5d` |

| Command | Fresh result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test -- tests/shape-cover-candidates.test.ts tests/shape-cover-pixel-gate.test.ts tests/source-mask-admission.test.ts tests/source-sticker-knowledge-store.test.ts tests/source-sticker-knowledge.test.ts tests/compiler.test.ts tests/queue.test.ts tests/cover-review-preview.integration.test.ts` | 8 实际测试文件、125 PASS，exit 0；执行日志另含未匹配的 `tests/schema.test.ts` filter，不计作运行证据 |
| `npm test -- tests/domain.test.ts` | 4 PASS，exit 0 |
| `npm test -- --maxWorkers=4 --minWorkers=4` | 127 文件 PASS、1 文件 skipped；1095 PASS、3 skipped，exit 0，33.98 秒 |
| `git diff --check` | exit 0 |

shape 专用测试共 23 项（M4-B1 13 项，本轮 10 项），在 full run 中均未跳过。除真实像素/PTS 外，还验证 binding/源/preset/PNG 篡改、原候选删除、compiler snapshot 后文件变化、伪 content-safety PASS、入队/样片直发/批准重放/恢复执行阻断、渲染前后源 head 变化、冻结途中及发布后的取消和其他文件保留。3 项既有 skipped 分别为两项 Windows FFmpeg/font 测试和未启用的 live asset library 测试；本轮没有 Windows 实机、Electron UI 或真实 Provider 证据。像素/预览使用 app FFmpeg `n8.1.2-52-g5a03dfa0f6-20260912`，源准入 fixture 沿用 PATH 工具；未修改工具配置。

# Review And Maintenance

Native `code_mapper` 只读核查原 queue 的创建、样片直发、恢复/重试与资源路径；没有写文件或运行测试，parent 调查并裁决实现。初次读取误用不存在的 `code_mapper.toml` 而 exit 1，随后找到实际 `code-mapper.toml` 并读取；该命令失败不是代码或测试失败。

最终 stable snapshot 的 Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`，绑定上述源码摘要、Spec/Active Slice 和 fresh tests。用户未要求本 snapshot 的 Kimi review，且本轮明确保留不调用付费模型的边界；没有凭据/越权执行或 critical durable-state 损坏路径；新增策略未接生产 caller，正式发布/入队/恢复均被阻断。像素、输出时钟和字节生命周期的具体缺口已经 targeted executable verification 收敛；未验证的用户素材、独立内容安全、长片成本明确不授予生产资格。没有以 mapper、tests PASS 或 review verdict 代替最终验收。

当前 AOCI Guide 与一次 `aoci_maintain` 仍返回 `blocked/stopped`、没有机器签发的可写候选：5 个新 owner（含 M4-B1 两个）缺 entry，`domain.ts` 等 managed source 有 drift，且既有正式 `aoci.code.txt` 与 baseline 不一致 (`code_volume_unbaselined`)。没有绕过 governed Scope Change、手写正式索引或扩大到其他模块修复。本轮不修改 AOCI 托管字节；不能声称索引对齐，后续维护仍有阻塞。

# AOCI Attribution Audit

2026-09-27 按用户要求重新执行官方 `verify --json`、`check --json`、`index agent guide --agent codex --json`，没有把上面的记录当作归因结论。运行版本为 `0.1.0-rc14`，capability commit 为 `92c78bc48a3e431ff8ae67fabb05270cc7129fe7`。比较对象为 M4-B2 开始前 `5b95024`、完成后 `f4b6341` 及当前工作树；历史对象由 `git archive <commit>` 解包到独立临时目录，再用同一二进制的 `aoci --repo <snapshot> ...` 检查，没有创建 worktree 或修改实际 checkout。archive 缺少未跟踪的两个 `.impeccable` observe 文件，故其 observe removed 与当前树不同；下面归因只使用 code drift、正式资产和源码字节，不把此环境差异当成 M4-B2 回归。

| Official Fact | Before M4-B2 | After M4-B2 / Current | Attribution |
| --- | --- | --- | --- |
| `code_drift.stale` | 13 | 14 | 新增 `src/main/domain.ts` |
| `code_drift.missing` | 2 | 5 | 新增 `src/main/shape-cover-freeze.ts`、`src/main/shape-cover-render.ts`、`src/shared/shape-cover.ts` |
| `code_drift.unbaselined` | 2 | 5 | 同上三个新 owner；这是 source baseline 缺失，与 Volume baseline 不一致分别计数 |
| `code_drift.orphan` | 0 | 0 | 没有新增 orphan |
| `code_volume_unbaselined` | 存在 | 存在 | 相同历史 Volume 完整性 blocker，没有新增或改变 Volume 字节 |
| `structure_valid` / `governance_aligned` | `true` / `false` | `true` / `false` | 正式结构可解析，但治理未对齐 |
| Verify / Check / Guide | exit 1 / exit 1 / `blocked` | exit 1 / exit 1 / `blocked` | Guide 命令 exit 0 不表示健康；须读取其 `stage` |

集合差之外还存在本切片的维护问题：`compiler.ts`、`queue.ts` 原来已经 stale，但 M4-B2 又修改了它们；M4-B1 的 `shape-cover-alpha.ts`、`shape-cover-candidates.ts` 原来已经 missing/unbaselined，本切片也继续修改了它们。连同新 stale 的 `domain.ts` 和三个新 owner，M4-B2 的八个受管 source 均未完成对应 cognition 维护。不能因为其中四个路径在旧 drift 集合中，就宣称本切片 source/cognition 已一致。源码逐文件核对当前字节与 `f4b6341` 相等；当前 CodeGraph 重新索引并查询 `TemplateCompiler`、`assertShapeCoverExportReady`，结合源码确认新增 schema、PNG 字节消费及正式输出阻断。正式索引现有 `domain.ts`、`compiler.ts`、`queue.ts` Entry 没有覆盖这些新增契约，五个 shape owner 没有 Entry；没有将旧 cognition 当作实现事实。

`aoci.txt`、`aoci.meta.txt`、`aoci.code.txt`、`.aoci/config.json`、`.aoci/baseline.json` 在前后 commit 与当前工作树中逐字节相同。Volume 实际 SHA-256 为 `da194c07d1777ea0a6b91544d1c8653a5b85470e8d586371351cd018fb5395d9`，baseline 记录为 `1a982948df6fd2fdd2ebfe43029f72d3e3f792424db7a64ed8bcf2994b610cb9`，因此历史 blocker 已通过快照重跑确认；M4-B2 没有引入这项 Volume mismatch。baseline 文件 SHA-256 为 `ede0bc24401a956cb0f71dbc3ab5849f18bb7b969babcc1687efa0f7dde6e342`，本审计不改变它。

本次一次 `aoci_maintain` 返回 `status: stopped`、`result: blocked`、空 `candidates` / `orphan_remove_candidates`，没有签发可写批次。当前 Guide 的安全停点为 `blocked`；官方 `update-entry --help` 要求维护工具返回的 source binding，并复用 baseline 完整性防线。工具给出的 Volume 修复方向是恢复既有字节或通过 governed Scope Change 重新建立 cognition，不能在本次禁止修历史 baseline 的范围内假装成窄增量修复。没有提交伪造 candidate、手写正式 Entry、改变 scope、恢复其他 owner 字节、运行 scan 或 apply/approve baseline；没有扩大到整仓历史 debt。

独立复跑 `npm run typecheck` exit 0；`npm test -- --maxWorkers=4 --minWorkers=4` exit 0，127 文件 PASS / 1 skipped，1095 PASS / 3 skipped，32.26 秒。测试与当前源码一致，保留用户 `氨糖膏.jianji-project.json` 和 `.bak` 的删除改动。原始官方检查与本次测试日志保存在临时 `/tmp/jianji-aoci-audit-utpv3sn6/evidence/`，持久结论及复跑方式见本节；临时日志不代替上述源码、commit 和可重放命令。

本次状态明确区分为：

- **M4-B2 functional acceptance: PASS**，仅冻结/预览切片，不是生产输出或内容安全准入。
- **AOCI repository health: BLOCKED by pre-existing baseline drift**，同时保留本切片新增 maintenance debt。
- **Regression introduced by M4-B2: YES for cognition maintenance drift**：新增 1 stale、3 missing、3 unbaselined（missing/unbaselined 指向同一组三个路径）；没有新增 orphan 或 Volume mismatch。测试未发现本切片功能回归，不能据此写 cognition regression 为 NO。
- **M4-B2 source/cognition alignment: NOT MAINTAINED**；修复未完成，工具未提供可执行窄写入候选。
- **AOCI debt remains open and must not be silently baselined away**；正式 cognition 和 baseline 均未修改。
- **Next milestone: M4-B3, NOT STARTED**。用户本轮要求先修复 M4-B2 新增 drift；该先决条件尚未满足，因此停止在真实 maintenance blocker，不把“历史债务不应阻塞功能”解释为跳过新增债务。需先取得符合此范围的官方受治理修复路径。

# AOCI Candidate Gate Diagnosis

本节续接 `59a9837` 的归因，任务仅解除 M4-B2 新增维护债务，不进入 M4-B3。2026-09-27 fresh 官方 Verify / Check 仍 exit 1，Guide exit 0 但 `stage: blocked`；Doctor exit 0、离线 AI 未启用，Capabilities 为 `0.1.0-rc14`、commit `92c78bc48a3e431ff8ae67fabb05270cc7129fe7`。实际 repository source、正式 cognition、config 和 baseline 均与任务开始时相同，用户两个项目文件的删除继续保留。

## Frozen Finding Scope

7 个 finding 对应 **4 个 source / cognition object**；三个新 source 的 missing 与 unbaselined 会由同一次合法 Entry create 与 source binding 处理，不是七次独立作者化。所有对象的 Volume 均为 `code` / `aoci.code.txt`，canonical object identity 均为 `code:<source path>`，均在 `5b95024..f4b6341` 的 source 修改范围内。

| Finding | Source / Object Path | Existing Entry | Source Baseline Binding | Governance Classification |
| --- | --- | --- | --- | --- |
| `code_stale` | `src/main/domain.ts` | 存在，`domain.ts[AB8L]` | 存在，SHA `8f34c13f51264bb46accb676d6da0e95324ad3fd13a15e3c8078c5c787a96505` | existing Entry update；不是 Missing curation 工作 |
| `code_missing` | `src/main/shape-cover-freeze.ts` | 无 | 无 | ActionableMissing create |
| `code_unbaselined` | `src/main/shape-cover-freeze.ts` | 无 | 无 | 合并到同 source 的 Missing create |
| `code_missing` | `src/main/shape-cover-render.ts` | 无 | 无 | ActionableMissing create |
| `code_unbaselined` | `src/main/shape-cover-render.ts` | 无 | 无 | 合并到同 source 的 Missing create |
| `code_missing` | `src/shared/shape-cover.ts` | 无 | 无 | ActionableMissing create |
| `code_unbaselined` | `src/shared/shape-cover.ts` | 无 | 无 | 合并到同 source 的 Missing create |

逐 source 执行 `aoci --repo . scope explain <path> --json`，四项均返回 `role: index`、`rule_source: default`、`reason: default production role`、`safe_inventory_allowed`、`git_status: tracked`、`reads_content: true`、`enters_whole_index: true`。不是 observe、held source、code_skipped 或 curation_excluded。当前 `curation_exclude: []`，没有正式 curation decision 文件；下面保持相同 source/config 的官方 candidate 试验进一步证明三个 Missing 均进入 create，而非 pending curation 或 stale curation decision。没有为了消除 finding 改分类或排除 source。

## Direct Gate And Machine Control

Guide 的 `executable_targets: 25` 是 finding 层的计数，包含同 source 的 Missing/Unbaselined 重复和 Volume blocker，不是 25 个可写对象。`next_action: blocked`，`commands` 只有 guide、header_show、verify；未签发 remediation `next_commands` 或 `interaction_required` 字段。Maintain 返回 `status: stopped`、`result: blocked`、`candidates: []`、无 `code_plan`、`sets.write: []`；其 logical plan 有 `total_targets: 19`、`included: 0`、`remaining: 19`、`complete_candidate_set_for_current_batch: false`。空候选结果里的通用 `author_complete_current_machine_batch` 字符串不是 authoring 许可或可用 Code batch receipt。

直接 gate 已由当前发布版本的[官方源码](https://github.com/aoci-spec/aoci-code/blob/92c78bc48a3e431ff8ae67fabb05270cc7129fe7/internal/volumegovernance/facts.go)和[Maintain 实现](https://github.com/aoci-spec/aoci-code/blob/92c78bc48a3e431ff8ae67fabb05270cc7129fe7/internal/mcptools/tools_maintain_volumes.go)核对：`CodeAuthoringWorkFor` 保留 actionable Missing，再加入有现存 Entry 的 Stale/Unbaselined 并按 path 去重，因此当前共有 5 create + 14 update = 19 targets，M4-B2 四个 source 没有在这里丢失。`finalize` 把真实 `code_volume_unbaselined` 判为 hard `ResultBlocked`；`handleVolumeMaintain` 仅在 facts 不是 blocked/evidence_required 时调用 `buildVolumeCodeCandidates`。故 candidate count 0 是 **全域正式 Volume 完整性 gate 在签发之前截断**，不是这七项不可作者化或被分类过滤。`blockedNextCommands` 没有 `code_volume_unbaselined` 的命令分支，故本状态只给出 finding 的文字 repair action，没有具体可执行修复命令。

Managed Scope policy identity 与 active identity 都为 `2a992109f182c0dce169a21f8533a6e44fe0e0bd6493b914fa4ae506d6fb01de`，`aligned: true`、`scope_change_required: false`、`observed_pending_review: 0`；不是过期 scope receipt。`scope show` 只核对 policy/budget，不能用它的 `stage: aligned` 代替 cognition 健康；该命令不做 drift 分支，`authoring_targets: 0` 也不是不存在作者化工作。`scope status --json` 和只读 `scope plan --json` 都 exit 2，明确返回 `managed_scope_formal_volume_baseline_drift: aoci.code.txt`。因此 Guide 建议中的 governed Scope Change 也不能直接跨过同一个真实 Volume guard。

`pending_transactions: 0`、`recovery_pending: false`、`third_party_conflict: false`。本地只有已归档的 Entries transactions 和完成 receipts，没有未完成 apply。最后成功 receipt 为 `52c3cf3a5be494dcf5cdd025c1d53aa0e12b5f086d5c40b3dfe785e164188dbd`，transaction 为 `db51fa969d1533e6b3eeb651b733da0d0e4fec9b30cc843ae126ac3e10aa8896`，`completed_at: 2026-09-23T17:50:43.628297589Z`；不重新 apply、resume 或 rollback 这项成功历史工作。

## Historical Volume Provenance And Bounded Experiment

Git 中 `6aa35a5` 的 Volume/baseline 相等；`1bf2501` 已出现 CPU/export cognition 更新后 Volume 与旧 binding 不一致；`1f2c69f` 记录当前 Volume `da194c07...` 和最后成功 source-mask 阶段的 `1a982948...` binding，后续 M4-B1/M4-B2 未改变这两个正式资产。当前 Volume 与该已批准 postimage 的差异恰为 `execution-limits.ts`、`ffmpeg.ts`、`hardware-probe.ts`、`queue.ts` 四个历史 Entry；不是行尾差异。这里能够归因到历史 Entry 字节变化，但不猜测具体 writer 或称其为未完成 transaction。

从最后 transaction 的已保存 Code preimage 校验 SHA `75f786b1c3dcaec5bbc00cae337ba058ccff6e810a3eb69b76b5acba2352d1af`，结合其唯一 `code:AGENTS.md` update 及当前保留的该 Entry，重构字节 SHA 为 `1a982948df6fd2fdd2ebfe43029f72d3e3f792424db7a64ed8bcf2994b610cb9`，精确等于 transaction post SHA 与 baseline Volume binding。这只是对已有 approved 字节的验证，没有创作新语义或接受 current Volume。

在 `git archive HEAD` 的临时副本中**仅**替换为该已批准 Code Volume，baseline、Root、Meta、config 和全部产品 source 保持原字节；没有 worktree、scan、baseline apply 或产品调用。使用同一个官方二进制执行 Verify、Guide，再启动该临时根的官方 MCP server（serverInfo `aoci-code / 0.1.0-rc14`）调用 Maintain：Verify 仍 exit 1，但 facts 从 `blocked` 转为 `authoring_required`；Guide 同样转为 `authoring_required`；Maintain 为 `repair_required / authoring_required`，合法签发完整 **19** 项 Code candidates，其中上述四个 M4-B2 source 分别为 1 update、3 create。所有 source drift 集合仍为 14 stale / 5 missing / 5 unbaselined / 0 orphan。这个控制变量试验证明 historical Volume mismatch 是此前无 candidates 的直接原因，且恢复 Volume 完整性无需把历史 source drift baselined away。它不代表实际仓库已恢复或新增 debt 已收敛。

## Narrow Maintenance Boundary

当前官方 Maintain 的正常模式仅支持 domain scope，不支持按上述四个 source 签发 batch；`object_refs` 只用于已 aligned 的 cognition optimization。当前候选 limit 为 20，临时恢复后的 19 项同属一个完整批次，包含 15 个本轮不允许维护的历史 source。[当前 runtime 合同](https://github.com/aoci-spec/aoci-code/blob/92c78bc48a3e431ff8ae67fabb05270cc7129fe7/textassets/zh-CN/contracts/runtime-rules.txt)要求提交完整签发集合；[Code receipt validator](https://github.com/aoci-spec/aoci-code/blob/92c78bc48a3e431ff8ae67fabb05270cc7129fe7/internal/codebatch/receipt.go)以 `code_candidate_batch_incomplete` 拒绝子集。不能把其它十五项原 Entry 连同当前 source hash 原样回填：那也会接受未经本任务语义审查的历史 source baseline，偷偷清掉历史 stale。没有通过缩 scope、调整批次上限/顺序、删 cognition、伪造 receipt 或拆开机器批次规避边界。

官方文档及 `tools_write_volume_test.go` 确认独立 single-object compatibility 仍存在，writer 在没有 candidate/batch ID 时也保留兼容路径；不能将“技术上能单写”误报为“没有单对象 API”。但在上述恢复试验已签发 19 项批次的状态下，runtime 合同要求整批提交，没有授权通过省略 IDs 或兼容单写拆开该批次。另一个只读 native `code_mapper` 聚焦核对这一差别、完整批次校验和 scope 限制，没有写文件、测试或 paid/Kimi 调用；parent 直接核对对应当前源码和官方文档后裁决，没有将 mapper 结论当作 completion authority。

实际仓库只做官方检查及维护诊断，没有执行 formal remediation、cognition authoring 或 baseline 写入。既已证明直接 Volume gate 和恢复后的完整批次范围冲突，本轮保留实际 Volume 原字节，避免只撤回四个历史 Entry 却仍无法合法完成窄维护。此时需要的是官方能签发并绑定四个授权 source、保留其他 source baseline 的受治理 authoring 路径；不能将接口兼容性或手工筛选当作这项权限。

机器原始证据保存于临时 `/tmp/jianji-m4b2-aoci-remediation-bmhvvlod/evidence/`（含 frozen-scope、fresh 官方命令、scope explain/status/plan、actual Maintain、历史 receipt/preimage 与 restored-volume experiment）；当前版本官方源码按 capability commit 只读取得于同一临时目录。持久结论以本节、Git 对比和官方命令为准，不依赖临时目录长期存在。本轮没有修改产品源码，不重新制造全套产品测试。最终实际 debt 仍为历史 13 stale / 2 missing / 2 unbaselined / 0 orphan / 1 Volume mismatch，加 M4-B2 新增 1 stale / 3 missing / 3 unbaselined；未归零，M4-B3 进入条件不满足。

# Remaining Boundary And Next One Thing

`geometry-only` 和 `contentSafety: NOT_EVALUATED` 继续明确保留。没有成功 shape 正式入队/导出，不证明独立内容安全、全片或未知时段的 coverage、用户星形素材验收、Windows 或大批量性能；source-mask-only 只证明源事实。冻结 PNG 的全画布几何不能直接当作四角占位区域，后续选款整合须使用实际 placement/轮廓绑定。

下一步 M4-B3：建立冻结模板/样片/输出 PTS/源修订绑定的输出 coverage 准入与独立内容安全准入，沿现有样片复核 owner 接入；在这些证据有效前继续阻断正式输出。选款整合、四角占位和真实媒体验收仍须后续明确处理，本轮停在可重放的冻结/预览检查点。
