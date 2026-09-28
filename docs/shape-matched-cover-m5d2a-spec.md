# M5-D2A AI Full-Canvas Review Qualification Contract

## Status and Authorization

2026-09-29，`DRAFT / DESIGN_ONLY / NOT_IMPLEMENTED / NOT_QUALIFIED`。用户批准设计一套可由模型执行的审阅验证合同；本文件尚不是获准实施的 written spec，也没有冻结新 qualification package、启动正式 AI qualification 或签发任何资格记录。下一次实施须基于认可后的本合同编写 implementation plan，不能把本轮“可以设计”解释为已批准尚未写出的实现。

本候选方法为 `dual-ai-full-canvas/v1`，criteria 候选为 `ai-full-canvas-qualification/v1`，presentation 候选为 `ai-full-canvas-lossless-image/v1`，review schema 候选为 `ai-full-canvas-declaration/v1`。版本名在本合同中定义；对应代码、digest 和可信 issuer 当前均不存在。

这不是 `explicit-human-full-canvas/v1` 的修订、资格补录或 D2Q PASS。[Human D2Q](shape-matched-cover-m5d2q.md) 保持 INCOMPLETE；用户“第7和8帧有星星，其它一样”和“可以通过”的意见仅为已保存的人工口述，不自动转换成 ordinal、EMPTY、完整 target identity 或原 D2 receipt。

所有阶段保持 `authority=none`、`eligible=false`、`PRODUCT_DISABLED`；M5-B activation、M5-C issuer、M5-D3、M5-D4、verified-no-sticker production issuance 均 BLOCKED。即使未来本方法在受控集 QUALIFIED，也不能恢复 source admission 或 publication authority；下一步仍需另行定义并验收 D2 Production Qualified Review。

## Goal and Semantic Scope

验证一个确切配置的双模型方法能否在独立真值受控集上完整枚举每帧旧贴纸，而非验证“两模型会互相同意”。模型一致、source SHA、遍历数量、用户认可与 transport 成功均不能证明语义穷尽性。受控零错误只证明本次有限样本的观测结果，不是所有媒体零漏检定理，也不是 M5-E 泛化验收。

旧贴纸是原视频已经包含的贴纸或装饰叠加，包含中部、移动、动画及其附属可见元素。人物、商品实物/原生图案、普通字幕、UI 或商品文字不能仅因包含图形或文字就被声明为旧贴纸；贴纸自身可以带文字。无法从提供的完整视觉上下文可靠区分这些内容时必须 UNKNOWN。构造时知道“某层被叠加”不自动证明其外观可判定：无法由视觉输入可靠辨认的类别/身份应在独立真值中标为 TRUTH_AMBIGUOUS，不能用隐藏制作信息要求模型猜。

复用 [Full-Source-Fact Proof Contract](shape-matched-cover-m5d.md) 对 exhaustive T(f)、UNKNOWN、原 ordinal/PTS、moving/animated 不可排除及事实与覆盖决定分离的义务。此阶段不生成 mask、segments、placement、candidate 或 no-sticker intervals。

## Source-Grounded Reuse Boundary

| Current owner | Reuse boundary |
| --- | --- |
| [source-fact-census.ts](../src/main/source-fact-census.ts) / [clock](../src/main/source-fact-census-clock.ts) | 唯一 D1 census、源身份/解码解释、原 ordinal/PTS/endPTS 与 RGBA 摘要；不新建 census issuer。 |
| [source-fact-review-evidence.ts](../src/main/source-fact-review-evidence.ts) | `prepareFullCanvasReviewEvidence`、活跃 evidence 的 `readFrame` / `verifyFresh` / `close`；复用 owned 原画布 bytes，不伪造 evidence。 |
| [source-fact-review-session.ts](../src/main/source-fact-review-session.ts) | 固定真人 methodId、CLIENT_REPORTED_FULL_CANVAS、presentation/acknowledge 与真人确认文字；全部保持原样，AI 不调用它来取得真人 receipt。 |
| [source-fact-qualification-contract.ts](../src/main/source-fact-qualification-contract.ts) | 当前 package/criteria 固定真人版本；只能作为真值绑定与算术设计参考，不把新 AI package 强塞进该 schema。 |
| [source-fact-qualification-compare.ts](../src/main/source-fact-qualification-compare.ts) | 当前 validator 要求真人 method/version/receipt；不能改 literal、补 caller flag 或把 AI JSON 伪装成该输入。后续复用算法时须保留原真人行为与 digest。 |

