---
title: AGENTS Rule Reduction And Harness Governance
status: draft
execution: not_started
version: 1.0
date: 2026-10-02
baseline: 7d4c7a8ed45e1e1734ed7344456af01fdde18983
---

# Goal And Authorization

将 `AGENTS.md` 从详细产品规格与执行说明的集合，收敛为简短的项目入口；将可以确定判定的要求接入现有 Harness，并保持业务校验、产品合同和验收证据各自的归属。

当前用户授权是编写 Spec 和分阶段 Plan。本轮不实施本文的新 CLI、policy、gate，不修改 `AGENTS.md`、`CLAUDE.md` 或生产代码。本文 `draft` 表示待实施的设计，不是已完成声明；[Implementation Plan](../plans/2026-10-02-agents-harness-governance.md) 同样不自动授权执行。

# Current Evidence

以下为编写时的源码事实，实施各阶段前仍需核对当前工作树：

| Surface | Observed behavior | Gap |
| --- | --- | --- |
| [AGENTS.md](../../../AGENTS.md) | 约 21.6 KB，`Product Invariants` 约 10.7 KB；包含规格、例外、兼容与执行细节 | 每个任务都加载大量不相关内容 |
| [CLAUDE.md](../../../CLAUDE.md) | 独立保存旧规则；仍要求展示文字必填、覆盖默认关闭 | 与当前逐素材文字开关及跨模板覆盖默认开启规则不一致 |
| [Harness policy](../../../.agent/harness/policy.json) | schemaVersion=1；7 个固定 code checks、9 类 media checks | 缺少按改动路径选择检查与专项合同路由 |
| [Harness CLI](../../../src/harness/cli.ts) | 显式 `code` / `media`；`code` 不接受额外参数 | 没有任务范围输入与复核旧回执的入口 |
| [Harness code](../../../src/harness/code.ts) | 检查指定文件发现、Vitest 计数、skip 和报告一致性 | 已有防误报能力，应直接复用 |
| [Harness run](../../../src/harness/run.ts) | 冻结 policy、保存回执、比较运行前后工作树身份 | 全体 tracked diff 会将无关文档或共享索引变动混入身份 |
| [Harness media](../../../src/harness/media.ts) | 冻结批次、源身份、解码、规格、时长、帧率、音轨与定位帧检查 | 不证明整片视觉效果、音频内容一致或用户要求的制作总数 |
| [Desktop CI](../../../.github/workflows/desktop.yml) | Linux / Windows 执行 typecheck、全量 tests、build | 不能将其描述成已部署的 Harness receipt gate |

[原 Harness Spec](../../video-validation-harness-spec.md) 与 [原 Plan](../../video-validation-harness-plan.md) 继续解释旧接口。本 Spec 仅修订任务路由、收尾证据与规则归属，不接管生产队列。前一轮受管 Kimi mapping `29b22a24-45f1-4737-8142-77726e4eece4` 的上述五个业务文件读取 hash 在本轮已重新核对；其模型判断不是设计权威，也不构成本 Spec 的 independent review。

# Scope And Non-Goals

包含：规则分层与单一入口、检查路由、任务范围与源码绑定、专项回归接入、按 session 核对 AOCI、只读 completion verification，以及最后的根规则减重。

不包含：新的 Agent 平台、DAG、数据库、上传授权、模型资格链、新 provider、真实商业请求、生产自动修复、自动恢复未知提交、覆盖功能 activation、Git hook 自动安装、远端 branch protection 或 CI 权限修改。现有 CI 的全量测试不因 scoped Harness 被删除。普通分析、纯文档与低风险任务不得被强制运行全部媒体检查。

# Ownership Contract

| Concern | Single owner after implementation | Root rule responsibility |
| --- | --- | --- |
| 权威、授权、长期红线、完成边界 | `AGENTS.md` | 保留短规则 |
| 产品合同入口及模块职责导航 | 新增 `docs/agent-contract-index.md` | 按 concern 指向该入口，不复制完整目录 |
| 文字开关、普通装饰、矩形覆盖、随机轮换、显示时序、制作数量 | 新增 `docs/decoration-production-contract.md`；schema / 现有 production owners 执行 | 保留手填文字、不改原视频、冻结重试等红线 |
| 源知识、assisted、shape 专项细节 | 既有 [source knowledge](../../source-sticker-knowledge-spec.md)、[assisted](../../semi-automatic-cover-review-spec.md)、[shape V1](../../shape-matched-cover-spec.md) 及适用 [simplification delta](../../shape-matched-cover-v1-simplification-spec.md) | 保留 fail-closed 与产品准入边界 |
| 路径分类、检查 ID、测试清单、命令与必需性 | `.agent/harness/policy.json` | 指向 policy；不复制完整检查清单 |
| Harness 执行、回执和判断 | `src/harness/` | 要求适用检查与当前源码对应 |
| AOCI 写入、机器批次、CAS、恢复 | 当前 AOCI Guide / 工具合同 | 保留“变更 session 自行维护、无需询问” |
| 启动、环境与手动操作 | `README.md`；必要时现有 operational owner | 保留 `make frontend` 沟通约束 |

