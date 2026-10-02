---
title: AGENTS Rule Reduction And Harness Governance Implementation Plan
status: blocked
execution: blocked_concurrent_source_writes
version: 1.1
date: 2026-10-02
baseline: 7d4c7a8ed45e1e1734ed7344456af01fdde18983
---

# Goal And Scope

按 [Spec](../specs/2026-10-02-agents-harness-governance-design.md) 分阶段接通规则的工程检查与任务证据，最后将 `AGENTS.md` 减重。用户于 2026-10-02 明确要求完成本 Plan，实施已获授权；实际 checkpoint 与证据见 Execution Record。

**Contract Surfaces:** 现有 code/media CLI、policy v1 兼容、新 scoped code / verify CLI、scope v1、receipt v2、AOCI 官方结构化证据、根规则与产品合同导航。

**Invariants:** schema / production owners 不变；零真实产品模型请求；受管开发委托沿用既有 standing authorization；保留原视频、冻结重试、未知结果停止、凭据隔离、PRODUCT_DISABLED、AOCI session 自行维护及用户上传贴纸例外；不把技术测试升级成视觉/平台验收。

**Current / Target Behavior:** 当前依靠长根规则与固定测试集合；目标是短根入口、单一产品合同 owner、按 owned change 路由检查、当前源码对应的回执及只读 completion verification。

**Compatibility:** 旧 `code` / `media` 命令和 v1 policy / receipt 可读；v1 receipt 不满足新 scoped completion。旧 frozen task 不迁移、不重新识别；新 checker 必须沿用适用旧解释，无法判定时明确非 PASS。

**Out Of Scope:** 用户应用操作、真实 provider / 上传 / 用户项目、shape activation、自动 AOCI Apply、自动 hooks、远端 gate、更换开发型号、全局规则文件变更、依赖安装或新框架。

# File Structure And Owners

| Path | Responsibility | Phase |
| --- | --- | --- |
| Create `docs/agent-contract-index.md` | concern → 唯一合同 / source owner 导航，不保存第二份 executable 路由 | M0 |
| Create `docs/decoration-production-contract.md` | 承接普通装饰、展示文字、矩形/随机覆盖、时序与数量的现有产品合同 | M0 |
| Modify `docs/video-validation-harness-spec.md` | 明确旧合同与本 Delta 的适用边界，不重写历史验收 | M1/M4 |
| Modify `.agent/harness/policy.json`, `src/harness/types.ts` | 版本化检查和 routes 的唯一机器 owner | M1–M3 |
| Create `src/harness/scope.ts` | scope 校验、路径规范化、add/delete/rename 字节绑定 | M1 |
| Create `src/harness/routing.ts` | policy routes 选择检查、去重与 unmapped 拒绝 | M1 |
| Modify `src/harness/run.ts`, `code.ts`, `cli.ts` | 复用执行与回执；扩展 scoped source identity / CLI，保留旧路径 | M1/M4 |
| Create `src/harness/governance.ts` | 只读文档与 owned AOCI 适配；不创作或写索引 | M4 |
| Create `src/harness/completion.ts` | 复核既有回执和当前适用字节，产出独立 completion receipt | M4 |
| Modify `AGENTS.md`, `CLAUDE.md`, `README.md` | 最后切换短入口、去副本并说明验证命令 | M5 |
| AOCI formal assets | 仅在本 session 实际修改 indexed 对象后，按官方合同维护对应 Entry / baseline | 各阶段收尾 |

新职责按 scope、routing、governance、completion 分开，执行器仍为 `HarnessRun`；不新增任务队列或通用插件系统。共享 `policy.json` / CLI / types 的修改默认串行。其他 writers 的 files 不相交时直接继续；同业务文件冲突按现有 ownership 规则处理，AOCI 必要共享更新按已授权 CAS 规则执行。

# Milestones