新 AI declaration 仍只表达 TARGETS / EMPTY / UNKNOWN；它需要独立的 actor/route/input manifest 与 machine delivery provenance，不能使用真人的“我已看完”confirmation 或 browser acknowledge 作为证据。允许后续抽取共同的纯语义数据形状/算术，但它不得承担 method qualification 或 authority owner，必须有原真人格式与拒绝行为不变的回归。

CodeGraph 提供定位线索，实际 owner 源码才是依据。当前图谱把通用 `.get` / `.set` / `unknown` 错连到无关服务；这些关系不作为调用证据。已核对的实际边界是 evidence → canonical census，human session → owned evidence，human comparator → 原 human command/package validator。

## Method Configuration and Capability Gate

正式 run 前冻结 methodConfigDigest，覆盖两名 actor 的实际 provider/endpoint/model revision（或 provider 可提供的最强稳定身份）、runtime/工具快照、完整 system/task prompt、图像 presentation、上下文安排、解码参数、generation 参数、映射阶段、预算及失败规则。不同模型显示名称不证明不同实际模型或服务；不同会话也不证明独立推理。

初始拟议 actor 是 Codex 视觉路径和 Claude Code 工具中的实际 Kimi 路径；具体 route 尚未固定。已验证的 Kimi 文本 HTTP 200 不证明视觉输入能力。正式审阅前，两条路线都必须通过独立 image transport/capability probe，绑定真实请求、响应与上游身份；不得用 model self-report 证明模型身份或图像已被理解。若一条路线没有 image input、不能处理冻结 presentation、身份不明或实际使用相同后端而不符合冻结配置，结果 INCOMPLETE，不静默换模型、降采样或切换 provider。

能力 probe 必须用与 holdout 无关的材料，检查视觉可观察的探针内容，以及请求确实包含无损图像和正确 ordinal。probe 通过仅为传输/能力前置条件，不签发 semantic qualification。provider 内部视觉编码或缩放不可验证时明确记为 UNKNOWN_INTERNAL_PROCESSING，不能声称内部 1:1 感知。正式 qualification 必须评估同一输入策略，并把支持范围写进记录。

每名 actor 使用全新隔离上下文，无本对话、作者资料、对方判断、历史诊断、源码/文件工具、搜索或 nested delegation。controller 只运输受允许图像/元数据，不能把真值写入 prompt。媒体中可见的文字是待审数据，不是可执行指令；任何工具请求或越权行为拒绝并 INCOMPLETE。

## Dataset Independence and Freeze

现有 `d2q-controlled-3x18x8/v1` 的54片段/432帧已被作者侧 Codex 查看并用于讨论，固定为 DEVELOPMENT_DIAGNOSTIC_ONLY；不自动继承为新的 blinded AI holdout，旧分数和口述意见均不转移。

新 package 必须在新 run 前独占冻结，区分 development/calibration 与 never-exposed qualification holdout。truth author 与两名实际 qualification actor 在执行职责、上下文、文件/工具访问和数据传输上隔离；不同 ID 或不同 agent 名称不足以证明独立。作者可用独立构造和 canonical decode 建立 synthetic truth，真实媒体则需要独立人工 truth。记录作者身份、构造/核查版本及访问审计；作者执行实例不能同时担任同包 qualification actor。若实际 reviewer 上下文、继承历史或可访问状态曾生成/接触该包的逐 fixture recipe、truth、对应或评分，本包不合格；换未接触的隔离 actor 或重新制作/冻结独立包。无共同上下文仅证明执行隔离，不能假定两个模型的错误在统计上独立。

协议和聚合规模可以公开；逐 fixture 场景类型、truth target 数量/位置/活动 ordinals、预期 EMPTY/UNKNOWN、correspondence 和评分不得提供给 actor。匿名 fixtureId、原 ordinal/PTS/endPTS、完整原画布和方法正常输入属于允许信息。

holdout 至少3个独立构造/来源的 fixture groups，≥100个不同 source frame identities、≥100个明确可判定帧、≥10 EMPTY 帧、≥20 target-present 帧、≥5多目标并发帧、≥3单帧出现 cases、≥3切镜边界 cases、≥3 moving/animated cases、≥3明确歧义 cases，且覆盖原 D2Q 的全部18类场景。两名 actor 都审同一全部 holdout；把同一帧看两次不能扩大样本量。共同模板换颜色或同源重复编码不能冒充独立 fixture group。每个 case 和独立性依据在作者侧冻结。

