# Shape-Matched Cover Hybrid V1 Delta

## Authority and Goal

2026-10-05 accepted user architecture adjustment，随后接受 H2C-Corner 产品收缩。Hybrid V1 默认只自动处理四个角落内的静态后期贴纸/overlay logo。M1 仍全画面发现；Corner filter 决定产品范围；VLM 只确认每角语义及同角 component grouping。算法仍独占 mask、sampled motion、shape matching 与 100% coverage。

只处理 detected + confirmed corners；absence 不是无目标证明。商品原字、字幕、人物及物理背景可为 M1 proposal，角落固定位置不能替代语义。一个角失败只跳过该角；source stale、provider infrastructure 或 source/candidate/packet/corner binding 错误使全 source 失效。

## Product Default

**DEFAULT PRODUCT PATH: Corner-Scoped Hybrid V1**。

M1 full-frame discovery → Corner Scope Filter → TOP_LEFT / TOP_RIGHT / BOTTOM_LEFT / BOTTOM_RIGHT 各角独立 VLM semantic confirmation/grouping → H3 conservative mask + sampled motion validation + shape matching + 100% coverage → H4 rendered preview + MiniMax QA → Sol escalation → 原 export owners → 独立 Activation。

V1 不处理中间 overlay、底部中间字幕、lower-third、moving/animated sticker 或跨角 logical sticker，不要求任意全画面 candidate completeness 或跨包 global grouping。H2 → H3 → H4 接正式生产的准入由 [Activation Accepted Product Delta](#activation-accepted-product-delta) 独占；下文阶段记录保留当时的 PRODUCT_DISABLED 解释，不增加新研究阶段。

## Diagnostics and Future

**GENERALIZED / HIGH-ASSURANCE / DIAGNOSTIC**：旧 full-frame H2 为 GENERALIZED_SEMANTIC_RESEARCH；M1 multi-component、source identity、exact arbitrary frame reader、conservative mask、geometry v1/v2、confirmed-target proof v1/v2、HC2/HC3 及其他既有 HC research、H1 packet/router/schema/provider 全部保留。它们不再是 Corner V1 blocker。旧 H2 的 development BLOCKED 及 receipts 保留原解释；旧 random changing background + 固定 screen-space 矩形另分类为 AMBIGUOUS_SCREEN_SPACE_GRAPHIC diagnostic，不再当明确 BACKGROUND_GRAPHIC acceptance blocker，也不追改历史记录。

## H2C Corner Contract

`shape-cover-vision-corner-policy.ts` 独占 **CornerScopePolicy/v1**。固定 outerWidthFraction=0.30、outerHeightFraction=0.30、minimumAreaInside=0.60。内边界严格 `<0.30W/H` 或 `>0.70W/H`；candidate 的 bbox center 必须在 corner 内，且交集面积/bbox 面积≥0.60。center 唯一分配；歧义为 CORNER_SCOPE_AMBIGUOUS，不自动处理；参数不根据 model 结果调整。real233s 右上目标不满足时 STOP，报告几何原因。

M1 CANDIDATE 的非角对象记 OUT_OF_CORNER_SCOPE，不发送 VLM、不作 REJECT/NOT_STICKER/ABSENT。M1 UNKNOWN 记 UNKNOWN_NOT_PROPOSED，不能升级。每角 0 候选为 NO_CANDIDATE；1 候选 classification；2–3 候选 classification/grouping；>3 仅该角 CORNER_COMPLEX_UNRESOLVED，无 global cluster/partition。每角最多一个 logical overlay；两个以上独立组为 CORNER_MULTIPLE_OVERLAYS_UNSUPPORTED，UNRESOLVED，不选择其中一个。

H1 `buildVisionCandidatePacket()` 每角单包：1–3 IDs，3 个 full context 与每 candidate 首/中/尾 crop。角落、cornerScopeRect、policy/scope digest 通过独立 CornerReviewContext 绑定；receipt 再绑定 contextDigest、packetDigest、有序 image SHA、corner 与候选。新 prompt **hybrid-corner-overlay-semantic/v1** 明确只看该角：其他角及中央 overlay 不设风险。独立 schema 字段 **undetectedCornerOverlaySuspected** 仅指该角内额外疑似 overlay；不 reinterpret 旧 undetectedOverlaySuspected/crossBatchGroupingSuspected。

严格决策：CONFIRM 仅 OVERLAY_STICKER/OVERLAY_LOGO；REJECT 仅 PRODUCT_PRINT/SUBTITLE/BACKGROUND_GRAPHIC/PERSON/OTHER；UNKNOWN 保留。所有 CONFIRM 恰一次出现在 groups（单候选也返回 singleton）；REJECT/UNKNOWN 不进 groups。VLM 不返回坐标、mask/polygon、coverage 或 renderer。不 repair 非法 JSON。

每角 Luna first pass；清晰 classification、group 明确、temporalState=STABLE 即结束（2–3 components 清晰同组不自动消耗 Sol）。UNKNOWN、PRODUCT_PRINT_RISK、TEMPORAL_INCONSISTENCY、group UNCERTAIN、复杂 component/ALGORITHM_CONFLICT 等明确风险交 Sol 一次；同角 CONFIRM candidate 数>1且 Luna groups 数>1也必须交 Sol 一次 hard grouping resolution，重新看原图，Luna summary 为 untrusted context。Luna singleton groups 与 Sol 合并组之间的纯 grouping 差异允许 Sol resolve，不是 CORNER_MODEL_DISAGREEMENT；candidate 的明确 decision/class 相反仍仅该角 UNRESOLVED。最终仍有 UNKNOWN、非 STABLE、risk 或 group UNCERTAIN 为 CORNER_SEMANTIC_UNRESOLVED；Sol 保持多个独立组为 CORNER_MULTIPLE_OVERLAYS_UNSUPPORTED，不进行第三模型投票。Sol 同组、成员均 CONFIRM overlay/STABLE且无risk时形成一个 semanticSource=SOL 的 target。任一 reviewer 明确 MOVED/DISAPPEARED/CHANGED → UNRESOLVED_FOR_STATIC_V1，不让 Sol 或未来 H3 抹掉；VLM STABLE 绝不替代 H3 sampled algorithm。

Corner session 是原 ShapeCoverVisionSession 的独立 mode，source Luna≤4/Sol≤4/MiniMax=0，每角每角色≤1；取消/失败/timeout 消耗已发请求，零重试。H4 使用独立 preview session。provider 复用原 exact GPT requested 优先及用户已授权 gpt-5.6-luna/gpt-5.6-sol alternates，不增加 fallback。旧 GLOBAL mode prompt/schema/bounds 不变。

`HybridCornerSemanticSet/v1` 深冻结 run-local 对象含 sourceKey、policyVersion/Digest、candidateSetDigest/scopeDigest、所有 assignments、outOfScopeCandidateIds、unknownCandidateIds、四角 status/candidateIds/rejectedCandidates/unresolvedCandidates/confirmedTarget、packetDigests/receiptDigests/receipts、requestCounts、sourceErrors 和 verifyFresh。confirmedTarget 含 logicalTargetId、candidateIds、classification、semanticSource、temporalObservation、riskFlags。JSON 不恢复 ownership/freshness。

每角 NO_CANDIDATE / NO_OVERLAY / CONFIRMED / UNRESOLVED。全 source 有 unresolved 为 CORNER_SEMANTIC_PARTIAL（可有或无 confirmed）；无 unresolved 且有 confirmed 为 READY；无 confirmed 为 EMPTY；source 错误为 BLOCKED 并清 confirmed。NO_OVERLAY 是正常语义结果。`getConfirmedCornerTargets()` 唯一投影 fresh CONFIRMED 角（0–4）及 semantic receipt binding；H3 不解释原 JSON，也不要求全 source 全绿。

失败 observability：rawResponseSha256、rawResponseByteLength、parseFailureCategory（JSON_PARSE / SCHEMA_VALIDATION / PACKET_MISMATCH / GROUP_MISMATCH / MISSING_REQUIRED_FIELD / OTHER），受控 outputFailureCode。普通 receipt/log 不存 raw；development 私有 root 可存 bounded sanitized text。invalid syntax/group 仅角 skip；明确 identity mismatch 全 source BLOCKED。

后续硬门不放宽：**oldMask ⊆ fully opaque newStickerAlpha，100% coverage**。本轮没有 mask acceptance、motion 实现、shape、coverage、preview/export、proof v3 或 activation。

### H2C Final Acceptance

2026-10-05 H2C-Final 只关闭 grouping 升级和独立 provider development validation。保持 prompt hybrid-corner-overlay-semantic/v1 与 schema；新的 H2C-final-provider-validation 在任何模型请求前冻结四个既有 construction cases（product-print、subtitle、multi-component、two-overlays）的 fixture hashes、prompt/schema version、exact model IDs与预期语义，各case仅一次正常runtime，不继续或恢复旧run-once。provider transport无模型文本为 PROVIDER_NOT_EVALUATED，不归因prompt/schema/semantic失败，不改算法或重试。负例得到 REJECT对应类/NO_OVERLAY 或 UNKNOWN/UNRESOLVED均安全；误CONFIRM才是semantic blocker。

HYBRID_CORNER_H2_READY要求 clear overlay可CONFIRM、已有模型结果的商品印刷/字幕负例无误CONFIRM、provider错误清confirmed、multi-component具备Luna→Sol hard grouping路径、真正多overlay保持UNRESOLVED、partial成立、real233s右上投影保留及工程tests/owned Harness通过。外部transport一次失败不永久阻断工程READY；controlled grouping若Sol仍未确认则如实记录能力缺口。H2C结束后唯一下一slice是H3 Corner Motion + Mask + Shape + Coverage，产品仍PRODUCT_DISABLED。

## Superseded Critical Path

本Delta优先于旧simplification中的strict geometry/proof前置：confirmed-target-static v1/v2、geometry v1/v2、HC2/HC3/HC4/HC5及support/geometry/proof v3属于HIGH_ASSURANCE_RESEARCH / NOT_HYBRID_V1_CRITICAL_PATH。保留历史代码、fixtures和失败，不升级旧JSON或解除源争议。Hybrid不要求4×4可观察geometry proof，不以detector footprint当segmentation。

## Historical Generalized Pipeline and Acceptance

CV Proposal → VLM Semantic Confirmation/Grouping → deterministic conservative mask → sampled motion/persistence → shape matching + deterministic 100% coverage → VLM paired Preview QA → original export owners。V1 static only；明显移动/消失拒绝，无白矩形fallback，无训练，无全源absence proof。有限安全margin优先不露旧贴纸，其次不过盖/自然。

自动继续必须CONFIRM + OVERLAY_STICKER/OVERLAY_LOGO、group resolved、H3 sampled motion supported、mask available、oldMask ⊆ fully opaque projected alpha、preview PASS。Sol明确stable只作辅助，不替代H3 motion。Sol/MiniMax高风险冲突UNSAFE/NEEDS_REVIEW；不majority vote。模型不得创建candidate、坐标mask/polygon或renderer authority。

## H3 Accepted Delta

### Candidate Identity Repair

2026-10-06 产品兼容修复：新分析在 H2 前准备原默认密集 discovery，使 H2 确认的 candidate ID、集合摘要和 H3 mask 候选来自同一 live evidence；H3 精确按已确认 ID 交接，不从另一个抽帧人口的 bbox 推断身份。语义图片和 sampled motion 仍用原 24 帧证据，两份证据必须同源、同 clock/decode 且 fresh，JSON 不恢复 ownership。密集人口沿原默认上限 96 帧，并受原 scratch 容量和实际时钟约束，UNKNOWN 不升级。旧调用未提供同人口 evidence 时继续下方历史唯一包含规则，不 reinterpret 旧批准或 archive。零/部分处理及受限逐角原因保存在原冻结模板摘要并由原公开任务投影展示；摘要不授生产 authority，未知历史原因不补造。

### Boundary Compatibility Investigation

2026-10-06 用户先批准画布边缘兼容，再明确批准内部 ROI 掩码归属修复，均要求独立回归且 coverage/H4 不放宽。独立构造反例证明半透明阴影会随底层视频变化，不能用 M1 相邻帧持久性过滤 mask 像素。2026-10-07 的真实画布边缘反例进一步证明：仅裁切物理边界、保留 v2 稳定支持及 3px 膨胀，仍可能遗漏超过膨胀范围的变化阴影，却返回可继续的候选。该 v3 实验已完整撤下，新旧 H3 均使用原 canonical v2 extractor；画布边缘和内部 ROI 未解归属继续拒绝。不扩大 ROI、不补推画外像素，不改变运动/shape/placement/coverage 数值或 H4 门槛。

proof 绑定的 `source-mask-static-extraction`、`source-mask-static-target`、`shape-cover-stationary-discovery` 源码保持原 SHA，不修改 v1/v2 methodSources 或历史 archive。受控像素回归不代表真实素材或 H4 已通过，未完成的边界兼容不能算产品修复。

### Source-Bound Boundary Evidence Investigation

2026-10-06 用户选择 A，授权调查并修复 H2→H3 的源绑定贴纸边界证据。该授权是兼容修复范围，不预先证明方案有效。2026-10-07 的原像素构造反例证明：即使 Luna 与盲化 Sol 对三张原图的矩形 extent 一致，双方仍能共同漏掉软阴影；先用 extent 切开混合稳定组件会接受残缺 mask。按完整组件核验可保留安全性，但原素材 4/5 的内部 ROI 仍 unresolved，不能解决实际替换问题。

该矩形边界消费实验已撤下，没有改变产品 H2 v1 schema/prompt、请求预算或模型路线。当前交付仅包含同人口候选交接与冻结结果展示。画布边缘及内部 ROI 归属仍 blocked：需要能够独立区分目标像素和背景的证据，不能以模型一致、M1 粗框、时间持久性、丢弃触边组件或局部 coverage 自证完整。原 coverage/H4、motion、shape/placement、冻结生产及 unresolved/skipped 原样保留。

受控原素材复跑及构造像素回归仅证明软件接缝与拒绝方向；真实 H2/H4、全部原贴纸替换与真实画面验收仍未评估，不以此前实验中的 motion/shape 结果算成功。

### Mask Qualification Scope Clarification

2026-10-07 对上述修复 delta 的合同自审：独立回归要求不得扩大为“每个真实视频先提供原始 PNG、制作工程或真实 alpha 真值”。这些输入是可选证据；`qualifyStaticMask` 的 strict 研究资格不进入 Hybrid 产品准入，也不能因其对 REAL_MEDIA 固定返回 INCOMPLETE 而停止产品修复。上述“独立区分目标像素和背景”指方法须有独立构造真值回归及可解释的运行时不确定性拒绝条件，不要求从任意 RGB 唯一恢复 alpha 的数学证明。

此澄清不批准任何已失败候选：已知画布边缘、内部 ROI、变化阴影及 GrabCut 双初始化共同漏检反例必须由新方法完整包含规定真值 support 或明确拒绝，不能删例、缩减真值、只检查自身 mask 或由 H4 覆盖已知漏检。source/frame/候选 identity 与 freshness 证明输入归属；方法版本、参数及 mask digest 绑定候选；原 motion、shape/placement、100% opaque coverage、H4 和同字节生产仍各自负责既有职责。新的 Hybrid mask 方法须在 H3 单一提取接缝显式版本化，不能伪造 v2 receipt 或叠加多个失败后 repair owner；三个 proof-pinned 源文件及历史 strict 路径保持原样。

仅消费 `getConfirmedCornerTargets()` 的 fresh H2 targets。conservative mask 保持既有 M1 默认96张代表帧和原 extractor；每个密集 component 必须唯一且完全处于对应 H2-confirmed component box，否则该角 `MASK_TARGET_AMBIGUOUS`，不能发现/确认额外 target。multi-component 逐成员绑定，不用 union bbox 代替 mask。H2 的16–32张语义帧独立用于每个 component 的 mask interior sampled motion：reference局部对比至少64的可追踪点需≥8，否则UNOBSERVABLE；纯色共同内核RGB不变不能证明整个贴纸未移动。明显移动、消失、变化或不可观察仅跳该角；源码/引擎/语义/目录绑定失效或取消关闭全源。旧 full-range RGB anomalies 保留 diagnostic，仅 `FULL_RANGE_STATIC_CONTRADICTION` 不作 Hybrid motion blocker；不调用 strict geometry/proof，不发布 Knowledge Store。

本地有效 cover pool（内置及已校验上传）按 ID 排序，最多256款、5档等比尺寸、9个小平移位置、1280栅格/11520摆放/180秒。只裁全透明外围，不改变资源图文或部分 alpha。原 pixel gate 的 radius≤8 source px、area≤1.35、span≤1.16 保持；decode 后 oldMask 全部 alpha=255且 uncoveredPixels=0 才冻结。无匹配 `NO_SHAPE_MATCH`，预算耗尽 `HYBRID_SEARCH_LIMIT`；无白矩形fallback。PNG、RGBA、alpha、source、semantic、mask、motion、asset、trim、placement及output绑定冻结，重新读取核对同字节。H3仅提供 geometry-only/NOT_EVALUATED frozen PNG 和 active-owned getter 给后续H4；JSON不恢复authority。H4仍需渲染及视觉/内容安全判断，PRODUCT_DISABLED不变。

## H1 Infrastructure Contract

仅development packet/schema/router/receipt，不接store、M3 strict consumer、activation、UI、queue。复用DiscoveryEvidence及PNG codec、ConnectionStore/ChatGPT image catalog、AgentProvider/transport/scheduler。Luna fast batch triage；Sol处理UNKNOWN、复杂grouping、商品/人物风险、采样不一致和algorithm conflict；MiniMax独立preview或high-risk second opinion。route image能力必须来自当前catalog/官方provider证据，缺席UNAVAILABLE，不自动换GPT型号。2026-10-05用户依据当前catalog明确改用gpt-5.6-luna / gpt-5.6-sol；MiniMax exact ID来自已选配置，当前为MiniMax-M3。此授权仅适用于Hybrid开发路径，不改旧strict consumers。

H1历史每source共享Luna1/Sol2/MiniMax1请求上限；H2扩展为Luna4/Sol2/MiniMax1（H2 runtime不调用MiniMax）。取消、timeout、失败或未知结果消耗已发请求且不重放。provider错误不semantic retry或fallback；MiniMax preview FAIL/UNKNOWN可Sol一次二审，高风险相反结论仍UNSAFE。confidence仅diagnostic。所有严格JSON响应绑定packetDigest、已提供candidate IDs和有序图片SHA；非结构/未知字段/伪造ID/错packet拒绝。

2026-10-06 H4 QA closure accepted delta：schema/JSON invalid 首答不构成有效第一审，保留原 FAILED receipt，允许 Sol 独立审同 packet 一次；有效 Sol 四项 PASS 且无风险可形成 H4 PASS。有效 MiniMax FAIL/UNKNOWN 仍使用原高风险冲突 resolver，packet mismatch、stale、取消、timeout、provider failure 不走此例外。H4 Sol 复用上述 Hybrid requested/authorized alternate 策略，优先 `gpt-6.1-sol`，不可用才用 `gpt-5.6-sol`；无其他型号与模型重试。H4 只评价当前 confirmed TOP_RIGHT replacement 及其引起的误遮挡，其他未确认角落仍属 V1 partial-processing scope，不把保留的旧图形自动判为本 replacement residual。PRODUCT_DISABLED、无 Activation。

2026-10-06 H4 consistency closure accepted delta（基线 `4797406`）：先核对结构化自洽性，再进入原 MiniMax → Sol 路径。`PERSON_OCCLUSION_RISK` 对应 `unintendedOcclusion`，`TEMPORAL_INCONSISTENCY` 对应 `temporalMismatch`，`UNDETECTED_OVERLAY_SUSPECTED` 对应 `oldOverlayResidual`；flag 存在且对应 verdict=PASS 时标记 `INCONSISTENT` / invalid review。`PRODUCT_PRINT_RISK` 等无明确 check 映射的 flags 和 shortReason 不用于猜测矛盾。完整首审 receipt/output/flags/raw hash 保留，PARSED 仅表示语法成功；新增版本化 `previewReviewConsistency` 记录具体 contradictions，Sol 同样记录。首审 inconsistent 且四项全部 PASS 时，整份首审无效，由同 packet 的一次独立 Sol 四项 PASS、riskFlags=[]形成 H4 PASS；不是逐项删 flag、投票或对有效否决的覆盖。首审任一真实 FAIL/UNKNOWN（包括 mixed contradiction）始终 UNSAFE；自洽的未解决 risk 同样 UNSAFE，修复旧 resolver 能覆写 unnaturalPlacement FAIL/UNKNOWN 等漏洞。缺/非法 Sol、错 packet、stale、timeout、取消、transport 继续关闭。该最新 delta 优先于旧 H4 的 FAIL/UNKNOWN 可覆盖措辞，不修改 candidate/H2C/H3 语义、视觉 prompt、provider route 或生产准入。

H4 development READY 以 typecheck、H4/vision、H3 motion/shape focused 与实际 owned Harness/verify 为边界；policy 将 H3 focused 与完整 integration 分为互不重复的 required 检查，H3 owner 的 route 仍执行二者，H4 QA route 执行 focused。完整 H3 integration 和全仓 extended-regressions 的历史 timeout 保留，Activation 集成负责关闭并跑最终 completion；不改 required 或把未执行记 PASS。固定 real233s QA validation 可 replay 已取得的独立真实首/二审 receipt，必须校验同 packet、同12图、同preview/H3身份并单列零新 live model requests；不重新渲染、抽图或选款。通过只标 `HYBRID_CORNER_H4_READY`，PRODUCT_DISABLED/authority=none，不开始 Activation。执行见 [Consistency Plan](superpowers/plans/2026-10-06-hybrid-h4-qa-consistency.md)。

packet最多3个components、12张PNG、8MiB/image、32MiB总量；full context和每candidate crop均必须对应start/middle/end三个时间点。观察输入复用16–32点DiscoveryEvidence（短片取全部），不发送整片。图片绑定sourceKey、ordinal、PTS、原pixel SHA、PNG SHA、crop mapping和candidate IDs；发送体只含匿名ID、几何/时序和图片，无本机path/filename/account/key。generation前后复核源/图片及连接绑定，迟到输出拒绝。超限显式失败，不偷偷删confirmed component。

preview schema只回答旧overlay残留、误遮挡、明显不自然和temporal mismatch；H1不渲染或签发preview acceptance。receipt保留route/provider/exact model、packet/input hashes、prompt/version、structured output或安全failure code、timestamp；现有transport未暴露provider request ID时为null，不猜。无publication proof链。

## Verification and Limits

strict schemas、invented/swapped IDs/group、UNKNOWN、不可用route、Luna→Sol/MiniMax role、disagreement、图数/bytes、无path、取消/timeout/stale和existing provider regressions；实际可用route最多一次同packet diagnostic。233s及已授权controlled开发素材，不读210 holdout。classification/grouping/motion/mask/coverage/preview及false-cover的端到端统计留H2–H4，不将H1当产品完成。PRODUCT_DISABLED。

## Historical Generalized H2 Semantic Confirmation Contract

完整M1 CANDIDATE集最多12个；UNKNOWN仅保留diagnostic，builder拒绝升级。稳定sourceBox y/x/ID排序，轴向box gap≤短边12%作空间proposal关联，cluster原子first-fit装入每包≤3、source≤4包；cluster>3返回COMPLEX_GROUPING，atomic packing>4包返回SEMANTIC_BATCH_LIMIT_EXCEEDED，候选>12返回SEMANTIC_CANDIDATE_LIMIT_EXCEEDED。所有failure仍对全部candidate产生UNRESOLVED，不存在截断或topN。H1完整候选数错误及count envelope由[H2 record](shape-matched-cover-hybrid-h2-record.md)保留。

每包有全M1集合box context，但decision/group仅引用本包ID。空间hint不证明semantic truth；模型怀疑不同包候选属于同一overlay时，crossBatchGroupingSuspected=true使全source SEMANTIC_UNRESOLVED，不静默singleton，不graph merge。模型怀疑whole M1集合外还有overlay时，任何采用reviewer的undetectedOverlaySuspected=true使全source SEMANTIC_UNSAFE、原因UNDETECTED_OVERLAY_SUSPECTED，confirmedGroups清空，H3不得自动继续。

Luna逐包完整分类；UNKNOWN、riskFlags、非STABLE、group=false/UNCERTAIN、多component group交Sol原图片与Luna结构化摘要（不是truth），最多2包；其余hard cases完整保留unresolved，不续budget。Luna explicit MOVED/DISAPPEARED/CHANGED不能被Sol改写为通过，全source记录semanticTemporalConflict，H3 fail closed。Luna CONFIRM/Sol REJECT或确认class分歧是SEMANTIC_MODEL_DISAGREEMENT；Luna REJECT/Sol CONFIRM可作为hard-case resolution，保留两份receipt与resolutionReason。剩余risk/UNKNOWN/group uncertain不确认。false group明确partition为singleton而不丢candidate；resolved confirmedGroups形成confirmed集合严格partition。

`confirmHybridSemanticTargets`返回不可变run-local HybridSemanticTargetSet：sourceKey、candidateSetDigest、batchPlanDigest、allCandidateIds、confirmedGroups、rejectedCandidates、unresolvedCandidates、unknownCandidateIds、undetected/cross-batch/temporal flags、packetDigests、receipts/digests、requestCounts及verifyFresh。status仅SEMANTIC_CONFIRMED/SEMANTIC_UNRESOLVED/SEMANTIC_UNSAFE；零candidate没有absence claim。group只包含candidateIds、OVERLAY_STICKER/OVERLAY_LOGO、STABLE/UNCERTAIN observation、LUNA/SOL及risk/reason，无model坐标/mask。source或owned evidence失效时verifyFresh拒绝；JSON不恢复live freshness。H3只消费fresh SEMANTIC_CONFIRMED并另做自己的motion/mask/coverage；H2无SourceStickerKnowledge publication。

H2 prompt v2先冻结固定construction cases与labels，然后各source一次development执行；wrong/UNKNOWN结果保留，不改prompt重试到正确。MiniMax-M3只固定两项DEVELOPMENT_COMPARISON，不参与semantic runtime，也不投票。H2不调用extractStaticConservativeMask，不授mask acceptance、proof v3、旧M3或activation。

## Activation Accepted Product Delta

2026-10-06 用户授权 Hybrid Corner V1 产品集成。本 Delta 的产品解释优先于本文历史阶段及旧 strict/proof 的 `PRODUCT_DISABLED`、整轮共同候选和 whole-source completeness 前置；H2/H3/H4 算法、阈值与已批准 artifact 不变。最终启用须由当前正式导出、完整 production Harness（含 H3 full integration、H4 与 extended regressions）、completion verify、AOCI 及 applicable Risk Gate 的证据共同支持。

用户入口是保存的 `coverStrategy=shape-matched-static-v1` + enabled agent cover，经原 `AgentController.start` 调用 Hybrid H2→H3→H4。仅同 source/packet/PNG/binding 的 H4 PASS corner 可以成为进程内批准图层；每角独立处理。局部 unresolved/skipped/有效 H4 拒绝保留原样，已安全角落可生产；零批准角落明确显示未处理，不能声称整片旧贴纸全部移除。source、连接、基础设施、取消、binding 或 freshness 错误关闭全源，不用 partial 掩盖错误，不重试 unknown outcome。

Hybrid production adapter 仅签发冻结 sticker layer，不拥有数量、项目、队列或发布生命周期。原 runner 提交原 compiler/queue；compiler 使用同 PNG 字节的 task copy，全画布 0:0 原尺寸叠加，无重选、移动、扩边、缩放、白矩形 fallback 或新视觉判断。导出前、编码后和发布前重核实际生产源路径、原批准源、PNG/RGBA、binding、packet 与 opaque coverage；输出核验帧时域覆盖、完整解码及原 ArtifactVerifier。设置变化或未经 owner 批准的模板变更拒绝。未批准角落不加普通四角贴纸，保留原色及本地物化的用户手填展示文字。

MediaCatalog 的容器时长和 H2/H3/H4 的视频轨时长分别解释；生产 adapter 从当前 probe 验证未变化的容器摘要，再把精确视频轨时长交原 source-identity owner。源知识同时查询原容器与视频轨解释，任一已知争议或不可用均关闭，不能把换解释后的 miss 当作没有争议。原导出仍消费目录素材与音频，不能用容器尾部音频差异重写 H4 source/binding、增加时长容差或跳过输出视频时钟覆盖。

正式生产可消费用户明确批准并 hash-sealed 的历史 H4 artifact：仅 main-only 资格入口验证原 archive、packet、12 图、preview、结构化审阅收据及所有字节绑定，重放原判决取得当前批准，不再渲染 H4、重选或调用模型。该 import 不进入 renderer/IPC；普通用户使用上述正式 intent 流程。JSON、本地文件路径或 caller verdict 单独不能恢复批准。重试沿用同冻结模板；重启不恢复进程内批准，不自动重新分析，失权任务 fail closed。manual/assisted、旧缺 intent 的矩形流程保持原解释；strict research 接缝不接 Hybrid 产品意图。

执行计划见 [Activation Plan](superpowers/plans/2026-10-06-hybrid-corner-activation.md)。当前交付状态及确切证据见 [Activation Record](shape-matched-cover-hybrid-activation-record.md)；历史 H4 READY 本身不构成 Activation。

## Historical H4 Preview Contract

2026-10-06 用户授权从 `000f3e6` 独立 branch/worktree 接 H4，跳过共享 main 的 foreign completion 阻断，不修改 H3 算法。使用既有 archive/PNG 的 source/binding/RGBA/alpha 与原 projected mask 零遗漏复查；archive 不恢复 live H3 ownership。原 compiler 空模板接全画布 PNG 0:0 overlay，完整 preview 核验逐帧 PTS/endPTS、时长和源音频 packet hash。PRODUCT_DISABLED、原 export guard 不变。

PREVIEW v1 兼容允许只含 candidateId/sourceBox 的 frozen candidate，以及进入 digest 的可选 reviewScope；CANDIDATE 仍必须完整 grid/signals，不伪造 archive 中不存在的 CV 指标。仍最多12图/32MiB，首中尾加最多3个 H3 最低 stationaryMatch 位置；不是原133项 legacy anomaly 的完整审查，不增加crop图或预算。原语义包和历史消费者保持约束。

MiniMax-M3 一次 capability probe、一次 QA；FAIL/UNKNOWN 有条件精确 `gpt-6.1-sol` 二审。未解析首答作为 UNKNOWN 保留并尝试二审 gate，但不以无效首答或模型 vote 签发 PASS。精确型号缺失、transport、stale、cancel 等失败关闭，不重试或切换历史 alternate。真实采样 QA 不证明全片逐帧视觉质量，且不替代 H3 uncoveredPixels=0。执行及验证见 [H4 Plan](superpowers/plans/2026-10-06-hybrid-corner-h4-preview.md)。

## Self Review

本scope不调整生产准入。新语义owner只组装vision任务，provider基础设施仍唯一；strict历史与Hybrid发展路径分离，100% coverage是独立硬门。capability unavailable保持显式；无live证据不能声称三模型routing实测成立。

H2C self-review：只收缩 semantic product scope，保留历史能力、旧 global 语义及失败；固定几何不是视觉真值。局部 skip 不解除 source binding、M1 UNKNOWN 或最终像素硬门。实现/fixture/Harness 是不同证据层；真实开发结果见 [H2C Record](shape-matched-cover-hybrid-h2c-record.md)。