| Milestone | Deliverable | Depends On | Stop Condition |
| --- | --- | --- | --- |
| M0 — Contract ownership | 完整迁移清单、单一合同导航与承接正文 | 当前源码/合同核对 | 语义、例外或 owner 无法核实时保留原条款 |
| M1 — Scoped routing and evidence | scope、policy v2、路由、兼容与源码绑定 | M0 | 未分类路径或证据身份未知不能转 PASS |
| M2 — Product regression coverage | 文字、随机、时序、数量、生命周期与发布检查接入 | M1 | 发现产品 regression 先留失败证据；不改验收绕过 |
| M3 — Safety and shape boundaries | 凭据/连接隔离、shape 工程拒绝与证据层级 | M1/M2 | 缺 runtime / 真实资格不借 fixture 声称补足 |
| M4 — Owned AOCI and completion | 只读 AOCI 核对、receipt verify、文档检查 | M1–M3 | 本次治理不可靠、旧回执或工具失败非 PASS |
| M5 — Thin root and handoff | 根规则瘦身、CLAUDE pointer、最后的迁移验证 | M0–M4 | 任何条款无承接或 gate 不可靠，保留原入口 |

默认 M0 → M1 → M2 → M3 → M4 → M5。每阶段是可独立验证、可回滚的 checkpoint；阶段完成不意味着整项完成，也不授权付费调用或用户生产操作。

## M0 — Establish Contract Ownership Before Removing Rules

**Files:** Create `docs/agent-contract-index.md`, `docs/decoration-production-contract.md`；相关 existing source / shape / assisted specs 为只读基线；本阶段不缩短根规则。

**Contract:** 覆盖 Spec R01、R09。为当前 root 每条产品/执行规则分配稳定 rule ID，并记录 `keep-root`、`contract-owner` 或 `executable-check` 的承接方式。迁移表存于 contract index 的一次迁移 section；完成后保留简短导航，不扩张为第二个规则 catalog。

**Implementation:** 逐项核对展示开关、uploaded 例外、batch 默认覆盖、local-random 的独立选款、四角时段、旧白底/透明冻结、5 秒渐隐、容量及 exact count、assisted 审阅、source knowledge 和 shape delta。历史 records 仅作 evidence，不成为当前 owner。新 decoration contract 保存目前根规则的完整有效语义，并引用已有专项合同。

**Acceptance:** 无丢失的默认值、例外、授权、兼容或 fail-closed；所有条款有单一目标；明确 `AGENTS.md` 优先于旧 `CLAUDE.md` 副本；当前 root 保持可用。

**Verification:** 所有新增/变更 Markdown 的相对链接与 anchor 检查、逐项 semantic self-review、`git diff --check`。纯文档阶段不运行无关 typecheck / FFmpeg / 模型。按当前 scope 核对 AOCI，observe docs 不创建 Entry。

**Rollback:** 只撤销本阶段 owned 文档变更；原 root 完整保留，用户项目和历史记录不受影响。

## M1 — Implement Scope, Routing And Exact Evidence

**Files:** Create `src/harness/scope.ts`, `routing.ts`, `tests/harness-scope.test.ts`, `tests/harness-routing.test.ts`；Modify `.agent/harness/policy.json`, `src/harness/types.ts`, `run.ts`, `code.ts`, `cli.ts`, `tests/harness.test.ts`, `docs/video-validation-harness-spec.md`。

**Contract:** 实现 Spec R02、R03、R04 与 R08 的 scoped code 部分；暂不开放 `verify`。policy v2 按固定检查 ID、paths、documentRefs 选择，v1 无 scope 运行保持兼容。源码快照与 ownedChanges 分开，不将其他 session 的参与源码隐藏，也不因无关文档/AOCI 时间戳改变使代码证据自动失效。