SYNTHETIC_CONTROLLED 与 REAL_MEDIA_HUMAN_TRUTH 分别标注和报告；前者单独成功只能给 synthetic controlled scope 的资格。真实媒体或更大分辨率/更长序列的主张须对应独立留出证据，不按 aggregate accuracy 掩盖分层失败。

逐帧 truth 根和 T_truth(f)/TRUTH_AMBIGUOUS 绑定 datasetVersion、fixtureId、已有 SourceIdentity/媒体 SHA及长度、D1 censusDigest、ordinal、PTS/endPTS、RGBA pixelSha256/byteLength、truth identity/category/state、作者和 truth creation/review version。source/engine snapshot、dataset/truth/criteria/method config digest 及 freeze 时间均须在首个正式推理请求前固定。缺任何前置证据 INCOMPLETE，不倒填时间、不修改 threshold。

## Presentation and Independent Review

完整原画布由 canonical evidence.readFrame 取得，先核对 D1 frame binding，再无损编码 PNG并逐字节验证 decode 回 RGBA。图像文件 SHA 与原 RGBA pixelSha256 分开保存。每个 ordinal 独立绑定，即使像素重复也不能跳过、用首尾代表中间或凭相似度复用。

每名 actor 必须消费全部原帧。初始 presentation 采用最多8个连续 ordinal 的 packet，所有帧均为原尺寸完整 PNG；顺序、邻接上下文、累计本 actor 的冻结目标目录及 packet边界固定。完整 fixture 的所有 packets 均在 inputPlan 中预登记；上下文不足、provider 图片数量/尺寸限制或请求上限不足时 INCOMPLETE，不默默缩图、抽帧或抛弃前文。框选/缩略联系图可作诊断但不能代替正式输入。

需要切块的尺寸不属于初始 whole-frame presentation 支持范围。后续 tiling 必须新 presentation/methodConfig 及重跑资格，明确 tile 原像素坐标、重叠、边缘覆盖和 frame union；不能把当前完整 PNG 测试外推到任意大图。正式支持的分辨率、源 profile、fixture 总帧数、packet 数和 context 容量须在 capability gate 后、run 前写入 applicability envelope；不在包络内的输入拒绝。

每次请求绑定 runId/fixtureId/actorId/requestId/inputManifestDigest、methodConfigDigest、源/census/frame bindings、实际 PNG byte length/hash、发送时间和 provider request identity。owner 保存实际发送 payload 的可审计摘要与 receipt；不接受 caller 提供的“已看全部”boolean。网络发送证明 bytes delivery，不证明模型注意力，语义可靠性由 holdout 检验。

每个声明引用该请求内实际存在的 ordinal。TARGETS 为非空、无重复的完整目标集合，含 actor-local UUID、描述、static/moving/animated category 及原像素整数 bbox（仅用于审阅对应，不是 mask 或 placement）。EMPTY 必须显式存在，不能由缺返回、空数组、超时或未检出推导；UNKNOWN 必须有原因。无法可靠分类或跨帧关联时 UNKNOWN，不能猜 UUID 或隐藏目标。模型不得供应 source/census/qualification/authority 字段。

单 actor 可在提交前按冻结的上下文规则形成判断；一旦接受某 ordinal 的正式声明即追加冻结、不可编辑。不完整、格式非法、重复、借用输入绑定或部分输出都拒绝，不自动修复成 EMPTY，也不重新问到通过。每名 actor 覆盖全部 ordinals 后，owner fresh 复核 source/engine/evidence、原输入与声明，独占保存 AIReviewReceipt；不调用原 human session.finish。

## Comparison, Agreement and Failure Order

先分别冻结 actor A/B 全部原声明，两者此前不得看对方结果。之后才允许固定的一次独立身份对应阶段：actor B 基于原帧和双方冻结声明提出 A UUID ↔ B UUID 逐帧映射；不能改原声明、补目标、改时段、改 category 或查询 truth。owner 校验双射、源/帧绑定、category 与活动 ordinal 集合一致性；缺对应、非双射、歧义或任一 actor UNKNOWN 的帧，method result 为 UNKNOWN。不能以 label 相同或 UUID 字面相等自动认定同一目标。双方 EMPTY 才能给 method EMPTY；完整 TARGETS 经对应一致才保留 A 的完整集合。