`agent-contract-index.md` 负责人类可读的合同与 owner 导航，policy 独占可执行路径到检查的映射；导航只引用检查 ID 或 policy，不保存第二份 argv / testFiles / glob 表。不得把历史 record 改成当前合同，也不得将所有内容统一塞进 `.agent/context/`。

`CLAUDE.md` 最终仅保留加载 `AGENTS.md` 与相关合同入口的说明，不再维护产品规则副本。根规则引用不能替代已要求执行的 gate。

# Requirements

## R01 — Preserve Product And Authority Boundaries

规则搬迁不改变任何产品行为、例外、默认值、授权或兼容语义。保留手动文字及上传贴纸例外、独立覆盖开关、原视频内容、冻结重试、源身份、未知结果停止、凭据隔离与独立队列 owner。

开发覆盖任务的 `gpt-6.1-sol` / `gpt-6-luna` 限制属于开发调用边界；不能据此收紧应用用户的通用模型连接选择，也不能扩展 Kimi route 或增加真实请求。本 Spec 不为 shape 研究证据授予生产 authority；适用 simplification delta 不等于 activation 已完成。

## R02 — Task Scope Is A Declaration, Not Attribution Proof

新增 `harness-task-scope/v1` JSON，存放于现有忽略的 `.agent/harness/runs/` 目录。字段为 `schemaVersion`、`sessionId`、`baseCommit` 和非空 `ownedChanges`；每项为 `path`、`change`（add / modify / delete）、`beforeSha256`、`afterSha256`。新增前 hash=null，删除后 hash=null；其余使用实际文件字节 SHA-256。

路径为规范仓库相对路径，拒绝越界、重复、符号链接逃逸与不一致的变更类型。rename 表示旧路径 delete 加新路径 add，检查取两条路径的并集。scope 不包含凭据、用户项目或媒体内容。

Parent 基于当前授权、任务初始快照和真实 owned files 创作 scope；Git dirty 清单与 caller 提供的 sessionId 均不能证明实际作者身份。入口必须核对 declared preimage / postimage，记录其他 dirty files，不将它们自动归给本 session。未能可靠确定业务文件归属时，继续遵守现有 ownership gate，不由 Harness 制造授权。

## R03 — Route Checks Without Silent Omissions

policy 升级为 schemaVersion=2，保留 `codeChecks` / `media`，增加 `controlChecks` 与 `routes`。`controlChecks` 复用固定 Node argv 的 command check；`routes` 项仅包含唯一 `id`、仓库相对路径 `paths`、`checkIds` 和 `documentRefs`。多项匹配取检查并集，同一检查只运行一次；所有 ID、路径与引用必须有效。

所有生产源码变更至少执行 typecheck 与 Harness 自测，再执行路由关联测试；共享入口/schema、compiler/queue 或 Harness / policy 变更采用保守的完整相关集合。测试改动必须路由到自身及适用 domain。新增、删除与重命名不得只看仍存在的文件。

未分类路径不得返回 completion PASS：报告 `unmapped_path`，执行保守集合可用于调查，但不能掩盖路由缺失。文档 / 规则、配置与资源有显式类别；“纯文档无需代码测试”必须由完整 scoped change 分类证明。scope 涉及的必需检查不得被 CLI flag、空集合或 policy 的 required=false 静默绕过。

## R04 — Bind Evidence To What Actually Ran

scope 只决定归属与路由，不能把共享工作树中的其他源码从测试事实中隐藏。scoped run 的源码快照包含实际参与执行的 `src/`、`tests/`、`scripts/`、编译/依赖配置、相关资源及当前 policy；所引用合同与 owned 文档另行绑定。无法可靠界定依赖时扩大到全部相关源码，不能猜测缩小。

运行前后比较上述字节；参与执行的其他 session 源码变化也使结果 `NOT_EVALUATED`。已知且稳定的其他 dirty 源码可以测试，回执必须记录其状态，不能声称 clean commit 测试。