**Implementation:** 为所有当前 source / test / script / policy / config / docs / rule / resource 类别设置路由；共享 schema、compiler/queue、Harness 本身采用保守组合。路径标准化与 NUL Git 输出读取正确处理空格、Unicode、add、delete、rename 和 untracked。必需集合非空且 caller 无权缩小；未知路径显式未通过。

**Scoped / Core Selection:** v2 `defaultCheckIds` 是 policy 独占的 required 核心 ID 集合；缺字段时兼容全部 code checks。完整 registry 中的研究 / 平台专项仍按实际路径触发，scoped 并集不受默认集合限制。完整核心检查不声称 Windows 专项已运行，相关必需 skip 继续失败关闭。

**Acceptance:** 相同 scope/policy 得到确定的 selected checks；多路匹配只运行一次；空 scope、伪 hash、越界、遗漏类型、未知 check ID、unmapped、selected required=false 均拒绝。运行中的参与源码变化无效；无关 docs/index 改动不误称 source_changed。旧 CLI 与 v1 policy 用 fixture 验证。

**Verification:** 先写 scope/route/identity 的失败反例，再实现；执行 `npm run typecheck` 与 `npm test -- tests/harness-scope.test.ts tests/harness-routing.test.ts tests/harness.test.ts`。用小型 fixture 验证 `code --scope` 与旧 `code` 的入口，不启动用户应用。完整 code 实跑在 M5 统一执行，避免每个小改动重复全库检查。

**Rollback:** 撤销该阶段 owned Harness/policy 变更，保留 M0 合同；回执版本明确，不能伪装降级后仍通过新 gate。

## M2 — Connect Product Checks To Canonical Behavior

**Files:** Modify `.agent/harness/policy.json`, `tests/harness-routing.test.ts`；必要时补充下面既有测试，不扩展生产行为。

| Concern | Existing tests to reuse | Required proof |
| --- | --- | --- |
| 展示文字 | `product-price`, `display-text`, `display-text-render.integration`, `price-only`, `agent-provider` | 全关闭允许空文字、混合必须手填、调用前拒绝、模型新增文字拒绝、内容与开关冻结 |
| local-random | `local-random-cover`, `agent-controller`, `agent-runner` | 无模型请求/模型抽帧、同版本覆盖款唯一、池不足在导出前拒绝 |
| 时段与版式 | `decoration-display`, `decoration-display.integration`, `four-corner-coverage`, `four-corner-render.integration`, `compiler` | 价格渐隐与贴纸时段分离、覆盖优先补角、原画面/补边几何保持 |
| 数量与生命周期 | `batch-production`, `batch-production-details`, `agent-controller`, `agent-runner`, `queue`, `cover-placement-session`, `cover-review-approval` | exact count / per-run 容量、冻结重试、取消、主管有限流程、批准幂等 |
| 输出发布 | `queue-output-directory`, `queue-output-directory.integration`, `ffmpeg.integration` | 临时文件验证、已有输出/源文件不被覆盖、失败不标 completed |

表内名称均为 `tests/<name>.test.ts`。执行前读取断言而非仅按文件名认定覆盖；检查 ID / 文件清单只写进 policy，导航引用相应 ID。

**Contract:** Spec R05。不以 Harness 重写业务 schema；media membership 不替代 exact requestedCount 的制作入口测试；回归若揭示现有语义缺口，保留失败并在该 bounded slice 内修复，不顺带更改产品路线。

**Acceptance:** 每个 concern 有正例与必要拒绝反例，实际发现的测试文件与 selected checks 一致、无必需 skip；旧冻结解释不被当前模板新规则误改。使用真实 FFmpeg 的用例只证明 fixture 工程行为。

**Verification:** 执行一次 `npm run typecheck` 和上述受影响 concern 的定向 tests；FFmpeg 相关检查只在对应路由运行。对 CLI 汇总使用 `tests/harness.test.ts` 与 `tests/harness-routing.test.ts`。不请求商业模型或选择用户真实 batch。