该映射仍是模型声明，不是独立真值。单独冻结 mappingReceipt、jointReviewReceipt 及与两份原 receipt 的关联；不把模型映射当作 qualification truth correspondence。

作者侧在原 receipts 冻结后进行独立 truth correspondence，分别映射 A/B/joint 声明到 truth identity 或明确 null。规则在 run 前固定；不模糊匹配名称或复制真值 UUID给 actor。映射 unresolved 为 INCOMPLETE，不能通过调换对应“修正”错认目标。comparator 只读冻结 evidence，检测原 actor 错误和 joint 错误，不能重写 receipt。

正式接受的 A、B 或 joint 中任一帧 false EMPTY，经绑定真值确认后立即锁定 NOT_QUALIFIED，停止本 run 剩余资格请求；并行已在途请求撤销，迟到输出隔离，不再进入本次资格计数。禁止用 joint UNKNOWN、另一个 actor 正确或更多成功帧抵消这个错误。各 actor 其它 hard gates 也分别验算，joint 的错误同样不能忽略。

| Frozen metric requirement | Acceptance for each A / B / joint |
| --- | --- |
| falseEmptyCount | 0，立即终止硬门 |
| missedTargetFrames / targetFrameRecall | 0 / 1.0；明确 target 帧的 UNKNOWN 仍计 missed target |
| multiTargetMissCount | 0，不允许漏并发目标 |
| boundaryErrorFrames | 0，逐 target active ordinals 对称差，不按近似时间比较 |
| singleFrameAppearanceMisses | 0 |
| bridgedAbsenceIntervals | 0，消失/再现间不能连续声明 |
| missedUnknown | 0，TRUTH_AMBIGUOUS 必须 UNKNOWN |
| falsePositiveTargetFrames / falsePositiveRate | 0 / 0，分母为 declared target-frame pairs；无声明时显式报告分母0 |
| identityMergeErrors / identitySplitErrors | 0 / 0 |
| categoryMismatchTargetFrames | 0；身份对应正确也不能忽略错误 static/moving/animated 类别 |
| unnecessaryUnknownRate | ≤5%，分母为 KNOWN frames，且 clearFrameCount ≥100 |

指标只针对冻结 holdout 的全部 source ordinals；不以两名 actor 合计 frameCount 扩大分母。记录分母、整数计数和精确比率，缺少未评估部分时用 null/NOT_EVALUATED，不能填零。agreementRate/disagreementFrames 与 response latency/cost/requestCount 另列为诊断，不抵消任何语义门。

correspondence 证据充分且出现其它硬错误或超过已冻结5%门槛时 NOT_QUALIFIED；任何可验证硬错误优先于样本量不足。只有缺失/不完整 evidence、coverage不足、truth independence无法证明、criteria未提前冻结、transport/vision能力失败或环境中断时 INCOMPLETE。不把 INCOMPLETE 当 FAIL，也不从缺错误记录推出 PASS。

## Owner Record and Authority

只有 source-fact qualification owner 根据独立冻结 package、两份真实 AI receipts、post-freeze model mapping、joint receipt、独立 truth correspondence、固定 criteria 和 deterministic comparison 全部门成立才可生成 AIReviewMethodQualificationRecord。该候选 owner 需要另行实施，当前没有 issuer。

记录至少绑定 schema/method/presentation/review/criteria version与digest、applicability envelope、datasetVersion/datasetDigest/truthDigest、truthAuthor及核查版本、actor routes/model/runtime/prompt/config/input digests、vision capability与隔离访问证据、A/B/mapping/joint receipt digests、truth correspondenceDigest、comparisonDigest、每组全部指标及分母、资格状态、createdAt 和 tool/source snapshot。成功记录必须 `authority=none / eligible=false`，明确证据范围和 SYNTHETIC/REAL_MEDIA 分层。

无 caller-controlled qualified=true、人工同意开关、成功 restore 或 production consumer。serialized record 与 JSON SHA 只提供可追溯性，不能私有签发或恢复 capability；owner需核对实际受控执行来源，而非只校验字段。不同 route/config/dataset版本不得拼接 PASS；provider model revision不可稳定识别时记录限制且不赋予无限有效期或任意媒体 applicability。