AOCI 正式索引 / ledger / baseline 与无关文档不混入 code 行为身份；适用 AOCI 另按 R07 的 owned 对象核对。policy、scope、合同或源码改变后，旧回执不能批准新状态。Git HEAD 保留为追溯信息，不能替代字节绑定；提交相同已验证字节也不能仅因 HEAD 改变就伪称新检查已运行。

## R05 — Reuse Product Validation And Meaningful Tests

Harness 仅执行原 schema、service、compiler、queue 和已有测试，不复制文字长度、几何、制作数量或模型连接规则。先复用测试，再针对已证实的行为缺口补反例；测试名存在不代表已覆盖规则。

最小接入范围包括：展示文字全关闭 / 混合开关及手填原样保持；本地随机零模型请求、零模型抽帧、同版本覆盖选款唯一和候选不足拒绝；四角覆盖占位与时间补齐；冻结重试、取消、有限主管修正、assisted 明确批准；制作条数与历史额度分离；临时文件验证和不覆盖发布。

shape 路由执行源身份、mask、候选交集、像素 coverage、冻结 custody 和 activation guard 的工程反例，不要求调用付费 AI、人类资格实验或完整研究 pipeline。当前 PRODUCT_DISABLED / 无 authority 的研究状态必须继续拒绝产品入口。所选用例有 skip、零发现、报告缺失、timeout 或运行中变化时保留现有非 PASS 语义。

## R06 — Protect Credentials And Keep Verification Tiers Honest

接入 provider / connection-store / chatgpt-session 的既有或必要反例：密钥不进入 renderer、项目或日志；模型只返回方案；取消终止请求；运行中连接固定；应用登录目录与全局 Codex 隔离。开发模型限制在真实开发调用入口执行或由该入口的 route receipt 核对，不能仅在 prompt 声明。

Fixture 使用隔离配置与假服务，不读取用户账号、密钥或全局 auth。Harness 不获取“运行测试即授权真实请求”的权限；无法证明离线隔离或缺少所需 runtime 时为 NOT_EVALUATED。

工程测试、模拟集成、真实 FFmpeg、真实 provider、平台实机和人工观看分别报告。media 的定位帧 PASS 不升级为 coverage / visual safety；音轨元数据 PASS 不升级为内容或听感一致；冻结任务数量不升级为用户期望条数已满足。没有所选真实批次时不制造 media acceptance。

## R07 — Verify Owned AOCI Without Taking Over Maintenance

AOCI adapter 为只读检查：消费当前官方工具的结构化 Verify、Check、Guide 及必要对象/基线事实，不创作语义、不自动 Maintain / Apply、不手写索引、不截断机器批次。写入仍由改文件的 session Agent 使用原工具合同直接完成，无需询问用户。

结果分为 `ownedAoci` 与 `repositoryAoci`：逐项证明本次 indexed 对象无 missing / stale / unbaselined / unresolved orphan，当前 source hash 与官方基线一致；add / delete 使用适用创建 / 删除证据。observe / exclude 项核实 scope 后记为适用的无需 Entry，而非跳过未分类对象。

仅其他对象的漂移不使 ownedAoci 失败；正式布局损坏、相关 pending recovery / 第三方冲突、scope 不可靠或工具结果无法解释时，必须阻断所受影响的本次证明。不能将工具缺失、零数据或旧结果当成 aligned。

共享索引单纯字节变化不会自动失效本次对象证明；需要重新检查对应 Entry、source baseline、scope 和恢复状态。完整批次含其他 session 对象时遵循官方可用路径；不得借本 Spec 伪造子批次或替其他 session 完成语义维护。每个对象的维护 owner 仍是产生变更的 session。

## R08 — Completion Verification Is Read Only

保留两个现有接口，增加如下接口：

```text
npm run harness -- code
npm run harness -- code --scope <task-scope.json>
npm run harness -- verify --scope <task-scope.json> --receipt <receipt.json>
npm run harness -- media --project <project.json> --batch <id> [...]
npm run harness -- media --queue <queue-state.json>
```

`code` 无 scope 时继续执行完整 code 集合。scoped run 保存 v2 回执，绑定 scope / policy / selected checks / 实际源码 / docs / 输出报告的 hash；旧 v1 policy 和 receipt 保持可读，v1 receipt 不能满足新 scoped completion gate。

`verify` 不重跑测试、不调用模型、不维护 AOCI、不入队、不提交或发布；它复核回执是否结束、必需检查是否齐全、检查身份与当前字节是否匹配，并运行必要的当前 owned AOCI 和文档引用检查。运行后产生独立 completion 回执，不改旧 receipt。缺项、RUNNING、旧字节、skip 和无法核实时非 PASS。