**Rollback:** 撤销该阶段 policy/test 和有依据的 task-owned regression fix，不动原任务、模板或输出。发现未解决问题不能先删对应 root 红线。

## M3 — Connect Safety And Shape Engineering Boundaries

**Files:** Modify `.agent/harness/policy.json`, `tests/harness-routing.test.ts`；复用并必要时补 `tests/connection-store.test.ts`, `chatgpt-session.test.ts`, `agent-provider.test.ts`, `source-mask-admission.test.ts`, `shape-cover-request-assembler.test.ts`, `shape-cover-pixel-gate.test.ts`, `shape-cover-activation.test.ts`, `shape-cover-candidates.test.ts`, `shape-cover-stationary-envelope.test.ts`。

**Contract:** Spec R01、R05、R06。开发限定型号由开发调用入口/route evidence 控制；通用产品 connection 不加该 allowlist。shape admission / research / simplification delta / activation 明确分开，不将研究 unit PASS 改成产品可用。

**Implementation:** 凭据用 fake 值、独立 auth root 与假服务；检查日志/renderer/项目不泄露，runtime 工具隔离、连接固定和取消。shape 反例覆盖源/修订/设置不匹配、缺 mask、非 100% coverage、alpha 不透明要求、共同候选不足、custody 失配和产品关闭。原 research helpers 仅按实际变更路由，不成为所有任务的必需实验。

**Acceptance:** 离线 tests 不读取用户 auth、不产生真实请求；支持配置下运行相应断言；不可用能力明确 NOT_EVALUATED。media 报告仍保持人工观看未评估，不能用首中尾图证明整片覆盖或音频内容。

**Verification:** `npm run typecheck`、本阶段所列受影响定向 tests 与 `tests/harness-media.integration.test.ts`。真实 provider、Windows desktop 与人工视觉如无授权/环境则分别未验证，不能以 stub verdict 补足。

**Rollback:** 仅退回本阶段 owned route/tests/fix；保留原 source admission、产品关闭和开发型号约束。

## M4 — Implement Owned AOCI And Read-Only Completion

**Files:** Create `src/harness/governance.ts`, `completion.ts`, `tests/harness-governance.test.ts`, `tests/harness-completion.test.ts`；Modify `types.ts`, `cli.ts`, `run.ts`, `code.ts`, `.agent/harness/policy.json`, `docs/video-validation-harness-spec.md`。

**Contract:** Spec R07、R08。实现 docs / ownedAoci control checks 和 `verify --scope --receipt`；验证器读取官方当前事实、旧回执及实际源码，不做维护、模型、Git mutation 或 queue submission。

**Implementation:** 官方 AOCI 结果按当前版本/能力解释，未知 shape 不猜测。输出逐对象结果、repositoryAoci、工具版本/退出码及基线事实；observe/exclude 明确处理。其他 session 的条目 drift 保留在全库状态，但不替代本次核对。相关 recovery、scope 损坏或工具不可用阻断证明。无法从当前官方 API 取到必要事实时报告具体缺口，不复制工具状态机。

**Acceptance:** fake 结果覆盖本次 aligned + 他处 stale、本次 stale、missing、add/delete、observe、工具失败、recovery、共享索引他条目改变。本 session 本次条目仍对齐时可以通过，不能掩盖整体未对齐。verify 拒绝 RUNNING/v1/缺检查/被修改 scope 或 policy/源码/报告；纯文档只检查适用 docs/AOCI。

**Verification:** `npm run typecheck`；`npm test -- tests/harness-governance.test.ts tests/harness-completion.test.ts tests/harness-routing.test.ts tests/harness.test.ts`。运行一次真实只读 AOCI scope fixture，保存官方 Verify/Check/Guide 输出与本次判定。副作用探针断言无模型/项目写入/AOCI Apply/commit。若官方输出缺能力，阶段停在有明确 blocker 的 checkpoint，不靠跳过取得 PASS。