## Run Budgets and Repeat Policy

每个 fixture/actor 的 requestLimit、wallSeconds、idleSeconds、context/image/payload limits、generationTokens，以及整包请求/时间/成本上限须在 package 启动前固定。请求覆盖全部 inputPlan 和一个 post-freeze mapping 阶段；预算不够就 INCOMPLETE，不删除帧、缩小样本或放宽标准。取消应撤销剩余请求并等待进程/网络生命周期收敛，迟到结果不发布。

无自动重试、fallback、模型切换、truth反馈或为同一结果追加讨论直到同意。NOT_QUALIFIED 的 package 不因调整 prompt/配置再跑而保留原资格；任何修订需新的 methodConfig/criteria/version、新完整独立 holdout 和新 run。旧包只用于诊断，所有历史失败保留。随机性参数固定并报告，单次受控成功不证明重复运行可靠性；重复性或稳定模型升级需独立资格扩展，不偷换成当前 PASS。

## Required Verification and Exit

实施后的工程检查必须覆盖：原 human session/schema/digest不变；伪造 actor/route/vision、借 token/帧、错PNG/RGBA绑定、缺首中末/重复像素遗漏、criteria晚冻结、truth泄露、peer提前泄露、过预算/截断/工具注入/取消迟到均 INCOMPLETE；双 actor 同时漏目标即便完全一致仍 NOT_QUALIFIED；任一 actor false EMPTY 立即停止后续请求；joint UNKNOWN不能掩盖 actor 漏检；全部18类、identity/category/boundary/ambiguity、5%阈值和不足100 clear frames验证。

单元/fixture/模拟 transport tests 只证明工程机制。正式退出必须另有两条实际视觉路线的 qualification run、原 bytes/input receipts、独立 truth/盲审隔离/提前冻结、完整 A/B/joint/correspondence、全部指标通过与 owner来源校验；再完成 typecheck、related/regression tests、git diff --check、AOCI Verify/Check/Guide，以及适用 Implementation Review Risk Gate。任一缺失不能声明 M5-D2A PASS。

## Design Checkpoint and Next Gate

本轮只新增本合同；D1/D2、human qualification、renderer、activation、knowledge/admission、产品IPC/UI均不修改，没有执行AI视觉资格实验。Self-Review核对了新方法身份、旧方法兼容、两模型一致不等于真值、holdout污染与独立性、全部冻结硬门、UNKNOWN、category、逐帧绑定、双原始结果保留、record来源和无authority边界。

Kimi 仅受管只读核对三份既有源码的 method/schema复用边界，不审阅 holdout、不成为 qualification actor，也不批准本 spec。invocation=`ccdad634-a35f-429d-8cc9-6912349cec4f`，worker/high，canonical receipt 已核对完整 Reads/source SHA、两个实际 `api.kimi.ai / k3-256k` 请求的 HTTP 200 与报告 hash；PARSED不代表本设计或方法通过。Parent采纳 human method/receipt/criteria literal不能复用为AI、独立对应不能靠label，以及旧 comparator 未校验 target category/kind 的源码发现，因此新合同显式增加 categoryMismatchTargetFrames=0。对报告提出的身份与ack复用问题，Parent明确：client acknowledge只证明客户端声明与字节绑定；新AI合同仍须独立truth author、隔离证据和可追溯对应，不能以actor ID替代这些事实。session record 留在本章节和独立 runtime receipt；不新增第二套 phase ledger或外部记忆。

文档验证核对8个本地引用、全部指标/版本/禁止项及6个既有 D2/qualification/renderer/activation/assembler SHA；无业务字节变化。本文件在当前 AOCI managed scope 中为 observe，Verify/Check/Guide均 exit0、governance_aligned=true、Guide complete/next_action=none，因此不制造新Entry或改其他writer的baseline。完整索引传输已确认，严格attestation因字段格式拒绝未完成，不声称已验证完整系统认知。交付只证明source-bound设计与文档检查；没有重新运行typecheck/代码测试，也没有真人或AI视觉qualification证据。

自然停止点是交付可审阅设计。后续先认可 written spec → implementation plan → engineering candidate/否定测试 → 两路视觉能力与独立新 holdout就绪 → 正式 AI qualification。当前不开始这些后续阶段，不宣称任何新的语义或产品准入。