沿用 PASS / FAIL / NOT_EVALUATED 与退出码 0 / 1 / 2。明确违反合同为 FAIL；证据、工具或身份无法确认时 NOT_EVALUATED；两者均不能交付为通过。零必需检查不能通过。

这是项目可执行 completion check，并不证明所有宿主 Agent、手工 Git 或远端 PR 已被强制拦截；不安装 hooks，不修改 hosted enforcement。Root 只要求在对应任务完成前取得适用 fresh evidence。

## R09 — Reduce The Root After Coverage Exists

每条移出的规则先有唯一合同 owner，再有适用工程证据或明确保留的人类/授权判断。新规范不得将商业请求、主观自然度或作者归属仅凭文本匹配变成 PASS。

最终 `AGENTS.md` 目标为约 20–30 条短规则、UTF-8 正文不超过 8 KB；这是可读性验收目标，不是放宽安全语义的理由。保留权威顺序、任务范围、开发型号约束、手填文字及贴纸例外、原视频、canonical ownership、未知结果、凭据、冻结与验收层级、AOCI session 归属和 task-only commit。全量 owner 表及参数/流程细节移至对应 owner。

不得仅靠删句或让新文档悬空来满足大小目标。规则引用检查确认目标存在、anchor 有效、必需 concern 可达；不试图用关键词计数证明语义等价。迁移的语义一致性由 Parent 逐项 self-review。

# Acceptance Criteria

| ID | Observable result | Verification |
| --- | --- | --- |
| AC01 | 每条迁移规则有单一 owner，CLAUDE 不再有产品副本，根规则保留红线 | 迁移表逐项 self-review、链接/anchor 检查与最终 diff |
| AC02 | add / modify / delete / rename 路由完整，未知路径、空 scope、可跳过必需检查均不能 PASS | scope / routing 正反例 |
| AC03 | 旧 code / media CLI 与 v1 读取继续工作，新 scoped receipt 可确定复核 | CLI / policy / receipt 兼容测试 |
| AC04 | 参与测试的真实源码、合同、policy 与 scope 变化使旧证据失效 | hash / source-change / forged-report 反例 |
| AC05 | 文字、随机覆盖、时序、数量与冻结生命周期专项确实运行，既有 schema 仍独占业务准入 | policy发现断言、domain 正反例、适用 FFmpeg fixtures |
| AC06 | shape 工程检查不能签生产资格，凭据及连接边界没有弱化 | activation / source / custody / secret 隔离反例 |
| AC07 | owned AOCI 对齐与全库漂移分别报告，工具失败和本次 stale 不会通过 | fake 官方结果与一次真实 scoped 检查 |
| AC08 | completion verify 只读，拒绝缺失/陈旧/运行中回执，证据层级不冒升 | 副作用探针、缺证据反例、code/media 报告断言 |
| AC09 | 纯文档不运行无关代码/媒体检查，其他 dirty 工作被保留 | docs-only fixture、已知 shared-tree fixture、task-only diff |
| AC10 | 根规则达到减重目标，每个阶段有独立可回滚 checkpoint | 字节统计、完整迁移表、阶段验证及 task-only commits |

# Migration And Recovery

先建立合同导航和承接正文，保留原规则；再实现路由与证据、专项检查、AOCI 与 completion verification；最后切换根入口并移除重复正文。各阶段使用当前工作树中的 task-only commit；不创建 worktree，不修改其他 session 的 dirty 文件。

旧 CLI / policy 兼容失败时恢复该阶段 Harness 代码与 policy 的任务内变更，保留先前合同文档及证据。规则迁移不完整时保留原条款，不静默删除。证据过期时停止引用、记录失效原因，稳定源码后再运行必要检查；本 Spec 不授权自动循环测试、商业请求或未知结果重试。回滚不得 reset 共享工作树、覆盖源视频或重写历史任务。

# Self-Review

Parent 已检查：设计复用现有 Harness 和业务 owner；按任务范围分类不等于作者身份证明；源码依赖与归属分开；AOCI 写入不由 verifier 接管；开发模型限制不误施加于产品连接；shape 新旧合同与 activation 状态不混同；旧回执不冒充新 gate；Spec / Plan 状态不代表实施授权或验收。

本文不默认触发 Kimi / native Spec reviewer。后续 implementation 在 project-native verification 后，按适用 `SUBAGENTS.md` Risk Gate 判断 required review，并保留 Parent 的最终裁决。