**Rollback:** 撤销 verifier/adapter/policy 的任务内变更，不删除或改写官方 AOCI / 老 receipt；原 code/media 仍可用。

## M5 — Switch To A Thin Root And Verify The Whole Change

**Files:** Modify `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/agent-contract-index.md`, `docs/decoration-production-contract.md`；本 session 对应 AOCI formal Entries/baseline 随源码维护，其他 drift 保留。

**Contract:** Spec R09 与全部 AC。根规则只留下权威/授权、长期产品红线、canonical ownership、fail-closed、凭据、冻结、开发型号、证据层级、AOCI session 归属和 completion pointers。CLAUDE 缩成入口；不重复详细 contract 或 registry。

**Acceptance:** 原规则迁移清单逐项闭合；约 20–30 条短规则、正文≤8 KB；链接/anchor 可达，所有被迁移的安全、例外与旧行为可找到 owner。所有适用 gate 已可执行，其他任务文件保持原状；不把本次框架交付宣称为覆盖产品或真实成片完成。

**Verification:** 稳定 candidate 上执行一次 `npm run harness -- code`，用于最终核心集合；执行 scoped docs-only 和 mixed-source 正反例、`verify --scope --receipt` 接受/拒绝案例。在临时目录用 `tests/harness-media.integration.test.ts` 的媒体 fixtures 验证原 media 接口及证据层级；不创建用户生产批次。全量 code 已包含的测试不机械重复运行。

Parent 比较最终 diff 与迁移清单，读取并执行 `verification-before-completion`；维护本次 indexed 对象后完成 AOCI Verify、Check、Guide并区分全库状态。风险 gate 在 project-native verification 后判断一次，按适用 SUBAGENTS 决定必要独立 review，不默认给 Spec/Plan或普通 docs 再叠 reviewer。

**Rollback:** 若 gate/合同承接有缺口，恢复本阶段移除的 root 条款和入口；不 reset 当前工作树，不覆盖其他 session 变化，保留阶段证据。不借恢复 root 自动撤回前面已验证的工具实现。

# Verification Matrix

| Spec acceptance | Primary milestone | Evidence boundary |
| --- | --- | --- |
| AC01 / AC10 | M0 + M5 | 合同迁移、入口与大小；semantic self-review不可由关键词 lint替代 |
| AC02 / AC04 | M1 | scope/path/source/policy 真实字节与运行变化 |
| AC03 | M1 + M4 + M5 | 旧入口与 v1 读取、新 scoped verification |
| AC05 | M2 | 实际 domain 断言及适用 FFmpeg fixture |
| AC06 | M3 | 隔离与产品拒绝工程证据；非模型资格 |
| AC07 | M4 | 本次官方对象证明与全库状态分离 |
| AC08 / AC09 | M4 + M5 | 缺/旧回执拒绝、只读副作用、docs-only及共享树状态 |

# Execution And Handoff

执行始终在当前工作树内，先检查 Git 与精确 target ownership；每阶段维护本次 AOCI、做相关 verification、task-only commit。源码未稳定或必要证据缺失时不标该阶段完成。阶段记录更新本 Plan 的状态与对应 receipt 路径，不复制完整运行日志；运行证据仍由既有 Harness runs 与相关官方 receipt 保存。

仓库未发现专用 session-record/capture skill；实施证据由本 Plan 和原 Harness / AOCI receipts 承接。无需为既有 Spec/Plan self-review增加独立 reviewer；implementation review遵守风险 gate。

# Execution Record

- M0：`05a4a3d` 承接迁移前全部 15 条 Product Invariants，建立合同导航；原 `AGENTS.md` 完整保留。逐条语义与相对链接检查完成。
- M1 / M4 的共享 CLI、receipt 与 control 接缝同时实现，避免存在可输出 scoped PASS 却没有治理控制的中间入口；里程碑仍分别按合同验收。
- 受管 Kimi mapping：invocation `194ce4b5-d595-4993-94ec-cfc1e6dda60f`，qualified Docker `deep` route，机械观察为 `k3[1m] / max`。这是测试调查，不是 implementation review 或 acceptance。Parent 核对实际断言：文字、random、数量、冻结/取消、主管预算、批准幂等、独立 auth/runtime 隔离已有对应 tests；limited readset 的缺口建议不等于仓库缺测试。
- M1：scope v1 校验真实 Git blob / 当前后像、add/modify/delete、rename 双项、Unicode/空格路径、symlink 和越界拒绝；policy v2 按全部匹配项求必需并集。当前全部 TypeScript tests 已登记，新增测试必须选择包含自身的 Vitest 组。无 scope 的核心默认集合与研究/平台专项 registry 分开，相关必需 skip 继续非 PASS；该 refinement 已同步 Spec 与 self-review。
- M2 / M3：核心文字、数量、冻结/取消、随机、四角时段、原队列输出、凭据隔离与 shape 拒绝检查已接入。扩大 registry 实跑保留失败回执 `20261002T115322Z-88b97216`：暴露的旧 `knowledge-startup` Electron mock 缺少 `app.commandLine`，经真实失败重现后只补 mock，未改 production owner；Linux 上的 live-library / Windows 三项 skip 未伪装通过，专项按实际路径触发。
- M4：真实只读 docs code / verify 回执 `20261002T120319Z-e1beb176` / `20261002T120344Z-b564caa0` 验证入口；后续文档变化使旧证据需要刷新。completion tests 包含 v1/RUNNING/缺证据、scope/policy/source/report 字节失配与相同字节 commit、文档-only / mixed-source、截断 control JSON、无写入/无重跑的 CLI 反例。官方审计产生的 exclude inventory 数量变化不再伪造 source drift，结构/policy/源身份变化仍阻断。
- M5：15 条 Product Invariants 完整迁移，仅调整相对链接；root 为 28 条、7,991 bytes，CLAUDE 为指针。用户授权 README 只更新 Harness 说明，千川段落保留。parent 已核对最终业务 diff、migration ledger、产品例外、旧冻结解释及唯一 owner。
- 正式 AOCI：已按完整机器批次维护并通过官方 Verify / Check / Guide，Guide complete 且无待处理 recovery；本轮 indexed 对象逐项核对，observe/exclude 不扩 scope。用户已授权完整批次中其他会话对象仅读取并维护 Entry / baseline，业务改动保持原样。Git 仅投影本轮 Entry 与对应源码 baseline hunks，不提交其他会话业务或条目；正式工作树资产由官方工具维护。
- 旧无 scope 核心实跑 `20261002T121503Z-46729a0a`：typecheck 及 1,133 个测试逐项 PASS、零 skip，但运行期间另一会话提交使旧 Git 身份变化，最终为 NOT_EVALUATED。不把逐项 PASS 改写成该回执完成；本轮继续使用绑定参与源码实际字节的 scoped 证据。
- mixed-source 冻结实跑 `20261002T122812Z-d5e426cf`：核心 typecheck / 1,133 tests PASS，完整回执 FAIL。运行中 `governance.ts` / `harness-governance.test.ts` 新增字节使 scope 与官方 source manifest 失效；原 checker 将标题的多个空格合并，误拒绝 README 的正确 GitHub anchor。随后工作树中的 checker 已保留逐个空格，真实 docs control 重新核对 7 份文档 PASS。仍须确认这两个文件的最终写入归属、核对新增改动、完成对应 AOCI 维护并冻结新 snapshot；不得复用前述失败回执宣布 completion。

# Self-Review

## Current Verification Checkpoint

用户已授权本轮接管 `governance.ts` / `harness-governance.test.ts` 的新增 anchor 修复，保留并逐行核对；也已授权保留另一会话新增 policy 路由并仅提交本轮 Harness 改动。`20261002T123954Z-1b0e700c` 保留 FAIL：千川进程断言失败、shape 检查超时以及运行期间 policy/source 变化；`20261002T124905Z-fb7422cf` 因 README 后像改变而在执行前拒绝，`20261002T124941Z-901d994e` 在新的参与源码变更后显式中断，终态 NOT_EVALUATED。它们均不是 completion 证据。千川进程定向复跑 9/9，但不替代完整稳定快照的测试。

`20261002T131150Z-7a25d336` 和 `20261002T132117Z-50da341d` 的参与源码分别被千川/shape 后续写入改变，均仅中断本轮拥有的 Harness 进程、保留 NOT_EVALUATED 回执；未停止用户应用、导出或其他会话检查。稳定窗口后启动的第三个最终候选为 `implementation-candidate-v6-scope.json`，其前像仍绑定 M0 commit，后像为实际共同工作树字节；不得使用之前的失效回执批准该候选。完成仍须完整 code 及独立 verify 证明。

最终候选 `20261002T132746Z-ded5f130` 又遇到 `shape-cover-static-holdout.py`、`shape-cover-static-truth-tool.py` 及两项 Python tests 的后续写入。typecheck 和已结束的 955 个核心断言零失败、零 skip；shape 检查显式中断、治理控制未执行，receipt 为 NOT_EVALUATED。第三次最终窗口失效后停止重复全量测试，不扩大读取/写入权、不降低依赖快照或 gate、不停止其他会话任务。M0–M4 实现与 M5 入口修改可保存为 implementation checkpoint，M5 最终验收未完成。

Implementation Review Risk Gate 暂缓至 project-native 完整验证成功；Kimi mapping 不替代 final review，不对未通过 completion 的快照制造 reviewer acceptance。剩余工作是：参与源码稳定后冻结新的 owned scope，完整 code PASS、只读 verify PASS，再按 stable candidate 判断 Risk Gate、更新本 Plan 完成状态。当前根入口仍保留全部长期红线与唯一合同导航，源码变动会使完成证据失效。

Checkpoint 收尾重新运行 typecheck 和 6 个 Harness suites（81/81，零 skip），报告位于 `manual-governance-proof/native-checkpoint/vitest.report.json`。真实 readonly `owned-aoci` 重新逐项证明 20 个 scope 对象 PASS，官方 Verify / Check / Guide 的本轮证据位于同目录 `owned-aoci.json`；没有以其他会话变化为由跳过本轮维护。真实 verify `20261002T133826Z-1fbc64c9` 正确拒绝最后的 NOT_EVALUATED code receipt。这里只是验证 checkpoint 和 fail-closed 行为，不能升级为完整 code / completion PASS。

缓存回归已 red/green：新建或改变 `scripts/` / `tests/` 的 `__pycache__` 不再改变 scoped source identity，真实 `.py` 内容改变仍使身份失效；符号链接和 owned 路径校验保持原拒绝条件。typecheck 通过，scope 套件 14/14。另一会话新增专项曾重复登记 3 个既有测试，导致 6 个 Harness 套件中 13 项失败；用户随后明确授权本轮修复并随 Harness 提交。新专项保留新增测试，路由复用既有 shape / extended 检查 ID，原四项测试仍必需，未放宽 schema。修复后 6 个 Harness 套件 81/81、零 skip；AOCI 两个候选完整 Apply aligned，官方 Verify / Check aligned、Guide complete / none。全库批次因另一会话维护发生 CAS 零写入拒绝时重新读取领取，没有覆盖共享结果。

已覆盖全部 R01–R09 与 AC01–AC10；每阶段有精确职责、依赖、验收、verification 和 rollback。先承接合同与检查，最后减重；旧入口、shared dirty tree、AOCI ownership、开发/产品模型边界及人工验收均有明确处理。没有把计划完成、Kimi mapping、测试文件名或未来 gate 当成已实施/已验收。
